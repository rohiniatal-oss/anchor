import type { Express } from "express";
import type { ActivityLog, Job, Learn, Task } from "@shared/schema";
import { storage } from "./storage";
import { attributeFeedbackFromActivity, attributeFeedbackSummary, careerAssetsFromActivity, generateCandidateUniverse } from "./candidates";

type WorkstreamStatus = "active" | "underdeveloped" | "premature" | "blocked" | "stale" | "sufficient_for_now";
type NextMoveType = "learning" | "relationship" | "preparation" | "execution" | "maintenance" | "wait";
type GoalPhase = "fit-discovery" | "lane-narrowing" | "role-targeting" | "interview-prep";
type TrajectoryStatus = "complete" | "current" | "pending";

type WorkstreamState = {
  name: string;
  status: WorkstreamStatus;
  progress: "not_started" | "early" | "developing" | "ready";
  bottleneck: string;
  nextMoveType: NextMoveType;
  evidence: string[];
  nextMoves: string[];
};

type GoalTrajectoryStep = {
  key: "discover-fit" | "narrow-lane" | "target-role" | "prepare-interview" | "capability-ramp";
  title: string;
  status: TrajectoryStatus;
  description: string;
};

type GoalSnapshot = {
  assets: ReturnType<typeof careerAssetsFromActivity>;
  feedback: ReturnType<typeof attributeFeedbackFromActivity>;
  feedbackSummary: ReturnType<typeof attributeFeedbackSummary>;
  savedJobs: Job[];
  careerTasks: Task[];
  candidateCommits: number;
  deconstructionCommits: number;
  roleFeedbackCount: number;
  hasNetworkTask: boolean;
  hasApplicationTask: boolean;
  hasProofTask: boolean;
  activeLearnCount: number;
  evidencedLearnCount: number;
  learningOutputGapCount: number;
  interviewingJobs: number;
  roleHypotheses: string[];
  directionReady: boolean;
  directionStarted: boolean;
  proofStarted: boolean;
  applicationsReady: boolean;
};

const HYPOTHESIS_LABELS = {
  ai_strategy: "AI strategy",
  geopolitics: "Geopolitics / geopolitical advisory",
  policy_advisory: "Policy / advisory",
  operations_strategy: "Strategy / chief of staff / operations",
} as const;

