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

async function createAiGovernanceTrack() {
  return h.storage.createCareerTrack({
    slug: "ai-governance",
    name: "AI Governance",
    description: "AI governance and frontier model risk work",
    targetRoleArchetype: "AI governance strategy roles",
    priority: 90,
    status: "active",
    whyItFits: "Builds on strategy and delivery experience",
    trackIntelligence: JSON.stringify({ domains: ["risk frameworks", "model governance", "AI regulation"] }),
  } as any);
}

async function approveFirstSprintTask(list: "inbox" | "today" = "inbox") {
  const track = await createAiGovernanceTrack();
  await h.storage.createLearn({
    title: "AI governance primer",
    learnStatus: "open",
    done: false,
    relatedTrackId: track.id,
    requiredOutput: "terrain map",
    type: "resource",
  } as any);
  const response = await api(h.base, "POST", `/api/competence/development-sprints/${track.id}/approve`, { list });
  assert.ok([200, 201].includes(response.status), JSON.stringify(response.json));
  return { track, response, task: response.json.task };
}

test("approving a competence development sprint creates exactly one first task with sprint context", async () => {
  const track = await createAiGovernanceTrack();
  await h.storage.createLearn({
    title: "AI governance primer",
    learnStatus: "open",
    done: false,
    relatedTrackId: track.id,
    requiredOutput: "terrain map",
    type: "resource",
  } as any);

  const beforeTasks = await h.storage.getTasks();
  const response = await api(h.base, "POST", `/api/competence/development-sprints/${track.id}/approve`, { list: "inbox" });
  const afterTasks = await h.storage.getTasks();

  assert.equal(response.status, 201);
  assert.equal(response.json.approved, true);
  assert.equal(response.json.reused, false);
  assert.equal(response.json.downstreamTasksCreated, 1);
  assert.equal(afterTasks.length, beforeTasks.length + 1);

  const task = afterTasks.find((item) => item.sourceType === "competence_development_sprint");
  assert.ok(task);
  assert.equal(task?.relatedTrackId, track.id);
  assert.equal(task?.list, "inbox");
  assert.match(task?.sourceStatus || "", /competence_sprint:domain_judgement:experience_1:task_1/);
  assert.match(task?.title || "", /Prepare the input/i);
  assert.match(task?.doneWhen || "", /case|source|person|prompt/i);

  const sourceNote = JSON.parse(task?.sourceNote || "{}");
  assert.equal(sourceNote.sprint.targetCompetencyKey, "domain_judgement");
  assert.equal(sourceNote.sprint.developmentObjective, "build_competence");
  assert.match(sourceNote.experience.title, /Apply one AI Governance framework/i);
  assert.ok(sourceNote.experience.assessmentRubric.weak);
  assert.equal(sourceNote.taskBlueprint.createsLiveTask, false);
  assert.equal(sourceNote.experience.taskBlueprints.length, 3);
});

test("approving the same sprint twice reuses the existing first task", async () => {
  const track = await createAiGovernanceTrack();
  await h.storage.createLearn({ title: "AI governance primer", learnStatus: "open", done: false, relatedTrackId: track.id, requiredOutput: "terrain map", type: "resource" } as any);

  const first = await api(h.base, "POST", `/api/competence/development-sprints/${track.id}/approve`, { list: "today" });
  const second = await api(h.base, "POST", `/api/competence/development-sprints/${track.id}/approve`, { list: "today" });
  const sprintTasks = (await h.storage.getTasks()).filter((item) => item.sourceType === "competence_development_sprint");

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.reused, true);
  assert.equal(second.json.downstreamTasksCreated, 0);
  assert.equal(second.json.task.id, first.json.task.id);
  assert.equal(sprintTasks.length, 1);
  assert.equal(sprintTasks[0].list, "today");
});

