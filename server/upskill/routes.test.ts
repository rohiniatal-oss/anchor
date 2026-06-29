import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "../spine.harness";
import { __setHorizonLlmForTest } from "./planner";
import * as repo from "./repository";

let h: Harness;
before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); __setHorizonLlmForTest(null); });

function fakeItem(trackId: number, i: number) {
  return {
    trackId, phaseLabel: "Foundations", title: `Item ${i}`, activity: "do", doneWhen: "done",
    morning: { hours: 2, focus: "read", items: ["src"] }, afternoon: { hours: 2, focus: "write", items: ["draft"] },
    sources: [], artifact: { techniqueKey: "bluf", saveAs: `a-${i}.md` }, rationale: "r",
  };
}
function setHorizon(trackId: number) {
  __setHorizonLlmForTest(async () => ({ ok: true as const, value: { items: Array.from({ length: 10 }, (_, i) => fakeItem(trackId, i)) } }));
}

test("GET /api/upskill/horizon is empty before any recompose", async () => {
  const res = await api(h.base, "GET", "/api/upskill/horizon");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.items, []);
});

test("POST /api/upskill/recompose returns 400 when there are no active tracks", async () => {
  const res = await api(h.base, "POST", "/api/upskill/recompose", {});
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "no_active_tracks");
});

test("POST /api/upskill/recompose seeds a 10-item horizon; repeat is idempotent in size", async () => {
  const track = await h.storage.createCareerTrack({ name: "AI gov", slug: "ai", status: "active", priority: 2 } as any);
  setHorizon(track.id);

  const first = await api(h.base, "POST", "/api/upskill/recompose", {});
  assert.equal(first.status, 201);
  assert.equal(first.json.items.length, 10);

  const second = await api(h.base, "POST", "/api/upskill/recompose", {});
  assert.equal(second.status, 201);
  assert.equal(repo.countByStatus("queued"), 10);
});

test("POST /api/upskill/checkin persists a record and reports recompose outcome", async () => {
  const res = await api(h.base, "POST", "/api/upskill/checkin", { whatsWorking: "flow", energy: "high" });
  assert.equal(res.status, 201);
  assert.equal(res.json.checkin.whatsWorking, "flow");
  // No active tracks here, so recompose reports its reason rather than failing the call.
  assert.equal(res.json.recompose, "no_active_tracks");
  assert.equal(repo.listCheckins().length, 1);
});

test("complete/skip item endpoints 404 on unknown ids and mutate on known ids", async () => {
  const track = await h.storage.createCareerTrack({ name: "AI gov", slug: "ai", status: "active", priority: 2 } as any);
  setHorizon(track.id);
  await api(h.base, "POST", "/api/upskill/recompose", {});
  const id = repo.listHorizon()[0].id;

  const missing = await api(h.base, "POST", "/api/upskill/items/999999/complete", {});
  assert.equal(missing.status, 404);

  const done = await api(h.base, "POST", `/api/upskill/items/${id}/complete`, {});
  assert.equal(done.status, 200);
  assert.equal(done.json.item.status, "completed");

  const id2 = repo.listHorizon().find((i) => i.status === "queued")!.id;
  const skipped = await api(h.base, "POST", `/api/upskill/items/${id2}/skip`, { reason: "later" });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.json.item.status, "skipped");
});
