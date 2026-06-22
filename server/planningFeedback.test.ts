import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPlanningFeedback, buildPlanningMemory, deterministicUnstickStep, prependStep } from "./planningFeedback";
import type { PlanItem } from "./brain";

function item(overrides: any = {}): any {
  return {
    id: overrides.id ?? 1,
    planId: overrides.planId ?? 1,
    sequence: overrides.sequence ?? 0,
    slot: overrides.slot ?? "now",
    sourceType: overrides.sourceType ?? "task",
    sourceId: overrides.sourceId ?? 1,
    taskId: overrides.taskId ?? 1,
    title: overrides.title ?? "Task",
    whySelected: overrides.whySelected ?? "Because",
    doneWhen: overrides.doneWhen ?? "Done",
    status: overrides.status ?? "planned",
    plannedFor: overrides.plannedFor ?? "2026-06-01",
    startedAt: null,
    completedAt: null,
    skippedAt: null,
    movedAt: null,
    parkedAt: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function task(overrides: any = {}): any {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Task",
    list: "today",
    done: false,
    category: "admin",
    size: "medium",
    status: "not_started",
    skipped: 0,
    steps: "[]",
    deadline: "",
    doneWhen: "",
    sourceType: "",
    sourceId: null,
    sourceUrl: "",
    sourceNote: "",
    sourceStatus: "",
    readiness: "ready",
    blockerReason: "",
    blockedBy: "",
    createdAt: Date.now(),
    ...overrides,
  };
}

function candidatePlan(taskId: number, overrides: any = {}): PlanItem {
  return {
    slot: "now",
    why: "original reason",
    isMVD: true,
    candidate: {
      source: "task",
      sourceId: taskId,
      taskId,
      title: overrides.title ?? "Original task",
      category: "admin",
      size: overrides.size ?? "medium",
      deadline: "",
      status: "not_started",
      skipped: overrides.skipped ?? 0,
      sourceUrl: "",
      sourceNote: "",
      sourceStatus: "",
      doneWhen: "Done",
      whyNow: "",
      fitScore: null,
      blocked: false,
      blockerReason: "",
      eligibilityRisk: "",
    },
  };
}

test("missed MVD is remembered and relabelled as carry-forward", () => {
  const memory = buildPlanningMemory({
    day: "2026-06-02",
    yesterdayMinimumViableItemId: 10,
    yesterdayItems: [item({ id: 10, sourceId: 1, taskId: 1, status: "planned" })],
    activity: [],
  });
  const out = applyPlanningFeedback([candidatePlan(1)], memory, [task({ id: 1 })]);
  assert.equal(memory.missedMvdKey, "task:1");
  assert.match(out[0].why, /Carry-forward from yesterday/);
});

test("blocked today task becomes an unblock plan item", () => {
  const memory = buildPlanningMemory({ day: "2026-06-02", yesterdayItems: [], activity: [] });
  const out = applyPlanningFeedback([candidatePlan(2)], memory, [
    task({ id: 1, title: "Blocked item", readiness: "blocked", blockerReason: "Need one input" }),
    task({ id: 2, title: "Other item" }),
  ]);
  assert.match(out[0].candidate.title, /^Unblock:/);
  assert.match(out[0].why, /Blocked item/);
});

test("repeatedly skipped task is reframed as shrink or decide", () => {
  const memory = buildPlanningMemory({ day: "2026-06-02", yesterdayItems: [], activity: [] });
  const out = applyPlanningFeedback([candidatePlan(1, { skipped: 2, title: "Large task" })], memory, [task({ id: 1 })]);
  assert.match(out[0].candidate.title, /^Shrink or decide:/);
  assert.match(out[0].why, /slipped before/);
});

test("prependStep makes the unstick action the first incomplete step", () => {
  const raw = JSON.stringify([{ text: "Existing step", done: false }]);
  const updated = JSON.parse(prependStep(raw, "Tiny start"));
  assert.equal(updated[0].text, "Tiny start");
  assert.equal(updated[0].done, false);
  assert.equal(updated[1].text, "Existing step");
});

test("deterministic unstick step handles blocked and deep tasks", () => {
  assert.match(deterministicUnstickStep(task({ readiness: "blocked", blockerReason: "Need input" })), /missing|Need input/i);
  assert.match(deterministicUnstickStep(task({ size: "deep" })), /rough sentence|blank page/i);
});
