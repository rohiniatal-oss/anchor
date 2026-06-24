import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@shared/schema";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import { sourceStepTypeForBlueprintTask } from "./trackResearchExecutionPriority";
import { emptyExecutionOutcomeModel } from "./trackResearchExecutionOutcome";
import { executionOutcomeServiceInternals } from "./trackResearchExecutionOutcomeService";

function blueprintTask(
  id: string,
  kind: TaskBlueprint["kind"],
  owner: TaskBlueprint["owner"] = "shared",
): TaskBlueprint {
  return {
    id,
    key: `workstream:module:${id}`,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    moduleTitle: "Module",
    milestoneIds: ["milestone-1"],
    requirementIds: ["requirement-1"],
    sequence: 1,
    title: `Complete ${id}`,
    kind,
    owner,
    why: "Creates evidence",
    doneWhen: "The target success bar is met.",
    minimumOutcome: "A useful first result exists.",
    expectedEvidence: `Evidence for ${id}`,
    effort: "medium",
    readiness: "ready",
    readinessReason: "Ready",
    dependsOnTaskIds: [],
    subtasks: [{
      id: `subtask-${id}`,
      title: "Complete the applied work",
      executor: kind === "learning" || kind === "practice" ? "user_learning" : "user_action",
      condition: "always",
      outputSpec: `Output for ${id}`,
      doneWhen: "The output exists.",
      dependsOnSubtaskIds: [],
    }],
    materialization: {
      state: "blueprint_only",
      taskDraft: {
        category: "learning",
        size: "medium",
        doneWhen: "The target success bar is met.",
        minimumOutcome: "A useful first result exists.",
        sourceType: "career_track",
        sourceStepType: "execution_blueprint_task",
      },
    },
  };
}

function blueprint(task: TaskBlueprint): ExecutionBlueprintModel {
  return {
    mode: "execution_blueprint_model",
    version: 1,
    targetLabel: "Target",
    developmentPlanVersion: 1,
    developmentPlanFingerprint: "development",
    sourceFingerprint: "blueprint-fingerprint",
    objective: "Execute",
    principles: [],
    workstreams: [{
      workstreamId: task.workstreamId,
      title: "Workstream",
      objective: "Objective",
      taskIds: [task.id],
      moduleIds: [task.moduleId],
      milestoneIds: task.milestoneIds,
      completionTaskId: task.id,
    }],
    tasks: [task],
    summary: {
      workstreamCount: 1,
      moduleCount: 1,
      milestoneCount: 1,
      taskCount: 1,
      subtaskCount: 1,
      anchorOwnedTaskCount: ownerCount(task, "anchor"),
      userOwnedTaskCount: ownerCount(task, "user"),
      sharedTaskCount: ownerCount(task, "shared"),
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

function ownerCount(task: TaskBlueprint, owner: TaskBlueprint["owner"]): number {
  return task.owner === owner ? 1 : 0;
}

function liveTask(task: TaskBlueprint, overrides: Partial<Task> = {}): Task {
  return {
    id: 101,
    title: task.title,
    list: "this_week",
    block: null,
    done: true,
    pinned: false,
    steps: JSON.stringify(task.subtasks.map((subtask) => ({
      text: subtask.title,
      done: true,
      blueprintSubtaskId: subtask.id,
    }))),
    sort: 1,
    category: "learning",
    deadline: "",
    size: "medium",
    status: "done",
    skipped: 0,
    doneWhen: task.doneWhen,
    source: "anchor",
    sourceType: "career_track",
    sourceId: 1,
    sourceStepType: sourceStepTypeForBlueprintTask(task.id),
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: "",
    sourceStatus: "active_slice",
    planItemId: null,
    relatedTrackId: 1,
    relatedOpportunityId: null,
    parentTaskId: null,
    dependsOn: "[]",
    blocks: "[]",
    blockedBy: "",
    blockerReason: "",
    readiness: "ready",
    minimumOutcome: task.minimumOutcome,
    stretchOutcome: task.expectedEvidence,
    estimateMinutes: 45,
    estimateConfidence: "high",
    estimateReason: "Blueprint",
    actualMinutes: null,
    createdAt: 1,
    ...overrides,
  };
}

test("applied learning completion creates accepted supporting evidence", () => {
  const task = blueprintTask("learning", "learning", "user");
  const result = executionOutcomeServiceInternals.reconcileCompletedTasks({
    trackId: 1,
    blueprint: blueprint(task),
    tasks: [liveTask(task)],
    model: emptyExecutionOutcomeModel(1),
  });

  assert.equal(result.changedOutcomeCount, 1);
  assert.deepEqual(result.affectedRequirementIds, ["requirement-1"]);
  assert.equal(result.model.records[0]?.status, "accepted");
  assert.equal(result.model.records[0]?.strength, "supporting");
});

test("artifact completion without an output remains pending and does not refresh coverage", () => {
  const task = blueprintTask("artifact", "artifact");
  const result = executionOutcomeServiceInternals.reconcileCompletedTasks({
    trackId: 1,
    blueprint: blueprint(task),
    tasks: [liveTask(task)],
    model: emptyExecutionOutcomeModel(1),
  });

  assert.equal(result.changedOutcomeCount, 1);
  assert.deepEqual(result.affectedRequirementIds, []);
  assert.equal(result.model.records[0]?.status, "pending_confirmation");
  assert.equal(result.model.records[0]?.usableForCoverage, false);
});

test("repeated scans are idempotent", () => {
  const task = blueprintTask("learning", "learning", "user");
  const first = executionOutcomeServiceInternals.reconcileCompletedTasks({
    trackId: 1,
    blueprint: blueprint(task),
    tasks: [liveTask(task)],
    model: emptyExecutionOutcomeModel(1),
  });
  const second = executionOutcomeServiceInternals.reconcileCompletedTasks({
    trackId: 1,
    blueprint: blueprint(task),
    tasks: [liveTask(task)],
    model: first.model,
  });

  assert.equal(second.changedOutcomeCount, 0);
  assert.deepEqual(second.affectedRequirementIds, []);
  assert.equal(second.model.records.length, 1);
});

test("reopening a task withdraws accepted evidence", () => {
  const task = blueprintTask("learning", "learning", "user");
  const first = executionOutcomeServiceInternals.reconcileCompletedTasks({
    trackId: 1,
    blueprint: blueprint(task),
    tasks: [liveTask(task)],
    model: emptyExecutionOutcomeModel(1),
  });
  const reopened = executionOutcomeServiceInternals.reconcileCompletedTasks({
    trackId: 1,
    blueprint: blueprint(task),
    tasks: [liveTask(task, { done: false, status: "not_started" })],
    model: first.model,
  });

  assert.equal(reopened.model.records[0]?.status, "reopened");
  assert.equal(reopened.model.records[0]?.usableForCoverage, false);
  assert.deepEqual(reopened.affectedRequirementIds, ["requirement-1"]);
});

test("a matching blueprint task from another track is ignored", () => {
  const task = blueprintTask("learning", "learning", "user");
  const result = executionOutcomeServiceInternals.reconcileCompletedTasks({
    trackId: 1,
    blueprint: blueprint(task),
    tasks: [liveTask(task, { relatedTrackId: 2, sourceId: 2 })],
    model: emptyExecutionOutcomeModel(1),
  });

  assert.equal(result.scannedTaskCount, 0);
  assert.equal(result.model.records.length, 0);
});
