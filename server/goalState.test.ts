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
  const direction = state.workstreams.find((w) => w.name === "Direction")!;
  const marketMap = state.workstreams.find((w) => w.name === "Market map")!;
  assert.equal(state.goal, "Find the right role, then become interview- and job-ready");
  assert.equal(state.phase, "fit-discovery");
  assert.equal(state.recommendedFocus, "Direction");
  assert.equal(state.dayType, "evidence-building");
  assert.equal(direction.nextMoveType, "research");
  assert.equal(marketMap.nextMoveType, "research");
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
  const marketMap = state.workstreams.find((w) => w.name === "Market map")!;
  assert.equal(direction.progress, "developing");
  assert.equal(direction.nextMoveType, "research");
  assert.equal(marketMap.nextMoveType, "research");
  assert.ok(direction.evidence.some((e) => e.includes("open or saved roles")));
  assert.equal(state.phase, "role-targeting");
  assert.ok(state.workstreams.some((w) => w.name === "Applications" && w.status === "active"));
});

test("career goal state reads active career tracks as real direction signal", () => {
  const tracks = [
    {
      id: 1,
      name: "AI strategy",
      slug: "ai-strategy",
      status: "active",
      targetRoleArchetype: "AI strategy / advisory",
      whyItFits: "Technology strategy and advisory fit",
      description: "Explore AI strategy roles in parallel with geopolitical lanes",
    },
    {
      id: 2,
      name: "Geopolitical advisory",
      slug: "geopolitical-advisory",
      status: "active",
      targetRoleArchetype: "geopolitical advisory",
      whyItFits: "Strong geopolitical and advisory fit",
      description: "Parallel geopolitical advisory lane",
    },
    {
      id: 3,
      name: "Strategy / chief of staff / operations",
      slug: "strategy-chief-of-staff-operations",
      status: "active",
      targetRoleArchetype: "chief of staff / operations",
      whyItFits: "Execution-heavy strategy and operating roles are also plausible",
      description: "Parallel operating lane",
    },
  ] as any;

  const state = buildCareerGoalState([], [], [], [], [], [], tracks);
  const direction = state.workstreams.find((w) => w.name === "Direction")!;
  assert.equal(state.phase, "role-targeting");
  assert.ok(state.roleHypotheses.includes("AI strategy"));
  assert.ok(state.roleHypotheses.includes("Geopolitics / geopolitical advisory"));
  assert.ok(direction.evidence.some((e) => /3 active career tracks/i.test(e)));
  assert.equal(state.decisionMode, "broad-parallel-pursuit");
  assert.equal(state.comparisonAxes.mode, "two-axis");
  assert.ok(state.comparisonAxes.roleShapeHypotheses.includes("Strategy / advisory"));
  assert.ok(state.comparisonAxes.roleShapeHypotheses.includes("Ops / chief of staff"));
  assert.equal(state.pursuitPortfolio.length, 4);
  assert.match(state.selectionRule, /keep stronger-fit alternatives warm in parallel/i);
  assert.match(state.todayPlan.mustDo, /Add the next real role or application move/i);
  assert.match(state.todayPlan.mustDo, /Geopolitics \+ Ops \/ chief of staff/i);
  assert.match(direction.bottleneck, /multiple plausible paths need live roles and applications/i);
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
  assert.match(state.decisionQuestion, /paths still need a first real role next/i);
  assert.deepEqual(state.broadPursuitCoverage.missing, [
    "Geopolitics / geopolitical advisory x Ops / chief of staff",
  ]);
  assert.match(state.explorationStrategy, /broad pursuit portfolio/i);
});

