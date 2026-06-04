import type { Express } from "express";
import type { ActivityLog, Job, Task } from "@shared/schema";
import { storage } from "./storage";
import { attributeFeedbackFromActivity, attributeFeedbackSummary, careerAssetsFromActivity, generateCandidateUniverse } from "./candidates";

// ─────────────────────────────────────────────────────────────────────────────
// GOAL STATE ENGINE
// Anchor should reason from goals and workstreams before creating tasks. This
// first slice derives the career goal state from existing assets, jobs, tasks,
// role attribute feedback, and activity history without adding a schema migration.
// ─────────────────────────────────────────────────────────────────────────────

type WorkstreamStatus = "active" | "underdeveloped" | "premature" | "blocked" | "stale" | "sufficient_for_now";
type NextMoveType = "learning" | "relationship" | "preparation" | "execution" | "maintenance" | "wait";

type WorkstreamState = {
  name: string;
  status: WorkstreamStatus;
  progress: "not_started" | "early" | "developing" | "ready";
  bottleneck: string;
  nextMoveType: NextMoveType;
  evidence: string[];
  nextMoves: string[];
};

function isCareerTask(t: Task) {
  return !t.done && (t.category === "job" || /job|career|role|cv|interview|application|network|contact|message|proof/i.test(t.title));
}

function openJobs(jobs: Job[]) {
  return jobs.filter((j) => !["closed", "rejected"].includes(j.status || "") && j.applicationWindowStatus !== "closed");
}

function countEvents(log: ActivityLog[], eventType: string) {
  return log.filter((e) => e.eventType === eventType).length;
}

function hasSignal(summary: ReturnType<typeof attributeFeedbackSummary>, reaction: keyof ReturnType<typeof attributeFeedbackSummary>) {
  return summary[reaction]?.length > 0;
}

function workstreamStates(tasks: Task[], jobs: Job[], log: ActivityLog[]): WorkstreamState[] {
  const assets = careerAssetsFromActivity(log);
  const feedback = attributeFeedbackFromActivity(log);
  const feedbackSummary = attributeFeedbackSummary(feedback);
  const savedJobs = openJobs(jobs);
  const careerTasks = tasks.filter(isCareerTask);
  const candidateCommits = countEvents(log, "candidate_committed");
  const deconstructionCommits = countEvents(log, "role_deconstruction_committed");
  const roleFeedbackCount = feedback.length;
  const hasNetworkTask = careerTasks.some((t) => /person|contact|message|network|alum|colleague/i.test(t.title));
  const hasApplicationTask = careerTasks.some((t) => /apply|application|cv|cover|interview/i.test(t.title));
  const hasProofTask = careerTasks.some((t) => /proof|gap|bullet|story|portfolio|sample/i.test(t.title));
  const directionEvidence = [
    assets.length ? `${assets.length} career assets available` : "no career assets recorded",
    savedJobs.length ? `${savedJobs.length} open or saved roles` : "no open or saved roles",
    candidateCommits ? `${candidateCommits} candidate activities committed` : "no candidate activity committed",
    roleFeedbackCount ? `${roleFeedbackCount} role attribute signals captured` : "no role attribute signals captured",
  ];

  const directionReady = savedJobs.length >= 5 || roleFeedbackCount >= 3 || hasSignal(feedbackSummary, "energising") || hasSignal(feedbackSummary, "credible");
  const directionStarted = savedJobs.length > 0 || candidateCommits > 0 || roleFeedbackCount > 0;
  const networkStarted = hasNetworkTask || /person|contact|network/i.test(log.map((e) => e.metadata || "").join(" "));
  const proofStarted = hasProofTask || deconstructionCommits > 0 || hasSignal(feedbackSummary, "gap");
  const applicationsReady = directionReady && proofStarted;

  return [
    {
      name: "Direction",
      status: directionReady ? "active" : "underdeveloped",
      progress: directionReady ? "developing" : directionStarted ? "early" : "not_started",
      bottleneck: directionReady ? "needs narrowing from gathered signals" : "not enough role-family signal",
      nextMoveType: directionReady ? "learning" : "learning",
      evidence: directionEvidence,
      nextMoves: directionReady ? ["summarise patterns", "compare the strongest lanes", "inspect one adjacent role"] : ["inspect one asset-backed role", "save one plausible role", "note one useful attribute"],
    },
    {
      name: "Market map",
      status: savedJobs.length >= 10 ? "sufficient_for_now" : savedJobs.length > 0 ? "active" : "underdeveloped",
      progress: savedJobs.length >= 10 ? "ready" : savedJobs.length > 0 ? "early" : "not_started",
      bottleneck: savedJobs.length >= 10 ? "enough initial roles to pattern-match" : "not enough real role examples",
      nextMoveType: savedJobs.length >= 10 ? "wait" : "learning",
      evidence: [`${savedJobs.length} saved/open roles`],
      nextMoves: savedJobs.length >= 10 ? ["summarise role patterns"] : ["save one role from an asset-backed search", "compare two role descriptions"],
    },
    {
      name: "Network",
      status: networkStarted ? "active" : "underdeveloped",
      progress: networkStarted ? "early" : "not_started",
      bottleneck: networkStarted ? "needs active conversations or replies" : "few warm conversations created",
      nextMoveType: "relationship",
      evidence: [hasNetworkTask ? "network task exists" : "no clear network task", assets.some((a) => a.kind === "network") ? "network assets available" : "no explicit network assets"],
      nextMoves: ["find one warm-network person", "draft one reality-check message", "send or save one soft ask"],
    },
    {
      name: "Positioning",
      status: directionReady ? "active" : "premature",
      progress: directionReady ? "early" : "not_started",
      bottleneck: directionReady ? "story needs to connect assets to target lanes" : "target lanes are not clear enough",
      nextMoveType: directionReady ? "preparation" : "wait",
      evidence: [directionReady ? "some direction signal exists" : "direction still unclear"],
      nextMoves: directionReady ? ["write one rough positioning sentence", "map one asset to one role requirement"] : ["wait until more role signal exists"],
    },
    {
      name: "Proof",
      status: proofStarted ? "active" : directionReady ? "underdeveloped" : "premature",
      progress: proofStarted ? "early" : "not_started",
      bottleneck: proofStarted ? "proof gaps need evidence or examples" : directionReady ? "top proof gaps not yet identified" : "premature until direction has signal",
      nextMoveType: proofStarted || directionReady ? "preparation" : "wait",
      evidence: [deconstructionCommits ? `${deconstructionCommits} role deconstruction tasks committed` : "no role deconstruction commitments", hasSignal(feedbackSummary, "gap") ? "gap feedback exists" : "no explicit proof-gap feedback"],
      nextMoves: proofStarted || directionReady ? ["identify one proof gap", "rewrite one CV bullet", "find evidence for one requirement"] : ["wait until role signal exists"],
    },
    {
      name: "Applications",
      status: applicationsReady || hasApplicationTask ? "active" : "premature",
      progress: hasApplicationTask ? "early" : "not_started",
      bottleneck: applicationsReady ? "needs selective execution" : "direction and proof are not ready enough for mass applications",
      nextMoveType: applicationsReady ? "execution" : "wait",
      evidence: [hasApplicationTask ? "application-related task exists" : "no active application task", applicationsReady ? "direction/proof signals exist" : "direction/proof gates incomplete"],
      nextMoves: applicationsReady ? ["tailor one CV bullet", "prepare one application", "send one warm follow-up"] : ["do not mass apply yet"],
    },
    {
      name: "Energy and stability",
      status: "active",
      progress: "developing",
      bottleneck: "execution must stay sustainable",
      nextMoveType: "maintenance",
      evidence: ["always relevant for ADHD execution"],
      nextMoves: ["include one maintenance action if the day is overloaded", "keep the plan small enough to start"],
    },
  ];
}

