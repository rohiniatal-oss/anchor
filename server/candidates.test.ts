import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { careerAssetsFromActivity, generateCandidateUniverse, starterDirections } from "./candidates";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("starter directions are grounded in real assets and warm networks", () => {
  const directions = starterDirections();
  assert.ok(directions.length >= 5);
  assert.ok(directions.some((d) => d.warmNetworks.includes("Bain")));
  assert.ok(directions.some((d) => d.warmNetworks.includes("SIPA")));
  assert.ok(directions.some((d) => d.warmNetworks.includes("TBI")));
  assert.ok(directions.some((d) => d.warmNetworks.includes("Worldpay/FIS")));
});

test("candidate universe builds directions, activities, and one recommendation", () => {
  const universe = generateCandidateUniverse([], []);
  assert.ok(universe.directions.length >= 5);
  assert.ok(universe.activities.length >= 1);
  assert.ok(universe.recommended);
  assert.ok(universe.grounding.includes("Bain"));
  assert.match(universe.recommended.firstStep, /Search|Look|Write|Open/i);
});

test("career assets can be reconstructed from activity log", () => {
  const now = Date.now();
  const assets = careerAssetsFromActivity([
    { id: 1, eventType: "career_asset_upsert", sourceType: "career_asset", sourceId: null, taskId: null, planItemId: null, metadata: JSON.stringify({ key: "net-test", kind: "network", label: "Test Network", strength: 9 }), timestamp: now } as any,
  ]);
  assert.ok(assets.some((a) => a.label === "Test Network"));
});

test("career asset API adds custom assets used by candidates", async () => {
  const create = await api(h.base, "POST", "/api/career-assets", { kind: "network", label: "Oxford network", note: "test asset", strength: 9 });
  assert.equal(create.status, 200);
  assert.ok(create.json.assets.some((a: any) => a.label === "Oxford network"));

  const candidates = await api(h.base, "GET", "/api/candidates");
  assert.equal(candidates.status, 200);
  assert.ok(candidates.json.grounding.includes("Oxford network"));
});

test("candidate commit creates one Today task with a first step", async () => {
  const r = await api(h.base, "POST", "/api/candidates/commit");
  assert.equal(r.status, 200);
  assert.ok(r.json.task?.id);
  assert.equal(r.json.task.list, "today");
  assert.equal(r.json.task.category, "job");
  const steps = JSON.parse(r.json.task.steps);
  assert.ok(steps.length >= 1);
  assert.equal(steps[0].done, false);

  const log = await h.storage.getActivityLog();
  assert.ok(log.some((a) => a.eventType === "candidate_committed" && a.taskId === r.json.task.id));
});
