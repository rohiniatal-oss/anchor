import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";
import {
  extractSearchDiscoveryTarget,
  isCareerDirectionResearchTitle,
  isSearchDiscoveryTitle,
} from "@shared/captureResearch";

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

test("search discovery titles are distinct from career-direction research", () => {
  assert.equal(isSearchDiscoveryTitle("Find three AI governance roles"), true);
  assert.equal(extractSearchDiscoveryTarget("Find three AI governance roles"), "three AI governance roles");
  assert.equal(isSearchDiscoveryTitle("Search for Bain alumni in AI strategy"), true);
  assert.equal(extractSearchDiscoveryTarget("Search for Bain alumni in AI strategy"), "Bain alumni in AI strategy");
  assert.equal(isSearchDiscoveryTitle("Look up courses on AI safety"), true);
  assert.equal(isSearchDiscoveryTitle("Find time to call Sarah"), false);
  assert.equal(isCareerDirectionResearchTitle("Explore AI strategy roles"), true);
});

test("capture suggest labels search discovery as preview-first work", async () => {
  const capture = await h.storage.createTask({
    title: "Find three AI governance roles",
    list: "inbox",
    done: false,
    category: "admin",
  } as any);

  const response = await api(h.base, "POST", `/api/capture/${capture.id}/suggest`);

  assert.equal(response.status, 200);
  assert.equal(response.json.suggestion.route, "research");
  assert.equal(response.json.suggestion.label, "Search / Discover");
  assert.match(response.json.suggestion.reason, /preview/i);
});

test("capture sort overrides legacy job and learn classification for search discovery", async () => {
  const roleSearch = await h.storage.createTask({ title: "Find three AI governance roles", list: "inbox", done: false } as any);
  const courseSearch = await h.storage.createTask({ title: "Look up courses on AI safety", list: "inbox", done: false } as any);
  const atomic = await h.storage.createTask({ title: "Send Sarah the deck", list: "inbox", done: false } as any);

  const response = await api(h.base, "POST", "/api/capture/sort");
  assert.equal(response.status, 200);
  const byId = new Map(response.json.suggestions.map((suggestion: any) => [suggestion.id, suggestion]));

  assert.equal((byId.get(roleSearch.id) as any).route, "research");
  assert.equal((byId.get(roleSearch.id) as any).label, "Search / Discover");
  assert.equal((byId.get(courseSearch.id) as any).route, "research");
  assert.equal((byId.get(courseSearch.id) as any).label, "Search / Discover");
  assert.notEqual((byId.get(atomic.id) as any).label, "Search / Discover");
});

test("direct search discovery routing cannot create jobs learn items contacts proof assets or tasks", async () => {
  const roleSearch = await h.storage.createTask({ title: "Find three AI governance roles", list: "inbox", done: false } as any);
  const courseSearch = await h.storage.createTask({ title: "Look up courses on AI safety", list: "inbox", done: false } as any);
  const peopleSearch = await h.storage.createTask({ title: "Search for Bain alumni in AI strategy", list: "inbox", done: false } as any);
  const proofSearch = await h.storage.createTask({ title: "Shortlist AI governance memo examples", list: "inbox", done: false } as any);

  const before = {
    tasks: (await h.storage.getTasks()).length,
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };

  const jobResponse = await api(h.base, "POST", `/api/capture/${roleSearch.id}/route`, { route: "job" });
  const learnResponse = await api(h.base, "POST", `/api/capture/${courseSearch.id}/route`, { route: "learn" });
  const networkResponse = await api(h.base, "POST", `/api/capture/${peopleSearch.id}/route`, { route: "network" });
  const proofResponse = await api(h.base, "POST", `/api/capture/${proofSearch.id}/route`, { route: "proof" });

  for (const response of [jobResponse, learnResponse, networkResponse, proofResponse]) {
    assert.equal(response.status, 409);
    assert.equal(response.json.code, "work_interpretation_required");
    assert.equal(response.json.nextAction, "interpret_work");
    assert.equal(response.json.downstreamObjectsCreated.jobs, 0);
    assert.equal(response.json.downstreamObjectsCreated.learningItems, 0);
    assert.equal(response.json.downstreamObjectsCreated.contacts, 0);
    assert.equal(response.json.downstreamObjectsCreated.proofAssets, 0);
    assert.equal(response.json.downstreamObjectsCreated.tasks, 0);
  }

  const after = {
    tasks: (await h.storage.getTasks()).length,
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };
  assert.deepEqual(after, before);
});
