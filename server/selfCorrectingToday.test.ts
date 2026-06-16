import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;
const DAY = "2026-06-03";

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("deep task planned for Today gets a saved starter step", async () => {
  const task = await h.storage.createTask({
    title: "Draft long memo",
    list: "today",
    done: false,
    status: "not_started",
    category: "substack",
    size: "deep",
    steps: "[]",
    estimateMinutes: 90,
  } as any);

  const r = await api(h.base, "POST", "/api/plan/restart", { day: DAY, energy: "medium", availableMinutes: 120 });
  assert.equal(r.status, 200);
  assert.ok(r.json.items.some((i: any) => i.taskId === task.id));

  const updated = (await h.storage.getTasks()).find((t) => t.id === task.id)!;
  const steps = JSON.parse(updated.steps);
  assert.ok(steps.length >= 1);
  assert.match(steps[0].text, /open|start|sentence|timer|doc|note/i);

  const log = await h.storage.getActivityLog();
  assert.ok(log.some((a) => a.eventType === "starter_step_created" && a.taskId === task.id));
});

test("structured medium job task planned for Today gets deterministic execution steps before avoidance", async () => {
  const job = await h.storage.createJob({
    title: "Policy role",
    company: "Org",
    status: "wishlist",
    applicationReadiness: "cv",
  } as any);
  const task = await h.storage.createTask({
    title: "Tailor CV",
    list: "today",
    done: false,
    status: "not_started",
    category: "job",
    size: "medium",
    steps: "[]",
    sourceType: "job",
    sourceId: job.id,
    estimateMinutes: 45,
  } as any);

  const r = await api(h.base, "POST", "/api/plan/restart", { day: DAY, energy: "medium", availableMinutes: 120 });
  assert.equal(r.status, 200);
  assert.ok(r.json.items.some((i: any) => i.taskId === task.id));

  const updated = (await h.storage.getTasks()).find((t) => t.id === task.id)!;
  const steps = JSON.parse(updated.steps);
  assert.ok(steps.length >= 1);
  assert.match(String(steps[0]?.text || ""), /open|write|draft|list|highlight|match|rewrite|read|note/i);
  const item = r.json.items.find((i: any) => i.taskId === task.id);
  assert.match(String(item?.explanation?.summary || ""), /made smaller|starting is easier/i);
  assert.match(String(item?.explanation?.whyNow || ""), /made smaller|split into easier steps|starting step/i);
});

test("overloaded restart trims Today to fit remaining time", async () => {
  await h.storage.createTask({ title: "Deep item one", list: "today", done: false, status: "not_started", category: "job", size: "deep", estimateMinutes: 90 } as any);
  await h.storage.createTask({ title: "Deep item two", list: "today", done: false, status: "not_started", category: "job", size: "deep", estimateMinutes: 90 } as any);
  await h.storage.createTask({ title: "Quick item", list: "today", done: false, status: "not_started", category: "admin", size: "quick", estimateMinutes: 15 } as any);

  const r = await api(h.base, "POST", "/api/plan/restart", { day: DAY, energy: "medium", availableMinutes: 60 });
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 1);
  assert.ok(r.json.items.length < 3, "overloaded day should not keep every item as equal priority");
  assert.match(r.json.plan.note, /cut down|realistically fit/i);
});
