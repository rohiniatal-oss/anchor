import assert from "node:assert/strict";
import test from "node:test";
import {
  applyExecutionPrioritySynthesis,
  sanitizeExecutionPrioritySynthesis,
} from "./trackResearchExecutionPrioritySynthesis";

function model() {
  return {
    mode: "execution_priority_model",
    version: 1,
    policyVersion: 1,
    targetLabel: "Target",
    executionBlueprintVersion: 1,
    executionBlueprintFingerprint: "blueprint",
    contextFingerprint: "context",
    sourceFingerprint: "source",
    objective: "Select a slice",
    selectionLogic: "Deterministic logic",
    candidates: [
      {
        taskId: "selected",
        title: "Selected task",
        workstreamId: "ws-a",
        moduleId: "module-a",
        requirementIds: ["req-a"],
        milestoneIds: [],
        owner: "shared",
        kind: "artifact",
        effort: "medium",
        selected: true,
        rank: 1,
        slot: "now",
        dependencyState: "satisfied",
        dependencyTaskIds: [],
        unmetDependencyTaskIds: [],
        liveState: "not_materialized",
        liveTaskId: null,
        score: { strategicValue: 20, evidenceValue: 20, readinessValue: 16, unlockValue: 0, urgencyValue: 0, continuityValue: 0, effortFit: 7, automationFit: 3, loadPenalty: 0, total: 66 },
        whyNow: "Deterministic selected reason",
        notNowReason: "",
        expectedEvidence: "Evidence A",
        minimumOutcome: "Minimum A",
        doneWhen: "Done A",
      },
      {
        taskId: "later",
        title: "Later task",
        workstreamId: "ws-b",
        moduleId: "module-b",
        requirementIds: ["req-b"],
        milestoneIds: [],
        owner: "anchor",
        kind: "research",
        effort: "quick",
        selected: false,
        rank: 0,
        slot: "later",
        dependencyState: "satisfied",
        dependencyTaskIds: [],
        unmetDependencyTaskIds: [],
        liveState: "not_materialized",
        liveTaskId: null,
        score: { strategicValue: 10, evidenceValue: 8, readinessValue: 16, unlockValue: 0, urgencyValue: 0, continuityValue: 0, effortFit: 8, automationFit: 4, loadPenalty: 0, total: 46 },
        whyNow: "",
        notNowReason: "Deterministic later reason",
        expectedEvidence: "Evidence B",
        minimumOutcome: "Minimum B",
        doneWhen: "Done B",
      },
    ],
    activeSlice: {
      status: "ready",
      maxTasks: 1,
      selectedTaskIds: ["selected"],
      nowTaskId: "selected",
      activeTaskIds: [],
      nextTaskIds: [],
      parallelTaskIds: [],
      newTaskIds: ["selected"],
      existingActiveTaskIds: [],
      deferredTaskCount: 1,
      estimatedMinutes: 45,
      deepOrProjectTaskCount: 0,
      userOwnedTaskCount: 0,
      workstreamIds: ["ws-a"],
    },
    materialization: { status: "not_materialized", mappings: [], activeLiveTaskIds: [], completedLiveTaskIds: [], staleLiveTaskIds: [] },
    quality: { status: "complete", selectedDependencyCoverage: 100, blockedSelectedTaskIds: [], conditionalSelectedTaskIds: [], duplicateSelectedTaskIds: [], overCapacityBy: 0, caveats: [] },
    generatedAt: 1,
  } as any;
}

test("the LLM may improve explanations but cannot change selection", () => {
  const original = model();
  const refined = applyExecutionPrioritySynthesis(original, {
    selectionLogic: "The slice balances evidence value and execution load.",
    taskExplanations: [
      { taskId: "selected", whyNow: "This creates reusable evidence for the most material ready requirement.", notNowReason: "Attempted override" },
      { taskId: "later", whyNow: "Attempted override", notNowReason: "This is useful but lower value than the selected evidence-producing task." },
    ],
  });

  assert.deepEqual(refined.activeSlice, original.activeSlice);
  assert.equal(refined.candidates[0].selected, true);
  assert.equal(refined.candidates[0].slot, "now");
  assert.equal(refined.candidates[0].notNowReason, "");
  assert.equal(refined.candidates[1].selected, false);
  assert.equal(refined.candidates[1].whyNow, "");
  assert.match(refined.candidates[0].whyNow, /reusable evidence/i);
  assert.match(refined.candidates[1].notNowReason, /lower value/i);
});

test("invented task IDs and structural fields are ignored", () => {
  const original = model();
  const raw: any = {
    selectionLogic: "Clearer explanation",
    selectedTaskIds: ["later"],
    priorityScores: { later: 1000 },
    taskExplanations: [
      { taskId: "invented", whyNow: "Invented reason" },
      { taskId: "selected", whyNow: "Valid explanation", slot: "later", selected: false },
    ],
  };
  const refined = applyExecutionPrioritySynthesis(original, sanitizeExecutionPrioritySynthesis(raw));

  assert.deepEqual(refined.activeSlice.selectedTaskIds, ["selected"]);
  assert.equal(refined.candidates[0].selected, true);
  assert.equal(refined.candidates[0].slot, "now");
  assert.equal(refined.candidates.length, 2);
});

test("malformed arrays are sanitized at the LLM boundary", () => {
  const sanitized = sanitizeExecutionPrioritySynthesis({
    selectionLogic: "Valid",
    taskExplanations: "not-an-array",
    qualityNotes: { invalid: true },
  });

  assert.ok(sanitized);
  assert.deepEqual(sanitized?.taskExplanations, []);
  assert.deepEqual(sanitized?.qualityNotes, []);
});
