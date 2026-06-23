import type { Express } from "express";
import { GOAL_WORKSTREAM, type GoalWorkstreamName } from "@shared/goalWorkstreams";
import type { ActivityLog, CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { storage, type EntityLink } from "./storage";
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
  const directionReady = (roleHypotheses.length > 0 || activeTracks.length > 0) && (savedJobs.length >= 2 || deconstructionCommits >= 1);

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

type GoalFrame = {
  phase: GoalPhase;
  dayType: "advance" | "maintain" | "recover";
  focus: WorkstreamState;
  decisionMode: DecisionMode;
  landingPriority: string[];
  selectionRule: string;
  parallelExperiments: CombinationTest[];
  broadParallelPursuit: boolean;
};

function phaseObjective(phase: GoalPhase) {
  if (phase === "fit-discovery") return "Discover which role types match your interests, strengths, and constraints";
  if (phase === "lane-narrowing") return "Narrow the exploration to two or three plausible lanes and stress-test each";
  if (phase === "role-targeting") return "Convert the best lane into live applications and active job pursuits";
  if (phase === "interview-prep") return "Prepare thoroughly for live interview processes and convert them into offers";
  return "";
}

function phaseReason(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot) {
  if (phase === "interview-prep") return interviewPrepReason();
  if (phase === "lane-narrowing") {
    if (snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) return laneNarrowingTwoAxisReason(snapshot.topicHypotheses, snapshot.roleShapeHypotheses);
    return laneNarrowingSingleAxisReason(snapshot.roleHypotheses.slice(0, 4));
  }
  return focus.bottleneck;
}

function phaseDecisionQuestion(phase: GoalPhase, snapshot: GoalSnapshot) {
  if (phase === "fit-discovery") return fitDiscoveryDecisionQuestion();
  if (phase === "lane-narrowing") {
    if (snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) return laneNarrowingTwoAxisDecisionQuestion(snapshot.topicHypotheses, snapshot.roleShapeHypotheses);
    return laneNarrowingSingleAxisDecisionQuestion(snapshot.roleHypotheses.slice(0, 4));
  }
  if (phase === "interview-prep") return interviewPrepDecisionQuestion();
  return "";
}

function trajectoryFor(phase: GoalPhase): GoalTrajectoryStep[] {
  const steps: GoalTrajectoryStep[] = [
    {
      key: "discover-fit",
      title: "Discover fit",
      status: phase === "fit-discovery" ? "current" : "complete",
      description: "Explore what roles match your interests, strengths, and constraints.",
    },
    {
      key: "narrow-lane",
      title: "Narrow the lane",
      status: phase === "lane-narrowing" ? "current" : phase === "fit-discovery" ? "pending" : "complete",
      description: "Stress-test two or three directions and pick the most promising.",
    },
    {
      key: "target-role",
      title: "Target roles",
      status: phase === "role-targeting" ? "current" : ["fit-discovery", "lane-narrowing"].includes(phase) ? "pending" : "complete",
      description: "Build a live pipeline of roles worth applying to.",
    },
    {
      key: "prepare-interview",
      title: "Prepare & convert",
      status: phase === "interview-prep" ? "current" : "pending",
      description: "Prepare for live interviews and convert them into offers.",
    },
  ];
  return steps;
}

function workstreamStates(snapshot: GoalSnapshot): WorkstreamState[] {
  const {
    savedJobs,
    activeTracks,
    careerTasks,
    candidateCommits,
    roleFeedbackCount,
    hasNetworkTask,
    openContacts,
    networkContactsCount,
    activeConversationCount,
    warmContactCount,
    roleLinkedContactCount,
    dueFollowUpCount,
    hasApplicationTask,
    activeOpportunityCount,
    viableApplicationCount,
    applicationActionCounts,
    hasProofTask,
    proofSupportDemandCount,
    liveProofAssetCount,
    outlinedProofAssetCount,
    activeLearnCount,
    evidencedLearnCount,
    learningOutputGapCount,
    interviewingJobs,
    directionReady,
    directionStarted,
    feedbackSummary,
    deconstructionCommits,
    opportunityStateKind,
    dominantOpportunityBlocker,
    leadApplicationTruth,
  } = snapshot;

  const exploration: WorkstreamState = (() => {
    if (!directionStarted) {
      return {
        name: GOAL_WORKSTREAM.EXPLORATION,
        status: "underdeveloped",
        progress: "not_started",
        bottleneck: "No roles or direction explored yet — start with one role type or area of interest.",
        nextMoveType: "research",
        evidence: [],
        nextMoves: ["Pick one role type or topic area that interests you and find two real job postings for it."],
      };
    }
    if (!directionReady) {
      return {
        name: GOAL_WORKSTREAM.EXPLORATION,
        status: "active",
        progress: "early",
        bottleneck: "Direction is started but not ready — more role examples or feedback needed.",
        nextMoveType: "research",
        evidence: [
          candidateCommits > 0 ? `${candidateCommits} candidate role type${candidateCommits > 1 ? "s" : ""} committed` : "",
          roleFeedbackCount > 0 ? `${roleFeedbackCount} role feedback signal${roleFeedbackCount > 1 ? "s" : ""} captured` : "",
          savedJobs.length > 0 ? `${savedJobs.length} saved role${savedJobs.length > 1 ? "s" : ""}` : "",
        ].filter(Boolean),
        nextMoves: ["Find one more real role posting and note what appeals or concerns you about it."],
      };
    }
    const positiveSignals = hasSignal(feedbackSummary, "excited") || hasSignal(feedbackSummary, "interested");
    return {
      name: GOAL_WORKSTREAM.EXPLORATION,
      status: directionReady ? "sufficient_for_now" : "active",
      progress: directionReady ? "ready" : "developing",
      bottleneck: directionReady
        ? "Direction is ready — focus shifts to targeting and applications."
        : "More real role examples needed to crystallise direction.",
      nextMoveType: "research",
      evidence: [
        `${savedJobs.length} saved role${savedJobs.length !== 1 ? "s" : ""}`,
        activeTracks.length > 0 ? `${activeTracks.length} active track${activeTracks.length !== 1 ? "s" : ""}` : "",
        roleFeedbackCount > 0 ? `${roleFeedbackCount} role feedback signal${roleFeedbackCount !== 1 ? "s" : ""}` : "",
        positiveSignals ? "Positive role signals captured" : "",
      ].filter(Boolean),
      nextMoves: directionReady
        ? ["Add or refresh one real job posting in the strongest lane."]
        : ["Find two more real roles and note fit signals for each."],
    };
  })();

  const network: WorkstreamState = (() => {
    if (networkContactsCount === 0) {
      return {
        name: GOAL_WORKSTREAM.NETWORK,
        status: "underdeveloped",
        progress: "not_started",
        bottleneck: "No contacts added yet — network access is zero.",
        nextMoveType: "relationship",
        evidence: [],
        nextMoves: ["Add one real person you could contact about a role or sector you are exploring."],
      };
    }
    const hasGoodNetworkSignal = activeConversationCount >= 2 || warmContactCount >= 3;
    return {
      name: GOAL_WORKSTREAM.NETWORK,
      status: dueFollowUpCount > 0
        ? "stale"
        : activeConversationCount === 0 && networkContactsCount < 3
        ? "underdeveloped"
        : hasGoodNetworkSignal
        ? "sufficient_for_now"
        : "active",
      progress: warmContactCount >= 3 ? "ready" : activeConversationCount > 0 ? "developing" : networkContactsCount > 0 ? "early" : "not_started",
      bottleneck: dueFollowUpCount > 0
        ? `${dueFollowUpCount} contact${dueFollowUpCount > 1 ? "s" : ""} due a follow-up — staleness is accumulating.`
        : activeConversationCount === 0
        ? "No active conversations yet — contacts exist but none have been messaged."
        : warmContactCount < 2
        ? "Few warm contacts so far — relationships need more activation."
        : roleLinkedContactCount < 2
        ? "Contacts exist but few are linked to specific roles."
        : "Network is developing — maintain momentum.",
      nextMoveType: "relationship",
      evidence: [
        `${networkContactsCount} contact${networkContactsCount !== 1 ? "s" : ""} tracked`,
        activeConversationCount > 0 ? `${activeConversationCount} active conversation${activeConversationCount !== 1 ? "s" : ""}` : "",
        warmContactCount > 0 ? `${warmContactCount} warm contact${warmContactCount !== 1 ? "s" : ""}` : "",
        dueFollowUpCount > 0 ? `${dueFollowUpCount} overdue follow-up${dueFollowUpCount !== 1 ? "s" : ""}` : "",
      ].filter(Boolean),
      nextMoves: dueFollowUpCount > 0
        ? [`Follow up with the ${dueFollowUpCount} overdue contact${dueFollowUpCount > 1 ? "s" : ""} first.`]
        : activeConversationCount === 0
        ? ["Message one contact with a specific question about a role or sector."]
        : ["Keep one active conversation moving with a concrete follow-up or ask."],
    };
  })();

  const applications: WorkstreamState = (() => {
    if (opportunityStateKind === "empty") {
      return {
        name: GOAL_WORKSTREAM.APPLICATIONS,
        status: directionReady ? "underdeveloped" : "premature",
        progress: "not_started",
        bottleneck: directionReady
          ? "No applications in progress yet — direction is ready so the next step is to start a real pipeline."
          : "Direction not yet clear enough to start applying — build the lane first.",
        nextMoveType: directionReady ? "execution" : "research",
        evidence: [],
        nextMoves: directionReady
          ? ["Find one role in the strongest lane and decide if it is worth applying to."]
          : ["Build direction clarity first before starting applications."],
      };
    }
    const isInterviewing = opportunityStateKind === "interviewing";
    return {
      name: GOAL_WORKSTREAM.APPLICATIONS,
      status: isInterviewing || activeOpportunityCount >= 2 ? "sufficient_for_now" : viableApplicationCount >= 2 ? "active" : "underdeveloped",
      progress: isInterviewing ? "ready" : activeOpportunityCount > 0 ? "developing" : viableApplicationCount > 0 ? "early" : "not_started",
      bottleneck: isInterviewing
        ? "Interview process is live — preparation takes priority."
        : dominantOpportunityBlocker === "assessment"
        ? "One or more roles are at interview stage — preparation is the main unlock."
        : dominantOpportunityBlocker === "access"
        ? "Most promising roles are blocked by access or follow-up, not readiness."
        : dominantOpportunityBlocker === "clarify"
        ? "Roles need clarifying before harder pushing makes sense."
        : dominantOpportunityBlocker === "application"
        ? "Ready-to-apply roles exist — execution is the next step."
        : dominantOpportunityBlocker === "capability"
        ? "Repeated capability gaps are holding back multiple roles."
        : "Keep the pipeline moving and maintain role momentum.",
      nextMoveType: isInterviewing || dominantOpportunityBlocker === "assessment" ? "preparation" : dominantOpportunityBlocker === "access" ? "relationship" : "execution",
      evidence: [
        `${savedJobs.length} saved role${savedJobs.length !== 1 ? "s" : ""}`,
        viableApplicationCount > 0 ? `${viableApplicationCount} viable application${viableApplicationCount !== 1 ? "s" : ""}` : "",
        activeOpportunityCount > 0 ? `${activeOpportunityCount} active opportunit${activeOpportunityCount !== 1 ? "ies" : "y"}` : "",
        isInterviewing ? `${interviewingJobs} interview process${interviewingJobs !== 1 ? "es" : ""} live` : "",
      ].filter(Boolean),
      nextMoves: isInterviewing
        ? ["Prepare for the live interview — research the org, sharpen the story, and run through likely questions."]
        : leadApplicationTruth
        ? [leadApplicationTruth.nextStep || "Move the lead application forward today."]
        : ["Identify the best role in the pipeline and make one concrete move on it today."],
    };
  })();

  const proofUpskilling: WorkstreamState = (() => {
    const proofNeeded = proofSupportDemandCount > 0;
    const hasProof = liveProofAssetCount > 0;
    const hasOutlined = outlinedProofAssetCount > 0;
    if (!proofNeeded && !hasProof && !hasOutlined) {
      return {
        name: GOAL_WORKSTREAM.PROOF_UPSKILLING,
        status: directionReady ? "active" : "premature",
        progress: "not_started",
        bottleneck: directionReady
          ? "No proof assets yet — a short example project would strengthen any application."
          : "Direction not clear enough to build proof assets yet.",
        nextMoveType: "preparation",
        evidence: [],
        nextMoves: directionReady
          ? ["Identify one skill or result that would strengthen your strongest role type and draft a short example."]
          : ["Build direction clarity before creating proof assets."],
      };
    }
    return {
      name: GOAL_WORKSTREAM.PROOF_UPSKILLING,
      status: proofNeeded && !hasProof && !hasOutlined
        ? "underdeveloped"
        : hasProof
        ? "sufficient_for_now"
        : "active",
      progress: hasProof ? "ready" : hasOutlined ? "developing" : proofNeeded ? "early" : "not_started",
      bottleneck: proofNeeded && !hasProof
        ? `${proofSupportDemandCount} role${proofSupportDemandCount !== 1 ? "s" : ""} need proof before they can move — create or outline one example now.`
        : hasProof
        ? "Live proof asset exists — maintain and keep it current."
        : "Proof assets are outlined but not yet live — complete one.",
      nextMoveType: "preparation",
      evidence: [
        hasProof ? `${liveProofAssetCount} live proof asset${liveProofAssetCount !== 1 ? "s" : ""}` : "",
        hasOutlined ? `${outlinedProofAssetCount} outlined proof asset${outlinedProofAssetCount !== 1 ? "s" : ""}` : "",
        proofNeeded ? `${proofSupportDemandCount} role${proofSupportDemandCount !== 1 ? "s" : ""} requesting proof` : "",
      ].filter(Boolean),
      nextMoves: proofNeeded && !hasProof
        ? ["Create or outline one short example that addresses the most common capability gap across your roles."]
        : hasOutlined
        ? ["Complete one outlined proof asset and add evidence of it."]
        : ["Keep existing proof assets current and add new evidence when available."],
    };
  })();

  const prepUpskilling: WorkstreamState = (() => {
    const isInterviewing = opportunityStateKind === "interviewing" || interviewingJobs > 0;
    if (activeLearnCount === 0 && !isInterviewing) {
      return {
        name: GOAL_WORKSTREAM.PREP_UPSKILLING,
        status: directionReady ? "active" : "premature",
        progress: "not_started",
        bottleneck: directionReady
          ? "No active learning items yet — one targeted course or skill would help."
          : "Direction not clear enough to start prep yet.",
        nextMoveType: "learning",
        evidence: [],
        nextMoves: directionReady
          ? ["Identify one skill gap in your strongest lane and find a short course or resource to close it."]
          : ["Build direction clarity before starting prep."],
      };
    }
    return {
      name: GOAL_WORKSTREAM.PREP_UPSKILLING,
      status: isInterviewing
        ? "active"
        : evidencedLearnCount >= 2
        ? "sufficient_for_now"
        : learningOutputGapCount > 0
        ? "underdeveloped"
        : "active",
      progress: evidencedLearnCount >= 2 ? "ready" : activeLearnCount > 0 ? "developing" : "early",
      bottleneck: isInterviewing
        ? "Live interview — preparation takes priority over new learning."
        : learningOutputGapCount > 0
        ? `${learningOutputGapCount} learning item${learningOutputGapCount !== 1 ? "s" : ""} lack output evidence — complete or evidence one.`
        : evidencedLearnCount >= 2
        ? "Prep is solid — maintain and apply."
        : "Learning is active but not yet evidenced — produce one output.",
      nextMoveType: isInterviewing ? "preparation" : "learning",
      evidence: [
        activeLearnCount > 0 ? `${activeLearnCount} active learning item${activeLearnCount !== 1 ? "s" : ""}` : "",
        evidencedLearnCount > 0 ? `${evidencedLearnCount} evidenced` : "",
        learningOutputGapCount > 0 ? `${learningOutputGapCount} without evidence yet` : "",
      ].filter(Boolean),
      nextMoves: isInterviewing
        ? ["Run one timed practice answer for the most likely interview question."]
        : learningOutputGapCount > 0
        ? ["Complete one learning output and add evidence of it."]
        : ["Keep the active learning item moving — log one session or output today."],
    };
  })();

  const energyStability: WorkstreamState = {
    name: GOAL_WORKSTREAM.ENERGY_STABILITY,
    status: "sufficient_for_now",
    progress: "developing",
    bottleneck: "Maintain sustainable search pace — avoid burnout.",
    nextMoveType: "maintenance",
    evidence: [],
    nextMoves: ["Take a short break or do one light maintenance task if energy is low."],
  };

  return [exploration, network, applications, proofUpskilling, prepUpskilling, energyStability];
}

function focusReasonCodeFor(focus: WorkstreamState, phase: GoalPhase, snapshot: GoalSnapshot): FocusReasonCode {
  if (!snapshot.directionStarted) return "target_unclear";
  if (focus.name === GOAL_WORKSTREAM.EXPLORATION && snapshot.savedJobs.length < 2) return "missing_roles";
  if (focus.name === GOAL_WORKSTREAM.NETWORK && snapshot.dueFollowUpCount > 0) return "stale_follow_up";
  if (focus.name === GOAL_WORKSTREAM.NETWORK && snapshot.activeConversationCount === 0) return "network_access";
  if (focus.name === GOAL_WORKSTREAM.APPLICATIONS && snapshot.dominantOpportunityBlocker === "clarify") return "clarify_before_push";
  if (focus.name === GOAL_WORKSTREAM.APPLICATIONS && snapshot.dominantOpportunityBlocker === "capability") return "repeated_capability_gap";
  if (focus.name === GOAL_WORKSTREAM.APPLICATIONS && snapshot.applicationActionCounts.apply > 0) return "live_apply";
  if (focus.name === GOAL_WORKSTREAM.APPLICATIONS && (snapshot.applicationActionCounts.follow_up > 0 || snapshot.applicationActionCounts.warm > 0)) return "live_follow_up";
  if (focus.name === GOAL_WORKSTREAM.APPLICATIONS && snapshot.interviewingJobs > 0) return "live_interview";
  if ((focus.name === GOAL_WORKSTREAM.PROOF_UPSKILLING || focus.name === GOAL_WORKSTREAM.PREP_UPSKILLING) && phase === "role-targeting") return "parallel_support_gap";
  return "general_progress";
}

function buildCareerGoalFrame(snapshot: GoalSnapshot, workstreams: WorkstreamState[]): GoalFrame {
  const phase = detectPhase(snapshot);
  const decisionMode = detectDecisionMode(snapshot);
  const broadParallelPursuit = decisionMode === "broad-parallel-pursuit";
  const parallelExperiments = broadParallelPursuit ? [] : (decisionMode === "parallel-exploration" ? buildParallelExperiments(snapshot) : []);
  const focus = selectFocus(workstreams, phase, snapshot);
  const dayType = detectDayType(snapshot, focus);
  const landingPriority = buildLandingPriority(snapshot);
  const selectionRule = buildSelectionRule(snapshot, phase);
  return {
    phase,
    dayType,
    focus,
    decisionMode,
    landingPriority,
    selectionRule,
    parallelExperiments,
    broadParallelPursuit,
  };
}

function detectPhase(snapshot: GoalSnapshot): GoalPhase {
  if (snapshot.interviewingJobs > 0) return "interview-prep";
  if (snapshot.directionReady && (snapshot.viableApplicationCount >= 1 || snapshot.activeOpportunityCount >= 1)) return "role-targeting";
  if (snapshot.directionStarted && snapshot.roleHypotheses.length > 0) return "lane-narrowing";
  return "fit-discovery";
}

function detectDecisionMode(snapshot: GoalSnapshot): DecisionMode {
  const hasMultipleTopics = snapshot.topicHypotheses.length >= 2;
  const hasMultipleShapes = snapshot.roleShapeHypotheses.length >= 2;
  const hasMultipleLanes = snapshot.roleHypotheses.length >= 2;
  const hasBroadPortfolio = snapshot.savedJobs.length >= 3 && hasMultipleTopics && hasMultipleShapes;
  if (hasBroadPortfolio) return "broad-parallel-pursuit";
  if (hasMultipleTopics && hasMultipleShapes) return "parallel-exploration";
  if (hasMultipleLanes) return "forced-comparison";
  return "single-track";
}

function selectFocus(workstreams: WorkstreamState[], phase: GoalPhase, snapshot: GoalSnapshot): WorkstreamState {
  const findWs = (name: GoalWorkstreamName) => workstreams.find((w) => w.name === name)!;

  if (phase === "interview-prep") return findWs(GOAL_WORKSTREAM.PREP_UPSKILLING);
  if (phase === "fit-discovery") return findWs(GOAL_WORKSTREAM.EXPLORATION);

  const applicationWs = findWs(GOAL_WORKSTREAM.APPLICATIONS);
  const networkWs = findWs(GOAL_WORKSTREAM.NETWORK);
  const explorationWs = findWs(GOAL_WORKSTREAM.EXPLORATION);
  const proofWs = findWs(GOAL_WORKSTREAM.PROOF_UPSKILLING);
  const prepWs = findWs(GOAL_WORKSTREAM.PREP_UPSKILLING);

  if (phase === "lane-narrowing") {
    if (explorationWs.status === "underdeveloped" || snapshot.savedJobs.length < 2) return explorationWs;
    if (networkWs.status === "stale") return networkWs;
    return explorationWs;
  }

  // role-targeting phase
  if (snapshot.interviewingJobs > 0) return prepWs;
  if (snapshot.applicationActionCounts.prepare > 0) return prepWs;
  if (snapshot.applicationActionCounts.follow_up > 0 || snapshot.dueFollowUpCount > 0) return networkWs;
  if (snapshot.applicationActionCounts.apply > 0) return applicationWs;
  if (snapshot.applicationActionCounts.warm > 0) return networkWs;
  if (snapshot.applicationActionCounts.clarify > 0) return explorationWs;
  if (snapshot.proofSupportDemandCount >= 2) return proofWs;
  if (snapshot.viableApplicationCount === 0 && snapshot.savedJobs.length < 3) return explorationWs;
  if (networkWs.status === "stale") return networkWs;
  return applicationWs;
}

function detectDayType(snapshot: GoalSnapshot, focus: WorkstreamState): "advance" | "maintain" | "recover" {
  if (snapshot.interviewingJobs > 0) return "advance";
  if (focus.status === "stale" || snapshot.dueFollowUpCount > 2) return "maintain";
  if (focus.status === "underdeveloped") return "advance";
  return "advance";
}

function buildLandingPriority(snapshot: GoalSnapshot): string[] {
  const priorities: string[] = [];
  if (snapshot.interviewingJobs > 0) priorities.push("interview-prep");
  if (snapshot.applicationActionCounts.prepare > 0) priorities.push("interview-prep");
  if (snapshot.applicationActionCounts.follow_up > 0) priorities.push("follow-up");
  if (snapshot.applicationActionCounts.apply > 0) priorities.push("application");
  if (snapshot.applicationActionCounts.warm > 0) priorities.push("warm-contact");
  if (snapshot.dueFollowUpCount > 0) priorities.push("stale-follow-up");
  if (snapshot.viableApplicationCount === 0) priorities.push("role-discovery");
  return [...new Set(priorities)].slice(0, 4);
}

function buildSelectionRule(snapshot: GoalSnapshot, phase: GoalPhase): string {
  if (phase === "interview-prep") return "Prioritise the live interview above everything else.";
  if (phase === "fit-discovery") return "Pick the role type that feels most interesting and research it first.";
  if (phase === "lane-narrowing") return "Pick the lane with the strongest signal and stress-test it with one real role.";
  if (snapshot.applicationActionCounts.prepare > 0) return "Lead with interview prep; keep the rest of the pipeline warm.";
  if (snapshot.applicationActionCounts.follow_up > 0) return "Lead with the overdue follow-up; then move the next ready-to-apply role.";
  if (snapshot.applicationActionCounts.apply > 0) return "Submit the most ready application today; follow up on any pending ones.";
  return "Move the most promising live role forward by one concrete step.";
}

type TodayPlanBlock = {
  mustDo: string;
  next: string;
  optional: string;
  stopRule: string;
};

function buildTodayPlan(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot, candidateUniverse: ReturnType<typeof generateCandidateUniverse>): TodayPlanBlock {
  if (phase === "role-targeting") {
    if (snapshot.interviewingJobs > 0 || snapshot.applicationActionCounts.prepare > 0) {
      return {
        mustDo: interviewPrepTodayMustDo(),
        next: interviewPrepTodayNext(),
        optional: interviewPrepTodayOptional(),
        stopRule: interviewPrepTodayStopRule(),
      };
    }
    if (snapshot.applicationActionCounts.follow_up > 0 || snapshot.dueFollowUpCount > 0) {
      const count = snapshot.applicationActionCounts.follow_up + snapshot.dueFollowUpCount;
      return {
        mustDo: `Follow up with ${count} contact${count === 1 ? "" : "s"} overdue for a nudge or update.`,
        next: "If a follow-up reply arrives, reply same day.",
        optional: "Add one new contact who could unlock a role you cannot reach directly.",
        stopRule: "Stop after sending or drafting all overdue follow-ups.",
      };
    }
    if (snapshot.applicationActionCounts.apply > 0) {
      return {
        mustDo: `Submit ${snapshot.applicationActionCounts.apply} ready application${snapshot.applicationActionCounts.apply === 1 ? "" : "s"} — pick the strongest and go.`,
        next: "Confirm receipt or find a contact inside the org to warm it up after applying.",
        optional: "Add one new role to keep the pipeline healthy.",
        stopRule: "Stop after submitting — do not spend more than 90 minutes on the application itself.",
      };
    }
    if (snapshot.applicationActionCounts.warm > 0) {
      return {
        mustDo: `Message ${snapshot.applicationActionCounts.warm} contact${snapshot.applicationActionCounts.warm === 1 ? "" : "s"} to warm up a role you cannot reach by applying cold.`,
        next: "If a contact replies, reply same day and move to the next step.",
        optional: "Add one new role to keep the pipeline healthy.",
        stopRule: "Stop after sending the message — do not research more until you hear back.",
      };
    }
    if (snapshot.applicationActionCounts.clarify > 0) {
      return {
        mustDo: `Clarify ${snapshot.applicationActionCounts.clarify} role${snapshot.applicationActionCounts.clarify === 1 ? "" : "s"} before pushing harder — find the missing fact (salary, scope, team size) that would change your decision.`,
        next: "After clarifying, upgrade each role to apply, warm, or reject.",
        optional: "Add one new role to keep the pipeline healthy.",
        stopRule: "Stop after clarifying — do not apply until the question is answered.",
      };
    }
    if (snapshot.proofSupportDemandCount >= 2) {
      return {
        mustDo: `Create or outline one proof asset that addresses the most common capability gap across your ${snapshot.proofSupportDemandCount} roles.`,
        next: "Link the proof asset to the roles it addresses.",
        optional: "Draft a second proof outline if the first comes together quickly.",
        stopRule: "Stop after one completed or well-outlined proof asset.",
      };
    }
  }

  const coverage = buildBroadPursuitCoverage(snapshot);

  if (phase === "role-targeting" && snapshot.savedJobs.length >= 3) {
    if (coverage.missing.length > 0) {
      return {
        mustDo: broadPursuitNextMissingRoleTodayMustDo(coverage.missing),
        next: broadPursuitNextMissingRolePlanNote(coverage.missing),
        optional: "If a live rol