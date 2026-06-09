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

test("goal-source breakdown turns broad pursuit into concrete lane-filling steps", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");

  const task = {
    title: "Add or apply to one credible role in each plausible lane that still looks real",
    category: "job",
    sourceType: "goal",
    sourceId: 1,
    sourceNote: "Broad pursuit is active across all plausible lanes.",
    doneWhen: "One concrete role or application move exists in each active lane",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { workflowState, steps } = await buildDeterministicTaskBreakdown(task);

  assert.equal(workflowState.workObject, "Pipeline");
  assert.match(workflowState.currentStage, /Define target|Build list|Execute next batch/);
  assert.ok(steps.length >= 1);
  assert.match(String(steps[0]?.text || ""), /open jobs|save the first credible role|saved role|pipeline action/i);
});

test("goal-source breakdown sharpens the first role-search move for a specific missing combination", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");

  const task = {
    title: "Add or apply to one credible role in each still-empty combination: Geopolitics / geopolitical advisory x Strategy / advisory",
    category: "job",
    sourceType: "goal",
    sourceId: 1,
    sourceNote: "Broad pursuit is active. Missing combinations: Geopolitics / geopolitical advisory x Strategy / advisory.",
    doneWhen: "One concrete role or application move exists in each still-empty combination",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { steps } = await buildDeterministicTaskBreakdown(task);

  assert.ok(steps.length >= 1);
  assert.match(steps.map((step) => String(step.text || "")).join(" | "), /geopolitical advisory|regional or policy scope/i);
});
