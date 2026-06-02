import type { Task, Job, Learn, Hustle } from "@shared/schema";

// Seasonal priority hierarchy (lower = higher priority). Afterline is NOT parked.
const CATEGORY_RANK: Record<string, number> = {
  job: 1, substack: 2, interview: 3, health: 4, learning: 5, hustle: 6, afterline: 6, admin: 7,
};

type Energy = "low" | "medium" | "high";
type TimeBudget = "15" | "45" | "120";
const SIZE_MINUTES: Record<string, number> = { quick: 15, medium: 45, deep: 120 };

// A normalized candidate the brain can reason about, drawn from ANY tab.
export type Candidate = {
  source: "task" | "job" | "learn" | "hustle";
  sourceId: number;
  title: string;
  category: string;
  size: string;
  deadline: string;
  status: string;
  skipped: number;
};

function daysUntil(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T23:59:59");
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

// Guess a sensible size from a title (so cross-tab items aren't all "medium").
function guessSize(title: string, fallback = "medium"): string {
  const t = title.toLowerCase();
  if (/\b(open|check|confirm|email|message|send|note|skim|read one|sign up|list|book|call)\b/.test(t)) return "quick";
  if (/\b(write|draft|apply|prepare|build|outline|tailor|research|finish)\b/.test(t)) return "deep";
  return fallback;
}

export type DayMode = "normal" | "low" | "deadline";

export function gatherCandidates(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[]): Candidate[] {
  const out: Candidate[] = [];
  // Today tasks (already carry brain fields)
  for (const t of tasks) {
    if (t.list === "today" && !t.done) {
      out.push({ source: "task", sourceId: t.id, title: t.title.replace(/^\u2728\s*/, ""), category: t.category, size: t.size, deadline: t.deadline, status: t.status, skipped: t.skipped });
    }
  }
  // Jobs in the active pipeline (wishlist/applied/interviewing) -> the next action is to advance them
  for (const j of jobs) {
    if (j.status === "wishlist" || j.status === "applied" || j.status === "interviewing") {
      const verb = j.status === "wishlist" ? "Apply to" : j.status === "applied" ? "Follow up on" : "Prep for";
      out.push({ source: "job", sourceId: j.id, title: `${verb} ${j.title}${j.company ? " \u2014 " + j.company : ""}`, category: "job", size: j.status === "wishlist" ? "deep" : "medium", deadline: "", status: "not_started", skipped: 0 });
    }
  }
  // Active learning items only (respect the active/parked system)
  for (const l of learn) {
    if (l.active && !l.done) {
      out.push({ source: "learn", sourceId: l.id, title: l.title, category: "learning", size: guessSize(l.title), deadline: "", status: "not_started", skipped: 0 });
    }
  }
  // Hustle next-steps (the concrete action, not the whole project)
  for (const h of hustles) {
    if (h.nextStep && h.stage !== "earning") {
      const cat = /substack/i.test(h.title) ? "substack" : /afterline/i.test(h.title) ? "afterline" : "hustle";
      out.push({ source: "hustle", sourceId: h.id, title: `${h.nextStep} (${h.title.replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*/u, "")})`, category: cat, size: guessSize(h.nextStep), deadline: "", status: "not_started", skipped: 0 });
    }
  }
  return out;
}

export function pickDayMode(cands: Candidate[], energy: Energy): DayMode {
  const hasUrgent = cands.some((c) => { const d = daysUntil(c.deadline); return d !== null && d <= 3; });
  if (hasUrgent) return "deadline";
  if (energy === "low") return "low";
  return "normal";
}

function score(c: Candidate, energy: Energy, timeBudget: TimeBudget, mode: DayMode): number {
  let s = 0;
  const d = daysUntil(c.deadline);
  if (d !== null) { if (d <= 0) s += 100; else if (d <= 3) s += 70; else if (d <= 7) s += 40; else s += 15; }
  s += (8 - (CATEGORY_RANK[c.category] ?? 7)) * 8;
  const taskMin = SIZE_MINUTES[c.size] ?? 45;
  const budgetMin = Number(timeBudget);
  if (taskMin <= budgetMin) s += 12; else s -= 20;
  if (mode === "low" || energy === "low") { if (c.size === "quick") s += 25; if (c.size === "deep") s -= 30; }
  if (mode === "deadline" && d !== null && d <= 3) s += 30;
  s += Math.min(c.skipped, 3) * 4;
  if (c.status === "in_progress") s += 10;
  return s;
}

// --- Balanced day plan -------------------------------------------------
// Goal (per Rohini): "here's what to do today" with VARIETY — never 12 hours
// of one type. We pick ~3 high-value candidates from DIFFERENT category
// families and lay them across morning/afternoon/evening. Honest, not a
// rigid minute-by-minute scheduler.

type PlanItem = { slot: "morning" | "afternoon" | "evening"; candidate: Candidate; why: string };

// Group related categories so "variety" means real variety, not job vs job.
const CATEGORY_FAMILY: Record<string, string> = {
  job: "job", interview: "job",            // job hunt
  substack: "output", afterline: "output", hustle: "output", // your own building
  learning: "growth",                       // upskilling
  health: "care", admin: "care",            // looking after yourself / housekeeping
};

function freeMinutes(busyMinutes: number): number {
  // Rough waking capacity minus what the calendar already eats.
  const WAKING = 10 * 60; // ~10 productive hours
  return Math.max(60, WAKING - busyMinutes);
}

export function planDay(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[],
  energy: Energy, busyMinutes = 0,
): { mode: DayMode; plan: PlanItem[]; note: string } {
  const cands = gatherCandidates(tasks, jobs, learn, hustles);
  const mode = pickDayMode(cands, energy);
  if (cands.length === 0) return { mode, plan: [], note: "Nothing queued yet \u2014 add a couple of things and I'll shape a day." };

  // Score everything once (use the full-day budget so deep work isn't penalised).
  // Per Rohini: learning/reading should be present MOST days (not demoted to
  // "only when tied to output"). On normal days we give the growth family a
  // standing boost so it reliably earns a slot; on a real deadline day it can
  // still get bumped by the urgent work.
  const growthBoost = mode === "deadline" ? 0 : 18;
  const ranked = cands
    .map((c) => {
      let s = score(c, energy, "120", mode);
      if ((CATEGORY_FAMILY[c.category] ?? "care") === "growth") s += growthBoost;
      return { c, s };
    })
    .sort((a, b) => b.s - a.s);

  // Pick up to 3, enforcing one-per-family for variety. Low-energy days: cap at 2.
  const maxItems = energy === "low" || mode === "low" ? 2 : 3;
  const usedFamily = new Set<string>();
  const picks: Candidate[] = [];
  for (const { c } of ranked) {
    const fam = CATEGORY_FAMILY[c.category] ?? "care";
    if (usedFamily.has(fam)) continue;
    usedFamily.add(fam);
    picks.push(c);
    if (picks.length >= maxItems) break;
  }
  // If we couldn't fill from distinct families (thin queue), top up with next best.
  if (picks.length < maxItems) {
    for (const { c } of ranked) {
      if (picks.some((p) => p.source === c.source && p.sourceId === c.sourceId)) continue;
      picks.push(c);
      if (picks.length >= maxItems) break;
    }
  }

  // Lay across the day: heaviest first (mornings = sharpest), light/care last.
  const ordered = [...picks].sort((a, b) => (SIZE_MINUTES[b.size] ?? 45) - (SIZE_MINUTES[a.size] ?? 45));
  const slots: PlanItem["slot"][] = ["morning", "afternoon", "evening"];
  const plan: PlanItem[] = ordered.map((c, i) => {
    const fam = CATEGORY_FAMILY[c.category] ?? "care";
    const d = daysUntil(c.deadline);
    // The real reason this was chosen — deadline first, then it being the genuine
    // next step for that project, then category fit. Shown so the plan is trustworthy.
    let why: string;
    if (d !== null && d <= 7) {
      why = d <= 0 ? "due today — highest priority" : d === 1 ? "due tomorrow" : `deadline in ${d} days`;
    } else if (c.source === "hustle") {
      why = "your real next step on this — right where you are";
    } else if (c.source === "job") {
      why = "moves a live application forward";
    } else if (fam === "growth") {
      why = "keeps learning ticking — not the whole day";
    } else if (fam === "output") {
      why = "builds your own credibility";
    } else if (fam === "care") {
      why = "something kind to close out";
    } else {
      why = "a good fit for today";
    }
    return { slot: slots[Math.min(i, slots.length - 1)], candidate: c, why };
  });

  const planMin = picks.reduce((m, c) => m + (SIZE_MINUTES[c.size] ?? 45), 0);
  const free = freeMinutes(busyMinutes);
  const fits = planMin <= free;
  const note =
    mode === "deadline" ? "A deadline's close \u2014 the urgent thing leads, but I've kept variety so you don't burn out."
    : mode === "low" ? "Lighter day. Two gentle things, mixed types. Done is plenty."
    : fits ? "Three different kinds of work so today isn't all one thing. Do them in any order \u2014 the slots are just a suggestion."
    : "This is a full plate for the time you've got. If the day's tight, just do the morning one and call it a win.";

  return { mode, plan, note };
}

export function recommend(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], energy: Energy, timeBudget: TimeBudget) {
  const cands = gatherCandidates(tasks, jobs, learn, hustles);
  const mode = pickDayMode(cands, energy);
  if (cands.length === 0) return { mode, pick: null, alternative: null };
  const ranked = cands.map((c) => ({ c, s: score(c, energy, timeBudget, mode) })).sort((a, b) => b.s - a.s);
  const pick = ranked[0].c;
  const alternative = ranked.map((r) => r.c).find((c) => !(c.source === pick.source && c.sourceId === pick.sourceId) && c.size === "quick") || null;
  return { mode, pick, alternative };
}
