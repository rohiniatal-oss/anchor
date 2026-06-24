import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@shared/schema";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import {
  buildExecutionOutcome,
  confirmExecutionOutcome,
  executionOutcomeEvidenceItem,
  executionOutcomeModelFingerprint,
  normalizeExecutionOutcomeModel,
} from "./trackResearchExecutionOutcome";

function blueprintTask(kind: TaskBlueprint["kind"] = "artifact", owner: TaskBlueprint["owner"] = "shared"): TaskBlueprint {
  return {
    id: `blueprint-${kind}`,
    key: `workstream:${kind}`,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    moduleTitle: "Build credible evidence",
    milestoneIds: ["milestone-1"],
    requirementIds: ["requirement-1"],
    sequence: 1,
    title: `Produce ${kind} evidence`,
    kind,
    owner,
    why: "The target requires inspectable evidence.",
    doneWhen: "A defensible result exists.",
    minimumOutcome: "A usable first result exists.",
    expectedEvidence: "An inspectable output that meets the requirement success bar.",
    effort: "medium",
    readiness: "ready",
    readinessReason: "No unmet prerequisite.",
    dependsOnTaskIds: [],
    subtasks: [{
      id: "subtask-1",
      title: "Create the output",
      executor: owner === "anchor" ? "system" : "user_learning",
      condition: "always",
      outputSpec: "Inspectable output",
      doneWhen: "The output exists.",
      dependsOnSubtaskIds: [],
    }],
    materialization: {
      state: "blueprint_only",
      taskDraft: {
        category: "learning",
        size: "medium",
        doneWhen: "A defensible result exists.",
        minimumOutcome: "A usable first result exists.",
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
    objective: "Build evidence",
    principles: [],
    workstreams: [],
    tasks: [task],
    summary: {
      workstreamCount: 1,
      moduleCount: 1,
      milestoneCount: 1,
      taskCount: 1,
      subtaskCount: 1,
      anchorOwnedTaskCount: task.owner === "anchor" ? 1 : 0,
      userOwnedTaskCount: task.owner === "user" ? 1 : 0,
      sharedTaskCount: task.owner === "shared" ? 1 : 0,
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

function liveTask(task: TaskBlueprint, overrides: Partial<Task> = {}): Task {
  return {
    id: 91,
    title: task.title,
    list: "inbox",
    block: null,
    done: true,
    pinned: false,
    steps: JSON.stringify([{ text: "Create the output", done: true, executor: "user_learning" }]),
    sort: 1,
    category: "learning",
    deadline: "",
    size: "medium",
    status: "done",
    skipped: 0,
    doneWhen: task.doneWhen,
    source: "anchor",
    sourceType: "career_track",
    sourceId: 7,
    sourceStepType: `execution_blueprint_task:${task.id}`,
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: "",
    sourceStatus: "active_slice",
    planItemId: null,
    relatedTrackId: 7,
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
    actualMinutes: 40,
    createdAt: 1,
    ...overrides,
  } as Task;
}

test("real-world and unlinked artifact outcomes require focused confirmation", () => {
  for (const kind of ["relationship", "access", "experience", "credential", "artifact"] as const) {
    const task = blueprintTask(kind);
    const outcome = buildExecutionOutcome(liveTask(task), task, blueprint(task), null, 10);
    assert.equal(outcome.state, "pending_confirmation", kind);
    assert.equal(outcome.usableForCoverage, false, kind);
    assert.equal(outcome.processingState, "not_ready", kind);
    assert.ok(outcome.confirmationQuestion.length > 0, kind);
  }
});

test("a linked learning output can enter the corpus conservatively without another form", () => {
  const task = blueprintTask("learning");
  const outcome = buildExecutionOutcome(
    liveTask(task, { sourceUrl: "https://example.com/learning-output" }),
    task,
    blueprint(task),
    null,
    10,
  );
  const evidence = executionOutcomeEvidenceItem(outcome);

  assert.equal(outcome.state, "accepted");
  assert.equal(outcome.processingState, "queued");
  assert.ok(evidence);
  assert.equal(evidence?.sourceType, "learning_output");
  assert.equal(evidence?.sourceUrl, "https://example.com/learning-output");
  assert.deepEqual(evidence?.trackIds, [7]);
});

test("confirmed direct evidence becomes coverage-eligible and traceable", () => {
  const task = blueprintTask("relationship");
  const pending = buildExecutionOutcome(liveTask(task), task, blueprint(task), null, 10);
  const confirmed = confirmExecutionOutcome(pending, {
    optionId: "evidence_created",
    note: "The conversation produced a referral to the relevant hiring team.",
  }, 20);
  const evidence = executionOutcomeEvidenceItem(confirmed);

  assert.equal(confirmed.state, "accepted");
  assert.equal(confirmed.strength, "direct");
  assert.equal(confirmed.usableForCoverage, true);
  assert.equal(confirmed.processingState, "queued");
  assert.ok(evidence?.detail.includes("referral"));
  assert.equal(evidence?.sourceEntityType, "execution_outcome");
  assert.equal(evidence?.sourceEntityId, 91);
});

test("partial signals stay supporting rather than becoming verified proof", () => {
  const task = blueprintTask("experience");
  const pending = buildExecutionOutcome(liveTask(task), task, blueprint(task), null, 10);
  const confirmed = confirmExecutionOutcome(pending, {
    optionId: "partial_signal",
    note: "The exercise produced useful feedback but not a final work sample.",
  }, 20);

  assert.equal(confirmed.state, "accepted");
  assert.equal(confirmed.strength, "supporting");
  assert.equal(confirmed.usableForCoverage, true);
  assert.equal(confirmed.processingState, "queued");
});

test("mistaken completion reopens the task and queues evidence removal", () => {
  const task = blueprintTask("artifact");
  const pending = buildExecutionOutcome(liveTask(task), task, blueprint(task), null, 10);
  const reopened = confirmExecutionOutcome(pending, { optionId: "not_completed" }, 20);

  assert.equal(reopened.state, "reopened");
  assert.equal(reopened.strength, "none");
  assert.equal(reopened.usableForCoverage, false);
  assert.equal(reopened.processingState, "queued");
  assert.equal(executionOutcomeEvidenceItem(reopened), null);
});

test("outcome fingerprints change when evidence decisions change", () => {
  const task = blueprintTask("relationship");
  const pending = buildExecutionOutcome(liveTask(task), task, blueprint(task), null, 10);
  const first = normalizeExecutionOutcomeModel({ outcomes: [pending] }, 7, "blueprint-fingerprint");
  const confirmed = confirmExecutionOutcome(pending, {
    optionId: "evidence_created",
    note: "A useful market signal was created.",
  }, 20);
  const second = normalizeExecutionOutcomeModel({ outcomes: [confirmed] }, 7, "blueprint-fingerprint");

  assert.notEqual(executionOutcomeModelFingerprint(first), executionOutcomeModelFingerprint(second));
});
