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

test("discovery start prefers a lower-overwhelm comparison move when the user is split and overwhelmed", async () => {
  const r = await api(h.base, "POST", "/api/discovery/start", {
    concern: "I need a job soon but I am overwhelmed and torn between AI strategy, geopolitics, and chief of staff.",
  });

  assert.equal(r.status, 200);
  assert.equal(r.json.recommendedRoute.key, "fit-clarification");
  assert.match(String(r.json.recommendedRoute.reason || ""), /least overwhelming|inspect one role type/i);
  assert.match(String(r.json.tinyNextAction.title || ""), /one role type/i);
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

test("discovery commit uses the selected route rather than the originally recommended one", async () => {
  const started = await api(h.base, "POST", "/api/discovery/start", {
    concern: "I need to get a job soon but networking is probably the bottleneck",
  });
  assert.equal(started.status, 200);
  assert.notEqual(started.json.recommendedRoute.key, "capability-ramp");
  assert.ok(started.json.routePreviews?.["capability-ramp"]);

  const committed = await api(h.base, "POST", `/api/discovery/${started.json.discoveryId}/commit`, {
    routeKey: "capability-ramp",
  });

  assert.equal(committed.status, 200);
  assert.equal(committed.json.routeCommitted, "capability-ramp");
  assert.match(String(committed.json.todayAction.title || ""), /requirement|weak today/i);
  assert.match(String(committed.json.todayAction.sourceStatus || ""), /capability-ramp/);
});

test("discovery commit keeps support moves out of Today so the starting plan stays small", async () => {
  const started = await api(h.base, "POST", "/api/discovery/start", {
    concern: "I need to figure out which role type actually fits before I go wider",
  });
  assert.equal(started.status, 200);

  const committed = await api(h.base, "POST", `/api/discovery/${started.json.discoveryId}/commit`, {
    routeKey: "fit-clarification",
  });

  assert.equal(committed.status, 200);
  const createdTasks = committed.json.createdTasks || [];
  assert.ok(createdTasks.length >= 1);
  const todayTasks = createdTasks.filter((task: any) => task.list === "today");
  const inboxTasks = createdTasks.filter((task: any) => task.list === "inbox");
  assert.equal(todayTasks.length, 1);
  assert.ok(inboxTasks.length >= 1, "support move should stay out of Today");
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

test("discovery start keeps explicitly named career lanes visible on a blank system", async () => {
  const r = await api(h.base, "POST", "/api/discovery/start", {
    concern: "I need a credible role soon, but I am split between AI strategy, geopolitics, and chief of staff paths.",
  });

  assert.equal(r.status, 200);
  const trackNames = (r.json.trackDrafts || []).map((track: any) => String(track.name).toLowerCase());
  assert.ok(trackNames.some((name: string) => name.includes("ai strategy")));
  assert.ok(trackNames.some((name: string) => name.includes("geopolitics")));
  assert.ok(trackNames.some((name: string) => name.includes("chief of staff")));
  assert.ok(trackNames.every((name: string) => !name.includes("general strategy and advisory")));
  assert.match(String(r.json.tinyNextAction.firstStep || ""), /job sources|ai strategy|geopolitical|chief of staff/i);
  assert.ok((r.json.knowns || []).some((line: string) => line.includes("You explicitly named these role types")));
});
