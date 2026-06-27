// Distil recent Anchor behaviour into a short bullet summary the planner can read.
// Pure function over already-fetched rows — no DB access — so it is trivial to test.
import type { ActivityLog, Learn, DayPlan, UpskillCheckin } from "@shared/schema";

export type SignalsInput = {
  activityLog: ActivityLog[];
  learn: Learn[];
  dayPlans: DayPlan[];
  checkins: UpskillCheckin[];
};

const RECENT_WINDOW_MS = 14 * 86_400_000;

// Returns up to 5 short bullets (no leading dash) describing what completed, what
// got skipped, what is stalled, recent learn activity, and the latest check-in.
export function summarizeSignals(input: SignalsInput): string[] {
  const now = Date.now();
  const recent = input.activityLog.filter((e) => now - e.timestamp <= RECENT_WINDOW_MS);
  const bullets: string[] = [];

  const completed = recent.filter((e) => e.eventType === "completed").length;
  const skipped = recent.filter((e) => e.eventType === "skipped").length;
  if (completed || skipped) {
    bullets.push(`Last 14 days: ${completed} item(s) completed, ${skipped} skipped.`);
  } else {
    bullets.push("No completions or skips logged in the last 14 days.");
  }

  const blocked = recent.filter((e) => e.eventType === "blocked" || e.eventType === "parked").length;
  if (blocked) bullets.push(`${blocked} item(s) stalled (blocked/parked) recently — keep new steps small.`);

  const activeLearn = input.learn.filter((l) => l.active && !l.done);
  if (activeLearn.length) {
    bullets.push(`Active learning: ${activeLearn.slice(0, 4).map((l) => l.title).join("; ")}.`);
  }

  const drafting = input.learn.filter((l) => l.outputStatus === "drafting" || l.outputStatus === "published");
  if (drafting.length) {
    bullets.push(`Artifacts in progress/published: ${drafting.slice(0, 3).map((l) => l.outputTitle || l.title).join("; ")}.`);
  }

  const latestCheckin = [...input.checkins].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (latestCheckin) {
    const parts = [
      latestCheckin.whatsWorking && `working: ${latestCheckin.whatsWorking}`,
      latestCheckin.whatsNot && `not: ${latestCheckin.whatsNot}`,
      latestCheckin.wantToDrop && `drop: ${latestCheckin.wantToDrop}`,
      latestCheckin.wantToAdd && `add: ${latestCheckin.wantToAdd}`,
    ].filter(Boolean);
    bullets.push(`Latest check-in (energy=${latestCheckin.energy}): ${parts.join(" | ") || "no detail"}.`);
  }

  return bullets.slice(0, 5);
}
