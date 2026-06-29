import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";

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

  const response = await api(h.base, "POST", `/api/tasks/${task.id}/complete`, {
    outcome: "continue",
    note: "Useful background; keep reading tomorrow.",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.completionContract.contract, "exposure");
  assert.equal(response.json.completionContract.requiresArtifact, false);
  assert.equal(response.json.completionOutcome, "continue");
  assert.equal(response.json.completionNote, "Useful background; keep reading tomorrow.");

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

  const response = await api(h.base, "POST", `/api/tasks/${task.id}/complete`, {
    rating: "adequate",
    note: "Applied the framework and identified the key uncertainty.",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.completionContract.contract, "application");
  assert.equal(response.json.completionContract.assessmentMode, "rubric");
  assert.equal(response.json.completionContract.requiresArtifact, false);
  assert.equal(response.json.completionRating, "adequate");

  const activity = h.sqlite.prepare("SELECT metadata FROM activity_log WHERE task_id = ? AND event_type = 'completed'").get(task.id) as any;
  const metadata = JSON.parse(activity.metadata);
  assert.equal(metadata.completionContract, "application");
  assert.equal(metadata.completionRating, "adequate");
  assert.equal(metadata.completionNote, "Applied the framework and identified the key uncertainty.");
});

test("completion without user-supplied outcome still returns the inferred contract", async () => {
  const task = await createTask({ title: "Draft AI governance memo", category: "substack", doneWhen: "Draft exists" });

  const response = await api(h.base, "POST", `/api/tasks/${task.id}/complete`, {});

  assert.equal(response.status, 200);
  assert.equal(response.json.completionContract.contract, "deliverable");
  assert.equal(response.json.completionContract.requiresArtifact, true);
  assert.equal(response.json.completionOutcome, "");
  assert.equal(response.json.completionRating, "");
});
