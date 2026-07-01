import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { contractForTaskIntent } from "./taskIntent";
import { buildTrackPlan } from "./trackPlanner";
import { api, makeHarness, type Harness } from "./spine.harness";
import {
  ensurePathwayRoleDiscoveryRuns,
  PATHWAY_ROLE_DISCOVERY_PLAN_SOURCE,
  PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS,
  roleDiscoveryForTrack,
} from "./pathwayRoleDiscovery";

let h: Harness;
const previousExternalResearchMode = process.env.ANCHOR_EXTERNAL_RESEARCH_MOCK_MODE;

before(async () => {
  process.env.ANCHOR_EXTERNAL_RESEARCH_MOCK_MODE = "success";
  h = await makeHarness();
});

after(async () => {
  if (previousExternalResearchMode === undefined) delete process.env.ANCHOR_EXTERNAL_RESEARCH_MOCK_MODE;
  else process.env.ANCHOR_EXTERNAL_RESEARCH_MOCK_MODE = previousExternalResearchMode;
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

test("pathway role discovery runs as internal evidence and creates no Today task", async () => {
  const track = await createAiGovernanceTrack();
  const result = await ensurePathwayRoleDiscoveryRuns({ tasks: [], jobs: [], tracks: [track], mockMode: "success" });
  const tasks = await h.storage.getTasks();
  const refreshedTrack = await h.storage.getCareerTrack(track.id);
  const snapshot = refreshedTrack ? roleDiscoveryForTrack(refreshedTrack) : null;

  assert.equal(result.tasks.length, 0);
  assert.equal(tasks.length, 0);
  assert.equal(result.discoveries.length, 1);
  assert.equal(result.discoveries[0].status, "complete");
  assert.equal(snapshot?.status, "complete");
  assert.ok((snapshot?.roles.length || 0) > 0);
  assert.ok((snapshot?.repeatedRequirements.length || 0) > 0);
});

test("plan recompute runs internal pathway discovery in the active Today path", async () => {
  const track = await createAiGovernanceTrack();

  const res = await api(h.base, "POST", "/api/plan/recompute", {
    day: "2026-07-01",
    energy: "medium",
    availableMinutes: 240,
  });

  assert.equal(res.status, 200);
  const tasks = await h.storage.getTasks();
  const refreshedTrack = await h.storage.getCareerTrack(track.id);
  const snapshot = refreshedTrack ? roleDiscoveryForTrack(refreshedTrack) : null;

  assert.equal(tasks.filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS).length, 0);
  assert.equal(snapshot?.status, "complete");
  assert.ok(res.json.items.some((item: any) => item.sourceType === PATHWAY_ROLE_DISCOVERY_PLAN_SOURCE));
});

test("tight broad-pursuit recompute shows Anchor-owned discovery instead of the manual role goal", async () => {
  await createAiGovernanceTrack();
  await createOperationsStrategyTrack();

  const res = await api(h.base, "POST", "/api/plan/recompute", {
    day: "2026-07-02",
    energy: "low",
    availableMinutes: 60,
  });

  assert.equal(res.status, 200);
  const tasks = await h.storage.getTasks();
  const titles = res.json.items.map((item: any) => item.title).join(" | ");

  assert.equal(tasks.filter((task) => task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS).length, 0);
  assert.equal(res.json.items[0].sourceType, PATHWAY_ROLE_DISCOVERY_PLAN_SOURCE);
  assert.match(titles, /Anchor .*AI governance strategy|Anchor .*operations strategy/i);
  assert.doesNotMatch(titles, /Have Anchor discover|Review the ranked options|Save one real .*posting|Add one real role/i);
});

test("pathway role discovery reuses fresh internal evidence", async () => {
  const track = await createAiGovernanceTrack();

  const first = await ensurePathwayRoleDiscoveryRuns({ tasks: [], jobs: [], tracks: [track], mockMode: "success" });
  const refreshed = await h.storage.getCareerTrack(track.id);
  const second = await ensurePathwayRoleDiscoveryRuns({ tasks: [], jobs: [], tracks: refreshed ? [refreshed] : [track], mockMode: "success" });

  assert.equal(first.discoveries.length, 1);
  assert.equal(second.discoveries.length, 1);
  assert.equal(first.discoveries[0].generatedAt, second.discoveries[0].generatedAt);
});

test("role market scan contract is Anchor-first for legacy task-shell compatibility", () => {
  const contract = contractForTaskIntent({
    title: "Have Anchor discover real AI governance strategy role targets",
    sourceType: "career_track",
    lane: "Direction",
  });

  assert.equal(contract.intent, "role_market_scan");
  assert.match(contract.firstStep, /Anchor search/i);
  assert.doesNotMatch(contract.firstStep, /Open LinkedIn/i);
  assert.match(contract.doneWhen, /ranked from evidence/i);
});
