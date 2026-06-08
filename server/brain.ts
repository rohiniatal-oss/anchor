import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { isOpportunityActionable } from "@shared/domainState";
import { buildTrackSpine } from "./trackSpine";
import { deriveCareerGoalFrame } from "./goalState";
import type { CanonicalLaneName } from "./lanes";

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

export type Candidate = {
  source: "task" | "job" | "learn" | "hustle" | "contact";
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
  goalPhase: ReturnType<typeof deriveCareerGoalFrame>["phase"];
  goalDayType: ReturnType<typeof deriveCareerGoalFrame>["dayType"];
  decisionMode: ReturnType<typeof deriveCareerGoalFrame>["decisionMode"];
  planningPosture: "exploration" | "conversion" | "interview" | "capability";
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
  if (lane === "Direction") return isDirectionSignal(c);
  if (lane === "Applications") return isApplicationLike(c);
  if (lane === "Network") return isNetworkLike(c);
  if (lane === "Proof assets") return isProofAsset(c);
  if (lane === "Learning and development") return isLearningLike(c);
  if (lane === "Stability") return c.blocked || c.category === "admin" || c.category === "health";
  return false;
}

function planningPostureFromGoalFrame(
  goalFrame: ReturnType<typeof deriveCareerGoalFrame>,
  bottleneckLane: CanonicalLaneName,
  hasActiveLearning: boolean,
): StrategicContext["planningPosture"] {
  if (goalFrame.phase === "interview-prep") return "interview";
  if (goalFrame.phase === "fit-discovery" || goalFrame.phase === "lane-narrowing") return "exploration";
  if (goalFrame.recommendedFocus === "Capability ramp" || goalFrame.recommendedFocus === "Proof") return "capability";
  if (goalFrame.recommendedFocus === "Applications" || goalFrame.recommendedFocus === "Network" || goalFrame.recommendedFocus === "Positioning") {
    return "conversion";
  }
  if (goalFrame.decisionMode === "broad-parallel-pursuit") return "conversion";
  if (bottleneckLane === "Learning and development" || bottleneckLane === "Proof assets" || hasActiveLearning) return "capability";
  if (goalFrame.dayType === "interview-prep") return "interview";
  if (goalFrame.dayType === "capability-building") return "capability";
  if (goalFrame.dayType === "conversion") return "conversion";
  return "exploration";
}

function desiredLaneOrder(posture: StrategicContext["planningPosture"]): CanonicalLaneName[] {
  if (posture === "interview") return ["Applications", "Network", "Learning and development", "Proof assets", "Direction", "Stability"];
  if (posture === "conversion") return ["Applications", "Network", "Learning and development", "Proof assets", "Direction", "Stability"];
  if (posture === "capability") return ["Learning and development", "Proof assets", "Network", "Applications", "Direction", "Stability"];
  return ["Direction", "Network", "Learning and development", "Applications", "Proof assets", "Stability"];
}

function laneBalanceWindow(posture: StrategicContext["planningPosture"]) {
  if (posture === "interview") return 18;
  if (posture === "conversion") return 24;
  if (posture === "capability") return 30;
  return 34;
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
  const goalFrame = deriveCareerGoalFrame(tasks, jobs, [], learn, contacts, hustles);
  const planningPosture = planningPostureFromGoalFrame(
    goalFrame,
    spine.bestMove.lane,
    learn.some((l) => !l.done && l.learnStatus !== "closed"),
  );
  return {
    bottleneck: spine.bestMove.lane,
    reason: `${spine.bestMove.reason}${spine.bestMove.trackName ? ` Active track: ${spine.bestMove.trackName}.` : ""} Goal frame: ${goalFrame.phase}${goalFrame.decisionMode === "single-track" ? "" : ` (${goalFrame.decisionMode})`}.`,
    applicationsPremature: false,
    recommendedExploration: spine.bestMove.trackName || spine.activeTrack?.name || "",
    laneModel: { trace: spine.trace },
    bottleneckLane: spine.bestMove.lane,
    laneStage: lane?.stage || "active",
    laneUnlockMove: spine.bestMove.title,
    activeTrackName: spine.bestMove.trackName || spine.activeTrack?.name || "",
    liveJobTargets: jobs.filter((j) => isOpportunityActionable(j)).map((j) => ({ title: j.title, company: j.company, roleArchetype: j.roleArchetype || "" })),
    goalPhase: goalFrame.phase,
    goalDayType: goalFrame.dayType,
    decisionMode: goalFrame.decisionMode,
    planningPosture,
  };
}

