import type { Express } from "express";
import type { ActivityLog, Job, Task } from "@shared/schema";
import { storage } from "./storage";
import { attributeFeedbackFromActivity, attributeFeedbackSummary, careerAssetsFromActivity, generateCandidateUniverse, starterDirections } from "./candidates";
import { explorationSignalsFromActivity, preferenceSummaryFromSignals } from "./signalCapture";

// ─────────────────────────────────────────────────────────────────────────────
// EXPLORATION QUEUE
// Smallest useful version of the hypothesis/opportunity idea: tell the user what
// is most worth exploring, why, what evidence is missing, and the smallest next
// experiment. This is discovery-first, not task-first.
// ─────────────────────────────────────────────────────────────────────────────

type ExplorationItem = {
  direction: string;
  rank: number;
  score: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingEvidence: string[];
  smallestExperiment: {
    title: string;
    firstStep: string;
    doneWhen: string;
    stopWhen: string;
  };
};

function haystack(job: Job) {
  return `${job.title} ${job.company} ${job.location} ${job.note} ${job.roleArchetype} ${job.narrativeAngle}`.toLowerCase();
}

function openJobs(jobs: Job[]) {
  return jobs.filter((j) => !["closed", "rejected"].includes(j.status || "") && j.applicationWindowStatus !== "closed");
}

function matchingJobs(direction: string, jobs: Job[]) {
  const tokens = direction.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
  return openJobs(jobs).filter((j) => tokens.some((t) => haystack(j).includes(t)));
}

function directionAttributeTerms(direction: string) {
  const d = direction.toLowerCase();
  if (d.includes("ai") || d.includes("technology")) return ["AI or technology", "strategy", "policy"];
  if (d.includes("economic") || d.includes("investment")) return ["economic development", "investment or capital", "strategy"];
  if (d.includes("government")) return ["government transformation", "policy", "strategy"];
  if (d.includes("chief") || d.includes("founder")) return ["ambiguous problem solving", "senior stakeholder facing", "strategy"];
  if (d.includes("impact") || d.includes("development")) return ["impact or development", "policy", "strategy"];
  return ["strategy"];
}

function notesFor(log: ActivityLog[]) {
  return log.map((e) => String(e.metadata || "").toLowerCase()).join(" ");
}

function matchingPreferenceScore(directionName: string, terms: string[], preferenceSummary: ReturnType<typeof preferenceSummaryFromSignals>) {
  const direction = preferenceSummary.directionScores.find((d) => d.direction.toLowerCase() === directionName.toLowerCase())?.score || 0;
  const termText = terms.join(" ").toLowerCase();
  const attractions = preferenceSummary.attractions.filter((a) => termText.includes(a.label.toLowerCase()) || a.label.toLowerCase().includes(termText)).reduce((sum, a) => sum + a.count, 0);
  const avoidances = preferenceSummary.avoidances.filter((a) => termText.includes(a.label.toLowerCase()) || a.label.toLowerCase().includes(termText)).reduce((sum, a) => sum + a.count, 0);
  return direction + attractions - avoidances;
}

export function buildExplorationQueue(tasks: Task[], jobs: Job[], log: ActivityLog[]) {
  const assets = careerAssetsFromActivity(log);
  const feedback = attributeFeedbackFromActivity(log);
  const summary = attributeFeedbackSummary(feedback);
  const explorationSignals = explorationSignalsFromActivity(log);
  const preferenceSummary = preferenceSummaryFromSignals(explorationSignals);
  const directions = starterDirections(assets);
  const candidateUniverse = generateCandidateUniverse(tasks, jobs, assets, feedback);
  const logText = notesFor(log);

  const items: ExplorationItem[] = directions.map((direction) => {
    const directionJobs = matchingJobs(direction.name, jobs);
    const terms = directionAttributeTerms(direction.name);
    const positiveTerms = [...summary.energising, ...summary.credible, ...preferenceSummary.attractions.map((a) => a.label)];
    const negativeTerms = [...summary.draining, ...preferenceSummary.avoidances.map((a) => a.label)];
    const gapTerms = [...summary.gap, ...preferenceSummary.unknowns.map((u) => u.label)];
    const evidenceFor: string[] = [];
    const evidenceAgainst: string[] = [];
    const missingEvidence: string[] = [];
    const preferenceScore = matchingPreferenceScore(direction.name, terms, preferenceSummary);

    if (direction.whyPlausible) evidenceFor.push(direction.whyPlausible);
    if (direction.warmNetworks.length > 0) evidenceFor.push(`Warm routes exist via ${direction.warmNetworks.slice(0, 3).join(", ")}.`);
    if (directionJobs.length > 0) evidenceFor.push(`${directionJobs.length} saved/open role(s) appear related.`);
    if (preferenceScore > 0) evidenceFor.push(`Preference signals are positive for this direction or its attributes.`);
    if (preferenceScore < 0) evidenceAgainst.push(`Preference signals are negative for this direction or its attributes.`);

    for (const term of terms) {
      if (positiveTerms.some((p) => p.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(p.toLowerCase()))) {
        evidenceFor.push(`Positive signal on ${term}.`);
      }
      if (negativeTerms.some((p) => p.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(p.toLowerCase()))) {
        evidenceAgainst.push(`Draining or avoidance signal on ${term}.`);
      }
      if (gapTerms.some((p) => p.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(p.toLowerCase()))) {
        missingEvidence.push(`Proof, preference, or clarity gap around ${term}.`);
      }
    }

    if (!directionJobs.length) missingEvidence.push("Need at least one real role example.");
    if (!logText.includes(direction.name.toLowerCase().split(" ")[0])) missingEvidence.push("Need day-to-day reality signal from a role or person.");
    if (!direction.peopleToFind.length) missingEvidence.push("Need a reachable person to reality-check this direction.");
    if (missingEvidence.length === 0) missingEvidence.push("Need enough repeated evidence to decide whether to deepen, pause, or drop.");

    const score = evidenceFor.length * 3 + directionJobs.length * 2 + missingEvidence.length + preferenceScore - evidenceAgainst.length * 3;
    const experimentTitle = directionJobs.length > 0
      ? `Inspect one saved ${direction.name} role for useful attributes`
      : `Find one real ${direction.name} role example`;

    return {
      direction: direction.name,
      rank: 0,
      score,
      evidenceFor: Array.from(new Set(evidenceFor)).slice(0, 5),
      evidenceAgainst: Array.from(new Set(evidenceAgainst)).slice(0, 4),
      missingEvidence: Array.from(new Set(missingEvidence)).slice(0, 4),
      smallestExperiment: {
        title: experimentTitle,
        firstStep: directionJobs.length > 0 ? "Open the most relevant saved role." : `Search '${direction.roleSearches[0]}'.`,
        doneWhen: "One role/person signal is captured and one attribute is noted.",
        stopWhen: "Stop after one useful signal or 20 minutes.",
      },
    };
  }).sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    purpose: "Rank what is most worth exploring before turning exploration into tasks.",
    preferences: preferenceSummary,
    topExplorations: items.slice(0, 5),
    recommended: items[0] || null,
    candidateRecommendation: candidateUniverse.recommended,
    trace: [
      "Read career assets, saved jobs, role attribute feedback, exploration signals, and candidate directions.",
      "Ranked directions by asset fit, warm routes, saved-role evidence, positive/negative signals, missing evidence, and preference summary.",
      "Returned smallest experiments rather than a full plan.",
    ],
  };
}

export function registerExplorationQueueRoutes(app: Express) {
  app.get("/api/exploration-queue", async (_req, res) => {
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    res.json(buildExplorationQueue(tasks, jobs, log));
  });
}
