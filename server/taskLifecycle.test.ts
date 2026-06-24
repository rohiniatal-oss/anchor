import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@shared/schema";
import {
  emitTaskLifecycleTransition,
  registerTaskLifecycleListener,
  taskLifecycleInternals,
} from "./taskLifecycle";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Complete evidence task",
    list: "inbox",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: "learning",
    deadline: "",
    size: "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: "Evidence exists",
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
    minimumOutcome: "A first result exists",
    stretchOutcome: "Inspectable evidence",
    estimateMinutes: 45,
    estimateConfidence: "high",
    estimateReason: "Blueprint",
    actualMinutes: null,
    createdAt: 1,
    ...overrides,
  } as Task;
}

test("completion and reopen transitions emit exactly once", async () => {
  const events: string[] = [];
  const dispose = registerTaskLifecycleListener((event) => {
    events.push(event.type);
  });
  try {
    const open = task();
    const done = task({ done: true, status: "done" });
    await emitTaskLifecycleTransition(open, done);
    await emitTaskLifecycleTransition(done, done);
    await emitTaskLifecycleTransition(done, open);
    await emitTaskLifecycleTransition(open, open);
    assert.deepEqual(events, ["completed", "reopened"]);
  } finally {
    dispose();
  }
});

test("listener failure does not prevent other lifecycle listeners", async () => {
  let observed = false;
  const disposeFailing = registerTaskLifecycleListener(() => {
    throw new Error("expected test failure");
  });
  const disposeObserving = registerTaskLifecycleListener(() => {
    observed = true;
  });
  try {
    await emitTaskLifecycleTransition(task(), task({ done: true, status: "done" }));
    assert.equal(observed, true);
  } finally {
    disposeFailing();
    disposeObserving();
  }
});

test("middleware route matching is limited to task mutation routes", () => {
  assert.equal(taskLifecycleInternals.taskIdFromRequest("PATCH", "/api/tasks/42"), 42);
  assert.equal(taskLifecycleInternals.taskIdFromRequest("POST", "/api/tasks/42/complete"), 42);
  assert.equal(taskLifecycleInternals.taskIdFromRequest("GET", "/api/tasks/42"), null);
  assert.equal(taskLifecycleInternals.taskIdFromRequest("POST", "/api/tasks/42/skip"), null);
});
