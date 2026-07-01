import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { contractForTaskIntent } from "./taskIntent";
import { buildTrackPlan } from "./trackPlanner";
import { api, makeHarness, type Harness } from "./spine.harness";
import { ensurePathwayRoleDiscoveryTasks, PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS } from "./pathwayRoleDiscovery";

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

async function createOperationsStrategyTrack() {
  return h.storage.createCareerTrack({
    slug: "operations-strategy",
    name: "Operations Strategy",
    description: "Explore operations and chief of staff strategy roles as a pathway",
    targetRoleArchetype: "operations strategy chief of staff",
    priority: 80,
    status: "active",
    whyItFits: "Builds on strategy, delivery, and cross-functional operating experience",
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

test("pathway helper autopopulates one role discovery task from an active pathway", async () => {
  const track = await createAiGovernanceTrack();
  const tasks = await ensurePathwayRoleDiscoveryTasks({ tasks: [], jobs: [], tracks: [track] });
  const discoveryTasks = tasks.filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS);

  assert.equal(discoveryTasks.length, 1);
  assert.equal(discoveryTasks[0].relatedTrackId, track.id);
  assert.equal(discoveryTasks[0].sourceType, "career_track");
  assert.equal(discoveryTasks[0].sourceStepType, "role_discovery");
  assert.equal(discoveryTasks[0].list, "today");
  assert.match(discoveryTasks[0].title, /Anchor discover real AI governance strategy role targets/i);
  assert.match(discoveryTasks[0].doneWhen, /only user-approved options become Jobs/i);
});

test("plan recompute seeds pathway role discovery in the active Today path", async () => {
  const track = await createAiGovernanceTrack();

  const res = await api(h.base, "POST", "/api/plan/recompute", {
    day: "2026-07-01",
    energy: "medium",
    availableMinutes: 240,
  });

  assert.equal(res.status, 200);
  const discoveryTasks = (await h.storage.getTasks()).filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS);

  assert.equal(discoveryTasks.length, 1);
  assert.equal(discoveryTasks[0].relatedTrackId, track.id);
  assert.ok(res.json.items.some((item: any) => item.taskId === discoveryTasks[0].id));
  assert.match(res.json.items.map((item: any) => item.title).join(" | "), /Anchor discover real AI governance strategy role targets/i);
});

test("tight broad-pursuit recompute shows Anchor discovery instead of the manual role goal", async () => {
  await createAiGovernanceTrack();
  await createOperationsStrategyTrack();

  const res = await api(h.base, "POST", "/api/plan/recompute", {
    day: "2026-07-02",
    energy: "low",
    availableMinutes: 60,
  });

  assert.equal(res.status, 200);
  const discoveryTasks = (await h.storage.getTasks()).filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS);
  const titles = res.json.items.map((item: any) => item.title).join(" | ");

  assert.ok(discoveryTasks.length >= 1);
  assert.equal(res.json.items[0].sourceType, "task");
  assert.equal(res.json.items[0].sourceStatus, PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS);
  assert.ok(discoveryTasks.some((task) => task.id === res.json.items[0].taskId));
  assert.match(titles, /Anchor discover real .* role targets/i);
  assert.doesNotMatch(titles, /Save one real .*posting|Add one real role/i);
});

test("pathway helper reuses the active pathway discovery task", async () => {
  const track = await createAiGovernanceTrack();

  const first = await ensurePathwayRoleDiscoveryTasks({ tasks: [], jobs: [], tracks: [track] });
  const second = await ensurePathwayRoleDiscoveryTasks({ tasks: first, jobs: [], tracks: [track] });
  const discoveryTasks = second.filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS);

  assert.equal(discoveryTasks.length, 1);
});

test("role market scan contract is Anchor-first", () => {
  const contract = contractForTaskIntent({
    title: "Have Anchor discover real AI governance strategy role targets",
    sourceType: "career_track",
    lane: "Direction",
  });

  assert.equal(contract.intent, "role_market_scan");
  assert.match(contract.firstStep, /Anchor search/i);
  assert.doesNotMatch(contract.firstStep, /Open LinkedIn/i);
  assert.match(contract.doneWhen, /ranked from evidence/i);
  assert.match(contract.stopCondition, /activated one, saved one for later, rejected the set/i);
});