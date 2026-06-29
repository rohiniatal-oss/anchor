// Bridges the upskill horizon to the Today engine. Selection is read-only (the
// Today engine in sprint2.ts owns day_plan_items); this module marks items active
// when they land on a plan and propagates completion/skip back to the horizon,
// auto-recomposing when the user has built up enough progress or slip.
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../storage";
import { careerTracks } from "@shared/schema";
import type { CareerTrack } from "@shared/schema";
import * as repo from "./repository";
import { RECOMPOSE_AFTER_COMPLETED, RECOMPOSE_AFTER_SKIPPED } from "./types";

export type UpskillAnchor = {
  id: number;
  trackId: number;
  title: string;
  activity: string;
  doneWhen: string;
  phaseLabel: string;
  rationale: string;
};

function activeTracksByPriority(): CareerTrack[] {
  return db.select().from(careerTracks)
    .where(eq(careerTracks.status, "active"))
    .orderBy(desc(careerTracks.priority), asc(careerTracks.id)).all();
}

// Next queued item per active track, highest-priority track first. Read-only:
// the Today engine copies these into day_plan_items, then calls
// linkUpskillItemToPlanItem to mark them active.
export function getDueUpskillAnchors(_day: string): UpskillAnchor[] {
  const anchors: UpskillAnchor[] = [];
  for (const track of activeTracksByPriority()) {
    const item = repo.nextQueuedForTrack(track.id);
    if (!item) continue;
    anchors.push({
      id: item.id,
      trackId: item.trackId,
      title: item.title,
      activity: item.activity,
      doneWhen: item.doneWhen,
      phaseLabel: item.phaseLabel,
      rationale: item.rationale,
    });
  }
  return anchors;
}

// Spec-named entry point: what the upskill plan would inject into Today on `date`.
export function materializeForToday(date: string): UpskillAnchor[] {
  return getDueUpskillAnchors(date);
}

export function linkUpskillItemToPlanItem(itemId: number, planItemId: number): void {
  const today = new Date().toISOString().slice(0, 10);
  repo.markActive(itemId, planItemId, today);
}

// Completion propagation. Best-effort artifact capture into the learn table and
// auto-recompose fire as un-awaited side effects so the caller (the Today
// complete handler) is never blocked or broken by them.
export function completeUpskillItem(itemId: number | null | undefined, _title = ""): void {
  if (itemId == null) return;
  const item = repo.getItem(itemId);
  if (!item) return;
  repo.markCompleted(itemId);
  void captureArtifact(item.artifact, item.trackId, item.title);
  if (repo.countByStatus("completed") % RECOMPOSE_AFTER_COMPLETED === 0) {
    void triggerRecompose();
  }
}

export function skipUpskillItem(itemId: number | null | undefined, _reason = ""): void {
  if (itemId == null) return;
  const item = repo.getItem(itemId);
  if (!item) return;
  repo.markSkipped(itemId);
  if (repo.countByStatus("skipped") % RECOMPOSE_AFTER_SKIPPED === 0) {
    void triggerRecompose();
  }
}

async function triggerRecompose(): Promise<void> {
  try {
    const { recompose } = await import("./planner");
    await recompose();
  } catch (err) {
    console.error(`[upskill] auto-recompose failed: ${(err as Error)?.message || err}`);
  }
}

async function captureArtifact(artifactJson: string, trackId: number, fallbackTitle: string): Promise<void> {
  let artifact: any = {};
  try { artifact = JSON.parse(artifactJson || "{}"); } catch { return; }
  if (!artifact?.saveAs) return;
  try {
    const { storage } = await import("../storage");
    await storage.createLearn({
      title: artifact.title || fallbackTitle,
      type: "practice",
      category: "upskill",
      note: artifact.prompt || "",
      relatedTrackId: trackId,
      sourceType: "upskill",
      outputTitle: artifact.title || fallbackTitle,
      outputStatus: "published",
      requiredOutput: artifact.prompt || "",
      done: true,
    } as any);
  } catch (err) {
    console.error(`[upskill] artifact capture failed: ${(err as Error)?.message || err}`);
  }
}
