import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveProactiveSuggestions } from "./anchorToday";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeJob(overrides: Record<string, any> = {}) {
  return { id: 1, title: "Senior PM", status: "applied", deadline: null, ...overrides };
}

function makeContact(overrides: Record<string, any> = {}) {
  return { id: 10, name: "Alice", status: "warm", nextFollowUpDate: null, ...overrides };
}

function makeLearnItem(overrides: Record<string, any> = {}) {
  return { id: 20, title: "SQL crash course", learnStatus: "in_progress", relatedJobId: null, ...overrides };
}

function fakeCreator(returnValue: any = { task: { id: 99 }, reused: false }) {
  const calls: any[] = [];
  const fn = async (opts: any) => { calls.push(opts); return returnValue; };
  fn.calls = calls;
  return fn;
}

// ── Signal 1: deadline jobs ──────────────────────────────────────────────────

test("creates a task for a job with a deadline within 5 days", async () => {
  const creator = fakeCreator();
  const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], creator);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].signal, "deadline_job");
  assert.equal(suggestions[0].sourceId, 1);
  assert.equal(suggestions[0].taskCreated, true);
  assert.deepEqual(creator.calls[0], { sourceType: "job", sourceId: 1 });
});

test("marks urgency high when deadline is today", async () => {
  const job = makeJob({ id: 2, deadline: NOW + 0.5 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], fakeCreator());
  assert.equal(suggestions[0].urgency, "high");
});

test("marks urgency medium when deadline is 3 days away", async () => {
  const job = makeJob({ id: 3, deadline: NOW + 3 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], fakeCreator());
  assert.equal(suggestions[0].urgency, "medium");
});

test("ignores a job with a deadline more than 5 days away", async () => {
  const job = makeJob({ id: 4, deadline: NOW + 8 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

test("ignores an archived job even if deadline is imminent", async () => {
  const job = makeJob({ id: 5, status: "archived", deadline: NOW + 1 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

test("ignores a rejected job even if deadline is imminent", async () => {
  const job = makeJob({ id: 6, status: "rejected", deadline: NOW + 1 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

test("ignores a job with no deadline", async () => {
  const job = makeJob({ id: 7, deadline: null });
  const suggestions = await deriveProactiveSuggestions([job], [], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

test("ignores a job whose deadline has already passed", async () => {
  const job = makeJob({ id: 8, deadline: NOW - 1 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

// ── Signal 2: overdue contacts ───────────────────────────────────────────────

test("creates a task for a contact with an overdue follow-up", async () => {
  const creator = fakeCreator();
  const contact = makeContact({ id: 10, nextFollowUpDate: NOW - 2 * DAY });
  const suggestions = await deriveProactiveSuggestions([], [contact], [], creator);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].signal, "overdue_contact");
  assert.equal(suggestions[0].sourceId, 10);
  assert.equal(suggestions[0].taskCreated, true);
  assert.deepEqual(creator.calls[0], { sourceType: "contact", sourceId: 10 });
});

test("marks urgency high when overdue by 7+ days", async () => {
  const contact = makeContact({ id: 11, nextFollowUpDate: NOW - 8 * DAY });
  const suggestions = await deriveProactiveSuggestions([], [contact], [], fakeCreator());
  assert.equal(suggestions[0].urgency, "high");
});

test("ignores a contact whose follow-up is in the future", async () => {
  const contact = makeContact({ id: 12, nextFollowUpDate: NOW + 3 * DAY });
  const suggestions = await deriveProactiveSuggestions([], [contact], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

test("ignores an archived contact even if follow-up is overdue", async () => {
  const contact = makeContact({ id: 13, status: "archived", nextFollowUpDate: NOW - 1 * DAY });
  const suggestions = await deriveProactiveSuggestions([], [contact], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

test("ignores a cold contact", async () => {
  const contact = makeContact({ id: 14, status: "cold", nextFollowUpDate: NOW - 1 * DAY });
  const suggestions = await deriveProactiveSuggestions([], [contact], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

test("ignores a contact with no nextFollowUpDate", async () => {
  const contact = makeContact({ id: 15, nextFollowUpDate: null });
  const suggestions = await deriveProactiveSuggestions([], [contact], [], fakeCreator());
  assert.equal(suggestions.length, 0);
});

// ── Signal 3: learn items linked to deadline jobs ────────────────────────────

test("creates a task for a learn item linked to a deadline job", async () => {
  const creator = fakeCreator();
  const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
  const item = makeLearnItem({ id: 20, relatedJobId: 1 });
  const suggestions = await deriveProactiveSuggestions([job], [], [item], creator);
  const learnSuggestion = suggestions.find((s) => s.signal === "learn_for_deadline_job");
  assert.ok(learnSuggestion);
  assert.equal(learnSuggestion!.sourceId, 20);
  assert.ok(creator.calls.some((c: any) => c.sourceType === "learn" && c.sourceId === 20));
});

test("ignores a done learn item even if linked to a deadline job", async () => {
  const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
  const item = makeLearnItem({ id: 21, relatedJobId: 1, learnStatus: "done" });
  const suggestions = await deriveProactiveSuggestions([job], [], [item], fakeCreator());
  const learnSuggestion = suggestions.find((s) => s.signal === "learn_for_deadline_job");
  assert.equal(learnSuggestion, undefined);
});

test("ignores a learn item not linked to any deadline job", async () => {
  const job = makeJob({ id: 1, deadline: NOW + 8 * DAY });
  const item = makeLearnItem({ id: 22, relatedJobId: 1 });
  const suggestions = await deriveProactiveSuggestions([job], [], [item], fakeCreator());
  const learnSuggestion = suggestions.find((s) => s.signal === "learn_for_deadline_job");
  assert.equal(learnSuggestion, undefined);
});

// ── Idempotency ──────────────────────────────────────────────────────────────

test("marks taskReused true when createNextTask returns reused: true", async () => {
  const creator = fakeCreator({ task: { id: 99 }, reused: true });
  const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], creator);
  assert.equal(suggestions[0].taskCreated, false);
  assert.equal(suggestions[0].taskReused, true);
  assert.equal(suggestions[0].taskId, 99);
});

test("handles createNextTask returning null without throwing", async () => {
  const creator = fakeCreator(null);
  const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [], [], creator);
  assert.equal(suggestions[0].taskCreated, false);
  assert.equal(suggestions[0].taskReused, false);
  assert.equal(suggestions[0].taskId, null);
});

// ── Sorting ──────────────────────────────────────────────────────────────────

test("puts high-urgency suggestions before medium ones", async () => {
  const urgentJob = makeJob({ id: 1, deadline: NOW + 0.5 * DAY });
  const medJob = makeJob({ id: 2, deadline: NOW + 3 * DAY });
  const suggestions = await deriveProactiveSuggestions([urgentJob, medJob], [], [], fakeCreator());
  assert.equal(suggestions[0].urgency, "high");
  assert.equal(suggestions[1].urgency, "medium");
});

test("puts overdue_contact after deadline_job at same urgency level", async () => {
  const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
  const contact = makeContact({ id: 10, nextFollowUpDate: NOW - 2 * DAY });
  const suggestions = await deriveProactiveSuggestions([job], [contact], [], fakeCreator());
  assert.equal(suggestions[0].signal, "deadline_job");
  assert.equal(suggestions[1].signal, "overdue_contact");
});
