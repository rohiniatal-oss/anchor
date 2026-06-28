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
