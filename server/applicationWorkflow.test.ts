import { test } from "node:test";
import assert from "node:assert/strict";
import { parentWorkflowFor } from "./taskBreakdownRoutes";

function jobBundle(source: any) {
  return { sourceContext: "", playbook: "", sourceKind: "job" as const, source, parentContext: "" };
}

test("already-submitted job moves to Follow up stage", () => {
  const ws = parentWorkflowFor(
    { title: "Follow up on the application", sourceId: 1 },
    jobBundle({ id: 1, status: "wishlist", applicationReadiness: "submitted" }),
  );
  assert.ok(ws);
  assert.equal(ws!.currentStage, "Follow up");
  assert.equal(ws!.stageOutput, "Follow-up action is sent or logged");
});

test("referral-secured job moves to Submit stage", () => {
  const ws = parentWorkflowFor(
    { title: "Submit the application", sourceId: 3 },
    jobBundle({ id: 3, status: "wishlist", applicationReadiness: "referral" }),
  );
  assert.ok(ws);
  assert.equal(ws!.currentStage, "Submit");
  assert.equal(ws!.stageOutput, "Application is submitted with required materials");
});

test("a job still drafting materials stays in Build materials", () => {
  const ws = parentWorkflowFor(
    { title: "Tailor the CV", sourceId: 2 },
    jobBundle({ id: 2, status: "wishlist", applicationReadiness: "cv" }),
  );
  assert.ok(ws);
  assert.equal(ws!.currentStage, "Build materials");
});