test("background sprint approval is blocked before task creation", async () => {
  const track = await createAiGovernanceTrack();
  const response = await fetch(`${h.base}/api/competence/development-sprints/${track.id}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Anchor-User-Intent": "background",
    },
    body: JSON.stringify({ list: "inbox" }),
  });
  const json = await response.json();

  assert.equal(response.status, 409);
  assert.equal(json.code, "explicit_user_intent_required");
  assert.equal((await h.storage.getTasks()).filter((item) => item.sourceType === "competence_development_sprint").length, 0);
});

test("approving a missing or inactive sprint returns a clear not found response", async () => {
  const response = await api(h.base, "POST", "/api/competence/development-sprints/999/approve", { list: "inbox" });

  assert.equal(response.status, 404);
  assert.equal(response.json.code, "sprint_not_found");
  assert.equal((await h.storage.getTasks()).length, 0);
});

test("adequate assessment records evidence and unlocks only the next sprint blueprint", async () => {
  const { task } = await approveFirstSprintTask("inbox");
  await h.storage.updateTask(task.id, { done: true, status: "done" } as any);

  const response = await api(h.base, "POST", `/api/competence/development-sprints/tasks/${task.id}/assess`, {
    rating: "adequate",
    note: "Applied the framework and found the key uncertainty.",
    list: "inbox",
  });
  const sprintTasks = (await h.storage.getTasks()).filter((item) => item.sourceType === "competence_development_sprint");
  const wins = await h.storage.getWins();

  assert.equal(response.status, 201);
  assert.equal(response.json.assessed, true);
  assert.equal(response.json.rating, "adequate");
  assert.equal(response.json.nextTaskCreated, 1);
  assert.equal(response.json.reusedNextTask, false);
  assert.match(response.json.nextTask.sourceStatus, /task_2/);
  assert.equal(sprintTasks.length, 2, "assessment should unlock one next task, not the whole sprint");
  assert.equal(sprintTasks.filter((item) => !item.done).length, 1);
  assert.match(wins[0].takeaway, /adequate/i);
  assert.match(wins[0].takeaway, /key uncertainty/i);

  const assessed = (await h.storage.getTasks()).find((item) => item.id === task.id)!;
  assert.match(assessed.sourceStatus, /assessed_adequate/);
  const sourceNote = JSON.parse(assessed.sourceNote || "{}");
  assert.equal(sourceNote.assessment.rating, "adequate");
});

test("weak assessment records evidence but does not unlock the next sprint task", async () => {
  const { task } = await approveFirstSprintTask("inbox");
  await h.storage.updateTask(task.id, { done: true, status: "done" } as any);

  const response = await api(h.base, "POST", `/api/competence/development-sprints/tasks/${task.id}/assess`, {
    rating: "weak",
    note: "Only summarized the source.",
  });
  const sprintTasks = (await h.storage.getTasks()).filter((item) => item.sourceType === "competence_development_sprint");

  assert.equal(response.status, 200);
  assert.equal(response.json.nextTaskCreated, 0);
  assert.equal(response.json.nextTask, null);
  assert.match(response.json.nextAction, /Do not unlock/i);
  assert.equal(sprintTasks.length, 1);
});

test("assessment before completion is blocked", async () => {
  const { task } = await approveFirstSprintTask("inbox");

  const response = await api(h.base, "POST", `/api/competence/development-sprints/tasks/${task.id}/assess`, {
    rating: "adequate",
  });

  assert.equal(response.status, 409);
  assert.equal(response.json.code, "task_not_complete");
  assert.equal((await h.storage.getTasks()).filter((item) => item.sourceType === "competence_development_sprint").length, 1);
});

test("repeated adequate assessment reuses the unlocked next task", async () => {
  const { task } = await approveFirstSprintTask("inbox");
  await h.storage.updateTask(task.id, { done: true, status: "done" } as any);

  const first = await api(h.base, "POST", `/api/competence/development-sprints/tasks/${task.id}/assess`, { rating: "adequate" });
  const second = await api(h.base, "POST", `/api/competence/development-sprints/tasks/${task.id}/assess`, { rating: "adequate" });
  const sprintTasks = (await h.storage.getTasks()).filter((item) => item.sourceType === "competence_development_sprint");

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.nextTaskCreated, 0);
  assert.equal(second.json.reusedNextTask, true);
  assert.equal(second.json.nextTask.id, first.json.nextTask.id);
  assert.equal(sprintTasks.length, 2);
});

test("background sprint assessment is blocked before evidence or next-task creation", async () => {
  const { task } = await approveFirstSprintTask("inbox");
  await h.storage.updateTask(task.id, { done: true, status: "done" } as any);

  const response = await fetch(`${h.base}/api/competence/development-sprints/tasks/${task.id}/assess`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Anchor-User-Intent": "background",
    },
    body: JSON.stringify({ rating: "adequate" }),
  });
  const json = await response.json();

  assert.equal(response.status, 409);
  assert.equal(json.code, "explicit_user_intent_required");
  assert.equal((await h.storage.getWins()).length, 0);
  assert.equal((await h.storage.getTasks()).filter((item) => item.sourceType === "competence_development_sprint").length, 1);
});
