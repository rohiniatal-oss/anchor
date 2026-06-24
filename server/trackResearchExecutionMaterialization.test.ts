import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMaterializedTaskInput,
  executionMaterializationInternals,
} from "./trackResearchExecutionMaterialization";
import { sourceStepTypeForBlueprintTask } from "./trackResearchExecutionPriority";

function blueprintTask(id: string, options: Record<string, any> = {}) {
  return {
    id,
    key: `workstream:${id}`,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    moduleTitle: "Module",
    milestoneIds: [],
    requirementIds: ["requirement-1"],
    sequence: 1,
    title: options.title || `Task ${id}`,
    kind: options.kind || "artifact",
    owner: options.owner || "shared",
    why: "Why",
    doneWhen: options.doneWhen || "A complete output exists.",
    minimumOutcome: options.minimumOutcome || "A usable first version exists.",
    expectedEvidence: options.expectedEvidence || "A reusable artifact.",
    effort: options.effort || "medium",
    readiness: options.readiness || "ready",
    readinessReason: "Ready",
    dependsOnTaskIds: options.dependsOnTaskIds || [],
    subtasks: options.subtasks || [
      {
        id: `subtask-${id}-1`,
        title: "Draft the output",
        executor: "system",
        condition: "always",
        outputSpec: "A complete first draft.",
        doneWhen: "The draft covers the required structure.",
        dependsOnSubtaskIds: [],
      },
      {
        id: `subtask-${id}-2`,
        title: "Confirm the substantive judgement",
        executor: "user_learning",
        condition: "if_needed",
        outputSpec: "Confirmed reasoning and corrections.",
        doneWhen: "The user can defend the key judgement.",
        dependsOnSubtaskIds: [`subtask-${id}-1`],
      },
    ],
    materialization: {
      state: "blueprint_only",
      taskDraft: {
        category: options.category || "hustle",
        size: options.size || "medium",
        doneWhen: options.doneWhen || "A complete output exists.",
        minimumOutcome: options.minimumOutcome || "A usable first version exists.",
        sourceType: "career_track",
        sourceStepType: "execution_blueprint_task",
      },
    },
  } as any;
}

function priority(taskId: string, overrides: Record<string, any> = {}) {
  return {
    taskId,
    title: `Task ${taskId}`,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    requirementIds: ["requirement-1"],
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
    whyNow: "It creates strong evidence for a material requirement.",
    notNowReason: "",
    expectedEvidence: "A reusable artifact.",
    minimumOutcome: "A usable first version exists.",
    doneWhen: "A complete output exists.",
    ...overrides,
  } as any;
}

function liveTask(id: number, overrides: Record<string, any> = {}) {
  return {
    id,
    title: `Live ${id}`,
    list: "inbox",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: id,
    category: "admin",
    deadline: "",
    size: "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: "Done",
    source: "anchor",
    sourceType: "career_track",
    sourceId: 1,
    sourceStepType: "",
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
    minimumOutcome: "Minimum",
    stretchOutcome: "",
    estimateMinutes: 45,
    estimateConfidence: "high",
    estimateReason: "",
    actualMinutes: null,
    createdAt: id,
    ...overrides,
  } as any;
}

test("materialized tasks preserve provenance while remaining outside Today", () => {
  const task = blueprintTask("blueprint-a");
  const input = buildMaterializedTaskInput({
    trackId: 7,
    blueprintTask: task,
    priority: priority(task.id),
    workstreamTitle: "Create credible proof",
    list: "today",
    sort: 20,
  });
  const steps = JSON.parse(input.steps || "[]");

  assert.equal(input.list, "inbox");
  assert.equal(input.relatedTrackId, 7);
  assert.equal(input.sourceType, "career_track");
  assert.equal(input.sourceStepType, sourceStepTypeForBlueprintTask(task.id));
  assert.equal(input.doneWhen, task.doneWhen);
  assert.equal(input.minimumOutcome, task.minimumOutcome);
  assert.equal(input.stretchOutcome, task.expectedEvidence);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].blueprintSubtaskId, task.subtasks[0].id);
  assert.equal(steps[1].condition, "if_needed");
});

test("dependent materialized tasks remain in inbox and wait on live prerequisites", () => {
  const task = blueprintTask("blueprint-b", { dependsOnTaskIds: ["blueprint-a"] });
  const input = buildMaterializedTaskInput({
    trackId: 7,
    blueprintTask: task,
    priority: priority(task.id, { slot: "next", dependencyState: "selected_prerequisite" }),
    workstreamTitle: "Create credible proof",
    list: "today",
    sort: 30,
    dependencyLiveTaskIds: [101],
  });

  assert.equal(input.list, "inbox");
  assert.equal(input.readiness, "waiting");
  assert.deepEqual(JSON.parse(input.dependsOn || "[]"), [101]);
  assert.equal(input.blockedBy, "101");
});

test("active live tasks take precedence over newer completed duplicates", () => {
  const blueprintId = "blueprint-a";
  const active = liveTask(1, {
    sourceStepType: sourceStepTypeForBlueprintTask(blueprintId),
    createdAt: 1,
  });
  const completed = liveTask(2, {
    sourceStepType: sourceStepTypeForBlueprintTask(blueprintId),
    done: true,
    status: "done",
    createdAt: 2,
  });
  const mapped = executionMaterializationInternals.liveTaskMap([active, completed]);

  assert.equal(mapped.get(blueprintId)?.id, active.id);
});

test("selected tasks are ordered after their selected prerequisites", () => {
  const parent = blueprintTask("parent");
  const child = blueprintTask("child", { dependsOnTaskIds: [parent.id] });
  const result = executionMaterializationInternals.dependencyOrder(
    [child.id, parent.id],
    new Map([[parent.id, parent], [child.id, child]]),
    new Map(),
  );

  assert.deepEqual(result.ordered.map((task: any) => task.id), [parent.id, child.id]);
  assert.deepEqual(result.skipped, []);
});

test("a task is skipped when an external prerequisite has no live mapping", () => {
  const child = blueprintTask("child", { dependsOnTaskIds: ["external-prerequisite"] });
  const result = executionMaterializationInternals.dependencyOrder(
    [child.id],
    new Map([[child.id, child]]),
    new Map(),
  );

  assert.deepEqual(result.ordered, []);
  assert.equal(result.skipped[0]?.blueprintTaskId, child.id);
  assert.match(result.skipped[0]?.reason || "", /missing prerequisite/i);
});

test("failure of a selected prerequisite prevents dependent materialization", () => {
  const child = blueprintTask("child", { dependsOnTaskIds: ["missing-parent"] });
  const result = executionMaterializationInternals.dependencyOrder(
    ["missing-parent", child.id],
    new Map([[child.id, child]]),
    new Map(),
  );

  assert.deepEqual(result.ordered, []);
  assert.ok(result.skipped.some((item: any) => item.blueprintTaskId === child.id && /prerequisite could not/i.test(item.reason)));
});
