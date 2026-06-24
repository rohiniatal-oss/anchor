import assert from "node:assert/strict";
import test from "node:test";
import type {
  DevelopmentModule,
  DevelopmentPlanModel,
  DevelopmentWorkstream,
} from "./trackResearchDevelopmentPlan";
import {
  buildExecutionBlueprintDraft,
  executionBlueprintSourceFingerprint,
} from "./trackResearchExecutionBlueprint";

function module(
  id: string,
  type: DevelopmentModule["type"],
  requirementIds: string[],
  scope: DevelopmentModule["scope"] = "core",
): DevelopmentModule {
  return {
    id,
    title: id.replace(/-/g, " "),
    type,
    scope,
    objective: `Develop ${id}`,
    requirementIds,
    resources: [],
    activities: [`Apply ${id} in a realistic context`],
    output: `Output for ${id}`,
    assessmentCriteria: requirementIds.map((requirementId) => `Success bar for ${requirementId}`),
  };
}

function workstream(
  id: string,
  modules: DevelopmentModule[],
  milestoneIds = ["milestone-1"],
): DevelopmentWorkstream {
  const requirementIds = [...new Set(modules.flatMap((item) => item.requirementIds))];
  return {
    id,
    title: id.replace(/-/g, " "),
    objective: `Objective for ${id}`,
    rationale: "Related modules belong together.",
    scopeMix: [...new Set(modules.map((item) => item.scope))],
    requirementIds,
    methods: [],
    modules,
    milestones: milestoneIds.map((milestoneId, index) => ({
      id: milestoneId,
      label: milestoneId.replace(/-/g, " "),
      sequence: index + 1,
      requirementIds,
      doneWhen: `Milestone standard ${index + 1}`,
      evidenceCreated: `Milestone evidence ${index + 1}`,
    })),
    dependencyNotes: [],
    completionStandard: "Every linked requirement is evidenced.",
  };
}

function plan(workstreams: DevelopmentWorkstream[]): DevelopmentPlanModel {
  const requirementIds = [...new Set(workstreams.flatMap((item) => item.requirementIds))];
  return {
    mode: "development_plan_model",
    version: 1,
    targetLabel: "Geopolitical strategy",
    requirementModelFingerprint: "requirement-fingerprint",
    coverageFingerprint: "coverage-fingerprint",
    sourceContextFingerprint: "context-fingerprint",
    planSummary: "Build and evidence the remaining requirements.",
    decisions: requirementIds.map((requirementId) => ({
      requirementId,
      coverageStatus: "unproven",
      action: "build",
      scope: "core",
      reason: "Not yet evidenced.",
      desiredEvidence: `Success bar for ${requirementId}`,
      evidenceStillNeeded: [`Evidence for ${requirementId}`],
    })),
    workstreams,
    maintenanceRequirementIds: [],
    quality: {
      status: "strong",
      coreRequirementCount: requirementIds.length,
      coveredCoreRequirementCount: requirementIds.length,
      plannedRequirementCount: requirementIds.length,
      maintenanceRequirementCount: 0,
      conditionalRequirementCount: 0,
      enhancementRequirementCount: 0,
      unassignedRequirementIds: [],
      caveats: [],
    },
    generatedAt: 1,
  };
}

test("every development module, milestone and requirement receives execution coverage", () => {
  const learning = module("module-learning", "syllabus", ["req-knowledge"]);
  const practice = module("module-practice", "practice", ["req-skill"]);
  const proof = module("module-proof", "proof", ["req-proof"]);
  const developmentPlan = plan([workstream("workstream-core", [learning, practice, proof], ["milestone-a", "milestone-b"])]);
  const blueprint = buildExecutionBlueprintDraft(developmentPlan);

  assert.equal(blueprint.quality.moduleCoverageRate, 100);
  assert.equal(blueprint.quality.milestoneCoverageRate, 100);
  assert.equal(blueprint.quality.requirementCoverageRate, 100);
  assert.deepEqual(blueprint.quality.orphanModuleIds, []);
  assert.deepEqual(blueprint.quality.orphanMilestoneIds, []);
  assert.deepEqual(blueprint.quality.orphanRequirementIds, []);
  assert.equal(blueprint.quality.status, "complete");
});

