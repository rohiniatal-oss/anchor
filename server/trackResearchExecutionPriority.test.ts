import assert from "node:assert/strict";
import test from "node:test";
import {
  blueprintTaskIdFromSourceStepType,
  buildExecutionPriorityModel,
  executionPrioritySourceFingerprint,
  sourceStepTypeForBlueprintTask,
  type ExecutionPriorityContext,
} from "./trackResearchExecutionPriority";
import { hardenExecutionPriorityModel } from "./trackResearchExecutionPriorityPolicy";

function requirement(id: string, importance: string = "important") {
  return {
    id,
    key: `skill:${id}`,
    label: id,
    aliases: [],
    definition: `${id} requirement`,
    group: "perform_work",
    category: "skill",
    importance,
    importanceReason: "Market evidence",
    scope: "shared",
    roleFamilyIds: [],
    successBar: `Success bar for ${id}`,
    evidenceClaimIds: [],
    confidence: "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
  } as any;
}

function taskBlueprint(id: string, options: Record<string, any> = {}) {
  return {
    id,
    key: `workstream:${id}`,
    workstreamId: options.workstreamId || `workstream-${id}`,
    moduleId: options.moduleId || `module-${id}`,
    moduleTitle: options.moduleTitle || id,
    milestoneIds: options.milestoneIds || [],
    requirementIds: options.requirementIds || [`req-${id}`],
    sequence: options.sequence || 1,
    title: options.title || id,
    kind: options.kind || "research",
    owner: options.owner || "anchor",
    why: "Why this task exists",
    doneWhen: `Done when ${id} is complete`,
    minimumOutcome: `Minimum outcome for ${id}`,
    expectedEvidence: `Evidence for ${id}`,
    effort: options.effort || "medium",
    readiness: options.readiness || (options.dependsOnTaskIds?.length ? "depends_on_blueprint" : "ready"),
    readinessReason: "Test readiness",
    dependsOnTaskIds: options.dependsOnTaskIds || [],
    subtasks: [{
      id: `subtask-${id}`,
      title: `Do ${id}`,
      executor: options.owner === "user" ? "user_action" : "system",
      condition: "always",
      outputSpec: `Output for ${id}`,
      doneWhen: `Subtask ${id} done`,
      dependsOnSubtaskIds: [],
    }],
    materialization: {
      state: "blueprint_only",
      taskDraft: {
        category: "admin",
        size: options.effort === "quick" ? "quick" : options.effort === "medium" ? "medium" : "deep",
        doneWhen: `Done when ${id} is complete`,
        minimumOutcome: `Minimum outcome for ${id}`,
        sourceType: "career_track",
        sourceStepType: "execution_blueprint_task",
      },
    },
  } as any;
}

