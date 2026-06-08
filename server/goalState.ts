import type { Express } from "express";
import type { ActivityLog, CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { storage } from "./storage";
import { attributeFeedbackFromActivity, attributeFeedbackSummary, careerAssetsFromActivity, generateCandidateUniverse } from "./candidates";
import { computeJobTruthStrip, type JobTruthAction, type JobTruthStrip } from "./jobTruth";

type WorkstreamStatus = "active" | "underdeveloped" | "premature" | "blocked" | "stale" | "sufficient_for_now";
type NextMoveType = "learning" | "relationship" | "preparation" | "execution" | "maintenance" | "wait";
type GoalPhase = "fit-discovery" | "lane-narrowing" | "role-targeting" | "interview-prep";
type TrajectoryStatus = "complete" | "current" | "pending";
type DecisionMode = "single-track" | "forced-comparison" | "parallel-exploration" | "broad-parallel-pursuit";

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

type CombinationTest = {
  combination: string;
  whyPlausible: string;
  nextTest: string;
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
  networkContactsCount: number;
  activeConversationCount: number;
  warmContactCount: number;
  roleLinkedContactCount: number;
  dueFollowUpCount: number;
  draftedContactCount: number;
  hasApplicationTask: boolean;
  viableApplicationCount: number;
  applicationActionCounts: Record<JobTruthAction, number>;
  leadApplicationTruth: JobTruthStrip | null;
  hasProofTask: boolean;
  proofSupportDemandCount: number;
  liveProofAssetCount: number;
  outlinedProofAssetCount: number;
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
  const due = daysUntil(c.nextFollowUpDate || "");
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

function scoreTopicHypothesesFromText(text: string, scores: Map<string, number>) {
  const lower = text.toLowerCase();
  if (/\b(ai|artificial intelligence|ai governance|tech policy|machine learning|frontier model|safety)\b/.test(lower)) {
    addAxisScore(scores, "ai", 2);
  }
  if (/\b(geopolitic|foreign policy|international|security|middle east|geostrateg|geopolitical risk|risk advisory)\b/.test(lower)) {
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
  const topScore = ranked[0]?.[1] || 0;
  return ranked
    .filter(([, score]) => score >= Math.max(2, topScore - 1))
    .map(([key]) => labels[key as T])
    .slice(0, 3);
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
  return rankedHypotheses(scores, ROLE_SHAPE_LABELS);
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
  const leadApplicationTruth = [...viableApplicationTruth.filter((t) => t.action !== "prove")].sort((a, b) => {
    const priorityDiff = APPLICATION_ACTION_PRIORITY[b.action] - APPLICATION_ACTION_PRIORITY[a.action];
    if (priorityDiff !== 0) return priorityDiff;
    return (b.fit.score ?? 0) - (a.fit.score ?? 0);
  })[0] || null;
  const proofSupportDemandCount = applicationActionCounts.prove;
  const hasProofTask = careerTasks.some((t) => /proof|gap|bullet|story|portfolio|sample/i.test(t.title));
  const liveProofAssets = hustles.filter((h) => h.stage === "testing" || h.stage === "earning");
  const outlinedProofAssetCount = hustles.filter((h) => !!((h.nextStep && h.nextStep.trim()) || (h.coreClaim && h.coreClaim.trim()) || (h.firstPostIdea && h.firstPostIdea.trim()))).length;
  const activeLearn = learn.filter((l) => !l.done && l.learnStatus !== "closed");
  const evidencedLearnCount = learn.filter((l) => !!(l.outputEvidenceUrl && l.outputEvidenceUrl.trim())).length;
  const learningOutputGapCount = activeLearn.filter((l) => !!(l.requiredOutput || l.proofIntent) && !(l.outputEvidenceUrl && l.outputEvidenceUrl.trim())).length;
  const interviewingJobs = savedJobs.filter((j) => j.status === "interviewing").length;
  const roleHypotheses = detectRoleHypotheses(tasks, savedJobs, log, activeTracks);
  const topicHypotheses = detectTopicHypotheses(tasks, savedJobs, log, activeTracks);
  const roleShapeHypotheses = detectRoleShapeHypotheses(tasks, savedJobs, log, activeTracks);

  const directionReady = savedJobs.length >= 5 || roleFeedbackCount >= 3 || hasSignal(feedbackSummary, "energising") || hasSignal(feedbackSummary, "credible");
  const directionStarted = savedJobs.length > 0 || activeTracks.length > 0 || candidateCommits > 0 || roleFeedbackCount > 0;
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
    networkContactsCount: openContacts.length,
    activeConversationCount,
    warmContactCount,
    roleLinkedContactCount,
    dueFollowUpCount,
    draftedContactCount,
    hasApplicationTask,
    viableApplicationCount: viableApplicationTruth.length,
    applicationActionCounts,
    leadApplicationTruth,
    hasProofTask,
    proofSupportDemandCount,
    liveProofAssetCount: liveProofAssets.length,
    outlinedProofAssetCount,
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
  return snapshot.savedJobs.length > 0 && snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2;
}

function inferGoalPhase(snapshot: GoalSnapshot): GoalPhase {
  if (snapshot.interviewingJobs > 0) return "interview-prep";
  if (!snapshot.directionStarted) return "fit-discovery";
  if (hasBroadParallelLanes(snapshot)) return "role-targeting";
  if ((snapshot.roleHypotheses.length >= 2 || snapshot.topicHypotheses.length >= 2 || snapshot.roleShapeHypotheses.length >= 2) && !snapshot.hasApplicationTask) return "lane-narrowing";
  return "role-targeting";
}

function workstreamStates(snapshot: GoalSnapshot): WorkstreamState[] {
  const directionEvidence = [
    snapshot.assets.length ? `${snapshot.assets.length} career assets available` : "no career assets recorded",
    snapshot.activeTracks.length ? `${snapshot.activeTracks.length} active career track${snapshot.activeTracks.length === 1 ? "" : "s"}` : "no active career tracks",
    snapshot.savedJobs.length ? `${snapshot.savedJobs.length} open or saved roles` : "no open or saved roles",
    snapshot.candidateCommits ? `${snapshot.candidateCommits} candidate activities committed` : "no candidate activity committed",
    snapshot.roleFeedbackCount ? `${snapshot.roleFeedbackCount} role attribute signals captured` : "no role attribute signals captured",
    snapshot.roleHypotheses.length ? `current hypotheses: ${snapshot.roleHypotheses.join(" vs ")}` : "no clear role hypotheses yet",
    snapshot.topicHypotheses.length ? `topic axis: ${snapshot.topicHypotheses.join(" vs ")}` : "topic axis still unclear",
    snapshot.roleShapeHypotheses.length ? `role-shape axis: ${snapshot.roleShapeHypotheses.join(" vs ")}` : "role-shape axis still unclear",
  ];

  const networkAssets = snapshot.assets.some((a) => a.kind === "network");
  const networkStarted = snapshot.hasNetworkTask || networkAssets || snapshot.networkContactsCount > 0;
  const networkStatus: WorkstreamStatus = !networkStarted
    ? "underdeveloped"
    : snapshot.dueFollowUpCount > 0
      ? "stale"
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
      : snapshot.savedJobs.length > 0 && snapshot.roleLinkedContactCount === 0
        ? ["tie one contact to the strongest live role", "identify who can warm the best current application", "draft one role-linked outreach message"]
        : snapshot.activeConversationCount === 0
          ? ["turn one draft into a sent message", "pick the warmest contact and send a concrete ask", "schedule one follow-up date"]
          : ["move one active thread forward", "make the next ask more specific", "log the next follow-up date"];
  const applicationLead = snapshot.leadApplicationTruth;
  const applicationStatus: WorkstreamStatus = snapshot.viableApplicationCount === 0
    ? (snapshot.directionReady ? "underdeveloped" : "premature")
    : applicationLead ? "active" : "underdeveloped";
  const applicationProgress: WorkstreamState["progress"] = applicationLead?.action === "prepare" || applicationLead?.action === "follow_up"
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
          ? `${snapshot.applicationActionCounts.warm} promising role${snapshot.applicationActionCounts.warm === 1 ? " should" : "s should"} use a warm path before going cold`
          : applicationLead?.action === "clarify"
            ? `${snapshot.applicationActionCounts.clarify} role${snapshot.applicationActionCounts.clarify === 1 ? " still needs" : "s still need"} clarification before real conversion`
            : snapshot.proofSupportDemandCount > 0
              ? `${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from stronger credibility, but that is an upskilling edge rather than an application blocker`
            : snapshot.directionReady
              ? "no role is ready for a concrete conversion move yet"
              : "direction is not ready enough for broad applications";
  const applicationNextMoves = applicationLead?.action === "prepare"
      ? [applicationLead.nextMove, "review the most likely interview themes", "tighten one reusable interview story or capability example"]
    : applicationLead?.action === "follow_up"
      ? [applicationLead.nextMove, "identify the warmest internal nudge for that role", "log the next follow-up point so the role does not disappear"]
    : applicationLead?.action === "apply"
      ? [applicationLead.nextMove, "finish the strongest application material", "submit or clearly schedule the exact next application step"]
    : applicationLead?.action === "warm"
      ? [applicationLead.nextMove, "tie one contact to the live role before applying cold", "send one warm-path message that advances the role"]
    : applicationLead?.action === "clarify"
      ? [applicationLead.nextMove, "confirm the role facts before spending more effort", "decide whether the role is worth keeping in the portfolio"]
      : ["wait until one role has a concrete conversion move", "keep the pipeline selective rather than forcing an application", "do not mass apply yet"];
  const proofStatus: WorkstreamStatus = !snapshot.directionReady && snapshot.liveProofAssetCount === 0 && !snapshot.hasProofTask && snapshot.outlinedProofAssetCount === 0
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
    ? "proof assets are optional value-adds for upskilling, not a blocker for applying"
    : snapshot.liveProofAssetCount > 0 && snapshot.outlinedProofAssetCount === 0
      ? "proof assets exist, but they are not yet concrete enough to convert into reusable evidence"
      : snapshot.liveProofAssetCount > 0
        ? "proof assets are live, but they need the next concrete output"
        : "proof ideas exist, but they are not active yet";
  const proofNextMoves = snapshot.liveProofAssetCount === 0 && !snapshot.hasProofTask && snapshot.outlinedProofAssetCount === 0
    ? ["keep proof as a secondary upskilling layer for now", "start one proof asset only when it will compound your learning", "define the smallest publishable or shippable proof output when you are ready"]
    : snapshot.liveProofAssetCount > 0
      ? ["produce the next concrete output on the live proof asset", "package one existing output into reusable evidence", "connect the proof asset back to the capability it is building"]
      : ["turn one proof idea into a real asset", "pick one output format you can sustain", "connect the asset to a learning goal, not a single role"];
  const capabilityStatus: WorkstreamStatus = snapshot.directionReady || snapshot.interviewingJobs > 0
    ? (snapshot.activeLearnCount > 0 || snapshot.evidencedLearnCount > 0 ? "active" : "underdeveloped")
    : "premature";
  const capabilityProgress: WorkstreamState["progress"] = snapshot.evidencedLearnCount > 0
    ? "developing"
    : snapshot.activeLearnCount > 0
      ? "early"
      : "not_started";
  const capabilityBottleneck = snapshot.interviewingJobs > 0
    ? snapshot.learningOutputGapCount > 0
      ? `${snapshot.learningOutputGapCount} capability-building item${snapshot.learningOutputGapCount === 1 ? " still needs" : "s still need"} a reusable output before the interview`
      : "interview and role preparation need capability-linked practice outputs"
    : snapshot.activeLearnCount === 0 && snapshot.evidencedLearnCount === 0
      ? snapshot.proofSupportDemandCount > 0
        ? `no role-relevant capability plan is active yet, and ${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from stronger capability evidence`
        : "no role-relevant capability plan is active yet"
      : snapshot.proofSupportDemandCount > 0 && snapshot.learningOutputGapCount > 0
        ? `${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from stronger credibility, and ${snapshot.learningOutputGapCount} learning item${snapshot.learningOutputGapCount === 1 ? " still needs" : "s still need"} reusable evidence`
      : snapshot.proofSupportDemandCount > 0
        ? `${snapshot.proofSupportDemandCount} promising role${snapshot.proofSupportDemandCount === 1 ? " would benefit" : "s would benefit"} from stronger capability evidence`
      : snapshot.learningOutputGapCount > 0
        ? `${snapshot.learningOutputGapCount} learning item${snapshot.learningOutputGapCount === 1 ? " still needs" : "s still need"} a reusable output`
        : snapshot.activeLearnCount > 0 && snapshot.evidencedLearnCount === 0
          ? "learning is in motion, but nothing is evidenced yet"
          : "turn learning into reusable job evidence and practice";
  const capabilityNextMoves = snapshot.activeLearnCount === 0 && snapshot.evidencedLearnCount === 0
    ? ["choose one role-relevant capability to strengthen", "start one learning item with a clear output in mind", "define what reusable evidence this learning should produce"]
    : snapshot.proofSupportDemandCount > 0 && snapshot.learningOutputGapCount > 0
      ? ["finish one reusable learning output for the current lane", "turn that output into a reusable interview or credibility artifact", "capture the evidence so Anchor can reuse it later"]
    : snapshot.proofSupportDemandCount > 0
      ? ["strengthen one reusable capability signal for the current lane", "turn existing learning into a reusable proof point", "package one output as reusable evidence"]
    : snapshot.learningOutputGapCount > 0
      ? ["finish one reusable learning output", "attach evidence to the learning item", "turn one learning output into interview or job-ready material"]
        : snapshot.activeLearnCount > 0 && snapshot.evidencedLearnCount === 0
          ? ["move one active learning item to a concrete output", "practice one scenario or framework", "capture one reusable takeaway in writing"]
        : ["convert one learning item into a reusable interview/job artifact", "practice one scenario or framework", "choose the next capability to strengthen"];

  return [
    {
      name: "Direction",
      status: snapshot.directionReady ? "active" : "underdeveloped",
      progress: snapshot.directionReady ? "developing" : snapshot.directionStarted ? "early" : "not_started",
      bottleneck: snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2
        ? "you need to compare both topic and role shape before choosing a lane"
        : snapshot.roleHypotheses.length >= 2
          ? "you still need to choose which lane deserves focused testing"
          : snapshot.directionReady ? "signals need narrowing into one role lane" : "not enough role-family signal",
      nextMoveType: "learning",
      evidence: directionEvidence,
      nextMoves: snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2
        ? [`compare ${snapshot.topicHypotheses[0]} x ${snapshot.roleShapeHypotheses[0]} vs ${snapshot.topicHypotheses[1]} x ${snapshot.roleShapeHypotheses[0]}`, "define what matters most across topic and role shape", "save one concrete role example for each strong combination"]
        : snapshot.roleHypotheses.length >= 2
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
        snapshot.hasNetworkTask ? "network task exists" : "no clear network task",
        networkAssets ? "network assets available" : "no explicit network assets",
      ],
      nextMoves: networkNextMoves,
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
      status: proofStatus,
      progress: proofProgress,
      bottleneck: proofBottleneck,
      nextMoveType: snapshot.liveProofAssetCount > 0 || snapshot.hasProofTask ? "preparation" : "wait",
      evidence: [
        `${snapshot.liveProofAssetCount} live proof asset${snapshot.liveProofAssetCount === 1 ? "" : "s"}`,
        `${snapshot.outlinedProofAssetCount} outlined proof asset${snapshot.outlinedProofAssetCount === 1 ? "" : "s"}`,
        snapshot.deconstructionCommits ? `${snapshot.deconstructionCommits} role deconstruction tasks committed` : "no role deconstruction commitments",
        hasSignal(snapshot.feedbackSummary, "gap") ? "gap feedback exists" : "no explicit proof-gap feedback",
      ],
      nextMoves: proofNextMoves,
    },
    {
      name: "Applications",
      status: applicationStatus,
      progress: applicationProgress,
      bottleneck: applicationBottleneck,
      nextMoveType: applicationLead?.action === "prepare" ? "preparation" : applicationLead ? "execution" : "wait",
      evidence: [
        `${snapshot.savedJobs.length} open or saved role${snapshot.savedJobs.length === 1 ? "" : "s"}`,
        `${snapshot.viableApplicationCount} viable role${snapshot.viableApplicationCount === 1 ? "" : "s"}`,
        `${snapshot.applicationActionCounts.apply} ready-to-apply`,
        `${snapshot.applicationActionCounts.warm} warm-path-first`,
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
      name: "Interview readiness",
      status: snapshot.interviewingJobs > 0 ? "active" : snapshot.savedJobs.length > 0 ? "underdeveloped" : "premature",
      progress: snapshot.interviewingJobs > 0 ? "early" : "not_started",
      bottleneck: snapshot.interviewingJobs > 0 ? "interview stories and role-specific examples need tightening" : snapshot.savedJobs.length > 0 ? "no live interview yet, but prep assets are still thin" : "premature until live roles exist",
      nextMoveType: snapshot.interviewingJobs > 0 ? "preparation" : "wait",
      evidence: [snapshot.interviewingJobs ? `${snapshot.interviewingJobs} interviewing role(s)` : "no interviewing roles yet"],
      nextMoves: snapshot.interviewingJobs > 0 ? ["prepare 3 evidence-backed stories", "simulate one interview answer", "review the company and role thesis"] : ["wait until a live interview exists"],
    },
    {
      name: "Capability ramp",
      status: capabilityStatus,
      progress: capabilityProgress,
      bottleneck: capabilityBottleneck,
      nextMoveType: snapshot.directionReady || snapshot.interviewingJobs > 0 ? "learning" : "wait",
      evidence: [
        snapshot.activeLearnCount ? `${snapshot.activeLearnCount} active learning item(s)` : "no active learning items",
        snapshot.evidencedLearnCount ? `${snapshot.evidencedLearnCount} evidenced learning output(s)` : "no evidenced learning outputs",
        snapshot.learningOutputGapCount ? `${snapshot.learningOutputGapCount} learning item(s) still need an output` : "learning outputs are in better shape",
        `${snapshot.proofSupportDemandCount} role${snapshot.proofSupportDemandCount === 1 ? "" : "s"} that could benefit from stronger capability evidence`,
      ],
      nextMoves: snapshot.directionReady || snapshot.interviewingJobs > 0 ? capabilityNextMoves : ["wait until the target lane is clearer"],
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
  const network = workstreams.find((w) => w.name === "Network");
  if ((phase === "role-targeting" || phase === "interview-prep") && network?.status === "stale") return network;

  const priorityByPhase: Record<GoalPhase, string[]> = {
    "fit-discovery": ["Direction", "Market map", "Network", "Energy and stability"],
    "lane-narrowing": ["Direction", "Positioning", "Market map", "Network", "Energy and stability"],
    "role-targeting": ["Applications", "Network", "Positioning", "Capability ramp", "Proof", "Energy and stability"],
    "interview-prep": ["Interview readiness", "Network", "Capability ramp", "Applications", "Proof", "Energy and stability"],
  };
  return priorityByPhase[phase]
    .map((name) => workstreams.find((w) => w.name === name))
    .find((w) => w && ["underdeveloped", "active", "stale", "blocked"].includes(w.status) && w.nextMoveType !== "wait") || workstreams[0];
}

function dayTypeFor(focus: WorkstreamState) {
  if (focus.name === "Interview readiness") return "interview-prep";
  if (focus.name === "Capability ramp" || focus.name === "Proof") return "capability-building";
  if (focus.name === "Energy and stability") return "stabilising";
  if (focus.nextMoveType === "relationship") return "network-building";
  if (focus.nextMoveType === "execution") return "conversion";
  return "signal-building";
}

function phaseObjective(phase: GoalPhase) {
  if (phase === "fit-discovery") return "identify role families that genuinely fit your interests, goals, and energy";
  if (phase === "lane-narrowing") return "decide which promising lane deserves focused testing before over-investing in applications";
  if (phase === "role-targeting") return "convert the chosen lane into live roles, selective applications, and stronger positioning";
  return "prepare to perform strongly in the interview and strengthen the capabilities the role will demand";
}

function phaseReason(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot) {
  if (phase === "role-targeting" && hasBroadParallelLanes(snapshot)) {
    return `You need a job, so Anchor should keep multiple plausible lanes open in parallel and convert the most credible live roles instead of forcing an early identity choice. Location stays flexible across UAE, Remote, and London.`;
  }
  if (phase === "lane-narrowing" && snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) {
    return `You have multiple plausible topics (${snapshot.topicHypotheses.join(" vs ")}) and multiple plausible role shapes (${snapshot.roleShapeHypotheses.join(" vs ")}). Anchor should narrow on both axes together.`;
  }
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
  if (phase === "role-targeting" && hasBroadParallelLanes(snapshot)) {
    return "Which live roles are most gettable, credible, and worth pushing right now while keeping the other lanes open?";
  }
  if (phase === "lane-narrowing") {
    if (snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) {
      return `What are you learning from each of the four combinations, and which ones keep earning more attention over time?`;
    }
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
    "target-role": { key: "target-role", title: "Target live roles", description: "Turn the chosen lane into real roles, capability support, and selective applications." },
    "prepare-interview": { key: "prepare-interview", title: "Prepare for interviews", description: "Build stories, examples, and role knowledge for live interview processes." },
    "capability-ramp": { key: "capability-ramp", title: "Build job-ready capability", description: "Upskill for the interview and the role so you can perform strongly once in seat." },
  };
  return order.map((key, index) => ({
    ...titles[key],
    status: index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending",
  }));
}

function buildTodayPlan(phase: GoalPhase, focus: WorkstreamState, snapshot: GoalSnapshot, candidateUniverse: ReturnType<typeof generateCandidateUniverse>) {
  if (phase === "role-targeting" && hasBroadParallelLanes(snapshot)) {
    return {
      mustDo: "Advance the most gettable live role now and keep the other plausible lanes warm in parallel",
      next: "Add or refresh one credible role in a second lane so you are not betting everything on a single path",
      optional: "Capture which lanes are producing the best mix of fit, realism, and response",
      stopRule: "Stop after one real conversion move and one parallel-portfolio maintenance move.",
    };
  }
  if (phase === "lane-narrowing") {
    if (snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2) {
      const topicA = snapshot.topicHypotheses[0] || "topic one";
      const topicB = snapshot.topicHypotheses[1] || "topic two";
      const shapeA = snapshot.roleShapeHypotheses[0] || "role shape one";
      const shapeB = snapshot.roleShapeHypotheses[1] || "role shape two";
      return {
        mustDo: `Compare ${topicA} x ${shapeA}, ${topicA} x ${shapeB}, ${topicB} x ${shapeA}, and ${topicB} x ${shapeB}`,
        next: "Save one real role example for each of the four combinations and note what energises, drains, or surprises you",
        optional: "Ask one warm contact which of the four combinations looks strongest from the outside",
        stopRule: "Stop after one real comparison grid and one concrete note for each combination; do not spiral into open-ended browsing.",
      };
    }
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
    next: focus.nextMoves[1] || candidateUniverse.recommended?.activity || "Strengthen one capability or positioning asset",
    optional: focus.name === "Energy and stability" ? "Stop after the minimum viable action" : "Do one small maintenance action so the day stays sustainable",
    stopRule: focus.nextMoveType === "learning" ? "Stop after one useful signal or 20 minutes." : "Stop once the defined small action is complete.",
  };
}

function whyPlausibleForCombination(topic: string, shape: string) {
  if (/AI/i.test(topic) && /Strategy|advisory/i.test(shape)) return "Matches your interest in AI while preserving strategic, externally-facing work.";
  if (/AI/i.test(topic) && /Ops|chief of staff/i.test(shape)) return "Lets you stay close to AI while testing whether you prefer execution and operating rhythm.";
  if (/Geopolitics/i.test(topic) && /Strategy|advisory/i.test(shape)) return "Matches substantive geopolitical interest with a classic advisory shape.";
  if (/Geopolitics/i.test(topic) && /Ops|chief of staff/i.test(shape)) return "Tests whether you want geopolitical substance with a more internal, execution-heavy role shape.";
  return "Plausible based on the signals Anchor has seen so far.";
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
  const topics = snapshot.topicHypotheses.slice(0, 2);
  const shapes = snapshot.roleShapeHypotheses.slice(0, 2);
  return topics.flatMap((topic) => shapes.map((shape) => ({
    combination: `${topic} x ${shape}`,
    whyPlausible: whyPlausibleForCombination(topic, shape),
    nextTest: nextTestForCombination(topic, shape),
  })));
}

function buildCareerGoalFrame(snapshot: GoalSnapshot, workstreams: WorkstreamState[]) {
  const phase = inferGoalPhase(snapshot);
  const focus = recommendedFocus(workstreams, phase);
  const parallelExperiments = phase === "lane-narrowing" && snapshot.topicHypotheses.length >= 2 && snapshot.roleShapeHypotheses.length >= 2
    ? buildParallelExperiments(snapshot)
    : [];
  const broadParallelPursuit = phase === "role-targeting" && hasBroadParallelLanes(snapshot);
  const decisionMode: DecisionMode = broadParallelPursuit
    ? "broad-parallel-pursuit"
    : parallelExperiments.length
      ? "parallel-exploration"
      : phase === "lane-narrowing"
        ? "forced-comparison"
        : "single-track";
  const landingPriority = broadParallelPursuit ? "credible-role-quickly" : "best-fit-over-time";
  const selectionRule = broadParallelPursuit
    ? "Take any credible role that can land soon across UAE, Remote, or London; keep stronger-fit alternatives warm in parallel."
    : "Prefer the strongest-fit lane unless live evidence says otherwise.";

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
  };
}

export function buildCareerGoalState(tasks: Task[], jobs: Job[], log: ActivityLog[], learn: Learn[] = [], contacts: Contact[] = [], hustles: Hustle[] = [], tracks: CareerTrack[] = []) {
  const snapshot = buildGoalSnapshot(tasks, jobs, log, learn, contacts, hustles, tracks);
  const workstreams = workstreamStates(snapshot);
  const frame = buildCareerGoalFrame(snapshot, workstreams);
  const candidateUniverse = generateCandidateUniverse(tasks, jobs, snapshot.assets, snapshot.feedback, snapshot.activeTracks);

  return {
    goal: "Find the right role, then become interview- and job-ready",
    status: "active",
    objective: phaseObjective(frame.phase),
    phase: frame.phase,
    dayType: frame.dayType,
    recommendedFocus: frame.focus.name,
    reason: phaseReason(frame.phase, frame.focus, snapshot),
    decisionQuestion: phaseDecisionQuestion(frame.phase, snapshot),
    decisionMode: frame.decisionMode,
    landingPriority: frame.landingPriority,
    selectionRule: frame.selectionRule,
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
          "How strong is your existing credibility for this combination?",
          "How likely is this lane to convert into a real offer soon?",
          "How much interview and on-the-job upskilling would it require?",
          "How attractive is the day-to-day work shape, not just the topic?",
        ]
      : [],
    explorationStrategy: frame.broadParallelPursuit
      ? "Run all four combinations as a broad pursuit portfolio; convert live roles while keeping parallel lanes warm."
      : frame.parallelExperiments.length
      ? "Run all four combinations in parallel for now; collect evidence before forcing a winner."
      : "",
    experiments: frame.broadParallelPursuit ? [] : frame.parallelExperiments,
    pursuitPortfolio: frame.broadParallelPursuit ? buildParallelExperiments(snapshot).map((x) => ({
      combination: x.combination,
      whyPlausible: x.whyPlausible,
      nextMove: x.nextTest.replace(/^Find one /, "Pursue one "),
    })) : [],
    trajectory: trajectoryFor(frame.phase),
    workstreams,
    todayPlan: buildTodayPlan(frame.phase, frame.focus, snapshot, candidateUniverse),
    trace: [
      "Read career assets, saved jobs, learning items, tasks, role feedback, and activity history.",
      `Current phase is ${frame.phase}.`,
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
