import assert from "node:assert/strict";
import test from "node:test";
import type { CoverageModel } from "./trackResearchCoverageModel";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import { activateExecutionSlice } from "./trackResearchExecutionMaterialization";
import {
  blueprintTaskIdFromLiveTask,
  emptyExecutionActivationState,
  type ExecutionPriorityModel,
} from "./trackResearchExecutionPriority";
import type { RequirementModel } from "./trackResearchRequirementModel";
import { initStorage, storage } from "./storage";

initStorage(":memory:");

function blueprintTask(id: string, trackSuffix: string): TaskBlueprint {
  return {
    id,
    key: `workstream:${trackSuffix}:${id}`,
    workstreamId: `workstream-${trackSuffix}`,
    moduleId: `module-${trackSuffix}`,
    moduleTitle: `Module ${trackSuffix}`,
    milestoneIds: [`milestone-${trackSuffix}`],
    requirementIds: [`requirement-${trackSuffix}`],
    sequence: 1,
    title: `Complete user action ${trackSuffix}`,
    kind: "practice",
    owner: "user",
    why: "This produces evidence.",
    doneWhen: "The practice output meets the success bar.",
    minimumOutcome: "One complete attempt exists.",
    expectedEvidence: `Evidence ${trackSuffix}`,
    effort: "medium",
    readiness: "ready",
    readinessReason: "No blueprint dependency prevents this task from starting.",
    dependsOnTaskIds: [],
    subtasks: [{
      id: `subtask-${trackSuffix}`,
      title: `Complete the practice ${trackSuffix}`,
      executor: "user_learning",
      condition: "always",
      outputSpec: `Practice output ${trackSuffix}`,
      doneWhen: "The attempt is complete.",
      dependsOnSubtaskIds: [],
    }],
    materialization: {
      state: "blueprint_only",
      taskDraft: {
        category: "learning",
        size: "medium",
        doneWhen: "The practice output meets the success bar.",
        minimumOutcome: "One complete attempt exists.",
        sourceType: "career_track",
        sourceStepType: "execution_blueprint_task",
      },
    },
  };
}

function blueprint(tasks: TaskBlueprint[]): ExecutionBlueprintModel {
  return {
    mode: "execution_blueprint_model",
    version: 1,
    targetLabel: "Target",
    developmentPlanVersion: 1,
    developmentPlanFingerprint: "development",
    sourceFingerprint: `blueprint-${tasks.map((task) => task.id).join("-")}`,
    objective: "Blueprint",
    principles: [],
    workstreams: [{
      workstreamId: tasks[0]?.workstreamId || "workstream",
      title: "Workstream",
      objective: "Objective",
      taskIds: tasks.map((task) => task.id),
      moduleIds: [...new Set(tasks.map((task) => task.moduleId))],
      milestoneIds: [...new Set(tasks.flatMap((task) => task.milestoneIds))],
      completionTaskId: tasks[tasks.length - 1]?.id || null,
    }],
    tasks,
    summary: {
      workstreamCount: 1,
      moduleCount: 1,
      milestoneCount: 1,
      taskCount: tasks.length,
      subtaskCount: tasks.reduce((sum, task) => sum + task.subtasks.length, 0),
      anchorOwnedTaskCount: 0,
      userOwnedTaskCount: tasks.length,
      sharedTaskCount: 0,
      conditionalTaskCount: 0,
    },
    quality: {
      status: "complete",
      moduleCoverageRate: 100,
      milestoneCoverageRate: 100,
      requirementCoverageRate: 100,
      orphanModuleIds: [],
      orphanMilestoneIds: [],
      orphanRequirementIds: [],
      duplicateTaskKeys: [],
      invalidDependencyIds: [],
      cyclicTaskIds: [],
      oversizedTaskIds: [],
      caveats: [],
    },
    materializationStatus: "blueprint_only",
    generatedAt: 1,
  };
}

