import type { Express } from "express";
import { GOAL_WORKSTREAM, type GoalWorkstreamName } from "@shared/goalWorkstreams";
import type { ActivityLog, CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { db, storage } from "./storage";
import { and, desc, eq } from "drizzle-orm";
import { activityLog, careerTracks, contacts, hustles, jobs, learn, tasks } from "@shared/schema";
import { activityImpact, activityTypeLabels } from "@shared/activityTaxonomy";
import { evaluateTaskImpact } from "./brain";
import { getTrackId, isJobLive, isContactWarm, taskCombination } from "@shared/domainState";

export type GoalPhase =
  | "direction-setting"
  | "role-targeting"
  | "lane-narrowing"
  | "pipeline-building"
  | "interview-prep";

export type DecisionMode = "single-track" | "parallel-exploration" | "broad-parallel-pursuit";
export type DayType = "pipeline-day" | "proof-day" | "network-day" | "focus-day";

type OpportunityStateKind = "idle" | "prospecting" | "applied" | "interviewing";
type OpportunityBlocker = "no-live-roles" | "low-fit" | "materials-gap" | "pipeline-thin" | "interview-prep" | "none";

type JobTruthAction = "save-role" | "prep-materials" | "apply" | "follow-up" | "interview-prepare";

type JobTruthStrip = {
  title: string;
  company: string;
  action: JobTruthAction;
};

type GoalSnapshot = {
  assets: ReturnType<typeof careerAssetsFromActivity>;
  feedback: ReturnType<typeof attributeFeedbackFromActivity>;
  feedbackSummary: ReturnType<typeof attributeFeedbackSummary>;
  savedJobs: Job[];
  activeTracks: CareerTrack[];
  careerTasks: Task[];
  candidateCommits: number;
  deconstructionCommits: number;
  roleFeedbackCount: number;
  hasNetworkTask: boolean;
  openContacts: Contact[];
  networkContactsCount: number;
  activeConversationCount: number;
  warmContactCount: number;
  roleLinkedContactCount: number;
  dueFollowUpCount: number;
  draftedContactCount: number;
  hasApplicationTask: boolean;
  activeOpportunityCount: number;
  viableApplicationCount: number;
  applicationActionCounts: Record<JobTruthAction, number>;
  opportunityStateKind: OpportunityStateKind;
  dominantOpportunityBlocker: OpportunityBlocker;
  leadApplicationTruth: JobTruthStrip | null;
  hasProofTask: boolean;
  proofSupportDemandCount: number;
  liveProofAssetCount: number;
  outlinedProofAssetCount: number;
  activeHustleItems: Hustle[];
  activeLearnItems: Learn[];
  activeLearnCount: number;
  evidencedLearnCount: number;
  learningOutputGapCount: number;
  interviewingJobs: number;
  roleHypotheses: string[];
  topicHypotheses: string[];
  roleShapeHypotheses: string[];
  directionReady: boolean;
  directionStarted: boolean;
};

type OpportunityStateSummary = {
  state: OpportunityStateKind;
  dominantBlocker: OpportunityBlocker;
  summary: string;
  pipeline: {
    savedRoles: number;
    viableRoles: number;
    liveProcesses: number;
    interviews: number;
    activeConversations: number;
  };
  leadTruthStrip: JobTruthStrip | null;
};

type LearningStateSummary = {
  summary: string;
  activeItems: number;
  evidenceBackedItems: number;
  outputGapCount: number;
};

type ProofStateSummary = {
  summary: string;
  liveAssets: number;
  outlineCount: number;
  demandCount: number;
};

type WorkstreamState = {
  name: GoalWorkstreamName;
  status: "healthy" | "weak" | "missing";
  summary: string;
};

type CareerGoalFrame = {
  phase: GoalPhase;
  focus: GoalWorkstreamName;
  parallelExperiments: string[];
  broadParallelPursuit: boolean;
  dayType: DayType;
  decisionMode: DecisionMode;
  landingPriority: string;
  selectionRule: string;
};

type GoalState = {
  phase: GoalPhase;
  focus: GoalWorkstreamName;
  dayType: DayType;
  decisionMode: DecisionMode;
  landingPriority: string;
  selectionRule: string;
  contextReason: string;
  opportunityState: OpportunityStateSummary;
  learningState: LearningStateSummary;
  proofState: ProofStateSummary;
  workstreams: WorkstreamState[];
  parallelExperiments: string[];
};

const LOCATION_PRIORITY = ["UAE", "Remote", "London"] as const;

type LocationTier = (typeof LOCATION_PRIORITY)[number] | "Other";

function normalizeText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function hasAny(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function countEvents(log: ActivityLog[], eventType: string) {
  return log.filter((e) => e.eventType === eventType).length;
}

function locationTier(location: string): LocationTier {
  const text = normalizeText(location);
  if (!text.trim()) return "Other";
  if (hasAny(text, ["uae", "dubai", "abu dhabi", "emirates"])) return "UAE";
  if (hasAny(text, ["remote", "worldwide", "anywhere", "distributed"])) return "Remote";
  if (hasAny(text, ["london", "uk", "united kingdom", "britain", "england"])) return "London";
  return "Other";
}

function buildLocationPreference(savedJobs: Job[]) {
  const counts = new Map<LocationTier, number>();
  for (const tier of LOCATION_PRIORITY) counts.set(tier, 0);
  counts.set("Other", 0);
  for (const job of savedJobs) {
    const tier = locationTier(job.location || "");
    counts.set(tier, (counts.get(tier) || 0) + 1);
  }
  const ordered = [...LOCATION_PRIORITY].filter((tier) => (counts.get(tier) || 0) > 0);
  return { counts, ordered };
}

function locationLabel(jobs: Job[]): string {
  const tiers = new Set(jobs.map((j) => locationTier(j.location || "")).filter((t) => t !== "Other"));
  const preferred = [...LOCATION_PRIORITY].filter((t) => tiers.has(t));
  return preferred.length >= 2 ? preferred.join(", ") : [...LOCATION_PRIORITY].join(", ");
}

function careerAssetsFromActivity(log: ActivityLog[]) {
  return {
    candidateCommits: countEvents(log, "candidate_commit"),
    deconstructionCommits: countEvents(log, "deconstruction_commit"),
    roleFeedbackCount: countEvents(log, "role_feedback"),
  };
}

function attributeFeedbackFromActivity(log: ActivityLog[]) {
  return log.filter((entry) => entry.eventType === "role_feedback");
}

function attributeFeedbackSummary(feedback: ReturnType<typeof attributeFeedbackFromActivity>) {
  return {
    count: feedback.length,
    recent: feedback.slice(0, 5).map((entry) => entry.notes || entry.label || entry.eventType),
  };
}

function scoreHypothesesFromText(texts: string[]) {
  const joined = texts.join(" \n ").toLowerCase();
  const scores: Record<string, number> = {
    "AI strategy": 0,
    geopolitics: 0,
    "ops / chief of staff": 0,
  };
  const rules: Array<[string, string[]]> = [
    ["AI strategy", ["ai", "artificial intelligence", "ml", "machine learning", "frontier model", "llm", "alignment", "policy"]],
    ["geopolitics", ["geopolitics", "foreign policy", "national security", "defence", "middle east", "government", "public policy"]],
    ["ops / chief of staff", ["operations", "chief of staff", "bizops", "business operations", "program manager", "strategy and operations"]],
  ];
  for (const [label, terms] of rules) {
    for (const term of terms) {
      if (joined.includes(term)) scores[label] += 1;
    }
  }
  return Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
}

function inferGoalPhase(snapshot: GoalSnapshot): GoalPhase {
  if (!snapshot.directionStarted) return "direction-setting";
  if (snapshot.interviewingJobs > 0) return "interview-prep";
  if (snapshot.activeOpportunityCount === 0) {
    if (snapshot.directionReady) return "role-targeting";
    return "lane-narrowing";
  }
  if (snapshot.viableApplicationCount < 3) return "pipeline-building";
  return "pipeline-building";
}

function hasBroadParallelLanes(snapshot: GoalSnapshot) {
  const locationPreference = buildLocationPreference(snapshot.savedJobs);
  return snapshot.savedJobs.length >= 6
    && locationPreference.ordered.length >= 2
    && snapshot.roleHypotheses.length >= 2;
}

function buildParallelExperiments(snapshot: GoalSnapshot) {
  const topics = snapshot.topicHypotheses.slice(0, 2);
  const shapes = snapshot.roleShapeHypotheses.slice(0, 2);
  const experiments: string[] = [];
  for (const topic of topics) {
    for (const shape of shapes) {
      experiments.push(`${shape} x ${topic}`);
    }
  }
  return experiments.slice(0, 4);
}

function recommendedFocus(workstreams: WorkstreamState[], phase: GoalPhase, snapshot: GoalSnapshot): GoalWorkstreamName {
  if (phase === "interview-prep") return GOAL_WORKSTREAM.INTERVIEWING;
  const weakest = workstreams.find((w) => w.status !== "healthy");
  if (weakest) return weakest.name;
  if (phase === "role-targeting") return GOAL_WORKSTREAM.PIPELINE;
  return GOAL_WORKSTREAM.DIRECTION;
}

function dayTypeFor(focus: GoalWorkstreamName): DayType {
  if (focus === GOAL_WORKSTREAM.PIPELINE) return "pipeline-day";
  if (focus === GOAL_WORKSTREAM.PROOF) return "proof-day";
  if (focus === GOAL_WORKSTREAM.NETWORK) return "network-day";
  return "focus-day";
}

function buildCareerGoalFrame(snapshot: GoalSnapshot, workstreams: WorkstreamState[]) {
  const phase = inferGoalPhase(snapshot);
  const focus = recommendedFocus(workstreams, phase, snapshot);
  const parallelExperiments = phase === "lane-narrowing" && snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2
    ? buildParallelExperiments(snapshot)
    : [];
  const broadParallelPursuit = phase === "role-targeting" && hasBroadParallelLanes(snapshot);
  const decisionMode: DecisionMode = broadParallelPursuit
    ? "broad-parallel-pursuit"
    : phase === "lane-narrowing" || parallelExperiments.length
      ? "parallel-exploration"
      : "single-track";
  const landingPriority = broadParallelPursuit ? "credible-role-quickly" : phase === "lane-narrowing" ? "best-fit-with-live-signal" : "best-fit-over-time";
  const selectionRule = broadParallelPursuit
    ? `Take any credible role that can land soon across ${locationLabel(snapshot.savedJobs)}; keep stronger-fit alternatives warm in parallel.`
    : phase === "lane-narrowing"
      ? "Keep plausible paths alive in parallel until live evidence clearly separates them."
      : "Prefer the strongest live role while keeping adjacent plausible options open until evidence is decisive.";

  return {
    phase,
    focus,
    parallelExperiments,
    broadParallelPursuit,
    dayType: dayTypeFor(focus),
    decisionMode,
    landingPriority,
    selectionRule,
  };
}

function buildOpportunityStateSummary(snapshot: GoalSnapshot): OpportunityStateSummary {
  const savedRoles = snapshot.savedJobs.length;
  const viableRoles = snapshot.viableApplicationCount;
  const liveProcesses = snapshot.activeOpportunityCount;
  const interviews = snapshot.interviewingJobs;
  const activeConversations = snapshot.activeConversationCount;

  const summary = interviews > 0
    ? `You have ${interviews} interview${interviews === 1 ? "" : "s"} in motion.`
    : liveProcesses > 0
      ? `${liveProcesses} live role process${liveProcesses === 1 ? "" : "es"} in motion.`
      : savedRoles > 0
        ? `${savedRoles} saved roles, ${viableRoles} currently viable.`
        : "No live role pipeline yet.";

  return {
    state: snapshot.opportunityStateKind,
    dominantBlocker: snapshot.dominantOpportunityBlocker,
    summary,
    pipeline: { savedRoles, viableRoles, liveProcesses, interviews, activeConversations },
    leadTruthStrip: snapshot.leadApplicationTruth,
  };
}

function buildLearningStateSummary(snapshot: GoalSnapshot): LearningStateSummary {
  return {
    summary: snapshot.activeLearnCount > 0
      ? `${snapshot.activeLearnCount} active learning item${snapshot.activeLearnCount === 1 ? "" : "s"}; ${snapshot.evidencedLearnCount} already evidenced.`
      : "No active learning items.",
    activeItems: snapshot.activeLearnCount,
    evidenceBackedItems: snapshot.evidencedLearnCount,
    outputGapCount: snapshot.learningOutputGapCount,
  };
}

function buildProofStateSummary(snapshot: GoalSnapshot): ProofStateSummary {
  return {
    summary: snapshot.liveProofAssetCount > 0
      ? `${snapshot.liveProofAssetCount} live proof asset${snapshot.liveProofAssetCount === 1 ? "" : "s"}; ${snapshot.outlinedProofAssetCount} outlined.`
      : "No live proof assets yet.",
    liveAssets: snapshot.liveProofAssetCount,
    outlineCount: snapshot.outlinedProofAssetCount,
    demandCount: snapshot.proofSupportDemandCount,
  };
}

function buildWorkstreams(snapshot: GoalSnapshot): WorkstreamState[] {
  const items: WorkstreamState[] = [];
  items.push({
    name: GOAL_WORKSTREAM.DIRECTION,
    status: snapshot.directionReady ? "healthy" : snapshot.directionStarted ? "weak" : "missing",
    summary: snapshot.directionReady ? "Direction is defined." : snapshot.directionStarted ? "Direction exists but still needs narrowing." : "Direction-setting not started.",
  });
  items.push({
    name: GOAL_WORKSTREAM.PIPELINE,
    status: snapshot.activeOpportunityCount > 0 ? "healthy" : snapshot.savedJobs.length > 0 ? "weak" : "missing",
    summary: snapshot.activeOpportunityCount > 0 ? "Live role pipeline exists." : snapshot.savedJobs.length > 0 ? "Saved roles exist but no live pipeline." : "No role pipeline yet.",
  });
  items.push({
    name: GOAL_WORKSTREAM.NETWORK,
    status: snapshot.warmContactCount > 0 ? "healthy" : snapshot.networkContactsCount > 0 ? "weak" : "missing",
    summary: snapshot.warmContactCount > 0 ? "Warm contact support exists." : snapshot.networkContactsCount > 0 ? "Contacts exist but network is still cold." : "No meaningful network support yet.",
  });
  items.push({
    name: GOAL_WORKSTREAM.PROOF,
    status: snapshot.liveProofAssetCount > 0 ? "healthy" : snapshot.outlinedProofAssetCount > 0 ? "weak" : "missing",
    summary: snapshot.liveProofAssetCount > 0 ? "Proof assets are live." : snapshot.outlinedProofAssetCount > 0 ? "Proof exists as outline only." : "No proof assets yet.",
  });
  items.push({
    name: GOAL_WORKSTREAM.LEARNING,
    status: snapshot.evidencedLearnCount > 0 ? "healthy" : snapshot.activeLearnCount > 0 ? "weak" : "missing",
    summary: snapshot.evidencedLearnCount > 0 ? "Learning is producing evidence." : snapshot.activeLearnCount > 0 ? "Learning is active but not yet evidenced." : "No active learning loop yet.",
  });
  items.push({
    name: GOAL_WORKSTREAM.INTERVIEWING,
    status: snapshot.interviewingJobs > 0 ? "healthy" : "missing",
    summary: snapshot.interviewingJobs > 0 ? "Interview prep matters now." : "No interview process currently active.",
  });
  return items;
}

function laneNarrowingTwoAxisReason(topics: string[], roleShapes: string[]) {
  return `Your direction is still separating along two axes — topics (${topics.slice(0, 2).join(", ")}) and role shapes (${roleShapes.slice(0, 2).join(", ")}). Anchor should keep the strongest combinations live until evidence breaks the tie.`;
}

function laneNarrowingSingleAxisReason(roles: string[]) {
  return `You have multiple plausible role hypotheses (${roles.slice(0, 3).join(", ")}). Keep them active in parallel until real role signal separates them.`;
}

function interviewPrepReason() {
  return "You already have interview signal, so the system should optimise for conversion — concrete stories, company-specific prep, and de-risking gaps.";
}

function broadPursuitMissingRolesContextReason(missing: string[], action: string) {
  return `You need a job, so Anchor should ${action}. The current role mix is still missing plausible lanes: ${missing.join(", ")}.`;
}

function broadPursuitMissingSupportContextReason(missingNetworkSupport: string[], missingPrepSupport: string[]) {
  const parts = [];
  if (missingNetworkSupport.length) parts.push(`network support missing for ${missingNetworkSupport.join(", ")}`);
  if (missingPrepSupport.length) parts.push(`prep support missing for ${missingPrepSupport.join(", ")}`);
  return `You need a job, but parallel lanes are under-supported: ${parts.join("; ")}. Anchor should close support gaps rather than collapse options too early.`;
}

function buildBroadPursuitCoverage(snapshot: GoalSnapshot) {
  const combinations = Array.from(new Set(snapshot.savedJobs.map((job) => taskCombination(job.title, snapshot.activeTracks)))).filter(Boolean) as string[];
  const covered = combinations;
  const missing = snapshot.roleHypotheses.filter((role) => !covered.includes(role));
  const networkSupported = combinations.filter(() => snapshot.warmContactCount > 0);
  const prepSupported = combinations.filter(() => snapshot.deconstructionCommits > 0 || snapshot.candidateCommits > 0);
  const learningSupported = combinations.filter(() => snapshot.evidencedLearnCount > 0);
  const exampleProjectSupported = combinations.filter(() => snapshot.liveProofAssetCount > 0);
  const missingNetworkSupport = combinations.filter((c) => !networkSupported.includes(c));
  const missingPrepSupport = combinations.filter((c) => !prepSupported.includes(c));
  const missingLearningSupport = combinations.filter((c) => !learningSupported.includes(c));
  const fullySupported = combinations.filter((c) => networkSupported.includes(c) && prepSupported.includes(c));
  const laneStates = combinations.map((combination) => ({
    combination,
    jobCount: snapshot.savedJobs.filter((job) => taskCombination(job.title, snapshot.activeTracks) === combination).length,
    taskCount: snapshot.careerTasks.filter((task) => taskCombination(task.title, snapshot.activeTracks) === combination).length,
    learningItemCount: snapshot.activeLearnItems.filter((item) => taskCombination(item.title, snapshot.activeTracks) === combination).length,
    exampleProjectItemCount: snapshot.activeHustleItems.filter((item) => taskCombination(item.title, snapshot.activeTracks) === combination).length,
    hasRole: covered.includes(combination),
    hasNetworkSupport: networkSupported.includes(combination),
    hasPrepSupport: prepSupported.includes(combination),
    hasLearningSupport: learningSupported.includes(combination),
    hasExampleProjectSupport: exampleProjectSupported.includes(combination),
  }));
  return { combinations, covered, missing, networkSupported, prepSupported, learningSupported, exampleProjectSupported, missingNetworkSupport, missingPrepSupport, missingLearningSupport, fullySupported, laneStates };
}

function buildContextReason(snapshot: GoalSnapshot, phase: GoalPhase) {
  if (phase === "role-targeting") {
    const coverage = buildBroadPursuitCoverage(snapshot);
    if (coverage.missing.length > 0) {
      return snapshot.savedJobs.length > 0
        ? broadPursuitMissingRolesContextReason(coverage.missing, "keep multiple plausible paths open while converting the most credible live roles")
        : broadPursuitMissingRolesContextReason(coverage.missing, "open multiple plausible paths in parallel and turn them into live roles");
    }
    if (coverage.missingNetworkSupport.length > 0 || coverage.missingPrepSupport.length > 0) {
      return broadPursuitMissingSupportContextReason(
        coverage.missingNetworkSupport,
        coverage.missingPrepSupport,
      );
    }
    return snapshot.savedJobs.length > 0
      ? `You need a job, so Anchor should keep multiple plausible paths open in parallel and convert the most credible live roles instead of forcing an early identity choice. Location stays flexible across ${locationLabel(snapshot.savedJobs)}.`
      : `You need a job, so Anchor should open multiple plausible paths in parallel and turn them into live roles instead of forcing an early identity choice. Location stays flexible across ${locationLabel(snapshot.savedJobs)}.`;
  }
  if (phase === "lane-narrowing" && snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) {
    return laneNarrowingTwoAxisReason(snapshot.topicHypotheses, snapshot.roleShapeHypotheses);
  }
  if (phase === "lane-narrowing" && snapshot.roleHypotheses.length >= 2) {
    return laneNarrowingSingleAxisReason(snapshot.roleHypotheses);
  }
  if (phase === "interview-prep") {
    return interviewPrepReason();
  }
  if (phase === "pipeline-building") {
    return "Direction exists, but the immediate bottleneck is pipeline depth. Anchor should bias toward live applications, follow-ups, and role-conversion work.";
  }
  return "You are still setting direction. Anchor should prioritise evidence-building, role pattern recognition, and narrowing experiments over applications.";
}

export async function deriveGoalState(): Promise<GoalState> {
  const [savedJobs, activeTracks, careerTasks, openContacts, activeHustleItems, activeLearnItems, log] = await Promise.all([
    storage.getJobs(),
    storage.getCareerTracks(),
    storage.getTasks(),
    storage.getContacts(),
    storage.getHustles(),
    storage.getLearn(),
    storage.getActivityLog(),
  ]);

  const activeTrackList = activeTracks.filter((track) => track.status !== "archived");
  const activeTaskList = careerTasks.filter((task) => !task.done);
  const activeContacts = openContacts.filter((contact) => !contact.archived);
  const activeHustles = activeHustleItems.filter((item) => item.stage !== "done" && item.stage !== "abandoned");
  const activeLearns = activeLearnItems.filter((item) => item.active && !item.done);

  const assets = careerAssetsFromActivity(log);
  const feedback = attributeFeedbackFromActivity(log);
  const feedbackSummary = attributeFeedbackSummary(feedback);

  const activeOpportunityCount = savedJobs.filter(isJobLive).length;
  const interviewingJobs = savedJobs.filter((job) => normalizeText(job.status || "").includes("interview")).length;
  const viableApplicationCount = savedJobs.filter((job) => ["saved", "applied", "interview"].includes((job.status || "").toLowerCase())).length;
  const activeConversationCount = activeContacts.filter((contact) => (contact.relationshipStatus || "").toLowerCase() === "active").length;
  const warmContactCount = activeContacts.filter(isContactWarm).length;
  const roleLinkedContactCount = activeContacts.filter((contact) => !!contact.roleTarget).length;
  const dueFollowUpCount = activeContacts.filter((contact) => !!contact.nextFollowUpAt).length;
  const draftedContactCount = activeContacts.filter((contact) => !!contact.messageDraft).length;
  const activeLearnCount = activeLearns.length;
  const evidencedLearnCount = activeLearns.filter((item) => !!item.evidenceLink || !!item.outputNote).length;
  const learningOutputGapCount = activeLearns.filter((item) => !item.evidenceLink && !item.outputNote).length;
  const liveProofAssetCount = activeHustles.filter((item) => item.stage === "live").length;
  const outlinedProofAssetCount = activeHustles.filter((item) => item.stage === "outline").length;
  const proofSupportDemandCount = savedJobs.filter((job) => !!job.workSampleNeeded || !!job.note?.toLowerCase().includes("portfolio") || !!job.note?.toLowerCase().includes("case study")).length;

  const roleTexts = [
    ...savedJobs.map((job) => [job.title, job.roleArchetype, job.jdText, job.note].filter(Boolean).join(" ")),
    ...activeTrackList.map((track) => [track.name, track.description].filter(Boolean).join(" ")),
  ];
  const roleHypotheses = scoreHypothesesFromText(roleTexts);
  const topicHypotheses = roleHypotheses.filter((h) => h === "AI strategy" || h === "geopolitics");
  const roleShapeHypotheses = roleHypotheses.filter((h) => h === "ops / chief of staff");

  const directionStarted = activeTrackList.length > 0 || savedJobs.length > 0;
  const directionReady = roleHypotheses.length > 0 || savedJobs.length >= 3;

  const opportunityStateKind: OpportunityStateKind = interviewingJobs > 0
    ? "interviewing"
    : activeOpportunityCount > 0
      ? "applied"
      : savedJobs.length > 0
        ? "prospecting"
        : "idle";

  const dominantOpportunityBlocker: OpportunityBlocker = interviewingJobs > 0
    ? "interview-prep"
    : savedJobs.length === 0
      ? "no-live-roles"
      : viableApplicationCount === 0
        ? "low-fit"
        : activeOpportunityCount === 0
          ? "pipeline-thin"
          : "none";

  const leadJob = savedJobs[0];
  const leadApplicationTruth: JobTruthStrip | null = leadJob
    ? {
        title: leadJob.title,
        company: leadJob.company,
        action: interviewingJobs > 0 ? "interview-prepare" : activeOpportunityCount > 0 ? "follow-up" : "prep-materials",
      }
    : null;

  const applicationActionCounts: Record<JobTruthAction, number> = {
    "save-role": savedJobs.filter((j) => (j.status || "").toLowerCase() === "saved").length,
    "prep-materials": savedJobs.filter((j) => (j.status || "").toLowerCase() === "materials").length,
    apply: savedJobs.filter((j) => (j.status || "").toLowerCase() === "ready").length,
    "follow-up": savedJobs.filter((j) => (j.status || "").toLowerCase() === "applied").length,
    "interview-prepare": savedJobs.filter((j) => normalizeText(j.status || "").includes("interview")).length,
  };

  const snapshot: GoalSnapshot = {
    assets,
    feedback,
    feedbackSummary,
    savedJobs,
    activeTracks: activeTrackList,
    careerTasks: activeTaskList,
    candidateCommits: assets.candidateCommits,
    deconstructionCommits: assets.deconstructionCommits,
    roleFeedbackCount: feedbackSummary.count,
    hasNetworkTask: activeTaskList.some((task) => normalizeText(task.title).includes("reach out") || normalizeText(task.title).includes("follow up")),
    openContacts: activeContacts,
    networkContactsCount: activeContacts.length,
    activeConversationCount,
    warmContactCount,
    roleLinkedContactCount,
    dueFollowUpCount,
    draftedContactCount,
    hasApplicationTask: activeTaskList.some((task) => normalizeText(task.title).includes("apply") || normalizeText(task.title).includes("cover letter")),
    activeOpportunityCount,
    viableApplicationCount,
    applicationActionCounts,
    opportunityStateKind,
    dominantOpportunityBlocker,
    leadApplicationTruth,
    hasProofTask: activeTaskList.some((task) => normalizeText(task.title).includes("case study") || normalizeText(task.title).includes("portfolio") || normalizeText(task.title).includes("memo")),
    proofSupportDemandCount,
    liveProofAssetCount,
    outlinedProofAssetCount,
    activeHustleItems: activeHustles,
    activeLearnItems: activeLearns,
    activeLearnCount,
    evidencedLearnCount,
    learningOutputGapCount,
    interviewingJobs,
    roleHypotheses,
    topicHypotheses,
    roleShapeHypotheses,
    directionReady,
    directionStarted,
  };

  const workstreams = buildWorkstreams(snapshot);
  const frame = buildCareerGoalFrame(snapshot, workstreams);

  return {
    phase: frame.phase,
    focus: frame.focus,
    dayType: frame.dayType,
    decisionMode: frame.decisionMode,
    landingPriority: frame.landingPriority,
    selectionRule: frame.selectionRule,
    contextReason: buildContextReason(snapshot, frame.phase),
    opportunityState: buildOpportunityStateSummary(snapshot),
    learningState: buildLearningStateSummary(snapshot),
    proofState: buildProofStateSummary(snapshot),
    workstreams,
    parallelExperiments: frame.parallelExperiments,
  };
}

export function registerGoalStateRoutes(app: Express) {
  app.get("/api/goal-state", async (_req, res) => {
    try {
      const state = await deriveGoalState();
      res.json(state);
    } catch (error) {
      res.status(500).json({ error: "failed_to_derive_goal_state" });
    }
  });
}
