import type { CareerTrack, Contact, Hustle, Job, Learn, Task, UserProfile } from "@shared/schema";
import { getLearnOutputState, isOpportunityActionable } from "@shared/domainState";
import { GOAL_WORKSTREAM } from "@shared/goalWorkstreams";
import { isGenericContactPlaceholder, nextContactTaskTitle } from "@shared/taskPreview";
import { buildTrackSpine } from "./trackSpine";
import { contractForTaskIntent, likelyLearningGapPlan } from "./taskIntent";
import {
  broadPursuitMissingContactsContextReason,
  broadPursuitMissingContactsDoneWhen,
  broadPursuitMissingContactsFirstStep,
  broadPursuitNextMissingContactPlanNote,
  broadPursuitMissingContactsSourceFrame,
  broadPursuitMissingContactsSourceNote,
  broadPursuitMissingContactsStopRule,
  broadPursuitMissingContactsTitle,
  broadPursuitMissingContactsUnlockMove,
  broadPursuitMissingContactsWhyNow,
  broadPursuitMissingPrepContextReason,
  broadPursuitMissingPrepDoneWhen,
  broadPursuitMissingPrepFirstStep,
  broadPursuitMissingSupportContextReason,
  broadPursuitMissingSupportTodayMustDo,
  broadPursuitNextMissingPrepPlanNote,
  broadPursuitMissingPrepSourceFrame,
  broadPursuitMissingPrepSourceNote,
  broadPursuitMissingPrepStopRule,
  broadPursuitMissingPrepTitle,
  broadPursuitMissingPrepUnlockMove,
  broadPursuitMissingPrepWhyNow,
  broadPursuitMissingRolesContextReason,
  broadPursuitMissingRolesDoneWhen,
  broadPursuitMissingRolesFirstStep,
  broadPursuitNextMissingRolePlanNote,
  broadPursuitMissingRolesPlanNote,
  broadPursuitMissingRolesSourceFrame,
  broadPursuitMissingRolesSourceNote,
  broadPursuitMissingRolesStopRule,
  broadPursuitMissingRolesTitle,
  broadPursuitMissingRolesUnlockMove,
  broadPursuitMissingRolesWhyNow,
  displayCombination,
} from "./broadPursuitCopy";
import { deriveBroadPursuitCoverage, deriveCareerGoalFrame } from "./goalState";
import { LANE_NAME, laneFocusAreaLabel, type CanonicalLaneName } from "./lanes";
import { computeJobTruthStrip, type JobTruthAction } from "./jobTruth";

// ─────────────────────────────────────────────────────────────────────────
// ANCHOR BRAIN — adaptive sequencer (NOT a balanced-day picker).
// Canonical decision flow:
// 1) read the canonical Tracks × Lanes spine, 2) gather eligible actions,
// 3) exclude only truly unavailable items, 4) score by track/application leverage,
// 5) sequence against the remaining day, 6) explain the conclusion lightly.
// User-selected roles are intentional inputs: Anchor helps make applications
// stronger and the profile more marketable; it is not a gatekeeper.
// ─────────────────────────────────────────────────────────────────────────

const CATEGORY_RANK: Record<string, number> = {
  job: 1, substack: 2, interview: 3, health: 4, learning: 5, hustle: 6, afterline: 6, admin: 7,
};
const CATEGORY_FAMILY: Record<string, string> = {
  job: "job", interview: "job",
  substack: "output", afterline: "output", hustle: "output",
  learning: "growth",
  health: "care", admin: "care",
};

type Energy = "low" | "medium" | "high";
const SIZE_MINUTES: Record<string, number> = { quick: 15, medium: 45, deep: 120 };
type ActionCategory = "pursue" | "prepare" | "develop" | "decide" | "wait";

export type Candidate = {
  source: "task" | "job" | "learn" | "hustle" | "contact" | "goal";
  sourceId: number;
  title: string;
  category: string;
  size: string;
  deadline: string;
  status: string;
  skipped: number;
  sourceUrl: string;
  sourceNote: string;
  sourceStatus: string;
  doneWhen: string;
  whyNow: string;
  fitScore: number | null;
  blocked: boolean;
  blockerReason: string;
  eligibilityRisk: string;
  taskId: number | null;
  location?: string;
  warmPathScore?: number | null;
  strategicValue?: number | null;
  frictionScore?: number | null;
  applicationReadiness?: string;
  deadlineConfidence?: string;
  narrativeAngle?: string;
  relationshipStrength?: string;
  askType?: string;
  messageDraft?: string;
  sourceNetwork?: string;
  targetOrg?: string;
  targetRole?: string;
  followUpDate?: string;
  jobTruthAction?: JobTruthAction;
  milestoneProgress?: { done: number; total: number };
  linkedContactNames?: string[];
  blockedBy?: string;
  companyBrief?: string;
};

type StrategicContext = {
  bottleneck: string;
  reason: string;
  applicationsPremature: false;
  recommendedExploration: string;
  laneModel: { trace: string[] };
  bottleneckLane: CanonicalLaneName;
  laneStage: string;
  laneUnlockMove: string;
  activeTrackName: string;
  liveJobTargets: Array<{ title: string; company: string; roleArchetype?: string }>;
  broadPursuitMissingCombinations: string[];
  broadPursuitCoveredCombinations: string[];
  broadPursuitMissingNetworkSupport: string[];
  broadPursuitMissingLearningSupport: string[];
  goalPhase: ReturnType<typeof deriveCareerGoalFrame>["phase"];
  goalDayType: ReturnType<typeof deriveCareerGoalFrame>["dayType"];
  decisionMode: ReturnType<typeof deriveCareerGoalFrame>["decisionMode"];
  planningPosture: "exploration" | "conversion" | "interview" | "capability";
  activeOpportunityCount: number;
  clarifyBeforePush: boolean;
  searchPhase: string;
  profilePosture: StrategicContext["planningPosture"] | "";
  targetRoles: string;
  targetRolePreferenceTerms: string[][];
  locationPreferences: string;
  locationPreferenceTerms: string[][];
};

const DEFAULT_STRATEGIC_CONTEXT: StrategicContext = {
  bottleneck: "Progress",
  reason: "",
  applicationsPremature: false,
  recommendedExploration: "",
  laneModel: { trace: [] },
  bottleneckLane: LANE_NAME.STABILITY,
  laneStage: "steady",
  laneUnlockMove: "",
  activeTrackName: "",
  liveJobTargets: [],
  broadPursuitMissingCombinations: [],
  broadPursuitCoveredCombinations: [],
  broadPursuitMissingNetworkSupport: [],
  broadPursuitMissingLearningSupport: [],
  goalPhase: "fit-discovery",
  goalDayType: "exploration",
  decisionMode: "parallel-exploration",
  planningPosture: "exploration",
  activeOpportunityCount: 0,
  clarifyBeforePush: false,
  searchPhase: "",
  profilePosture: "",
  targetRoles: "",
  targetRolePreferenceTerms: [],
  locationPreferences: "UAE first, remote ok, London ok",
  locationPreferenceTerms: [["uae", "dubai", "abu dhabi", "emirates"], ["remote"], ["london"]],
};

type RankedCandidate = { c: Candidate; s: number; trace: string[] };

export type PlanTrace = {
  picked: string[];
  ignored: string[];
  bottleneck: string;
  reason: string;
  remainingMinutes: number;
  laneTrace?: string[];
};

export type RecommendationExplanation = {
  summary: string;
  whyNow: string;
  whyThis: string;
  supportingReasons: string[];
  firstStep: string;
  stopRule: string;
};

type SourceKind = Candidate["source"] | "task";
type NetworkingIntent = "conversion" | "interview" | "exploration" | "capability";
type PlanningProfile = Partial<Pick<UserProfile, "targetRoles" | "locationPreferences" | "searchPhase">> | null | undefined;

