import { test } from "node:test";
import assert from "node:assert/strict";
import { parentWorkflowFor } from "./taskBreakdownRoutes";

function jobBundle(source: any) {
  return { sourceContext: "", playbook: "", sourceKind: "job" as const, source, parentContext: "" };
}

test("ready-to-submit job reaches the Submit stage", () => {
  const ws = parentWorkflowFor(
    { title: "Send the application", sourceId: 1 },
    jobBundle({ id: 1, status: "wishlist", applicationReadiness: "submitted" }),
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
