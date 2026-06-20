import type { Express } from "express";
import { GOAL_WORKSTREAM, type GoalWorkstreamName } from "@shared/goalWorkstreams";
import type { ActivityLog, CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { storage } from "./storage";
import { attributeFeedbackFromActivity, attributeFeedbackSummary, careerAssetsFromActivity, generateCandidateUniverse } from "./candidates";
import { computeJobTruthStrip, type JobTruthAction, type JobTruthStrip } from "./jobTruth";
import {
  broadPursuitMissingRolesDecisionQuestion,
  broadPursuitMissingRolesContextReason,
  broadPursuitNextMissingRolePlanNote,
  broadPursuitNextMissingRoleStopRule,
  broadPursuitNextMissingRoleTodayMustDo,
  broadPursuitNextMissingContactStopRule,
  broadPursuitNextMissingContactTodayMustDo,
  broadPursuitNextMissingPrepStopRule,
  broadPursuitNextMissingPrepTodayMustDo,
  broadPursuitMissingSupportDecisionQuestion,
  broadPursuitMissingSupportContextReason,
  broadPursuitMissingSupportTodayMustDo,
  broadPursuitMissingSupportStopRule,
} from "./broadPursuitCopy";
import {
  fitDiscoveryDecisionQuestion,
  fitDiscoveryTodayMustDo,
  fitDiscoveryTodayNext,
  fitDiscoveryTodayOptional,
  fitDiscoveryTodayStopRule,
  interviewPrepDecisionQuestion,
  interviewPrepReason,
  interviewPrepTodayMustDo,
  interviewPrepTodayNext,
  interviewPrepTodayOptional,
  interviewPrepTodayStopRule,
  laneNarrowingSingleAxisDecisionQuestion,
  laneNarrowingSingleAxisReason,
  laneNarrowingSingleAxisTodayMustDo,
  laneNarrowingSingleAxisTodayNext,
  laneNarrowingSingleAxisTodayOptional,
  laneNarrowingSingleAxisTodayStopRule,
  laneNarrowingTwoAxisDecisionQuestion,
  laneNarrowingTwoAxisReason,
  laneNarrowingTwoAxisTodayMustDo,
  laneNarrowingTwoAxisTodayNext,
  laneNarrowingTwoAxisTodayOptional,
  laneNarrowingTwoAxisTodayStopRule,
} from "./explorationCopy";

type WorkstreamStatus = "active" | "underdeveloped" | "premature" | "blocked" | "stale" | "sufficient_for_now";
type NextMoveType = "research" | "learning" | "relationship" | "preparation" | "execution" | "maintenance" | "wait";
type GoalPhase = "fit-discovery" | "lane-narrowing" | "role-targeting" | "interview-prep";
type TrajectoryStatus = "complete" | "current" | "pending";
type DecisionMode = "single-track" | "forced-comparison" | "parallel-exploration" | "broad-parallel-pursuit";
type OpportunityStateKind = "empty" | "researching" | "converting" | "interviewing";
type OpportunityBlocker = "targeting" | "clarify" | "access" | "application" | "capability" | "assessment" | "none";
type FocusReasonCode =
  | "target_unclear"
  | "missing_roles"
  | "network_access"
  | "stale_follow_up"
  | "clarify_before_push"
  | "repeated_capability_gap"
  | "live_apply"
  | "live_follow_up"
  | "live_interview"
  | "parallel_support_gap"
  | "general_progress";

type WorkstreamState = {
  name: GoalWorkstreamName;
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

type CombinationTest = {
  combination: string;
  whyPlausible: string;
  nextTest: string;
};

type BroadPursuitCoverage = {
  combinations: string[];
  covered: string[];
  missing: string[];
  networkSupported: string[];
  prepSupported: string[];
  learningSupported: string[];
  exampleProjectSupported: string[];
  missingNetworkSupport: string[];
  missingPrepSupport: string[];
  missingLearningSupport: string[];
  fullySupported: string[];
  laneStates: Array<{
    combination: string;
    roleCount: number;
    contactCount: number;
    prepSupportCount: number;
    learningItemCount: number;
    exampleProjectItemCount: number;
    hasRole: boolean;
    hasNetworkSupport: boolean;
    hasPrepSupport: boolean;
    hasLearningSupport: boolean;
    hasExampleProjectSupport: boolean;
  }>;
};

type LocationPreference = {
  flexible: boolean;
  ordered: string[];
  counts: { preferred: number; acceptable: number; other: number };
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
    dueFollowUps: number;
    apply: number;
    warm: number;
    clarify: number;
    followUp: number;
    prepare: number;
  };
};

const HYPOTHESIS_LABELS = {
  ai_strategy: "AI strategy",
  geopolitics: "Geopolitics / geopolitical advisory",
  policy_advisory: "Policy / advisory",
  operations_strategy: "Strategy / chief of staff / operations",
} as const;

const TOPIC_LABELS = {
  ai: "AI / technology strategy",
  geopolitics: "Geopolitics / geopolitical advisory",
  policy: "Policy / public sector",
} as const;

const ROLE_SHAPE_LABELS = {
  strategy_advisory: "Strategy / advisory",
  ops_cos: "Ops / chief of staff",
  research_analysis: "Research / analysis",
} as const;

const LOCATION_PRIORITY = ["UAE", "Remote", "London"] as const;
const APPLICATION_ACTION_PRIORITY: Record<JobTruthAction, number> = {
  prepare: 100,
  follow_up: 92,
  apply: 84,
  warm: 74,
  prove: 66,
  clarify: 58,
  reject: 0,
};

function opportunityStageFor(input: {
  interviewingJobs: number;
  activeOpportunityCount: number;
  viableApplicationCount: number;
  savedJobsCount: number;
}): OpportunityStateKind {
  if (input.interviewingJobs > 0) return "interviewing";
  if (input.activeOpportunityCount > 0) return "converting";
  if (input.viableApplicationCount > 0 || input.savedJobsCount > 0) return "researching";
  return "empty";
}

function dominantOpportunityBlockerFor(input: {
  state: OpportunityStateKind;
  activeConversationCount: number;
  applicationActionCounts: Record<JobTruthAction, number>;
  viableApplicationCount: number;
  savedJobsCount: number;
}): OpportunityBlocker {
  const { state, activeConversationCount, applicationActionCounts, viableApplicationCount, savedJobsCount } = input;

  if (state === "empty") return "targeting";
  if (applicationActionCounts.prepare > 0 || state === "interviewing") return "assessment";

  const onlyClarify = viableApplicationCount > 0
    && applicationActionCounts.clarify === viableApplicationCount
    && applicationActionCounts.apply === 0
    && applicationActionCounts.warm === 0
    && applicationActionCounts.follow_up === 0
    && applicationActionCounts.prepare === 0;
  if (onlyClarify) return "clarify";

  if (applicationActionCounts.follow_up > 0 || applicationActionCounts.warm > 0) return "access";
  if (applicationActionCounts.apply > 0) return "application";

  const repeatedCapabilityPressure = applicationActionCounts.prove >= 2
    && applicationActionCounts.apply === 0
    && applicationActionCounts.warm === 0
    && applicationActionCounts.follow_up === 0
    && applicationActionCounts.prepare === 0
    && activeConversationCount === 0;
  if (repeatedCapabilityPressure) return "capability";

  if (applicationActionCounts.clarify > 0) return "clarify";
  if (savedJobsCount > 0 && viableApplicationCount === 0) return "targeting";
  return "none";
}

function pipelineActionMix(
  snapshot: Pick<GoalSnapshot, "applicationActionCounts">,
  limit = 3,
) {
  const parts = [
    snapshot.applicationActionCounts.prepare > 0 ? `${snapshot.applicationActionCounts.prepare} interview-prep role${snapshot.applicationActionCounts.prepare === 1 ? "" : "s"}` : "",
    snapshot.applicationActionCounts.follow_up > 0 ? `${snapshot.applicationActionCounts.follow_up} follow-up role${snapshot.applicationActionCounts.follow_up === 1 ? "" : "s"}` : "",
    snapshot.applicationActionCounts.apply > 0 ? `${snapshot.applicationActionCounts.apply} ready-to-apply role${snapshot.applicationActionCounts.apply === 1 ? "" : "s"}` : "",
    snapshot.applicationActionCounts.warm > 0 ? `${snapshot.applicationActionCounts.warm} contact-first role${snapshot.applicationActionCounts.warm === 1 ? "" : "s"}` : "",
    snapshot.applicationActionCounts.clarify > 0 ? `${snapshot.applicationActionCounts.clarify} clarify-first role${snapshot.applicationActionCounts.clarify === 1 ? "" : "s"}` : "",
  ].filter(Boolean).slice(0, limit);
  return parts.length > 0 ? parts.join("; ") : "";
}

function describeOpportunityState(summary: OpportunityStateSummary, snapshot: Pick<GoalSnapshot, "savedJobs" | "viableApplicationCount" | "activeOpportunityCount" | "applicationActionCounts">) {
  if (summary.state === "empty") return "No real opportunities are active yet, so the next step is to create one.";
  if (summary.state === "interviewing") return "A live interview process exists, so preparation has the highest leverage.";
  if (summary.dominantBlocker === "clarify") {
    return `${snapshot.applicationActionCounts.clarify} promising role${snapshot.applicationActionCounts.clarify === 1 ? " still needs" : "s still need"} role-fact clarification before harder pushing makes sense.`;
  }
  if (summary.dominantBlocker === "access") {
    const count = snapshot.applicationActionCounts.follow_up + snapshot.applicationActionCounts.warm;
    return `${count} promising role${count === 1 ? " is" : "s are"} mainly blocked by access, follow-up, or a useful person.`;
  }
  if (summary.dominantBlocker === "application") {
    return `${snapshot.applicationActionCounts.apply} role${snapshot.applicationActionCounts.apply === 1 ? " is" : "s are"} ready for a concrete application move.`;
  }
  if (summary.dominantBlocker === "capability") {
    return `${snapshot.applicationActionCounts.prove} promising role${snapshot.applicationActionCounts.prove === 1 ? " points" : "s point"} to the same weak area, so one strengthening move has reuse across them.`;
  }
  if (summary.state === "researching") {
    const mix = pipelineActionMix(snapshot);
    return snapshot.viableApplicationCount > 0
      ? `${snapshot.viableApplicationCount} viable role${snapshot.viableApplicationCount === 1 ? " is" : "s are"} in view. ${mix ? `${mix}.` : "None are moving yet."}`
      : `${snapshot.savedJobs.length} saved role${snapshot.savedJobs.length === 1 ? "" : "s"} exist, but none are strong enough yet to convert.`;
  }
  if (summary.state === "converting") {
    const mix = pipelineActionMix(snapshot, 2);
    return `${snapshot.activeOpportunityCount} active opportunit${snapshot.activeOpportunityCount === 1 ? "y is" : "ies are"} already in motion.${mix ? ` Current mix: ${mix}.` : ""}`;
  }
  return "The opportunity picture is mixed, so the next move should reduce uncertainty or move the best live role forward.";
}

function isCareerTask(t: Task) {
  return !t.done && (t.category === "job" || /job|career|role|cv|interview|application|network|contact|message|proof|course|learn|skill/i.test(t.title));
}

function openJobs(jobs: Job[]) {
  return jobs.filter((j) => !["closed", "rejected"].includes(j.status || "") && j.applicationWindowStatus !== "closed");
}

function locationTier(location: string) {
  const lower = (location || "").toLowerCase();
  if (/\b(uae|dubai|abu dhabi|emirates)\b/.test(lower)) return "UAE";
  if (/\b(remote|distributed|anywhere|work from home|wfh)\b/.test(lower)) return "Remote";
  if (/\b(london|uk|united kingdom|england)\b/.test(lower)) return "London";
  return "Other";
}

function buildLocationPreference(jobs: Job[]): LocationPreference {
  let preferred = 0;
  let acceptable = 0;
  let other = 0;
  for (const j of jobs) {
    const tier = locationTier(j.location || "");
    if (tier === "Other") other += 1;
    else {
      acceptable += 1;
      if (tier === "UAE" || tier === "Remote" || tier === "London") preferred += 1;
    }
  }
  return {
    flexible: true,
    ordered: [...LOCATION_PRIORITY],
    counts: { preferred, acceptable, other },
  };
}

function countEvents(log: ActivityLog[], eventType: string) {
  return log.filter((e) => e.eventType === eventType).length;
}

function daysUntil(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T23:59:59");
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function calendarDaysUntil(date: string): number | null {
  if (!date) return null;
  const due = new Date(`${date}T12:00:00`);
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  const today = new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T12:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function isOpenContact(c: Contact) {
  return c.status !== "closed";
}

function hasActiveConversation(c: Contact) {
  return c.status === "messaged" || c.status === "replied";
}

function hasDraftedContactMove(c: Contact) {
  return !!((c.messageDraft && c.messageDraft.trim()) || (c.lastMessage && c.lastMessage.trim()));
}

function isWarmContact(c: Contact) {
  return c.relationshipStrength === "warm" || c.relationshipStrength === "strong";
}

function isRoleLinkedContact(c: Contact) {
  return !!((c.targetOrg && c.targetOrg.trim()) || (c.targetRole && c.targetRole.trim()));
}

function isContactFollowUpDue(c: Contact) {
  const due = calendarDaysUntil(c.nextFollowUpDate || "");
  return due !== null && due <= 0;
}

function hasSignal(summary: ReturnType<typeof attributeFeedbackSummary>, reaction: keyof ReturnType<typeof attributeFeedbackSummary>) {
  return summary[reaction]?.length > 0;
}

function addHypothesisScore(scores: Map<string, number>, key: keyof typeof HYPOTHESIS_LABELS, amount = 1) {
  scores.set(key, (scores.get(key) || 0) + amount);
}

function addAxisScore<T extends string>(scores: Map<T, number>, key: T, amount = 1) {
  scores.set(key, (scores.get(key) || 0) + amount);
}

function scoreHypothesesFromText(text: string, scores: Map<string, number>) {
  const lower = text.toLowerCase();
  if (/\b(ai|artificial intelligence|ai governance|tech policy|machine learning|frontier model|safety)\b/.test(lower)) {
    addHypothesisScore(scores, "ai_strategy", 2);
  }
  if (/\b(geopolitic\w*|foreign policy|international|security|middle east|geostrateg\w*|geopolitical risk|risk advisory)\b/.test(lower)) {
    addHypothesisScore(scores, "geopolitics", 2);
  }
  if (/\b(policy|public sector|think tank|government|regulation|public affairs)\b/.test(lower)) {
    addHypothesisScore(scores, "policy_advisory", 1);
  }
  if (/\b(strategy|chief of staff|operations|ops|program management|delivery|partnerships)\b/.test(lower)) {
    addHypothesisScore(scores, "operations_strategy", 1);
  }
}

function scoreTopicHypothesesFromText(text: string, scores: Map<string, number>) {
  const lower = text.toLowerCase();
  if (/\b(ai|artificial intelligence|ai governance|tech policy|machine learning|frontier model|safety)\b/.test(lower)) {
    addAxisScore(scores, "ai", 2);
  }
  if (/\b(geopolitic\w*|foreign policy|international|security|middle east|geostrateg\w*|geopolitical risk|risk advisory)\b/.test(lower)) {
    addAxisScore(scores, "geopolitics", 2);
  }
  if (/\b(policy|public sector|think tank|government|regulation|public affairs)\b/.test(lower)) {
    addAxisScore(scores, "policy", 1);
  }
}

function scoreRoleShapeHypothesesFromText(text: string, scores: Map<string, number>) {
  const lower = text.toLowerCase();
  if (/\b(strategy|advisory|advisor|consult|strategic|risk analyst|analyst)\b/.test(lower)) {
    addAxisScore(scores, "strategy_advisory", 2);
  }
  if (/\b(chief of staff|operations|ops|program management|delivery|partnerships|execution)\b/.test(lower)) {
    addAxisScore(scores, "ops_cos", 2);
  }
  if (/\b(research|analysis|analyst|researcher|insights)\b/.test(lower)) {
    addAxisScore(scores, "research_analysis", 1);
  }
}

function rankedHypotheses<T extends string>(scores: Map<string, number>, labels: Record<T, string>) {
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return ranked
    .filter(([, score]) => score >= 2)
    .map(([key]) => labels[key as T])
    .slice(0, 3);
}

function ensureRoleShapeCoverage(roleHypotheses: string[], topicHypotheses: string[], detectedShapes: string[]) {
  const expanded = [...detectedShapes];
  const hasOpsLane = roleHypotheses.includes(HYPOTHESIS_LABELS.operations_strategy);
  const hasTopicLane = topicHypotheses.length > 0 || roleHypotheses.some((h) => h !== HYPOTHESIS_LABELS.operations_strategy);

  if (hasTopicLane && !expanded.includes(ROLE_SHAPE_LABELS.strategy_advisory)) {
    expanded.push(ROLE_SHAPE_LABELS.strategy_advisory);
  }
  if (hasOpsLane && !expanded.includes(ROLE_SHAPE_LABELS.ops_cos)) {
    expanded.push(ROLE_SHAPE_LABELS.ops_cos);
  }

  return expanded.slice(0, 3);
}

function detectRoleHypotheses(tasks: Task[], jobs: Job[], log: ActivityLog[], tracks: CareerTrack[] = []) {
  const scores = new Map<string, number>();
  for (const j of jobs) {
    scoreHypothesesFromText(`${j.title} ${j.roleArchetype || ""} ${j.narrativeAngle || ""} ${j.note || ""}`, scores);
  }
  for (const t of tasks) {
    scoreHypothesesFromText(`${t.title} ${t.sourceNote || ""} ${t.doneWhen || ""}`, scores);
  }
  for (const track of tracks) {
    scoreHypothesesFromText(`${track.name} ${track.targetRoleArchetype || ""} ${track.whyItFits || ""} ${track.description || ""}`, scores);
  }
  for (const e of log) {
    if (e.eventType === "role_attribute_feedback") scoreHypothesesFromText(e.metadata || "", scores);
  }
  return rankedHypotheses(scores, HYPOTHESIS_LABELS);
}

function detectTopicHypotheses(tasks: Task[], jobs: Job[], log: ActivityLog[], tracks: CareerTrack[] = []) {
  const scores = new Map<string, number>();
  for (const j of jobs) scoreTopicHypothesesFromText(`${j.title} ${j.roleArchetype || ""} ${j.narrativeAngle || ""} ${j.note || ""}`, scores);
  for (const t of tasks) scoreTopicHypothesesFromText(`${t.title} ${t.sourceNote || ""} ${t.doneWhen || ""}`, scores);
  for (const track of tracks) scoreTopicHypothesesFromText(`${track.name} ${track.targetRoleArchetype || ""} ${track.whyItFits || ""} ${track.description || ""}`, scores);
  for (const e of log) {
    if (e.eventType === "role_attribute_feedback") scoreTopicHypothesesFromText(e.metadata || "", scores);
  }
  return rankedHypotheses(scores, TOPIC_LABELS);
}

function detectRoleShapeHypotheses(tasks: Task[], jobs: Job[], log: ActivityLog[], tracks: CareerTrack[] = []) {
  const scores = new Map<string, number>();
  for (const j of jobs) scoreRoleShapeHypothesesFromText(`${j.title} ${j.roleArchetype || ""} ${j.narrativeAngle || ""} ${j.note || ""}`, scores);
  for (const t of tasks) scoreRoleShapeHypothesesFromText(`${t.title} ${t.sourceNote || ""} ${t.doneWhen || ""}`, scores);
  for (const track of tracks) scoreRoleShapeHypothesesFromText(`${track.name} ${track.targetRoleArchetype || ""} ${track.whyItFits || ""} ${track.description || ""}`, scores);
  for (const e of log) {
    if (e.eventType === "role_attribute_feedback") scoreRoleShapeHypothesesFromText(e.metadata || "", scores);
  }
  return ensureRoleShapeCoverage(
    detectRoleHypotheses(tasks, jobs, log, tracks),
    detectTopicHypotheses(tasks, jobs, log, tracks),
    rankedHypotheses(scores, ROLE_SHAPE_LABELS),
  );
}

function buildGoalSnapshot(tasks: Task[], jobs: Job[], log: ActivityLog[], learn: Learn[] = [], contacts: Contact[] = [], hustles: Hustle[] = [], tracks: CareerTrack[] = []): GoalSnapshot {
  const assets = careerAssetsFromActivity(log);
  const feedback = attributeFeedbackFromActivity(log);
  const feedbackSummary = attributeFeedbackSummary(feedback);
  const savedJobs = openJobs(jobs);
  const activeTracks = tracks.filter((t) => t.status === "active");
  const careerTasks = tasks.filter(isCareerTask);
  const candidateCommits = countEvents(log, "candidate_committed");
  const deconstructionCommits = countEvents(log, "role_deconstruction_committed");
  const roleFeedbackCount = feedback.length;
  const hasNetworkTask = careerTasks.some((t) => /person|contact|message|network|alum|colleague/i.test(t.title));
  const openContacts = contacts.filter(isOpenContact);
  const activeConversationCount = openContacts.filter(hasActiveConversation).length;
  const warmContactCount = openContacts.filter(isWarmContact).length;
  const roleLinkedContactCount = openContacts.filter(isRoleLinkedContact).length;
  const dueFollowUpCount = openContacts.filter(isContactFollowUpDue).length;
  const draftedContactCount = openContacts.filter(hasDraftedContactMove).length;
  const hasApplicationTask = careerTasks.some((t) => /apply|application|cv|cover|interview/i.test(t.title));
  const applicationTruth = savedJobs.map(computeJobTruthStrip);
  const viableApplicationTruth = applicationTruth.filter((t) => t.action !== "reject");
  const activeOpportunityCount = savedJobs.filter((job) =>
    job.status === "applied"
    || job.status === "interviewing"
    || job.applicationReadiness === "submitted"
    || job.applicationReadiness === "follow_up",
  ).length;
  const interviewingJobs = savedJobs.filter((j) => j.status === "interviewing").length;
  const applicationActionCounts: Record<JobTruthAction, number> = {
    apply: 0,
    warm: 0,
    prove: 0,
    reject: 0,
    clarify: 0,
    prepare: 0,
    follow_up: 0,
  };
  for (const truth of applicationTruth) applicationActionCounts[truth.action] += 1;
  const opportunityStateKind = opportunityStageFor({
    interviewingJobs,
    activeOpportunityCount,
    viableApplicationCount: viableApplicationTruth.length,
    savedJobsCount: savedJobs.length,
  });
  const dominantOpportunityBlocker = dominantOpportunityBlockerFor({
    state: opportunityStateKind,
    activeConversationCount,
    applicationActionCounts,
    viableApplicationCount: viableApplicationTruth.length,
    savedJobsCount: savedJobs.length,
  });
  const leadApplicationTruth = [...viableApplicationTruth.filter((t) => t.action !== "prove")].sort((a, b) => {
    const priorityDiff = APPLICATION_ACTION_PRIORITY[b.action] - APPLICATION_ACTION_PRIORITY[a.action];
    if (priorityDiff !== 0) return priorityDiff;
    return (b.fit.score ?? 0) - (a.fit.score ?? 0);
  })[0] || null;
  const proofSupportDemandCount = applicationActionCounts.prove;
  const hasProofTask = careerTasks.some((t) => /proof|gap|bullet|story|portfolio|sample/i.test(t.title));
  const liveProofAssets = hustles.filter((h) => h.stage === "testing" || h.stage === "earning");
  const activeHustleItems = hustles.filter((h) => h.stage !== "earning");
  const outlinedProofAssetCount = hustles.filter((h) => !!((h.nextStep && h.nextStep.trim()) || (h.coreClaim && h.coreClaim.trim()) || (h.firstPostIdea && h.firstPostIdea.trim()))).length;
  const activeLearn = learn.filter((l) => !l.done && l.learnStatus !== "closed");
  const evidencedLearnCount = learn.filter((l) => !!(l.outputEvidenceUrl && l.outputEvidenceUrl.trim())).length;
  const learningOutputGapCount = activeLearn.filter((l) => !!(l.requiredOutput || l.proofIntent) && !(l.outputEvidenceUrl && l.outputEvidenceUrl.trim())).length;
  const roleHypotheses = detectRoleHypotheses(tasks, savedJobs, log, activeTracks);
  const topicHypotheses = detectTopicHypotheses(tasks, savedJobs, log, activeTracks);
  const roleShapeHypotheses = detectRoleShapeHypotheses(tasks, savedJobs, log, activeTracks);

  const directionStarted = savedJobs.length > 0 || activeTracks.length > 0 || candidateCommits > 0 || roleFeedbackCount > 0;
  const directionReady = savedJobs.length >= 5
    || roleFeedbackCount >= 3
    || hasSignal(feedbackSummary, "energising")
    || hasSignal(feedbackSummary, "credible")
    || (directionStarted && roleHypotheses.length >= 2);
  return {
    assets,
    feedback,
    feedbackSummary,
    savedJobs,
    activeTracks,
    careerTasks,
    candidateCommits,
    deconstructionCommits,
    roleFeedbackCount,
    hasNetworkTask,
    openContacts,
    networkContactsCount: openContacts.length,
    activeConversationCount,
    warmContactCount,
    roleLinkedContactCount,
    dueFollowUpCount,
    draftedContactCount,
    hasApplicationTask,
    activeOpportunityCount,
    viableApplicationCount: viableApplicationTruth.length,
    applicationActionCounts,
    opportunityStateKind,
    dominantOpportunityBlocker,
    leadApplicationTruth,
    hasProofTask,
    proofSupportDemandCount,
    liveProofAssetCount: liveProofAssets.length,
    outlinedProofAssetCount,
    activeHustleItems,
    activeLearnItems: activeLearn,
    activeLearnCount: activeLearn.length,
    evidencedLearnCount,
    learningOutputGapCount,
    interviewingJobs,
    roleHypotheses,
    topicHypotheses,
    roleShapeHypotheses,
    directionReady,
    directionStarted,
  };
}

function hasBroadParallelLanes(snapshot: GoalSnapshot) {
  if (!snapshot.directionStarted || snapshot.roleHypotheses.length < 2) return false;
  if (snapshot.activeTracks.length >= 2) return true;
  return buildBroadPursuitCoverage(snapshot).covered.length >= 2;
}

function inferGoalPhase(snapshot: GoalSnapshot): GoalPhase {
  if (snapshot.interviewingJobs > 0) return "interview-prep";
  if (!snapshot.directionStarted) return "fit-discovery";
  if (hasBroadParallelLanes(snapshot)) return "role-targeting";
  if (snapshot.savedJobs.length >= 5) return "role-targeting";
  if ((snapshot.roleHypotheses.length >= 2 || snapshot.topicHypotheses.length >= 2 || snapshot.roleShapeHypotheses.length >= 2) && !snapshot.hasApplicationTask) return "lane-narrowing";
  return "role-targeting";
}

function workstreamStates(snapshot: GoalSnapshot): WorkstreamState[] {
  const broadSupportCoverage = hasBroadParallelLanes(snapshot)
    ? buildBroadPursuitCoverage(snapshot)
    : null;
  const directionEvidence = [
    snapshot.assets.length ? `${snapshot.assets.length} career assets available` : "no career assets recorded",
    snapshot.activeTracks.length ? `${snapshot.activeTracks.length} active career track${snapshot.activeTracks.length === 1 ? "" : "s"}` : "no active career tracks",
    snapshot.savedJobs.length ? `${snapshot.savedJobs.length} open or saved roles` : "no open or saved roles",
    snapshot.candidateCommits ? `${snapshot.candidateCommits} candidate activities committed` : "no candidate activity committed",
    snapshot.roleFeedbackCount ? `${snapshot.roleFeedbackCount} role reactions captured` : "no role reactions captured",
    snapshot.roleHypotheses.length ? `current hypotheses: ${snapshot.roleHypotheses.join(" vs ")}` : "no clear role hypotheses yet",
    snapshot.topicHypotheses.length ? `topic axis: ${snapshot.topicHypotheses.join(" vs ")}` : "topic axis still unclear",
    snapshot.roleShapeHypotheses.length ? `role-shape axis: ${snapshot.roleShapeHypotheses.join(" vs ")}` : "role-shape axis still unclear",
  ];

  const networkAssets = snapshot.assets.some((a) => a.kind === "network");
  const networkStarted = snapshot.hasNetworkTask || networkAssets || snapshot.networkContactsCount > 0;
  const missingNetworkByLane = broadSupportCoverage?.missing.length === 0 ? (broadSupportCoverage?.missingNetworkSupport || []) : [];
  const networkStatus: WorkstreamStatus = !networkStarted
    ? "underdeveloped"
    : snapshot.dueFollowUpCount > 0
      ? "stale"
      : missingNetworkByLane.length > 0
        ? "underdeveloped"
      : snapshot.savedJobs.length > 0 && snapshot.roleLinkedContactCount === 0
        ? "underdeveloped"
        : "active";
  const networkProgress: WorkstreamState["progress"] = snapshot.activeConversationCount > 0 || snapshot.roleLinkedContactCount > 0
    ? "developing"
    : networkStarted
      ? "early"
      : "not_started";
  const networkBottleneck = !networkStarted
    ? "few warm conversations created"
    : snapshot.dueFollowUpCount > 0
      ? `${snapshot.dueFollowUpCount} follow-up${snapshot.dueFollowUpCount > 1 ? "s are" : " is"} due or overdue`
      : missingNetworkByLane.length > 0
        ? `these live paths still lack networking support: ${missingNetworkByLane.join("; ")}`
      : snapshot.networkContactsCount > 0 && snapshot.warmContactCount === 0
        ? "contacts exist, but none are warm enough to create easy momentum yet"
      : snapshot.savedJobs.length > 0 && snapshot.roleLinkedContactCount === 0
        ? "live roles exist, but few contacts are tied to them yet"
        : snapshot.activeConversationCount === 0
          ? "contacts exist, but no active conversation is moving"
          : "active conversations need sharper asks, replies, or role linkage";
  const networkNextMoves = !networkStarted
    ? ["find one warm-network person", "draft one reality-check message", "send or save one soft ask"]
    : snapshot.dueFollowUpCount > 0
      ? ["follow up with the warmest overdue contact", "send one concise nudge tied to the current role or ask", "schedule the next touch so the thread does not go cold again"]
      : missingNetworkByLane.length > 0
        ? [`add or link one contact to ${missingNetworkByLane[0]}`, "draft one advice, reconnect, or referral ask for that role type", "make sure each live path has at least one real person to reach out to"]
      : snapshot.savedJobs.length > 0 && snapshot.roleLinkedContactCount === 0
        ? ["tie one contact to the strongest live role", "identify who can warm the best current application", "draft one role-linked outreach message"]
        : snapshot.activeConversationCount === 0
          ? ["turn one draft into a sent message", "pick the warmest contact and send a concrete ask", "schedule one follow-up date"]
          : ["move one active thread forward", "make the next ask more specific", "log the next follow-up date"];
  const clarifyOnlyApplications = snapshot.viableApplicationCount > 0
    && snapshot.applicationActionCounts.clarify === snapshot.viableApplicationCount
    && snapshot.applicationActionCounts.apply === 0
    && snapshot.applicationActionCounts.warm === 0
    && snapshot.applicationActionCounts.follow_up === 0
    && snapshot.applicationActionCounts.prepare === 0;
  const broadCoverageGaps = broadSupportCoverage?.missing.length ? broadSupportCoverage.missing.length : 0;
  const applicationLead = snapshot.leadApplicationTruth;
  const applicationStatus: WorkstreamStatus = snapshot.viableApplicationCount === 0
    ? (snapshot.directionReady ? "underdeveloped" : "premature")
    : clarifyOnlyApplications && broadCoverageGaps > 0 ? "premature"
    : clarifyOnlyApplications ? "active"
    : applicationLead ? "active" : "underdeveloped";
  const applicationProgress: WorkstreamState["progress"] = clarifyOnlyApplications
    ? (broadCoverageGaps > 0 ? "not_started" : "early")
    : applicationLead?.action === "prepare" || applicationLead?.action === "follow_up"
    ? "developing"
    : applicationLead
      ? "early"
      : "not_started";
  const applicationBottleneck = applicationLead?.action === "prepare"
    ? `${snapshot.applicationActionCounts.prepare} live role${snapshot.applicationActionCounts.prepare === 1 ? "" : "s"} need interview or process preparation`
    : applicationLead?.action === "follow_up"
      ? `${snapshot.applicationActionCounts.follow_up} role${snapshot.applicationActionCounts.follow_up === 1 ? "" : "s"} need follow-up or a warm nudge`
      : applicationLead?.action === "apply"
        ? `${snapshot.applicationActionCounts.apply} role${snapshot.applicationActionCounts.apply === 1 ? " is" : "s are"} ready for a concrete application step`
        : applicationLead?.action === "warm"
          ? `${snapshot.applicationActionCounts.warm} promising role${snapshot.applicationActionCounts.warm === 1 ? " should" : "s should"} reach out to someone useful before going cold`
          : applicationLead?.action === "clarify"
            ? `${snapshot.applicationActionCounts.clarify} role${snapshot.applicationActionCounts.clarify === 1 ? " still needs" : "s still need"} clarification before real conversion`
            : snapshot.proofSupportDemandCount > 0
              ? `${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from stronger credibility, but that is an upskilling edge rather than an application blocker`
            : snapshot.directionReady
              ? "no role is ready for a concrete conversion move yet"
              : "direction is not ready enough for broad applications";
  const applicationNextMoves = applicationLead?.action === "prepare"
      ? [applicationLead.nextMove, "review the most likely interview themes", "tighten one interview story or concrete example"]
    : applicationLead?.action === "follow_up"
      ? [applicationLead.nextMove, "identify the warmest internal nudge for that role", "log the next follow-up point so the role does not disappear"]
    : applicationLead?.action === "apply"
      ? [applicationLead.nextMove, "finish the strongest application material", "submit or clearly schedule the exact next application step"]
    : applicationLead?.action === "warm"
      ? [applicationLead.nextMove, "tie one contact to the live role before applying cold", "send one message or referral ask that advances the role before going in cold"]
    : applicationLead?.action === "clarify"
      ? [applicationLead.nextMove, "confirm the role facts before spending more effort", "decide whether the role is worth keeping in the portfolio"]
      : ["wait until one role has a concrete conversion move", "keep the pipeline selective rather than forcing an application", "do not mass apply yet"];
  const proofStatus: WorkstreamStatus = !snapshot.directionStarted && snapshot.liveProofAssetCount === 0 && !snapshot.hasProofTask && snapshot.outlinedProofAssetCount === 0
    ? "premature"
    : snapshot.liveProofAssetCount === 0 && !snapshot.hasProofTask && snapshot.outlinedProofAssetCount === 0
      ? "sufficient_for_now"
      : "active";
  const proofProgress: WorkstreamState["progress"] = snapshot.outlinedProofAssetCount > 0
    ? "developing"
    : snapshot.liveProofAssetCount > 0 || snapshot.hasProofTask
      ? "early"
      : "not_started";
  const proofBottleneck = snapshot.liveProofAssetCount === 0 && !snapshot.hasProofTask && snapshot.outlinedProofAssetCount === 0
    ? "projects and public work are optional value-adds for upskilling, not a blocker for applying"
  : snapshot.liveProofAssetCount > 0 && snapshot.outlinedProofAssetCount === 0
      ? "projects or public work exist, but they are not yet concrete enough to point to clearly later"
    : snapshot.liveProofAssetCount > 0
        ? "projects or public work are live, but they need the next concrete output"
      : "ideas for projects or public work exist, but they are not active yet";
  const proofNextMoves = snapshot.liveProofAssetCount === 0 && !snapshot.hasProofTask && snapshot.outlinedProofAssetCount === 0
    ? ["keep projects and public work as a secondary upskilling layer for now", "start one only when it will compound your learning", "define the smallest publishable or shippable output when you are ready"]
  : snapshot.liveProofAssetCount > 0
      ? ["produce the next concrete output on the live project or public-work item", "capture one existing result in a way you can point to later", "turn it into something publishable or shippable enough to point to later"]
      : ["turn one project or public-work idea into something real", "pick one output format you can sustain", "connect it to a learning goal, not a single role"];
  const missingLearningByLane = broadSupportCoverage?.missing.length === 0 ? ((broadSupportCoverage?.missingPrepSupport || broadSupportCoverage?.missingLearningSupport) || []) : [];
  const capabilityStatus: WorkstreamStatus = snapshot.directionReady || snapshot.interviewingJobs > 0
    ? missingLearningByLane.length > 0
      ? "underdeveloped"
      : (snapshot.activeLearnCount > 0 || snapshot.evidencedLearnCount > 0 ? "active" : "underdeveloped")
    : "premature";
  const capabilityProgress: WorkstreamState["progress"] = snapshot.evidencedLearnCount > 0
    ? "developing"
    : snapshot.activeLearnCount > 0
      ? "early"
      : "not_started";
  const capabilityBottleneck = snapshot.interviewingJobs > 0
    ? snapshot.learningOutputGapCount > 0
      ? `${snapshot.learningOutputGapCount} learning item${snapshot.learningOutputGapCount === 1 ? " still needs" : "s still need"} notes, practice, or a short brief before the interview`
      : "interview and role preparation need practice that turns into something you can reuse"
    : missingLearningByLane.length > 0
      ? `these live paths still need prep: ${missingLearningByLane.join("; ")}`
    : snapshot.activeLearnCount === 0 && snapshot.evidencedLearnCount === 0
      ? snapshot.proofSupportDemandCount > 0
        ? `no role-relevant learning plan is active yet, and ${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from clearer examples or practice`
        : "no role-relevant learning plan is active yet"
      : snapshot.proofSupportDemandCount > 0 && snapshot.learningOutputGapCount > 0
        ? `${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from clearer examples or practice, and ${snapshot.learningOutputGapCount} learning item${snapshot.learningOutputGapCount === 1 ? " still needs" : "s still need"} notes or a short brief`
      : snapshot.proofSupportDemandCount > 0
        ? `${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from clearer examples or practice`
      : snapshot.learningOutputGapCount > 0
        ? `${snapshot.learningOutputGapCount} learning item${snapshot.learningOutputGapCount === 1 ? " still needs" : "s still need"} notes or a short brief`
      : snapshot.activeLearnCount > 0 && snapshot.evidencedLearnCount === 0
          ? "learning is in motion, but nothing is linked back yet"
      : "turn learning into clearer examples, notes, or practice";
  const capabilityNextMoves = snapshot.activeLearnCount === 0 && snapshot.evidencedLearnCount === 0
    ? ["pick one requirement that feels weakest today", "start one learning item tied to that requirement", "decide whether notes, a brief, or an example would help later"]
    : missingLearningByLane.length > 0
      ? [`add one prep step for ${missingLearningByLane[0]}`, "decide what notes, brief, or example would actually help across those roles", "turn upskilling into something you can use again later, not one-off prep"]
    : snapshot.proofSupportDemandCount > 0 && snapshot.learningOutputGapCount > 0
      ? ["finish one useful prep note, brief, or example for the current path", "turn that result into something you can use in interviews or applications", "save the notes or link so Anchor can refer back to it later"]
    : snapshot.proofSupportDemandCount > 0
      ? ["pick one requirement for the current path that still feels weak today", "turn existing learning into a clearer example or talking point", "save one note, brief, or result so it is easy to reuse later"]
    : snapshot.learningOutputGapCount > 0
      ? ["finish one useful note, brief, or practice result", "attach the notes or link to the learning item", "turn it into interview or job prep material"]
    : snapshot.activeLearnCount > 0 && snapshot.evidencedLearnCount === 0
          ? ["move one active learning item to concrete notes, a brief, or a practice result", "practice one scenario or framework", "capture the useful part in writing"]
        : ["turn one learning item into interview or job prep material", "practice one scenario or framework", "choose the next area to strengthen"];

  return [
    {
      name: GOAL_WORKSTREAM.DIRECTION,
      status: snapshot.directionReady ? "active" : "underdeveloped",
      progress: snapshot.directionReady ? "developing" : snapshot.directionStarted ? "early" : "not_started",
      bottleneck: hasBroadParallelLanes(snapshot)
        ? "multiple plausible paths need live roles and applications so real feedback can separate them for you"
        : snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2
          ? "you need one real role or application move in each strong option before narrowing"
          : snapshot.roleHypotheses.length >= 2
            ? "you still need live roles and application moves across the plausible paths"
            : snapshot.directionReady ? "you have options, but still need to narrow them into a clearer role path" : "not enough real evidence yet about which role type fits",
      nextMoveType: "research",
      evidence: directionEvidence,
      nextMoves: hasBroadParallelLanes(snapshot)
        ? snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2
          ? ["add one real role in each live option", "capture which options feel energising, credible, or gettable", "let concrete roles separate the options instead of forcing a winner early"]
          : ["add one real role in each plausible path", "capture what the work actually looks like in each path", "let concrete roles separate the options instead of forcing a winner early"]
        : snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2
          ? ["save one concrete role example for each strong option", "capture what feels energising, credible, or gettable in each", "let live roles and applications narrow the field"]
          : snapshot.roleHypotheses.length >= 2
            ? ["save one concrete example from each plausible path", "define what a credible near-term role must include", "let live roles and applications narrow the field"]
          : snapshot.directionReady
            ? ["summarise patterns", "compare the strongest role paths", "inspect one adjacent role"]
            : ["inspect one asset-backed role", "save one plausible role", "note one useful attribute"],
    },
    {
      name: GOAL_WORKSTREAM.MARKET_MAP,
      status: snapshot.savedJobs.length >= 10 ? "sufficient_for_now" : snapshot.savedJobs.length > 0 ? "active" : "underdeveloped",
      progress: snapshot.savedJobs.length >= 10 ? "ready" : snapshot.savedJobs.length > 0 ? "early" : "not_started",
      bottleneck: snapshot.savedJobs.length >= 10 ? "enough initial roles to pattern-match" : "not enough real role examples",
      nextMoveType: snapshot.savedJobs.length >= 10 ? "wait" : "research",
      evidence: [`${snapshot.savedJobs.length} saved/open roles`],
      nextMoves: snapshot.savedJobs.length >= 10 ? ["summarise role patterns"] : ["save one role from an asset-backed search", "compare two role descriptions"],
    },
    {
      name: GOAL_WORKSTREAM.NETWORK,
      status: networkStatus,
      progress: networkProgress,
      bottleneck: networkBottleneck,
      nextMoveType: "relationship",
      evidence: [
        `${snapshot.networkContactsCount} open contact${snapshot.networkContactsCount === 1 ? "" : "s"}`,
        `${snapshot.warmContactCount} warm contact${snapshot.warmContactCount === 1 ? "" : "s"}`,
        `${snapshot.draftedContactCount} drafted/message-bearing contact${snapshot.draftedContactCount === 1 ? "" : "s"}`,
        `${snapshot.activeConversationCount} active conversation${snapshot.activeConversationCount === 1 ? "" : "s"}`,
        `${snapshot.roleLinkedContactCount} role-linked contact${snapshot.roleLinkedContactCount === 1 ? "" : "s"}`,
        `${snapshot.dueFollowUpCount} due follow-up${snapshot.dueFollowUpCount === 1 ? "" : "s"}`,
        broadSupportCoverage && broadSupportCoverage.missing.length === 0
          ? `${broadSupportCoverage.networkSupported.length} live path${broadSupportCoverage.networkSupported.length === 1 ? "" : "s"} with outreach in place`
          : "role coverage still comes before support for each role type",
        snapshot.hasNetworkTask ? "network task exists" : "no clear network task",
        networkAssets ? "network assets available" : "no explicit network assets",
      ],
      nextMoves: networkNextMoves,
    },
    {
      name: GOAL_WORKSTREAM.POSITIONING,
      status: snapshot.directionReady ? "active" : "premature",
      progress: snapshot.directionReady ? "early" : "not_started",
      bottleneck: snapshot.directionReady ? "your story needs to connect your experience to the chosen role type" : "target role type is not clear enough",
      nextMoveType: snapshot.directionReady ? "preparation" : "wait",
      evidence: [snapshot.directionReady ? "some real role evidence exists" : "direction still unclear"],
      nextMoves: snapshot.directionReady ? ["write one rough why-you-fit line", "match one past example to one role requirement"] : ["wait until more real role evidence exists"],
    },
    {
      name: GOAL_WORKSTREAM.PROJECTS_PUBLIC_WORK,
      status: proofStatus,
      progress: proofProgress,
      bottleneck: proofBottleneck,
      nextMoveType: snapshot.liveProofAssetCount > 0 || snapshot.hasProofTask ? "preparation" : "wait",
      evidence: [
        `${snapshot.liveProofAssetCount} live project/public-work item${snapshot.liveProofAssetCount === 1 ? "" : "s"}`,
        `${snapshot.outlinedProofAssetCount} outlined project/public-work item${snapshot.outlinedProofAssetCount === 1 ? "" : "s"}`,
        snapshot.deconstructionCommits ? `${snapshot.deconstructionCommits} role deconstruction tasks committed` : "no role deconstruction commitments",
        hasSignal(snapshot.feedbackSummary, "gap") ? "gap feedback exists" : "no explicit proof-gap feedback",
      ],
      nextMoves: proofNextMoves,
    },
    {
      name: GOAL_WORKSTREAM.APPLICATIONS,
      status: applicationStatus,
      progress: applicationProgress,
      bottleneck: applicationBottleneck,
      nextMoveType: clarifyOnlyApplications
        ? (broadCoverageGaps > 0 ? "wait" : "execution")
        : applicationLead?.action === "prepare"
          ? "preparation"
          : applicationLead ? "execution" : "wait",
      
      evidence: [
        `${snapshot.savedJobs.length} open or saved role${snapshot.savedJobs.length === 1 ? "" : "s"}`,
        `${snapshot.viableApplicationCount} viable role${snapshot.viableApplicationCount === 1 ? "" : "s"}`,
        `${snapshot.applicationActionCounts.apply} ready-to-apply`,
        `${snapshot.applicationActionCounts.warm} contact-first`,
        `${snapshot.applicationActionCounts.prove} capability-support`,
        `${snapshot.applicationActionCounts.clarify} clarify-first`,
        `${snapshot.applicationActionCounts.follow_up} follow-up`,
        `${snapshot.applicationActionCounts.prepare} interview/process-prep`,
        `${snapshot.proofSupportDemandCount} role${snapshot.proofSupportDemandCount === 1 ? "" : "s"} better served by capability-building than immediate applying`,
        snapshot.hasApplicationTask ? "application-related task exists" : "no active application task",
      ],
      nextMoves: applicationNextMoves,
    },
    {
      name: GOAL_WORKSTREAM.INTERVIEW_READINESS,
      status: snapshot.interviewingJobs > 0 ? "active" : snapshot.savedJobs.length > 0 ? "underdeveloped" : "premature",
      progress: snapshot.interviewingJobs > 0 ? "early" : "not_started",
      bottleneck: snapshot.interviewingJobs > 0 ? "interview stories and role-specific examples need tightening" : snapshot.savedJobs.length > 0 ? "no live interview yet, but interview prep is still thin" : "premature until live roles exist",
      nextMoveType: snapshot.interviewingJobs > 0 ? "preparation" : "wait",
      evidence: [snapshot.interviewingJobs ? `${snapshot.interviewingJobs} interviewing role(s)` : "no interviewing roles yet"],
      nextMoves: snapshot.interviewingJobs > 0 ? ["prepare 3 concrete interview stories", "simulate one interview answer", "review the company and role thesis"] : ["wait until a live interview exists"],
    },
    {
      name: GOAL_WORKSTREAM.PREP_UPSKILLING,
      status: capabilityStatus,
      progress: capabilityProgress,
      bottleneck: capabilityBottleneck,
      nextMoveType: snapshot.directionReady || snapshot.interviewingJobs > 0 ? "learning" : "wait",
      evidence: [
        snapshot.activeLearnCount ? `${snapshot.activeLearnCount} active learning item(s)` : "no active learning items",
        snapshot.evidencedLearnCount ? `${snapshot.evidencedLearnCount} learning item(s) with notes or an output linked` : "no linked learning outputs yet",
        snapshot.learningOutputGapCount ? `${snapshot.learningOutputGapCount} learning item(s) still need notes or an output` : "learning outputs are in better shape",
        broadSupportCoverage && broadSupportCoverage.missing.length === 0
          ? `${(broadSupportCoverage.prepSupported || broadSupportCoverage.learningSupported).length} live path${(broadSupportCoverage.prepSupported || broadSupportCoverage.learningSupported).length === 1 ? "" : "s"} with prep in place`
          : "role coverage still comes before support for each role type",
        `${snapshot.proofSupportDemandCount} role${snapshot.proofSupportDemandCount === 1 ? "" : "s"} that could benefit from clearer examples or practice`,
      ],
      nextMoves: snapshot.directionReady || snapshot.interviewingJobs > 0 ? capabilityNextMoves : ["wait until the target role type is clearer"],
    },
    {
      name: GOAL_WORKSTREAM.ENERGY_STABILITY,
      status: "active",
      progress: "developing",
      bottleneck: "execution must stay sustainable",
      nextMoveType: "maintenance",
      evidence: ["always relevant for ADHD execution"],
      nextMoves: ["include one maintenance action if the day is overloaded", "keep the plan small enough to start"],
    },
  ];
}

function recommendedFocus(workstreams: WorkstreamState[], phase: GoalPhase, snapshot: GoalSnapshot): WorkstreamState {
  const network = workstreams.find((w) => w.name === GOAL_WORKSTREAM.NETWORK);
  const applications = workstreams.find((w) => w.name === GOAL_WORKSTREAM.APPLICATIONS);
  const capability = workstreams.find((w) => w.name === GOAL_WORKSTREAM.PREP_UPSKILLING);
  const direction = workstreams.find((w) => w.name === GOAL_WORKSTREAM.DIRECTION);
  const marketMap = workstreams.find((w) => w.name === GOAL_WORKSTREAM.MARKET_MAP);
  if ((phase === "role-targeting" || phase === "interview-prep") && network && network.status === "stale") return network;
  if (phase === "role-targeting") {
    if (snapshot.leadApplicationTruth?.action === "follow_up" && applications && applications.nextMoveType !== "wait") {
      return applications;
    }
    if (snapshot.dominantOpportunityBlocker === "capability" && capability && capability.status !== "premature" && capability.nextMoveType !== "wait") {
      return capability;
    }
    if (snapshot.dominantOpportunityBlocker === "application" && applications && applications.nextMoveType !== "wait") {
      return applications;
    }
    if (snapshot.dominantOpportunityBlocker === "targeting") {
      if (direction && direction.nextMoveType !== "wait") return direction;
      if (marketMap && marketMap.nextMoveType !== "wait") return marketMap;
    }
    if (hasBroadParallelLanes(snapshot)) {
      const coverage = buildBroadPursuitCoverage(snapshot);
      if (coverage.missing.length > 0) {
        if (direction && direction.nextMoveType !== "wait") return direction;
        if (marketMap && marketMap.nextMoveType !== "wait") return marketMap;
      }
      if (coverage.missing.length === 0 && coverage.missingNetworkSupport.length > 0 && network && network.nextMoveType !== "wait") return network;
      if (coverage.missing.length === 0 && coverage.missingNetworkSupport.length === 0 && coverage.missingPrepSupport.length > 0 && capability && capability.nextMoveType !== "wait") {
        return capability;
      }
    }
    if (snapshot.dominantOpportunityBlocker === "access" && network && network.nextMoveType !== "wait") return network;
    if (snapshot.dominantOpportunityBlocker === "clarify" && applications && applications.nextMoveType !== "wait") {
      return applications;
    }
  }

  const priorityByPhase: Record<GoalPhase, string[]> = {
    "fit-discovery": [GOAL_WORKSTREAM.DIRECTION, GOAL_WORKSTREAM.MARKET_MAP, GOAL_WORKSTREAM.NETWORK, GOAL_WORKSTREAM.ENERGY_STABILITY],
    "lane-narrowing": [GOAL_WORKSTREAM.DIRECTION, GOAL_WORKSTREAM.POSITIONING, GOAL_WORKSTREAM.MARKET_MAP, GOAL_WORKSTREAM.NETWORK, GOAL_WORKSTREAM.ENERGY_STABILITY],
    "role-targeting": [GOAL_WORKSTREAM.APPLICATIONS, GOAL_WORKSTREAM.NETWORK, GOAL_WORKSTREAM.POSITIONING, GOAL_WORKSTREAM.PREP_UPSKILLING, GOAL_WORKSTREAM.PROJECTS_PUBLIC_WORK, GOAL_WORKSTREAM.ENERGY_STABILITY],
    "interview-prep": [GOAL_WORKSTREAM.INTERVIEW_READINESS, GOAL_WORKSTREAM.NETWORK, GOAL_WORKSTREAM.PREP_UPSKILLING, GOAL_WORKSTREAM.APPLICATIONS, GOAL_WORKSTREAM.PROJECTS_PUBLIC_WORK, GOAL_WORKSTREAM.ENERGY_STABILITY],
  };
  return priorityByPhase[phase]
    .map((name) => workstreams.find((w) => w.name === name))
    .find((w): w is WorkstreamState => !!w && ["underdeveloped", "active", "stale", "blocked"].includes(w.status) && w.nextMoveType !== "wait")
    || workstreams[0]!;
}

function focusReasonCodeFor(
  focus: WorkstreamState,
  phase: GoalPhase,
  snapshot: GoalSnapshot,
): FocusReasonCode {
  if (phase === "interview-prep" || focus.name === GOAL_WORKSTREAM.INTERVIEW_READINESS) return "live_interview";
  if (focus.name === GOAL_WORKSTREAM.DIRECTION || focus.name === GOAL_WORKSTREAM.MARKET_MAP) {
    if (hasBroadParallelLanes(snapshot) && buildBroadPursuitCoverage(snapshot).missing.length > 0) return "missing_roles";
    return "target_unclear";
  }
  if (focus.name === GOAL_WORKSTREAM.NETWORK) {
    return snapshot.dueFollowUpCount > 0 ? "stale_follow_up" : "network_access";
  }
  if (focus.name === GOAL_WORKSTREAM.PREP_UPSKILLING) {
    if (phase === "role-targeting" && snapshot.dominantOpportunityBlocker === "capability") {
      return "repeated_capability_gap";
    }
    return "parallel_support_gap";
  }
  if (focus.name === GOAL_WORKSTREAM.APPLICATIONS) {
    if (snapshot.dominantOpportunityBlocker === "clarify" || snapshot.leadApplicationTruth?.action === "clarify") return "clarify_before_push";
    if (snapshot.leadApplicationTruth?.action === "follow_up") return "live_follow_up";
    return "live_apply";
  }
  return "general_progress";
}

function dayTypeFor(focus: WorkstreamState) {
  if (focus.name === GOAL_WORKSTREAM.INTERVIEW_READINESS) return "interview-prep";
  if (focus.name === GOAL_WORKSTREAM.PREP_UPSKILLING || focus.name === GOAL_WORKSTREAM.PROJECTS_PUBLIC_WORK) return "capability-building";
  if (focus.name === GOAL_WORKSTREAM.ENERGY_STABILITY) return "stabilising";
  if (focus.nextMoveType === "research") return "evidence-building";
  if (focus.nextMoveType === "relationship") return "network-building";
  if (focus.nextMoveType === "execution") return "conversion";
  return "evidence-building";
}

function phaseObjective(phase: GoalPhase) {
  if (phase === "fit-discovery") return "identify role families that genuinely fit your interests, goals, and energy";
  if (phase === "lane-narrowing") return "gather enough live evidence to narrow promising paths without forcing a premature choice";
  if (phase === "role-targeting") return "turn plausible paths into live roles, selective applications, and stronger positioning";
  return "prepare to perform strongly in the interview and strengthen the capabilities the role will demand";
}

function phaseReason(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot) {
  if (phase === "role-targeting" && focus.name === GOAL_WORKSTREAM.PREP_UPSKILLING && snapshot.dominantOpportunityBlocker === "capability") {
    return `${focus.name} is the current bottleneck: ${focus.bottleneck}.`;
  }
  if (phase === "role-targeting" && hasBroadParallelLanes(snapshot)) {
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
      ? "You need a job, so Anchor should keep multiple plausible paths open in parallel and convert the most credible live roles instead of forcing an early identity choice. Location stays flexible across UAE, Remote, and London."
      : "You need a job, so Anchor should open multiple plausible paths in parallel and turn them into live roles instead of forcing an early identity choice. Location stays flexible across UAE, Remote, and London.";
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
  return `${focus.name} is the current bottleneck: ${focus.bottleneck}.`;
}

function phaseDecisionQuestion(phase: GoalPhase, snapshot: GoalSnapshot) {
  if (phase === "fit-discovery") return fitDiscoveryDecisionQuestion();
  if (phase === "role-targeting" && hasBroadParallelLanes(snapshot)) {
    const coverage = buildBroadPursuitCoverage(snapshot);
    if (coverage.missing.length > 0) {
      return broadPursuitMissingRolesDecisionQuestion(coverage.missing);
    }
    if (coverage.missingNetworkSupport.length > 0 || coverage.missingPrepSupport.length > 0) {
      return broadPursuitMissingSupportDecisionQuestion(
        coverage.missingNetworkSupport,
        coverage.missingPrepSupport,
      );
    }
    return snapshot.savedJobs.length > 0
      ? "Which live roles are most gettable, credible, and worth pushing right now while keeping the other paths open?"
      : "Which plausible paths need one real role or application move next so outside feedback can start separating them for you?";
  }
  if (phase === "lane-narrowing") {
    if (snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) {
      return laneNarrowingTwoAxisDecisionQuestion();
    }
    if (snapshot.roleHypotheses.length >= 2) return laneNarrowingSingleAxisDecisionQuestion();
    return "Which promising role path keeps earning more attention from live evidence?";
  }
  if (phase === "role-targeting") return "Which specific role family should you convert first?";
  return interviewPrepDecisionQuestion();
}

function trajectoryFor(phase: GoalPhase): GoalTrajectoryStep[] {
  const order: GoalTrajectoryStep["key"][] = ["discover-fit", "narrow-lane", "target-role", "prepare-interview", "capability-ramp"];
  const currentIndex = phase === "fit-discovery" ? 0 : phase === "lane-narrowing" ? 1 : phase === "role-targeting" ? 2 : 3;
  const titles: Record<GoalTrajectoryStep["key"], Omit<GoalTrajectoryStep, "status">> = {
    "discover-fit": { key: "discover-fit", title: "Discover fit", description: "Figure out which kinds of roles genuinely fit your interests, strengths, and goals." },
    "narrow-lane": { key: "narrow-lane", title: "Narrow with evidence", description: "Keep plausible paths alive long enough to gather evidence, then narrow from real evidence instead of guesswork." },
    "target-role": { key: "target-role", title: "Target live roles", description: "Turn plausible paths into real roles, prep, and selective applications." },
    "prepare-interview": { key: "prepare-interview", title: "Prepare for interviews", description: "Build stories, examples, and role knowledge for live interview processes." },
    "capability-ramp": { key: "capability-ramp", title: "Prep for the role", description: "Strengthen weak spots for the interview and the job so you can perform strongly once hired." },
  };
  return order.map((key, index) => ({
    ...titles[key],
    status: index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending",
  }));
}

function buildTodayPlan(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot, candidateUniverse: ReturnType<typeof generateCandidateUniverse>) {
  if (phase === "role-targeting" && hasBroadParallelLanes(snapshot)) {
    const coverage = buildBroadPursuitCoverage(snapshot);
    if (focus.name === GOAL_WORKSTREAM.APPLICATIONS && snapshot.leadApplicationTruth && snapshot.leadApplicationTruth.action !== "clarify") {
      return {
        mustDo: "Advance the strongest application move now",
        next: focus.nextMoves[0] || "Keep the other plausible paths warm while this role moves forward",
        optional: "Capture what this live role teaches you about the wider portfolio",
        stopRule: "Stop after one real conversion move on the best current role.",
      };
    }
    if (focus.name === GOAL_WORKSTREAM.PREP_UPSKILLING && snapshot.dominantOpportunityBlocker === "capability") {
      return {
        mustDo: focus.nextMoves[0] || "Finish one useful prep note, brief, or example",
        next: focus.nextMoves[1] || "Turn it into something reusable for interviews or applications",
        optional: focus.nextMoves[2] || "Save the output where Anchor can refer back to it later",
        stopRule: "Stop after one reusable prep output exists for the current weak area.",
      };
    }
    if (coverage.missing.length > 0) {
      const missingText = coverage.missing.join("; ");
      return {
        mustDo: broadPursuitNextMissingRoleTodayMustDo(coverage.missing),
        next: coverage.covered.length > 0
          ? `Keep these already-live paths warm while you fill the missing ones: ${coverage.covered.join("; ")}`
          : `Start with these paths: ${missingText}`,
        optional: "Send one message to someone useful for the most gettable missing path",
        stopRule: broadPursuitNextMissingRoleStopRule(coverage.missing),
      };
    }
    if (coverage.missingNetworkSupport.length > 0 || coverage.missingPrepSupport.length > 0) {
      const hasNetworkGap = coverage.missingNetworkSupport.length > 0;
      const hasPrepGap = coverage.missingPrepSupport.length > 0;
      const supportNeedsAreMixed = hasNetworkGap && hasPrepGap;
      const focusNetwork = !supportNeedsAreMixed && focus.name === GOAL_WORKSTREAM.NETWORK && hasNetworkGap;
      const focusPrep = !supportNeedsAreMixed && focus.name === GOAL_WORKSTREAM.PREP_UPSKILLING && hasPrepGap;
      return {
        mustDo: focusNetwork
          ? broadPursuitNextMissingContactTodayMustDo(coverage.missingNetworkSupport)
          : focusPrep
            ? broadPursuitNextMissingPrepTodayMustDo(coverage.missingPrepSupport)
            : broadPursuitMissingSupportTodayMustDo(
              coverage.missingNetworkSupport,
              coverage.missingPrepSupport,
            ),
        next: "Keep live roles moving while you add the missing contact or prep starter.",
        optional: "If useful, add one optional example/project idea that could help more than one role in the same path.",
        stopRule: focusNetwork
          ? broadPursuitNextMissingContactStopRule(coverage.missingNetworkSupport)
          : focusPrep
            ? broadPursuitNextMissingPrepStopRule(coverage.missingPrepSupport)
            : broadPursuitMissingSupportStopRule(),
      };
    }
    return {
      mustDo: "Advance the most gettable live role now and keep the other plausible paths warm in parallel",
      next: "Add or refresh one credible role in a second path so you are not betting everything on a single path",
      optional: "Capture which paths are producing the best mix of fit, realism, and response",
      stopRule: "Stop after one real conversion move and one parallel-portfolio maintenance move.",
    };
  }
  if (phase === "lane-narrowing") {
    if (snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) {
      return {
        mustDo: laneNarrowingTwoAxisTodayMustDo(snapshot.topicHypotheses, snapshot.roleShapeHypotheses),
        next: laneNarrowingTwoAxisTodayNext(),
        optional: laneNarrowingTwoAxisTodayOptional(),
        stopRule: laneNarrowingTwoAxisTodayStopRule(),
      };
    }
    const lanes = snapshot.roleHypotheses.slice(0, 4);
    return {
      mustDo: laneNarrowingSingleAxisTodayMustDo(lanes),
      next: laneNarrowingSingleAxisTodayNext(),
      optional: laneNarrowingSingleAxisTodayOptional(),
      stopRule: laneNarrowingSingleAxisTodayStopRule(),
    };
  }
  if (phase === "fit-discovery") {
    return {
      mustDo: fitDiscoveryTodayMustDo(focus.nextMoves[0] || candidateUniverse.recommended?.createsTaskTitle),
      next: fitDiscoveryTodayNext(focus.nextMoves[1]),
      optional: fitDiscoveryTodayOptional(),
      stopRule: fitDiscoveryTodayStopRule(),
    };
  }
  if (phase === "interview-prep") {
    return {
      mustDo: interviewPrepTodayMustDo(),
      next: interviewPrepTodayNext(),
      optional: interviewPrepTodayOptional(),
      stopRule: interviewPrepTodayStopRule(),
    };
  }
  return {
    mustDo: focus.nextMoves[0] || candidateUniverse.recommended?.createsTaskTitle || "Convert one live role into the next concrete move",
    next: focus.nextMoves[1] || candidateUniverse.recommended?.activity || "Make one weak requirement easier to explain or back up",
    optional: focus.name === GOAL_WORKSTREAM.ENERGY_STABILITY ? "Stop after the minimum viable action" : "Do one small maintenance action so the day stays sustainable",
    stopRule: focus.nextMoveType === "learning" || focus.nextMoveType === "research"
      ? "Stop after one useful data point or 20 minutes."
      : "Stop once the defined small action is complete.",
  };
}

function whyPlausibleForCombination(topic: string, shape: string) {
  if (/AI/i.test(topic) && /Strategy|advisory/i.test(shape)) return "Matches your interest in AI while preserving strategic, externally-facing work.";
  if (/AI/i.test(topic) && /Ops|chief of staff/i.test(shape)) return "Lets you stay close to AI while testing whether you prefer execution and operating rhythm.";
  if (/Geopolitics/i.test(topic) && /Strategy|advisory/i.test(shape)) return "Matches substantive geopolitical interest with a classic advisory shape.";
  if (/Geopolitics/i.test(topic) && /Ops|chief of staff/i.test(shape)) return "Tests whether you want geopolitical substance with a more internal, execution-heavy role shape.";
  return "Plausible based on what Anchor has seen so far.";
}

function nextTestForCombination(topic: string, shape: string) {
  if (/Strategy|advisory/i.test(shape)) {
    return `Find one ${topic} role in a strategy/advisory shape and note the decisions, deliverables, and client/stakeholder exposure it requires.`;
  }
  if (/Ops|chief of staff/i.test(shape)) {
    return `Find one ${topic} role in an ops/chief-of-staff shape and note the cadence, coordination load, and execution ownership it requires.`;
  }
  return `Find one real ${topic} x ${shape} role and capture what the day-to-day work actually looks like.`;
}

function buildParallelExperiments(snapshot: GoalSnapshot): CombinationTest[] {
  const topicOrder = [TOPIC_LABELS.ai, TOPIC_LABELS.geopolitics, TOPIC_LABELS.policy];
  const shapeOrder = [ROLE_SHAPE_LABELS.strategy_advisory, ROLE_SHAPE_LABELS.ops_cos, ROLE_SHAPE_LABELS.research_analysis];
  const topics = topicOrder.filter((topic) => snapshot.topicHypotheses.includes(topic)).slice(0, 2);
  const shapes = shapeOrder.filter((shape) => snapshot.roleShapeHypotheses.includes(shape)).slice(0, 2);
  return topics.flatMap((topic) => shapes.map((shape) => ({
    combination: `${topic} x ${shape}`,
    whyPlausible: whyPlausibleForCombination(topic, shape),
    nextTest: nextTestForCombination(topic, shape),
  })));
}

function detectCombinationTopic(text: string) {
  const lower = text.toLowerCase();
  if (/\b(ai|artificial intelligence|technology|tech|frontier model|safety|machine learning)\b/.test(lower)) return TOPIC_LABELS.ai;
  if (/\b(geopolitic\w*|foreign policy|geostrateg\w*|geopolitical risk|international|middle east|security)\b/.test(lower)) return TOPIC_LABELS.geopolitics;
  if (/\b(policy|public sector|government|regulation|public affairs)\b/.test(lower)) return TOPIC_LABELS.policy;
  return null;
}

function detectCombinationRoleShape(text: string) {
  const lower = text.toLowerCase();
  if (/\b(chief of staff|operations| ops\b|program management|delivery|execution|partnerships)\b/.test(lower)) return ROLE_SHAPE_LABELS.ops_cos;
  if (/\b(strategy|advisory|advisor|consult|strategic)\b/.test(lower)) return ROLE_SHAPE_LABELS.strategy_advisory;
  if (/\b(research|analysis|analyst|researcher|insights)\b/.test(lower)) return ROLE_SHAPE_LABELS.research_analysis;
  return null;
}

function jobCombination(job: Job, combinations: string[]) {
  const text = `${job.title || ""} ${job.company || ""} ${job.roleArchetype || ""} ${job.narrativeAngle || ""} ${job.note || ""}`;
  return inferCombinationFromText(text, combinations);
}

function inferCombinationFromText(text: string, combinations: string[]) {
  const topic = detectCombinationTopic(text);
  const shape = detectCombinationRoleShape(text);
  if (!topic || !shape) return null;
  const combination = `${topic} x ${shape}`;
  return combinations.includes(combination) ? combination : null;
}

function trackCombination(track: CareerTrack | null | undefined, combinations: string[]) {
  if (!track) return null;
  return inferCombinationFromText(
    `${track.name || ""} ${track.description || ""} ${track.whyItFits || ""} ${track.targetRoleArchetype || ""}`,
    combinations,
  );
}

function linkedTrack(tracks: CareerTrack[], trackId: number | null | undefined) {
  return trackId == null ? null : tracks.find((track) => track.id === trackId) || null;
}

function contactCombination(contact: Contact, tracks: CareerTrack[], combinations: string[]) {
  const fromTrack = trackCombination(linkedTrack(tracks, contact.relatedTrackId), combinations);
  if (fromTrack) return fromTrack;
  return inferCombinationFromText(
    `${contact.who || ""} ${contact.sector || ""} ${contact.why || ""} ${contact.targetOrg || ""} ${contact.targetRole || ""} ${contact.sourceNetwork || ""}`,
    combinations,
  );
}

function learnCombination(item: Learn, tracks: CareerTrack[], combinations: string[]) {
  const fromTrack = trackCombination(linkedTrack(tracks, item.relatedTrackId), combinations);
  if (fromTrack) return fromTrack;
  return inferCombinationFromText(
    `${item.title || ""} ${item.category || ""} ${item.capabilityBuilt || ""} ${item.requiredOutput || ""} ${item.note || ""}`,
    combinations,
  );
}

function hustleCombination(item: Hustle, tracks: CareerTrack[], combinations: string[]) {
  const fromTrack = trackCombination(linkedTrack(tracks, item.proofAssetForTrack), combinations);
  if (fromTrack) return fromTrack;
  return inferCombinationFromText(
    `${item.title || ""} ${item.contentPillar || ""} ${item.coreClaim || ""} ${item.note || ""}`,
    combinations,
  );
}

function jobHasPrepSupport(job: Job) {
  return (job.applicationReadiness || "none") !== "none"
    || !!(job.narrativeAngle || "").trim()
    || !!(job.jdText || "").trim();
}

function buildBroadPursuitCoverage(snapshot: GoalSnapshot): BroadPursuitCoverage {
  const combinations = buildParallelExperiments(snapshot).map((item) => item.combination);
  const coveredSet = new Set(
    snapshot.savedJobs.map((job) => jobCombination(job, combinations)).filter(Boolean) as string[],
  );
  const networkSupportedSet = new Set(
    snapshot.openContacts
      .map((contact) => contactCombination(contact, snapshot.activeTracks, combinations))
      .filter(Boolean) as string[],
  );
  const learningSupportedSet = new Set(
    snapshot.activeLearnItems
      .map((item) => learnCombination(item, snapshot.activeTracks, combinations))
      .filter(Boolean) as string[],
  );
  const jobPrepSupportedSet = new Set(
    snapshot.savedJobs
      .filter((job) => jobHasPrepSupport(job))
      .map((job) => jobCombination(job, combinations))
      .filter(Boolean) as string[],
  );
  const prepSupportedSet = new Set<string>([
    ...learningSupportedSet,
    ...jobPrepSupportedSet,
  ]);
  const exampleProjectSupportedSet = new Set(
    snapshot.activeHustleItems
      .map((item) => hustleCombination(item, snapshot.activeTracks, combinations))
      .filter(Boolean) as string[],
  );
  const covered = combinations.filter((combination) => coveredSet.has(combination));
  const networkSupported = combinations.filter((combination) => networkSupportedSet.has(combination));
  const prepSupported = combinations.filter((combination) => prepSupportedSet.has(combination));
  const learningSupported = prepSupported;
  const exampleProjectSupported = combinations.filter((combination) => exampleProjectSupportedSet.has(combination));
  const missing = combinations.filter((combination) => !covered.includes(combination));
  const missingNetworkSupport = combinations.filter((combination) => coveredSet.has(combination) && !networkSupportedSet.has(combination));
  const missingPrepSupport = combinations.filter((combination) => coveredSet.has(combination) && !prepSupportedSet.has(combination));
  const missingLearningSupport = missingPrepSupport;
  const fullySupported = combinations.filter((combination) => coveredSet.has(combination) && networkSupportedSet.has(combination) && prepSupportedSet.has(combination));
  const laneStates = combinations.map((combination) => ({
    combination,
    roleCount: snapshot.savedJobs.filter((job) => jobCombination(job, combinations) === combination).length,
    contactCount: snapshot.openContacts.filter((contact) => contactCombination(contact, snapshot.activeTracks, combinations) === combination).length,
    prepSupportCount:
      snapshot.savedJobs.filter((job) => jobHasPrepSupport(job) && jobCombination(job, combinations) === combination).length
      + snapshot.activeLearnItems.filter((item) => learnCombination(item, snapshot.activeTracks, combinations) === combination).length,
    learningItemCount: snapshot.activeLearnItems.filter((item) => learnCombination(item, snapshot.activeTracks, combinations) === combination).length,
    exampleProjectItemCount: snapshot.activeHustleItems.filter((item) => hustleCombination(item, snapshot.activeTracks, combinations) === combination).length,
    hasRole: covered.includes(combination),
    hasNetworkSupport: networkSupported.includes(combination),
    hasPrepSupport: prepSupported.includes(combination),
    hasLearningSupport: learningSupported.includes(combination),
    hasExampleProjectSupport: exampleProjectSupported.includes(combination),
  }));
  return { combinations, covered, missing, networkSupported, prepSupported, learningSupported, exampleProjectSupported, missingNetworkSupport, missingPrepSupport, missingLearningSupport, fullySupported, laneStates };
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
    ? "Take any credible role that can land soon across UAE, Remote, or London; keep stronger-fit alternatives warm in parallel."
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
  const summary: OpportunityStateSummary = {
    state: snapshot.opportunityStateKind,
    dominantBlocker: snapshot.dominantOpportunityBlocker,
    summary: "",
    pipeline: {
      savedRoles: snapshot.savedJobs.length,
      viableRoles: snapshot.viableApplicationCount,
      liveProcesses: snapshot.activeOpportunityCount,
      interviews: snapshot.interviewingJobs,
      activeConversations: snapshot.activeConversationCount,
      dueFollowUps: snapshot.dueFollowUpCount,
      apply: snapshot.applicationActionCounts.apply,
      warm: snapshot.applicationActionCounts.warm,
      clarify: snapshot.applicationActionCounts.clarify,
      followUp: snapshot.applicationActionCounts.follow_up,
      prepare: snapshot.applicationActionCounts.prepare,
    },
  };
  summary.summary = describeOpportunityState(summary, snapshot);
  return summary;
}

export function deriveCareerGoalFrame(tasks: Task[], jobs: Job[], log: ActivityLog[] = [], learn: Learn[] = [], contacts: Contact[] = [], hustles: Hustle[] = [], tracks: CareerTrack[] = []) {
  const snapshot = buildGoalSnapshot(tasks, jobs, log, learn, contacts, hustles, tracks);
  const workstreams = workstreamStates(snapshot);
  const frame = buildCareerGoalFrame(snapshot, workstreams);

  return {
    phase: frame.phase,
    dayType: frame.dayType,
    decisionMode: frame.decisionMode,
    landingPriority: frame.landingPriority,
    selectionRule: frame.selectionRule,
    broadParallelPursuit: frame.broadParallelPursuit,
    recommendedFocus: frame.focus.name,
    focusReasonCode: focusReasonCodeFor(frame.focus, frame.phase, snapshot),
  };
}

export function deriveBroadPursuitCoverage(tasks: Task[], jobs: Job[], log: ActivityLog[] = [], learn: Learn[] = [], contacts: Contact[] = [], hustles: Hustle[] = [], tracks: CareerTrack[] = []) {
  const snapshot = buildGoalSnapshot(tasks, jobs, log, learn, contacts, hustles, tracks);
  return buildBroadPursuitCoverage(snapshot);
}

export function buildCareerGoalState(tasks: Task[], jobs: Job[], log: ActivityLog[], learn: Learn[] = [], contacts: Contact[] = [], hustles: Hustle[] = [], tracks: CareerTrack[] = []) {
  const snapshot = buildGoalSnapshot(tasks, jobs, log, learn, contacts, hustles, tracks);
  const workstreams = workstreamStates(snapshot);
  const frame = buildCareerGoalFrame(snapshot, workstreams);
  const opportunityState = buildOpportunityStateSummary(snapshot);
  const candidateUniverse = generateCandidateUniverse(tasks, jobs, snapshot.assets, snapshot.feedback, snapshot.activeTracks);
  const broadPursuitCoverage = frame.broadParallelPursuit ? buildBroadPursuitCoverage(snapshot) : {
    combinations: [],
    covered: [],
    missing: [],
    networkSupported: [],
    prepSupported: [],
    learningSupported: [],
    exampleProjectSupported: [],
    missingNetworkSupport: [],
    missingPrepSupport: [],
    missingLearningSupport: [],
    fullySupported: [],
    laneStates: [],
  };

  return {
    goal: "Find the right role, then become interview- and job-ready",
    status: "active",
    objective: phaseObjective(frame.phase),
    phase: frame.phase,
    dayType: frame.dayType,
    recommendedFocus: frame.focus.name,
    focusReasonCode: focusReasonCodeFor(frame.focus, frame.phase, snapshot),
    reason: phaseReason(frame.phase, frame.focus, snapshot),
    decisionQuestion: phaseDecisionQuestion(frame.phase, snapshot),
    decisionMode: frame.decisionMode,
    landingPriority: frame.landingPriority,
    selectionRule: frame.selectionRule,
    opportunityState,
    locationPreference: buildLocationPreference(snapshot.savedJobs),
    roleHypotheses: snapshot.roleHypotheses,
    comparisonAxes: {
      mode: snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2 ? "two-axis" : snapshot.roleHypotheses.length >= 2 ? "single-axis" : "none",
      topicHypotheses: snapshot.topicHypotheses,
      roleShapeHypotheses: snapshot.roleShapeHypotheses,
      combinations: snapshot.topicHypotheses.slice(0, 2).flatMap((topic) => snapshot.roleShapeHypotheses.slice(0, 2).map((shape) => `${topic} x ${shape}`)),
    },
    comparisonCriteria: (frame.parallelExperiments.length || frame.broadParallelPursuit)
      ? [
          "How energised would you feel doing this work weekly?",
          "How strong is your existing credibility for this option?",
          "How likely is this path to convert into a real offer soon?",
          "How much interview and on-the-job upskilling would it require?",
          "How attractive is the day-to-day work shape, not just the topic?",
        ]
      : [],
    explorationStrategy: frame.broadParallelPursuit
      ? "Run all four options as a broad pursuit portfolio; convert live roles while keeping parallel paths warm."
      : frame.parallelExperiments.length
      ? "Run all four options in parallel for now; collect evidence before forcing a winner."
      : "",
    experiments: frame.broadParallelPursuit ? [] : frame.parallelExperiments,
    pursuitPortfolio: frame.broadParallelPursuit ? buildParallelExperiments(snapshot).map((x) => ({
      combination: x.combination,
      whyPlausible: x.whyPlausible,
      nextMove: broadPursuitCoverage.covered.includes(x.combination)
        ? `Keep one live role warm in this path and only add a new one if the current pipeline goes stale.`
        : x.nextTest.replace(/^Find one /, "Pursue one "),
    })) : [],
    trajectory: trajectoryFor(frame.phase),
    workstreams,
    todayPlan: buildTodayPlan(frame.phase, frame.focus, snapshot, candidateUniverse),
    broadPursuitCoverage,
    trace: [
      "Read career assets, saved jobs, learning items, tasks, role feedback, and activity history.",
      `Current phase is ${frame.phase}.`,
      `Opportunity state is ${opportunityState.state}; dominant blocker is ${opportunityState.dominantBlocker}.`,
      `Selected ${frame.focus.name} because ${frame.focus.bottleneck}.`,
      `Day type is ${frame.dayType}.`,
      "Today plan is a small surface of the goal state, not the whole goal.",
    ],
  };
}

export function registerGoalStateRoutes(app: Express) {
  app.get("/api/goals/state", async (_req, res) => {
    const [tasks, jobs, log, learn, contacts, hustles, tracks] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog(), storage.getLearn(), storage.getContacts(), storage.getHustles(), storage.getCareerTracks()]);
    res.json({ goals: [buildCareerGoalState(tasks, jobs, log, learn, contacts, hustles, tracks)] });
  });
}
