// ─────────────────────────────────────────────────────────────────────────
// SPINE TESTS (P4.6a #8) — the execution-integrity contract:
// PLAN ITEM → TASK → COMPLETION → SOURCE UPDATE → WIN/ACTIVITY → EVIDENCE.
// Run with `npm test` (node:test via tsx). Each test resets the shared DB.
// ─────────────────────────────────────────────────────────────────────────
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";
import { isSubmitStep } from "@shared/jobTemplates";

let h: Harness;
const DAY = "2026-06-02";

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

// helper: a plan + one item, returning ids
async function makePlanWithItem(opts: Partial<{
  sourceType: string; sourceId: number | null; taskId: number | null;
  title: string; doneWhen: string; slot: string; isMvd: boolean;
}> = {}) {
  const plan = await h.storage.createPlan({ date: DAY, status: "active" } as any);
  const item = await h.storage.createPlanItem({
    planId: plan.id, sequence: 0, slot: opts.slot ?? "now",
    sourceType: opts.sourceType ?? "task", sourceId: opts.sourceId ?? null,
    taskId: opts.taskId ?? null, title: opts.title ?? "Do the thing",
    whySelected: "because", doneWhen: opts.doneWhen ?? "", status: "planned",
    plannedFor: DAY,
  } as any);
  if (opts.isMvd) await h.storage.updatePlan(plan.id, { minimumViableItemId: item.id } as any);
  return { plan, item };
}

// 1) PLAN-ITEM START — creates/links a backing task, pins it, preserves identity,
//    derives block from slot, writes the both-way link, marks the item started.
test("plan-item start creates a backing task and writes the both-way link", async () => {
  const { item } = await makePlanWithItem({ slot: "next", title: "Free-text item", doneWhen: "it's drafted" });
  const r = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(r.status, 200);
  const task = r.json.task;
  assert.ok(task && task.id, "a task is returned");
  assert.equal(task.planItemId, item.id, "task links back to the plan item");
  assert.equal(task.pinned, true, "task is pinned as Right Now");
  assert.equal(task.list, "today");
  assert.equal(task.status, "in_progress");
  assert.equal(task.block, "afternoon", "block derived from slot 'next', not hardcoded morning");
  assert.equal(task.doneWhen, "it's drafted", "doneWhen preserved from the plan item");

  const refreshed = await h.storage.getPlanItem(item.id);
  assert.equal(refreshed!.taskId, task.id, "plan item points at the task");
  assert.equal(refreshed!.status, "started");
  assert.ok(refreshed!.startedAt, "startedAt stamped");
});

test("plan-item start reuses the existing taskId instead of duplicating", async () => {
  const existing = await h.storage.createTask({ title: "Already backing", list: "inbox", status: "not_started" } as any);
  const { item } = await makePlanWithItem({ taskId: existing.id, slot: "now" });
  const r = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(r.json.task.id, existing.id, "the same task is reused");
  assert.equal((await h.storage.getTasks()).length, 1, "no duplicate task created");
});

// 2) COMPLETION SYNC — completing the backing task flips the plan item to
//    completed via the EXPLICIT planItemId link (works for any source type),
//    logs a completed activity, and records a win.
test("completing a started task flips its plan item to completed (id-link)", async () => {
  const { item } = await makePlanWithItem({ title: "Ship it" });
  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  const taskId = started.json.task.id;

  const c = await api(h.base, "POST", `/api/tasks/${taskId}/complete`, { day: DAY });
  assert.equal(c.status, 200);

  const pi = await h.storage.getPlanItem(item.id);
  assert.equal(pi!.status, "completed", "plan item marked completed");
  assert.ok(pi!.completedAt, "completedAt stamped");

  const wins = await h.storage.getWins();
  assert.equal(wins.length, 1, "a win was recorded");
  const acts = await h.storage.getActivityLog();
  assert.ok(acts.some((a) => a.eventType === "completed" && a.planItemId === item.id), "completed activity carries planItemId");
});

// MVD / done-enough — completing the day's minimum-viable item marks the plan
// done_enough off the same completion link.
test("completing the MVD item marks the day done_enough", async () => {
  const { plan, item } = await makePlanWithItem({ title: "The one must-do", isMvd: true });
  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  await api(h.base, "POST", `/api/tasks/${started.json.task.id}/complete`, { day: DAY });

  const refreshed = await h.storage.getPlanByDate(DAY);
  assert.equal(refreshed!.enoughForToday, true, "enoughForToday set");
  assert.equal(refreshed!.status, "done_enough");
});

// 3) SAFER JOB STATUS — a wishlist job advances to applied ONLY via the submit
//    pipeline step or the explicit button. A generic job-linked task completion
//    must NEVER change job status (it only logs activity).
test("isSubmitStep distinguishes the submit step from follow-up/others", () => {
  assert.equal(isSubmitStep("Submit"), true);
  assert.equal(isSubmitStep("Submit application"), true);
  assert.equal(isSubmitStep("Application submitted"), true);
  assert.equal(isSubmitStep("Follow up"), false, "follow-up is not submit");
  assert.equal(isSubmitStep("Tailor CV"), false);
  assert.equal(isSubmitStep(""), false);
  assert.equal(isSubmitStep(null), false);
});

test("marking the submit step done advances a wishlist job to applied", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist", roleArchetype: "ops" } as any);
  const step = await h.storage.createJobStep(job.id, { stepLabel: "Submit" });
  const r = await api(h.base, "PATCH", `/api/steps/${step.id}`, { status: "done" });
  assert.equal(r.status, 200);
  const updated = (await h.storage.getJobs()).find((j) => j.id === job.id)!;
  assert.equal(updated.status, "applied");
  assert.equal(updated.applicationReadiness, "submitted");
});

