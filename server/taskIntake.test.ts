import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("task intake infers quick estimate and done condition", async () => {
  const r = await api(h.base, "POST", "/api/tasks", { title: "Send update message", list: "today" });
  assert.equal(r.status, 200);
  assert.equal(r.json.size, "quick");
  assert.equal(r.json.estimateMinutes, 15);
  assert.equal(r.json.estimateConfidence, "low");
  assert.match(r.json.estimateReason, /intake_guess/);
  assert.equal(r.json.doneWhen, "Message is sent");
});

test("task intake infers deep estimate for drafting work", async () => {
  const r = await api(h.base, "POST", "/api/tasks", { title: "Draft memo outline", list: "today" });
  assert.equal(r.status, 200);
  assert.equal(r.json.size, "deep");
  assert.equal(r.json.estimateMinutes, 90);
  assert.equal(r.json.category, "substack");
  assert.equal(r.json.doneWhen, "A rough draft or outline exists");
});

test("task intake preserves explicit user estimate values", async () => {
  const r = await api(h.base, "POST", "/api/tasks", {
    title: "Review notes",
    list: "today",
    size: "quick",
    estimateMinutes: 25,
    estimateConfidence: "high",
    estimateReason: "user_set",
    doneWhen: "Reviewed enough",
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.size, "quick");
  assert.equal(r.json.estimateMinutes, 25);
  assert.equal(r.json.estimateConfidence, "high");
  assert.equal(r.json.estimateReason, "user_set");
  assert.equal(r.json.doneWhen, "Reviewed enough");
});

test("task intake marks blocked when blocker reason is provided", async () => {
  const r = await api(h.base, "POST", "/api/tasks", { title: "Submit item", list: "today", blockerReason: "Need input" });
  assert.equal(r.status, 200);
  assert.equal(r.json.readiness, "blocked");
});

test("task intake logs created activity with estimate metadata", async () => {
  const r = await api(h.base, "POST", "/api/tasks", { title: "Check item", list: "today" });
  assert.equal(r.status, 200);
  const log = await h.storage.getActivityLog();
  const created = log.find((a) => a.eventType === "created" && a.taskId === r.json.id);
  assert.ok(created);
  assert.match(created!.metadata || "", /estimateMinutes/);
});

test("task intake comparison tasks arrive with step-level substeps", async () => {
  const r = await api(h.base, "POST", "/api/tasks", {
    title: "Compare AI strategy vs chief of staff roles",
    list: "today",
  });
  assert.equal(r.status, 200);
  const steps = JSON.parse(r.json.steps || "[]");
  assert.equal(steps.length, 3);
  assert.match(String(steps[0]?.text || ""), /options you are comparing/i);
  assert.match(String(steps[1]?.text || ""), /criteria/i);
  assert.deepEqual(steps.map((step: any) => step.estimateMinutes), [5, 5, 10]);
});

test("task intake infers waiting readiness from title-only waiting tasks", async () => {
  const r = await api(h.base, "POST", "/api/tasks", {
    title: "Waiting for Sarah to send the org chart",
    list: "today",
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.readiness, "waiting");
  assert.match(r.json.doneWhen, /blocker and next unblock action/i);
});
