// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 1 REGRESSION TESTS — dependency-safe hardening over the current UI.
// These tests protect the compatibility layer while the frontend still depends on
// a few legacy paths.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;
const DAY = "2026-06-02";

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("events are readable through the frontend's /api/events/:day dependency", async () => {
  await h.storage.replaceEventsForDay(DAY, [
    { title: "Interview prep", start: "09:00", end: "10:00", day: DAY } as any,
  ]);

  const r = await api(h.base, "GET", `/api/events/${DAY}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 1);
  assert.equal(r.json[0].title, "Interview prep");
});

test("direct PATCH completion uses the full execution spine", async () => {
  const plan = await h.storage.createPlan({ date: DAY, status: "active" } as any);
  const task = await h.storage.createTask({ title: "Ship the memo", list: "today", status: "in_progress" } as any);
  const item = await h.storage.createPlanItem({
    planId: plan.id,
    sequence: 0,
    slot: "now",
    sourceType: "task",
    sourceId: task.id,
    taskId: task.id,
    title: task.title,
    whySelected: "minimum viable progress",
    doneWhen: "memo exists",
    status: "started",
    plannedFor: DAY,
  } as any);
  await h.storage.updatePlan(plan.id, { minimumViableItemId: item.id } as any);
  await h.storage.updateTask(task.id, { planItemId: item.id } as any);

  const r = await api(h.base, "PATCH", `/api/tasks/${task.id}`, { done: true, status: "done", day: DAY });
  assert.equal(r.status, 200);

  const updatedTask = (await h.storage.getTasks()).find((t) => t.id === task.id)!;
  assert.equal(updatedTask.done, true);
  assert.equal(updatedTask.status, "done");

  const updatedItem = await h.storage.getPlanItem(item.id);
  assert.equal(updatedItem!.status, "completed", "plan item syncs even from direct PATCH");

  const updatedPlan = await h.storage.getPlanByDate(DAY);
  assert.equal(updatedPlan!.enoughForToday, true, "MVD done-enough still fires");

  const wins = await h.storage.getWins();
  assert.equal(wins.length, 1, "one structured win is created");

  const activity = await h.storage.getActivityLog();
  assert.ok(activity.some((a) => a.eventType === "completed" && a.taskId === task.id && a.planItemId === item.id));
});

test("legacy MiniTaskRow follow-up win post is de-duped after completion-aware PATCH", async () => {
  const task = await h.storage.createTask({ title: "Clear one admin thing", list: "today", status: "in_progress" } as any);

  await api(h.base, "PATCH", `/api/tasks/${task.id}`, { done: true, status: "done", day: DAY });
  const w = await api(h.base, "POST", "/api/wins", { text: task.title });

  assert.equal(w.status, 200);
  assert.equal(w.json.reused, true, "legacy second win call reuses the completion win");
  assert.equal((await h.storage.getWins()).length, 1, "no duplicate win is created");
});

test("legacy brain dump apply delegates to deterministic capture routing", async () => {
  const cap = await h.storage.createTask({ title: "Read Superforecasting", list: "inbox", done: false } as any);

  const r = await api(h.base, "POST", `/api/braindump/${cap.id}/apply`, { action: "file_learn" });
  assert.equal(r.status, 200);
  assert.equal(r.json.route, "learn");

  const learn = await h.storage.getLearn();
  assert.equal(learn.length, 1);
  assert.equal(learn[0].title, cap.title);

  const original = (await h.storage.getTasks()).find((t) => t.id === cap.id)!;
  assert.equal(original.list, "captured", "original capture is preserved, not deleted");
  assert.match(original.sourceStatus, /routed:learn:learn/);
});

test("legacy brain dump sort path no longer needs an LLM", async () => {
  const cap = await h.storage.createTask({ title: "Message Sarah about policy jobs", list: "inbox", done: false } as any);

  const r = await api(h.base, "POST", `/api/braindump/${cap.id}/triage`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.id, cap.id);
  assert.ok(r.json.reason, "deterministic capture reason is surfaced through legacy shape");
});

test("persisted plan recompute remains available through the current Today dependency", async () => {
  await h.storage.createTask({ title: "Finish one thing", list: "today", done: false, category: "admin", size: "quick" } as any);

  const r = await api(h.base, "POST", "/api/plan/recompute", { day: DAY, energy: "medium" });
  assert.equal(r.status, 200);
  assert.ok(r.json.plan?.id, "plan returned");
  assert.ok(Array.isArray(r.json.items), "items returned");
  assert.ok(r.json.items.length >= 1, "plan items created");

  const current = await api(h.base, "GET", `/api/plan/current?day=${DAY}&energy=medium`);
  assert.equal(current.status, 200);
  assert.equal(current.json.plan.id, r.json.plan.id, "current reads the persisted plan");
});
