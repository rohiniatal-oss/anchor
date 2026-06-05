import type { Express } from "express";
import type { ActivityLog, Job, Task } from "@shared/schema";
import { storage } from "./storage";
import { attributeFeedbackFromActivity, careerAssetsFromActivity } from "./candidates";
import { buildCareerGoalState } from "./goalState";

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS MAP / STAGE MODEL
// Makes bottleneck diagnosis explainable. Anchor should know which stage a goal
// is in, why, what evidence supports that, what is missing, and what would move
// the user to the next stage.
// ─────────────────────────────────────────────────────────────────────────────

type ProgressStage = "orientation" | "direction" | "market_map" | "network_signal" | "positioning" | "proof" | "applications" | "conversion";

type StageGate = {
  stage: ProgressStage;
  label: string;
  status: "not_started" | "in_progress" | "ready" | "blocked";
  evidence: string[];
  missing: string[];
  exitCriteria: string[];
};

function openJobs(jobs: Job[]) {
  return jobs.filter((j) => !["closed", "rejected"].includes(j.status || "") && j.applicationWindowStatus !== "closed");
}

function careerTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && (t.category === "job" || /job|career|role|cv|interview|application|network|message|proof|direction/i.test(t.title)));
}

function countEvents(log: ActivityLog[], eventType: string) {
  return log.filter((event) => event.eventType === eventType).length;
}

function hasText(log: ActivityLog[], pattern: RegExp) {
  return log.some((event) => pattern.test(`${event.eventType} ${event.sourceType} ${event.metadata}`));
}

function uniqueDirectionsFromJobs(jobs: Job[]) {
  const buckets = new Set<string>();
  for (const job of openJobs(jobs)) {
    const text = `${job.title} ${job.note} ${job.roleArchetype} ${job.narrativeAngle}`.toLowerCase();
    if (/ai|technology|digital|data|fintech/.test(text)) buckets.add("AI / technology strategy");
    if (/economic|investment|fdi|capital|development/.test(text)) buckets.add("economic development / investment");
    if (/government|public sector|policy|ministry/.test(text)) buckets.add("government strategy / policy");
    if (/chief of staff|founder|operator|operations/.test(text)) buckets.add("chief of staff / operator");
    if (/impact|foundation|philanthropy|development/.test(text)) buckets.add("impact / development");
  }
  return Array.from(buckets);
}

function gateStatus(evidenceCount: number, missingCount: number): StageGate["status"] {
  if (evidenceCount === 0) return "not_started";
  if (missingCount === 0) return "ready";
  return "in_progress";
}

