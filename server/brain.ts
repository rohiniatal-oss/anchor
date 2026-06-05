import type { Task, Job, Learn, Hustle } from "@shared/schema";
import { isOpportunityActionable } from "@shared/domainState";
import { buildCareerGoalState } from "./goalState";
import { buildExplorationQueue } from "./explorationQueue";

// ─────────────────────────────────────────────────────────────────────────
// ANCHOR BRAIN — adaptive sequencer (NOT a balanced-day picker).
// Canonical decision flow:
// 1) diagnose the current goal bottleneck, 2) gather eligible actions,
// 3) gate what should not surface, 4) score by urgency + strategic fit,
// 5) sequence against the remaining day, 6) explain why this beat alternatives.
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

// A candidate now carries FULL context so the rest of the app never has to
// reconstruct meaning from a title (SPEC §3, MUST-FIX #1, #2, #3).
export type Candidate = {
  source: "task" | "job" | "learn" | "hustle";
  sourceId: number;
  title: string;            // the specific next ACTION (not the object name)
  category: string;
  size: string;
  deadline: string;         // CARRIED from jobs/learn — never "" when one exists
  status: string;
  skipped: number;
  // carried context
  sourceUrl: string;        // the real posting / course / profile URL
  sourceNote: string;       // context snippet
  sourceStatus: string;     // mirror of the source object's status
  doneWhen: string;         // done condition (every candidate gets one)
  whyNow: string;           // specific reason this matters now (not generic)
  fitScore: number | null;  // jobs only
  blocked: boolean;
  blockerReason: string;
  eligibilityRisk: string;
  taskId: number | null;    // backing task id if this is a real task row
};

type StrategicContext = {
  bottleneck: string;
  reason: string;
  applicationsPremature: boolean;
  recommendedExploration: string;
};

type RankedCandidate = {
  c: Candidate;
  s: number;
  trace: string[];
};

export type PlanTrace = {
  picked: string[];
  ignored: string[];
  bottleneck: string;
  reason: string;
  remainingMinutes: number;
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
  return /direction|role|career|inspect|signal|attribute|explore|job family|research|fit|path/i.test(`${c.title} ${c.whyNow} ${c.sourceNote}`);
}

function isApplicationLike(c: Candidate) {
  return c.category === "job" || /apply|application|interview|cover|submit|cv|resume/i.test(`${c.title} ${c.whyNow}`);
}

function isProofAsset(c: Candidate) {
  return CATEGORY_FAMILY[c.category] === "output" || /proof|substack|memo|forecast|portfolio|publish/i.test(`${c.title} ${c.sourceNote}`);
}

function buildStrategicContext(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[]): StrategicContext {
  try {
    const log: any[] = [];
    const goalState = buildCareerGoalState(tasks, jobs, log);
    const exploration = buildExplorationQueue(tasks, jobs, log);
    const applications = goalState.workstreams.find((w: any) => w.name === "Applications");
    return {
      bottleneck: goalState.recommendedFocus || "Progress",
      reason: goalState.reason || "Best next move from current inputs.",
      applicationsPremature: applications?.status === "premature",
      recommendedExploration: exploration.recommended?.direction || "",
    };
  } catch {
    return {
      bottleneck: "Progress",
      reason: "Best next move from current inputs.",
      applicationsPremature: false,
      recommendedExploration: "",
    };
  }
}

// The REAL next step for a job depends on its pipeline state + readiness,
// NOT its deadline (deadline = urgency only). SPEC §3.
function jobNextStep(j: Job): { action: string; size: string; doneWhen: string; why: string } {
  const role = `${j.title}${j.company ? " — " + j.company : ""}`;
  // An explicit user-written next step is always the truest action.
  if (j.nextStep && j.nextStep.trim()) {
    return { action: `${j.nextStep.trim()} — ${role}`, size: guessSize(j.nextStep),
      doneWhen: "That step is done", why: "your own next step on this role" };
  }
  const readiness = j.applicationReadiness || "none";
  if (j.eligibilityRisk && j.eligibilityRisk !== "") {
    return { action: `Check eligibility before investing time — ${role}`, size: "quick",
      doneWhen: "You know if you're eligible", why: `flagged: ${j.eligibilityRisk}` };
  }
  switch (j.status) {
    case "wishlist":
      if (readiness === "none")
        return { action: `Open the posting & note what it asks for — ${role}`, size: "quick",
          doneWhen: "You've listed CV / cover / sample / portal needed", why: "turns a wish into a real plan" };
      return { action: `Tailor your CV to this role — ${role}`, size: "deep",
        doneWhen: "CV reflects this role's language", why: "fit is clear; time to make it land" };
    case "applied":
      return { action: `Follow up on your application — ${role}`, size: "quick",
        doneWhen: "A polite nudge is sent", why: "applied roles go cold without a nudge" };
    case "interviewing":
      return { action: `Build your story bank — ${role}`, size: "deep",
        doneWhen: "3 STAR stories ready", why: "you're in the room — prep wins it" };
    default:
      return { action: `Decide if this is worth pursuing — ${role}`, size: "quick",
        doneWhen: "You've kept or archived it", why: "needs a keep / drop decision" };
  }
}

