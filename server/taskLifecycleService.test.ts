import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initStorage, storage } from "./storage";
import { completeTask, reopenTask, startTask } from "./taskLifecycleService";

const directory = mkdtempSync(join(tmpdir(), "anchor-lifecycle-"));
const runtime = initStorage(join(directory, "lifecycle.db"));

test.after(() => {
  runtime.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

test("completion is atomic, idempotent and reversible across task, plan and win state", async () => {
  const task = await storage.createTask({
    title: "Submit the policy application",
    list: "this_week",
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: "job",
    status: "not_started",
    sourceType: "task",
  } as any);
  const plan = await storage.createPlan({
    date: "2026-06-25",
    mode: "normal",
    energy: "medium",
    status: "active",
    enoughForToday: false,
    note: "",
  } as any);
  const item = await storage.createPlanItem({
    planId: plan.id,
    sequence: 0,
    slot: "now",
    sourceType: "task",
    sourceId: task.id,
    taskId: task.id,
    title: task.title,
    whySelected: "Highest-value move",
    doneWhen: "Application submitted",
    status: "planned",
    plannedFor: "2026-06-25",
  } as any);
  await storage.updatePlan(plan.id, { minimumViableItemId: item.id } as any);

  const started = startTask({
    taskId: task.id,
    day: "2026-06-25",
    planItemId: item.id,
    block: "morning",
    idempotencyKey: "start-once",
  });
  assert.equal(started.task.pinned, true);
  assert.equal((await storage.getPlanItem(item.id))?.status, "started");

  const completed = completeTask({
    taskId: task.id,
    day: "2026-06-25",
    planItemId: item.id,
    idempotencyKey: "complete-once",
  });
  assert.equal(completed.task.done, true);
  assert.equal(completed.winCategory, "job_progress");
  assert.equal((await storage.getPlanItem(item.id))?.status, "completed");
  assert.equal((await storage.getPlan(plan.id))?.enoughForToday, true);
  assert.equal((await storage.getWins()).filter((win) => win.sourceEntityType === "task" && win.sourceEntityId === task.id).length, 1);

  const repeated = completeTask({
    taskId: task.id,
    day: "2026-06-25",
    planItemId: item.id,
    idempotencyKey: "complete-once",
  });
  assert.equal(repeated.idempotent, true);
  assert.equal((await storage.getWins()).filter((win) => win.sourceEntityType === "task" && win.sourceEntityId === task.id).length, 1);

  const reopened = reopenTask({
    taskId: task.id,
    day: "2026-06-25",
    planItemId: item.id,
    idempotencyKey: "reopen-once",
  });
  assert.equal(reopened.task.done, false);
  assert.equal((await storage.getPlanItem(item.id))?.status, "planned");
  assert.equal((await storage.getPlan(plan.id))?.enoughForToday, false);
  assert.equal((await storage.getWins()).filter((win) => win.sourceEntityType === "task" && win.sourceEntityId === task.id).length, 0);
});
