import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";
import { completeTask } from "./taskLifecycleService";

let h: Harness;

before(async () => {
  h = await makeHarness();
});

after(async () => {
  await h.close();
});

beforeEach(() => {
  h.reset();
});

async function createTask(overrides: Record<string, unknown> = {}) {
  return h.storage.createTask({
    title: "Read 25 minutes of AI governance primer",
    list: "today",
    block: null,
    done: false,
    pinned: true,
    steps: "[]",
    sort: 0,
    category: "learning",
    deadline: "",
    size: "quick",
    status: "in_progress",
    skipped: 0,
    doneWhen: "Read for 25 minutes",
    sourceType: "task",
    sourceNote: "",
    sourceStatus: "",
    minimumOutcome: "Read for 25 minutes",
    readiness: "ready",
    ...overrides,
  } as any);
}

test("task completion returns inferred contract and records outcome in win takeaway", async () => {
  const task = await createTask();

  const result = completeTask({
    taskId: task.id,
    day: new Date().toISOString().slice(0, 10),
    completionOutcome: "continue",
    completionNote: "Useful background; keep reading tomorrow.",
  });

  assert.equal(result.ok, true);
  assert.equal(result.completionContract?.contract, "exposure");
  assert.equal(result.completionContract?.requiresArtifact, false);
  assert.equal(result.completionOutcome, "continue");
  assert.equal(result.completionNote, "Useful background; keep reading tomorrow.");

  const wins = await h.storage.getWins();
  assert.equal(wins.length, 1);
  assert.match(wins[0].takeaway, /Contract: exposure/);
  assert.match(wins[0].takeaway, /Result: continue/);
  assert.match(wins[0].takeaway, /keep reading tomorrow/i);
});

test("application completion records rubric rating without forcing a proof artifact", async () => {
  const task = await createTask({
    title: "Apply AI governance framework to a frontier model release case",
    doneWhen: "A short case note names assumptions, trade-offs and conclusion",
    minimumOutcome: "A short case note exists",
  });

  const result = completeTask({
    taskId: task.id,
    day: new Date().toISOString().slice(0, 10),
    completionRating: "adequate",
    completionNote: "Applied the framework and identified the key uncertainty.",
  });

  assert.equal(result.completionContract?.contract, "application");
  assert.equal(result.completionContract?.assessmentMode, "rubric");
  assert.equal(result.completionContract?.requiresArtifact, false);
  assert.equal(result.completionRating, "adequate");

  const activity = h.sqlite.prepare("SELECT metadata FROM activity_log WHERE task_id = ? AND event_type = 'completed'").get(task.id) as any;
  const metadata = JSON.parse(activity.metadata);
  assert.equal(metadata.completionContract, "application");
  assert.equal(metadata.completionRating, "adequate");
  assert.equal(metadata.completionNote, "Applied the framework and identified the key uncertainty.");
});

test("completion without user-supplied outcome still returns the inferred contract", async () => {
  const task = await createTask({ title: "Draft AI governance memo", category: "substack", doneWhen: "Draft exists" });

  const result = completeTask({ taskId: task.id, day: new Date().toISOString().slice(0, 10) });

  assert.equal(result.completionContract?.contract, "deliverable");
  assert.equal(result.completionContract?.requiresArtifact, true);
  assert.equal(result.completionOutcome, "");
  assert.equal(result.completionRating, "");
});
