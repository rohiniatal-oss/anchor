import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@shared/schema";
import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import {
  buildCoverageDelta,
  buildMilestoneProgressModel,
  confirmExecutionOutcome,
  executionOutcomeModel,
  inferExecutionOutcome,
  supersedeExecutionOutcome,
} from "./trackResearchExecutionOutcome";

function taskBlueprint(
  id: string,
  kind: TaskBlueprint["kind"],
  owner: TaskBlueprint["owner"] = "shared",
): TaskBlueprint {
  return {
    id,
    key: `workstream:${id}`,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    moduleTitle: "Module",
    milestoneIds: ["milestone-1"],
    requirementIds: ["requirement-1"],
    sequence: 1,
    title: `Complete ${id}`,
    kind,
    owner,
    why: "Create evidence",
    doneWhen: "The output meets the target success bar.",
    minimumOutcome: "A complete first attempt exists.",
    expectedEvidence: `Inspectable evidence for ${id}`,
    effort: "medium",
    readiness: "ready",
    readinessReason: "Ready",
    dependsOnTaskIds: [],
    subtasks: [
      {
        id: `subtask-${id}-system`,
        title: "Prepare the structure",
        executor: "system",
        condition: "always",
        outputSpec: "A prepared structure",
        doneWhen: "The structure exists",
        dependsOnSubtaskIds: [],
      },
      {
        id: `subtask-${id}-user`,
        title: "Complete the substantive work",
        executor: "user_learning",
        condition: "always",
        outputSpec: "A substantive output",
        doneWhen: "The work is complete",
        dependsOnSubtaskIds: [`subtask-${id}-system`],
      },
    ],
    materialization: {
      state: "blueprint_only",
      taskDraft: {
        category: "hustle",
        size: "medium",
        doneWhen: "The output meets the target success bar.",
        minimumOutcome: "A complete first attempt exists.",
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
      milestoneIds: ["milestone-1"],
      completionTaskId: task.id,
    }],
    tasks: [task],
    summary: {
      workstreamCount: 1,
      moduleCount: 1,
      milestoneCount: 1,
      taskCount: 1,
      subtaskCount: 2,
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
    id: 71,
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
    category: "hustle",
    deadline: "",
    size: "medium",
    status: "done",
    skipped: 0,
    doneWhen: task.doneWhen,
    source: "anchor",
    sourceType: "career_track",
    sourceId: 9,
    sourceStepType: `execution_blueprint_task:${task.id}`,
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: "",
    sourceStatus: "active_slice",
    planItemId: null,
    relatedTrackId: 9,
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
  };
}

function coverage(status: CoverageStatus): CoverageModel {
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Target",
    requirementModelVersion: 2,
    requirementModelFingerprint: "requirements",
    userEvidenceFingerprint: "evidence",
    coverage: [{
      requirementId: "requirement-1",
      status,
      confidence: "medium",
      evidenceItemIds: [],
      reason: "Assessment",
      successBarAssessment: "Assessment",
      evidenceStillNeeded: status === "proven" ? [] : ["Evidence"],
      sourceBasis: "deterministic",
    }],
    evidenceItems: [],
    sourceInventory: {
      cv: 0,
      profile_summary: 0,
      win: 0,
      learning_output: 0,
      completed_learning: 0,
      proof_asset: 0,
      relationship: 0,
      interaction: 0,
    },
    groups: [],
    quality: {
      status: "usable",
      assessedRequirementCount: 1,
      unknownRequirementCount: status === "unknown" ? 1 : 0,
      citedEvidenceCount: 0,
      directEvidenceCount: 0,
      assessmentCoverage: status === "unknown" ? 0 : 100,
      caveats: [],
    },
    generatedAt: 1,
  };
}

test("artifact completion creates a candidate outcome rather than assumed proof", () => {
  const task = taskBlueprint("artifact", "artifact");
  const outcome = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task),
    occurredAt: 100,
  });

  assert.equal(outcome.status, "needs_confirmation");
  assert.equal(outcome.acceptedAt, null);
  assert.match(outcome.focusedQuestion, /finished output or link/i);
  assert.equal(outcome.completionBasis.taskDone, true);
  assert.equal(outcome.completionBasis.allAlwaysSubtasksDone, true);
});

