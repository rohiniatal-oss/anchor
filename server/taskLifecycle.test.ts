import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleTransition } from "./taskLifecycle";

test("task lifecycle detects completion once", () => {
  assert.equal(
    lifecycleTransition({ done: false, status: "in_progress" } as any, { done: true, status: "done" } as any),
    "completed",
  );
  assert.equal(
    lifecycleTransition({ done: true, status: "done" } as any, { done: true, status: "done" } as any),
    null,
  );
});

test("task lifecycle detects reopening", () => {
  assert.equal(
    lifecycleTransition({ done: true, status: "done" } as any, { done: false, status: "not_started" } as any),
    "reopened",
  );
});

test("unrelated task edits create no lifecycle event", () => {
  assert.equal(
    lifecycleTransition({ done: false, status: "not_started" } as any, { done: false, status: "in_progress" } as any),
    null,
  );
});
