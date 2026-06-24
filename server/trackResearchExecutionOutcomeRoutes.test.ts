import assert from "node:assert/strict";
import test from "node:test";
import { executionOutcomeRouteInternals } from "./trackResearchExecutionOutcomeRoutes";

test("task lifecycle observer recognizes generic task updates", () => {
  assert.equal(executionOutcomeRouteInternals.taskMutationId("/api/tasks/42", "PATCH"), 42);
  assert.equal(executionOutcomeRouteInternals.taskMutationId("/api/tasks/42", "PUT"), 42);
});

test("task lifecycle observer recognizes the dedicated completion route", () => {
  assert.equal(executionOutcomeRouteInternals.taskMutationId("/api/tasks/42/complete", "POST"), 42);
});

test("unrelated task actions are ignored", () => {
  assert.equal(executionOutcomeRouteInternals.taskMutationId("/api/tasks/42/skip", "POST"), null);
  assert.equal(executionOutcomeRouteInternals.taskMutationId("/api/tasks", "POST"), null);
  assert.equal(executionOutcomeRouteInternals.taskMutationId("/api/tasks/42", "GET"), null);
});