test("an inspectable evidence URL accepts the outcome but does not directly alter coverage", () => {
  const task = taskBlueprint("artifact", "artifact");
  const outcome = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task, { sourceUrl: "https://example.com/output" }),
    occurredAt: 100,
  });

  assert.equal(outcome.status, "accepted");
  assert.equal(outcome.evidenceStrength, "verified");
  assert.equal(outcome.evidenceUrl, "https://example.com/output");
  assert.equal(outcome.acceptedAt, 100);
});

test("research completion becomes supporting evidence without a generic form", () => {
  const task = taskBlueprint("research", "research", "anchor");
  const outcome = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task),
    occurredAt: 100,
  });

  assert.equal(outcome.status, "accepted");
  assert.equal(outcome.evidenceStrength, "supporting");
  assert.equal(outcome.focusedQuestion, "");
});

test("focused confirmation accepts direct real-world evidence", () => {
  const task = taskBlueprint("experience", "experience");
  const candidate = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task),
    occurredAt: 100,
  });
  const accepted = confirmExecutionOutcome(candidate, {
    answer: "Owned the stakeholder workshop and produced the agreed implementation decision.",
    accepted: true,
    occurredAt: 200,
  });

  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.evidenceStrength, "direct");
  assert.equal(accepted.acceptedAt, 200);
  assert.equal(accepted.focusedQuestion, "");
});

test("rejecting or reopening a completion removes it from accepted evidence", () => {
  const task = taskBlueprint("research", "research", "anchor");
  const accepted = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task),
    occurredAt: 100,
  });
  const rejected = confirmExecutionOutcome(accepted, { accepted: false, occurredAt: 200 });
  const superseded = supersedeExecutionOutcome(accepted, 300);

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.acceptedAt, null);
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.acceptedAt, null);
});

test("coverage delta reports movement without claiming causality beyond affected requirements", () => {
  const delta = buildCoverageDelta(coverage("unknown"), coverage("partially_proven"), ["requirement-1"]);

  assert.deepEqual(delta.improvedRequirementIds, ["requirement-1"]);
  assert.equal(delta.deltas[0].before, "unknown");
  assert.equal(delta.deltas[0].after, "partially_proven");
});

test("task completion alone cannot complete a milestone", () => {
  const task = taskBlueprint("artifact", "artifact");
  const candidate = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task),
  });
  const progress = buildMilestoneProgressModel(blueprint(task), coverage("unproven"), [candidate]);

  assert.equal(progress.milestones[0].status, "needs_evidence");
  assert.equal(progress.summary.achieved, 0);
});

test("a milestone is achieved only when all linked requirements are proven", () => {
  const task = taskBlueprint("artifact", "artifact");
  const candidate = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task, { sourceUrl: "https://example.com/output" }),
  });
  const progress = buildMilestoneProgressModel(blueprint(task), coverage("proven"), [candidate]);

  assert.equal(progress.milestones[0].status, "achieved");
  assert.equal(progress.summary.achieved, 1);
});

test("accepted evidence fingerprint changes only when accepted evidence changes", () => {
  const task = taskBlueprint("artifact", "artifact");
  const candidate = inferExecutionOutcome({
    trackId: 9,
    blueprint: blueprint(task),
    blueprintTask: task,
    liveTask: liveTask(task),
    occurredAt: 100,
  });
  const candidateModel = executionOutcomeModel("Target", "blueprint", [candidate]);
  const accepted = confirmExecutionOutcome(candidate, {
    evidenceUrl: "https://example.com/output",
    accepted: true,
    occurredAt: 200,
  });
  const acceptedModel = executionOutcomeModel("Target", "blueprint", [accepted]);

  assert.notEqual(candidateModel.acceptedEvidenceFingerprint, acceptedModel.acceptedEvidenceFingerprint);
});
