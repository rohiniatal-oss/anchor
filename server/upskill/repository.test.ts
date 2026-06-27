import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "../spine.harness";
import * as repo from "./repository";
import type { HorizonItem } from "./types";

let h: Harness;
before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

function item(trackId: number, title: string, over: Partial<HorizonItem> = {}): HorizonItem {
  return {
    trackId, phaseLabel: "Foundations", title, activity: "do", doneWhen: "done",
    morning: { hours: 1, focus: "", items: [] }, afternoon: { hours: 1, focus: "", items: [] },
    sources: [], artifact: {}, rationale: "r", ...over,
  } as HorizonItem;
}

test("replaceHorizon inserts queued items and listHorizon returns them ordered", () => {
  repo.replaceHorizon([item(1, "A"), item(2, "B"), item(1, "C")]);
  const horizon = repo.listHorizon();
  assert.equal(horizon.length, 3);
  assert.deepEqual(horizon.map((i) => i.title), ["A", "B", "C"]);
  assert.equal(repo.countByStatus("queued"), 3);
});

test("nextQueuedForTrack returns the lowest-sequence queued item for a track", () => {
  repo.replaceHorizon([item(1, "A1"), item(2, "B1"), item(1, "A2")]);
  assert.equal(repo.nextQueuedForTrack(1)?.title, "A1");
  assert.equal(repo.nextQueuedForTrack(2)?.title, "B1");
  assert.equal(repo.nextQueuedForTrack(999), undefined);
});

test("status transitions: active -> completed and skipped are tracked", () => {
  const [a] = repo.replaceHorizon([item(1, "A")]);
  repo.markActive(a.id, 42, "2026-06-27");
  let row = repo.getItem(a.id)!;
  assert.equal(row.status, "active");
  assert.equal(row.linkedPlanItemId, 42);
  assert.equal(row.plannedFor, "2026-06-27");

  repo.markCompleted(a.id);
  row = repo.getItem(a.id)!;
  assert.equal(row.status, "completed");
  assert.ok(row.completedAt && row.completedAt > 0);

  const [b] = repo.replaceHorizon([item(1, "B")]);
  repo.markSkipped(b.id);
  assert.equal(repo.getItem(b.id)!.status, "skipped");
});

test("listRecentCompleted and currentPhaseLabel reflect history", () => {
  const [a, b] = repo.replaceHorizon([item(1, "A", { phaseLabel: "P1" }), item(1, "B", { phaseLabel: "P2" })]);
  repo.markCompleted(a.id);
  repo.markCompleted(b.id);
  const recent = repo.listRecentCompleted(10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].title, "B"); // most recent first
  assert.equal(repo.currentPhaseLabel(), "P2");
});

test("replaceHorizon retires prior queued/active items as stale", () => {
  const [a] = repo.replaceHorizon([item(1, "A")]);
  repo.markActive(a.id, 1, "2026-06-27");
  repo.replaceHorizon([item(1, "B"), item(1, "C")]);
  assert.equal(repo.countByStatus("stale"), 1);
  assert.equal(repo.countByStatus("queued"), 2);
});

test("check-ins round-trip newest first", () => {
  repo.insertCheckin({ trackId: 1, whatsWorking: "momentum", energy: "high" } as any);
  repo.insertCheckin({ trackId: 1, whatsNot: "scope creep", energy: "low" } as any);
  const all = repo.listCheckins();
  assert.equal(all.length, 2);
  assert.equal(all[0].whatsNot, "scope creep");
});