function fixtures(tasks: any[], options: Record<string, any> = {}) {
  const requirementIds = [...new Set(tasks.flatMap((task) => task.requirementIds))];
  const requirements = requirementIds.map((id) => requirement(id, options.importanceById?.[id] || "important"));
  const requirementModel = {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements",
    sourceResearchAt: 1,
    target: { label: "Target", definition: "Target definition", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [],
    requirements,
    evidenceClaims: [],
    researchQuality: { status: "strong", sourceCount: 6, directSourceCount: 3, sourceTypeCount: 3, requirementEvidenceCoverage: 100, directRequirementCoverage: 80, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  } as any;
  const coverage = requirementIds.map((requirementId) => ({
    requirementId,
    status: options.coverageById?.[requirementId] || "unproven",
    confidence: "medium",
    evidenceItemIds: [],
    reason: "Not yet evidenced",
    successBarAssessment: "Not met",
    evidenceStillNeeded: [`Evidence for ${requirementId}`],
    sourceBasis: "deterministic",
  }));
  const coverageModel = {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Target",
    requirementModelVersion: 2,
    requirementModelFingerprint: "requirements",
    userEvidenceFingerprint: "user",
    coverage,
    evidenceItems: [],
    sourceInventory: {},
    groups: [],
    quality: { status: "usable", assessedRequirementCount: coverage.length, unknownRequirementCount: 0, citedEvidenceCount: 0, directEvidenceCount: 0, assessmentCoverage: 100, caveats: [] },
    generatedAt: 1,
  } as any;
  const developmentPlanModel = {
    mode: "development_plan_model",
    version: 1,
    targetLabel: "Target",
    requirementModelFingerprint: "requirements",
    coverageFingerprint: "coverage",
    sourceContextFingerprint: "context",
    planSummary: "Plan",
    decisions: requirementIds.map((requirementId) => ({
      requirementId,
      coverageStatus: options.coverageById?.[requirementId] || "unproven",
      action: options.actionById?.[requirementId] || "build",
      scope: "core",
      reason: "Needs development",
      desiredEvidence: `Evidence for ${requirementId}`,
      evidenceStillNeeded: [`Evidence for ${requirementId}`],
    })),
    workstreams: [],
    maintenanceRequirementIds: [],
    quality: { status: "strong", coreRequirementCount: requirementIds.length, coveredCoreRequirementCount: requirementIds.length, plannedRequirementCount: requirementIds.length, maintenanceRequirementCount: 0, conditionalRequirementCount: 0, enhancementRequirementCount: 0, unassignedRequirementIds: [], caveats: [] },
    generatedAt: 1,
  } as any;
  const executionBlueprintModel = {
    mode: "execution_blueprint_model",
    version: 1,
    targetLabel: "Target",
    developmentPlanVersion: 1,
    developmentPlanFingerprint: "development",
    sourceFingerprint: "blueprint-fingerprint",
    objective: "Execute",
    principles: [],
    workstreams: [...new Set(tasks.map((task) => task.workstreamId))].map((workstreamId) => ({ workstreamId, title: workstreamId, objective: "", taskIds: tasks.filter((task) => task.workstreamId === workstreamId).map((task) => task.id), moduleIds: [], milestoneIds: [], completionTaskId: null })),
    tasks,
    summary: { workstreamCount: 1, moduleCount: 1, milestoneCount: 0, taskCount: tasks.length, subtaskCount: tasks.length, anchorOwnedTaskCount: tasks.filter((task) => task.owner === "anchor").length, userOwnedTaskCount: tasks.filter((task) => task.owner === "user").length, sharedTaskCount: tasks.filter((task) => task.owner === "shared").length, conditionalTaskCount: tasks.filter((task) => task.readiness === "conditional").length },
    quality: { status: "complete", moduleCoverageRate: 100, milestoneCoverageRate: 100, requirementCoverageRate: 100, orphanModuleIds: [], orphanMilestoneIds: [], orphanRequirementIds: [], duplicateTaskKeys: [], invalidDependencyIds: [], cyclicTaskIds: [], oversizedTaskIds: [], caveats: [] },
    materializationStatus: "blueprint_only",
    generatedAt: 1,
  } as any;
  return { requirementModel, coverageModel, developmentPlanModel, executionBlueprintModel };
}

function context(overrides: Partial<ExecutionPriorityContext> = {}): ExecutionPriorityContext {
  return {
    trackId: 1,
    dayKey: "2026-06-24",
    trackPriority: 1,
    trackStatus: "active",
    liveTasks: [],
    deadlineSignals: [],
    activeLoad: { globalOpen: 0, globalToday: 0, sameTrackOpen: 0, currentBlueprintOpen: 0, currentBlueprintCompleted: 0, deepOrProjectOpen: 0 },
    capacity: { maxSelectedTasks: 4, maxNewTasks: 4, maxDeepOrProjectTasks: 2, maxUserOwnedTasks: 2, maxPerWorkstream: 2 },
    fingerprint: "context",
    generatedAt: 1,
    ...overrides,
  };
}

function build(tasks: any[], priorityContext = context(), options: Record<string, any> = {}) {
  const input = fixtures(tasks, options);
  const model = buildExecutionPriorityModel({ ...input, context: priorityContext });
  return hardenExecutionPriorityModel(model, input.executionBlueprintModel, priorityContext);
}

test("blueprint task provenance round trips through sourceStepType", () => {
  const id = "task-blueprint-abc";
  assert.equal(blueprintTaskIdFromSourceStepType(sourceStepTypeForBlueprintTask(id)), id);
  assert.equal(blueprintTaskIdFromSourceStepType("job_step"), null);
});

test("blocking alone does not outrank materially stronger evidence work", () => {
  const blocker = taskBlueprint("low-blocker", { requirementIds: ["req-low"], kind: "research", effort: "quick", workstreamId: "ws-low" });
  const dependentA = taskBlueprint("dependent-a", { requirementIds: ["req-low"], dependsOnTaskIds: [blocker.id], workstreamId: "ws-low" });
  const dependentB = taskBlueprint("dependent-b", { requirementIds: ["req-low"], dependsOnTaskIds: [blocker.id], workstreamId: "ws-low" });
  const highEvidence = taskBlueprint("high-evidence", { requirementIds: ["req-high"], kind: "artifact", milestoneIds: ["milestone-high"], workstreamId: "ws-high" });
  const model = build(
    [blocker, dependentA, dependentB, highEvidence],
    context({ capacity: { maxSelectedTasks: 1, maxNewTasks: 1, maxDeepOrProjectTasks: 1, maxUserOwnedTasks: 1, maxPerWorkstream: 1 } }),
    { importanceById: { "req-low": "contextual", "req-high": "essential" } },
  );

  assert.deepEqual(model.activeSlice.selectedTaskIds, [highEvidence.id]);
  assert.ok(model.candidates.find((candidate) => candidate.taskId === blocker.id)!.score.unlockValue > 0);
});

test("selected prerequisites are placed before dependent work", () => {
  const prerequisite = taskBlueprint("prerequisite", { requirementIds: ["req-core"], kind: "research", effort: "quick", workstreamId: "ws-core", sequence: 1 });
  const dependent = taskBlueprint("dependent", { requirementIds: ["req-core"], kind: "artifact", dependsOnTaskIds: [prerequisite.id], workstreamId: "ws-core", sequence: 2 });
  const model = build([prerequisite, dependent], context({ capacity: { maxSelectedTasks: 2, maxNewTasks: 2, maxDeepOrProjectTasks: 2, maxUserOwnedTasks: 2, maxPerWorkstream: 2 } }));

  assert.deepEqual(model.activeSlice.selectedTaskIds, [prerequisite.id, dependent.id]);
  assert.equal(model.activeSlice.nowTaskId, prerequisite.id);
  assert.equal(model.candidates.find((candidate) => candidate.taskId === dependent.id)?.slot, "next");
});

test("existing active blueprint work is preserved before new work", () => {
  const existing = taskBlueprint("existing", { requirementIds: ["req-existing"], workstreamId: "ws-existing" });
  const other = taskBlueprint("other", { requirementIds: ["req-other"], kind: "artifact", workstreamId: "ws-other" });
  const priorityContext = context({
    liveTasks: [{ liveTaskId: 91, blueprintTaskId: existing.id, title: existing.title, done: false, status: "in_progress", list: "inbox", readiness: "ready", skipped: 0, size: "medium", relatedTrackId: 1, sourceStepType: sourceStepTypeForBlueprintTask(existing.id), createdAt: 1 }],
    activeLoad: { globalOpen: 1, globalToday: 0, sameTrackOpen: 1, currentBlueprintOpen: 1, currentBlueprintCompleted: 0, deepOrProjectOpen: 0 },
    capacity: { maxSelectedTasks: 1, maxNewTasks: 0, maxDeepOrProjectTasks: 1, maxUserOwnedTasks: 1, maxPerWorkstream: 1 },
  });
  const model = build([existing, other], priorityContext);

  assert.deepEqual(model.activeSlice.selectedTaskIds, [existing.id]);
  assert.equal(model.activeSlice.nowTaskId, existing.id);
  assert.equal(model.candidates.find((candidate) => candidate.taskId === existing.id)?.liveState, "open");
});

test("capacity filled by other live work produces no new active slice", () => {
  const candidate = taskBlueprint("candidate", { requirementIds: ["req-candidate"] });
  const priorityContext = context({
    activeLoad: { globalOpen: 4, globalToday: 1, sameTrackOpen: 4, currentBlueprintOpen: 0, currentBlueprintCompleted: 0, deepOrProjectOpen: 1 },
    capacity: { maxSelectedTasks: 0, maxNewTasks: 0, maxDeepOrProjectTasks: 2, maxUserOwnedTasks: 2, maxPerWorkstream: 2 },
  });
  const model = build([candidate], priorityContext);

  assert.deepEqual(model.activeSlice.selectedTaskIds, []);
  assert.equal(model.activeSlice.status, "at_capacity");
});

test("conditional and completed tasks are never selected as new shared work", () => {
  const conditional = taskBlueprint("conditional", { requirementIds: ["req-conditional"], readiness: "conditional" });
  const completed = taskBlueprint("completed", { requirementIds: ["req-completed"] });
  const ready = taskBlueprint("ready", { requirementIds: ["req-ready"], kind: "artifact" });
  const priorityContext = context({
    liveTasks: [{ liveTaskId: 12, blueprintTaskId: completed.id, title: completed.title, done: true, status: "done", list: "inbox", readiness: "ready", skipped: 0, size: "medium", relatedTrackId: 1, sourceStepType: sourceStepTypeForBlueprintTask(completed.id), createdAt: 1 }],
    activeLoad: { globalOpen: 0, globalToday: 0, sameTrackOpen: 0, currentBlueprintOpen: 0, currentBlueprintCompleted: 1, deepOrProjectOpen: 0 },
    capacity: { maxSelectedTasks: 2, maxNewTasks: 2, maxDeepOrProjectTasks: 2, maxUserOwnedTasks: 2, maxPerWorkstream: 2 },
  });
  const model = build([conditional, completed, ready], priorityContext);

  assert.ok(model.activeSlice.selectedTaskIds.includes(ready.id));
  assert.ok(!model.activeSlice.selectedTaskIds.includes(conditional.id));
  assert.ok(!model.activeSlice.selectedTaskIds.includes(completed.id));
  assert.equal(model.candidates.find((candidate) => candidate.taskId === conditional.id)?.slot, "conditional");
  assert.equal(model.candidates.find((candidate) => candidate.taskId === completed.id)?.slot, "completed");
});

test("the slice caps deep and user-owned work", () => {
  const deepA = taskBlueprint("deep-a", { requirementIds: ["req-a"], kind: "artifact", effort: "deep", owner: "user", workstreamId: "ws-a" });
  const deepB = taskBlueprint("deep-b", { requirementIds: ["req-b"], kind: "artifact", effort: "project", owner: "user", workstreamId: "ws-b" });
  const quick = taskBlueprint("quick", { requirementIds: ["req-c"], kind: "research", effort: "quick", owner: "anchor", workstreamId: "ws-c" });
  const model = build([deepA, deepB, quick], context({ capacity: { maxSelectedTasks: 3, maxNewTasks: 3, maxDeepOrProjectTasks: 1, maxUserOwnedTasks: 1, maxPerWorkstream: 2 } }));
  const selected = model.candidates.filter((candidate) => candidate.selected);

  assert.ok(selected.filter((candidate) => candidate.effort === "deep" || candidate.effort === "project").length <= 1);
  assert.ok(selected.filter((candidate) => candidate.owner === "user").length <= 1);
});

test("priority fingerprint changes with the live execution context", () => {
  const candidate = taskBlueprint("candidate", { requirementIds: ["req-candidate"] });
  const input = fixtures([candidate]);
  const first = context({ fingerprint: "context-a" });
  const second = context({ fingerprint: "context-b" });

  assert.notEqual(
    executionPrioritySourceFingerprint(input.executionBlueprintModel, first),
    executionPrioritySourceFingerprint(input.executionBlueprintModel, second),
  );
});
