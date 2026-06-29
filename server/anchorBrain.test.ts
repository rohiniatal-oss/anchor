import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { buildAnchorBrainDecision } from "./anchorBrain";
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

function track(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "ai-governance",
    name: "AI Governance",
    description: "AI governance and frontier model risk work",
    targetRoleArchetype: "AI governance strategy roles",
    priority: 90,
    status: "active",
    whyItFits: "Builds on strategy and delivery experience",
    trackIntelligence: "",
    createdAt: 1,
    ...overrides,
  } as any;
}

const emptyInput = {
  tasks: [],
  jobs: [],
  learn: [],
  hustles: [],
  contacts: [],
  tracks: [],
};

test("anchor brain returns one ranked decision with explicit alternatives and assumptions", () => {
  const decision = buildAnchorBrainDecision({
    ...emptyInput,
    tracks: [track()],
    tasks: [
      {
        id: 1,
        title: "Apply AI governance framework to one case",
        list: "today",
        done: false,
        pinned: false,
        steps: "[]",
        category: "learning",
        sourceType: "task",
        doneWhen: "One case note exists",
        minimumOutcome: "One case note exists",
        readiness: "ready",
        relatedTrackId: 1,
      } as any,
    ],
  });

  assert.equal(decision.readOnly, true);
  assert.equal(decision.question, "what_should_i_do_next");
  assert.ok(decision.recommendation.title);
  assert.ok(decision.recommendation.score > 0);
  assert.ok(decision.recommendation.completionContract);
  assert.ok(decision.whyThis.length >= 2);
  assert.ok(decision.assumptions.length >= 3);
  assert.ok(decision.couldChangeIf.length >= 3);
});

test("anchor brain prefers an existing task when it already matches the strategic spine move", () => {
  const decision = buildAnchorBrainDecision({
    ...emptyInput,
    tracks: [track()],
    tasks: [
      {
        id: 2,
        title: "Apply AI governance framework to one case",
        list: "today",
        done: false,
        pinned: false,
        steps: JSON.stringify([{ text: "Choose case", done: false }]),
        category: "learning",
        sourceType: "task",
        doneWhen: "One case note exists",
        minimumOutcome: "One case note exists",
        readiness: "ready",
        relatedTrackId: 1,
      } as any,
    ],
  });

  assert.equal(decision.recommendation.source, "existing_task");
  assert.equal(decision.recommendation.sourceId, 2);
  assert.match(decision.recommendation.reason, /lines up|matches/i);
});

test("anchor brain includes urgency signals without creating tasks", () => {
  const before = Date.now();
  const decision = buildAnchorBrainDecision({
    ...emptyInput,
    tracks: [track()],
    jobs: [
      {
        id: 1,
        title: "AI Governance Lead",
        company: "Example Org",
        status: "wishlist",
        deadline: new Date(before + 24 * 60 * 60 * 1000).toISOString(),
      } as any,
    ],
  });

  assert.ok(decision.signals.some((signal) => signal.kind === "deadline"));
  assert.match(decision.whyThis.join(" "), /deadline|AI Governance/i);
});

test("anchor brain route is read-only and returns the decision payload", async () => {
  await h.storage.createCareerTrack({
    slug: "ai-governance",
    name: "AI Governance",
    description: "AI governance and frontier model risk work",
    targetRoleArchetype: "AI governance strategy roles",
    priority: 90,
    status: "active",
    whyItFits: "Builds on strategy and delivery experience",
    trackIntelligence: "",
  } as any);
  await h.storage.createTask({
    title: "Read 25 minutes of AI governance primer",
    list: "today",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: "learning",
    deadline: "",
    size: "quick",
    status: "not_started",
    skipped: 0,
    doneWhen: "Read for 25 minutes",
    sourceType: "task",
    sourceNote: "",
    sourceStatus: "",
    minimumOutcome: "Read for 25 minutes",
    readiness: "ready",
  } as any);

  const beforeTasks = await h.storage.getTasks();
  const response = await api(h.base, "GET", "/api/anchor/brain");
  const afterTasks = await h.storage.getTasks();

  assert.equal(response.status, 200);
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.question, "what_should_i_do_next");
  assert.ok(response.json.recommendation.title);
  assert.deepEqual(afterTasks.map((task) => task.id), beforeTasks.map((task) => task.id));
});
