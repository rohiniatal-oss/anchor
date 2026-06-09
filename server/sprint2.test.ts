// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 2 REGRESSION TESTS — Today is adaptive, especially mid-day restart.
// Tests use explicit availableMinutes so they are deterministic in CI regardless
// of the actual wall clock.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;
const DAY = "2026-06-02";

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

async function seedThreeTodayTasks() {
  await h.storage.createTask({ title: "Tailor CV for one strong role", list: "today", done: false, status: "not_started", category: "job", size: "deep" } as any);
  await h.storage.createTask({ title: "Send one warm outreach", list: "today", done: false, status: "not_started", category: "admin", size: "quick" } as any);
  await h.storage.createTask({ title: "Draft one Substack outline", list: "today", done: false, status: "not_started", category: "substack", size: "medium" } as any);
}

test("restart with a tiny remaining budget returns one MVD, not a fake full day", async () => {
  await seedThreeTodayTasks();

  const r = await api(h.base, "POST", "/api/plan/restart", {
    day: DAY,
    energy: "medium",
    availableMinutes: 45,
  });

  assert.equal(r.status, 200);
  assert.equal(r.json.restart, true);
  assert.equal(r.json.items.length, 1, "tiny restart budget should produce only one item");
  assert.equal(r.json.plan.minimumViableItemId, r.json.items[0].id, "the single item is the MVD");
  assert.match(r.json.plan.note, /Restart from here/i);
  assert.equal(r.json.budget.remainingMinutes, 45);
});

test("low energy with a tiny remaining budget still returns only one MVD", async () => {
  await seedThreeTodayTasks();

  const r = await api(h.base, "POST", "/api/plan/restart", {
    day: DAY,
    energy: "low",
    availableMinutes: 45,
  });

  assert.equal(r.status, 200);
  assert.equal(r.json.items.length, 1, "tiny budget beats the low-energy two-item cap");
  // Note copy was sharpened by a later merge ("one useful application or track move");
  // the one-MVD-on-tiny-budget rule (asserted above) is the real invariant.
  assert.match(r.json.plan.note, /One useful application or track move is enough/i);
});

test("restart with enough time can still return a shaped sequence", async () => {
  await seedThreeTodayTasks();

  const r = await api(h.base, "POST", "/api/plan/restart", {
    day: DAY,
    energy: "medium",
    availableMinutes: 240,
  });

  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 2, "larger restart budget keeps a real sequence");
  assert.ok(r.json.items.length <= 3, "sequence stays calm and capped");
  assert.equal(r.json.items[0].slot, "now");
});

test("low energy restart caps the day even when time exists", async () => {
  await seedThreeTodayTasks();

  const r = await api(h.base, "POST", "/api/plan/restart", {
    day: DAY,
    energy: "low",
    availableMinutes: 300,
  });

  assert.equal(r.status, 200);
  assert.ok(r.json.items.length <= 2, "low energy never gets a three item day");
  assert.match(r.json.plan.note, /Lighter day|Restart from here/i);
});

test("current plan response exposes a remaining-day budget for the frontend", async () => {
  await seedThreeTodayTasks();
  await api(h.base, "POST", "/api/plan/restart", { day: DAY, energy: "medium", availableMinutes: 90 });

  const r = await api(h.base, "GET", `/api/plan/current?day=${DAY}&energy=medium&availableMinutes=90`);

  assert.equal(r.status, 200);
  assert.ok(r.json.plan?.id, "plan returned");
  assert.equal(r.json.budget.remainingMinutes, 90, "budget metadata is exposed");
  assert.equal(r.json.restart, false);
});

test("current plan refreshes stale single-lane carry-forward work when broad parallel pursuit is active", async () => {
  await h.storage.createTask({
    title: "Inspect three AI governance strategy roles and capture repeated requirements.",
    list: "today",
    done: false,
    status: "not_started",
    category: "job",
    size: "deep",
  } as any);

  const initial = await api(h.base, "POST", "/api/plan/recompute", {
    day: DAY,
    energy: "medium",
    availableMinutes: 180,
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.json.items[0]?.sourceType, "task");

  await h.storage.createCareerTrack({
    slug: "ai-strategy",
    name: "AI strategy",
    status: "active",
    priority: 80,
    targetRoleArchetype: "AI strategy advisory",
  } as any);
  await h.storage.createCareerTrack({
    slug: "geo-ops",
    name: "Geopolitics ops",
    status: "active",
    priority: 70,
    targetRoleArchetype: "geopolitics chief of staff operations",
  } as any);

  const refreshed = await api(h.base, "GET", `/api/plan/current?day=${DAY}&energy=medium&availableMinutes=180`);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.json.items[0]?.sourceType, "goal");
  assert.match(refreshed.json.items[0]?.title || "", /Fill the still-empty lanes/i);
});

test("avoidance review distinguishes repeated avoidance from normal tasks", async () => {
  const avoided = await h.storage.createTask({ title: "Rewrite whole CV", list: "today", done: false, status: "not_started", category: "job", size: "deep", skipped: 2 } as any);
  const normal = await h.storage.createTask({ title: "Send one email", list: "today", done: false, status: "not_started", category: "admin", size: "quick", skipped: 0 } as any);

  const a = await api(h.base, "GET", `/api/tasks/${avoided.id}/avoidance-review`);
  assert.equal(a.status, 200);
  assert.equal(a.json.pattern, "avoided");
  assert.equal(a.json.recommendedAction, "shrink_or_redefine");

  const n = await api(h.base, "GET", `/api/tasks/${normal.id}/avoidance-review`);
  assert.equal(n.status, 200);
  assert.equal(n.json.pattern, "normal");
  assert.equal(n.json.recommendedAction, "continue");
});

test("blocked tasks are framed as missing-input problems, not motivation problems", async () => {
  const blocked = await h.storage.createTask({
    title: "Submit application",
    list: "today",
    done: false,
    status: "stuck",
    category: "job",
    size: "medium",
    readiness: "blocked",
    blockerReason: "Need passport scan",
  } as any);

  const r = await api(h.base, "GET", `/api/tasks/${blocked.id}/avoidance-review`);
  assert.equal(r.status, 200);
  assert.equal(r.json.pattern, "blocked");
  assert.equal(r.json.recommendedAction, "unblock");
  assert.match(r.json.message, /missing input|blocked/i);
});
