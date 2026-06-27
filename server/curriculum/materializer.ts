/**
 * Self-adapting materialisation: completing/skipping days, shifting the calendar,
 * and firing a slip intervention when the user falls behind repeatedly.
 *
 * Rules:
 * - complete(day): mark done; the schedule does not move.
 * - skip(day): mark skipped; every still-planned later day slides +1 calendar day
 *   (the plan stays whole, it just moves out).
 * - slip intervention: if SLIP_THRESHOLD skips land within SLIP_WINDOW_DAYS, record
 *   a one-off "slip_intervention" event so the surface can prompt a re-plan.
 */
import { rawDb } from "../storage";
import { ensureCurriculumSchema } from "./schema";
import { nextWeekday } from "./dates";
import {
  getCurriculum,
  getCurriculumEvents,
  getDay,
  recordCurriculumEvent,
  touchCurriculum,
} from "./repository";
import type { PersistedCurriculum } from "./types";

export const SLIP_THRESHOLD = 3;
export const SLIP_WINDOW_DAYS = 7;
const SLIP_WINDOW_MS = SLIP_WINDOW_DAYS * 86_400_000;

export class CurriculumDayError extends Error {
  status = 404;
  code = "curriculum_day_not_found";
}

export function completeDay(curriculumId: number, dayId: number, note = ""): PersistedCurriculum {
  ensureCurriculumSchema();
  const day = getDay(curriculumId, dayId);
  if (!day) throw new CurriculumDayError(`Day ${dayId} not found in curriculum ${curriculumId}`);

  rawDb.prepare("UPDATE curriculum_days SET status = 'completed', completed_at = ?, skipped_at = NULL WHERE id = ?")
    .run(Date.now(), dayId);
  recordCurriculumEvent(curriculumId, "day_completed", dayId, { dayIndex: day.dayIndex, note });
  touchCurriculum(curriculumId);
  return getCurriculum(curriculumId)!;
}

export function skipDay(curriculumId: number, dayId: number, reason = ""): PersistedCurriculum {
  ensureCurriculumSchema();
  const day = getDay(curriculumId, dayId);
  if (!day) throw new CurriculumDayError(`Day ${dayId} not found in curriculum ${curriculumId}`);

  const startDate = rawDb.prepare("SELECT start_date FROM curricula WHERE id = ?")
    .get(curriculumId) as { start_date: string } | undefined;

  const tx = rawDb.transaction(() => {
    rawDb.prepare("UPDATE curriculum_days SET status = 'skipped', skipped_at = ?, completed_at = NULL WHERE id = ?")
      .run(Date.now(), dayId);

    // Recompute each still-planned later day's date from its effective day-index
    // rather than incrementing the existing date. The schedule is then always
    // derivable from (startDate, dayIndex, skipsBeforeThisDay) and stays
    // weekday-clean even after many skips. cumulativeSkips counts every skip up to
    // and including this one (all skipped days sit before the remaining planned
    // days in sequence), and is computed once before the loop.
    const cumulativeSkips = getCurriculumEvents(curriculumId, "day_skipped").length + 1;
    const base = startDate?.start_date || "";
    const laterPlanned = rawDb.prepare(
      "SELECT id, day_index FROM curriculum_days WHERE curriculum_id = ? AND sequence > ? AND status = 'planned'",
    ).all(curriculumId, day.sequence) as { id: number; day_index: number }[];
    const shift = rawDb.prepare("UPDATE curriculum_days SET planned_date = ? WHERE id = ?");
    for (const d of laterPlanned) {
      shift.run(nextWeekday(base, d.day_index + cumulativeSkips), d.id);
    }
    recordCurriculumEvent(curriculumId, "day_skipped", dayId, { dayIndex: day.dayIndex, reason, shifted: laterPlanned.length });
  });
  tx();

  maybeFireSlipIntervention(curriculumId);
  touchCurriculum(curriculumId);
  return getCurriculum(curriculumId)!;
}

function maybeFireSlipIntervention(curriculumId: number): void {
  const now = Date.now();
  const windowStart = now - SLIP_WINDOW_MS;
  const skipsInWindow = getCurriculumEvents(curriculumId, "day_skipped").filter((e) => e.createdAt >= windowStart);
  if (skipsInWindow.length < SLIP_THRESHOLD) return;

  // Fire at most once per rolling window so a long slip streak does not spam.
  const recentIntervention = getCurriculumEvents(curriculumId, "slip_intervention").some((e) => e.createdAt >= windowStart);
  if (recentIntervention) return;

  recordCurriculumEvent(curriculumId, "slip_intervention", null, {
    skipsInWindow: skipsInWindow.length,
    windowDays: SLIP_WINDOW_DAYS,
    message: `You have skipped ${skipsInWindow.length} days in the last ${SLIP_WINDOW_DAYS} days. Consider re-planning the remaining weeks.`,
  });
}