function recommendedFocus(workstreams: WorkstreamState[]) {
  const priority = ["Direction", "Network", "Proof", "Positioning", "Applications", "Market map", "Energy and stability"];
  return priority.map((name) => workstreams.find((w) => w.name === name))
    .find((w) => w && ["underdeveloped", "active", "stale", "blocked"].includes(w.status) && w.nextMoveType !== "wait") || workstreams[0];
}

function dayTypeFor(focus: WorkstreamState) {
  if (focus.nextMoveType === "learning") return "signal-building";
  if (focus.nextMoveType === "relationship") return "network-building";
  if (focus.nextMoveType === "preparation") return "proof-building";
  if (focus.nextMoveType === "execution") return "conversion";
  return "stabilising";
}

export function buildCareerGoalState(tasks: Task[], jobs: Job[], log: ActivityLog[]) {
  const assets = careerAssetsFromActivity(log);
  const feedback = attributeFeedbackFromActivity(log);
  const workstreams = workstreamStates(tasks, jobs, log);
  const focus = recommendedFocus(workstreams);
  const candidateUniverse = generateCandidateUniverse(tasks, jobs, assets, feedback);
  const mustDo = focus.nextMoves[0] || candidateUniverse.recommended?.createsTaskTitle || "Create one small career signal";
  const next = focus.nextMoves[1] || candidateUniverse.recommended?.activity || "Find one useful next signal";
  const optional = focus.name === "Energy and stability" ? "Stop after the minimum viable action" : "Do one small maintenance action so the day stays sustainable";

  return {
    goal: "Find a fulfilling next role",
    status: "active",
    objective: "make progress toward the next role without forcing premature certainty",
    dayType: dayTypeFor(focus),
    recommendedFocus: focus.name,
    reason: `${focus.name} is the current bottleneck: ${focus.bottleneck}.`,
    workstreams,
    todayPlan: {
      mustDo,
      next,
      optional,
      stopRule: focus.nextMoveType === "learning" ? "Stop after one useful signal or 20 minutes." : "Stop once the defined small action is complete.",
    },
    trace: [
      "Read career assets, saved jobs, tasks, role feedback, and activity history.",
      `Selected ${focus.name} because ${focus.bottleneck}.`,
      `Day type is ${dayTypeFor(focus)}.`,
      "Today plan is a small surface of the goal state, not the whole goal.",
    ],
  };
}

export function registerGoalStateRoutes(app: Express) {
  app.get("/api/goals/state", async (_req, res) => {
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    res.json({ goals: [buildCareerGoalState(tasks, jobs, log)] });
  });
}
