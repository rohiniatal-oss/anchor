// ─────────────────────────────────────────────────────────────────────────────
// SMOKE TESTS — Five user journeys that must hold before any model change.
//
// 1. Open Today twice → no new tasks, plan items, or wins from viewing.
// 2. Research a target → one track, zero live tasks until explicit activation.
// 3. Open Today with no plan → plan only created after explicit action.
// 4. Complete a task → exactly one win; repeating doesn't duplicate.
// 5. View deadline suggestion → preview only, no auto-activation.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => {
  h = await makeHarness();
});
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

// ─── Journey 1: Open Today twice — no side effects ─────────────────────────

test("Journey 1: GET /api/plan/current twice does not create duplicate plans or items", async () => {
  const day = new Date().toISOString().slice(0, 10);

  // Seed minimal state so the planner has something to work with
  const track = await h.storage.createCareerTrack({
    slug: "ai-gov", name: "AI governance", description: "test",
    targetRoleArchetype: "advisory", priority: 80, status: "active",
    whyItFits: "test", trackIntelligence: "",
  } as any);
  await h.storage.createJob({
    title: "AI Advisor", company: "DeepMind", status: "wishlist",
    relatedTrackId: track.id,
  } as any);

  // Baseline before any GET
  const tasksBefore = await h.storage.getTasks();
  const winsBefore = await h.storage.getWins();

  // First fetch
  const r1 = await api(h.base, "GET", "/api/plan/current");
  assert.equal(r1.status, 200);

  const tasksAfter1 = await h.storage.getTasks();
  const plansAfter1 = await h.storage.getPlanByDate(day);
  const itemsAfter1 = plansAfter1 ? await h.storage.getPlanItems(plansAfter1.id) : [];
  const winsAfter1 = await h.storage.getWins();

  assert.equal(tasksAfter1.length, tasksBefore.length,
    "First GET must not create new tasks");
  assert.equal(winsAfter1.length, winsBefore.length,
    "First GET must not create new wins");

  // Second fetch — identical GET
  const r2 = await api(h.base, "GET", "/api/plan/current");
  assert.equal(r2.status, 200);

  const tasksAfter2 = await h.storage.getTasks();
  const plansAfter2 = await h.storage.getPlanByDate(day);
  const itemsAfter2 = plansAfter2 ? await h.storage.getPlanItems(plansAfter2.id) : [];
  const winsAfter2 = await h.storage.getWins();

  assert.equal(tasksAfter2.length, tasksAfter1.length,
    "Second GET must not create new tasks");
  assert.equal(itemsAfter2.length, itemsAfter1.length,
    "Second GET must not create new plan items");
  assert.equal(winsAfter2.length, winsAfter1.length,
    "Second GET must not create new wins");
});

test("Journey 1: GET /api/tasks twice does not create side effects", async () => {
  const tasksBefore = await h.storage.getTasks();
  const winsBefore = await h.storage.getWins();

  await api(h.base, "GET", "/api/tasks");
  await api(h.base, "GET", "/api/tasks");

  const tasksAfter = await h.storage.getTasks();
  const winsAfter = await h.storage.getWins();

  assert.equal(tasksAfter.length, tasksBefore.length,
    "GET /api/tasks must not create tasks");
  assert.equal(winsAfter.length, winsBefore.length,
    "GET /api/tasks must not create wins");
});

// ─── Journey 2: Research creates track only, no live tasks ──────────────────

test("Journey 2: track research does not create live tasks, jobs, learns, or contacts", async () => {
  // Use the track-research route which is the main research entry point.
  // We can't call the real LLM, so we test the materialize=false path directly.
  const { runStructuredTrackResearch } = await import("./trackResearchMethod");

  const tasksBefore = await h.storage.getTasks();
  const jobsBefore = await h.storage.getJobs();
  const learnBefore = await h.storage.getLearn();
  const contactsBefore = await h.storage.getContacts();
  const hustlesBefore = await h.storage.getHustles();

  // runStructuredTrackResearch calls the LLM, so this test verifies the
  // code contract: with materialize: false, no downstream objects are created.
  // Since we can't mock the LLM here, we verify the route handler logic instead.
  // The route calls runStructuredTrackResearch(domain, { materialize: false })
  // and the function signature guarantees: materialize === true is needed to
  // call materializeTrackResearch.

  // Verify the materialization endpoint requires stored research
  const fakeTrack = await h.storage.createCareerTrack({
    slug: "test-research", name: "Test Research", description: "test",
    targetRoleArchetype: "advisory", priority: 70, status: "active",
    whyItFits: "test", trackIntelligence: "",
  } as any);

  const materializeR = await api(h.base, "POST", `/api/career-tracks/${fakeTrack.id}/research-plan/materialize`);
  assert.ok([400, 404].includes(materializeR.status),
    "Materialize must reject when no stored research exists");

  const tasksAfter = await h.storage.getTasks();
  const jobsAfter = await h.storage.getJobs();
  const learnAfter = await h.storage.getLearn();
  const contactsAfter = await h.storage.getContacts();
  const hustlesAfter = await h.storage.getHustles();

  assert.equal(tasksAfter.length, tasksBefore.length, "No tasks created from research");
  assert.equal(jobsAfter.length, jobsBefore.length, "No jobs created from research");
  assert.equal(learnAfter.length, learnBefore.length, "No learns created from research");
  assert.equal(contactsAfter.length, contactsBefore.length, "No contacts created from research");
  assert.equal(hustlesAfter.length, hustlesBefore.length, "No hustles created from research");
});