function jobNextStep(j: Job): { action: string; size: string; doneWhen: string; why: string } {
  const role = `${j.title}${j.company ? " — " + j.company : ""}`;
  if (j.nextStep && j.nextStep.trim()) {
    return { action: `${j.nextStep.trim()} — ${role}`, size: guessSize(j.nextStep), doneWhen: "That step is done", why: "your own next step on this role" };
  }
  const readiness = j.applicationReadiness || "none";
  if (j.eligibilityRisk && j.eligibilityRisk !== "") {
    return { action: `Check the constraint and adapt the application angle — ${role}`, size: "quick", doneWhen: "You know how to handle or explain the constraint", why: `application constraint: ${j.eligibilityRisk}` };
  }
  switch (j.status) {
    case "wishlist":
      if (readiness === "none") return { action: `Extract requirements and application materials — ${role}`, size: "quick", doneWhen: "You have listed requirements, materials, deadline, and strongest angle", why: "turns the role into an application plan" };
      return { action: `Tailor your CV to this role — ${role}`, size: "deep", doneWhen: "CV reflects this role's language", why: "fit is clear; time to make it land" };
    case "applied":
      return { action: `Follow up on your application — ${role}`, size: "quick", doneWhen: "A polite nudge is sent", why: "applied roles go cold without a nudge" };
    case "interviewing":
      return { action: `Build your story bank — ${role}`, size: "deep", doneWhen: "3 STAR stories ready", why: "you're in the room — prep wins it" };
    default:
      return { action: `Build the application plan — ${role}`, size: "quick", doneWhen: "The strongest angle, gaps, and next material are clear", why: "role is in your pipeline; make the application sharper" };
  }
}

function readinessMomentum(readiness: string) {
  switch (readiness || "none") {
    case "cv": return { score: 10, reason: "materials are partly underway" };
    case "cover": return { score: 14, reason: "application materials are partly underway" };
    case "questions": return { score: 18, reason: "application is close to submittable" };
    case "sample": return { score: 18, reason: "sample requirement is identified" };
    case "referral": return { score: 20, reason: "warm-path/referral path is live" };
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
    if (warmBoost >= 10) trace.push("warm path improves landing odds");
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
  return daysUntil(c.followUpDate || "");
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
    return { key: "market-guide", score: 10, reason: "can provide a useful market or process signal" };
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
  if (c.source === "job") return "Applications";
  if (c.source === "contact") return "Network";
  if (c.source === "learn") return "Learning and development";
  if (c.source === "hustle") return "Proof assets";
  if (candidateMatchesLane(c, context.bottleneckLane)) return context.bottleneckLane;
  const order: CanonicalLaneName[] = ["Applications", "Network", "Learning and development", "Proof assets", "Direction", "Stability"];
  return order.find((lane) => candidateMatchesLane(c, lane)) || "Stability";
}

function contactIntent(c: Candidate, context: StrategicContext): NetworkingIntent {
  const liveFit = liveRoleContactFit(c, context);
  const hasTargetSignal = !!(c.targetOrg && c.targetOrg.trim()) || !!(c.targetRole && c.targetRole.trim()) || liveFit.score >= 18;
  const activeThread = c.sourceStatus === "messaged" || c.sourceStatus === "replied";
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
    if (ask === "advice") return { score: 16, reason: "advice can target the current capability gap" };
    if (ask === "follow_up") return { score: 10, reason: "follow-up can turn prior context into capability feedback" };
    if (ask === "reconnect") return { score: 8, reason: "reconnect can reopen useful capability signal" };
    if (ask === "referral") return { score: 2, reason: "referral is weaker than feedback while capability is the bottleneck" };
    return { score: 6, reason: "soft outreach can surface capability signal with low friction" };
  }
  if (ask === "advice") return { score: 18, reason: "advice is the right ask while narrowing lanes" };
  if (ask === "reconnect") return { score: 12, reason: "reconnect can reopen exploratory market signal" };
  if (ask === "soft") return { score: 8, reason: "low-friction outreach is enough while exploring options" };
  if (ask === "follow_up") return { score: 6, reason: "follow-up helps, but this phase needs fresh market signal" };
  if (ask === "referral") return { score: 1, reason: "referral is premature before the target lane is clearer" };
  return { score: 6, reason: "this ask still creates some useful exploratory signal" };
}

