import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@shared/schema";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import {
  buildExecutionOutcomeRecord,
  emptyExecutionOutcomeModel,
  reopenExecutionOutcome,
  upsertExecutionOutcome,
} from "./trackResearchExecutionOutcome";

function blueprintTask(kind: TaskBlueprint["kind"]): TaskBlueprint {
  return {
    id: `task-${kind}`,
    key: `workstream:module:${kind}`,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    moduleTitle: "Module",
    milestoneIds: ["milestone-1"],
    requirementIds: ["requirement-1"],
    sequence: 1,
    title: `${kind} task`,
    kind,
    owner: "shared",
    why: "Creates evidence",
    doneWhen: "The expected evidence exists.",
    minimumOutcome: "A useful first result exists.",
    expectedEvidence: `${kind} evidence`,
    effort: "medium",
    readiness: "ready",
    readinessReason: "Ready",
    dependsOnTaskIds: [],
    subtasks: [{
      id: `subtask-${kind}`,
      title: "Complete the substantive work",
      executor: kind === "research" || kind === "verification" ? "system" : "user_learning",
      condition: "always",
      outputSpec: "A usable result",
      doneWhen: "The result exists.",
      dependsOnSubtaskIds: [],
    }],
    materialization: {
      state: "blueprint_only",
      taskDraft: {
        category: "learning",
        size: "medium",
        doneWhen: "The expected evidence exists.",
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
    sourceFingerprint: "blueprint",
    objective: "Execute",
    principles: [],
    workstreams: [],
    tasks: [task],
    summary: { workstreamCount: 1, moduleCount: 1, milestoneCount: 1, taskCount: 1, subtaskCount: 1, anchorOwnedTaskCount: 0, userOwnedTaskCount: 0, sharedTaskCount: 1, conditionalTaskCount: 0 },
    quality: { status: "complete", moduleCoverageRate: 100, milestoneCoverageRate: 100, requirementCoverageRate: 100, orphanModuleIds: [], orphanMilestoneIds: [], orphanRequirementIds: [], duplicateTaskKeys: [], invalidDependencyIds: [], cyclicTaskIds: [], oversizedTaskIds: [], caveats: [] },
    materializationStatus: "blueprint_only",
    generatedAt: 1,
  };
}

function task(blueprintTask: TaskBlueprint, overrides: Partial<Task> = {}): Task {
  return {
    id: 9,
    title: blueprintTask.title,
    list: "this_week",
    block: null,
    done: true,
    pinned: false,
    steps: JSON.stringify([{ text: "Complete the substantive work", done: true, blueprintSubtaskId: blueprintTask.subtasks[0].id }]),
    sort: 1,
    category: "learning",
    deadline: "",
    size: "medium",
    status: "done",
    skipped: 0,
    doneWhen: blueprintTask.doneWhen,
    source: "anchor",
    sourceType: "career_track",
    sourceId: 1,
    sourceStepType: `execution_blueprint_task:${blueprintTask.id}`,
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
    minimumOutcome: blueprintTask.minimumOutcome,
    stretchOutcome: blueprintTask.expectedEvidence,
    estimateMinutes: 45,
    estimateConfidence: "high",
    estimateReason: "Blueprint",
    actualMinutes: null,
    createdAt: 1,
    ...overrides,
  };
}

function build(kind: TaskBlueprint["kind"], overrides: Partial<Task> = {}) {
  const blueprintTaskValue = blueprintTask(kind);
  return buildExecutionOutcomeRecord({
    trackId: 1,
    task: task(blueprintTaskValue, overrides),
    blueprint: blueprint(blueprintTaskValue),
    blueprintTask: blueprintTaskValue,
  });
}

test("applied learning completion becomes conservative supporting evidence", () => {
  const record = build("learning");
  assert.equal(record.status, "accepted");
  assert.equal(record.usableForCoverage, true);
  assert.equal(record.strength, "supporting");
});

test("artifact completion without an inspectable output requires confirmation", () => {
  const record = build("artifact");
  assert.equal(record.status, "pending_confirmation");
  assert.equal(record.usableForCoverage, false);
  assert.equal(record.confirmation.kind, "url_or_text");
});

test("inspectable artifact output becomes verified evidence", () => {
  const record = build("artifact", { sourceUrl: "https://example.com/artifact" });
  assert.equal(record.status, "accepted");
  assert.equal(record.strength, "verified");
});

test("relationship and access completion require a real signal", () => {
  assert.equal(build("relationship").status, "pending_confirmation");
  assert.equal(build("access").status, "pending_confirmation");
});

test("research and verification remain operational rather than capability proof", () => {
  assert.equal(build("research").status, "operational_only");
  assert.equal(build("verification").usableForCoverage, false);
});

test("upsert is idempotent by live task and reopening withdraws evidence", () => {
  const record = build("learning");
  let model = upsertExecutionOutcome(emptyExecutionOutcomeModel(1), record);
  model = upsertExecutionOutcome(model, { ...record, updatedAt: record.updatedAt + 1 });
  assert.equal(model.records.length, 1);

  const reopened = reopenExecutionOutcome(model, record.liveTaskId);
  assert.equal(reopened.records[0]?.status, "reopened");
  assert.equal(reopened.records[0]?.usableForCoverage, false);
});
