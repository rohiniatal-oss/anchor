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

test("task completion contract endpoint classifies reading as exposure", async () => {
  const task = await h.storage.createTask({
    title: "Read 25 minutes of AI governance primer",
    list: "inbox",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: "learning",
    deadline: "",
    size: "quick",
    status: "not_started",
    skipped: 0,
    doneWhen: "Read for 25 minutes",
    sourceType: "task",
    sourceNote: "",
    sourceStatus: "",
    minimumOutcome: "Read for 25 minutes",
    readiness: "ready",
  } as any);

  const response = await api(h.base, "GET", `/api/tasks/${task.id}/completion-contract`);

  assert.equal(response.status, 200);
  assert.equal(response.json.entityType, "task");
  assert.equal(response.json.contract.contract, "exposure");
  assert.equal(response.json.contract.requiresArtifact, false);
});

test("learn completion contract endpoint does not force artifacts for pure resources", async () => {
  const learn = await h.storage.createLearn({
    title: "AI governance primer",
    type: "resource",
    learnStatus: "open",
    done: false,
    note: "Background reading",
    requiredOutput: "",
    outputTitle: "",
    outputStatus: "",
    outputEvidenceUrl: "",
    proofIntent: false,
  } as any);

  const response = await api(h.base, "GET", `/api/learn/${learn.id}/completion-contract`);

  assert.equal(response.status, 200);
  assert.equal(response.json.entityType, "learn");
  assert.equal(response.json.contract.contract, "exposure");
  assert.equal(response.json.contract.requiresArtifact, false);
});

test("learn completion contract endpoint requires artifacts for proof intent", async () => {
  const learn = await h.storage.createLearn({
    title: "Write AI governance memo",
    type: "resource",
    learnStatus: "open",
    done: false,
    note: "",
    requiredOutput: "memo",
    outputTitle: "",
    outputStatus: "idea",
    outputEvidenceUrl: "",
    proofIntent: true,
  } as any);

  const response = await api(h.base, "GET", `/api/learn/${learn.id}/completion-contract`);

  assert.equal(response.status, 200);
  assert.equal(response.json.contract.contract, "deliverable");
  assert.equal(response.json.contract.requiresArtifact, true);
});