test("marking a NON-submit step done does NOT advance job status", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist", roleArchetype: "ops" } as any);
  const step = await h.storage.createJobStep(job.id, { stepLabel: "Tailor CV" });
  await api(h.base, "PATCH", `/api/steps/${step.id}`, { status: "done" });
  const updated = (await h.storage.getJobs()).find((j) => j.id === job.id)!;
  assert.equal(updated.status, "wishlist", "non-submit step leaves job in wishlist");
});

test("completing a generic job-linked task NEVER changes job status (logs only)", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist" } as any);
  const task = await h.storage.createTask({
    title: "Tailor CV for Analyst", list: "today", status: "in_progress",
    sourceType: "job", sourceId: job.id, doneWhen: "Submitted the application",
  } as any);
  await api(h.base, "POST", `/api/tasks/${task.id}/complete`, { day: DAY });
  const updated = (await h.storage.getJobs()).find((j) => j.id === job.id)!;
  assert.equal(updated.status, "wishlist", "fuzzy doneWhen text must not auto-advance the job");
  const acts = await h.storage.getActivityLog();
  assert.ok(acts.some((a) => a.eventType === "completed" && a.sourceType === "job" && a.sourceId === job.id), "completion still logged against the job");
});

test("explicit mark-submitted advances a wishlist job once and is idempotent", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist" } as any);
  const r1 = await api(h.base, "POST", `/api/jobs/${job.id}/mark-submitted`, {});
  assert.equal(r1.json.job.status, "applied");
  const r2 = await api(h.base, "POST", `/api/jobs/${job.id}/mark-submitted`, {});
  assert.equal(r2.json.job.status, "applied", "second call stays applied, does not regress");
});

// create-next-task dedupe — one OPEN task per source.
test("create-next-task dedupe keeps a single open task per source", async () => {
  const job = await h.storage.createJob({ title: "Role", company: "Org", status: "wishlist", nextStep: "Draft cover" } as any);
  const a = await api(h.base, "POST", `/api/jobs/${job.id}/steps`, { stepLabel: "Write cover" });
  const stepA = a.json;
  await api(h.base, "POST", `/api/steps/${stepA.id}/materialize`, {});
  const b = await api(h.base, "POST", `/api/jobs/${job.id}/steps`, { stepLabel: "Tailor CV" });
  await api(h.base, "POST", `/api/steps/${b.json.id}/materialize`, {});
  const jobTasks = (await h.storage.getTasks()).filter((t) => t.sourceType === "job" && t.sourceId === job.id && !t.done);
  assert.equal(jobTasks.length, 1, "two materializations reuse one open task");
});

// P4.6a #5 — the unified front-door is the ONE strategy payload, and the legacy
// /api/strategy delegates to the same engine (no parallel computation).
test("strategy front-door returns the unified payload off one engine", async () => {
  await h.storage.createCareerTrack({ slug: "ai-gov", name: "AI Gov", status: "active", priority: 5 } as any);
  await h.storage.createJob({ title: "Policy lead", company: "Org", status: "wishlist", roleArchetype: "policy" } as any);
  const fd = await api(h.base, "GET", "/api/strategy/front-door");
  assert.equal(fd.status, 200);
  assert.ok(Array.isArray(fd.json.tracks), "tracks present");
  assert.ok(Array.isArray(fd.json.topThree), "topThree present");
  assert.ok(Array.isArray(fd.json.insights), "insights present");
  assert.ok(fd.json.unlinked && Array.isArray(fd.json.unlinked.items), "unlinked present");
  assert.ok(fd.json.evidence, "evidence present");
  assert.ok(fd.json.topThree.length <= 3, "topThree capped at 3");

  // legacy endpoint delegates to the same engine -> same track ids, in order.
  const legacy = await api(h.base, "GET", "/api/strategy");
  assert.deepEqual(legacy.json.tracks.map((t: any) => t.id), fd.json.tracks.map((t: any) => t.id));
});

// P4.6a #6 — Coach is a THIN layer: the brain SELECTS the move deterministically,
// the LLM only explains it. With no real LLM the call falls back to the brain's
// own pick, so the coach still returns the deterministically-chosen action.
test("coach returns the brain's deterministically-selected move", async () => {
  await h.storage.createJob({ title: "Policy lead", company: "GovAI", status: "wishlist", roleArchetype: "policy" } as any);
  const r = await api(h.base, "POST", "/api/coach", { exclude: [] });
  assert.equal(r.status, 200);
  assert.ok(r.json.suggestion, "a suggestion is returned");
  assert.ok(typeof r.json.suggestion.title === "string" && r.json.suggestion.title.length > 0, "move has a brain-derived title");
  assert.ok(["job", "substack", "interview", "health", "learning", "hustle", "afterline", "admin"].includes(r.json.suggestion.category));
  assert.equal(r.json.suggestion.sourceType, "job", "move carries its brain source type");
});

// plan recompute does not produce duplicate started/linked tasks — starting an
// item twice must not spawn a second backing task.
test("starting a plan item twice does not duplicate the backing task", async () => {
  const { item } = await makePlanWithItem({ title: "Repeatable" });
  const first = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  const second = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(first.json.task.id, second.json.task.id, "same task on re-start");
  assert.equal((await h.storage.getTasks()).length, 1, "no duplicate task");
});