function isCareerTask(t: Task) {
  return !t.done && (t.category === "job" || /job|career|role|cv|interview|application|network|contact|message|proof|course|learn|skill/i.test(t.title));
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

function addHypothesisScore(scores: Map<string, number>, key: keyof typeof HYPOTHESIS_LABELS, amount = 1) {
  scores.set(key, (scores.get(key) || 0) + amount);
}

function scoreHypothesesFromText(text: string, scores: Map<string, number>) {
  const lower = text.toLowerCase();
  if (/\b(ai|artificial intelligence|ai governance|tech policy|machine learning|frontier model|safety)\b/.test(lower)) {
    addHypothesisScore(scores, "ai_strategy", 2);
  }
  if (/\b(geopolitic|foreign policy|international|security|middle east|geostrateg|geopolitical risk|risk advisory)\b/.test(lower)) {
    addHypothesisScore(scores, "geopolitics", 2);
  }
  if (/\b(policy|public sector|think tank|government|advisory|advisor|advisory work)\b/.test(lower)) {
    addHypothesisScore(scores, "policy_advisory", 1);
  }
  if (/\b(strategy|chief of staff|operations|ops|program management|delivery|partnerships)\b/.test(lower)) {
    addHypothesisScore(scores, "operations_strategy", 1);
  }
}

function detectRoleHypotheses(tasks: Task[], jobs: Job[], log: ActivityLog[]) {
  const scores = new Map<string, number>();
  for (const j of jobs) {
    scoreHypothesesFromText(`${j.title} ${j.roleArchetype || ""} ${j.narrativeAngle || ""} ${j.note || ""}`, scores);
  }
  for (const t of tasks) {
    scoreHypothesesFromText(`${t.title} ${t.sourceNote || ""} ${t.doneWhen || ""}`, scores);
  }
  for (const e of log) {
    if (e.eventType === "role_attribute_feedback") scoreHypothesesFromText(e.metadata || "", scores);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const topScore = ranked[0]?.[1] || 0;
  return ranked
    .filter(([, score]) => score >= Math.max(2, topScore - 1))
    .map(([key]) => HYPOTHESIS_LABELS[key as keyof typeof HYPOTHESIS_LABELS])
    .slice(0, 3);
}

function buildGoalSnapshot(tasks: Task[], jobs: Job[], log: ActivityLog[], learn: Learn[] = []): GoalSnapshot {
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
  const activeLearn = learn.filter((l) => !l.done && l.learnStatus !== "closed");
  const evidencedLearnCount = learn.filter((l) => !!(l.outputEvidenceUrl && l.outputEvidenceUrl.trim())).length;
  const learningOutputGapCount = activeLearn.filter((l) => !!(l.requiredOutput || l.proofIntent) && !(l.outputEvidenceUrl && l.outputEvidenceUrl.trim())).length;
  const interviewingJobs = savedJobs.filter((j) => j.status === "interviewing").length;
  const roleHypotheses = detectRoleHypotheses(tasks, savedJobs, log);

  const directionReady = savedJobs.length >= 5 || roleFeedbackCount >= 3 || hasSignal(feedbackSummary, "energising") || hasSignal(feedbackSummary, "credible");
  const directionStarted = savedJobs.length > 0 || candidateCommits > 0 || roleFeedbackCount > 0;
  const proofStarted = hasProofTask || deconstructionCommits > 0 || hasSignal(feedbackSummary, "gap");
  const applicationsReady = directionReady && proofStarted;

  return {
    assets,
    feedback,
    feedbackSummary,
    savedJobs,
    careerTasks,
    candidateCommits,
    deconstructionCommits,
    roleFeedbackCount,
    hasNetworkTask,
    hasApplicationTask,
    hasProofTask,
    activeLearnCount: activeLearn.length,
    evidencedLearnCount,
    learningOutputGapCount,
    interviewingJobs,
    roleHypotheses,
    directionReady,
    directionStarted,
    proofStarted,
    applicationsReady,
  };
}

function inferGoalPhase(snapshot: GoalSnapshot): GoalPhase {
  if (snapshot.interviewingJobs > 0) return "interview-prep";
  if (!snapshot.directionStarted) return "fit-discovery";
  if (snapshot.roleHypotheses.length >= 2 && !snapshot.hasApplicationTask) return "lane-narrowing";
  return "role-targeting";
}

function workstreamStates(snapshot: GoalSnapshot): WorkstreamState[] {
  const directionEvidence = [
    snapshot.assets.length ? `${snapshot.assets.length} career assets available` : "no career assets recorded",
    snapshot.savedJobs.length ? `${snapshot.savedJobs.length} open or saved roles` : "no open or saved roles",
    snapshot.candidateCommits ? `${snapshot.candidateCommits} candidate activities committed` : "no candidate activity committed",
    snapshot.roleFeedbackCount ? `${snapshot.roleFeedbackCount} role attribute signals captured` : "no role attribute signals captured",
    snapshot.roleHypotheses.length ? `current hypotheses: ${snapshot.roleHypotheses.join(" vs ")}` : "no clear role hypotheses yet",
  ];

  const networkStarted = snapshot.hasNetworkTask || snapshot.assets.some((a) => a.kind === "network");

  return [
    {
      name: "Direction",
      status: snapshot.directionReady ? "active" : "underdeveloped",
      progress: snapshot.directionReady ? "developing" : snapshot.directionStarted ? "early" : "not_started",
      bottleneck: snapshot.roleHypotheses.length >= 2 ? "you still need to choose which lane deserves focused testing" : snapshot.directionReady ? "signals need narrowing into one role lane" : "not enough role-family signal",
      nextMoveType: "learning",
      evidence: directionEvidence,
      nextMoves: snapshot.roleHypotheses.length >= 2
        ? [`compare ${snapshot.roleHypotheses[0]} vs ${snapshot.roleHypotheses[1]}`, "define what a good-fit role must include", "save one concrete example from each lane"]
        : snapshot.directionReady
          ? ["summarise patterns", "compare the strongest lanes", "inspect one adjacent role"]
          : ["inspect one asset-backed role", "save one plausible role", "note one useful attribute"],
    },
    {
      name: "Market map",
      status: snapshot.savedJobs.length >= 10 ? "sufficient_for_now" : snapshot.savedJobs.length > 0 ? "active" : "underdeveloped",
      progress: snapshot.savedJobs.length >= 10 ? "ready" : snapshot.savedJobs.length > 0 ? "early" : "not_started",
      bottleneck: snapshot.savedJobs.length >= 10 ? "enough initial roles to pattern-match" : "not enough real role examples",
      nextMoveType: snapshot.savedJobs.length >= 10 ? "wait" : "learning",
      evidence: [`${snapshot.savedJobs.length} saved/open roles`],
      nextMoves: snapshot.savedJobs.length >= 10 ? ["summarise role patterns"] : ["save one role from an asset-backed search", "compare two role descriptions"],
    },
    {
      name: "Network",
      status: networkStarted ? "active" : "underdeveloped",
      progress: networkStarted ? "early" : "not_started",
      bottleneck: networkStarted ? "needs active conversations or replies" : "few warm conversations created",
      nextMoveType: "relationship",
      evidence: [snapshot.hasNetworkTask ? "network task exists" : "no clear network task", snapshot.assets.some((a) => a.kind === "network") ? "network assets available" : "no explicit network assets"],
      nextMoves: ["find one warm-network person", "draft one reality-check message", "send or save one soft ask"],
    },
    {
      name: "Positioning",
      status: snapshot.directionReady ? "active" : "premature",
      progress: snapshot.directionReady ? "early" : "not_started",
      bottleneck: snapshot.directionReady ? "story needs to connect assets to the chosen lane" : "target lane is not clear enough",
      nextMoveType: snapshot.directionReady ? "preparation" : "wait",
      evidence: [snapshot.directionReady ? "some direction signal exists" : "direction still unclear"],
      nextMoves: snapshot.directionReady ? ["write one rough positioning sentence", "map one asset to one role requirement"] : ["wait until more role signal exists"],
    },
    {
      name: "Proof",
      status: snapshot.proofStarted ? "active" : snapshot.directionReady ? "underdeveloped" : "premature",
      progress: snapshot.proofStarted ? "early" : "not_started",
      bottleneck: snapshot.proofStarted ? "proof gaps need evidence or examples" : snapshot.directionReady ? "top proof gaps not yet identified" : "premature until direction has signal",
      nextMoveType: snapshot.proofStarted || snapshot.directionReady ? "preparation" : "wait",
      evidence: [snapshot.deconstructionCommits ? `${snapshot.deconstructionCommits} role deconstruction tasks committed` : "no role deconstruction commitments", hasSignal(snapshot.feedbackSummary, "gap") ? "gap feedback exists" : "no explicit proof-gap feedback"],
      nextMoves: snapshot.proofStarted || snapshot.directionReady ? ["identify one proof gap", "rewrite one CV bullet", "find evidence for one requirement"] : ["wait until role signal exists"],
    },
    {
      name: "Applications",
      status: snapshot.applicationsReady || snapshot.hasApplicationTask ? "active" : "premature",
      progress: snapshot.hasApplicationTask ? "early" : "not_started",
      bottleneck: snapshot.interviewingJobs > 0 ? "live roles are in play and need selective preparation" : snapshot.applicationsReady ? "needs selective execution" : "direction and proof are not ready enough for broad applications",
      nextMoveType: snapshot.applicationsReady ? "execution" : "wait",
      evidence: [snapshot.hasApplicationTask ? "application-related task exists" : "no active application task", snapshot.applicationsReady ? "direction/proof signals exist" : "direction/proof gates incomplete"],
      nextMoves: snapshot.interviewingJobs > 0 ? ["review the strongest live role", "extract likely interview themes", "map your best examples to that role"] : snapshot.applicationsReady ? ["tailor one CV bullet", "prepare one application", "send one warm follow-up"] : ["do not mass apply yet"],
    },
    {
      name: "Interview readiness",
      status: snapshot.interviewingJobs > 0 ? "active" : snapshot.applicationsReady ? "underdeveloped" : "premature",
      progress: snapshot.interviewingJobs > 0 ? "early" : "not_started",
      bottleneck: snapshot.interviewingJobs > 0 ? "interview stories and role-specific examples need tightening" : snapshot.applicationsReady ? "no live interview yet, but prep assets are still thin" : "premature until live roles exist",
      nextMoveType: snapshot.interviewingJobs > 0 ? "preparation" : "wait",
      evidence: [snapshot.interviewingJobs ? `${snapshot.interviewingJobs} interviewing role(s)` : "no interviewing roles yet"],
      nextMoves: snapshot.interviewingJobs > 0 ? ["prepare 3 evidence-backed stories", "simulate one interview answer", "review the company and role thesis"] : ["wait until a live interview exists"],
    },
    {
      name: "Capability ramp",
      status: snapshot.directionReady || snapshot.interviewingJobs > 0 ? (snapshot.activeLearnCount > 0 || snapshot.evidencedLearnCount > 0 ? "active" : "underdeveloped") : "premature",
      progress: snapshot.evidencedLearnCount > 0 ? "developing" : snapshot.activeLearnCount > 0 ? "early" : "not_started",
      bottleneck: snapshot.interviewingJobs > 0 ? "interview and role preparation need capability-linked practice outputs" : snapshot.directionReady ? "target lane still needs a role-relevant capability plan" : "premature until the target lane is clearer",
      nextMoveType: snapshot.directionReady || snapshot.interviewingJobs > 0 ? "learning" : "wait",
      evidence: [
        snapshot.activeLearnCount ? `${snapshot.activeLearnCount} active learning item(s)` : "no active learning items",
        snapshot.evidencedLearnCount ? `${snapshot.evidencedLearnCount} evidenced learning output(s)` : "no evidenced learning outputs",
        snapshot.learningOutputGapCount ? `${snapshot.learningOutputGapCount} learning item(s) still need an output` : "learning outputs are in better shape",
      ],
      nextMoves: snapshot.directionReady || snapshot.interviewingJobs > 0
        ? ["choose one role-relevant capability to strengthen", "convert one learning item into a reusable interview/job artifact", "practice one scenario or framework"]
        : ["wait until the target lane is clearer"],
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

function recommendedFocus(workstreams: WorkstreamState[], phase: GoalPhase) {
  const priorityByPhase: Record<GoalPhase, string[]> = {
    "fit-discovery": ["Direction", "Market map", "Network", "Energy and stability"],
    "lane-narrowing": ["Direction", "Positioning", "Market map", "Network", "Energy and stability"],
    "role-targeting": ["Applications", "Proof", "Positioning", "Network", "Capability ramp", "Energy and stability"],
    "interview-prep": ["Interview readiness", "Capability ramp", "Proof", "Applications", "Energy and stability"],
  };
  return priorityByPhase[phase]
    .map((name) => workstreams.find((w) => w.name === name))
    .find((w) => w && ["underdeveloped", "active", "stale", "blocked"].includes(w.status) && w.nextMoveType !== "wait") || workstreams[0];
}

function dayTypeFor(focus: WorkstreamState) {
  if (focus.nextMoveType === "learning") return "signal-building";
  if (focus.nextMoveType === "relationship") return "network-building";
  if (focus.nextMoveType === "preparation") return "proof-building";
  if (focus.nextMoveType === "execution") return "conversion";
  return "stabilising";
}

function phaseObjective(phase: GoalPhase) {
  if (phase === "fit-discovery") return "identify role families that genuinely fit your interests, goals, and energy";
  if (phase === "lane-narrowing") return "decide which promising lane deserves focused testing before over-investing in applications";
  if (phase === "role-targeting") return "convert the chosen lane into live roles, selective applications, and stronger proof";
  return "prepare to perform strongly in the interview and strengthen the capabilities the role will demand";
}

function phaseReason(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot) {
  if (phase === "lane-narrowing" && snapshot.roleHypotheses.length >= 2) {
    return `You have multiple plausible lanes in play (${snapshot.roleHypotheses.join(" vs ")}). Anchor should narrow before it overcommits.`;
  }
  if (phase === "interview-prep") {
    return `A live interview path exists, so the bottleneck shifts from generic exploration to interview and role readiness.`;
  }
  return `${focus.name} is the current bottleneck: ${focus.bottleneck}.`;
}

function phaseDecisionQuestion(phase: GoalPhase, snapshot: GoalSnapshot) {
  if (phase === "fit-discovery") return "What kinds of work actually fit your interests, goals, and energy well enough to test in the market?";
  if (phase === "lane-narrowing") {
    if (snapshot.roleHypotheses.length >= 2) return `Which lane deserves the next focused test: ${snapshot.roleHypotheses[0]} or ${snapshot.roleHypotheses[1]}?`;
    return "Which promising role lane deserves focused testing next?";
  }
  if (phase === "role-targeting") return "Which specific role family should you convert first?";
  return "What stories, knowledge, and capabilities will make you strong in the interview and in the role?";
}

function trajectoryFor(phase: GoalPhase): GoalTrajectoryStep[] {
  const order: GoalTrajectoryStep["key"][] = ["discover-fit", "narrow-lane", "target-role", "prepare-interview", "capability-ramp"];
  const currentIndex = phase === "fit-discovery" ? 0 : phase === "lane-narrowing" ? 1 : phase === "role-targeting" ? 2 : 3;
  const titles: Record<GoalTrajectoryStep["key"], Omit<GoalTrajectoryStep, "status">> = {
    "discover-fit": { key: "discover-fit", title: "Discover fit", description: "Figure out which kinds of roles genuinely fit your interests, strengths, and goals." },
    "narrow-lane": { key: "narrow-lane", title: "Narrow the lane", description: "Compare promising lanes and choose which one deserves focused testing next." },
    "target-role": { key: "target-role", title: "Target live roles", description: "Turn the chosen lane into real roles, proof, and selective applications." },
    "prepare-interview": { key: "prepare-interview", title: "Prepare for interviews", description: "Build stories, examples, and role knowledge for live interview processes." },
    "capability-ramp": { key: "capability-ramp", title: "Build job-ready capability", description: "Upskill for the interview and the role so you can perform strongly once in seat." },
  };
  return order.map((key, index) => ({
    ...titles[key],
    status: index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending",
  }));
}

function buildTodayPlan(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot, candidateUniverse: ReturnType<typeof generateCandidateUniverse>) {
  if (phase === "lane-narrowing") {
    const left = snapshot.roleHypotheses[0] || "lane one";
    const right = snapshot.roleHypotheses[1] || "lane two";
    return {
      mustDo: `Compare ${left} vs ${right} against fit, energy, and long-term goals`,
      next: "Save one real role example from each lane and note what excites or drains you",
      optional: "Ask one warm contact which lane looks stronger from the outside",
      stopRule: "Stop after one real comparison and one decision note; do not spiral into endless browsing.",
    };
  }
  if (phase === "fit-discovery") {
    return {
      mustDo: focus.nextMoves[0] || candidateUniverse.recommended?.createsTaskTitle || "Inspect one plausible role family",
      next: focus.nextMoves[1] || "Write down what energises you and what you do not want",
      optional: "Capture one emerging hypothesis, even if it is rough",
      stopRule: "Stop after one useful signal or 20 minutes.",
    };
  }
  if (phase === "interview-prep") {
    return {
      mustDo: "Prepare 3 evidence-backed stories for the most likely interview themes",
      next: "Review the role and company thesis and write one sharp answer for why this role fits",
      optional: "Convert one learning item into a job-relevant note, framework, or practice answer",
      stopRule: "Stop once the interview packet is stronger than it was before.",
    };
  }
  return {
    mustDo: focus.nextMoves[0] || candidateUniverse.recommended?.createsTaskTitle || "Convert one live role into the next concrete move",
    next: focus.nextMoves[1] || candidateUniverse.recommended?.activity || "Strengthen one proof or positioning asset",
    optional: focus.name === "Energy and stability" ? "Stop after the minimum viable action" : "Do one small maintenance action so the day stays sustainable",
    stopRule: focus.nextMoveType === "learning" ? "Stop after one useful signal or 20 minutes." : "Stop once the defined small action is complete.",
  };
}

export function buildCareerGoalState(tasks: Task[], jobs: Job[], log: ActivityLog[], learn: Learn[] = []) {
  const snapshot = buildGoalSnapshot(tasks, jobs, log, learn);
  const workstreams = workstreamStates(snapshot);
  const phase = inferGoalPhase(snapshot);
  const focus = recommendedFocus(workstreams, phase);
  const candidateUniverse = generateCandidateUniverse(tasks, jobs, snapshot.assets, snapshot.feedback);

  return {
    goal: "Find the right role, then become interview- and job-ready",
    status: "active",
    objective: phaseObjective(phase),
    phase,
    dayType: dayTypeFor(focus),
    recommendedFocus: focus.name,
    reason: phaseReason(phase, focus, snapshot),
    decisionQuestion: phaseDecisionQuestion(phase, snapshot),
    roleHypotheses: snapshot.roleHypotheses,
    trajectory: trajectoryFor(phase),
    workstreams,
    todayPlan: buildTodayPlan(phase, focus, snapshot, candidateUniverse),
    trace: [
      "Read career assets, saved jobs, learning items, tasks, role feedback, and activity history.",
      `Current phase is ${phase}.`,
      `Selected ${focus.name} because ${focus.bottleneck}.`,
      `Day type is ${dayTypeFor(focus)}.`,
      "Today plan is a small surface of the goal state, not the whole goal.",
    ],
  };
}

export function registerGoalStateRoutes(app: Express) {
  app.get("/api/goals/state", async (_req, res) => {
    const [tasks, jobs, log, learn] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog(), storage.getLearn()]);
    res.json({ goals: [buildCareerGoalState(tasks, jobs, log, learn)] });
  });
}
