import assert from "node:assert/strict";
import test from "node:test";
import { sourceStepTypeForBlueprintTask } from "./trackResearchExecutionPriority";
import {
  buildExecutionPriorityContextFromData,
  executionPriorityContextInternals,
} from "./trackResearchExecutionPriorityContext";

function blueprint(taskIds: string[]) {
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
    tasks: taskIds.map((id) => ({ id })),
    summary: {},
    quality: { status: "complete" },
    materializationStatus: "blueprint_only",
    generatedAt: 1,
  } as any;
}

function track(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    slug: "target",
    name: "Target",
    description: "",
    targetRoleArchetype: "",
    priority: 3,
    status: "active",
    whyItFits: "",
    trackIntelligence: "{}",
    createdAt: 1,
    ...overrides,
  } as any;
}

function task(id: number, overrides: Record<string, any> = {}) {
  return {
    id,
    title: `Task ${id}`,
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
    source: "",
    sourceType: "task",
    sourceId: null,
    sourceStepType: "",
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: "",
    sourceStatus: "",
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

test("capacity accounts for existing same-track work before adding blueprint tasks", () => {
  const context = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(["blueprint-a"]),
    tasks: [task(1), task(2), task(3)],
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.equal(context.activeLoad.sameTrackOpen, 3);
  assert.equal(context.capacity.maxNewTasks, 1);
  assert.equal(context.capacity.maxSelectedTasks, 1);
});

test("blueprint matches from another track cannot suppress this track", () => {
  const sharedBlueprintId = "shared-blueprint-id";
  const otherTrackTask = task(9, {
    relatedTrackId: 2,
    sourceType: "career_track",
    sourceId: 2,
    sourceStepType: sourceStepTypeForBlueprintTask(sharedBlueprintId),
    status: "in_progress",
  });
  const context = buildExecutionPriorityContextFromData({
    track: track({ id: 1 }),
    blueprint: blueprint([sharedBlueprintId]),
    tasks: [otherTrackTask],
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.equal(context.activeLoad.globalOpen, 1);
  assert.equal(context.activeLoad.sameTrackOpen, 0);
  assert.equal(context.activeLoad.currentBlueprintOpen, 0);
  assert.deepEqual(context.liveTasks, []);
});

test("career-track source identity is accepted when relatedTrackId is absent", () => {
  const currentTrackTask = task(10, {
    relatedTrackId: null,
    sourceType: "career_track",
    sourceId: 1,
    sourceStepType: sourceStepTypeForBlueprintTask("a"),
  });
  const context = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(["a"]),
    tasks: [currentTrackTask],
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.equal(context.activeLoad.sameTrackOpen, 1);
  assert.equal(context.activeLoad.currentBlueprintOpen, 1);
  assert.equal(context.liveTasks[0]?.relatedTrackId, 1);
});

test("existing open blueprint tasks are preserved even when above preferred capacity", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const tasks = ids.map((id, index) => task(index + 1, {
    sourceType: "career_track",
    sourceId: 1,
    sourceStepType: sourceStepTypeForBlueprintTask(id),
  }));
  const context = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(ids),
    tasks,
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.equal(context.activeLoad.currentBlueprintOpen, 5);
  assert.equal(context.capacity.maxNewTasks, 0);
  assert.equal(context.capacity.maxSelectedTasks, 5);
});

test("a heavily loaded global task system reduces the preferred slice", () => {
  const tasks = Array.from({ length: 20 }, (_, index) => task(index + 1, {
    relatedTrackId: index < 2 ? 1 : 99,
  }));
  const context = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(["a"]),
    tasks,
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.equal(context.activeLoad.globalOpen, 20);
  assert.equal(context.capacity.maxSelectedTasks, 1);
  assert.equal(context.capacity.maxNewTasks, 1);
});

test("track-linked deadlines and follow-ups become bounded urgency signals", () => {
  const context = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(["a"]),
    tasks: [],
    jobs: [{ id: 11, title: "Policy role", company: "Example", relatedTrackId: 1, status: "wishlist", deadline: "2026-06-26" }] as any,
    learns: [{ id: 12, title: "Policy course", relatedTrackId: 1, learnStatus: "open", applicationDeadline: "2026-07-02" }] as any,
    contacts: [{ id: 13, name: "Alex", who: "Policy practitioner", relatedTrackId: 1, status: "to_contact", nextFollowUpDate: "2026-06-23" }] as any,
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.equal(context.deadlineSignals.length, 3);
  assert.equal(context.deadlineSignals.find((signal) => signal.sourceId === 11)?.urgency, "high");
  assert.equal(context.deadlineSignals.find((signal) => signal.sourceId === 13)?.daysUntil, -1);
});

test("unlinked deadlines do not distort the selected track", () => {
  const context = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(["a"]),
    tasks: [],
    jobs: [{ id: 11, title: "Other role", company: "Example", relatedTrackId: 2, status: "wishlist", deadline: "2026-06-25" }] as any,
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.deepEqual(context.deadlineSignals, []);
});

test("context fingerprint changes when live execution state changes", () => {
  const first = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(["a"]),
    tasks: [task(1, { sourceType: "career_track", sourceId: 1, sourceStepType: sourceStepTypeForBlueprintTask("a") })],
    now: new Date("2026-06-24T12:00:00Z"),
  });
  const second = buildExecutionPriorityContextFromData({
    track: track(),
    blueprint: blueprint(["a"]),
    tasks: [task(1, { sourceType: "career_track", sourceId: 1, sourceStepType: sourceStepTypeForBlueprintTask("a"), status: "in_progress" })],
    now: new Date("2026-06-24T12:00:00Z"),
  });

  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("date arithmetic is stable at UTC day boundaries", () => {
  assert.equal(executionPriorityContextInternals.daysUntil("2026-06-25", new Date("2026-06-24T23:59:00Z")), 1);
});
