import type { Task, Job, Learn, Hustle } from "@shared/schema";
import { isOpportunityActionable } from "@shared/domainState";
import { buildCareerGoalState } from "./goalState";
import { buildExplorationQueue } from "./explorationQueue";
import { buildLaneOperatingModel, type LaneOperatingModel, type LaneName } from "./laneState";

// ─────────────────────────────────────────────────────────────────────────
// ANCHOR BRAIN — adaptive sequencer (NOT a balanced-day picker).
// Canonical decision flow:
// 1) diagnose lane state and current bottleneck, 2) gather eligible actions,
// 3) exclude only truly unavailable items, 4) score by track/application leverage,
// 5) sequence against the remaining day, 6) explain the conclusion lightly.
// User-selected roles are treated as intentional inputs: Anchor helps make the
// application stronger and the profile more marketable; it is not a gatekeeper.
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
  source: "task" | "job" | "learn" | "hustle";
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
};

type StrategicContext = {
  bottleneck: string;
  reason: string;
  applicationsPremature: boolean;
  recommendedExploration: string;
  laneModel: LaneOperatingModel;
  bottleneckLane: LaneName;
  laneStage: string;
  laneUnlockMove: string;
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

function daysUntil(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T23:59:59");
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function guessSize(title: string, fallback = "medium"): string {
  const t = (title || "").toLowerCase();
  if (/\b(open|check|confirm|email|message|send|note|skim|read one|sign up|list|book|call)\b/.test(t)) return "quick";
  if (/\b(write|draft|apply|prepare|build|outline|tailor|research|finish)\b/.test(t)) return "deep";
  return fallback;
}

function isDirectionSignal(c: Candidate) {
  // Application/submission work is never direction-signal work, even when its text
  // mentions "role" (e.g. "Apply to several saved roles"). Excluding it keeps the
  // direction-before-premature-apply rule intact: premature applies must not win
  // the Direction lane just by matching the keyword.
  if (isApplicationLike(c)) return false;
  return /direction|role|career|inspect|signal|attribute|explore|job family|research|fit|path|market map|pattern/i.test(`${c.title} ${c.whyNow} ${c.sourceNote}`);
}

function isApplicationLike(c: Candidate) {
  return c.category === "job" || /apply|application|interview|cover|submit|cv|resume|follow up|follow-up|tailor|posting|requirements/i.test(`${c.title} ${c.whyNow}`);
}

function isProofAsset(c: Candidate) {
  return CATEGORY_FAMILY[c.category] === "output" || /proof|substack|memo|forecast|portfolio|publish|story bank|cv bullet|case study/i.test(`${c.title} ${c.sourceNote}`);
}

function isNetworkLike(c: Candidate) {
  return /network|contact|message|coffee|intro|referral|follow up|follow-up|whatsapp|email/i.test(`${c.title} ${c.whyNow} ${c.sourceNote}`);
}

function isLearningLike(c: Candidate) {
  return c.category === "learning" || c.source === "learn" || /learn|read|course|resource|podcast|book|study|output/i.test(`${c.title} ${c.whyNow} ${c.sourceNote}`);
}

function candidateMatchesLane(c: Candidate, lane: LaneName) {
  if (lane === "Direction") return isDirectionSignal(c);
  if (lane === "Applications") return isApplicationLike(c);
  if (lane === "Network") return isNetworkLike(c);
  if (lane === "Proof assets") return isProofAsset(c);
  if (lane === "Learning") return isLearningLike(c);
  if (lane === "Stability") return c.blocked || c.category === "admin" || c.category === "health";
  return false;
}

function buildStrategicContext(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[]): StrategicContext {
  const fallbackLaneModel = buildLaneOperatingModel(tasks, jobs, learn, hustles, []);
  try {
    const log: any[] = [];
    buildCareerGoalState(tasks, jobs, log);
    const exploration = buildExplorationQueue(tasks, jobs, log);
    const lane = fallbackLaneModel.bottleneckLane;
    return {
      bottleneck: lane.name,
      reason: `${fallbackLaneModel.summary} Unlock move: ${lane.unlockMove}`,
      // Kept for API compatibility, but no longer used to block user-selected role work.
      applicationsPremature: false,
      recommendedExploration: exploration.recommended?.direction || "",
      laneModel: fallbackLaneModel,
      bottleneckLane: lane.name,
      laneStage: lane.stage,
      laneUnlockMove: lane.unlockMove,
    };
  } catch {
    const lane = fallbackLaneModel.bottleneckLane;
    return {
      bottleneck: lane.name,
      reason: fallbackLaneModel.summary,
      applicationsPremature: false,
      recommendedExploration: "",
      laneModel: fallbackLaneModel,
      bottleneckLane: lane.name,
      laneStage: lane.stage,
      laneUnlockMove: lane.unlockMove,
    };
  }
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

export type DayMode = "normal" | "low" | "deadline" | "strategy";

export function gatherCandidates(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[]): Candidate[] {
  const out: Candidate[] = [];

  for (const t of tasks) {
    const isTodayTask = t.list === "today";
    const isLaneAlignedSystemMove = t.sourceType === "strategy_builder" || t.sourceStatus === "strategy_refresh" || (t.sourceType === "career_track" && !!t.relatedTrackId);
    if ((isTodayTask || isLaneAlignedSystemMove) && !t.done) {
      const blocked = t.readiness === "blocked" || !!t.blockerReason;
      out.push({
        source: "task", sourceId: t.id, taskId: t.id,
        title: t.title.replace(/^✨\s*/, ""), category: t.category, size: t.size,
        deadline: t.deadline, status: t.status, skipped: t.skipped,
        sourceUrl: t.sourceUrl || "", sourceNote: t.sourceNote || "", sourceStatus: t.sourceStatus || "",
        doneWhen: t.doneWhen || t.minimumOutcome || "The smallest useful outcome is complete",
        whyNow: isLaneAlignedSystemMove ? "strategy refresh says this unlocks the active plan" : "already on today's list",
        fitScore: null, blocked, blockerReason: t.blockerReason || "", eligibilityRisk: "",
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
      });
    }
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
      });
    }
  }
  return out;
}

