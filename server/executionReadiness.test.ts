import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;
const DAY = "2026-06-04";

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

async function makePlanWithItem(opts: Partial<{
  sourceType: string; sourceId: number | null; taskId: number | null;
  title: string; doneWhen: string; slot: string;
}> = {}) {
  const plan = await h.storage.createPlan({ date: DAY, status: "active" } as any);
  const item = await h.storage.createPlanItem({
    planId: plan.id,
    sequence: 0,
    slot: opts.slot ?? "now",
    sourceType: opts.sourceType ?? "task",
    sourceId: opts.sourceId ?? 1,
    taskId: opts.taskId ?? null,
    title: opts.title ?? "Task",
    whySelected: "Because",
    doneWhen: opts.doneWhen ?? "Done",
    status: "planned",
    plannedFor: DAY,
    createdAt: Date.now(),
  } as any);
  return { plan, item };
}

test("plan-item start seeds a starter step when a deep plain task becomes active", async () => {
  const existing = await h.storage.createTask({
    title: "Draft long memo",
    list: "inbox",
    status: "not_started",
    size: "deep",
    steps: "[]",
  } as any);
  const { item } = await makePlanWithItem({ taskId: existing.id, slot: "now" });
  const r = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(r.status, 200);
  const steps = JSON.parse(r.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "started deep tasks should not stay blank");
  assert.match(String(steps[0]?.text || ""), /open|start|sentence|timer|doc|note/i);
});

test("brain accept uses source-aware task creation so job candidates start with real steps", async () => {
  const job = await h.storage.createJob({
    title: "Policy role",
    company: "Org",
    status: "wishlist",
    nextStep: "Draft cover",
    applicationReadiness: "cv",
  } as any);
  const accepted = await api(h.base, "POST", "/api/brain/accept", {
    candidate: {
      source: "job",
      sourceId: job.id,
      title: "Advance application: Policy role @ Org",
      category: "job",
      size: "deep",
      doneWhen: "Application moved one step forward",
      block: "morning",
    },
  });
  assert.equal(accepted.status, 200);
  const steps = JSON.parse(accepted.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "source-backed accepted tasks should start with steps");
  assert.match(String(steps[0]?.text || ""), /open|write|draft|list|highlight|match|rewrite|read|note/i);
});

test("plan-item start turns a broad-pursuit goal item into a concrete role-pipeline task", async () => {
  const { item } = await makePlanWithItem({
    sourceType: "goal",
    sourceId: 1,
    taskId: null,
    title: "Add or apply to one credible role in each plausible lane that still looks real",
    doneWhen: "One concrete role or application move exists in each active lane",
    slot: "now",
  });

  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(started.status, 200);
  assert.equal(started.json.task.category, "job");
  const steps = JSON.parse(started.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "goal-derived strategic tasks should get concrete steps");
  assert.match(String(steps[0]?.text || ""), /open jobs|save the first credible role|saved role|pipeline action/i);
});