test("verification begins with Anchor and asks the user only when needed", () => {
  const verification = module("module-verification", "verification", ["req-unknown"]);
  const blueprint = buildExecutionBlueprintDraft(plan([workstream("workstream-verify", [verification])]))
  const task = blueprint.tasks[0];

  assert.equal(task.owner, "anchor");
  assert.equal(task.kind, "verification");
  assert.equal(task.readiness, "ready");
  const userInput = task.subtasks.find((subtask) => subtask.executor === "user_action");
  assert.ok(userInput);
  assert.equal(userInput?.condition, "if_needed");
});

test("role-specific modules remain conditional rather than entering the shared active flow", () => {
  const conditional = module("module-route", "practice", ["req-route"], "conditional");
  const blueprint = buildExecutionBlueprintDraft(plan([workstream("workstream-route", [conditional])]))

  assert.ok(blueprint.tasks.length > 0);
  assert.ok(blueprint.tasks.every((task) => task.readiness === "conditional"));
  assert.equal(blueprint.summary.conditionalTaskCount, blueprint.tasks.length);
});

test("proof work can depend on capability work without introducing a cycle", () => {
  const practice = module("module-practice", "practice", ["req-shared"]);
  const proof = module("module-proof", "proof", ["req-shared"]);
  const blueprint = buildExecutionBlueprintDraft(plan([workstream("workstream-proof", [practice, proof])]))
  const firstProofTask = blueprint.tasks.find((task) => task.moduleId === proof.id);
  const practiceTasks = blueprint.tasks.filter((task) => task.moduleId === practice.id);

  assert.ok(firstProofTask);
  assert.ok(practiceTasks.length > 0);
  assert.ok(firstProofTask?.dependsOnTaskIds.includes(practiceTasks[practiceTasks.length - 1].id));
  assert.deepEqual(blueprint.quality.cyclicTaskIds, []);
  assert.deepEqual(blueprint.quality.invalidDependencyIds, []);
});

test("each task is bounded and produces evidence", () => {
  const modules = [
    module("module-learning", "syllabus", ["req-knowledge"]),
    module("module-experience", "experience", ["req-experience"]),
    module("module-network", "relationships", ["req-network"]),
  ];
  const blueprint = buildExecutionBlueprintDraft(plan([workstream("workstream-mixed", modules)]));

  assert.ok(blueprint.tasks.every((task) => task.subtasks.length >= 1 && task.subtasks.length <= 5));
  assert.ok(blueprint.tasks.every((task) => task.doneWhen.length > 0));
  assert.ok(blueprint.tasks.every((task) => task.minimumOutcome.length > 0));
  assert.ok(blueprint.tasks.every((task) => task.expectedEvidence.length > 0));
  assert.deepEqual(blueprint.quality.oversizedTaskIds, []);
});

test("the model remains blueprint-only and creates no live tasks", () => {
  const proof = module("module-proof", "proof", ["req-proof"]);
  const blueprint = buildExecutionBlueprintDraft(plan([workstream("workstream-proof", [proof])]))

  assert.equal(blueprint.materializationStatus, "blueprint_only");
  assert.ok(blueprint.tasks.every((task) => task.materialization.state === "blueprint_only"));
  assert.ok(blueprint.tasks.every((task) => task.materialization.taskDraft.sourceStepType === "execution_blueprint_task"));
});

test("the source fingerprint changes when the development contract changes", () => {
  const firstPlan = plan([workstream("workstream-core", [module("module-learning", "syllabus", ["req-knowledge"])])]);
  const changedPlan = structuredClone(firstPlan);
  changedPlan.workstreams[0].modules[0].output = "A materially different applied output";

  assert.notEqual(
    executionBlueprintSourceFingerprint(firstPlan),
    executionBlueprintSourceFingerprint(changedPlan),
  );
});