function gateReason(c: Candidate, _context: StrategicContext): string | null {
  if (c.status === "done") return "already done";
  if (c.blocked) return c.blockerReason ? `blocked: ${c.blockerReason}` : "blocked";
  if (c.eligibilityRisk === "likely_ineligible") return "constraint needs handling before submission";
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

  s += (8 - (CATEGORY_RANK[c.category] ?? 7)) * 6;

  if (candidateMatchesLane(c, context.bottleneckLane)) {
    s += 78;
    trace.push(`unlocks ${context.bottleneckLane} lane`);
  }
  if (context.laneUnlockMove && `${c.title} ${c.whyNow} ${c.sourceNote}`.toLowerCase().includes(context.laneUnlockMove.toLowerCase().slice(0, 18))) {
    s += 25;
    trace.push("matches the lane unlock move");
  }
  if (/direction/i.test(context.bottleneck) && isDirectionSignal(c)) { s += 35; trace.push("matches direction bottleneck"); }
  if (/application/i.test(context.bottleneck) && isApplicationLike(c)) { s += 30; trace.push("moves an application forward"); }
  if (/proof|credibility|evidence/i.test(context.bottleneck) && isProofAsset(c)) { s += 25; trace.push("builds proof/credibility over time"); }
  if (/network/i.test(context.bottleneck) && isNetworkLike(c)) { s += 35; trace.push("moves a relationship lane forward"); }
  if (/learning/i.test(context.bottleneck) && isLearningLike(c)) { s += 25; trace.push("converts learning into track leverage"); }
  if (context.recommendedExploration && `${c.title} ${c.sourceNote}`.toLowerCase().includes(context.recommendedExploration.toLowerCase().slice(0, 20))) {
    s += 30;
    trace.push("matches recommended exploration queue");
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
    laneModel: buildLaneOperatingModel([], [], [], [], []), bottleneckLane: "Stability", laneStage: "steady", laneUnlockMove: "",
  }).s;
}

export type SlotName = "now" | "next" | "later" | "bonus";
export type PlanItem = { slot: SlotName; candidate: Candidate; why: string; isMVD: boolean };

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

export function planDay(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[],
  energy: Energy, capacity: CapacityInput = 0,
): { mode: DayMode; plan: PlanItem[]; note: string; mvdIndex: number; trace: PlanTrace } {
  const context = buildStrategicContext(tasks, jobs, learn, hustles);
  const all = gatherCandidates(tasks, jobs, learn, hustles);
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
  for (const r of ranked) {
    if (picks.length >= maxItems) break;
    const fam = CATEGORY_FAMILY[r.c.category] ?? "care";
    if (usedFamily.has(fam)) {
      const betterDiff = ranked.find(other => !usedFamily.has(CATEGORY_FAMILY[other.c.category] ?? "care")
        && !picks.includes(other) && (r.s - other.s) <= 25);
      if (betterDiff) continue;
    }
    picks.push(r); usedFamily.add(fam);
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
  const plan: PlanItem[] = picks.map((r, i) => ({ slot: slots[Math.min(i, slots.length - 1)], candidate: r.c, why: whyLine(r, context), isMVD: r === mvd }));

  const planMin = picks.reduce((m, r) => m + (SIZE_MINUTES[r.c.size] ?? 45), 0);
  const fits = planMin <= Math.max(15, budget);
  const note =
    mode === "deadline" ? "A deadline's close — the urgent application/material step leads. Do that one and today counts."
    : budget < 45 ? "Very little day left. One tiny useful application or track move is enough."
    : budget < 90 ? "One useful application or track move is enough for the time left today."
    : mode === "low" ? "Lighter day. The first one is all that matters — done is plenty."
    : mode === "strategy" ? `${context.bottleneckLane} is the bottleneck. Anchor is choosing the next move to strengthen an application or track.`
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

export function recommend(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], energy: Energy) {
  const context = buildStrategicContext(tasks, jobs, learn, hustles);
  const cands = gatherCandidates(tasks, jobs, learn, hustles).filter((c) => passesGates(c, context));
  const mode = pickDayMode(cands, energy, context);
  if (cands.length === 0) return { mode, pick: null, alternative: null };
  const ranked = cands.map((c) => scoreWithTrace(c, energy, mode, context)).sort((a, b) => b.s - a.s);
  const pick = ranked[0].c;
  const alternative = ranked.map((r) => r.c).find((c) => !(c.source === pick.source && c.sourceId === pick.sourceId) && c.size === "quick") || null;
  return { mode, pick, alternative, trace: ranked[0].trace, bottleneck: context.bottleneck, lane: context.bottleneckLane };
}