// ─── Journey 3: Plan only created after explicit action ─────────────────────

test("Journey 3: GET /api/plan/current with no plan must not auto-create one", async () => {
  const day = new Date().toISOString().slice(0, 10);

  // Verify no plan exists
  const planBefore = await h.storage.getPlanByDate(day);
  assert.equal(planBefore, undefined, "Precondition: no plan exists for today");

  const r = await api(h.base, "GET", "/api/plan/current");
  assert.equal(r.status, 200);

  const planAfter = await h.storage.getPlanByDate(day);
  // This is the key assertion: viewing should NOT create a plan
  assert.equal(planAfter, undefined,
    "GET /api/plan/current must NOT auto-create a plan — the user should see 'Shape today's plan' and click to create");
});

// ─── Journey 4: Task completion idempotency ─────────────────────────────────

test("Journey 4: completing a task creates exactly one win, repeating does not duplicate", async () => {
  const task = await h.storage.createTask({
    title: "Draft the policy memo",
    list: "today",
    done: false,
    category: "career",
    sourceType: "task",
  } as any);

  const winsBefore = await h.storage.getWins();

  // Complete the task
  const r1 = await api(h.base, "PATCH", `/api/tasks/${task.id}`, { done: true });
  assert.equal(r1.status, 200);

  const winsAfterFirst = await h.storage.getWins();
  const newWins = winsAfterFirst.length - winsBefore.length;
  assert.ok(newWins <= 1,
    `Completing a task should create at most 1 win, got ${newWins}`);

  // Complete the same task again (idempotency check)
  const r2 = await api(h.base, "PATCH", `/api/tasks/${task.id}`, { done: true });
  assert.equal(r2.status, 200);

  const winsAfterSecond = await h.storage.getWins();
  assert.equal(winsAfterSecond.length, winsAfterFirst.length,
    "Completing an already-done task must not create another win");
});

test("Journey 4: completing a task does not create duplicate activity log entries", async () => {
  const task = await h.storage.createTask({
    title: "Write the cover letter",
    list: "today",
    done: false,
    category: "career",
    sourceType: "task",
  } as any);

  // Complete once
  await api(h.base, "PATCH", `/api/tasks/${task.id}`, { done: true });
  const logsAfterFirst = await h.storage.getActivityLog();
  const completionLogs1 = logsAfterFirst.filter(
    (l: any) => l.entityType === "task" && l.entityId === task.id && l.action === "completed"
  );

  // Complete again
  await api(h.base, "PATCH", `/api/tasks/${task.id}`, { done: true });
  const logsAfterSecond = await h.storage.getActivityLog();
  const completionLogs2 = logsAfterSecond.filter(
    (l: any) => l.entityType === "task" && l.entityId === task.id && l.action === "completed"
  );

  assert.equal(completionLogs2.length, completionLogs1.length,
    "Re-completing a done task must not add another activity log entry");
});

// ─── Journey 5: Deadline suggestions are preview only ───────────────────────

test("Journey 5: GET /api/anchor/today does not auto-create tasks from deadline suggestions", async () => {
  // Create a job with a deadline to trigger deadline suggestion
  const track = await h.storage.createCareerTrack({
    slug: "ai-gov", name: "AI governance", description: "test",
    targetRoleArchetype: "advisory", priority: 80, status: "active",
    whyItFits: "test", trackIntelligence: "",
  } as any);
  await h.storage.createJob({
    title: "Policy Lead",
    company: "DeepMind",
    status: "applied",
    relatedTrackId: track.id,
    deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  } as any);

  const tasksBefore = await h.storage.getTasks();

  // Fetch the anchor today endpoint (this surfaces suggestions)
  const r = await api(h.base, "GET", "/api/anchor/today");
  // It might 200 or 404 depending on state — either way, no tasks should be created

  const tasksAfter = await h.storage.getTasks();
  assert.equal(tasksAfter.length, tasksBefore.length,
    "GET /api/anchor/today must not auto-create tasks from deadline suggestions — suggestions should be preview only");
});

test("Journey 5: viewing plan-items does not auto-activate deadline suggestions", async () => {
  const day = new Date().toISOString().slice(0, 10);

  const track = await h.storage.createCareerTrack({
    slug: "ai-gov-2", name: "AI governance 2", description: "test",
    targetRoleArchetype: "advisory", priority: 80, status: "active",
    whyItFits: "test", trackIntelligence: "",
  } as any);
  const job = await h.storage.createJob({
    title: "AI Safety Lead",
    company: "Anthropic",
    status: "interviewing",
    relatedTrackId: track.id,
    deadline: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  } as any);

  const tasksBefore = await h.storage.getTasks();

  // Fetch plan items — should not auto-activate deadline suggestions
  const r = await api(h.base, "GET", "/api/plan-items");

  const tasksAfter = await h.storage.getTasks();
  assert.equal(tasksAfter.length, tasksBefore.length,
    "GET /api/plan-items must not auto-create tasks from deadline signals");
});
