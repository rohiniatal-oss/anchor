import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildCareerGoalState } from "./goalState";
import { reconcileGoalAndTasks } from "./goalTaskReconciliation";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("falls back to goal state when no useful task exists", () => {
  const goal = buildCareerGoalState([], [], []);
  const r = reconcileGoalAndTasks([], goal);
  assert.equal(r.recommendedFocus, "Direction");
  assert.equal(r.recommendedTaskSource, "generate_from_goal_state");
  assert.ok(r.fallbackMove?.title);
});

test("uses an aligned ready task for the current bottleneck", () => {
  const task = {
    id: 1,
    title: "Inspect one AI policy role",
    category: "job",
    list: "today",
    done: false,
    size: "quick",
    doneWhen: "One role is saved and one attribute is noted",
    steps: JSON.stringify([{ text: "Open LinkedIn", done: false }]),
    readiness: "ready",
  } as any;
  const goal = buildCareerGoalState([task], [], []);
  const r = reconcileGoalAndTasks([task], goal);
  assert.equal(r.recommendedTaskSource, "use_existing_task");
  assert.equal(r.recommendedTask?.assessment, "aligned_ready");
  assert.equal(r.recommendedTask?.action, "use");
});

test("refines vague aligned tasks instead of blindly using them", () => {
  const task = {
    id: 1,
    title: "Research career options",
    category: "job",
    list: "today",
    done: false,
    size: "medium",
    steps: "[]",
    readiness: "ready",
  } as any;
  const goal = buildCareerGoalState([task], [], []);
  const r = reconcileGoalAndTasks([task], goal);
  assert.equal(r.recommendedTask?.assessment, "aligned_but_vague");
  assert.equal(r.recommendedTask?.action, "refine");
});

test("defers premature application-style tasks", () => {
  const task = {
    id: 1,
    title: "Prepare several applications",
    category: "job",
    list: "today",
    done: false,
    size: "deep",
    steps: "[]",
    readiness: "ready",
  } as any;
  const goal = buildCareerGoalState([task], [], []);
  const r = reconcileGoalAndTasks([task], goal);
  const assessed = r.taskAssessments.find((x) => x.taskId === 1)!;
  assert.equal(assessed.assessment, "premature");
  assert.equal(assessed.action, "defer");
  assert.equal(r.recommendedTaskSource, "generate_from_goal_state");
});

test("turns blocked tasks into unblock actions", () => {
  const task = {
    id: 1,
    title: "Inspect one role family",
    category: "job",
    list: "today",
    done: false,
    size: "quick",
    steps: "[]",
    readiness: "blocked",
    blockerReason: "Need role links",
  } as any;
  const goal = buildCareerGoalState([task], [], []);
  const r = reconcileGoalAndTasks([task], goal);
  assert.equal(r.recommendedTask?.assessment, "blocked");
  assert.equal(r.recommendedTask?.action, "unblock");
});

test("API returns task assessments and trace", async () => {
  const task = await h.storage.createTask({
    title: "Research career options",
    category: "job",
    list: "today",
    done: false,
    size: "medium",
    steps: "[]",
    readiness: "ready",
  } as any);
  const r = await api(h.base, "GET", "/api/goals/reconcile-tasks");
  assert.equal(r.status, 200);
  assert.equal(r.json.goal, "Find a fulfilling next role");
  assert.ok(r.json.taskAssessments.some((x: any) => x.taskId === task.id));
  assert.ok(r.json.trace.length >= 1);
});
