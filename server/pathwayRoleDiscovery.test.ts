import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { contractForTaskIntent } from "./taskIntent";
import { buildTrackPlan } from "./trackPlanner";
import { api, makeHarness, type Harness } from "./spine.harness";
import { PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS } from "./pathwayRoleDiscovery";

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
    slug: "ai-governance-strategy",
    name: "AI Governance Strategy",
    description: "Explore AI governance strategy as a career pathway",
    targetRoleArchetype: "AI governance strategy",
    priority: 90,
    status: "active",
    whyItFits: "Builds on policy, strategy, and delivery experience",
  } as any);
}

test("empty active pathway asks Anchor to discover role targets, not manual job entry", async () => {
  const track = await createAiGovernanceTrack();
  const plan = buildTrackPlan(track, { tasks: [], jobs: [], learn: [], hustles: [], contacts: [] });

  assert.match(plan.primaryNeed.move, /Anchor discover real AI governance strategy role targets/i);
  assert.doesNotMatch(plan.primaryNeed.move, /save one real .*posting/i);
  assert.match(plan.primaryNeed.doneWhen, /ranked from public evidence/i);
  assert.match(plan.primaryNeed.reason, /pathway, not a manual data-entry request/i);
});

test("plan generation autopopulates one role discovery task from an active pathway", async () => {
  const track = await createAiGovernanceTrack();
  const response = await fetch(`${h.base}/api/plan/current?day=2026-06-30&energy=medium`);
  const json = await response.json();
  const tasks = await h.storage.getTasks();
  const discoveryTasks = tasks.filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS);

  assert.equal(response.status, 200);
  assert.ok(json.items.some((item: any) => /Anchor discover real AI governance strategy role targets/i.test(item.title)));
  assert.equal(discoveryTasks.length, 1);
  assert.equal(discoveryTasks[0].relatedTrackId, track.id);
  assert.equal(discoveryTasks[0].sourceType, "career_track");
  assert.equal(discoveryTasks[0].sourceStepType, "role_discovery");
  assert.equal(discoveryTasks[0].list, "today");
  assert.match(discoveryTasks[0].doneWhen, /only user-approved options become Jobs/i);
});

test("recomputing the plan reuses the active pathway discovery task", async () => {
  await createAiGovernanceTrack();

  const first = await api(h.base, "POST", "/api/plan/recompute", { day: "2026-06-30", energy: "medium" });
  const second = await api(h.base, "POST", "/api/plan/recompute", { day: "2026-06-30", energy: "medium" });
  const discoveryTasks = (await h.storage.getTasks()).filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(discoveryTasks.length, 1);
  assert.ok(second.json.items.some((item: any) => item.taskId === discoveryTasks[0].id || item.sourceId === discoveryTasks[0].id));
});

test("role market scan contract is Anchor-first", () => {
  const contract = contractForTaskIntent({
    title: "Have Anchor discover real AI governance strategy role targets",
    sourceType: "career_track",
    lane: "Direction",
  });

  assert.equal(contract.intent, "role_market_scan");
  assert.match(contract.firstStep, /Let Anchor search/i);
  assert.doesNotMatch(contract.firstStep, /Open LinkedIn/i);
  assert.match(contract.doneWhen, /ranked from evidence/i);
  assert.match(contract.stopCondition, /activated one, saved one for later, or rejected the set/i);
});