export function buildCareerProgressMap(tasks: Task[], jobs: Job[], log: ActivityLog[]) {
  const assets = careerAssetsFromActivity(log);
  const feedback = attributeFeedbackFromActivity(log);
  const savedRoles = openJobs(jobs);
  const roleDirections = uniqueDirectionsFromJobs(jobs);
  const activeCareerTasks = careerTasks(tasks);
  const candidateCommits = countEvents(log, "candidate_committed");
  const deconstructionCommits = countEvents(log, "role_deconstruction_committed");
  const roleFeedbackCount = feedback.length;
  const networkEvidence = activeCareerTasks.filter((t) => /person|contact|message|network|alum|colleague/i.test(t.title)).length + (hasText(log, /person|contact|network|message/i) ? 1 : 0);
  const applicationEvidence = activeCareerTasks.filter((t) => /apply|application|interview|cover|submit/i.test(t.title)).length + (hasText(log, /application|interview|apply/i) ? 1 : 0);
  const proofEvidence = activeCareerTasks.filter((t) => /proof|gap|cv|bullet|story|sample|portfolio/i.test(t.title)).length + deconstructionCommits + feedback.filter((f) => f.reaction === "gap" || f.reaction === "credible").length;
  const positiveSignalCount = feedback.filter((f) => f.reaction === "energising" || f.reaction === "credible").length;
  const negativeSignalCount = feedback.filter((f) => f.reaction === "draining").length;

  const stages: StageGate[] = [
    {
      stage: "orientation",
      label: "Orient around assets and constraints",
      evidence: assets.length ? [`${assets.length} career assets available`] : [],
      missing: assets.length >= 5 ? [] : ["enough assets to ground exploration"],
      exitCriteria: ["career assets are explicit enough to generate plausible directions"],
      status: gateStatus(assets.length, assets.length >= 5 ? 0 : 1),
    },
    {
      stage: "direction",
      label: "Identify plausible role families",
      evidence: [
        candidateCommits ? `${candidateCommits} candidate activity commitments` : "",
        roleDirections.length ? `${roleDirections.length} role-family buckets seen in saved roles` : "",
        positiveSignalCount ? `${positiveSignalCount} positive role-attribute signals` : "",
        negativeSignalCount ? `${negativeSignalCount} negative role-attribute signals` : "",
      ].filter(Boolean),
      missing: [
        roleDirections.length >= 2 ? "" : "at least two plausible role families with real examples",
        positiveSignalCount + negativeSignalCount >= 3 ? "" : "enough attraction / avoidance signal to compare directions",
      ].filter(Boolean),
      exitCriteria: ["2 to 3 plausible role families have been tested", "there is enough signal to deepen, pause, or drop at least one direction"],
      status: gateStatus(roleDirections.length + positiveSignalCount + negativeSignalCount + candidateCommits, (roleDirections.length >= 2 && positiveSignalCount + negativeSignalCount >= 3) ? 0 : 1),
    },
    {
      stage: "market_map",
      label: "Map real roles and organisations",
      evidence: savedRoles.length ? [`${savedRoles.length} saved/open roles`] : [],
      missing: savedRoles.length >= 10 ? [] : ["enough real role examples to pattern-match"],
      exitCriteria: ["10 or more real role examples reviewed across the strongest directions"],
      status: gateStatus(savedRoles.length, savedRoles.length >= 10 ? 0 : 1),
    },
    {
      stage: "network_signal",
      label: "Collect human reality checks",
      evidence: networkEvidence ? [`${networkEvidence} network/conversation signal(s)`] : [],
      missing: networkEvidence >= 3 ? [] : ["3 or more human reality checks from warm or relevant people"],
      exitCriteria: ["3 or more conversations or warm-contact signals inform the direction"],
      status: gateStatus(networkEvidence, networkEvidence >= 3 ? 0 : 1),
    },
    {
      stage: "positioning",
      label: "Turn direction into a credible story",
      evidence: activeCareerTasks.some((t) => /positioning|story|narrative|pitch/i.test(t.title)) ? ["positioning/story task exists"] : [],
      missing: activeCareerTasks.some((t) => /positioning|story|narrative|pitch/i.test(t.title)) ? [] : ["one rough positioning sentence for the strongest direction"],
      exitCriteria: ["one credible narrative links assets to target direction"],
      status: gateStatus(activeCareerTasks.filter((t) => /positioning|story|narrative|pitch/i.test(t.title)).length, activeCareerTasks.some((t) => /positioning|story|narrative|pitch/i.test(t.title)) ? 0 : 1),
    },
    {
      stage: "proof",
      label: "Close proof gaps",
      evidence: proofEvidence ? [`${proofEvidence} proof or gap signal(s)`] : [],
      missing: proofEvidence >= 2 ? [] : ["top proof gaps identified and at least one evidence asset started"],
      exitCriteria: ["top 2 proof gaps are known", "one proof asset or CV evidence exists for the strongest lane"],
      status: gateStatus(proofEvidence, proofEvidence >= 2 ? 0 : 1),
    },
    {
      stage: "applications",
      label: "Apply selectively",
      evidence: applicationEvidence ? [`${applicationEvidence} application/interview signal(s)`] : [],
      missing: applicationEvidence >= 3 ? [] : ["selective applications or warm follow-ups in chosen direction"],
      exitCriteria: ["applications are being sent selectively to roles that match the chosen lane"],
      status: gateStatus(applicationEvidence, applicationEvidence >= 3 ? 0 : 1),
    },
    {
      stage: "conversion",
      label: "Convert opportunities",
      evidence: hasText(log, /interview|offer|final|recruiter/i) ? ["conversion-stage signal exists"] : [],
      missing: hasText(log, /interview|offer|final|recruiter/i) ? [] : ["interview, recruiter, or live opportunity signals"],
      exitCriteria: ["live opportunities are moving through interview or offer process"],
      status: gateStatus(hasText(log, /interview|offer|final|recruiter/i) ? 1 : 0, hasText(log, /interview|offer|final|recruiter/i) ? 0 : 1),
    },
  ];

  const currentStage = stages.find((stage) => stage.status !== "ready") || stages[stages.length - 1];
  const goalState = buildCareerGoalState(tasks, jobs, log);

  return {
    goal: "Find a fulfilling next role",
    currentStage: currentStage.stage,
    currentStageLabel: currentStage.label,
    bottleneck: goalState.recommendedFocus,
    diagnosis: `You are in ${currentStage.label} because ${currentStage.missing[0] || "the next stage needs stronger evidence"}.`,
    stages,
    nextGate: {
      stage: currentStage.stage,
      missing: currentStage.missing,
      exitCriteria: currentStage.exitCriteria,
      suggestedMove: currentStage.missing[0] || currentStage.exitCriteria[0],
    },
    trace: [
      "Read assets, saved roles, tasks, role feedback, and activity log.",
      `Current progress stage is ${currentStage.label}.`,
      `Goal-state bottleneck remains ${goalState.recommendedFocus}.`,
      "Progress Map explains why the bottleneck exists and what evidence would move the goal forward.",
    ],
  };
}

export function registerProgressMapRoutes(app: Express) {
  app.get("/api/goals/progress-map", async (_req, res) => {
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    res.json(buildCareerProgressMap(tasks, jobs, log));
  });
}
