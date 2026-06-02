import type { Task, Job, Learn, Hustle } from "@shared/schema";
import { isOpportunityActionable } from "@shared/domainState";

// ─────────────────────────────────────────────────────────────────────────
// ANCHOR BRAIN — adaptive sequencer (NOT a balanced-day picker).
// Priority order (SPEC §1): hard deadlines > blockers > high-fit career moves
// > minimum viable day > learning/relationship drumbeat > variety > nice-to-have.
// Variety is a soft tie-breaker, never overrides priority.
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

// The REAL next step for a job depends on its pipeline state + readiness,
// NOT its deadline (deadline = urgency only). SPEC §3.
function jobNextStep(j: Job): { action: string; size: string; doneWhen: string; why: string } {
  const role = `${j.title}${j.company ? " \u2014 " + j.company : ""}`;
  // An explicit user-written next step is always the truest action.
  if (j.nextStep && j.nextStep.trim()) {
    return { action: `${j.nextStep.trim()} \u2014 ${role}`, size: guessSize(j.nextStep),
      doneWhen: "That step is done", why: "your own next step on this role" };
  }
  const readiness = j.applicationReadiness || "none";
  if (j.eligibilityRisk && j.eligibilityRisk !== "") {
    return { action: `Check eligibility before investing time \u2014 ${role}`, size: "quick",
      doneWhen: "You know if you're eligible", why: `flagged: ${j.eligibilityRisk}` };
  }
  switch (j.status) {
    case "wishlist":
      if (readiness === "none")
        return { action: `Open the posting & note what it asks for \u2014 ${role}`, size: "quick",
          doneWhen: "You've listed CV / cover / sample / portal needed", why: "turns a wish into a real plan" };
      return { action: `Tailor your CV to this role \u2014 ${role}`, size: "deep",
        doneWhen: "CV reflects this role's language", why: "fit is clear; time to make it land" };
    case "applied":
      return { action: `Follow up on your application \u2014 ${role}`, size: "quick",
        doneWhen: "A polite nudge is sent", why: "applied roles go cold without a nudge" };
    case "interviewing":
      return { action: `Build your story bank \u2014 ${role}`, size: "deep",
        doneWhen: "3 STAR stories ready", why: "you're in the room \u2014 prep wins it" };
    default:
      return { action: `Decide if this is worth pursuing \u2014 ${role}`, size: "quick",
        doneWhen: "You've kept or archived it", why: "needs a keep / drop decision" };
  }
}

export type DayMode = "normal" | "low" | "deadline";

export function gatherCandidates(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[]): Candidate[] {
  const out: Candidate[] = [];

  // Today tasks — carry everything they already hold.
  for (const t of tasks) {
    if (t.list === "today" && !t.done) {
      const blocked = t.readiness === "blocked" || !!t.blockerReason;
      out.push({
        source: "task", sourceId: t.id, taskId: t.id,
        title: t.title.replace(/^\u2728\s*/, ""), category: t.category, size: t.size,
        deadline: t.deadline, status: t.status, skipped: t.skipped,
        sourceUrl: t.sourceUrl || "", sourceNote: t.sourceNote || "", sourceStatus: t.sourceStatus || "",
        doneWhen: t.doneWhen || "", whyNow: "", fitScore: null,
        blocked, blockerReason: t.blockerReason || "", eligibilityRisk: "",
      });
    }
  }

  // Jobs (incl. fellowships) — real per-state next step, deadline CARRIED.
  // Window-aware: a closed window (e.g. a watch/closed 2026 fellowship) is
  // MONITORED, not actionable, so it never surfaces as a live application.
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

  // Dedupe across tabs: if a Today task already covers an opportunity (e.g.
  // "Apply to the Impact Accelerator" task vs the Impact Accelerator learn item),
  // don't surface both. The task wins — it's the actionable version.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(apply to|finish|the|your|a|an|produce|free|week|6week|programme|program)\b/g, "").replace(/\s+/g, " ").trim();
  const taskKeys = out.filter((c) => c.source === "task").map((c) => norm(c.title));
  const isDuplicate = (title: string) => {
    const k = norm(title);
    if (!k || k.length < 6) return false;
    return taskKeys.some((tk) => tk && (tk.includes(k) || k.includes(tk)) && Math.min(tk.length, k.length) >= 6);
  };

  // Active learning — deadline CARRIED, requires an output. Skip if a Today task
  // already covers it (dedupe across tabs).
  for (const l of learn) {
    if (l.active && !l.done && l.learnStatus !== "closed" && !isDuplicate(l.title)) {
      const dl = l.applicationDeadline || "";
      out.push({
        source: "learn", sourceId: l.id, taskId: null,
        title: l.requiredOutput ? `${l.title} \u2014 produce: ${l.requiredOutput}` : l.title,
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
        title: `${h.nextStep} (${h.title.replace(/^[\u2600-\u27BF\uD800-\uDFFF]+\s*/, "")})`,
        category: cat, size: guessSize(h.nextStep),
        deadline: "", status: "not_started", skipped: 0,
        sourceUrl: "", sourceNote: h.note || "", sourceStatus: h.stage,
        doneWhen: "That step is done", whyNow: "proof of your judgement \u2014 builds credibility",
        fitScore: null, blocked: false, blockerReason: "", eligibilityRisk: "",
      });
    }
  }
  return out;
}

// ── GATES: run before scoring (SPEC §3). Removes things that should NEVER
// be recommended — blocked, ineligible, already done.
function passesGates(c: Candidate): boolean {
  if (c.status === "done") return false;
  if (c.blocked) return false;
  if (c.eligibilityRisk === "likely_ineligible") return false;
  return true;
}

