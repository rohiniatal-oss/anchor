import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("discovery start turns a vague career concern into a working goal draft and route", async () => {
  const r = await api(h.base, "POST", "/api/discovery/start", {
    concern: "I need to get a job but I do not know which role fits me best",
  });

  assert.equal(r.status, 200);
  assert.equal(r.json.input.domain, "career");
  assert.equal(r.json.recommendedRoute.key, "broad-role-pursuit");
  assert.ok(Array.isArray(r.json.routes) && r.json.routes.length >= 3);
  assert.ok(Array.isArray(r.json.unknowns) && r.json.unknowns.length >= 2);
  assert.ok(r.json.workingGoalDraft.title.length > 0);
  assert.ok(r.json.tinyNextAction.firstStep.length > 0);
});

test("discovery commit creates tracks and execution-ready tasks from a career route", async () => {
  const started = await api(h.base, "POST", "/api/discovery/start", {
    concern: "I need to sort out my career and get a job soon",
  });
  assert.equal(started.status, 200);

  const committed = await api(h.base, "POST", `/api/discovery/${started.json.discoveryId}/commit`, {
    routeKey: "broad-role-pursuit",
    answers: { "location-flexibility": "UAE, Remote, London" },
  });

  assert.equal(committed.status, 200);
  assert.equal(committed.json.routeCommitted, "broad-role-pursuit");
  assert.ok(committed.json.createdTracks.length >= 1);
  assert.ok(committed.json.createdTasks.length >= 1);
  assert.equal(committed.json.todayAction.list, "today");
  assert.equal(committed.json.todayAction.sourceType, "discovery_session");

  const steps = JSON.parse(committed.json.todayAction.steps || "[]");
  assert.ok(steps.length >= 1);
  assert.ok(typeof steps[0].text === "string" && steps[0].text.length > 0);

  const session = await h.storage.getDiscoverySession(started.json.discoveryId);
  assert.equal(session?.status, "committed");

  const log = await h.storage.getActivityLog();
  assert.ok(log.some((entry) => entry.eventType === "discovery_started" && entry.sourceId === started.json.discoveryId));
  assert.ok(log.some((entry) => entry.eventType === "discovery_committed" && entry.sourceId === started.json.discoveryId));
});

test("discovery start supports a non-career concern without creating fake career routes", async () => {
  const r = await api(h.base, "POST", "/api/discovery/start", {
    concern: "My health feels chaotic and stuck",
  });

  assert.equal(r.status, 200);
  assert.equal(r.json.input.domain, "health");
  assert.equal(r.json.recommendedRoute.key, "reduce-friction");
  assert.ok(r.json.routes.every((route: any) => route.key !== "broad-role-pursuit"));
  assert.match(r.json.tinyNextAction.title, /friction|health/i);
});
