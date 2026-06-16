import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { getLearnOutputState, isOpportunityActionable } from "@shared/domainState";
import { GOAL_WORKSTREAM } from "@shared/goalWorkstreams";
import { buildTrackSpine } from "./trackSpine";
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
    trace.push("still needs a clearer first step before it should lead");
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
): StrategicContext {
  const spine = buildTrackSpine({ tasks, jobs, learn, hustles, contacts, tracks });
  const lane = spine.globalLanes.find((l) => l.name === spine.bestMove.lane) || spine.globalLanes[0];
  const goalFrame = deriveCareerGoalFrame(tasks, jobs, [], learn, contacts, hustles, tracks);
  const broadPursuitCoverage = deriveBroadPursuitCoverage(tasks, jobs, [], learn, contacts, hustles, tracks);
  const planningPosture = planningPostureFromGoalFrame(
    goalFrame,
    spine.bestMove.lane,
    learn.some((l) => !l.done && l.learnStatus !== "closed"),
  );
  const activeOpportunityCount = countActiveOpportunities(jobs);
  const viableApplicationTruth = jobs
    .map(computeJobTruthStrip)
    .filter((truth) => truth.action !== "reject");
  const clarifyBeforePush = viableApplicationTruth.length > 0
    && viableApplicationTruth.every((truth) => truth.action === "clarify");
  const liveJobTargets = jobs.filter((j) => isOpportunityActionable(j)).map((j) => ({ title: j.title, company: j.company, roleArchetype: j.roleArchetype || "" }));
  const broadPursuitNeedsRealRoles = goalFrame.decisionMode === "broad-parallel-pursuit" && broadPursuitCoverage.missing.length > 0;
  const broadPursuitNeedsNetworkSupport = goalFrame.decisionMode === "broad-parallel-pursuit"
    && broadPursuitCoverage.missing.length === 0
    && goalFrame.recommendedFocus === GOAL_WORKSTREAM.NETWORK
    && broadPursuitCoverage.missingNetworkSupport.length > 0;
  const broadPursuitNeedsLearningSupport = goalFrame.decisionMode === "broad-parallel-pursuit"
    && broadPursuitCoverage.missing.length === 0
    && broadPursuitCoverage.missingNetworkSupport.length === 0
    && goalFrame.recommendedFocus === GOAL_WORKSTREAM.PREP_UPSKILLING
    && broadPursuitCoverage.missingLearningSupport.length > 0;
  return {
    bottleneck: broadPursuitNeedsRealRoles
      ? LANE_NAME.APPLICATIONS
      : broadPursuitNeedsNetworkSupport
        ? LANE_NAME.NETWORK
        : broadPursuitNeedsLearningSupport
          ? LANE_NAME.LEARNING_DEVELOPMENT
          : spine.bestMove.lane,
    reason: broadPursuitNeedsRealRoles
      ? broadPursuitMissingRolesContextReason(broadPursuitCoverage.missing, spine.bestMove.trackName || undefined)
      : broadPursuitNeedsNetworkSupport
        ? broadPursuitMissingContactsContextReason(broadPursuitCoverage.missingNetworkSupport)
        : broadPursuitNeedsLearningSupport
          ? broadPursuitMissingPrepContextReason(broadPursuitCoverage.missingLearningSupport)
      : `${spine.bestMove.reason}${spine.bestMove.trackName ? ` Current focus: ${spine.bestMove.trackName}.` : ""}`,
    applicationsPremature: false,
    recommendedExploration: spine.bestMove.trackName || spine.activeTrack?.name || "",
    laneModel: { trace: spine.trace },
    bottleneckLane: broadPursuitNeedsRealRoles
      ? LANE_NAME.APPLICATIONS
      : broadPursuitNeedsNetworkSupport
        ? LANE_NAME.NETWORK
        : broadPursuitNeedsLearningSupport
          ? LANE_NAME.LEARNING_DEVELOPMENT
          : spine.bestMove.lane,
    laneStage: broadPursuitNeedsRealRoles || broadPursuitNeedsNetworkSupport || broadPursuitNeedsLearningSupport ? "active" : lane?.stage || "active",
    laneUnlockMove: broadPursuitNeedsRealRoles
      ? broadPursuitMissingRolesUnlockMove()
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
  return {
    source: "goal",
    sourceId: 1,
    taskId: null,
    title: combination ? `Add one real role for ${combination}` : broadPursuitMissingRolesTitle(),
    category: "job",
    size: "deep",
    deadline: "",
    status: "not_started",
    skipped: 0,
    sourceUrl: "",
    sourceNote: combination
      ? `This path still needs a real role: ${combination}. Add one real role or application move for it next.`
      : broadPursuitMissingRolesSourceNote(context?.broadPursuitMissingCombinations || []),
    sourceStatus: "broad_parallel_pursuit",
    doneWhen: combination
      ? `One concrete role or application move exists for the missing path: ${combination}`
      : broadPursuitMissingRolesDoneWhen(),
    whyNow: combination
      ? `the ${combination} path still needs a real opening`
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
      out.push({
        source: "goal",
        sourceId: 200 + index,
        taskId: null,
        title: `Add one useful contact for ${combination}`,
        category: "admin",
        size: "medium",
        deadline: "",
        status: "not_started",
        skipped: 0,
        sourceUrl: "",
        sourceNote: `This live role type still needs someone useful to reach out to: ${combination}. Add one contact or outreach path for it next.`,
        sourceStatus: "broad_parallel_pursuit_network_support",
        doneWhen: `One useful contact or outreach path exists for ${combination}`,
        whyNow: `the ${combination} path still needs someone useful to reach out to`,
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
        targetRole: combination,
        followUpDate: "",
      });
    }
  }
  if (context?.broadPursuitMissingLearningSupport?.length) {
    for (const [index, combination] of context.broadPursuitMissingLearningSupport.entries()) {
      out.push({
        source: "goal",
        sourceId: 300 + index,
        taskId: null,
        title: `Set up one prep starter for ${combination}`,
        category: "learning",
        size: "medium",
        deadline: "",
        status: "not_started",
        skipped: 0,
        sourceUrl: "",
        sourceNote: `This live role type still needs more focused prep support: ${combination}. Set up one prep starter for it next.`,
        sourceStatus: "broad_parallel_pursuit_learning_support",
        doneWhen: `One focused prep starter exists for ${combination}`,
        whyNow: `the ${combination} path still needs more focused prep support`,
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
    return { action: `${j.nextStep.trim()} — ${role}`, size: guessSize(j.nextStep), doneWhen: "That step is done", why: "your own next step on this role" };
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

function locationMomentum(location: string) {
  const tier = locationTier(location);
  if (tier === "UAE") return { score: 24, reason: "matches your top flexible location tier" };
  if (tier === "Remote") return { score: 18, reason: "fits your remote-flexible search" };
  if (tier === "London") return { score: 12, reason: "fits your London fallback search" };
  return { score: 0, reason: "" };
}

function jobMomentum(c: Candidate) {
  let s = 0;
  const trace: string[] = [];

  if (c.sourceStatus === "interviewing") {
    s += 35;
    trace.push("already in interview process");
  } else if (c.sourceStatus === "applied") {
    s += 18;
    trace.push("already in application pipeline");
  }

  const location = locationMomentum(c.location || "");
  s += location.score;
  if (location.reason) trace.push(location.reason);

  if (c.warmPathScore != null) {
    const warmBoost = Math.round((c.warmPathScore / 100) * 22);
    s += warmBoost;
    if (warmBoost >= 10) trace.push("a useful person to reach out to improves landing odds");
  }

  if (c.strategicValue != null) {
    const strategicBoost = Math.round((c.strategicValue / 100) * 16);
    s += strategicBoost;
    if (strategicBoost >= 8) trace.push("strategically valuable role");
  }

  if (c.frictionScore != null) {
    const frictionPenalty = Math.round((c.frictionScore / 100) * 18);
    s -= frictionPenalty;
    if (frictionPenalty >= 8) trace.push("application friction penalty");
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
  return {
    action: `Draft ${ask} outreach to ${target}`,
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
  if (c.source === "goal") return LANE_NAME.APPLICATIONS;
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

export function gatherCandidates(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[] = [], learnMilestoneProgress: Map<number, { done: number; total: number }> = new Map()): Candidate[] {
  const out: Candidate[] = [];

  for (const t of tasks) {
    const isTodayTask = t.list === "today";
    const isLaneAlignedSystemMove = t.sourceType === "strategy_builder" || t.sourceType === "marketability_engine" || t.sourceStatus === "strategy_refresh" || (t.sourceType === "career_track" && !!t.relatedTrackId);
    if ((isTodayTask || isLaneAlignedSystemMove) && !t.done) {
      const blocked = t.readiness === "blocked" || !!t.blockerReason;
      out.push({
        source: "task", sourceId: t.id, taskId: t.id,
        title: t.title.replace(/^✨\s*/, ""), category: t.category, size: t.size,
        deadline: t.deadline, status: t.status, skipped: t.skipped,
        sourceUrl: t.sourceUrl || "", sourceNote: t.sourceNote || "", sourceStatus: t.sourceStatus || "",
        doneWhen: t.doneWhen || t.minimumOutcome || "The smallest useful outcome is complete",
        whyNow: isLaneAlignedSystemMove ? "spine says this supports the active track or marketability plan" : "already on today's list",
        fitScore: null, blocked, blockerReason: t.blockerReason || "", eligibilityRisk: "",
        location: "", warmPathScore: null, strategicValue: null, frictionScore: null, applicationReadiness: "", deadlineConfidence: "", narrativeAngle: "",
        relationshipStrength: "", askType: "", messageDraft: "", sourceNetwork: "", targetOrg: "", targetRole: "", followUpDate: "",
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
        relationshipStrength: "", askType: "", messageDraft: "", sourceNetwork: "", targetOrg: "", targetRole: "", followUpDate: "",
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
        doneWhen: l.requiredOutput || "You've made real progress", whyNow: "strengthens an area your target roles keep asking for",
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
        doneWhen: "That step is done", whyNow: "keeps this project or public work moving and can build credibility over time",
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
    if (fitBoost >= 35) trace.push("strong fit score");
  }

  if (c.source === "job") {
    const momentum = jobMomentum(c);
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
    if (c.sourceStatus === "broad_parallel_pursuit_network_support") trace.push("some live role paths still need someone useful to reach out to");
    else if (c.sourceStatus === "broad_parallel_pursuit_learning_support") trace.push("some live role paths still need focused prep support");
    else trace.push("several role paths still need a real role before you narrow");
  }

  s += (8 - (CATEGORY_RANK[c.category] ?? 7)) * 6;

  if (candidateMatchesLane(c, context.bottleneckLane)) {
    s += 78;
    trace.push(`unlocks ${context.bottleneckLane} focus area`);
  }
  if (context.laneUnlockMove && `${c.title} ${c.whyNow} ${c.sourceNote}`.toLowerCase().includes(context.laneUnlockMove.toLowerCase().slice(0, 18))) {
    s += 25;
    trace.push("matches the spine unlock move");
  }
  if (/direction/i.test(context.bottleneck) && isDirectionSignal(c)) { s += 35; trace.push("matches direction bottleneck"); }
  if (/application/i.test(context.bottleneck) && isApplicationLike(c)) { s += 30; trace.push("moves an application forward"); }
  if (/network/i.test(context.bottleneck) && isNetworkLike(c)) { s += 35; trace.push("moves a relationship path forward"); }
  if (/learning|development/i.test(context.bottleneck) && isLearningLike(c)) { s += 25; trace.push("converts learning/development into track leverage"); }
  if (c.source === "learn" && c.milestoneProgress && c.milestoneProgress.total > 0) {
    const ratio = c.milestoneProgress.done / c.milestoneProgress.total;
    if (ratio >= 0.8) { s += 35; trace.push("nearly finished curriculum — close it out"); }
    else if (ratio >= 0.5) { s += 22; trace.push("halfway through curriculum — keep momentum"); }
    else if (ratio > 0) { s += 12; trace.push("curriculum has active progress"); }
  }
  if (context.planningPosture === "capability") {
    if (isLearningLike(c)) {
      s += 22;
      trace.push("capability posture favors learning that turns into reusable notes or practice");
    }
    if (isProofAsset(c) && c.sourceStatus === "testing") {
      s += 10;
      trace.push("a live project or public-work item can package capability into something you can point to later");
    } else if (isProofAsset(c)) {
      s -= 10;
      trace.push("idea-stage projects or public work stay secondary to learning output");
    }
  } else if (isProofAsset(c)) {
    if (context.planningPosture === "conversion") {
      s -= 14;
      trace.push("projects or public work stay secondary while live conversion moves exist");
    } else if (context.planningPosture === "exploration") {
      s -= 18;
      trace.push("projects or public work stay deferred while role uncertainty is still high");
    }
  }
  if (context.recommendedExploration && `${c.title} ${c.sourceNote}`.toLowerCase().includes(context.recommendedExploration.toLowerCase().slice(0, 20))) {
    s += 30;
    trace.push("matches active track from spine");
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
    trace.push("the strongest roles still need clarification before more effort is worth it");
  } else if (context.clarifyBeforePush && actionCategory === "pursue") {
    trace.push("application work stays secondary until the missing role facts are confirmed");
  } else if (context.planningPosture === "capability" && actionCategory === "develop") {
    trace.push("the main bottleneck is a repeated weak area, so strengthening work is promoted");
  } else if (context.planningPosture === "capability" && actionCategory === "pursue") {
    trace.push("live pursuit stays secondary until the shared weak area is less exposed");
  } else if ((context.planningPosture === "conversion" || context.planningPosture === "interview") && actionCategory === "develop") {
    trace.push("development stays secondary while the main bottleneck is conversion or interview work");
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
    return `You are testing several paths in parallel. ${top || context.laneUnlockMove || "Best available next move"}.`;
  }
  return `This helps with ${focusAreaLabel(lane)}. ${top || context.laneUnlockMove || "Best available next move"}.`;
}

function firstStepForSource(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "goal") {
    if (candidate?.sourceStatus === "broad_parallel_pursuit" && candidate?.targetRole) {
      return `Open your job sources and add one real role for ${candidate.targetRole}.`;
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_network_support") {
      if (candidate?.targetRole) return `Open Network and add one person you could realistically reach out to for ${candidate.targetRole}.`;
      return broadPursuitMissingContactsFirstStep(context?.broadPursuitMissingNetworkSupport || []);
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_learning_support") {
      if (candidate?.targetRole) return `Use Jobs or Learn to set up one prep starter, note, or resource for ${candidate.targetRole}.`;
      return broadPursuitMissingPrepFirstStep(context?.broadPursuitMissingLearningSupport || []);
    }
    if (context?.broadPursuitMissingCombinations?.length) {
      return broadPursuitMissingRolesFirstStep(context.broadPursuitMissingCombinations);
    }
    return "Open your job sources and add or apply to one real role in each active path before doing narrower comparison work.";
  }
  if (source === "job") {
    if (candidate?.jobTruthAction === "warm") return "Open the role and draft the shortest message to someone who could help or refer you.";
    if (candidate?.jobTruthAction === "prove") return "Open your strongest learning item or reusable example and make one weak requirement easier to back up.";
    if (candidate?.jobTruthAction === "clarify") return "Open the role and confirm the missing facts before spending more effort.";
    if (candidate?.jobTruthAction === "follow_up") return "Open the role and send the polite follow-up or warm nudge.";
    if (candidate?.jobTruthAction === "prepare") return "Open the role and draft the strongest interview stories or prep notes.";
    return "Open the role, your CV, and the application materials for this step.";
  }
  if (source === "contact") {
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "Open the thread and write the shortest message that advances the live role right now.";
    if (intent === "interview") return "Open the thread and ask the one question that sharpens the interview or active process.";
    if (intent === "capability") return "Open the thread and ask for one concrete steer on the skill gap or missing area.";
    return "Open the thread and write a short message asking for one concrete reality-check on the role or market.";
  }
  if (source === "learn") return "Open the learning item or a blank note and capture one useful note, brief, or practice result.";
  if (source === "hustle") return "Open the project or public-work item and make the smallest publishable or reusable fragment.";
  return "Open the task and do the first small visible step, not the whole project.";
}

function stopRuleForSource(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "goal") {
    if (candidate?.sourceStatus === "broad_parallel_pursuit" && candidate?.targetRole) {
      return `Stop after ${candidate.targetRole} has one concrete role or application move.`;
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_network_support") {
      if (candidate?.targetRole) return `Stop after ${candidate.targetRole} has one useful contact or outreach path.`;
      return broadPursuitMissingContactsStopRule();
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_learning_support") {
      if (candidate?.targetRole) return `Stop after ${candidate.targetRole} has one prep starter.`;
      return broadPursuitMissingPrepStopRule();
    }
    if (context?.broadPursuitMissingCombinations?.length) {
      return broadPursuitMissingRolesStopRule();
    }
    return "Stop after one concrete role or application move exists in each active path.";
  }
  if (source === "job") {
    if (candidate?.jobTruthAction === "warm") return "Stop after one message to someone useful is drafted, sent, or scheduled.";
    if (candidate?.jobTruthAction === "prove") return "Stop after one weak requirement is easier to back up than it was before.";
    if (candidate?.jobTruthAction === "clarify") return "Stop after the key missing facts are confirmed.";
    if (candidate?.jobTruthAction === "follow_up") return "Stop after one follow-up or warm nudge is sent.";
    if (candidate?.jobTruthAction === "prepare") return "Stop after one interview-prep artifact is stronger than it was before.";
    return "Stop after one concrete application or materials step is complete.";
  }
  if (source === "contact") {
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "Stop after the live-role message is drafted, sent, or clearly scheduled.";
    if (intent === "interview") return "Stop after the interview question or prep ask is sent or clearly scheduled.";
    if (intent === "capability") return "Stop after the message asks for one concrete steer on the skill gap or missing area.";
    return "Stop after the message asks for one concrete reality-check on the role or market and is drafted, sent, or scheduled.";
  }
  if (source === "learn") return "Stop after one useful note, brief, practice result, or reusable example exists.";
  if (source === "hustle") return "Stop after one reusable or publishable piece exists, or the next concrete step is finished.";
  return "Stop after one concrete move changes the state of the work.";
}

function sourceFrame(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "goal") {
    if (candidate?.sourceStatus === "broad_parallel_pursuit" && candidate?.targetRole) {
      return `${candidate.targetRole} still needs a real role or application move, so that is the best next move now.`;
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_network_support") {
      if (candidate?.targetRole) return `${candidate.targetRole} still needs someone useful to reach out to, so the best move is to add one contact path for it now.`;
      return broadPursuitMissingContactsSourceFrame(context?.broadPursuitMissingNetworkSupport || []);
    }
    if (candidate?.sourceStatus === "broad_parallel_pursuit_learning_support") {
      if (candidate?.targetRole) return `${candidate.targetRole} still needs more focused prep support, so the best move is to set up one prep starter for it now.`;
      return broadPursuitMissingPrepSourceFrame(context?.broadPursuitMissingLearningSupport || []);
    }
    if (context?.broadPursuitMissingCombinations?.length) {
      return broadPursuitMissingRolesSourceFrame(context.broadPursuitMissingCombinations);
    }
    return "You are testing several paths in parallel, so the best move is to turn each one into a real role or application move.";
  }
  if (source === "job") {
    if (candidate?.jobTruthAction === "warm") return "This role looks promising, but the best next step is to reach out to someone useful before going in cold.";
    if (candidate?.jobTruthAction === "prove") return "This role looks promising, but you still need one clearer example you can point to before pushing harder.";
    if (candidate?.jobTruthAction === "clarify") return "This role needs one clarification pass before it deserves more effort.";
    if (candidate?.jobTruthAction === "follow_up") return "This role is already moving, so follow-through matters most right now.";
    if (candidate?.jobTruthAction === "prepare") return "This role is live, so preparation matters most right now.";
    return "This role is one of the strongest next moves right now.";
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
  return "This is the best already-live move in the system right now.";
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
    ? `It beats the next option because it helps more with ${focusArea} right now.`
    : `It is the clearest available move in ${focusArea} right now.`;

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
  return {
    summary: `${sourceFrame(current.c.source, current.c, context)} Main focus: ${focusArea}${context.activeTrackName ? ` in ${context.activeTrackName}` : ""}.`,
    whyNow: supportingReasons[0] || current.c.whyNow || context.reason,
    whyThis: next
      ? `It outranks the next option because it helps more with ${focusArea} right now.`
      : `It remains in the plan because it is still a useful move in ${focusArea}.`,
    supportingReasons,
    firstStep: firstStepForSource(current.c.source, current.c, context),
    stopRule: stopRuleForSource(current.c.source, current.c, context),
  };
}

export function explainPersistedPlanItem(item: {
  sourceType?: string | null;
  whySelected?: string | null;
  doneWhen?: string | null;
}): RecommendationExplanation {
  const source = (item.sourceType || "task") as SourceKind;
  const why = (item.whySelected || "").trim();
  return {
    summary: why || sourceFrame(source),
    whyNow: why || "This move is still in today's plan.",
    whyThis: "It was already chosen as one of today's most useful moves.",
    supportingReasons: why ? [why] : [],
    firstStep: firstStepForSource(source),
    stopRule: item.doneWhen?.trim() ? `Stop when: ${item.doneWhen.trim()}` : stopRuleForSource(source),
  };
}

export function planDay(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[],
  energy: Energy, capacity: CapacityInput = 0,
  contacts: Contact[] = [], tracks: CareerTrack[] = [],
  learnMilestoneProgress: Map<number, { done: number; total: number }> = new Map(),
): { mode: DayMode; plan: PlanItem[]; note: string; mvdIndex: number; trace: PlanTrace } {
  const context = buildStrategicContext(tasks, jobs, learn, hustles, contacts, tracks);
  const priorityCandidates: Candidate[] = [];
  if (needsBroadPursuitGoalCandidate(context)) {
    priorityCandidates.push(buildBroadPursuitGoalCandidate(context));
  } else if (needsBroadPursuitSupportGoalCandidate(context)) {
    priorityCandidates.push(...buildBroadPursuitSupportGoalCandidates(context));
  }
  const all = [...priorityCandidates, ...gatherCandidates(tasks, jobs, learn, hustles, contacts, learnMilestoneProgress)];
  const ignored = all
    .map((c) => ({ c, reason: gateReason(c, context) }))
    .filter((x) => x.reason)
    .slice(0, 5)
    .map((x) => `${x.c.title}: ${x.reason}`);
  const cands = all.filter((c) => passesGates(c, context));
  const mode = pickDayMode(cands, energy, context);
  const budget = capacityMinutes(capacity);

  if (cands.length === 0) {
    return {
      mode,
      plan: [],
      note: "Nothing actionable right now — add a role, task, or track and I'll shape a day.",
      mvdIndex: -1,
      trace: { picked: [], ignored, bottleneck: context.bottleneck, reason: context.reason, remainingMinutes: budget, laneTrace: context.laneModel.trace },
    };
  }

  const ranked = cands.map((c) => scoreWithTrace(c, energy, mode, context)).sort((a, b) => b.s - a.s);
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

  const mvd = picks[0];
  const slots: SlotName[] = ["now", "next", "later", "bonus"];
  const plan: PlanItem[] = picks.map((r, i) => ({
    slot: slots[Math.min(i, slots.length - 1)],
    candidate: r.c,
    why: whyLine(r, context),
    isMVD: r === mvd,
    explanation: explainRankedPlanItem(picks, i, context),
  }));

  const planMin = picks.reduce((m, r) => m + (SIZE_MINUTES[r.c.size] ?? 45), 0);
  const fits = planMin <= Math.max(15, budget);
  const note =
    mode === "deadline" ? "A deadline's close — the urgent application/material step leads. Do that one and today counts."
    : budget < 45 ? "Very little day left. One tiny useful application or track move is enough."
    : budget < 90 ? "One useful application or track move is enough for the time left today."
    : mode === "low" ? "Lighter day. The first one is all that matters — done is plenty."
    : mode === "strategy" && needsBroadPursuitGoalCandidate(context) ? broadPursuitNextMissingRolePlanNote(context.broadPursuitMissingCombinations)
    : mode === "strategy" && context.broadPursuitMissingNetworkSupport.length > 0 && context.broadPursuitMissingCombinations.length === 0 ? broadPursuitNextMissingContactPlanNote(context.broadPursuitMissingNetworkSupport)
    : mode === "strategy" && context.broadPursuitMissingLearningSupport.length > 0 && context.broadPursuitMissingCombinations.length === 0 ? broadPursuitNextMissingPrepPlanNote(context.broadPursuitMissingLearningSupport)
    : mode === "strategy" ? `The main constraint right now is ${focusAreaLabel(context.bottleneckLane)}. Anchor picked the next move to unblock it.`
    : fits ? "Start at the top. Finish the first one and today already counts."
    : "Full plate for the time you've got. Just do the first one and call it a win.";

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
) {
  const context = buildStrategicContext(tasks, jobs, learn, hustles, contacts, tracks);
  const priorityCandidates: Candidate[] = [];
  if (needsBroadPursuitGoalCandidate(context)) {
    priorityCandidates.push(buildBroadPursuitGoalCandidate(context));
  } else if (needsBroadPursuitSupportGoalCandidate(context)) {
    priorityCandidates.push(...buildBroadPursuitSupportGoalCandidates(context));
  }
  const cands = [...priorityCandidates, ...gatherCandidates(tasks, jobs, learn, hustles, contacts)].filter((c) => passesGates(c, context));
  const mode = pickDayMode(cands, energy, context);
  if (cands.length === 0) return { mode, pick: null, alternative: null };
  const ranked = cands.map((c) => scoreWithTrace(c, energy, mode, context)).sort((a, b) => b.s - a.s);
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
