import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildCareerGoalState, deriveCareerGoalFrame } from "./goalState";
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

test("career goal state enters broad parallel pursuit when multiple plausible lanes already have live roles", () => {
  const jobs = [
    { id: 1, title: "AI Strategy Associate", company: "Frontier Lab", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "strategy" },
    { id: 2, title: "Geopolitical Risk Analyst", company: "Advisory Group", status: "wishlist", applicationWindowStatus: "open", location: "Dubai, UAE", roleArchetype: "advisory" },
    { id: 3, title: "Chief of Staff", company: "AI Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "operations" },
  ] as any;
  const state = buildCareerGoalState([], jobs, []);
  assert.equal(state.phase, "role-targeting");
  assert.ok(state.roleHypotheses.includes("AI strategy"));
  assert.ok(state.roleHypotheses.includes("Geopolitics / geopolitical advisory"));
  assert.equal(state.comparisonAxes.mode, "two-axis");
  assert.equal(state.decisionMode, "broad-parallel-pursuit");
  assert.ok(state.comparisonAxes.topicHypotheses.includes("AI / technology strategy"));
  assert.ok(state.comparisonAxes.topicHypotheses.includes("Geopolitics / geopolitical advisory"));
  assert.ok(state.comparisonAxes.roleShapeHypotheses.includes("Strategy / advisory"));
  assert.ok(state.comparisonAxes.roleShapeHypotheses.includes("Ops / chief of staff"));
  assert.equal(state.pursuitPortfolio.length, 4);
  assert.equal(state.landingPriority, "credible-role-quickly");
  assert.match(state.selectionRule, /UAE, Remote, or London/i);
  assert.equal(state.locationPreference.flexible, true);
  assert.deepEqual(state.locationPreference.ordered, ["UAE", "Remote", "London"]);
  assert.equal(state.locationPreference.counts.acceptable, 3);
  assert.match(state.decisionQuestion, /Which live roles are most gettable/i);
  assert.match(state.explorationStrategy, /broad pursuit portfolio/i);
});

test("career goal frame stays in fit-discovery when learning exists but role signal does not", () => {
  const learn = [{
    id: 1,
    title: "AI strategy memo drill",
    requiredOutput: "one memo paragraph",
    active: true,
    proofIntent: true,
    done: false,
    learnStatus: "active",
    applicationDeadline: "",
    url: "",
    note: "",
    relatedTrackId: null,
  }] as any;

  const frame = deriveCareerGoalFrame([], [], [], learn);
  assert.equal(frame.phase, "fit-discovery");
  assert.equal(frame.recommendedFocus, "Direction");
  assert.equal(frame.dayType, "signal-building");
  assert.equal(frame.decisionMode, "single-track");
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
  assert.ok(goal.selectionRule);
  assert.ok(goal.locationPreference);
  assert.ok(Array.isArray(goal.trajectory) && goal.trajectory.length >= 4);
  assert.ok(goal.trace.length >= 1);
});