export type DayMode = "normal" | "low" | "deadline" | "strategy";

export function gatherCandidates(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[] = []): Candidate[] {
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
      const { action, size, doneWhen, why } = jobNextStep(j);
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
    if ((l.active || l.proofIntent || !!l.relatedTrackId) && !l.done && l.learnStatus !== "closed" && !isDuplicate(l.title)) {
      const dl = l.applicationDeadline || "";
      out.push({
        source: "learn", sourceId: l.id, taskId: null,
        title: l.requiredOutput ? `${l.title} — produce: ${l.requiredOutput}` : l.title,
        category: "learning", size: guessSize(l.title),
        deadline: dl, status: "not_started", skipped: 0,
        sourceUrl: l.url || "", sourceNote: l.note || "", sourceStatus: l.learnStatus || "active",
        doneWhen: l.requiredOutput || "You've made real progress", whyNow: "builds a capability your tracks need",
        fitScore: null, blocked: false, blockerReason: "", eligibilityRisk: "",
        location: "", warmPathScore: null, strategicValue: null, frictionScore: null, applicationReadiness: "", deadlineConfidence: "", narrativeAngle: "",
        relationshipStrength: "", askType: "", messageDraft: "", sourceNetwork: "", targetOrg: "", targetRole: "", followUpDate: "",
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
        doneWhen: "That step is done", whyNow: "proof of your judgement — builds credibility over time",
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

  s += (8 - (CATEGORY_RANK[c.category] ?? 7)) * 6;

  if (candidateMatchesLane(c, context.bottleneckLane)) {
    s += 78;
    trace.push(`unlocks ${context.bottleneckLane} lane`);
  }
  if (context.laneUnlockMove && `${c.title} ${c.whyNow} ${c.sourceNote}`.toLowerCase().includes(context.laneUnlockMove.toLowerCase().slice(0, 18))) {
    s += 25;
    trace.push("matches the spine unlock move");
  }
  if (/direction/i.test(context.bottleneck) && isDirectionSignal(c)) { s += 35; trace.push("matches direction bottleneck"); }
  if (/application/i.test(context.bottleneck) && isApplicationLike(c)) { s += 30; trace.push("moves an application forward"); }
  if (/network/i.test(context.bottleneck) && isNetworkLike(c)) { s += 35; trace.push("moves a relationship lane forward"); }
  if (/learning|development/i.test(context.bottleneck) && isLearningLike(c)) { s += 25; trace.push("converts learning/development into track leverage"); }
  if (context.planningPosture === "capability") {
    if (isLearningLike(c)) {
      s += 22;
      trace.push("capability posture favors reusable learning output");
    }
    if (isProofAsset(c) && c.sourceStatus === "testing") {
      s += 10;
      trace.push("live proof asset can package capability into reusable evidence");
    } else if (isProofAsset(c)) {
      s -= 10;
      trace.push("idea-stage proof stays secondary to learning output");
    }
  } else if (isProofAsset(c)) {
    if (context.planningPosture === "conversion") {
      s -= 14;
      trace.push("proof stays secondary while live conversion moves exist");
    } else if (context.planningPosture === "exploration") {
      s -= 18;
      trace.push("proof is deferred while lane uncertainty is still high");
    }
  }
  if (context.recommendedExploration && `${c.title} ${c.sourceNote}`.toLowerCase().includes(context.recommendedExploration.toLowerCase().slice(0, 20))) {
    s += 30;
    trace.push("matches active track from spine");
  }

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
  return scoreWithTrace(c, energy, mode, {
    bottleneck: "Progress", reason: "", applicationsPremature: false, recommendedExploration: "",
    laneModel: { trace: [] }, bottleneckLane: "Stability", laneStage: "steady", laneUnlockMove: "", activeTrackName: "",
  }).s;
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

function whyLine(r: RankedCandidate, context: StrategicContext) {
  const lane = context.bottleneckLane;
  const top = r.trace.filter(Boolean).slice(0, 2).join("; ");
  return `${lane} lane. ${top || context.laneUnlockMove || "Best available next move"}.`;
}

function firstStepForSource(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "job") return "Open the role, your CV, and the application materials for this step.";
  if (source === "contact") {
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "Open the thread and write the shortest message that advances the live role right now.";
    if (intent === "interview") return "Open the thread and ask the one question that sharpens the interview or active process.";
    if (intent === "capability") return "Open the thread and ask for one concrete steer on the skill or proof gap.";
    return "Open the thread and write a short message asking for one concrete market reality-check.";
  }
  if (source === "learn") return "Open the resource or a blank note and produce the smallest useful output.";
  if (source === "hustle") return "Open the proof asset and make the smallest publishable or reusable fragment.";
  return "Open the task and do the first visible action, not the whole project.";
}

function stopRuleForSource(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "job") return "Stop after one concrete application or materials step is complete.";
  if (source === "contact") {
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "Stop after the live-role message is drafted, sent, or clearly scheduled.";
    if (intent === "interview") return "Stop after the interview question or prep ask is sent or clearly scheduled.";
    if (intent === "capability") return "Stop after the message asks for one concrete steer on the capability gap.";
    return "Stop after the message asks for one concrete market signal and is drafted, sent, or scheduled.";
  }
  if (source === "learn") return "Stop after one reusable learning output exists.";
  if (source === "hustle") return "Stop after one proof fragment or next asset step exists.";
  return "Stop after one concrete move changes the state of the work.";
}

function sourceFrame(source: SourceKind, candidate?: Candidate, context?: StrategicContext) {
  if (source === "job") return "This role is the strongest conversion move right now.";
  if (source === "contact") {
    const intent = candidate && context ? contactIntent(candidate, context) : "exploration";
    if (intent === "conversion") return "This person is the highest-leverage contact for converting a live role right now.";
    if (intent === "interview") return "This person is the best networking move for sharpening an active interview or process right now.";
    if (intent === "capability") return "This person can turn capability-building into better market signal right now.";
    return "This person is the strongest contact for reducing role uncertainty right now.";
  }
  if (source === "learn") return "This upskilling move compounds your profile without blocking applications.";
  if (source === "hustle") return "This proof move packages learning into reusable credibility over time.";
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
  const supportingReasons = top.trace.filter(Boolean).slice(0, 4);
  const whyNow = supportingReasons[0] || context.reason || "This is the strongest available move right now.";
  const whyThis = second
    ? `It beats the next option because it has stronger immediate leverage on ${lane.toLowerCase()} right now.`
    : `It is the clearest available move on the ${lane.toLowerCase()} lane right now.`;

  return {
    summary: `${sourceFrame(pick.source, pick, context)} ${lane} is the active lane for this move${context.activeTrackName ? ` in ${context.activeTrackName}` : ""}.`,
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
  const supportingReasons = current.trace.filter(Boolean).slice(0, 4);
  return {
    summary: `${sourceFrame(current.c.source, current.c, context)} ${lane} is why this slot exists${context.activeTrackName ? ` in ${context.activeTrackName}` : ""}.`,
    whyNow: supportingReasons[0] || current.c.whyNow || context.reason,
    whyThis: next
      ? `It outranks the next option because it has stronger immediate leverage on ${lane.toLowerCase()} right now.`
      : `It remains in the plan because it is still a useful move on the ${lane.toLowerCase()} lane.`,
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
    whyNow: why || "This move remains in today's plan because it supports the current sequencing.",
    whyThis: "It has already been selected into the persisted plan as one of today's highest-leverage moves.",
    supportingReasons: why ? [why] : [],
    firstStep: firstStepForSource(source),
    stopRule: item.doneWhen?.trim() ? `Stop when: ${item.doneWhen.trim()}` : stopRuleForSource(source),
  };
}

export function planDay(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[],
  energy: Energy, capacity: CapacityInput = 0,
  contacts: Contact[] = [], tracks: CareerTrack[] = [],
): { mode: DayMode; plan: PlanItem[]; note: string; mvdIndex: number; trace: PlanTrace } {
  const context = buildStrategicContext(tasks, jobs, learn, hustles, contacts, tracks);
  const all = gatherCandidates(tasks, jobs, learn, hustles, contacts);
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
    : mode === "strategy" ? `${context.bottleneckLane} is the bottleneck. Anchor is choosing the next move from the Tracks × Lanes spine.`
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
  const cands = gatherCandidates(tasks, jobs, learn, hustles, contacts).filter((c) => passesGates(c, context));
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
