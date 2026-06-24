import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@shared/schema";
import {
  emitTaskLifecycleTransition,
  registerTaskLifecycleListener,
  resetTaskLifecycleForTests,
  taskLifecycleInternals,
} from "./taskLifecycle";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Task",
    list: "this_week",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 1,
    category: "admin",
    deadline: "",
    size: "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: "Done",
    source: "anchor",
    sourceType: "career_track",
    sourceId: 7,
    sourceStepType: "execution_blueprint_task:task-1",
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: "",
    sourceStatus: "active_slice",
    planItemId: null,
    relatedTrackId: 7,
    relatedOpportunityId: null,
    parentTaskId: null,
    dependsOn: "[]",
    blocks: "[]",
    blockedBy: "",
    blockerReason: "",
    readiness: "ready",
    minimumOutcome: "Minimum",
    stretchOutcome: "Evidence",
    estimateMinutes: 45,
    estimateConfidence: "high",
    estimateReason: "Blueprint",
    actualMinutes: null,
    createdAt: 1,
    ...overrides,
  };
}

test("completion emits exactly one completed transition", async () => {
  resetTaskLifecycleForTests();
  const events: string[] = [];
  const unregister = registerTaskLifecycleListener((event) => events.push(event.type));

  await emitTaskLifecycleTransition(task(), task({ done: true, status: "done" }));
  await emitTaskLifecycleTransition(task({ done: true, status: "done" }), task({ done: true, status: "done" }));

  unregister();
  assert.deepEqual(events, ["completed"]);
});

test("reopening emits a reopened transition", async () => {
  resetTaskLifecycleForTests();
  const events: string[] = [];
  registerTaskLifecycleListener((event) => events.push(event.type));

  await emitTaskLifecycleTransition(task({ done: true, status: "done" }), task({ done: false, status: "not_started" }));

  assert.deepEqual(events, ["reopened"]);
});

test("done boolean and done status are treated as the same completion state", () => {
  assert.equal(taskLifecycleInternals.completed(task({ done: true, status: "not_started" })), true);
  assert.equal(taskLifecycleInternals.completed(task({ done: false, status: "done" })), true);
  assert.equal(taskLifecycleInternals.completed(task({ done: false, status: "in_progress" })), false);
});
