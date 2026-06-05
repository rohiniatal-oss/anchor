import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { buildTrackSpine } from "./trackSpine";
import { gatherCandidates, type Candidate, type PlanItem, type PlanTrace, type SlotName, type DayMode } from "./brain";

// Adapter layer: Today and Brain should read the same Tracks x Lanes reason graph.
// This keeps the old candidate gatherer but replaces the diagnostic context with
// TrackSpine so the front door and sequencer stop disagreeing.

type Energy = "low" | "medium" | "high";
type CapacityInput = number | { busyMinutes?: number; now?: Date; remainingMinutes?: number };

const SIZE_MINUTES: Record<string, number> = { quick: 15, medium: 45, deep: 120 };
const CATEGORY_FAMILY: Record<string, string> = {
  job: "job", interview: "job",
  substack: "output", afterline: "output", hustle: "output",
  learning: "growth",
  health: "care", admin: "care",
};

function daysUntil(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T23:59:59");
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
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
function candidateText(c: Candidate) {
  return `${c.title} ${c.category} ${c.whyNow} ${c.sourceNote} ${c.sourceStatus}`.toLowerCase();
}
function matchesLane(c: Candidate, lane: string) {
  const text = candidateText(c);
  if (lane === "Applications") return c.category === "job" || /apply|application|interview|cover|submit|cv|resume|follow up|tailor|posting|requirements/.test(text);
  if (lane === "Network") return /network|contact|message|coffee|intro|referral|follow up|whatsapp|email|person/.test(text);
  if (lane === "Proof assets") return /proof|memo|forecast|portfolio|publish|story bank|cv bullet|case study|evidence/.test(text) || ["hustle", "substack", "afterline"].includes(c.category);
  if (lane === "Learning and development") return c.category === "learning" || /learn|read|course|resource|podcast|book|study|output|practice|drill|skill/.test(text);
  if (lane === "Direction") return /direction|role|career|inspect|signal|attribute|explore|job family|market map|pattern/.test(text) && !/submit|apply now/.test(text);
  if (lane === "Stability") return c.blocked || c.category === "admin" || c.category === "health";
  return false;
}
function matchesMove(c: Candidate, title: string) {
  const text = candidateText(c);
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
  return words.filter((w) => text.includes(w)).length >= 2;
}
function gateReason(c: Candidate) {
  if (c.status === "done") return "already done";
  if (c.blocked) return c.blockerReason ? `blocked: ${c.blockerReason}` : "blocked";
  if (c.eligibilityRisk === "likely_ineligible") return "constraint needs handling before submission";
  return null;
}
function pickMode(cands: Candidate[], energy: Energy): DayMode {
  const hasUrgent = cands.some((c) => { const d = daysUntil(c.deadline); return d !== null && d <= 3; });
  if (hasUrgent) return "deadline";
  if (energy === "low") return "low";
  return "strategy";
}
function score(c: Candidate, spine: ReturnType<typeof buildTrackSpine>, mode: DayMode, energy: Energy) {
  let s = 0;
  const trace: string[] = [];
  const d = daysUntil(c.deadline);
  if (d !== null) {
    if (d <= 0) { s += 200; trace.push("deadline is due/overdue"); }
    else if (d <= 2) { s += 140; trace.push("deadline is within 2 days"); }
    else if (d <= 7) { s += 70; trace.push("deadline is this week"); }
  }
  if (c.fitScore !== null) {
    const fitBoost = Math.round((c.fitScore / 100) * 60);
    s += fitBoost;
    if (fitBoost >= 35) trace.push("strong fit score");
  }
  if (matchesLane(c, spine.bestMove.lane)) { s += 85; trace.push(`matches ${spine.bestMove.lane} spine lane`); }
  if (matchesMove(c, spine.bestMove.title)) { s += 55; trace.push("matches spine best move"); }
  if (spine.activeTrack && candidateText(c).includes(spine.activeTrack.name.toLowerCase().split(" ")[0])) { s += 25; trace.push("matches active track"); }
  if (mode === "low" || energy === "low") {
    if (c.size === "quick") { s += 25; trace.push("fits a low-energy day"); }
    if (c.size === "deep") { s -= 30; trace.push("deep work penalty on low-energy day"); }
  }
  if (c.status === "in_progress") { s += 15; trace.push("already in progress"); }
  if (c.whyNow) trace.push(c.whyNow);
  return { c, s, trace };
}
function whyLine(r: ReturnType<typeof score>, spine: ReturnType<typeof buildTrackSpine>) {
  const top = r.trace.filter(Boolean).slice(0, 2).join("; ");
  return `${spine.bestMove.lane} lane. ${top || spine.bestMove.reason || "Best available next move"}.`;
}

export function planDay(
  tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[] = [], tracks: CareerTrack[] = [],
  energy: Energy, capacity: CapacityInput = 0,
): { mode: DayMode; plan: PlanItem[]; note: string; mvdIndex: number; trace: PlanTrace } {
  const spine = buildTrackSpine({ tasks, jobs, learn, hustles, contacts, tracks });
  const all = gatherCandidates(tasks, jobs, learn, hustles);
  const ignored = all.map((c) => ({ c, reason: gateReason(c) })).filter((x) => x.reason).slice(0, 5).map((x) => `${x.c.title}: ${x.reason}`);
  const cands = all.filter((c) => !gateReason(c));
  const mode = pickMode(cands, energy);
  const budget = capacityMinutes(capacity);

  if (cands.length === 0) {
    const candidate: Candidate = {
      source: "task", sourceId: 0, taskId: null, title: spine.bestMove.title, category: spine.bestMove.lane === "Applications" ? "job" : spine.bestMove.lane === "Learning and development" ? "learning" : "admin",
      size: "quick", deadline: "", status: "not_started", skipped: 0, sourceUrl: "", sourceNote: spine.bestMove.reason, sourceStatus: "track_spine",
      doneWhen: spine.bestMove.doneWhen, whyNow: spine.bestMove.reason, fitScore: null, blocked: false, blockerReason: "", eligibilityRisk: "",
    };
    return {
      mode,
      plan: [{ slot: "now", candidate, why: `${spine.bestMove.lane} lane. ${spine.bestMove.reason}`, isMVD: true }],
      note: "No existing candidate matched. Anchor is using the spine best move.",
      mvdIndex: 0,
      trace: { picked: [spine.bestMove.title], ignored, bottleneck: spine.bestMove.lane, reason: spine.bestMove.reason, remainingMinutes: budget, laneTrace: spine.trace },
    };
  }

  const ranked = cands.map((c) => score(c, spine, mode, energy)).sort((a, b) => b.s - a.s);
  const maxItems = budget < 90 ? 1 : (energy === "low" || mode === "low") ? Math.min(2, cands.length) : budget < 180 ? 2 : 3;
  const picks: typeof ranked = [];
  const usedFamily = new Set<string>();
  for (const r of ranked) {
    if (picks.length >= maxItems) break;
    const fam = CATEGORY_FAMILY[r.c.category] ?? "care";
    if (usedFamily.has(fam) && picks.length > 0) continue;
    picks.push(r); usedFamily.add(fam);
  }
  for (const r of ranked) {
    if (picks.length >= maxItems) break;
    if (!picks.includes(r)) picks.push(r);
  }

  const slots: SlotName[] = ["now", "next", "later", "bonus"];
  const plan: PlanItem[] = picks.map((r, i) => ({ slot: slots[Math.min(i, slots.length - 1)], candidate: r.c, why: whyLine(r, spine), isMVD: i === 0 }));
  const planMin = picks.reduce((m, r) => m + (SIZE_MINUTES[r.c.size] ?? 45), 0);
  const fits = planMin <= Math.max(15, budget);
  const note = mode === "deadline" ? "A deadline's close — the urgent application/material step leads."
    : budget < 90 ? "One useful spine-aligned move is enough for the time left today."
    : mode === "low" ? "Lighter day. The first spine-aligned move is all that matters."
    : fits ? "Start at the top. The first move is the one that matters."
    : "Full plate for the time you've got. Just do the first one and call it a win.";

  return {
    mode,
    plan,
    note,
    mvdIndex: 0,
    trace: {
      picked: picks.map((r) => `${r.c.title}: ${whyLine(r, spine)}`),
      ignored,
      bottleneck: spine.bestMove.lane,
      reason: spine.bestMove.reason,
      remainingMinutes: budget,
      laneTrace: spine.trace,
    },
  };
}

export function recommend(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[] = [], tracks: CareerTrack[] = [], energy: Energy) {
  const spine = buildTrackSpine({ tasks, jobs, learn, hustles, contacts, tracks });
  const cands = gatherCandidates(tasks, jobs, learn, hustles).filter((c) => !gateReason(c));
  const mode = pickMode(cands, energy);
  if (cands.length === 0) return { mode, pick: null, alternative: null, spine };
  const ranked = cands.map((c) => score(c, spine, mode, energy)).sort((a, b) => b.s - a.s);
  const pick = ranked[0].c;
  const alternative = ranked.map((r) => r.c).find((c) => !(c.source === pick.source && c.sourceId === pick.sourceId) && c.size === "quick") || null;
  return { mode, pick, alternative, trace: ranked[0].trace, bottleneck: spine.bestMove.lane, lane: spine.bestMove.lane, spine };
}
