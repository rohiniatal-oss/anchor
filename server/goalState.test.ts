import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildCareerGoalState } from "./goalState";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("career goal state prioritises Direction when no signal exists", () => {
  const state = buildCareerGoalState([], [], []);
  assert.equal(state.goal, "Find the right role, then become interview- and job-ready");
  assert.equal(state.phase, "fit-discovery");
  assert.equal(state.recommendedFocus, "Direction");
  assert.equal(state.dayType, "signal-building");
  assert.match(state.reason, /Direction/);
  assert.ok(state.workstreams.some((w) => w.name === "Applications" && w.status === "premature"));
  assert.ok(state.trajectory.some((s) => s.key === "discover-fit" && s.status === "current"));
});

test("career goal state reflects saved roles and feedback", () => {
  const jobs = Array.from({ length: 6 }).map((_, i) => ({
    id: i + 1,
    title: `AI Policy Strategy ${i}`,
    company: "Example",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "London",
  })) as any;
  const log = [
    { id: 1, eventType: "role_attribute_feedback", sourceType: "role_attribute", sourceId: null, taskId: null, planItemId: null, metadata: JSON.stringify({ attributeType: "topicAreas", attribute: "AI or technology", reaction: "energising" }), timestamp: Date.now() } as any,
  ];
  const state = buildCareerGoalState([], jobs, log);
  const direction = state.workstreams.find((w) => w.name === "Direction")!;
  assert.equal(direction.progress, "developing");
  assert.ok(direction.evidence.some((e) => e.includes("open or saved roles")));
  assert.equal(state.phase, "role-targeting");
  assert.ok(state.workstreams.some((w) => w.name === "Applications" && w.status === "premature"));
});

test("career goal state enters lane-narrowing when multiple role hypotheses are live", () => {
  const jobs = [
    { id: 1, title: "AI Strategy Associate", company: "Frontier Lab", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "strategy" },
    { id: 2, title: "Geopolitical Risk Analyst", company: "Advisory Group", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "advisory" },
    { id: 3, title: "Chief of Staff", company: "AI Lab", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "operations" },
  ] as any;
  const state = buildCareerGoalState([], jobs, []);
  assert.equal(state.phase, "lane-narrowing");
  assert.ok(state.roleHypotheses.includes("AI strategy"));
  assert.ok(state.roleHypotheses.includes("Geopolitics / geopolitical advisory"));
  assert.equal(state.comparisonAxes.mode, "two-axis");
  assert.equal(state.decisionMode, "parallel-exploration");
  assert.ok(state.comparisonAxes.topicHypotheses.includes("AI / technology strategy"));
  assert.ok(state.comparisonAxes.topicHypotheses.includes("Geopolitics / geopolitical advisory"));
  assert.ok(state.comparisonAxes.roleShapeHypotheses.includes("Strategy / advisory"));
  assert.ok(state.comparisonAxes.roleShapeHypotheses.includes("Ops / chief of staff"));
  assert.equal(state.experiments.length, 4);
  assert.match(state.decisionQuestion, /What are you learning from each of the four combinations/i);
  assert.match(state.explorationStrategy, /Run all four combinations in parallel/i);
});

test("goal state API returns active goal with workstreams and today plan", async () => {
  const r = await api(h.base, "GET", "/api/goals/state");
  assert.equal(r.status, 200);
  assert.equal(r.json.goals.length, 1);
  const goal = r.json.goals[0];
  assert.equal(goal.status, "active");
  assert.ok(goal.workstreams.length >= 5);
  assert.ok(goal.todayPlan.mustDo);
  assert.ok(goal.phase);
  assert.ok(goal.comparisonAxes);
  assert.ok(Array.isArray(goal.trajectory) && goal.trajectory.length >= 4);
  assert.ok(goal.trace.length >= 1);
});