function priority(trackId: number, blueprintModel: ExecutionBlueprintModel): ExecutionPriorityModel {
  return {
    mode: "execution_priority_model",
    version: 1,
    trackId,
    targetLabel: "Target",
    executionBlueprintVersion: 1,
    executionBlueprintFingerprint: blueprintModel.sourceFingerprint,
    contextFingerprint: "context",
    sourceFingerprint: "priority",
    objective: "Activate a small slice.",
    policy: {
      maxSelectedTasks: 5,
      maxUserVisibleTasks: 3,
      maxAnchorAutomationsPerActivation: 2,
      conditionalTasksActivateAutomatically: false,
      prioritiesCreated: true,
      scheduleCreated: false,
    },
    activeSlice: blueprintModel.tasks.map((task, index) => ({
      rank: index + 1,
      slot: index === 0 ? "now" : "next",
      blueprintTaskId: task.id,
      liveTaskId: null,
      action: "materialize_user_task",
      score: 100 - index,
      reason: "Highest-value ready work.",
      title: task.title,
      owner: task.owner,
      effort: task.effort,
      expectedEvidence: task.expectedEvidence,
      workstreamId: task.workstreamId,
      moduleId: task.moduleId,
    })),
    scorecards: [],
    completedBlueprintTaskIds: [],
    materializedBlueprintTaskIds: [],
    parkedBlueprintTaskIds: [],
    conditionalBlueprintTaskIds: [],
    summary: {
      totalBlueprintTasks: blueprintModel.tasks.length,
      completedTasks: 0,
      activeLiveTasks: 0,
      eligibleTasks: blueprintModel.tasks.length,
      blockedTasks: 0,
      conditionalTasks: 0,
      selectedTasks: blueprintModel.tasks.length,
      selectedUserVisibleTasks: blueprintModel.tasks.length,
      selectedAnchorTasks: 0,
    },
    quality: {
      status: "complete",
      selectedBlockedTaskIds: [],
      selectedConditionalTaskIds: [],
      duplicateSelectedTaskIds: [],
      userTaskLimitExceeded: false,
      caveats: [],
    },
    generatedAt: 1,
  };
}

function requirementModel(): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements",
    sourceResearchAt: 1,
    target: { label: "Target", definition: "Target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [],
    requirements: [],
    evidenceClaims: [],
    researchQuality: { status: "strong", sourceCount: 1, directSourceCount: 1, sourceTypeCount: 1, requirementEvidenceCoverage: 100, directRequirementCoverage: 100, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function coverageModel(): CoverageModel {
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Target",
    requirementModelVersion: 2,
    requirementModelFingerprint: "requirements",
    userEvidenceFingerprint: "evidence",
    coverage: [],
    evidenceItems: [],
    sourceInventory: { cv: 0, profile_summary: 0, win: 0, learning_output: 0, completed_learning: 0, proof_asset: 0, relationship: 0, interaction: 0 },
    groups: [],
    quality: { status: "strong", assessedRequirementCount: 0, unknownRequirementCount: 0, citedEvidenceCount: 0, directEvidenceCount: 0, assessmentCoverage: 100, caveats: [] },
    generatedAt: 1,
  };
}

function developmentPlan(): DevelopmentPlanModel {
  return {
    mode: "development_plan_model",
    version: 1,
    targetLabel: "Target",
    requirementModelFingerprint: "requirements",
    coverageFingerprint: "coverage",
    sourceContextFingerprint: "context",
    planSummary: "Plan",
    decisions: [],
    workstreams: [],
    maintenanceRequirementIds: [],
    quality: { status: "strong", coreRequirementCount: 0, coveredCoreRequirementCount: 0, plannedRequirementCount: 0, maintenanceRequirementCount: 0, conditionalRequirementCount: 0, enhancementRequirementCount: 0, unassignedRequirementIds: [], caveats: [] },
    generatedAt: 1,
  };
}

test("activation creates at most three live user tasks and places only the first in Today", async () => {
  const trackId = 51;
  const tasks = [1, 2, 3, 4].map((index) => blueprintTask(`blueprint-${trackId}-${index}`, `${trackId}-${index}`));
  const blueprintModel = blueprint(tasks);
  const result = await activateExecutionSlice(
    trackId,
    blueprintModel,
    priority(trackId, blueprintModel),
    requirementModel(),
    coverageModel(),
    developmentPlan(),
    emptyExecutionActivationState(blueprintModel.sourceFingerprint),
  );
  const liveTasks = (await storage.getTasks()).filter((task) => task.relatedTrackId === trackId);

  assert.equal(result.createdTaskIds.length, 3);
  assert.equal(liveTasks.length, 3);
  assert.equal(liveTasks.filter((task) => task.list === "today").length, 1);
  assert.ok(liveTasks.every((task) => task.steps.includes("Complete the practice")));
});

test("activation is idempotent for an already materialized blueprint task", async () => {
  const trackId = 52;
  const task = blueprintTask(`blueprint-${trackId}`, `${trackId}`);
  const blueprintModel = blueprint([task]);
  const priorityModel = priority(trackId, blueprintModel);
  const first = await activateExecutionSlice(
    trackId,
    blueprintModel,
    priorityModel,
    requirementModel(),
    coverageModel(),
    developmentPlan(),
    emptyExecutionActivationState(blueprintModel.sourceFingerprint),
  );
  const second = await activateExecutionSlice(
    trackId,
    blueprintModel,
    priorityModel,
    requirementModel(),
    coverageModel(),
    developmentPlan(),
    first.state,
  );
  const liveTasks = (await storage.getTasks()).filter((item) => blueprintTaskIdFromLiveTask(item) === task.id);

  assert.equal(first.createdTaskIds.length, 1);
  assert.equal(second.createdTaskIds.length, 0);
  assert.equal(second.reusedTaskIds.length, 1);
  assert.equal(liveTasks.length, 1);
});