export function pickDayMode(cands: Candidate[], energy: Energy): DayMode {
  const hasUrgent = cands.some((c) => { const d = daysUntil(c.deadline); return d !== null && d <= 3; });
  if (hasUrgent) return "deadline";
  if (energy === "low") return "low";
  return "normal";
}

// ── ADAPTIVE SCORE — encodes the priority order directly.
function score(c: Candidate, energy: Energy, mode: DayMode): number {
  let s = 0;
  // 1. HARD DEADLINES first.
  const d = daysUntil(c.deadline);
  if (d !== null) { if (d <= 0) s += 200; else if (d <= 2) s += 140; else if (d <= 7) s += 70; else s += 20; }
  // 2. (blockers already removed by gates; a was-blocked-now-ready item gets no penalty)
  // 3. HIGH-FIT career moves.
  if (c.fitScore !== null) s += Math.round((c.fitScore / 100) * 60);
  s += (8 - (CATEGORY_RANK[c.category] ?? 7)) * 6;
  // energy shaping
  if (mode === "low" || energy === "low") { if (c.size === "quick") s += 25; if (c.size === "deep") s -= 30; }
  if (mode === "deadline" && d !== null && d <= 3) s += 30;
  // gentle resurfacing of avoided items (never aggressive)
  s += Math.min(c.skipped, 3) * 4;
  if (c.status === "in_progress") s += 15;
  return s;
}

// ── Now / Next / Later / Bonus plan with a Minimum Viable Day.
export type SlotName = "now" | "next" | "later" | "bonus";
export type PlanItem = { slot: SlotName; candidate: Candidate; why: string; isMVD: boolean };

function freeMinutes(busyMinutes: number): number {
  const WAKING = 10 * 60;
  return Math.max(60, WAKING - busyMinutes);
}

export function planDay(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[],
  energy: Energy, busyMinutes = 0,
): { mode: DayMode; plan: PlanItem[]; note: string; mvdIndex: number } {
  const all = gatherCandidates(tasks, jobs, learn, hustles);
  const cands = all.filter(passesGates);
  const mode = pickDayMode(cands, energy);
  if (cands.length === 0)
    return { mode, plan: [], note: "Nothing actionable right now \u2014 add a couple of things and I'll shape a day.", mvdIndex: -1 };

  const ranked = cands.map((c) => ({ c, s: score(c, energy, mode) })).sort((a, b) => b.s - a.s);

  // How many slots? Time- and energy-aware (SPEC §3). Low energy never gets 3 deep items.
  const budget = freeMinutes(busyMinutes);
  const maxItems = (energy === "low" || mode === "low") ? 2 : (budget < 120 ? 2 : 3);

  // Variety as a SOFT tie-breaker: prefer a new family only when scores are close.
  const picks: Candidate[] = [];
  const usedFamily = new Set<string>();
  for (const { c, s } of ranked) {
    if (picks.length >= maxItems) break;
    const fam = CATEGORY_FAMILY[c.category] ?? "care";
    // If this family is already used AND there's a comparably-scored unused-family
    // option still ahead, skip — otherwise priority wins.
    if (usedFamily.has(fam)) {
      const betterDiff = ranked.find(r => !usedFamily.has(CATEGORY_FAMILY[r.c.category] ?? "care")
        && !picks.includes(r.c) && (s - r.s) <= 25);
      if (betterDiff) continue;
    }
    picks.push(c); usedFamily.add(fam);
  }
  // Top up if thin.
  if (picks.length < maxItems) {
    for (const { c } of ranked) {
      if (picks.includes(c)) continue;
      picks.push(c);
      if (picks.length >= maxItems) break;
    }
  }

  // MVD = the single highest-priority item. "Do this and today counts."
  const mvd = picks[0];

  // Lay into Now / Next / Later: priority order IS the sequence (not size-sorted).
  const slots: SlotName[] = ["now", "next", "later", "bonus"];
  const plan: PlanItem[] = picks.map((c, i) => {
    const why = c.whyNow && c.whyNow.trim()
      ? c.whyNow
      : (CATEGORY_FAMILY[c.category] === "job" ? "keeps the job hunt moving"
        : CATEGORY_FAMILY[c.category] === "output" ? "builds your own credibility"
        : CATEGORY_FAMILY[c.category] === "growth" ? "a capability your path needs"
        : "worth clearing");
    return { slot: slots[Math.min(i, slots.length - 1)], candidate: c, why, isMVD: c === mvd };
  });

  const planMin = picks.reduce((m, c) => m + (SIZE_MINUTES[c.size] ?? 45), 0);
  const fits = planMin <= budget;
  const note =
    mode === "deadline" ? "A deadline's close \u2014 the urgent thing leads. Do that one and today counts."
    : mode === "low" ? "Lighter day. The first one is all that matters \u2014 done is plenty."
    : fits ? "Start at the top. Finish the first one and today already counts."
    : "Full plate for the time you've got. Just do the first one and call it a win.";

  return { mode, plan, note, mvdIndex: 0 };
}

// Single next-action pick (re-plan path / API symmetry).
export function recommend(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], energy: Energy) {
  const cands = gatherCandidates(tasks, jobs, learn, hustles).filter(passesGates);
  const mode = pickDayMode(cands, energy);
  if (cands.length === 0) return { mode, pick: null, alternative: null };
  const ranked = cands.map((c) => ({ c, s: score(c, energy, mode) })).sort((a, b) => b.s - a.s);
  const pick = ranked[0].c;
  const alternative = ranked.map((r) => r.c).find((c) => !(c.source === pick.source && c.sourceId === pick.sourceId) && c.size === "quick") || null;
  return { mode, pick, alternative };
}