test("career goal state names missing paths when broad pursuit coverage is partial", () => {
  const tracks = [
    {
      id: 1,
      name: "AI strategy",
      slug: "ai-strategy",
      status: "active",
      targetRoleArchetype: "AI strategy / advisory",
      whyItFits: "Technology strategy and advisory fit",
      description: "Explore AI strategy roles in parallel with geopolitical lanes",
    },
    {
      id: 2,
      name: "Geopolitical advisory",
      slug: "geopolitical-advisory",
      status: "active",
      targetRoleArchetype: "geopolitical advisory",
      whyItFits: "Strong geopolitical and advisory fit",
      description: "Parallel geopolitical advisory lane",
    },
    {
      id: 3,
      name: "Strategy / chief of staff / operations",
      slug: "strategy-chief-of-staff-operations",
      status: "active",
      targetRoleArchetype: "chief of staff / operations",
      whyItFits: "Execution-heavy strategy and operating roles are also plausible",
      description: "Parallel operating lane",
    },
  ] as any;
  const jobs = [
    { id: 1, title: "AI Strategy Associate", company: "Frontier Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "strategy / advisory" },
    { id: 2, title: "AI Chief of Staff", company: "Model Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "chief of staff / operations" },
  ] as any;

  const state = buildCareerGoalState([], jobs, [], [], [], [], tracks);
  assert.equal(state.decisionMode, "broad-parallel-pursuit");
  assert.deepEqual(state.broadPursuitCoverage.covered.sort(), [
    "AI / technology strategy x Ops / chief of staff",
    "AI / technology strategy x Strategy / advisory",
  ].sort());
  assert.deepEqual(state.broadPursuitCoverage.missing.sort(), [
    "Geopolitics / geopolitical advisory x Ops / chief of staff",
    "Geopolitics / geopolitical advisory x Strategy / advisory",
  ].sort());
  assert.match(state.todayPlan.mustDo, /Add the next real role or application move/i);
  assert.match(state.decisionQuestion, /Geopolitics \+ Strategy \/ advisory/i);
  assert.match(state.decisionQuestion, /paths still need a first real role/i);
  const coveredLane = state.pursuitPortfolio.find((item) => item.combination === "AI / technology strategy x Strategy / advisory");
  const missingLane = state.pursuitPortfolio.find((item) => item.combination === "Geopolitics / geopolitical advisory x Strategy / advisory");
  assert.match(coveredLane?.nextMove || "", /Keep one live role warm/i);
  assert.match(missingLane?.nextMove || "", /Pursue one/i);
});

test("broad parallel pursuit tracks missing network and learning support after live roles exist", () => {
  const jobs = [
    { id: 1, title: "AI Strategy Associate", company: "Frontier Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "strategy / advisory" },
    { id: 2, title: "AI Chief of Staff", company: "Model Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "chief of staff / operations" },
    { id: 3, title: "Geopolitical Advisory Associate", company: "Risk Group", status: "wishlist", applicationWindowStatus: "open", location: "UAE", roleArchetype: "strategy / advisory" },
    { id: 4, title: "Geopolitical Chief of Staff", company: "Policy Org", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "chief of staff / operations" },
  ] as any;
  const contacts = [
    { id: 1, who: "AI strategy advisor", status: "to_contact", relationshipStrength: "warm", sector: "AI / technology strategy x Strategy / advisory", targetRole: "AI Strategy Associate" },
    { id: 2, who: "Geo ops operator", status: "messaged", relationshipStrength: "warm", sector: "Geopolitics / geopolitical advisory x Ops / chief of staff", targetRole: "Geopolitical Chief of Staff" },
  ] as any;
  const learn = [
    { id: 1, title: "AI strategy memo drill", category: "AI / technology strategy", capabilityBuilt: "AI / technology strategy", requiredOutput: "one memo", proofIntent: true, done: false, learnStatus: "active", note: "Strategy / advisory lane support" },
  ] as any;

  const state = buildCareerGoalState([], jobs, [], learn, contacts);
  assert.equal(state.decisionMode, "broad-parallel-pursuit");
  assert.deepEqual(state.broadPursuitCoverage.missing, []);
  assert.ok(state.broadPursuitCoverage.networkSupported.includes("AI / technology strategy x Strategy / advisory"));
  assert.ok(state.broadPursuitCoverage.networkSupported.includes("Geopolitics / geopolitical advisory x Ops / chief of staff"));
  assert.ok(state.broadPursuitCoverage.missingNetworkSupport.includes("AI / technology strategy x Ops / chief of staff"));
  assert.ok(state.broadPursuitCoverage.missingPrepSupport.includes("Geopolitics / geopolitical advisory x Strategy / advisory"));
  assert.match(state.decisionQuestion, /need outreach, more focused learning support, or both next/i);
  assert.match(state.todayPlan.mustDo, /Add the next missing support move for the strongest live path/i);
  assert.match(state.todayPlan.mustDo, /AI strategy \+ Ops \/ chief of staff/i);
  assert.match(state.todayPlan.mustDo, /Geopolitics \+ Strategy \/ advisory/i);
});

test("job-side prep signals count as prep support even without a Learn item", () => {
  const jobs = [
    {
      id: 1,
      title: "AI Strategy Associate",
      company: "Frontier Lab",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "Remote",
      roleArchetype: "strategy / advisory",
      applicationReadiness: "questions",
      narrativeAngle: "Strong bridge from strategy to AI governance",
    },
    {
      id: 2,
      title: "AI Chief of Staff",
      company: "Model Lab",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "Remote",
      roleArchetype: "chief of staff / operations",
    },
    {
      id: 3,
      title: "Geopolitical Advisory Associate",
      company: "Risk Group",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "UAE",
      roleArchetype: "strategy / advisory",
      jdText: "Looking for someone to lead geopolitical analysis and shape client-facing advisory work.",
    },
    {
      id: 4,
      title: "Geopolitical Chief of Staff",
      company: "Policy Org",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "London",
      roleArchetype: "chief of staff / operations",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  assert.deepEqual(state.broadPursuitCoverage.covered, [
    "AI / technology strategy x Strategy / advisory",
    "AI / technology strategy x Ops / chief of staff",
    "Geopolitics / geopolitical advisory x Strategy / advisory",
    "Geopolitics / geopolitical advisory x Ops / chief of staff",
  ]);
  assert.ok(state.broadPursuitCoverage.prepSupported.includes("AI / technology strategy x Strategy / advisory"));
  assert.ok(state.broadPursuitCoverage.prepSupported.includes("Geopolitics / geopolitical advisory x Strategy / advisory"));
  assert.deepEqual(state.broadPursuitCoverage.missingPrepSupport.sort(), [
    "AI / technology strategy x Ops / chief of staff",
    "Geopolitics / geopolitical advisory x Ops / chief of staff",
  ].sort());
});

test("broad parallel pursuit support ordering follows portfolio order, not save order", () => {
  const jobs = [
    { id: 1, title: "Geopolitical Chief of Staff", company: "Policy Org", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "chief of staff / operations" },
    { id: 2, title: "AI Strategy Associate", company: "Frontier Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "strategy / advisory" },
    { id: 3, title: "AI Chief of Staff", company: "Model Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "chief of staff / operations" },
    { id: 4, title: "Geopolitical Advisory Associate", company: "Risk Group", status: "wishlist", applicationWindowStatus: "open", location: "UAE", roleArchetype: "strategy / advisory" },
  ] as any;
  const contacts = [
    { id: 1, who: "Geo ops operator", status: "messaged", relationshipStrength: "warm", sector: "Geopolitics / geopolitical advisory x Ops / chief of staff", targetRole: "Geopolitical Chief of Staff" },
  ] as any;
  const learn = [
    { id: 1, title: "Geo strategy brief", category: "geopolitics", capabilityBuilt: "geopolitics", requiredOutput: "", proofIntent: false, done: false, learnStatus: "active", note: "Strategy / advisory lane support" },
  ] as any;

  const state = buildCareerGoalState([], jobs, [], learn, contacts);
  assert.deepEqual(state.broadPursuitCoverage.covered, [
    "AI / technology strategy x Strategy / advisory",
    "AI / technology strategy x Ops / chief of staff",
    "Geopolitics / geopolitical advisory x Strategy / advisory",
    "Geopolitics / geopolitical advisory x Ops / chief of staff",
  ]);
  assert.deepEqual(state.broadPursuitCoverage.missingNetworkSupport, [
    "AI / technology strategy x Strategy / advisory",
    "AI / technology strategy x Ops / chief of staff",
    "Geopolitics / geopolitical advisory x Strategy / advisory",
  ]);
  assert.deepEqual(state.broadPursuitCoverage.missingPrepSupport, [
    "AI / technology strategy x Strategy / advisory",
    "AI / technology strategy x Ops / chief of staff",
    "Geopolitics / geopolitical advisory x Ops / chief of staff",
  ]);
});

test("broad parallel pursuit can shift focus to Network once role coverage is complete but lane support is missing", () => {
  const jobs = [
    { id: 1, title: "AI Strategy Associate", company: "Frontier Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "strategy / advisory" },
    { id: 2, title: "AI Chief of Staff", company: "Model Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "chief of staff / operations" },
    { id: 3, title: "Geopolitical Advisory Associate", company: "Risk Group", status: "wishlist", applicationWindowStatus: "open", location: "UAE", roleArchetype: "strategy / advisory" },
    { id: 4, title: "Geopolitical Chief of Staff", company: "Policy Org", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "chief of staff / operations" },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  const network = state.workstreams.find((w) => w.name === "Network")!;
  assert.equal(state.recommendedFocus, "Network");
  assert.equal(network.status, "underdeveloped");
  assert.match(network.bottleneck, /lack networking support/i);
  assert.ok(network.nextMoves.some((move) => /add or link one contact/i.test(move)));
});

test("broad parallel support gaps do not outrank a real application move", () => {
  const jobs = [
    { id: 1, title: "AI Strategy Associate", company: "Frontier Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "strategy / advisory", applicationReadiness: "questions", fitScore: 81, strategicValue: 78, narrativeAngle: "Strong bridge from strategy to AI governance", deadlineConfidence: "high" },
    { id: 2, title: "AI Chief of Staff", company: "Model Lab", status: "wishlist", applicationWindowStatus: "open", location: "Remote", roleArchetype: "chief of staff / operations" },
    { id: 3, title: "Geopolitical Advisory Associate", company: "Risk Group", status: "wishlist", applicationWindowStatus: "open", location: "UAE", roleArchetype: "strategy / advisory" },
    { id: 4, title: "Geopolitical Chief of Staff", company: "Policy Org", status: "wishlist", applicationWindowStatus: "open", location: "London", roleArchetype: "chief of staff / operations" },
  ] as any;
  const contacts = [
    { id: 1, who: "AI strategy advisor", status: "to_contact", relationshipStrength: "warm", sector: "AI / technology strategy x Strategy / advisory", targetRole: "AI Strategy Associate" },
  ] as any;

  const state = buildCareerGoalState([], jobs, [], [], contacts);
  assert.equal(state.decisionMode, "broad-parallel-pursuit");
  assert.equal(state.opportunityState.dominantBlocker, "application");
  assert.equal(state.recommendedFocus, "Applications");
  assert.equal(state.focusReasonCode, "live_apply");
  assert.match(state.todayPlan.mustDo, /Advance the strongest application move/i);
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
  assert.equal(frame.dayType, "evidence-building");
  assert.equal(frame.decisionMode, "single-track");
});

test("single-lane role signal does not become broad parallel pursuit just because one role mentions adjacent policy terms", () => {
  const tracks = [{
    id: 1,
    name: "AI Governance",
    slug: "ai-governance",
    status: "active",
    targetRoleArchetype: "policy",
    whyItFits: "",
    description: "",
  }] as any;
  const jobs = [{
    id: 1,
    title: "Policy Advisor",
    company: "Ofcom",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "London",
    roleArchetype: "policy",
    narrativeAngle: "Translate technical AI risk into proportionate regulation language",
    note: "Online Safety team growth. Prioritise stakeholder judgement and policy translation.",
  }] as any;

  const state = buildCareerGoalState([], jobs, [], [], [], [], tracks);
  assert.notEqual(state.decisionMode, "broad-parallel-pursuit");
  assert.doesNotMatch(state.todayPlan.mustDo, /Add the next real role or application move/i);
});

test("role-targeting can focus prep and upskilling when several serious roles share the same weak area", () => {
  const jobs = Array.from({ length: 5 }).map((_, i) => ({
    id: i + 1,
    title: `AI Strategy Associate ${i + 1}`,
    company: "Frontier Lab",
    status: "wishlist",
    applicationWindowStatus: "open",
    applicationReadiness: "cover",
    deadlineConfidence: "high",
    location: "Remote",
    fitScore: 82,
    strategicValue: 78,
    narrativeAngle: "",
    warmPathScore: 15,
  })) as any;
  const learn = [{
    id: 100,
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

  const state = buildCareerGoalState([], jobs, [], learn, []);
  assert.equal(state.phase, "role-targeting");
  assert.equal(state.recommendedFocus, "Learning and upskilling");
  assert.equal(state.dayType, "capability-building");
  assert.equal(state.focusReasonCode, "repeated_capability_gap");
  assert.match(state.reason, /Prep and upskilling|learning/i);
});

test("career goal state reflects real networking progress from live contacts", () => {
  const today = new Date().toISOString().slice(0, 10);
  const jobs = [
    { id: 1, title: "AI Strategy Associate", company: "GovAI", status: "wishlist", applicationWindowStatus: "open", location: "Remote" },
  ] as any;
  const contacts = [
    {
      id: 1,
      who: "Operator at GovAI",
      status: "messaged",
      relationshipStrength: "warm",
      targetOrg: "GovAI",
      targetRole: "AI Strategy Associate",
      nextFollowUpDate: today,
      messageDraft: "Following up on the AI Strategy Associate role.",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, [], [], contacts);
  const network = state.workstreams.find((w) => w.name === "Network")!;
  assert.equal(state.phase, "role-targeting");
  assert.equal(state.recommendedFocus, "Network");
  assert.equal(network.status, "stale");
  assert.equal(network.progress, "developing");
  assert.match(network.bottleneck, /follow-up/i);
  assert.ok(network.evidence.some((e) => /1 active conversation/i.test(e)));
  assert.ok(network.evidence.some((e) => /1 role-linked contact/i.test(e)));
  assert.ok(network.nextMoves.some((move) => /follow up/i.test(move)));
});

test("contact-first roles surface Network as the live bottleneck", () => {
  const jobs = [
    {
      id: 21,
      title: "AI Strategy Associate",
      company: "GovAI",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "Remote",
      fitScore: 80,
      strategicValue: 76,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
      warmPathScore: 82,
      narrativeAngle: "Strong bridge into AI strategy",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  assert.equal(state.recommendedFocus, "Network");
  assert.equal(state.opportunityState.state, "researching");
  assert.equal(state.opportunityState.dominantBlocker, "access");
  assert.match(state.opportunityState.summary, /blocked by access|useful person/i);
});

test("career goal state reflects recruiting truth for follow-up-led application work", () => {
  const jobs = [
    {
      id: 2,
      title: "AI Strategy Associate",
      company: "GovAI",
      status: "applied",
      applicationWindowStatus: "open",
      location: "Remote",
      fitScore: 82,
      applicationReadiness: "follow_up",
      deadlineConfidence: "high",
      warmPathScore: 72,
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  const applications = state.workstreams.find((w) => w.name === "Applications")!;
  assert.equal(state.phase, "role-targeting");
  assert.equal(state.recommendedFocus, "Applications");
  assert.equal(applications.status, "active");
  assert.equal(applications.nextMoveType, "execution");
});

test("clarify-first roles surface as live application work instead of being hidden as premature", () => {
  const jobs = [
    {
      id: 22,
      title: "AI Strategy Associate",
      company: "GovAI",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "Remote",
      fitScore: 82,
      strategicValue: 78,
      applicationReadiness: "none",
      deadlineConfidence: "",
      warmPathScore: 30,
      narrativeAngle: "Strong bridge into AI strategy",
      note: "",
      url: "",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  const applications = state.workstreams.find((w) => w.name === "Applications")!;
  assert.equal(state.phase, "role-targeting");
  assert.equal(state.recommendedFocus, "Applications");
  assert.equal(state.focusReasonCode, "clarify_before_push");
  assert.equal(applications.status, "active");
  assert.equal(applications.nextMoveType, "execution");
  assert.match(applications.bottleneck, /clarification before real conversion/i);
  assert.ok(applications.nextMoves.some((move) => /confirm the role facts/i.test(move)));
  assert.equal(state.opportunityState.state, "researching");
  assert.equal(state.opportunityState.dominantBlocker, "clarify");
});

test("prove-fit roles are surfaced as capability-building support, not direct application work", () => {
  const jobs = [
    {
      id: 3,
      title: "AI Strategy Associate",
      company: "GovAI",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "Remote",
      fitScore: 82,
      strategicValue: 78,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
      warmPathScore: 35,
      narrativeAngle: "",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  const applications = state.workstreams.find((w) => w.name === "Applications")!;
  const capability = state.workstreams.find((w) => w.name === "Learning and upskilling")!;
  const proof = state.workstreams.find((w) => w.name === "Projects and public work")!;
  assert.equal(applications.nextMoveType, "wait");
  assert.match(applications.bottleneck, /upskilling edge|capability-building/i);
  assert.match(capability.bottleneck, /clearer examples or practice|learning plan/i);
  assert.ok(capability.evidence.some((e) => /clearer examples or practice/i.test(e)));
  assert.equal(proof.nextMoveType, "wait");
  assert.equal(proof.status, "sufficient_for_now");
  assert.match(proof.bottleneck, /optional value-adds/i);
});

test("a single prove-fit role does not make prep the dominant planner focus", () => {
  const jobs = [
    {
      id: 31,
      title: "AI Strategy Associate",
      company: "GovAI",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "Remote",
      fitScore: 82,
      strategicValue: 78,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
      warmPathScore: 35,
      narrativeAngle: "",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  assert.notEqual(state.recommendedFocus, "Learning and upskilling");
  assert.notEqual(state.focusReasonCode, "repeated_capability_gap");
  assert.notEqual(state.opportunityState.dominantBlocker, "capability");
});

test("live proof assets strengthen upskilling without turning into an application gate", () => {
  const jobs = [
    {
      id: 4,
      title: "AI Strategy Associate",
      company: "GovAI",
      status: "wishlist",
      applicationWindowStatus: "open",
      location: "Remote",
      fitScore: 82,
      strategicValue: 78,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
      warmPathScore: 35,
      narrativeAngle: "",
    },
  ] as any;
  const hustles = [
    {
      id: 1,
      title: "AI strategy memo series",
      stage: "testing",
      nextStep: "publish memo one",
      coreClaim: "I can turn frontier-AI ambiguity into decision-grade briefs",
      firstPostIdea: "What boards should ask before adopting agentic tooling",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, [], [], [], hustles);
  const applications = state.workstreams.find((w) => w.name === "Applications")!;
  const proof = state.workstreams.find((w) => w.name === "Projects and public work")!;
  assert.equal(applications.nextMoveType, "wait");
  assert.equal(proof.status, "active");
  assert.equal(proof.progress, "developing");
  assert.ok(proof.evidence.some((e) => /1 live project\/public-work item/i.test(e)));
  assert.ok(proof.nextMoves.some((move) => /next concrete output|publishable or shippable/i.test(move)));
});

test("interview-ready focus uses interview-prep day type instead of generic proof-building", () => {
  const jobs = [
    {
      id: 5,
      title: "AI Strategy Associate",
      company: "GovAI",
      status: "interviewing",
      applicationWindowStatus: "open",
      location: "Remote",
      fitScore: 84,
      strategicValue: 80,
      applicationReadiness: "follow_up",
      deadlineConfidence: "high",
      warmPathScore: 68,
      narrativeAngle: "Strong bridge between AI strategy and policy work",
    },
  ] as any;

  const state = buildCareerGoalState([], jobs, []);
  assert.equal(state.phase, "interview-prep");
  assert.equal(state.recommendedFocus, "Interview readiness");
  assert.equal(state.dayType, "interview-prep");
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

test("interview-prep phase produces entity-aware today plan", () => {
  const jobs = [
    {
      id: 1,
      title: "AI Governance Advisor",
      company: "DeepMind",
      status: "interviewing",
      applicationWindowStatus: "open",
      location: "London",
      roleArchetype: "advisory",
      jdText: "Key requirements: stakeholder translation, cross-jurisdiction regulation experience, investment strategy awareness.",
      roleModel: "",
    },
  ] as any;
  const state = buildCareerGoalState([], jobs, []);
  assert.equal(state.phase, "interview-prep");
  assert.match(state.reason, /DeepMind/);
  assert.match(state.decisionQuestion, /DeepMind/);
  assert.match(state.todayPlan.mustDo, /AI Governance Advisor/);
  assert.match(state.todayPlan.stopRule, /AI Governance Advisor/);
});

test("rolePrepPlans includes interviewing jobs and jobs with JD text", () => {
  const jobs = [
    { id: 1, title: "PM", company: "Stripe", status: "interviewing", applicationWindowStatus: "open", jdText: "", roleModel: "" },
    { id: 2, title: "AI Advisor", company: "DeepMind", status: "wishlist", applicationWindowStatus: "open", jdText: "Key requirements: stakeholder translation, cross-jurisdiction regulation, investment strategy.", roleModel: "" },
  ] as any;
  const state = buildCareerGoalState([], jobs, []);
  assert.ok(state.rolePrepPlans.length >= 2);
  assert.equal(state.rolePrepPlans[0].roleTitle, "PM at Stripe");
  assert.equal(state.rolePrepPlans[1].roleTitle, "AI Advisor at DeepMind");
  const deepmindPlan = state.rolePrepPlans[1].prepPlan;
  assert.ok(deepmindPlan.buckets.technical.length > 0, "should extract technical requirements from JD");
  assert.ok(deepmindPlan.buckets.technical.some((i: any) => /stakeholder translation/i.test(i.theme)));
});

test("rolePrepPlans includes Role Model fields when present", () => {
  const roleModel = JSON.stringify({
    mandate: "Shape frontier AI safety policy",
    coreWork: ["Draft regulatory position papers", "Engage with EU regulators"],
    capabilityRequirements: [{ text: "Stakeholder translation across technical and policy audiences", explicit: true }],
    sectorFluency: [{ text: "EU AI Act and cross-jurisdiction governance frameworks", explicit: true }],
    evidenceBar: [{ text: "Has led a cross-functional policy initiative", explicit: true }],
    fitSignals: [{ text: "Comfortable in ambiguity between technical and regulatory domains", explicit: true }],
    hiddenRequirements: [{ text: "Likely needs familiarity with DeepMind's internal safety culture", explicit: false, confidence: "medium" }],
    ambiguities: ["Unclear whether this is a lobbying role or an internal advisory role"],
  });
  const jobs = [
    { id: 1, title: "AI Governance Advisor", company: "DeepMind", status: "interviewing", applicationWindowStatus: "open", jdText: "Some JD text", roleModel },
  ] as any;
  const state = buildCareerGoalState([], jobs, []);
  assert.equal(state.rolePrepPlans.length, 1);
  const entry = state.rolePrepPlans[0];
  assert.ok(entry.roleModel, "should include the parsed Role Model");
  assert.equal(entry.roleModel!.mandate, "Shape frontier AI safety policy");
  assert.equal(entry.roleModel!.coreWork.length, 2);
  assert.equal(entry.roleModel!.capabilityRequirements.length, 1);
  assert.equal(entry.roleModel!.sectorFluency.length, 1);
});