export type DayMode = "normal" | "low" | "deadline" | "strategy";

export function gatherCandidates(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[]): Candidate[] {
  const out: Candidate[] = [];

  // Today tasks — carry everything they already hold.
  for (const t of tasks) {
    if (t.list === "today" && !t.done) {
      const blocked = t.readiness === "blocked" || !!t.blockerReason;
      out.push({
        source: "task", sourceId: t.id, taskId: t.id,
        title: t.title.replace(/^✨\s*/, ""), category: t.category, size: t.size,
        deadline: t.deadline, status: t.status, skipped: t.skipped,
        sourceUrl: t.sourceUrl || "", sourceNote: t.sourceNote || "", sourceStatus: t.sourceStatus || "",
        doneWhen: t.doneWhen || t.minimumOutcome || "The smallest useful outcome is complete", whyNow: "already on today's list", fitScore: null,
        blocked, blockerReason: t.blockerReason || "", eligibilityRisk: "",
      });
    }
  }

  // Inbox items do NOT auto-flow here by keyword. Triage has to classify whether
  // they are standalone tasks, subtasks, notes, blockers, source updates, or clutter.

  // Jobs (incl. fellowships) — real per-state next step, deadline CARRIED.
  // Window-aware: a closed window is monitored, not actionable.
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

  // Dedupe across tabs: if a Today task already covers an opportunity, don't surface both.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(apply to|finish|the|your|a|an|produce|free|week|6week|programme|program)\b/g, "").replace(/\s+/g, " ").trim();
  const taskKeys = out.filter((c) => c.source === "task").map((c) => norm(c.title));
  const isDuplicate = (title: string) => {
    const k = norm(title);
    if (!k || k.length < 6) return false;
    return taskKeys.some((tk) => tk && (tk.includes(k) || k.includes(tk)) && Math.min(tk.length, k.length) >= 6);
  };

  // Active learning — deadline CARRIED, requires an output. Skip if a Today task already covers it.
  for (const l of learn) {
    if (l.active && !l.done && l.learnStatus !== "closed" && !isDuplicate(l.title)) {
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

  // Hustles — the concrete next step, not the whole project.
  for (const h of hustles) {
    if (h.nextStep && h.stage !== "earning") {
      const cat = /substack/i.test(h.title) ? "substack" : /afterline/i.test(h.title) ? "afterline" : "hustle";
      out.push({
        source: "hustle", sourceId: h.id, taskId: null,
        title: `${h.nextStep} (${h.title.replace(/^[☀-➿\uD800-\uDFFF]+\s*/, "")})`,
        category: cat, size: guessSize(h.nextStep),
        deadline: "", status: "not_started", skipped: 0,
        sourceUrl: "", sourceNote: h.note || "", sourceStatus: h.stage,
        doneWhen: "That step is done", whyNow: "proof of your judgement — builds credibility",
        fitScore: null, blocked: false, blockerReason: "", eligibilityRisk: "",
      });
    }
  }
  return out;
}

// ── GATES: run before scoring. Removes things that should NEVER be recommended.
function gateReason(c: Candidate, context: StrategicContext): string | null {
  if (c.status === "done") return "already done";
  if (c.blocked) return c.blockerReason ? `blocked: ${c.blockerReason}` : "blocked";
  if (c.eligibilityRisk === "likely_ineligible") return "likely ineligible";
  if (context.applicationsPremature && isApplicationLike(c) && !isDirectionSignal(c)) return "applications are premature until direction/proof is clearer";
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

// ── ADAPTIVE SCORE — encodes priority + strategic diagnosis directly.
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

  const categoryBoost = (8 - (CATEGORY_RANK[c.category] ?? 7)) * 6;
  s += categoryBoost;

  if (/direction/i.test(context.bottleneck) && isDirectionSignal(c)) {
    s += 55;
    trace.push("matches today's direction bottleneck");
  }
  if (/application/i.test(context.bottleneck) && isApplicationLike(c)) {
    s += 45;
    trace.push("matches today's application bottleneck");
  }
  if (/proof|credibility|evidence/i.test(context.bottleneck) && isProofAsset(c)) {
    s += 45;
    trace.push("builds proof/credibility for the target path");
  }
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
  return scoreWithTrace(c, energy, mode, { bottleneck: "Progress", reason: "", applicationsPremature: false, recommendedExploration: "" }).s;
}

// ── Now / Next / Later / Bonus plan with a Minimum Viable Day.
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
  if (typeof input === "number") {
    // Legacy callers pass total busy minutes. Convert that to a remaining-day view
    // instead of pretending every restart still has a full 10-hour day available.
    return Math.max(0, remainingDayMinutes() - Math.max(0, input));
  }
  if (typeof input.remainingMinutes === "number") return Math.max(0, input.remainingMinutes);
  return Math.max(0, remainingDayMinutes(input.now) - Math.max(0, input.busyMinutes || 0));
}

function whyLine(r: RankedCandidate, context: StrategicContext) {
  const top = r.trace.filter(Boolean).slice(0, 3).join("; ");
  const bottleneck = context.bottleneck && context.bottleneck !== "Progress" ? `Bottleneck: ${context.bottleneck}. ` : "";
  return `${bottleneck}${top || "Best available next move"}.`;
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
      note: "Nothing actionable right now — add a couple of things and I'll shape a day.",
      mvdIndex: -1,
      trace: { picked: [], ignored, bottleneck: context.bottleneck, reason: context.reason, remainingMinutes: budget },
    };
  }

  const ranked = cands.map((c) => scoreWithTrace(c, energy, mode, context)).sort((a, b) => b.s - a.s);

  // How many slots? Time- and energy-aware, using remaining day rather than a full-day fiction.
  const maxItems = budget < 45 ? 1
    : budget < 90 ? 1
    : (energy === "low" || mode === "low") ? Math.min(2, cands.length)
    : budget < 180 ? 2
    : 3;

  // Variety as a SOFT tie-breaker: prefer a new family only when scores are close.
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
  // Top up if thin.
  if (picks.length < maxItems) {
    for (const r of ranked) {
      if (picks.includes(r)) continue;
      picks.push(r);
      if (picks.length >= maxItems) break;
    }
  }

  // MVD = the single highest-priority item. "Do this and today counts."
  const mvd = picks[0];

  // Lay into Now / Next / Later: priority order IS the sequence (not size-sorted).
  const slots: SlotName[] = ["now", "next", "later", "bonus"];
  const plan: PlanItem[] = picks.map((r, i) => {
    return { slot: slots[Math.min(i, slots.length - 1)], candidate: r.c, why: whyLine(r, context), isMVD: r === mvd };
  });

  const planMin = picks.reduce((m, r) => m + (SIZE_MINUTES[r.c.size] ?? 45), 0);
  const fits = planMin <= Math.max(15, budget);
  const note =
    mode === "deadline" ? "A deadline's close — the urgent thing leads. Do that one and today counts."
    : budget < 45 ? "Very little day left. One tiny useful thing is enough."
    : budget < 90 ? "One useful thing is enough for the time left today."
    : mode === "low" ? "Lighter day. The first one is all that matters — done is plenty."
    : mode === "strategy" ? `Today's plan is shaped around the current bottleneck: ${context.bottleneck}. Finish the first one and today counts.`
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
    },
  };
}

// Single next-action pick (re-plan path / API symmetry).
export function recommend(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], energy: Energy) {
  const context = buildStrategicContext(tasks, jobs, learn, hustles);
  const cands = gatherCandidates(tasks, jobs, learn, hustles).filter((c) => passesGates(c, context));
  const mode = pickDayMode(cands, energy, context);
  if (cands.length === 0) return { mode, pick: null, alternative: null };
  const ranked = cands.map((c) => scoreWithTrace(c, energy, mode, context)).sort((a, b) => b.s - a.s);
  const pick = ranked[0].c;
  const alternative = ranked.map((r) => r.c).find((c) => !(c.source === pick.source && c.sourceId === pick.sourceId) && c.size === "quick") || null;
  return { mode, pick, alternative, trace: ranked[0].trace, bottleneck: context.bottleneck };
}
