import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { refinedEstimateFromSteps, stepsWithEstimatedMinutes } from "./planningFeedback";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("refinedEstimateFromSteps sums complete step estimates", () => {
  const raw = JSON.stringify([
    { text: "Open notes", done: false, estimateMinutes: 5 },
    { text: "Draft outline", done: false, estimateMinutes: 20 },
  ]);
  const r = refinedEstimateFromSteps(raw)!;
  assert.equal(r.estimateMinutes, 25);
  assert.equal(r.estimateConfidence, "medium");
  assert.equal(r.estimateReason, "breakdown_sum");
});

test("refinedEstimateFromSteps marks partial estimates as low confidence", () => {
  const raw = JSON.stringify([
    { text: "Open notes", done: false, estimateMinutes: 5 },
    { text: "Draft outline", done: false },
  ]);
  const r = refinedEstimateFromSteps(raw)!;
  assert.equal(r.estimateMinutes, 5);
  assert.equal(r.estimateConfidence, "low");
  assert.equal(r.estimateReason, "breakdown_partial_sum");
});

test("stepsWithEstimatedMinutes fills missing estimates without breaking old steps", () => {
  const raw = JSON.stringify([
    { text: "Open notes", done: false },
    { text: "Draft outline", done: false },
  ]);
  const steps = stepsWithEstimatedMinutes(raw);
  assert.equal(steps.length, 2);
  assert.ok(steps.every((s) => typeof s.estimateMinutes === "number"));
});

test("refine-estimate endpoint updates parent task estimate from steps", async () => {
  const task = await h.storage.createTask({
    title: "Draft outline",
    list: "today",
    done: false,
    status: "not_started",
    category: "substack",
    size: "deep",
    estimateMinutes: 90,
    estimateConfidence: "low",
    estimateReason: "intake_guess:deep_work_keyword",
    steps: JSON.stringify([
      { text: "Open notes", done: false, estimateMinutes: 5 },
      { text: "Draft outline", done: false, estimateMinutes: 20 },
    ]),
  } as any);

  const r = await api(h.base, "POST", `/api/tasks/${task.id}/refine-estimate-from-steps`, { inferMissing: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.refined.estimateMinutes, 25);
  assert.equal(r.json.task.estimateMinutes, 25);
  assert.equal(r.json.task.estimateConfidence, "medium");
  assert.equal(r.json.task.estimateReason, "breakdown_sum");

  const log = await h.storage.getActivityLog();
  assert.ok(log.some((a) => a.eventType === "estimate_refined" && a.taskId === task.id));
});
