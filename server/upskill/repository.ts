// Persistence for the upskill horizon + check-ins. Uses the shared Drizzle `db`
// handle (the repo norm) over `upskill_plan_items` / `upskill_checkins`.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../storage";
import { upskillPlanItems, upskillCheckins } from "@shared/schema";
import type { UpskillPlanItem, UpskillCheckin, InsertUpskillCheckin } from "@shared/schema";
import type { HorizonItem } from "./types";

export function listHorizon(): UpskillPlanItem[] {
  return db.select().from(upskillPlanItems).orderBy(asc(upskillPlanItems.sequence)).all();
}

export function getItem(id: number): UpskillPlanItem | undefined {
  return db.select().from(upskillPlanItems).where(eq(upskillPlanItems.id, id)).get();
}

export function countByStatus(status: string): number {
  const row = db.select({ n: sql<number>`count(*)` }).from(upskillPlanItems)
    .where(eq(upskillPlanItems.status, status)).get();
  return row?.n ?? 0;
}

export function listRecentCompleted(limit = 10): UpskillPlanItem[] {
  return db.select().from(upskillPlanItems)
    .where(eq(upskillPlanItems.status, "completed"))
    .orderBy(desc(upskillPlanItems.completedAt), desc(upskillPlanItems.id))
    .limit(limit).all();
}

// The phase label of the most recently touched item (active first, else latest
// completed), so the planner knows whether to continue or transition.
export function currentPhaseLabel(): string {
  const active = db.select().from(upskillPlanItems)
    .where(eq(upskillPlanItems.status, "active"))
    .orderBy(desc(upskillPlanItems.sequence)).get();
  if (active?.phaseLabel) return active.phaseLabel;
  const lastDone = db.select().from(upskillPlanItems)
    .where(eq(upskillPlanItems.status, "completed"))
    .orderBy(desc(upskillPlanItems.completedAt), desc(upskillPlanItems.id)).get();
  return lastDone?.phaseLabel || "";
}

// The next queued item for a track, lowest sequence first.
export function nextQueuedForTrack(trackId: number): UpskillPlanItem | undefined {
  return db.select().from(upskillPlanItems)
    .where(and(eq(upskillPlanItems.trackId, trackId), eq(upskillPlanItems.status, "queued")))
    .orderBy(asc(upskillPlanItems.sequence)).get();
}

// Replace the forward-looking horizon: mark current queued/active items stale,
// then insert the freshly composed items as queued. Completed/skipped history is
// preserved. Returns the inserted rows.
export function replaceHorizon(items: HorizonItem[]): UpskillPlanItem[] {
  const now = Date.now();
  return db.transaction((tx) => {
    tx.update(upskillPlanItems)
      .set({ status: "stale" })
      .where(inArray(upskillPlanItems.status, ["queued", "active"]))
      .run();

    const maxRow = tx.select({ m: sql<number>`coalesce(max(sequence), 0)` }).from(upskillPlanItems).get();
    let sequence = (maxRow?.m ?? 0) + 1;

    const inserted: UpskillPlanItem[] = [];
    for (const item of items) {
      const row = tx.insert(upskillPlanItems).values({
        trackId: item.trackId,
        sequence: sequence++,
        phaseLabel: item.phaseLabel,
        title: item.title,
        activity: item.activity,
        doneWhen: item.doneWhen,
        morningBlock: JSON.stringify(item.morning ?? {}),
        afternoonBlock: JSON.stringify(item.afternoon ?? {}),
        sources: JSON.stringify(item.sources ?? []),
        artifact: JSON.stringify(item.artifact ?? {}),
        status: "queued",
        plannedFor: null,
        linkedPlanItemId: null,
        rationale: item.rationale,
        createdAt: now,
        completedAt: null,
        skippedAt: null,
      } as any).returning().get();
      inserted.push(row);
    }
    return inserted;
  });
}

export function markActive(id: number, planItemId: number, plannedFor: string): UpskillPlanItem | undefined {
  return db.update(upskillPlanItems)
    .set({ status: "active", linkedPlanItemId: planItemId, plannedFor })
    .where(eq(upskillPlanItems.id, id)).returning().get();
}

export function markCompleted(id: number): UpskillPlanItem | undefined {
  return db.update(upskillPlanItems)
    .set({ status: "completed", completedAt: Date.now(), skippedAt: null })
    .where(eq(upskillPlanItems.id, id)).returning().get();
}

export function markSkipped(id: number): UpskillPlanItem | undefined {
  return db.update(upskillPlanItems)
    .set({ status: "skipped", skippedAt: Date.now() })
    .where(eq(upskillPlanItems.id, id)).returning().get();
}

// ── Check-ins ──────────────────────────────────────────────────────────────
export function insertCheckin(input: InsertUpskillCheckin): UpskillCheckin {
  return db.insert(upskillCheckins).values({ ...input, createdAt: Date.now() } as any).returning().get();
}

export function listCheckins(): UpskillCheckin[] {
  return db.select().from(upskillCheckins)
    .orderBy(desc(upskillCheckins.createdAt), desc(upskillCheckins.id)).all();
}
