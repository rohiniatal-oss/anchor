import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "../spine.harness";
import * as repo from "./repository";
import {
  getDueUpskillAnchors, materializeForToday, linkUpskillItemToPlanItem,
  completeUpskillItem, skipUpskillItem,
} from "./materializer";
import { __setHorizonLlmForTest } from "./planner";
import type { HorizonItem } from "./types";

let h: Harness;
before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); __setHorizonLlmForTest(null); });

function item(trackId: number, title: string, over: Partial<HorizonItem> = {}): HorizonItem {
  return {
    trackId, phaseLabel: "P", title, activity: "do", doneWhen: "done",
    morning: { hours: 1, focus: "", items: [] }, afternoon: { hours: 1, focus: "", items: [] },
    sources: [], artifact: {}, rationale: "r", ...over,
  } as HorizonItem;
}

async function seedTracks() {
  const t1 = await h.storage.createCareerTrack({ name: "AI gov", slug: "ai", status: "active", priority: 3 } as any);
  const t2 = await h.storage.createCareerTrack({ name: "Geo", slug: "geo", status: "active", priority: 1 } as any);
  const t3 = await h.storage.createCareerTrack({ name: "Paused", slug: "p", status: "paused", priority: 9 } as any);
  return { t1, t2, t3 };
}

test("getDueUpskillAnchors returns one item per active track, priority order", async () => {
  const { t1, t2, t3 } = await seedTracks();
  repo.replaceHorizon([item(t2.id, "Geo A"), item(t1.id, "AI A"), item(t1.id, "AI B"), item(t3.id, "Paused A")]);

  const anchors = getDueUpskillAnchors("2026-06-27");
  assert.equal(anchors.length, 2); // paused track excluded
  assert.equal(anchors[0].title, "AI A"); // priority 3 first
  assert.equal(anchors[1].title, "Geo A");
  assert.deepEqual(materializeForToday("2026-06-27").map((a) => a.title), ["AI A", "Geo A"]);
});

test("getDueUpskillAnchors only serves queued items, skipping active/completed ones", async () => {
  const { t1 } = await seedTracks();
  const [a, b] = repo.replaceHorizon([item(t1.id, "AI A"), item(t1.id, "AI B")]);
  repo.markActive(a.id, 1, "2026-06-27"); // first item already on a plan
  // Next due for the track is now the second queued item, not the active one.
  const anchors = getDueUpskillAnchors("2026-06-27");
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].id, b.id);
  repo.markCompleted(b.id);
  assert.equal(getDueUpskillAnchors("2026-06-27").length, 0); // nothing queued left
});

test("linkUpskillItemToPlanItem marks the item active and records the link", async () => {
  const { t1 } = await seedTracks();
  const [a] = repo.replaceHorizon([item(t1.id, "AI A")]);
  linkUpskillItemToPlanItem(a.id, 777);
  const row = repo.getItem(a.id)!;
  assert.equal(row.status, "active");
  assert.equal(row.linkedPlanItemId, 777);
});

test("completeUpskillItem propagates completion and captures an artifact as learn", async () => {
  const { t1 } = await seedTracks();
  const [a] = repo.replaceHorizon([item(t1.id, "AI A", { artifact: { techniqueKey: "bluf", title: "Memo", saveAs: "memo.md", prompt: "write" } })]);
  completeUpskillItem(a.id, "AI A");
  assert.equal(repo.getItem(a.id)!.status, "completed");
  // allow the fire-and-forget learn capture to settle
  await new Promise((r) => setTimeout(r, 30));
  const learn = await h.storage.getLearn();
  assert.ok(learn.some((l) => l.outputTitle === "Memo" && l.sourceType === "upskill"));
});

test("skipUpskillItem propagates skip", async () => {
  const { t1 } = await seedTracks();
  const [a] = repo.replaceHorizon([item(t1.id, "AI A")]);
  skipUpskillItem(a.id, "not now");
  assert.equal(repo.getItem(a.id)!.status, "skipped");
});

test("complete/skip on a missing item are no-ops", () => {
  completeUpskillItem(9999);
  skipUpskillItem(null);
  assert.equal(repo.countByStatus("completed"), 0);
});

test("three accumulated skips auto-trigger a recompose", async () => {
  const { t1 } = await seedTracks();
  let llmCalls = 0;
  __setHorizonLlmForTest(async () => {
    llmCalls++;
    return { ok: true as const, value: { items: Array.from({ length: 10 }, (_, i) => item(t1.id, `R${i}`)) } };
  });
  const items = repo.replaceHorizon([item(t1.id, "A"), item(t1.id, "B"), item(t1.id, "C")]);
  for (const it of items) skipUpskillItem(it.id, "later");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(llmCalls, 1); // recompose fired once at the 3rd skip
});