function daysUntil(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T23:59:59");
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function locationTier(location: string) {
  const lower = (location || "").toLowerCase();
  if (/\b(uae|dubai|abu dhabi|emirates)\b/.test(lower)) return "UAE";
  if (/\b(remote|distributed|anywhere|work from home|wfh)\b/.test(lower)) return "Remote";
  if (/\b(london|uk|united kingdom|england)\b/.test(lower)) return "London";
  return "Other";
}

function normalizeLocationTerm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function expandLocationPreferenceTerm(term: string) {
  const t = normalizeLocationTerm(term);
  if (!t) return [];
  if (/\buae\b|dubai|abu dhabi|emirates/.test(t)) return ["uae", "dubai", "abu dhabi", "emirates"];
  if (/remote|distributed|anywhere|wfh|work from home/.test(t)) return ["remote", "distributed", "anywhere", "work from home", "wfh"];
  if (/london/.test(t)) return ["london"];
  if (/\buk\b|united kingdom|england/.test(t)) return ["uk", "united kingdom", "england", "london"];
  if (/new york|nyc/.test(t)) return ["new york", "nyc"];
  if (/washington|dc/.test(t)) return ["washington", "dc"];
  return [t];
}

function locationPreferenceTerms(preferences?: string | null) {
  const raw = (preferences || DEFAULT_STRATEGIC_CONTEXT.locationPreferences).trim();
  const parts = raw
    .split(/[,;\n]|(?:\s+>\s+)|(?:\s+then\s+)/i)
    .map((part) => part.replace(/\b(first|preferred|preference|ok|okay|fine|fallback|open to|priority)\b/gi, " "))
    .map((part) => expandLocationPreferenceTerm(part))
    .filter((terms) => terms.length > 0);
  return parts.length ? parts : DEFAULT_STRATEGIC_CONTEXT.locationPreferenceTerms;
}

function rolePreferenceTerms(targetRoles?: string | null) {
  return (targetRoles || "")
    .split(/[,;\n]|(?:\s+\/\s+)|(?:\s+\|\s+)|(?:\s+ or\s+)/i)
    .map((part) => normalizeText(part))
    .map((part) => significantWords(part))
    .filter((words) => words.length > 0);
}

function rolePreferenceMomentum(c: Candidate, context: StrategicContext) {
  const preferences = context.targetRolePreferenceTerms || [];
  if (!preferences.length) return { score: 0, reason: "" };
  const candidateWords = new Set(significantWords(`${c.title} ${c.sourceNote} ${c.targetRole || ""} ${(c as any).roleArchetype || ""}`));
  let best = 0;
  for (const terms of preferences) {
    const overlap = terms.filter((term) => candidateWords.has(term)).length;
    if (overlap === 0) continue;
    const coverage = overlap / Math.max(1, terms.length);
    const score = overlap >= 2 || coverage >= 0.67 ? 18 : 9;
    best = Math.max(best, score);
  }
  return best > 0
    ? { score: best, reason: best >= 18 ? "matches your saved target role types" : "partly matches your saved target role types" }
    : { score: 0, reason: "" };
}

function guessSize(title: string, fallback = "medium"): string {
  const t = (title || "").toLowerCase();
  if (/\b(open|check|confirm|email|message|send|note|skim|read one|sign up|list|book|call)\b/.test(t)) return "quick";
  if (/\b(write|draft|apply|prepare|build|outline|tailor|research|finish)\b/.test(t)) return "deep";
  return fallback;
}

function normalizeText(text: string) {
  return (text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function significantWords(text: string) {
  return normalizeText(text).split(" ").filter((w) => w.length >= 4);
}

function isApplicationLike(c: Candidate) {
  return c.category === "job" || /apply|application|interview|cover|submit|cv|resume|follow up|follow-up|tailor|posting|requirements/i.test(`${c.title} ${c.whyNow}`);
}

function isDirectionSignal(c: Candidate) {
  if (c.source === "contact" && ((c.targetOrg && c.targetOrg.trim()) || (c.targetRole && c.targetRole.trim()))) return true;
  if (isApplicationLike(c)) return false;
  return /direction|role|career|inspect|signal|attribute|explore|job family|research|fit|path|market map|pattern/i.test(`${c.title} ${c.whyNow} ${c.sourceNote}`);
}

function isProofAsset(c: Candidate) {
  return CATEGORY_FAMILY[c.category] === "output" || /proof|substack|memo|forecast|portfolio|publish|story bank|cv bullet|case study/i.test(`${c.title} ${c.sourceNote}`);
}

function isNetworkLike(c: Candidate) {
  return /network|contact|message|coffee|intro|referral|follow up|follow-up|whatsapp|email/i.test(`${c.title} ${c.whyNow} ${c.sourceNote}`);
}

function isLearningLike(c: Candidate) {
  return c.category === "learning" || c.source === "learn" || /learn|read|course|resource|podcast|book|study|output|practice|drill|development/i.test(`${c.title} ${c.whyNow} ${c.sourceNote}`);
}

function candidateMatchesLane(c: Candidate, lane: CanonicalLaneName) {
  if (lane === LANE_NAME.DIRECTION) return isDirectionSignal(c);
  if (lane === LANE_NAME.APPLICATIONS) return isApplicationLike(c);
  if (lane === LANE_NAME.NETWORK) return isNetworkLike(c);
  if (lane === LANE_NAME.PROOF_ASSETS) return isProofAsset(c);
  if (lane === LANE_NAME.LEARNING_DEVELOPMENT) return isLearningLike(c);
  if (lane === LANE_NAME.STABILITY) return c.blocked || c.category === "admin" || c.category === "health";
  return false;
}

function genericDoneWhen(text: string) {
  const normalized = normalizeText(text);
  return !normalized
    || normalized === "the smallest useful outcome is complete"
    || normalized === "that step is done"
    || normalized === "you ve made real progress"
    || normalized === "the task s next visible outcome is complete";
}

function taskStillNeedsClarifying(c: Candidate) {
  if (c.source !== "task") return false;
  const broadTitle = /\b(figure out|look into|sort out|work on|make progress|career|jobs?|research|explore)\b/i.test(c.title || "");
  const noConcreteAnchor = !(c.sourceUrl && c.sourceUrl.trim()) && !(c.sourceNote && c.sourceNote.trim());
  return broadTitle && noConcreteAnchor && genericDoneWhen(c.doneWhen || "");
}

function startabilityMomentum(c: Candidate) {
  let score = 0;
  const trace: string[] = [];

  if (c.source !== "goal" && c.size === "quick") {
    score += 8;
    trace.push("easy to start in one sitting");
  } else if (c.source !== "goal" && c.size === "medium") {
    score += 2;
  } else if (c.source !== "goal" && c.size === "deep") {
    score -= 3;
    trace.push("heavier start-up cost");
  }

  if (c.source === "task" && c.status === "in_progress") {
    score += 8;
    trace.push("already in motion");
  }

  if ((c.source === "task" || c.source === "learn") && c.sourceUrl && c.sourceUrl.trim()) {
    score += 4;
    trace.push("source is already saved and easy to open");
  }

  if (c.source === "task" && taskStillNeedsClarifying(c)) {
    score -= 14;
    trace.push("needs a clearer first step before it should lead");
  }

  return { score, trace };
}

function planningPostureFromGoalFrame(
  goalFrame: ReturnType<typeof deriveCareerGoalFrame>,
  bottleneckLane: CanonicalLaneName,
  hasActiveLearning: boolean,
): StrategicContext["planningPosture"] {
  if (goalFrame.phase === "interview-prep") return "interview";
  if (goalFrame.phase === "fit-discovery" || goalFrame.phase === "lane-narrowing") return "exploration";
  if (goalFrame.recommendedFocus === GOAL_WORKSTREAM.PREP_UPSKILLING || goalFrame.recommendedFocus === GOAL_WORKSTREAM.PROJECTS_PUBLIC_WORK) return "capability";
  if (goalFrame.recommendedFocus === GOAL_WORKSTREAM.APPLICATIONS || goalFrame.recommendedFocus === GOAL_WORKSTREAM.NETWORK || goalFrame.recommendedFocus === GOAL_WORKSTREAM.POSITIONING) {
    return "conversion";
  }
  if (goalFrame.decisionMode === "broad-parallel-pursuit") return "conversion";
  if (bottleneckLane === LANE_NAME.LEARNING_DEVELOPMENT || bottleneckLane === LANE_NAME.PROOF_ASSETS || hasActiveLearning) return "capability";
  if (goalFrame.dayType === "interview-prep") return "interview";
  if (goalFrame.dayType === "capability-building") return "capability";
  if (goalFrame.dayType === "conversion") return "conversion";
  return "exploration";
}

function planningPostureFromSearchPhase(searchPhase?: string | null): StrategicContext["planningPosture"] | "" {
  const phase = normalizeText(searchPhase || "");
  if (!phase) return "";
  if (/\b(interview|interviewing|panel|case|assessment|process)\b/.test(phase)) return "interview";
  if (/\b(apply|applying|application|applications|active pursuit|actively|submitting|pipeline)\b/.test(phase)) return "conversion";
  if (/\b(upskill|upskilling|learning|learn|capability|skill|skills|prep|prepping)\b/.test(phase)) return "capability";
  if (/\b(explore|exploring|discovery|deciding|figuring|narrowing|researching)\b/.test(phase)) return "exploration";
  return "";
}

function mergePlanningPosture(
  inferred: StrategicContext["planningPosture"],
  profilePosture: StrategicContext["planningPosture"] | "",
  activeOpportunityCount: number,
): StrategicContext["planningPosture"] {
  if (!profilePosture) return inferred;
  if (profilePosture === "exploration" && activeOpportunityCount > 0) return inferred;
  return profilePosture;
}

function laneForProfilePosture(posture: StrategicContext["planningPosture"] | ""): CanonicalLaneName | "" {
  if (posture === "conversion" || posture === "interview") return LANE_NAME.APPLICATIONS;
  if (posture === "capability") return LANE_NAME.LEARNING_DEVELOPMENT;
  if (posture === "exploration") return LANE_NAME.DIRECTION;
  return "";
}

function desiredLaneOrder(posture: StrategicContext["planningPosture"]): CanonicalLaneName[] {
  if (posture === "interview") return [LANE_NAME.APPLICATIONS, LANE_NAME.NETWORK, LANE_NAME.LEARNING_DEVELOPMENT, LANE_NAME.PROOF_ASSETS, LANE_NAME.DIRECTION, LANE_NAME.STABILITY];
  if (posture === "conversion") return [LANE_NAME.APPLICATIONS, LANE_NAME.NETWORK, LANE_NAME.LEARNING_DEVELOPMENT, LANE_NAME.PROOF_ASSETS, LANE_NAME.DIRECTION, LANE_NAME.STABILITY];
  if (posture === "capability") return [LANE_NAME.LEARNING_DEVELOPMENT, LANE_NAME.PROOF_ASSETS, LANE_NAME.NETWORK, LANE_NAME.APPLICATIONS, LANE_NAME.DIRECTION, LANE_NAME.STABILITY];
  return [LANE_NAME.DIRECTION, LANE_NAME.NETWORK, LANE_NAME.LEARNING_DEVELOPMENT, LANE_NAME.APPLICATIONS, LANE_NAME.PROOF_ASSETS, LANE_NAME.STABILITY];
}

function laneBalanceWindow(posture: StrategicContext["planningPosture"]) {
  if (posture === "interview") return 18;
  if (posture === "conversion") return 24;
  if (posture === "capability") return 30;
  return 34;
}

function countActiveOpportunities(jobs: Job[]) {
  return jobs.filter((job) =>
    job.status === "applied"
    || job.status === "interviewing"
    || job.applicationReadiness === "submitted"
    || job.applicationReadiness === "follow_up",
  ).length;
}

function buildStrategicContext(
  tasks: Task[],
  jobs: Job[],
  learn: Learn[],
  hustles: Hustle[],
  contacts: Contact[] = [],
  tracks: CareerTrack[] = [],
  profile?: PlanningProfile,
): StrategicContext {
  const spine = buildTrackSpine({ tasks, jobs, learn, hustles, contacts, tracks });
  const lane = spine.globalLanes.find((l) => l.name === spine.bestMove.lane) || spine.globalLanes[0];
  const goalFrame = deriveCareerGoalFrame(tasks, jobs, [], learn, contacts, hustles, tracks);
  const broadPursuitCoverage = deriveBroadPursuitCoverage(tasks, jobs, [], learn, contacts, hustles, tracks);
  const inferredPlanningPosture = planningPostureFromGoalFrame(
    goalFrame,
    spine.bestMove.lane,
    learn.some((l) => !l.done && l.learnStatus !== "closed"),
  );
  const activeOpportunityCount = countActiveOpportunities(jobs);
  const searchPhase = (profile?.searchPhase || "").trim();
  const profilePosture = planningPostureFromSearchPhase(searchPhase);
  const planningPosture = mergePlanningPosture(inferredPlanningPosture, profilePosture, activeOpportunityCount);
  const viableApplicationTruth = jobs
    .map(computeJobTruthStrip)
    .filter((truth) => truth.action !== "reject");
  const clarifyBeforePush = profilePosture !== "interview"
    && viableApplicationTruth.length > 0
    && viableApplicationTruth.every((truth) => truth.action === "clarify");
  const liveJobTargets = jobs.filter((j) => isOpportunityActionable(j)).map((j) => ({ title: j.title, company: j.company, roleArchetype: j.roleArchetype || "" }));
  const targetRoles = (profile?.targetRoles || "").trim();
  const targetRolePreferences = rolePreferenceTerms(targetRoles);
  const locationPreferences = (profile?.locationPreferences || DEFAULT_STRATEGIC_CONTEXT.locationPreferences).trim();
  const parsedLocationPreferences = locationPreferenceTerms(locationPreferences);
  const broadPursuitNeedsRealRoles = goalFrame.decisionMode === "broad-parallel-pursuit" && broadPursuitCoverage.missing.length > 0;
  const broadPursuitSupportOpen = goalFrame.decisionMode === "broad-parallel-pursuit"
    && broadPursuitCoverage.missing.length === 0
    && (broadPursuitCoverage.missingNetworkSupport.length > 0 || broadPursuitCoverage.missingLearningSupport.length > 0);
  const broadPursuitHasMixedSupportGaps = broadPursuitSupportOpen
    && broadPursuitCoverage.missingNetworkSupport.length > 0
    && broadPursuitCoverage.missingLearningSupport.length > 0;
  // Only narrow the bottleneck to a single support type when there isn't also an opposite gap
  const broadPursuitNeedsNetworkSupport = broadPursuitSupportOpen
    && !broadPursuitHasMixedSupportGaps
    && goalFrame.recommendedFocus === GOAL_WORKSTREAM.NETWORK
    && broadPursuitCoverage.missingNetworkSupport.length > 0;
  const broadPursuitNeedsLearningSupport = broadPursuitSupportOpen
    && !broadPursuitHasMixedSupportGaps
    && goalFrame.recommendedFocus === GOAL_WORKSTREAM.PREP_UPSKILLING
    && broadPursuitCoverage.missingLearningSupport.length > 0;
  const profileLane = laneForProfilePosture(profilePosture);
  const inferredLane = spine.bestMove.lane;
  const effectiveProfileLane = profileLane && !broadPursuitNeedsRealRoles && !broadPursuitSupportOpen ? profileLane : "";
  return {
    bottleneck: broadPursuitNeedsRealRoles
      ? LANE_NAME.APPLICATIONS
      : broadPursuitHasMixedSupportGaps
        ? LANE_NAME.NETWORK
      : broadPursuitNeedsNetworkSupport
        ? LANE_NAME.NETWORK
        : broadPursuitNeedsLearningSupport
          ? LANE_NAME.LEARNING_DEVELOPMENT
          : effectiveProfileLane || inferredLane,
    reason: broadPursuitNeedsRealRoles
      ? broadPursuitMissingRolesContextReason(broadPursuitCoverage.missing, spine.bestMove.trackName || undefined)
      : broadPursuitHasMixedSupportGaps
        ? broadPursuitMissingSupportContextReason(
          broadPursuitCoverage.missingNetworkSupport,
          broadPursuitCoverage.missingLearningSupport,
        )
      : broadPursuitNeedsNetworkSupport
        ? broadPursuitMissingContactsContextReason(broadPursuitCoverage.missingNetworkSupport)
      : broadPursuitNeedsLearningSupport
          ? broadPursuitMissingPrepContextReason(broadPursuitCoverage.missingLearningSupport)
      : effectiveProfileLane
        ? `Saved search phase "${searchPhase}" makes ${laneFocusAreaLabel(effectiveProfileLane)} the right focus.`
        : `${spine.bestMove.reason}${spine.bestMove.trackName ? ` Current focus: ${spine.bestMove.trackName}.` : ""}`,
    applicationsPremature: false,
    recommendedExploration: spine.bestMove.trackName || spine.activeTrack?.name || "",
    laneModel: { trace: spine.trace },
    bottleneckLane: broadPursuitNeedsRealRoles
      ? LANE_NAME.APPLICATIONS
      : broadPursuitHasMixedSupportGaps
        ? LANE_NAME.NETWORK
      : broadPursuitNeedsNetworkSupport
        ? LANE_NAME.NETWORK
        : broadPursuitNeedsLearningSupport
          ? LANE_NAME.LEARNING_DEVELOPMENT
          : effectiveProfileLane || inferredLane,
    laneStage: broadPursuitNeedsRealRoles || broadPursuitSupportOpen ? "active" : lane?.stage || "active",
    laneUnlockMove: broadPursuitNeedsRealRoles
      ? broadPursuitMissingRolesUnlockMove()
      : broadPursuitHasMixedSupportGaps
        ? broadPursuitMissingSupportTodayMustDo(
          broadPursuitCoverage.missingNetworkSupport,
          broadPursuitCoverage.missingLearningSupport,
        )
      : broadPursuitNeedsNetworkSupport
        ? broadPursuitMissingContactsUnlockMove()
        : broadPursuitNeedsLearningSupport
          ? broadPursuitMissingPrepUnlockMove()
      : spine.bestMove.title,
    activeTrackName: spine.bestMove.trackName || spine.activeTrack?.name || "",
    liveJobTargets,
    broadPursuitMissingCombinations: broadPursuitCoverage.missing,
    broadPursuitCoveredCombinations: broadPursuitCoverage.covered,
    broadPursuitMissingNetworkSupport: broadPursuitCoverage.missingNetworkSupport,
    broadPursuitMissingLearningSupport: broadPursuitCoverage.missingLearningSupport,
    goalPhase: goalFrame.phase,
    goalDayType: goalFrame.dayType,
    decisionMode: goalFrame.decisionMode,
    planningPosture,
    activeOpportunityCount,
    clarifyBeforePush,
    searchPhase,
    profilePosture,
    targetRoles,
    targetRolePreferenceTerms: targetRolePreferences,
    locationPreferences,
    locationPreferenceTerms: parsedLocationPreferences,
  };
}

function needsBroadPursuitGoalCandidate(context: StrategicContext) {
  return context.decisionMode === "broad-parallel-pursuit" && context.broadPursuitMissingCombinations.length > 0;
}

function needsBroadPursuitSupportGoalCandidate(context: StrategicContext) {
  return context.decisionMode === "broad-parallel-pursuit"
    && context.broadPursuitMissingCombinations.length === 0
    && (context.broadPursuitMissingNetworkSupport.length > 0 || context.broadPursuitMissingLearningSupport.length > 0);
}

function buildBroadPursuitGoalCandidate(context?: StrategicContext): Candidate {
  const combinations = context?.broadPursuitMissingCombinations || [];
  const combination = combinations.length ? combinations[combinations.length - 1] : "";
  const label = combination ? displayCombination(combination) : "";
  return {
    source: "goal",
    sourceId: 1,
    taskId: null,
    title: label ? `Save one real ${label} posting with JD text for Anchor to compare` : broadPursuitMissingRolesTitle(),
    category: "job",
    size: "deep",
    deadline: "",
    status: "not_started",
    skipped: 0,
    sourceUrl: "",
    sourceNote: label
      ? `${label} has no real posting yet. Use one concrete posting to see what this path asks for and what you would need to prove.`
      : broadPursuitMissingRolesSourceNote(context?.broadPursuitMissingCombinations || []),
    sourceStatus: "broad_parallel_pursuit",
    doneWhen: label
      ? `One real ${label} posting is saved with enough JD text for Anchor to compare it to your profile.`
      : broadPursuitMissingRolesDoneWhen(),
    whyNow: label
      ? `${label} has no real opening yet`
      : broadPursuitMissingRolesWhyNow(),
    fitScore: null,
    blocked: false,
    blockerReason: "",
    eligibilityRisk: "",
    location: "",
    warmPathScore: null,
    strategicValue: null,
    frictionScore: null,
    applicationReadiness: "",
    deadlineConfidence: "",
    narrativeAngle: "",
    relationshipStrength: "",
    askType: "",
    messageDraft: "",
    sourceNetwork: "",
    targetOrg: "",
    targetRole: combination,
    followUpDate: "",
  };
}

function buildBroadPursuitSupportGoalCandidates(context?: StrategicContext): Candidate[] {
  const out: Candidate[] = [];
  if (context?.broadPursuitMissingNetworkSupport?.length) {
    for (const [index, combination] of context.broadPursuitMissingNetworkSupport.entries()) {
      const label = displayCombination(combination);
      const relevantJobs = relevantLiveJobTargets(label, context).filter((j) => j.company);
      const roleReference = formatLiveRoleReference(relevantJobs[0]);
      const companies = [...new Set(relevantJobs.map((j) => j.company))].slice(0, 2);
      out.push({
        source: "goal",
        sourceId: 200 + index,
        taskId: null,
        title: roleReference
          ? `Find one person close to ${roleReference} to ask how teams hire for ${label}`
          : companies.length > 0
          ? `Find one person at ${companies.join(" or ")} to ask how teams hire for ${label}`
          : `Find one person already doing ${label} to ask how teams hire for it`,
        category: "admin",
        size: "medium",
        deadline: "",
        status: "not_started",
        skipped: 0,
        sourceUrl: "",
        sourceNote: companies.length > 0
          ? `${label} needs a contact. Try LinkedIn for connections at ${companies.join(", ")} — alumni, former colleagues, or second-degree contacts.`
          : `${label} has no contacts yet. Search LinkedIn for someone one step ahead in this path.`,
        sourceStatus: "broad_parallel_pursuit_network_support",
        doneWhen: `One real person is saved with why they are worth messaging and the one question you would ask about ${label}.`,
        whyNow: `${label} has no contacts yet — one real conversation changes how you prep and apply`,
        fitScore: null,
        blocked: false,
        blockerReason: "",
        eligibilityRisk: "",
        location: "",
        warmPathScore: null,
        strategicValue: null,
        frictionScore: null,
        applicationReadiness: "",
        deadlineConfidence: "",
        narrativeAngle: "",
        relationshipStrength: "",
        askType: "advice",
        messageDraft: "",
        sourceNetwork: "",
        targetOrg: "",
        targetRole: label,
        followUpDate: "",
      });
    }
  }
  if (context?.broadPursuitMissingLearningSupport?.length) {
    for (const [index, combination] of context.broadPursuitMissingLearningSupport.entries()) {
      const label = displayCombination(combination);
      const relevantJobs = relevantLiveJobTargets(label, context);
      const roleReference = formatLiveRoleReference(relevantJobs[0]);
      const likelyGap = likelyLearningGapPlan({ rolePath: roleReference || label });
      const learningMove = conciseLearningMove(likelyGap.learningMoveStep);
      out.push({
        source: "goal",
        sourceId: 300 + index,
        taskId: null,
        title: roleReference
          ? `Use ${roleReference} for Anchor's first prep suggestion for ${label}`
          : `Use one live ${label} role for Anchor's first prep suggestion`,
        category: "learning",
        size: "medium",
        deadline: "",
        status: "not_started",
        skipped: 0,
        sourceUrl: "",
        sourceNote: roleReference
          ? `Anchor's working diagnosis: ${likelyGap.label} may be the weakest ${likelyGap.gapTypeLabel} from ${roleReference}. Confirm or edit that diagnosis, then use this prep move: ${learningMove}.`
          : `Anchor's working diagnosis: ${likelyGap.label} may be the weakest ${likelyGap.gapTypeLabel} from one real ${label} role. Confirm or edit that diagnosis, then use this prep move: ${learningMove}.`,
        sourceStatus: "broad_parallel_pursuit_learning_support",
        doneWhen: `Anchor's suggested requirement and the matching smallest prep move are saved for ${label}.`,
        whyNow: `${label} still lacks a clear prep target from a real role`,
        fitScore: null,
        blocked: false,
        blockerReason: "",
        eligibilityRisk: "",
        location: "",
        warmPathScore: null,
        strategicValue: null,
        frictionScore: null,
        applicationReadiness: "",
        deadlineConfidence: "",
        narrativeAngle: "",
        relationshipStrength: "",
        askType: "",
        messageDraft: "",
        sourceNetwork: "",
        targetOrg: "",
        targetRole: combination,
        followUpDate: "",
      });
    }
  }
  return out;
}

function relevantLiveJobTargets(label: string, context?: StrategicContext) {
  const jobs = context?.liveJobTargets || [];
  if (!jobs.length) return [];
  const labelWords = significantWords(label);
  return [...jobs]
    .map((job) => {
      const jobWords = new Set(significantWords(`${job.title} ${job.company} ${job.roleArchetype || ""}`));
      const overlap = labelWords.filter((word) => jobWords.has(word)).length;
      return { job, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || Number(!!b.job.company) - Number(!!a.job.company))
    .map((entry) => entry.job);
}

function formatLiveRoleReference(job?: { title: string; company: string }) {
  if (!job) return "";
  return `${job.title}${job.company ? ` at ${job.company}` : ""}`;
}

function conciseLearningMove(raw: string) {
  return raw
    .replace(/^Use this matching next learning move if that gap holds:\s*/i, "")
    .replace(/^If .+? is the gap,\s*/i, "")
    .replace(/, then stop once one real role, one repeated requirements pattern, and one next learning move are captured$/i, "");
}

function jobMoveSize(action: JobTruthAction) {
  if (action === "apply" || action === "prepare" || action === "prove") return "deep";
  return "quick";
}

function jobDoneWhen(action: JobTruthAction) {
  if (action === "warm") return "A message to a helpful contact is sent";
  if (action === "prove") return "One weak requirement is now easier to back up";
  if (action === "clarify") return "The missing facts are confirmed";
  if (action === "follow_up") return "A follow-up or warm nudge is sent";
  if (action === "prepare") return "The interview stories or prep packet are stronger";
  if (action === "reject") return "The role is clearly parked or archived";
  return "One concrete application step is complete";
}

function jobNextStep(j: Job): { action: string; size: string; doneWhen: string; why: string; truthAction?: JobTruthAction } {
  const role = `${j.title}${j.company ? " — " + j.company : ""}`;
  if (j.nextStep && j.nextStep.trim()) {
    return { action: `${j.nextStep.trim()} — ${role}`, size: guessSize(j.nextStep), doneWhen: `You've finished "${j.nextStep.trim().slice(0, 40)}" for ${j.title || "this role"} and know what comes next`, why: "your own next step on this role" };
  }
  const truth = computeJobTruthStrip(j);
  return {
    action: `${truth.nextMove} — ${role}`,
    size: jobMoveSize(truth.action),
    doneWhen: jobDoneWhen(truth.action),
    why: truth.headline,
    truthAction: truth.action,
  };
}

function readinessMomentum(readiness: string) {
  switch (readiness || "none") {
    case "cv": return { score: 10, reason: "materials are partly underway" };
    case "cover": return { score: 14, reason: "application materials are partly underway" };
    case "questions": return { score: 18, reason: "application is close to submittable" };
    case "sample": return { score: 18, reason: "sample requirement is identified" };
    case "referral": return { score: 20, reason: "a referral path is already live" };
    case "submitted": return { score: 16, reason: "already submitted, so follow-through matters" };
    case "follow_up": return { score: 16, reason: "already in follow-up mode" };
    default: return { score: 0, reason: "" };
  }
}

function locationMomentum(location: string, context: StrategicContext) {
  const loc = normalizeLocationTerm(location || "");
  if (!loc) return { score: 0, reason: "" };
  const preferences = context.locationPreferenceTerms.length
    ? context.locationPreferenceTerms
    : DEFAULT_STRATEGIC_CONTEXT.locationPreferenceTerms;
  const matchIndex = preferences.findIndex((terms) => terms.some((term) => loc.includes(term)));
  if (matchIndex >= 0) {
    const scores = [24, 18, 12, 8];
    return {
      score: scores[Math.min(matchIndex, scores.length - 1)],
      reason: matchIndex === 0 ? "matches your top location preference" : "fits your saved location preferences",
    };
  }
  const tier = locationTier(location);
  if (tier !== "Other" && !context.locationPreferences.trim()) return { score: 8, reason: "has a workable location signal" };
  return { score: 0, reason: "" };
}

function jobMomentum(c: Candidate, context: StrategicContext) {
  let s = 0;
  const trace: string[] = [];

  if (c.sourceStatus === "interviewing") {
    s += 35;
    trace.push("already in interview process");
  } else if (c.sourceStatus === "applied") {
    s += 18;
    trace.push("already in application pipeline");
  }

  const location = locationMomentum(c.location || "", context);
  s += location.score;
  if (location.reason) trace.push(location.reason);

  const rolePreference = rolePreferenceMomentum(c, context);
  s += rolePreference.score;
  if (rolePreference.reason) trace.push(rolePreference.reason);

  if (c.warmPathScore != null) {
    const warmBoost = Math.round((c.warmPathScore / 100) * 22);
    s += warmBoost;
    if (warmBoost >= 10) trace.push("a useful person to reach out to improves landing odds");
  }

  if (c.strategicValue != null) {
    const strategicBoost = Math.round((c.strategicValue / 100) * 16);
    s += strategicBoost;
    if (strategicBoost >= 8) trace.push("high-value role for your career direction");
  }

  if (c.frictionScore != null) {
    const frictionPenalty = Math.round((c.frictionScore / 100) * 18);
    s -= frictionPenalty;
    if (frictionPenalty >= 8) trace.push("application has some friction to work through");
  }

  const readiness = readinessMomentum(c.applicationReadiness || "none");
  s += readiness.score;
  if (readiness.reason) trace.push(readiness.reason);

  if (c.narrativeAngle && c.narrativeAngle.trim()) {
    s += 10;
    trace.push("credible narrative angle already exists");
  }

  if (c.deadlineConfidence === "high") {
    s += 6;
    trace.push("facts and deadline are already confirmed");
  }

  return { score: s, trace };
}

function contactNextStep(c: Contact): { action: string; size: string; doneWhen: string; why: string } {
  const target = c.who || c.name || "contact";
  const ask = c.askType || "soft";
  const hasDraft = !!(c.messageDraft && c.messageDraft.trim());
  const hasFollowUp = !!(c.nextFollowUpDate && c.nextFollowUpDate.trim());

  if (c.status === "replied") {
    return {
      action: `Reply to ${target}`,
      size: "quick",
      doneWhen: "A reply is sent or the next concrete ask is drafted",
      why: "warm conversation already exists",
    };
  }
  if (c.status === "messaged" && hasFollowUp) {
    return {
      action: `Follow up with ${target}`,
      size: "quick",
      doneWhen: "A follow-up is sent or clearly scheduled",
      why: "the relationship will stale without a nudge",
    };
  }
  if (hasDraft) {
    return {
      action: `Send ${ask} outreach to ${target}`,
      size: "quick",
      doneWhen: "The message is sent",
      why: "draft exists, so this can become real access quickly",
    };
  }
  if (isGenericContactPlaceholder(c)) {
    const action = nextContactTaskTitle(c);
    const contract = contractForTaskIntent({
      title: action,
      sourceType: "contact",
      sourceNote: `${c.why || c.note || ""} ${c.targetOrg || ""} ${c.targetRole || ""}`,
    });
    return {
      action,
      size: "quick",
      doneWhen: contract.doneWhen,
      why: "you need one real person and one clear ask before drafting outreach",
    };
  }
  return {
    action: nextContactTaskTitle(c),
    size: "quick",
    doneWhen: "A message draft is ready to send",
    why: "network access needs one concrete message, not vague intent",
  };
}

function contactFollowUpDays(c: Candidate) {
  const raw = (c.followUpDate || "").trim();
  if (!raw) return null;
  const due = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const today = new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T12:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function contactMomentum(c: Candidate, context: StrategicContext) {
  let s = 0;
  const trace: string[] = [];
  const followUpDays = contactFollowUpDays(c);

  if (c.sourceStatus === "messaged" || c.sourceStatus === "replied") {
    if (followUpDays !== null && followUpDays <= 0) {
      s += 18;
      trace.push("follow-up is due or overdue");
    } else if (followUpDays !== null && followUpDays <= 2) {
      s += 8;
      trace.push("follow-up window is approaching");
    } else if (followUpDays !== null && followUpDays > 2) {
      s -= 22;
      trace.push("follow-up is scheduled for later");
    }
  } else if (followUpDays !== null) {
    if (followUpDays <= 0) {
      s += 6;
      trace.push("outreach date is due now");
    } else if (followUpDays <= 2) {
      s += 3;
      trace.push("outreach date is approaching");
    } else {
      s -= 8;
      trace.push("outreach is scheduled for later");
    }
  }

  if (c.sourceStatus === "replied") {
    s += 28;
    trace.push("already warm and responsive");
  } else if (c.sourceStatus === "messaged") {
    s += 16;
    trace.push("conversation already started");
  }

  if (c.relationshipStrength === "strong") {
    s += 20;
    trace.push("strong relationship path");
  } else if (c.relationshipStrength === "warm") {
    s += 12;
    trace.push("warm relationship path");
  }

  if (c.messageDraft && c.messageDraft.trim()) {
    s += 18;
    trace.push("draft already exists");
  }

  if ((c.targetOrg && c.targetOrg.trim()) || (c.targetRole && c.targetRole.trim())) {
    if (c.sourceStatus === "messaged" || c.sourceStatus === "replied") {
      s += 18;
      trace.push("specific target role or org is already in motion");
    } else {
      s += 8;
      trace.push("specific target role or org is already defined");
    }
  }

  const roleFit = liveRoleContactFit(c, context);
  s += roleFit.score;
  if (roleFit.reason) trace.push(roleFit.reason);

  const archetype = classifyContactArchetype(c);
  s += archetype.score;
  trace.push(archetype.reason);

  const ask = askTypeAlignment(c, context);
  s += ask.score;
  if (ask.reason) trace.push(ask.reason);

  return { score: s, trace };
}

function liveRoleContactFit(c: Candidate, context: StrategicContext) {
  const candidateText = normalizeText(`${c.title} ${c.sourceNote} ${c.targetOrg || ""} ${c.targetRole || ""}`);
  const targetOrg = normalizeText(c.targetOrg || "");
  const targetRoleWords = significantWords(c.targetRole || "");

  let best = { score: 0, reason: "" };
  for (const job of context.liveJobTargets) {
    const company = normalizeText(job.company || "");
    const titleWords = significantWords(job.title || "");
    const companyMatch = !!targetOrg && !!company && (targetOrg.includes(company) || company.includes(targetOrg) || candidateText.includes(company));
    const roleOverlap = targetRoleWords.filter((word) => titleWords.includes(word)).length;

    if (companyMatch && roleOverlap >= 1 && best.score < 34) {
      best = { score: 34, reason: "supports a live role at the exact target org" };
      continue;
    }
    if (companyMatch && best.score < 26) {
      best = { score: 26, reason: "connected to a live target org" };
      continue;
    }
    if (roleOverlap >= 2 && best.score < 18) {
      best = { score: 18, reason: "aligned with a live target role family" };
    }
  }
  return best;
}

function classifyContactArchetype(c: Candidate) {
  const sourceNetwork = (c.sourceNetwork || "").toLowerCase();
  const text = `${c.title} ${c.sourceNote} ${c.targetOrg || ""} ${c.targetRole || ""} ${sourceNetwork}`.toLowerCase();

  if ((c.targetOrg && c.targetOrg.trim()) || (c.targetRole && c.targetRole.trim()) || /\b(hiring manager|target org|target role)\b/.test(text)) {
    return { key: "role-insider", score: 24, reason: "close to a specific target role or org" };
  }
  if (/\b(ex-|former|worked together|coworker|co-worker|colleague|manager|teammate|boss|mentor)\b/.test(text) || /\b(ex-bain|ex-tbi|ex-abraaj)\b/.test(sourceNetwork)) {
    return { key: "shared-history", score: 20, reason: "shared work history makes the ask easier" };
  }
  if (/\b(sipa|columbia|lsr|alumni|alumna|alum|graduate)\b/.test(text)) {
    return { key: "shared-institution", score: 14, reason: "shared institution gives you a natural opener" };
  }
  if (/\b(recruiter|talent|founder|advisor|adviser|analyst|researcher|operator|principal|partner)\b/.test(text)) {
    return { key: "market-guide", score: 10, reason: "can provide a useful reality-check on the market or process" };
  }
  return { key: "exploratory", score: 4, reason: "exploratory networking contact" };
}

function isActionableContact(c: Contact) {
  if (c.status === "messaged" || c.status === "replied") return true;
  if (c.messageDraft && c.messageDraft.trim()) return true;
  if (c.nextFollowUpDate && c.nextFollowUpDate.trim()) return true;
  if (c.askType && c.askType.trim()) return true;
  if (c.targetOrg && c.targetOrg.trim()) return true;
  if (c.targetRole && c.targetRole.trim()) return true;
  if (c.why && c.why.trim()) return true;
  return false;
}

function candidateStrategicLane(c: Candidate, context: StrategicContext): CanonicalLaneName {
  if (c.source === "goal") {
    if (c.sourceStatus === "broad_parallel_pursuit_network_support") return LANE_NAME.NETWORK;
    if (c.sourceStatus === "broad_parallel_pursuit_learning_support") return LANE_NAME.LEARNING_DEVELOPMENT;
    return LANE_NAME.APPLICATIONS;
  }
  if (c.source === "job") {
    if (c.jobTruthAction === "warm") return LANE_NAME.NETWORK;
    if (c.jobTruthAction === "prove") return LANE_NAME.LEARNING_DEVELOPMENT;
    return LANE_NAME.APPLICATIONS;
  }
  if (c.source === "contact") return LANE_NAME.NETWORK;
  if (c.source === "learn") return LANE_NAME.LEARNING_DEVELOPMENT;
  if (c.source === "hustle") return LANE_NAME.PROOF_ASSETS;
  if (candidateMatchesLane(c, context.bottleneckLane)) return context.bottleneckLane;
  const order: CanonicalLaneName[] = [LANE_NAME.APPLICATIONS, LANE_NAME.NETWORK, LANE_NAME.LEARNING_DEVELOPMENT, LANE_NAME.PROOF_ASSETS, LANE_NAME.DIRECTION, LANE_NAME.STABILITY];
  return order.find((lane) => candidateMatchesLane(c, lane)) || LANE_NAME.STABILITY;
}

function contactIntent(c: Candidate, context: StrategicContext): NetworkingIntent {
  const liveFit = liveRoleContactFit(c, context);
  const hasTargetSignal = !!(c.targetOrg && c.targetOrg.trim()) || !!(c.targetRole && c.targetRole.trim()) || liveFit.score >= 18;
  const activeThread = c.sourceStatus === "messaged" || c.sourceStatus === "replied";
  if (hasTargetSignal && activeThread && (c.askType === "referral" || c.askType === "follow_up")) return "conversion";
  if (context.planningPosture === "interview" && (hasTargetSignal || activeThread || c.askType === "follow_up")) return "interview";
  if (liveFit.score >= 26) return "conversion";
  if (context.planningPosture === "conversion" && (hasTargetSignal || c.askType === "referral" || c.askType === "follow_up")) return "conversion";
  if (context.planningPosture === "capability") return "capability";
  return "exploration";
}

function askTypeAlignment(c: Candidate, context: StrategicContext) {
  const ask = c.askType || "soft";
  const intent = contactIntent(c, context);

  if (intent === "conversion") {
    if (ask === "referral") return { score: 18, reason: "referral ask directly advances a live role" };
    if (ask === "follow_up") return { score: 15, reason: "follow-up keeps a live conversion path moving" };
    if (ask === "reconnect") return { score: 8, reason: "reconnect can reopen a useful path into a live role" };
    if (ask === "advice") return { score: 4, reason: "advice helps, but this stage wants a more direct role ask" };
    return { score: 3, reason: "soft outreach is useful, but a sharper conversion ask would be stronger" };
  }
  if (intent === "interview") {
    if (ask === "follow_up") return { score: 16, reason: "follow-up keeps the active process warm" };
    if (ask === "advice") return { score: 12, reason: "advice can sharpen interview or process judgement" };
    if (ask === "reconnect") return { score: 8, reason: "reconnect can unlock timely interview context" };
    if (ask === "referral") return { score: 4, reason: "referral matters less once the process is already active" };
    return { score: 4, reason: "soft outreach helps, but the process needs a clearer ask" };
  }
  if (intent === "capability") {
    if (ask === "advice") return { score: 16, reason: "advice can target the current skill gap or thin area" };
    if (ask === "follow_up") return { score: 10, reason: "follow-up can turn prior context into capability feedback" };
    if (ask === "reconnect") return { score: 8, reason: "reconnect can reopen useful feedback on the requirement gap" };
    if (ask === "referral") return { score: 2, reason: "referral is weaker than feedback while the requirement gap is the bottleneck" };
    return { score: 6, reason: "soft outreach can surface useful feedback with low friction" };
  }
  if (ask === "advice") return { score: 18, reason: "advice is the right ask while narrowing options" };
  if (ask === "reconnect") return { score: 12, reason: "reconnect can reopen exploratory market feedback" };
  if (ask === "soft") return { score: 8, reason: "low-friction outreach is enough while exploring options" };
  if (ask === "follow_up") return { score: 6, reason: "follow-up helps, but this phase needs fresh outside feedback" };
  if (ask === "referral") return { score: 1, reason: "referral is premature before the target role type is clearer" };
  return { score: 6, reason: "this ask still creates some useful exploratory feedback" };
}

export type DayMode = "normal" | "low" | "deadline" | "strategy";

function countDismissedStepOutputs(stepsJson: string): number {
  try {
    const arr = JSON.parse(stepsJson || "[]");
    if (!Array.isArray(arr)) return 0;
    return arr.filter((s: any) => s?.disposition === "dismissed").length;
  } catch { return 0; }
}

export function gatherCandidates(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[] = [], learnMilestoneProgress: Map<number, { done: number; total: number }> = new Map(), jobContactLinks: Record<number, number[]> = {}): Candidate[] {
  const out: Candidate[] = [];
  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  for (const t of tasks) {
    const isTodayTask = t.list === "today";
    const isLaneAlignedSystemMove = t.sourceType === "strategy_builder" || t.sourceType === "marketability_engine" || t.sourceStatus === "strategy_refresh" || (t.sourceType === "career_track" && !!t.relatedTrackId);
    if ((isTodayTask || isLaneAlignedSystemMove) && !t.done) {
      const blocked = t.readiness === "blocked" || !!t.blockerReason;
      const dismissedCount = countDismissedStepOutputs(t.steps);
      const effectiveSkipped = t.skipped + dismissedCount;
      const linkedContact = t.sourceType === "contact" && t.sourceId != null ? contactsById.get(t.sourceId) : undefined;
      const baseTaskIntent = contractForTaskIntent({
        title: t.title,
        category: t.category,
        sourceType: t.sourceType,
        sourceNote: t.sourceNote,
        doneWhen: t.doneWhen,
        minimumOutcome: t.minimumOutcome,
        blockerReason: t.blockerReason,
      });
      const repairedTaskTitle = linkedContact && isGenericContactPlaceholder(linkedContact)
        ? nextContactTaskTitle(linkedContact)
        : t.title.replace(/^âœ¨\s*/, "");
      const repairedTaskIntent = linkedContact && isGenericContactPlaceholder(linkedContact)
        ? contractForTaskIntent({
          title: repairedTaskTitle,
          sourceType: "contact",
          sourceNote: `${t.sourceNote || ""} ${linkedContact.why || linkedContact.note || ""} ${linkedContact.targetOrg || ""} ${linkedContact.targetRole || ""}`,
        })
        : baseTaskIntent.intent === "role_market_scan"
          ? baseTaskIntent
          : null;
      out.push({
        source: "task", sourceId: t.id, taskId: t.id,
        title: t.title.replace(/^✨\s*/, ""), category: t.category, size: t.size,
        deadline: t.deadline, status: t.status, skipped: effectiveSkipped,
        sourceUrl: t.sourceUrl || "", sourceNote: t.sourceNote || "", sourceStatus: t.sourceStatus || "",
        doneWhen: t.doneWhen || t.minimumOutcome || `You can point to one concrete thing you did on "${t.title.slice(0, 40).trim()}"`,
        whyNow: isLaneAlignedSystemMove ? "it directly supports the path you're building right now" : "you put it on today's list",
        fitScore: null, blocked, blockerReason: t.blockerReason || "", eligibilityRisk: "",
        location: "", warmPathScore: null, strategicValue: null, frictionScore: null, applicationReadiness: "", deadlineConfidence: "", narrativeAngle: "",
        relationshipStrength: "", askType: "", messageDraft: "", sourceNetwork: "", targetOrg: "", targetRole: "", followUpDate: "",
        blockedBy: t.blockedBy || "",
        ...(repairedTaskTitle !== t.title ? { title: repairedTaskTitle } : {}),
        ...(repairedTaskIntent?.doneWhen ? { doneWhen: repairedTaskIntent.doneWhen } : {}),
      });
    }
  }

  for (const j of jobs) {
    if (isOpportunityActionable(j)) {
      const { action, size, doneWhen, why, truthAction } = jobNextStep(j);
      out.push({
        source: "job", sourceId: j.id, taskId: null,
        title: action, category: "job", size,
        deadline: j.deadline || "", status: "not_started", skipped: 0,
        sourceUrl: j.url || j.sourceUrl || "", sourceNote: j.note || "", sourceStatus: j.status,
        doneWhen, whyNow: why, fitScore: j.fitScore ?? null,
        blocked: false, blockerReason: "", eligibilityRisk: j.eligibilityRisk || "",
        location: j.location || "",
        warmPathScore: j.warmPathScore ?? null,
        strategicValue: j.strategicValue ?? null,
        frictionScore: j.frictionScore ?? null,
        applicationReadiness: j.applicationReadiness || "none",
        deadlineConfidence: j.deadlineConfidence || "",
        narrativeAngle: j.narrativeAngle || "",
        jobTruthAction: truthAction,
        linkedContactNames: (jobContactLinks[j.id] || []).map((id) => contactsById.get(id)).filter(Boolean).map((c) => c!.who || c!.name || "a contact"),
        relationshipStrength: "", askType: "", messageDraft: "", sourceNetwork: "", targetOrg: "", targetRole: j.roleArchetype || j.title || "", followUpDate: "",
        companyBrief: j.companyBrief || "",
      });
    }
  }

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(apply to|finish|the|your|a|an|produce|free|week|6week|programme|program)\b/g, "").replace(/\s+/g, " ").trim();
  const taskKeys = out.filter((c) => c.source === "task").map((c) => norm(c.title));
  const isDuplicate = (title: string) => {
    const k = norm(title);
    if (!k || k.length < 6) return false;
    return taskKeys.some((tk) => tk && (tk.includes(k) || k.includes(tk)) && Math.min(tk.length, k.length) >= 6);
  };

  for (const l of learn) {
    const optedIntoOutput = getLearnOutputState(l) !== "reference";
    if ((l.active || optedIntoOutput) && !l.done && l.learnStatus !== "closed" && !isDuplicate(l.title)) {
      const dl = l.applicationDeadline || "";
      out.push({
        source: "learn", sourceId: l.id, taskId: null,
        title: l.requiredOutput ? `${l.title} — produce: ${l.requiredOutput}` : l.title,
        category: "learning", size: guessSize(l.title),
        deadline: dl, status: "not_started", skipped: 0,
        sourceUrl: l.url || "", sourceNote: l.note || "", sourceStatus: l.learnStatus || "active",
        doneWhen: l.requiredOutput || `You have one note, example, or takeaway from "${l.title.slice(0, 40).trim()}" that you could use in an interview or application`,
        whyNow: l.applicationDeadline ? "there's a deadline coming up" : "it fills a gap your target roles keep asking for",
        fitScore: null, blocked: false, blockerReason: "", eligibilityRisk: "",
        location: "", warmPathScore: null, strategicValue: null, frictionScore: null, applicationReadiness: "", deadlineConfidence: "", narrativeAngle: "",
        relationshipStrength: "", askType: "", messageDraft: "", sourceNetwork: "", targetOrg: "", targetRole: "", followUpDate: "",
        milestoneProgress: learnMilestoneProgress.get(l.id),
      });
    }
  }

  for (const c of contacts) {
    if (!isActionableContact(c)) continue;
    const { action, size, doneWhen, why } = contactNextStep(c);
    out.push({
      source: "contact", sourceId: c.id, taskId: null,
      title: action, category: "admin", size,
      deadline: "", status: "not_started", skipped: 0,
      sourceUrl: "", sourceNote: `${c.why || c.note || ""} ${c.targetOrg || ""} ${c.targetRole || ""}`.trim(), sourceStatus: c.status,
      doneWhen, whyNow: why, fitScore: null,
      blocked: false, blockerReason: "", eligibilityRisk: "",
      location: "", warmPathScore: null, strategicValue: null, frictionScore: null, applicationReadiness: "", deadlineConfidence: "", narrativeAngle: "",
      relationshipStrength: c.relationshipStrength || "cold", askType: c.askType || "", messageDraft: c.messageDraft || "",
      sourceNetwork: c.sourceNetwork || "", targetOrg: c.targetOrg || "", targetRole: c.targetRole || "", followUpDate: c.nextFollowUpDate || "",
    });
  }

  for (const h of hustles) {
    if (h.nextStep && h.stage !== "earning") {
      const cat = /substack/i.test(h.title) ? "substack" : /afterline/i.test(h.title) ? "afterline" : "hustle";
      out.push({
        source: "hustle", sourceId: h.id, taskId: null,
        title: `${h.nextStep} (${h.title.replace(/^[☀-➿\uD800-\uDFFF]+\s*/, "")})`,
        category: cat, size: guessSize(h.nextStep),
        deadline: "", status: "not_started", skipped: 0,
        sourceUrl: "", sourceNote: h.note || "", sourceStatus: h.stage,
        doneWhen: `You have something shareable or reusable from "${(h.nextStep || h.title).slice(0, 40).trim()}" — even a draft or outline counts`,
        whyNow: "keeping this project moving builds credibility you can point to",
        fitScore: null, blocked: false, blockerReason: "", eligibilityRisk: "",
        location: "", warmPathScore: null, strategicValue: null, frictionScore: null, applicationReadiness: "", deadlineConfidence: "", narrativeAngle: "",
      });
    }
  }
  return out;
}

function gateReason(c: Candidate, _context: StrategicContext): string | null {
  if (c.status === "done") return "already done";
  if (c.blocked) return c.blockerReason ? `blocked: ${c.blockerReason}` : "blocked";
  if (c.eligibilityRisk === "likely_ineligible") return "constraint needs handling before submission";
  if (c.source === "contact" && (c.sourceStatus === "messaged" || c.sourceStatus === "replied")) {
    const followUpDays = contactFollowUpDays(c);
    if (followUpDays !== null && followUpDays > 0) return "follow-up is scheduled for later";
  }
  return null;
}

function passesGates(c: Candidate, context: StrategicContext): boolean {
  return gateReason(c, context) === null;
}

function candidateActionCategory(c: Candidate, context: StrategicContext): ActionCategory {
  if (c.source === "job") {
    if (c.jobTruthAction === "prepare") return "prepare";
    if (c.jobTruthAction === "prove") return "develop";
    if (c.jobTruthAction === "clarify") return "decide";
    if (c.jobTruthAction === "reject") return "wait";
    return "pursue";
  }
  if (c.source === "contact") {
    const intent = contactIntent(c, context);
    if (intent === "conversion") return "pursue";
    if (intent === "interview") return "prepare";
    if (intent === "capability") return "develop";
    return "decide";
  }
  if (c.source === "goal") {
    if (c.sourceStatus === "broad_parallel_pursuit_learning_support") return "develop";
    if (c.sourceStatus === "broad_parallel_pursuit_network_support") return "pursue";
    return "decide";
  }
  if (c.source === "learn" || c.source === "hustle") return "develop";
  if (/\binterview|case|mock|presentation exercise|written test|prep\b/i.test(`${c.title} ${c.sourceNote}`)) return "prepare";
  if (isApplicationLike(c) || isNetworkLike(c)) return "pursue";
  if (isDirectionSignal(c)) return "decide";
  if (isLearningLike(c) || isProofAsset(c)) return "develop";
  return "wait";
}

function actionCategoryPriorityBand(category: ActionCategory, context: StrategicContext) {
  if (context.clarifyBeforePush) {
    if (category === "decide") return 1;
    if (category === "pursue") return 2;
    if (category === "prepare") return 3;
    if (category === "develop") return 4;
    return 5;
  }
  if (context.planningPosture === "interview") {
    if (category === "prepare") return 1;
    if (category === "pursue") return 2;
    if (category === "develop") return 3;
    if (category === "decide") return 4;
    return 5;
  }
  const shouldPromoteDevelopment = context.planningPosture === "capability";
  if (shouldPromoteDevelopment) {
    if (category === "develop") return 1;
    if (category === "decide") return 2;
    if (category === "pursue") return 3;
    if (category === "prepare") return 4;
    return 5;
  }
  if (category === "pursue") return 1;
  if (category === "prepare") return 2;
  if (category === "decide") return 3;
  if (category === "develop") return 4;
  return 5;
}

function priorityCategoryForProfilePosture(posture: StrategicContext["planningPosture"]): ActionCategory {
  if (posture === "interview") return "prepare";
  if (posture === "conversion") return "pursue";
  if (posture === "capability") return "develop";
  return "decide";
}

export function pickDayMode(cands: Candidate[], energy: Energy, context?: StrategicContext): DayMode {
  const hasUrgent = cands.some((c) => { const d = daysUntil(c.deadline); return d !== null && d <= 3; });
  if (hasUrgent) return "deadline";
  if (energy === "low") return "low";
  if (context?.bottleneck && context.bottleneck !== "Progress") return "strategy";
  return "normal";
}

function scoreWithTrace(c: Candidate, energy: Energy, mode: DayMode, context: StrategicContext): RankedCandidate {
  let s = 0;
  const trace: string[] = [];

  const d = daysUntil(c.deadline);
  if (d !== null) {
    if (d <= 0) { s += 200; trace.push("deadline is due/overdue"); }
    else if (d <= 2) { s += 140; trace.push("deadline is within 2 days"); }
    else if (d <= 7) { s += 70; trace.push("deadline is this week"); }
    else { s += 20; trace.push("has a real deadline"); }
  }

  if (c.fitScore !== null) {
    const fitBoost = Math.round((c.fitScore / 100) * 60);
    s += fitBoost;
    if (fitBoost >= 35) trace.push("strong match for your background");
  }

  if (c.source === "job") {
    const momentum = jobMomentum(c, context);
    s += momentum.score;
    trace.push(...momentum.trace);
  }
  if (c.source === "contact") {
    const momentum = contactMomentum(c, context);
    s += momentum.score;
    trace.push(...momentum.trace);
  }
  if (c.source === "goal") {
    s += 42;
    if (c.sourceStatus === "broad_parallel_pursuit") {
      s += 82;
      trace.push("one plausible path still has no real posting to learn from");
    } else if (c.sourceStatus === "broad_parallel_pursuit_network_support") trace.push("some live role paths still need someone useful to reach out to");
    else if (c.sourceStatus === "broad_parallel_pursuit_learning_support") {
      trace.push("some live role paths still need focused learning support");
      if (context.broadPursuitMissingNetworkSupport.length > 0) {
        s += 78;
        trace.push("unlocks Learning and development focus area");
      }
    }
    else trace.push("several role paths still need a real role before you narrow");
  }

  s += (8 - (CATEGORY_RANK[c.category] ?? 7)) * 6;

  if (candidateMatchesLane(c, context.bottleneckLane)) {
    s += 78;
    trace.push(`unlocks ${context.bottleneckLane} focus area`);
  }
  if (context.laneUnlockMove && `${c.title} ${c.whyNow} ${c.sourceNote}`.toLowerCase().includes(context.laneUnlockMove.toLowerCase().slice(0, 18))) {
    s += 25;
    trace.push("directly addresses the main gap right now");
  }
  if (/direction/i.test(context.bottleneck) && isDirectionSignal(c)) { s += 35; trace.push("helps clarify which direction to go"); }
  if (/application/i.test(context.bottleneck) && isApplicationLike(c)) { s += 30; trace.push("moves an application forward"); }
  if (/network/i.test(context.bottleneck) && isNetworkLike(c)) { s += 35; trace.push("moves a relationship path forward"); }
  if (/learning|development/i.test(context.bottleneck) && isLearningLike(c)) { s += 25; trace.push("builds knowledge that makes your applications stronger"); }
  if (c.source === "learn" && c.milestoneProgress && c.milestoneProgress.total > 0) {
    const ratio = c.milestoneProgress.done / c.milestoneProgress.total;
    if (ratio >= 0.8) { s += 35; trace.push("nearly finished curriculum — close it out"); }
    else if (ratio >= 0.5) { s += 22; trace.push("halfway through curriculum — keep momentum"); }
    else if (ratio > 0) { s += 12; trace.push("curriculum has active progress"); }
  }
  if (context.planningPosture === "capability") {
    if (isLearningLike(c)) {
      s += 22;
      trace.push("strengthening a key skill area right now pays off across roles");
    }
    if (isProofAsset(c) && c.sourceStatus === "testing") {
      s += 10;
      trace.push("this project turns learning into something you can show");
    } else if (isProofAsset(c)) {
      s -= 10;
      trace.push("learning comes first — projects can wait until there's more to show");
    }
  } else if (isProofAsset(c)) {
    if (context.planningPosture === "conversion") {
      s -= 14;
      trace.push("active applications take priority over project work right now");
    } else if (context.planningPosture === "exploration") {
      s -= 18;
      trace.push("projects can wait while you're still narrowing which roles to target");
    }
  }
  if (context.recommendedExploration && `${c.title} ${c.sourceNote}`.toLowerCase().includes(context.recommendedExploration.toLowerCase().slice(0, 20))) {
    s += 30;
    trace.push("aligns with your current focus area");
  }

  const actionCategory = candidateActionCategory(c, context);
  const priorityBand = actionCategoryPriorityBand(actionCategory, context);
  if (priorityBand === 1) {
    s += 26;
  } else if (priorityBand === 2) {
    s += 12;
  } else if (priorityBand === 4) {
    s -= 10;
  } else if (priorityBand >= 5) {
    s -= 18;
  }
  if (context.clarifyBeforePush && actionCategory === "decide") {
    trace.push("worth confirming the role details before investing more effort");
  } else if (context.clarifyBeforePush && actionCategory === "pursue") {
    trace.push("application work can wait until key role details are confirmed");
  } else if (context.planningPosture === "capability" && actionCategory === "develop") {
    trace.push("a repeated gap keeps coming up — addressing it now will help across roles");
  } else if (context.planningPosture === "capability" && actionCategory === "pursue") {
    trace.push("strengthening this area first will make your applications more competitive");
  } else if ((context.planningPosture === "conversion" || context.planningPosture === "interview") && actionCategory === "develop") {
    trace.push("active applications and interviews take priority right now");
  }
  if (context.profilePosture && actionCategory === priorityCategoryForProfilePosture(context.profilePosture)) {
    s += 34;
    trace.push(`matches your saved search phase: ${context.searchPhase}`);
  }

  const startability = startabilityMomentum(c);
  s += startability.score;
  trace.push(...startability.trace);

  if (mode === "low" || energy === "low") {
    if (c.size === "quick") { s += 25; trace.push("fits a low-energy day"); }
    if (c.size === "deep") { s -= 30; trace.push("deep work penalty on low-energy day"); }
  }
  if (mode === "deadline" && d !== null && d <= 3) s += 30;

  s += Math.min(c.skipped, 3) * 4;
  if (c.skipped >= 2) trace.push("has been avoided before, so it should be made smaller");
  if (c.status === "in_progress") { s += 15; trace.push("already in progress"); }
  if (c.whyNow) trace.push(c.whyNow);

  return { c, s, trace };
}

function score(c: Candidate, energy: Energy, mode: DayMode): number {
  return scoreWithTrace(c, energy, mode, DEFAULT_STRATEGIC_CONTEXT).s;
}

export type SlotName = "now" | "next" | "later" | "bonus";
export type PlanItem = { slot: SlotName; candidate: Candidate; why: string; isMVD: boolean; explanation: RecommendationExplanation };

type CapacityInput = number | { busyMinutes?: number; now?: Date; remainingMinutes?: number };

function remainingDayMinutes(now = new Date()): number {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const dayStart = 8 * 60;
  const dayEnd = 22 * 60;
  if (minutesNow < dayStart) return 10 * 60;
  if (minutesNow >= dayEnd) return 0;
  return Math.min(10 * 60, dayEnd - minutesNow);
}

function capacityMinutes(input: CapacityInput = 0): number {
  if (typeof input === "number") return Math.max(0, remainingDayMinutes() - Math.max(0, input));
  if (typeof input.remainingMinutes === "number") return Math.max(0, input.remainingMinutes);
  return Math.max(0, remainingDayMinutes(input.now) - Math.max(0, input.busyMinutes || 0));
}

function focusAreaLabel(lane: CanonicalLaneName): string {
  return laneFocusAreaLabel(lane);
}

function whyLine(r: RankedCandidate, context: StrategicContext) {
  const lane = candidateStrategicLane(r.c, context);
  const top = r.trace.filter(Boolean).slice(0, 2).join("; ");
  if (r.c.source === "goal" && (needsBroadPursuitGoalCandidate(context) || needsBroadPursuitSupportGoalCandidate(context))) {
    return `You are testing several paths in parallel. ${top || context.laneUnlockMove || "This is the strongest move across them"}.`;
  }
  return `This helps with ${focusAreaLabel(lane)}. ${top || context.laneUnlockMove || "It's the strongest available move right now"}.`;
}

function parseBrief(raw?: string): { whatTheyDo?: string; relevantTeam?: string; whyYouFit?: string; prepAngle?: string; landscape?: { competitors?: string[]; alsoConsider?: string[]; marketContext?: string }; outreachSuggestions?: Array<{ archetype?: string; searchTip?: string }> } | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function firstStepForSource(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "goal") {
    if (candidate?.sourceStatus === "broad_parallel_pursuit" && candidate?.targetRole) {
      return `Open LinkedIn or a target job board and search for "${displayCombination(candidate.targetRole)}".`;
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_network_support") {
      if (candidate?.targetRole && context?.liveJobTargets?.length) {
        const relevantJobs = relevantLiveJobTargets(candidate.targetRole, context).filter((j) => j.company);
        if (relevantJobs.length > 0) {
          const leadJob = relevantJobs[0];
          const roleReference = formatLiveRoleReference(leadJob);
          return `Search LinkedIn for someone connected to ${leadJob.company} whose path is closest to ${roleReference}. Add them as a contact for ${candidate.targetRole}.`;
        }
      }
      if (candidate?.targetRole) return `Search LinkedIn for "${candidate.targetRole}" and find one person already in that kind of role. Add them as a contact — even a cold note to someone one step ahead is worth more than no contact.`;
      return broadPursuitMissingContactsFirstStep(context?.broadPursuitMissingNetworkSupport || []);
    }
    if (candidate && candidate.sourceStatus === "broad_parallel_pursuit_learning_support") {
      const referenceRole = candidate.sourceNote?.match(/\bfrom\s+(.+?)\.\s*Confirm or edit/i)?.[1]
        || candidate.title.match(/^Use (.+?) for Anchor's first prep suggestion/i)?.[1];
      const gapFromNote = candidate.sourceNote?.match(/Anchor's working diagnosis:\s*(.+?)\s+may be the weakest/i)?.[1];
      if (referenceRole) {
        return `Open ${referenceRole}; Anchor's draft diagnosis is ${gapFromNote || "the weakest requirement"} - confirm or edit it.`;
      }
      if (candidate.targetRole) {
        const likelyGap = gapFromNote || likelyLearningGapPlan({ rolePath: candidate.targetRole }).label;
        return `Open one live role or role note for ${candidate.targetRole}; Anchor's draft diagnosis is ${likelyGap} - confirm or edit it.`;
        /* const roleKey = String(candidate?.targetRole || "").toLowerCase();
        let suggestion = "";
        if (/ai|governance|safety/.test(roleKey)) suggestion = `Read one recent AI governance briefing or policy paper and note the main debate. Start with Brookings, CSIS, or the AI Now Institute.`;
        else if (/chief of staff|operations|operator/.test(roleKey)) suggestion = `Find one example of a Chief of Staff job description and list the top 3 skills it asks for. Note which ones you can already demonstrate.`;
        else if (/geopoliti|strateg|advisory/.test(roleKey)) suggestion = `Read one recent geopolitics briefing (Chatham House, IISS, or Foreign Affairs) and write a one-paragraph take on the main tension.`;
        else if (/philanthropy|development|funder/.test(roleKey)) suggestion = `Find one recent report from a major funder or development org in your target area. Note what they're prioritising this year.`;
        if (suggestion) return suggestion;
        return `Search for "${candidate.targetRole}" on LinkedIn Learning, Coursera, or Google Scholar. Save the first resource that looks genuinely useful — not the most popular, the most relevant to the roles you're targeting.`;
        */
      }
      return broadPursuitMissingPrepFirstStep(context?.broadPursuitMissingLearningSupport || []);
    }
    if (context?.broadPursuitMissingCombinations?.length) {
      return broadPursuitMissingRolesFirstStep(context.broadPursuitMissingCombinations);
    }
    return "Open your job sources and add or apply to one real role in each active path before doing narrower comparison work.";
  }
  if (source === "job") {
    const brief = parseBrief(candidate?.companyBrief);
    if (candidate?.jobTruthAction === "warm") {
      if (candidate.linkedContactNames?.length) return `Open the role and draft a message to ${candidate.linkedContactNames[0]} — they're already linked to this role.`;
      if (brief?.outreachSuggestions?.[0]?.searchTip) return brief.outreachSuggestions[0].searchTip;
      return "Open the role and draft the shortest message to someone who could help or refer you.";
    }
    if (candidate?.jobTruthAction === "prove") {
      if (brief?.prepAngle) return brief.prepAngle;
      return "Open your strongest learning item or reusable example and make one weak requirement easier to back up.";
    }
    if (candidate?.jobTruthAction === "clarify") return "Open the role and confirm the missing facts before spending more effort.";
    if (candidate?.jobTruthAction === "follow_up") return "Open the role and send the polite follow-up or warm nudge.";
    if (candidate?.jobTruthAction === "prepare") {
      if (brief?.prepAngle) return brief.prepAngle;
      return "Open the role and draft the strongest interview stories or prep notes.";
    }
    return "Open the role, your CV, and the application materials for this step.";
  }
  if (source === "contact") {
    if (candidate?.title) {
      const contract = contractForTaskIntent({
        title: candidate.title,
        category: candidate.category,
        sourceType: candidate.source,
        sourceNote: candidate.sourceNote,
        doneWhen: candidate.doneWhen,
      });
      if (candidate.sourceStatus === "to_contact" && /one real person is chosen and the outreach ask is ready/i.test(contract.doneWhen)) {
        return contract.firstStep;
      }
    }
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "Open the thread and write the shortest message that advances the live role right now.";
    if (intent === "interview") return "Open the thread and ask the one question that sharpens the interview or active process.";
    if (intent === "capability") return "Open the thread and ask for one concrete steer on the skill gap or missing area.";
    return "Open the thread and write a short message asking for one concrete reality-check on the role or market.";
  }
  if (source === "learn") return "Open the learning item or a blank note and capture one useful note, brief, or practice result.";
  if (source === "hustle") return "Open the project or public-work item and make the smallest publishable or reusable fragment.";
  if (candidate?.title) {
    const contract = contractForTaskIntent({
      title: candidate.title,
      category: candidate.category,
      sourceType: candidate.source,
      sourceNote: candidate.sourceNote,
      doneWhen: candidate.doneWhen,
    });
    if (contract.intent !== "admin_action") return contract.firstStep;
    const t = candidate.title.toLowerCase();
    if (t.includes("find") || t.includes("search") || t.includes("explore")) return "Open LinkedIn or a job board and search for the first real example.";
    if (t.includes("compare")) return "Open the two things you're comparing and write one sentence about what's different.";
    if (t.includes("reach out") || t.includes("contact") || t.includes("message")) return "Pick one person and draft the shortest useful message.";
    if (t.includes("review") || t.includes("read")) return "Open the thing and read just the first section — then write one useful note.";
  }
  if (candidate?.title) return `Open "${candidate.title.slice(0, 40).trim()}" and do the first thing that comes to mind.`;
  return "Open this and do the first thing that comes to mind — even 2 minutes counts.";
}

function stopRuleForSource(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "goal") {
    if (candidate?.sourceStatus === "broad_parallel_pursuit" && candidate?.targetRole) {
      return `Stop after one real ${displayCombination(candidate.targetRole)} posting is saved with enough JD text for Anchor to compare it to your profile.`;
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_network_support") {
      if (candidate?.targetRole) return `Stop after ${candidate.targetRole} has one useful person and one concrete hiring question ready.`;
      return broadPursuitMissingContactsStopRule();
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_learning_support") {
      if (candidate?.targetRole) return `Stop after ${candidate.targetRole} has Anchor's suggested requirement and one matching smallest prep move saved.`;
      return broadPursuitMissingPrepStopRule();
    }
    if (context?.broadPursuitMissingCombinations?.length) {
      return broadPursuitMissingRolesStopRule();
    }
    return "Stop after one concrete role or application move exists in each active path.";
  }
  if (source === "job") {
    if (candidate?.jobTruthAction === "warm") {
      if (candidate.linkedContactNames?.length) return `Stop after the message to ${candidate.linkedContactNames[0]} is drafted, sent, or scheduled.`;
      return "Stop after one message to someone useful is drafted, sent, or scheduled.";
    }
    if (candidate?.jobTruthAction === "prove") return "Stop after one weak requirement is easier to back up than it was before.";
    if (candidate?.jobTruthAction === "clarify") return "Stop after the key missing facts are confirmed.";
    if (candidate?.jobTruthAction === "follow_up") return "Stop after one follow-up or warm nudge is sent.";
    if (candidate?.jobTruthAction === "prepare") return "Stop after one interview-prep artifact is stronger than it was before.";
    return "Stop after one concrete application or materials step is complete.";
  }
  if (source === "contact") {
    if (candidate?.title) {
      const contract = contractForTaskIntent({
        title: candidate.title,
        category: candidate.category,
        sourceType: candidate.source,
        sourceNote: candidate.sourceNote,
        doneWhen: candidate.doneWhen,
      });
      if (candidate.sourceStatus === "to_contact" && /one real person is chosen and the outreach ask is ready/i.test(contract.doneWhen)) {
        return contract.stopCondition;
      }
    }
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "Stop after the live-role message is drafted, sent, or clearly scheduled.";
    if (intent === "interview") return "Stop after the interview question or prep ask is sent or clearly scheduled.";
    if (intent === "capability") return "Stop after the message asks for one concrete steer on the skill gap or missing area.";
    return "Stop after the message asks for one concrete reality-check on the role or market and is drafted, sent, or scheduled.";
  }
  if (source === "learn") return "Stop after one useful note, brief, practice result, or reusable example exists.";
  if (source === "hustle") return "Stop after one reusable or publishable piece exists, or the next concrete step is finished.";
  if (candidate?.title) {
    const contract = contractForTaskIntent({
      title: candidate.title,
      category: candidate.category,
      sourceType: candidate.source,
      sourceNote: candidate.sourceNote,
      doneWhen: candidate.doneWhen,
    });
    if (contract.intent !== "admin_action") return contract.stopCondition;
  }
  return "Stop when something is visibly different from when you started.";
}

function sourceFrame(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "goal") {
    if (candidate?.sourceStatus === "broad_parallel_pursuit" && candidate?.targetRole) {
      return `${displayCombination(candidate.targetRole)} has no real posting yet — use one posting to see what the path asks for before narrowing.`;
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_network_support") {
      if (candidate?.targetRole) return `${candidate.targetRole} has no contacts yet — add one useful person to reach out to.`;
      return broadPursuitMissingContactsSourceFrame(context?.broadPursuitMissingNetworkSupport || []);
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_learning_support") {
      if (candidate?.targetRole) return `${candidate.targetRole} still lacks one clearly named prep gap - use the closest live role to identify it and choose one matching prep move.`;
      return broadPursuitMissingPrepSourceFrame(context?.broadPursuitMissingLearningSupport || []);
    }
    if (context?.broadPursuitMissingCombinations?.length) {
      return broadPursuitMissingRolesSourceFrame(context.broadPursuitMissingCombinations);
    }
    return "You are testing several paths in parallel, so the best move is to turn each one into a real role or application move.";
  }
  if (source === "job") {
    const brief = parseBrief(candidate?.companyBrief);
    const companyCtx = brief?.whyYouFit || brief?.whatTheyDo || "";
    if (candidate?.jobTruthAction === "warm") {
      if (candidate.linkedContactNames?.length) return `This role looks promising — reach out to ${candidate.linkedContactNames[0]}, who's already linked to it.`;
      if (brief?.outreachSuggestions?.[0]?.archetype) return `This role looks promising. Find ${brief.outreachSuggestions[0].archetype} before going in cold.`;
      return "This role looks promising, but the best next step is to reach out to someone useful before going in cold.";
    }
    if (candidate?.jobTruthAction === "prove") return companyCtx ? `${companyCtx} You need one clearer example to point to before pushing harder.` : "This role looks promising, but you still need one clearer example you can point to before pushing harder.";
    if (candidate?.jobTruthAction === "clarify") return "This role needs one clarification pass before it deserves more effort.";
    if (candidate?.jobTruthAction === "follow_up") return "This role is already moving, so follow-through matters most right now.";
    if (candidate?.jobTruthAction === "prepare") return companyCtx ? `${companyCtx} Preparation matters most right now.` : "This role is live, so preparation matters most right now.";
    return companyCtx ? `${companyCtx} This is one of the strongest next moves right now.` : "This role is one of the strongest next moves right now.";
  }
  if (source === "contact") {
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "This person is most likely to help with a live role right now.";
    if (intent === "interview") return "This person is the best networking move for sharpening an active interview or process right now.";
    if (intent === "capability") return "This person can help you close a real requirement gap right now.";
    return "This person can help you get clearer on which roles make sense right now.";
  }
  if (source === "learn") return "This learning move helps you get stronger without stopping applications.";
  if (source === "hustle") return "This writing, project, or public-work move turns learning into something reusable later.";
  if (candidate?.title) return `"${candidate.title.slice(0, 60).trim()}" is already in progress — this keeps it moving.`;
  return "This is still a useful next move right now.";
}

function explainRecommendation(
  ranked: RankedCandidate[],
  context: StrategicContext,
  pick: Candidate,
): RecommendationExplanation {
  const top = ranked[0];
  const second = ranked[1];
  const lane = candidateStrategicLane(pick, context);
  const focusArea = focusAreaLabel(lane);
  const supportingReasons = top.trace.filter(Boolean).slice(0, 4);
  const whyNow = supportingReasons[0] || context.reason || "This is the strongest available move right now.";
  const whyThis = second
    ? `It beats "${second.c.title.slice(0, 40).trim()}" because it helps more with ${focusArea} right now.`
    : `It's the only move that directly advances ${focusArea} right now.`;

  return {
    summary: `${sourceFrame(pick.source, pick, context)} Main focus: ${focusArea}${context.activeTrackName ? ` in ${context.activeTrackName}` : ""}.`,
    whyNow,
    whyThis,
    supportingReasons,
    firstStep: firstStepForSource(pick.source, pick, context),
    stopRule: stopRuleForSource(pick.source, pick, context),
  };
}

function explainRankedPlanItem(
  ranked: RankedCandidate[],
  index: number,
  context: StrategicContext,
): RecommendationExplanation {
  const current = ranked[index];
  const next = ranked[index + 1];
  const lane = candidateStrategicLane(current.c, context);
  const focusArea = focusAreaLabel(lane);
  const supportingReasons = current.trace.filter(Boolean).slice(0, 4);
  if (current.c.source === "job" && current.c.companyBrief) {
    const brief = parseBrief(current.c.companyBrief);
    if (brief?.landscape?.marketContext) supportingReasons.push(brief.landscape.marketContext);
    if (brief?.landscape?.competitors?.length) supportingReasons.push(`Also hiring: ${brief.landscape.competitors.slice(0, 3).join(", ")}`);
    if (brief?.landscape?.alsoConsider?.length) supportingReasons.push(`Worth exploring: ${brief.landscape.alsoConsider.slice(0, 2).join(", ")}`);
  }
  const frame = sourceFrame(current.c.source, current.c, context);
  return {
    summary: `${frame} Main focus: ${focusArea}${context.activeTrackName ? ` in ${context.activeTrackName}` : ""}.`,
    whyNow: supportingReasons[0] || current.c.whyNow || context.reason || `The main constraint is ${focusArea}.`,
    whyThis: next
      ? `It outranks "${next.c.title.slice(0, 40).trim()}" because it helps more with ${focusArea} right now.`
      : `It's the only move that directly advances ${focusArea} right now.`,
    supportingReasons,
    firstStep: firstStepForSource(current.c.source, current.c, context),
    stopRule: stopRuleForSource(current.c.source, current.c, context),
  };
}

export function explainPersistedPlanItem(item: {
  sourceType?: string | null;
  whySelected?: string | null;
  doneWhen?: string | null;
  status?: string | null;
  skippedAt?: number | null;
  movedAt?: number | null;
  title?: string | null;
}): RecommendationExplanation {
  const source = (item.sourceType || "task") as SourceKind;
  const rawWhy = (item.whySelected || "").trim();
  const wasCarried = rawWhy.toLowerCase().includes("carried forward") || rawWhy.toLowerCase().includes("carry-forward");
  const wasSkipped = item.status === "skipped" || !!item.skippedAt;
  const wasMoved = item.status === "moved" || !!item.movedAt;

  const madeSmaller = /this was made smaller so starting is easier\.?/i;
  const hadShrink = madeSmaller.test(rawWhy);
  const why = rawWhy.replace(madeSmaller, "").trim();

  const mainFocusMatch = why.match(/Main focus:\s*(.+?)\.?\s*$/i);
  const mainFocus = mainFocusMatch?.[1]?.trim() || "";
  const coreSentence = mainFocusMatch ? why.slice(0, mainFocusMatch.index).trim() : why;

  const whyThis = wasCarried
    ? "It carried over from yesterday — finishing it or parking it clears the backlog."
    : wasSkipped
    ? "It was skipped before, so it's been made smaller or given a different angle."
    : wasMoved
    ? "It was moved to later but is still worth doing today."
    : coreSentence || (item.title ? `"${item.title.slice(0, 50).trim()}" is worth doing today.` : "It's one of today's most useful moves.");

  const whyNow = hadShrink
    ? "This was made smaller so starting is easier."
    : mainFocus
    ? `The main constraint right now is ${mainFocus.toLowerCase()}.`
    : item.doneWhen
    ? `The next useful thing is: ${item.doneWhen.toLowerCase()}.`
    : item.title
    ? `"${item.title.slice(0, 50).trim()}" is still on today's plan.`
    : "It's still on today's plan.";

  const supportingReasons: string[] = [];
  if (coreSentence && mainFocus && coreSentence !== whyThis) supportingReasons.push(coreSentence);
  if (mainFocus && !whyNow.includes(mainFocus.toLowerCase())) supportingReasons.push(`Main focus: ${mainFocus}`);

  const summaryBase = coreSentence || sourceFrame(source);
  return {
    summary: hadShrink ? `${summaryBase} This was made smaller so starting is easier.` : summaryBase,
    whyNow,
    whyThis,
    supportingReasons,
    firstStep: firstStepForSource(source),
    stopRule: item.doneWhen?.trim() ? `Stop when: ${item.doneWhen.trim()}` : stopRuleForSource(source),
  };
}

export function planDay(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[],
  energy: Energy, capacity: CapacityInput = 0,
  contacts: Contact[] = [], tracks: CareerTrack[] = [],
  learnMilestoneProgress: Map<number, { done: number; total: number }> = new Map(),
  jobContactLinks: Record<number, number[]> = {},
  profile?: PlanningProfile,
): { mode: DayMode; plan: PlanItem[]; note: string; mvdIndex: number; trace: PlanTrace } {
  const context = buildStrategicContext(tasks, jobs, learn, hustles, contacts, tracks, profile);
  const priorityCandidates: Candidate[] = [];
  if (needsBroadPursuitGoalCandidate(context)) {
    priorityCandidates.push(buildBroadPursuitGoalCandidate(context));
  } else if (needsBroadPursuitSupportGoalCandidate(context)) {
    priorityCandidates.push(...buildBroadPursuitSupportGoalCandidates(context));
  }
  const all = [...priorityCandidates, ...gatherCandidates(tasks, jobs, learn, hustles, contacts, learnMilestoneProgress, jobContactLinks)];
  const ignored = all
    .map((c) => ({ c, reason: gateReason(c, context) }))
    .filter((x) => x.reason)
    .slice(0, 5)
    .map((x) => `${x.c.title}: ${x.reason}`);
  const cands = all.filter((c) => passesGates(c, context));
  const mode = pickDayMode(cands, energy, context);
  const budget = capacityMinutes(capacity);

  if (cands.length === 0) {
    const emptyTrace: PlanTrace = { picked: [], ignored, bottleneck: context.bottleneck, reason: context.reason, remainingMinutes: budget, laneTrace: context.laneModel.trace };

    const blocked = all.filter((c) => c.blocked && c.status !== "done");
    if (blocked.length > 0) {
      const easiest = blocked.sort((a, b) => {
        const aWaiting = /wait|reply|response/i.test(a.blockerReason);
        const bWaiting = /wait|reply|response/i.test(b.blockerReason);
        if (aWaiting !== bWaiting) return aWaiting ? 1 : -1;
        return (a.blockerReason || "").length - (b.blockerReason || "").length;
      })[0];
      const unblockStep = /wait|reply|response/i.test(easiest.blockerReason)
        ? `Check if you've gotten a reply — if so, unblock it and go.`
        : `Clear this blocker: ${easiest.blockerReason || "name the missing input, dependency, or next action"}.`;
      const plan: PlanItem[] = [{
        slot: "now", candidate: easiest, why: `Everything else is stuck. This blocker looks easiest to clear.`, isMVD: true,
        explanation: { summary: `${blocked.length} thing${blocked.length > 1 ? "s are" : " is"} blocked. Start with the easiest one.`, whyNow: "Nothing else can move until a blocker clears.", whyThis: `This one looks most clearable: "${easiest.blockerReason || "unspecified"}."`, supportingReasons: blocked.length > 1 ? [`${blocked.length - 1} other blocked item${blocked.length > 2 ? "s" : ""} waiting too.`] : [], firstStep: unblockStep, stopRule: "Unblock it or park it — either clears the jam." },
      }];
      return { mode, plan, note: `${blocked.length} thing${blocked.length > 1 ? "s" : ""} stuck — clearing one unblocks the day.`, mvdIndex: 0, trace: emptyTrace };
    }

    const avoided = all.filter((c) => c.skipped >= 2 && c.status !== "done");
    if (avoided.length > 0) {
      const least = avoided.sort((a, b) => a.skipped - b.skipped)[0];
      const plan: PlanItem[] = [{
        slot: "now", candidate: least, why: `Everything's been sliding. This one has slipped the least — start here.`, isMVD: true,
        explanation: { summary: `${avoided.length} task${avoided.length > 1 ? "s have" : " has"} been skipped repeatedly.`, whyNow: "A day of skipped tasks means something needs to change.", whyThis: `This one has only been skipped ${least.skipped} time${least.skipped > 1 ? "s" : ""} — most likely to stick.`, supportingReasons: [], firstStep: "Open it and do just the first step. If it still won't move, park it.", stopRule: "Do one step or decide to park it." },
      }];
      return { mode, plan, note: "Everything's been sliding — starting with the one most likely to move.", mvdIndex: 0, trace: emptyTrace };
    }

    const doneTasks = tasks.filter((t) => t.done);
    const activeTasks = tasks.filter((t) => !t.done && t.list === "today");
    if (doneTasks.length > 0 && activeTasks.length === 0) {
      return { mode, plan: [], note: "You finished everything today. Nice work — you're done.", mvdIndex: -1, trace: emptyTrace };
    }

    const activeTracks = tracks.filter((t) => t.status === "active");
    if (activeTracks.length > 0) {
      const track = activeTracks[0];
      const trackJobs = jobs.filter((j) => j.relatedTrackId === track.id || (j as any).trackId === track.id);
      const hasJobs = trackJobs.length > 0;
      const trackContacts = contacts.filter((c) => (c as any).relatedTrackId === track.id);
      const hasContacts = trackContacts.length > 0;

      const archetype = track.targetRoleArchetype || track.name;
      const topCompanies = [...new Set(trackJobs.map((j) => j.company).filter(Boolean))].slice(0, 2);
      const topRole = trackJobs.find((j) => j.title)?.title || "";

      let title: string;
      let firstStep: string;
      let why: string;
      let summary: string;
      let doneWhen: string;

      if (!hasJobs) {
        title = `Search for a ${archetype} role you'd actually apply to`;
        firstStep = topRole
          ? `Look for roles similar to "${topRole}" on LinkedIn or a job board. Save the first one that's real enough to apply to.`
          : `Search "${archetype}" on LinkedIn. You're not committing — just find one opening that feels worth reading twice.`;
        why = `You've set up a ${track.name} track but haven't saved any real openings yet. One concrete role makes everything else — prep, networking, outreach — specific instead of hypothetical.`;
        summary = `Your ${track.name} track needs a real role to anchor it.`;
        doneWhen = "One role saved that you could realistically apply to";
      } else if (!hasContacts) {
        const companyHint = topCompanies.length > 0
          ? `someone at ${topCompanies.join(" or ")}` : "someone in this space";
        title = `Save one real person ${companyHint} you could ask for a 15-minute steer`;
        firstStep = topCompanies.length > 0
          ? `Check LinkedIn for anyone you know at ${topCompanies.join(" or ")}. A second-degree connection, a former colleague who moved there, an alumni contact — anyone real.`
          : `Check your contacts, alumni network, or LinkedIn for one real ${archetype} person. Add their role, organisation, and why they are relevant.`;
        why = `You have ${trackJobs.length} ${archetype} role${trackJobs.length > 1 ? "s" : ""} saved${topCompanies[0] ? ` (${topCompanies.join(", ")})` : ""} but nobody to talk to about them. One real conversation changes how you prep and apply.`;
        summary = `You've got roles saved for ${track.name} — now add one person you could actually message.`;
        doneWhen = "One contact added who you'd realistically message";
      } else {
        const wishlistJob = trackJobs.find((j) => j.status === "wishlist");
        const appliedJob = trackJobs.find((j) => j.status === "applied");
        const warmContact = trackContacts.find((c) => c.relationshipStrength === "warm" || c.status === "replied");
        const draftContact = trackContacts.find((c) => c.messageDraft);
        const trackLearns = learn.filter((l) => (l as any).relatedTrackId === track.id && !l.done && l.active);

        if (appliedJob) {
          const jobLabel = `${appliedJob.title}${appliedJob.company ? ` at ${appliedJob.company}` : ""}`;
          title = `Follow up on ${jobLabel}`;
          firstStep = warmContact
            ? `Message ${warmContact.name || warmContact.who} about "${jobLabel}" — a short check-in moves you from "applied" to "known."`
            : `Open "${jobLabel}" and check: any response yet? If not, find someone at ${appliedJob.company || "the org"} to reach out to.`;
          why = `You applied to ${jobLabel} but it's sitting. One follow-up or warm nudge moves it forward.`;
          summary = `${jobLabel} needs a follow-up.`;
          doneWhen = `Follow-up sent or next step identified for ${appliedJob.company || "this role"}`;
        } else if (draftContact) {
          const contactLabel = draftContact.name || draftContact.who;
          title = `Send the message to ${contactLabel}`;
          firstStep = `Open the draft for ${contactLabel} and send it. It's already written — just review and hit send.`;
          why = `You drafted a message to ${contactLabel} but haven't sent it. One sent message is worth ten planned ones.`;
          summary = `Message to ${contactLabel} is drafted — send it.`;
          doneWhen = "Message sent";
        } else if (wishlistJob) {
          const jobLabel = `${wishlistJob.title}${wishlistJob.company ? ` at ${wishlistJob.company}` : ""}`;
          title = `Start the application for ${jobLabel}`;
          firstStep = `Open "${jobLabel}" and begin the application. If materials aren't ready, open your CV and the posting side by side — tailor one bullet.`;
          why = `${jobLabel} is saved but you haven't started applying. Moving it from wishlist to in-progress is the highest-leverage thing you can do today.`;
          summary = `${jobLabel} is waiting for you to start.`;
          doneWhen = `Application started or one material tailored for ${wishlistJob.company || "this role"}`;
        } else if (trackLearns.length > 0) {
          const item = trackLearns[0];
          title = item.requiredOutput ? `${item.title} — produce: ${item.requiredOutput}` : item.title;
          firstStep = item.url ? `Open ${item.url} and spend 20 minutes. Note one thing that changes how you'd answer an interview question.` : `Open "${item.title}" and capture one useful note.`;
          why = `Your applications and contacts are moving. Now strengthen the knowledge behind them — "${item.title}" fills a gap your target roles keep asking for.`;
          summary = `${track.name} roles need this — spend 20 minutes on "${item.title}."`;
          doneWhen = item.requiredOutput || `One useful note from "${item.title}"`;
        } else {
          const nextJob = trackJobs[0];
          const nextJobHint = nextJob ? `${nextJob.title}${nextJob.company ? ` at ${nextJob.company}` : ""}` : archetype;
          title = context.laneUnlockMove || `Move "${nextJobHint}" forward`;
          firstStep = nextJob
            ? `Open "${nextJobHint}" and do the next obvious thing: check for updates, draft a follow-up, or prep one interview answer.`
            : `Open your ${track.name} track and pick the thing that's been sitting longest.`;
          why = `You have roles and contacts for ${track.name}. The pieces are there — pick one and move it.`;
          summary = `${track.name} is set up — move the most actionable piece forward.`;
          doneWhen = "One concrete action taken";
        }
      }

      const synthetic: Candidate = {
        source: "goal", sourceId: track.id, taskId: null,
        title, category: hasJobs ? "admin" : "job", size: "quick",
        deadline: "", status: "not_started", skipped: 0,
        sourceUrl: "", sourceNote: "", sourceStatus: "",
        doneWhen, whyNow: why, fitScore: null, blocked: false, blockerReason: "", eligibilityRisk: "",
      };
      const plan: PlanItem[] = [{
        slot: "now", candidate: synthetic, why, isMVD: true,
        explanation: { summary, whyNow: "This is the single thing that moves your search forward today.", whyThis: why, supportingReasons: activeTracks.length > 1 ? [`${activeTracks.length - 1} other track${activeTracks.length > 2 ? "s" : ""} also active — this one needs it most.`] : [], firstStep, stopRule: "Just one — that's enough to get momentum." },
      }];
      return { mode, plan, note: summary, mvdIndex: 0, trace: emptyTrace };
    }

    return {
      mode,
      plan: [],
      note: "Nothing actionable right now — add a thought to Brain Dump or save a job, and I'll shape a day from there.",
      mvdIndex: -1,
      trace: emptyTrace,
    };
  }

  const prereqLearnIds = new Set<number>();
  for (const c of cands) {
    if (c.blockedBy?.startsWith("learn:")) {
      const lid = Number(c.blockedBy.slice(6));
      if (Number.isFinite(lid)) prereqLearnIds.add(lid);
    }
  }
  const ranked = cands.map((c) => {
    const r = scoreWithTrace(c, energy, mode, context);
    if (c.source === "learn" && prereqLearnIds.has(c.sourceId)) {
      r.s += 60;
      r.trace.push("prerequisite for a task you need to get unstuck on");
    }
    return r;
  }).sort((a, b) => b.s - a.s || a.c.sourceId - b.c.sourceId);
  const maxItems = budget < 45 ? 1
    : budget < 90 ? 1
    : (energy === "low" || mode === "low") ? Math.min(2, cands.length)
    : budget < 180 ? 2
    : 3;

  const picks: RankedCandidate[] = [];
  const usedFamily = new Set<string>();
  const usedLanes = new Set<CanonicalLaneName>();
  const lanePreference = desiredLaneOrder(context.planningPosture);
  const balanceWindow = laneBalanceWindow(context.planningPosture);
  for (const r of ranked) {
    if (picks.length >= maxItems) break;
    const fam = CATEGORY_FAMILY[r.c.category] ?? "care";
    const lane = candidateStrategicLane(r.c, context);
    if (usedFamily.has(fam)) {
      const betterDiff = ranked.find(other => !usedFamily.has(CATEGORY_FAMILY[other.c.category] ?? "care")
        && !picks.includes(other) && (r.s - other.s) <= 25);
      if (betterDiff) continue;
    }
    if (maxItems > 1 && mode !== "deadline") {
      const preferredMissingLane = lanePreference.find((candidateLane) => !usedLanes.has(candidateLane));
      if (preferredMissingLane && lane !== preferredMissingLane) {
        const betterLane = ranked.find((other) => {
          if (picks.includes(other)) return false;
          return candidateStrategicLane(other.c, context) === preferredMissingLane && (r.s - other.s) <= balanceWindow;
        });
        if (betterLane) continue;
      }
    }
    if (maxItems > 1 && mode !== "deadline" && usedLanes.has(lane)) {
      const betterLane = ranked.find((other) => {
        if (picks.includes(other)) return false;
        const otherLane = candidateStrategicLane(other.c, context);
        return !usedLanes.has(otherLane) && (r.s - other.s) <= balanceWindow;
      });
      if (betterLane) continue;
    }
    picks.push(r); usedFamily.add(fam); usedLanes.add(lane);
  }
  if (picks.length < maxItems) {
    for (const r of ranked) {
      if (picks.includes(r)) continue;
      picks.push(r);
      if (picks.length >= maxItems) break;
    }
  }

  if (
    mode === "strategy"
    && context.broadPursuitMissingCombinations.length === 0
    && context.broadPursuitMissingNetworkSupport.length > 0
    && context.broadPursuitMissingLearningSupport.length > 0
    && maxItems > 1
    && !picks.some((pick) => pick.c.sourceStatus === "broad_parallel_pursuit_learning_support")
  ) {
    const learningSupportPick = ranked.find((r) => r.c.sourceStatus === "broad_parallel_pursuit_learning_support");
    if (learningSupportPick) {
      let replaceIndex = picks.findIndex((pick, index) =>
        index > 0 && pick.c.sourceStatus !== "broad_parallel_pursuit_network_support",
      );
      if (replaceIndex < 0 && picks.length > 1) replaceIndex = picks.length - 1;
      if (replaceIndex >= 0) {
        picks[replaceIndex] = learningSupportPick;
      } else if (picks.length < maxItems) {
        picks.push(learningSupportPick);
      }
    }
  }

  for (let i = 0; i < picks.length; i++) {
    const dep = picks[i].c.blockedBy;
    if (!dep || !dep.startsWith("learn:")) continue;
    const learnId = Number(dep.slice(6));
    if (!Number.isFinite(learnId)) continue;
    const learnIdx = picks.findIndex((p) => p.c.source === "learn" && p.c.sourceId === learnId);
    if (learnIdx > i) {
      const [learnPick] = picks.splice(learnIdx, 1);
      picks.splice(i, 0, learnPick);
    } else if (learnIdx < 0) {
      const learnCand = ranked.find((r) => r.c.source === "learn" && r.c.sourceId === learnId && !picks.includes(r));
      if (learnCand && picks.length > 1) {
        picks.splice(i, 0, learnCand);
        if (picks.length > maxItems + 1) picks.pop();
      }
    }
  }

  const prerequisiteLearnIds = new Set<number>();
  const prerequisiteUnlocksTitle = new Map<number, string>();
  for (const p of picks) {
    const dep = p.c.blockedBy;
    if (dep && dep.startsWith("learn:")) {
      const learnId = Number(dep.slice(6));
      if (Number.isFinite(learnId)) {
        prerequisiteLearnIds.add(learnId);
        prerequisiteUnlocksTitle.set(learnId, p.c.title);
      }
    }
  }

  const mvd = picks[0];
  const slots: SlotName[] = ["now", "next", "later", "bonus"];
  const plan: PlanItem[] = picks.map((r, i) => {
    let why = whyLine(r, context);
    if (r.c.source === "learn" && prerequisiteLearnIds.has(r.c.sourceId)) {
      const unlocks = prerequisiteUnlocksTitle.get(r.c.sourceId);
      why = unlocks
        ? `This fills a gap that was blocking you on "${unlocks}." Do this first, then that task is ready.`
        : `This fills a skill gap that was blocking another task. Do this first.`;
    }
    return {
      slot: slots[Math.min(i, slots.length - 1)],
      candidate: r.c,
      why,
      isMVD: r === mvd,
      explanation: explainRankedPlanItem(picks, i, context),
    };
  });

  const planMin = picks.reduce((m, r) => m + (SIZE_MINUTES[r.c.size] ?? 45), 0);
  const fits = planMin <= Math.max(15, budget);
  const topTitle = picks[0]?.c.title.slice(0, 50).trim() || "";
  const note =
    mode === "deadline" ? `A deadline's close — "${topTitle}" leads. Do that one and today counts.`
    : budget < 45 ? `Short on time. Just do "${topTitle}" — that's a real win for today.`
    : budget < 90 ? `Enough time for one solid move. "${topTitle}" is the one that matters most right now.`
    : mode === "low" ? `Lighter day. Just finish "${topTitle}" and you're done — quality over quantity.`
    : mode === "strategy" && needsBroadPursuitGoalCandidate(context) ? broadPursuitNextMissingRolePlanNote(context.broadPursuitMissingCombinations)
    : mode === "strategy"
      && context.broadPursuitMissingNetworkSupport.length > 0
      && context.broadPursuitMissingLearningSupport.length > 0
      && context.broadPursuitMissingCombinations.length === 0
      ? broadPursuitMissingSupportContextReason(
        context.broadPursuitMissingNetworkSupport,
        context.broadPursuitMissingLearningSupport,
      )
    : mode === "strategy" && context.broadPursuitMissingNetworkSupport.length > 0 && context.broadPursuitMissingCombinations.length === 0 ? broadPursuitNextMissingContactPlanNote(context.broadPursuitMissingNetworkSupport)
    : mode === "strategy" && context.broadPursuitMissingLearningSupport.length > 0 && context.broadPursuitMissingCombinations.length === 0 ? broadPursuitNextMissingPrepPlanNote(context.broadPursuitMissingLearningSupport)
    : mode === "strategy" ? `The main constraint right now is ${focusAreaLabel(context.bottleneckLane)}. "${topTitle}" is the move to unblock it.`
    : fits ? `Start with "${topTitle}". Finish that and today already counts.`
    : `Full plate. Just do "${topTitle}" and call it a win — the rest can wait.`;

  return {
    mode,
    plan,
    note,
    mvdIndex: 0,
    trace: {
      picked: picks.map((r) => `${r.c.title}: ${whyLine(r, context)}`),
      ignored,
      bottleneck: context.bottleneck,
      reason: context.reason,
      remainingMinutes: budget,
      laneTrace: context.laneModel.trace,
    },
  };
}

export function recommend(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], energy: Energy,
  contacts: Contact[] = [], tracks: CareerTrack[] = [],
  jobContactLinks: Record<number, number[]> = {},
  profile?: PlanningProfile,
) {
  const context = buildStrategicContext(tasks, jobs, learn, hustles, contacts, tracks, profile);
  const priorityCandidates: Candidate[] = [];
  if (needsBroadPursuitGoalCandidate(context)) {
    priorityCandidates.push(buildBroadPursuitGoalCandidate(context));
  } else if (needsBroadPursuitSupportGoalCandidate(context)) {
    priorityCandidates.push(...buildBroadPursuitSupportGoalCandidates(context));
  }
  const cands = [...priorityCandidates, ...gatherCandidates(tasks, jobs, learn, hustles, contacts, new Map(), jobContactLinks)].filter((c) => passesGates(c, context));
  const mode = pickDayMode(cands, energy, context);
  if (cands.length === 0) return { mode, pick: null, alternative: null };
  const ranked = cands.map((c) => scoreWithTrace(c, energy, mode, context)).sort((a, b) => b.s - a.s || a.c.sourceId - b.c.sourceId);
  const pick = ranked[0].c;
  const alternative = ranked.map((r) => r.c).find((c) => !(c.source === pick.source && c.sourceId === pick.sourceId) && c.size === "quick") || null;
  return {
    mode,
    pick,
    alternative,
    trace: ranked[0].trace,
    bottleneck: context.bottleneck,
    lane: context.bottleneckLane,
    activeTrack: context.activeTrackName,
    explanation: explainRecommendation(ranked, context, pick),
  };
}
