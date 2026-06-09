import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("coerceTaskBreakdownSteps turns workflow/meta steps into tiny actionable task steps", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { coerceTaskBreakdownSteps } = await import("./taskBreakdownRoutes");

  const task = {
    title: "Tailor CV for policy role",
    category: "job",
    doneWhen: "The CV is tailored to the role",
    minimumOutcome: "",
    sourceUrl: "https://example.com/role",
  } as any;
  const bundle = {
    sourceKind: "job",
    sourceContext: "This is a JOB / OPPORTUNITY item. Role: Policy role at Org.",
    playbook: "",
    source: null,
    parentContext: "",
  } as any;
  const workflowState = {
    workObject: "Artifact",
    workflow: ["Understand role", "Map evidence", "Build materials"],
    workflowKind: "finite",
    currentStage: "Build materials",
    stageOutput: "The next application material is drafted or improved",
    completionCriteria: ["A first tailored version exists"],
    advanceCondition: "Advance when the first tailored version exists.",
  } as any;

  const steps = coerceTaskBreakdownSteps(task, bundle, workflowState, [
    { text: "Locate the current stage", done: false },
    { text: "Define this stage output", done: false },
    { text: "Break this stage into actions", done: false, substeps: ["Rewrite the first matching bullet", "Save the next bullet to update later"] },
  ] as any);

  assert.equal(steps[0].text, "Open your CV and the role posting side by side");
  assert.equal(steps.length <= 4, true);
  assert.ok(steps.every((step) => !/use the|locate the|define this stage output|check completion criteria|break this stage into actions/i.test(step.text)));
});
