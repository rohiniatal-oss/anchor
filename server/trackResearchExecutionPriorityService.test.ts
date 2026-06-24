import assert from "node:assert/strict";
import test from "node:test";
import { executionPriorityMatchesExpectedFingerprint } from "./trackResearchExecutionPriorityService";

test("materialization accepts the exact displayed priority fingerprint", () => {
  const model = { sourceFingerprint: "slice-current" } as any;
  assert.equal(executionPriorityMatchesExpectedFingerprint(model, "slice-current"), true);
});

test("materialization rejects a stale displayed priority fingerprint", () => {
  const model = { sourceFingerprint: "slice-current" } as any;
  assert.equal(executionPriorityMatchesExpectedFingerprint(model, "slice-old"), false);
});

test("automatic activation may deliberately use the current server slice", () => {
  const model = { sourceFingerprint: "slice-current" } as any;
  assert.equal(executionPriorityMatchesExpectedFingerprint(model, undefined), true);
  assert.equal(executionPriorityMatchesExpectedFingerprint(model, ""), true);
});
