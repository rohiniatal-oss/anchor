import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveProactiveSuggestions } from "./anchorToday";

// ─────────────────────────────────────────────────────────────────────────────
// Mock createNextTask so tests don't touch the DB.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("./nextTask", () => ({
  createNextTask: vi.fn(),
}));

import { createNextTask } from "./nextTask";
const mockCreate = createNextTask as ReturnType<typeof vi.fn>;

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeJob(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    title: "Senior PM",
    status: "applied",
    deadline: null,
    ...overrides,
  };
}

function makeContact(overrides: Record<string, any> = {}) {
  return {
    id: 10,
    name: "Alice",
    status: "warm",
    nextFollowUpDate: null,
    ...overrides,
  };
}

function makeLearnItem(overrides: Record<string, any> = {}) {
  return {
    id: 20,
    title: "SQL crash course",
    learnStatus: "in_progress",
    relatedJobId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ task: { id: 99 }, reused: false });
});

// ─── Signal 1: deadline jobs ──────────────────────────────────────────────────

describe("deriveProactiveSuggestions — deadline jobs", () => {
  it("creates a task for a job with a deadline within 5 days", async () => {
    const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].signal).toBe("deadline_job");
    expect(suggestions[0].sourceId).toBe(1);
    expect(suggestions[0].taskCreated).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({ sourceType: "job", sourceId: 1 });
  });

  it("marks urgency high when deadline is today (< 1 day)", async () => {
    const job = makeJob({ id: 2, deadline: NOW + 0.5 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions[0].urgency).toBe("high");
  });

  it("marks urgency medium when deadline is 3 days away", async () => {
    const job = makeJob({ id: 3, deadline: NOW + 3 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions[0].urgency).toBe("medium");
  });

  it("ignores a job with a deadline more than 5 days away", async () => {
    const job = makeJob({ id: 4, deadline: NOW + 8 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores an archived job even if deadline is imminent", async () => {
    const job = makeJob({ id: 5, status: "archived", deadline: NOW + 1 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores a rejected job even if deadline is imminent", async () => {
    const job = makeJob({ id: 6, status: "rejected", deadline: NOW + 1 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores a job with no deadline", async () => {
    const job = makeJob({ id: 7, deadline: null });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores a job whose deadline has already passed", async () => {
    const job = makeJob({ id: 8, deadline: NOW - 1 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions).toHaveLength(0);
  });
});

// ─── Signal 2: overdue contacts ───────────────────────────────────────────────

describe("deriveProactiveSuggestions — overdue contacts", () => {
  it("creates a task for a contact with an overdue follow-up", async () => {
    const contact = makeContact({ id: 10, nextFollowUpDate: NOW - 2 * DAY });
    const suggestions = await deriveProactiveSuggestions([], [contact], []);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].signal).toBe("overdue_contact");
    expect(suggestions[0].sourceId).toBe(10);
    expect(suggestions[0].taskCreated).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({ sourceType: "contact", sourceId: 10 });
  });

  it("marks urgency high when overdue by 7+ days", async () => {
    const contact = makeContact({ id: 11, nextFollowUpDate: NOW - 8 * DAY });
    const suggestions = await deriveProactiveSuggestions([], [contact], []);
    expect(suggestions[0].urgency).toBe("high");
  });

  it("ignores a contact whose follow-up is in the future", async () => {
    const contact = makeContact({ id: 12, nextFollowUpDate: NOW + 3 * DAY });
    const suggestions = await deriveProactiveSuggestions([], [contact], []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores an archived contact even if follow-up is overdue", async () => {
    const contact = makeContact({ id: 13, status: "archived", nextFollowUpDate: NOW - 1 * DAY });
    const suggestions = await deriveProactiveSuggestions([], [contact], []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores a cold contact", async () => {
    const contact = makeContact({ id: 14, status: "cold", nextFollowUpDate: NOW - 1 * DAY });
    const suggestions = await deriveProactiveSuggestions([], [contact], []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores a contact with no nextFollowUpDate", async () => {
    const contact = makeContact({ id: 15, nextFollowUpDate: null });
    const suggestions = await deriveProactiveSuggestions([], [contact], []);
    expect(suggestions).toHaveLength(0);
  });
});

// ─── Signal 3: learn items linked to deadline jobs ────────────────────────────

describe("deriveProactiveSuggestions — learn for deadline job", () => {
  it("creates a task for a learn item linked to a deadline job", async () => {
    const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
    const item = makeLearnItem({ id: 20, relatedJobId: 1 });
    const suggestions = await deriveProactiveSuggestions([job], [], [item]);

    const learnSuggestion = suggestions.find((s) => s.signal === "learn_for_deadline_job");
    expect(learnSuggestion).toBeDefined();
    expect(learnSuggestion?.sourceId).toBe(20);
    expect(mockCreate).toHaveBeenCalledWith({ sourceType: "learn", sourceId: 20 });
  });

  it("ignores a done learn item even if linked to a deadline job", async () => {
    const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
    const item = makeLearnItem({ id: 21, relatedJobId: 1, learnStatus: "done" });
    const suggestions = await deriveProactiveSuggestions([job], [], [item]);
    const learnSuggestion = suggestions.find((s) => s.signal === "learn_for_deadline_job");
    expect(learnSuggestion).toBeUndefined();
  });

  it("ignores a learn item not linked to any deadline job", async () => {
    const job = makeJob({ id: 1, deadline: NOW + 8 * DAY }); // outside horizon
    const item = makeLearnItem({ id: 22, relatedJobId: 1 });
    const suggestions = await deriveProactiveSuggestions([job], [], [item]);
    const learnSuggestion = suggestions.find((s) => s.signal === "learn_for_deadline_job");
    expect(learnSuggestion).toBeUndefined();
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("deriveProactiveSuggestions — idempotency", () => {
  it("marks taskReused true when createNextTask returns reused: true", async () => {
    mockCreate.mockResolvedValue({ task: { id: 99 }, reused: true });
    const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions[0].taskCreated).toBe(false);
    expect(suggestions[0].taskReused).toBe(true);
    expect(suggestions[0].taskId).toBe(99);
  });

  it("handles createNextTask returning null without throwing", async () => {
    mockCreate.mockResolvedValue(null);
    const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
    const suggestions = await deriveProactiveSuggestions([job], [], []);
    expect(suggestions[0].taskCreated).toBe(false);
    expect(suggestions[0].taskReused).toBe(false);
    expect(suggestions[0].taskId).toBeNull();
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe("deriveProactiveSuggestions — sorting", () => {
  it("puts high-urgency suggestions before medium ones", async () => {
    const urgentJob = makeJob({ id: 1, deadline: NOW + 0.5 * DAY }); // high
    const medJob = makeJob({ id: 2, deadline: NOW + 3 * DAY });      // medium
    mockCreate
      .mockResolvedValueOnce({ task: { id: 101 }, reused: false })
      .mockResolvedValueOnce({ task: { id: 102 }, reused: false });
    const suggestions = await deriveProactiveSuggestions([urgentJob, medJob], [], []);
    expect(suggestions[0].urgency).toBe("high");
    expect(suggestions[1].urgency).toBe("medium");
  });

  it("puts overdue_contact after deadline_job at same urgency level", async () => {
    const job = makeJob({ id: 1, deadline: NOW + 3 * DAY });
    const contact = makeContact({ id: 10, nextFollowUpDate: NOW - 2 * DAY });
    mockCreate
      .mockResolvedValueOnce({ task: { id: 101 }, reused: false })
      .mockResolvedValueOnce({ task: { id: 102 }, reused: false });
    const suggestions = await deriveProactiveSuggestions([job], [contact], []);
    expect(suggestions[0].signal).toBe("deadline_job");
    expect(suggestions[1].signal).toBe("overdue_contact");
  });
});
