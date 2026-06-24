import assert from "node:assert/strict";
import test from "node:test";
import { hardenExecutionPriorityModel, MAX_ACTIVE_SLICE_WORKSTREAMS } from "./trackResearchExecutionPriorityPolicy";

function candidate(id: string, workstreamId: string, liveState: "not_materialized" | "open" = "not_materialized") {
  return {
    taskId: id,
    title: id,
    workstreamId,
    moduleId: `module-${id}`,
    requirementIds: [`requirement-${id}`],
    milestoneIds: [],
    owner: "anchor",
    kind: "research",
    effort: "quick",
    selected: true,
    rank: 1,
    slot: "parallel",
    dependencyState: "satisfied",
    dependencyTaskIds: [],
    unmetDependencyTaskIds: [],
    liveState,
    liveTaskId: liveState === "open" ? Number(id.replace(/\D/g, "")) || 1 : null,
    score: {
      strategicValue: 10,
      evidenceValue: 8,
      readinessValue: 16,
      unlockValue: 0,
      urgencyValue: 0,
      continuityValue: liveState === "open" ? 7 : 0,
      effortFit: 8,
      automationFit: 4,
      loadPenalty: 0,
      total: liveState === "open" ? 53 : 46,
    },
    whyNow: "Selected by the deterministic policy.",
    notNowReason: "",
    expectedEvidence: `Evidence ${id}`,
    minimumOutcome: `Minimum ${id}`,
    doneWhen: `Done ${id}`,
  } as any;
}

function model(candidates: any[]) {
  return {
    mode: "execution_priority_model",
    version: 1,
    policyVersion: 1,
    targetLabel: "Target",
    executionBlueprintVersion: 1,
    executionBlueprintFingerprint: "blueprint",
    contextFingerprint: "context",
    sourceFingerprint: "source",
    objective: "Select work",
    selectionLogic: "Policy",
    candidates,
    activeSlice: {
      status: "ready",
      maxTasks: 4,
      selectedTaskIds: candidates.map((item) => item.taskId),
      nowTaskId: candidates[0]?.taskId || null,
      activeTaskIds: [],
      nextTaskIds: [],
      parallelTaskIds: [],
      newTaskIds: candidates.map((item) => item.taskId),
      existingActiveTaskIds: [],
      deferredTaskCount: 0,
      estimatedMinutes: candidates.length * 15,
      deepOrProjectTaskCount: 0,
      userOwnedTaskCount: 0,
      workstreamIds: candidates.map((item) => item.workstreamId),
    },
    materialization: { status: "not_materialized", mappings: [], activeLiveTaskIds: [], completedLiveTaskIds: [], staleLiveTaskIds: [] },
    quality: { status: "complete", selectedDependencyCoverage: 100, blockedSelectedTaskIds: [], conditionalSelectedTaskIds: [], duplicateSelectedTaskIds: [], overCapacityBy: 0, caveats: [] },
    generatedAt: 1,
  } as any;
}

function blueprint(candidates: any[]) {
  return {
    mode: "execution_blueprint_model",
    version: 1,
    sourceFingerprint: "blueprint",
    tasks: candidates.map((item) => ({ id: item.taskId })),
    quality: { status: "complete" },
  } as any;
}

function context() {
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
  } as any;
}

test("newly selected work spans no more than two workstreams", () => {
  const candidates = [
    candidate("task-1", "workstream-1"),
    candidate("task-2", "workstream-2"),
    candidate("task-3", "workstream-3"),
    candidate("task-4", "workstream-4"),
  ];
  const hardened = hardenExecutionPriorityModel(model(candidates), blueprint(candidates), context());

  assert.ok(hardened.activeSlice.workstreamIds.length <= MAX_ACTIVE_SLICE_WORKSTREAMS);
  assert.equal(hardened.activeSlice.selectedTaskIds.length, 2);
  assert.match(hardened.candidates.find((item: any) => item.taskId === "task-3")?.notNowReason || "", /two workstreams/i);
});

test("existing open work is preserved even when it spans more than two workstreams", () => {
  const candidates = [
    candidate("task-1", "workstream-1", "open"),
    candidate("task-2", "workstream-2", "open"),
    candidate("task-3", "workstream-3", "open"),
    candidate("task-4", "workstream-4"),
  ];
  const hardened = hardenExecutionPriorityModel(model(candidates), blueprint(candidates), {
    ...context(),
    activeLoad: { globalOpen: 3, globalToday: 0, sameTrackOpen: 3, currentBlueprintOpen: 3, currentBlueprintCompleted: 0, deepOrProjectOpen: 0 },
    capacity: { maxSelectedTasks: 4, maxNewTasks: 1, maxDeepOrProjectTasks: 2, maxUserOwnedTasks: 2, maxPerWorkstream: 2 },
  } as any);

  assert.deepEqual(hardened.activeSlice.selectedTaskIds, ["task-1", "task-2", "task-3"]);
  assert.ok(hardened.quality.caveats.some((value: string) => /more than two workstreams/i.test(value)));
});
