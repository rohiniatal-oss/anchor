import assert from "node:assert/strict";
import test from "node:test";
import { buildProactiveSuggestionPreviews } from "./proactiveSuggestions";

const NOW = Date.parse("2026-06-25T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

test("urgent signals are previews and never claim to have created a task", () => {
  const suggestions = buildProactiveSuggestionPreviews({
    nowMs: NOW,
    tasks: [],
    jobs: [{ id: 1, title: "Policy lead", status: "wishlist", deadline: NOW + DAY }],
    contacts: [],
    learn: [],
  });

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].signal, "deadline_job");
  assert.equal(suggestions[0].taskCreated, false);
  assert.equal(suggestions[0].taskId, null);
  assert.equal(suggestions[0].requiresActivation, true);
});

test("an existing source task is reused in the preview rather than duplicated", () => {
  const suggestions = buildProactiveSuggestionPreviews({
    nowMs: NOW,
    tasks: [{ id: 42, done: false, sourceType: "job", sourceId: 1 }] as any,
    jobs: [{ id: 1, title: "Policy lead", status: "wishlist", deadline: NOW + 2 * DAY }],
    contacts: [],
    learn: [],
  });

  assert.equal(suggestions[0].taskReused, true);
  assert.equal(suggestions[0].taskId, 42);
  assert.equal(suggestions[0].requiresActivation, false);
});

test("overdue follow-ups and deadline-linked learning are ranked without writes", () => {
  const suggestions = buildProactiveSuggestionPreviews({
    nowMs: NOW,
    tasks: [],
    jobs: [{ id: 1, title: "Policy lead", status: "wishlist", deadline: NOW + 3 * DAY }],
    contacts: [{ id: 7, name: "Amina", status: "warm", nextFollowUpDate: NOW - 8 * DAY }],
    learn: [{ id: 9, title: "Regulatory briefing", learnStatus: "active", relatedJobId: 1 }],
  });

  assert.deepEqual(suggestions.map((item) => item.signal), [
    "overdue_contact",
    "deadline_job",
    "learn_for_deadline_job",
  ]);
  assert.ok(suggestions.every((item) => item.taskCreated === false));
});
