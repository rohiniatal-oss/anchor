// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE TESTS (P4.7) — Brain Dump as universal capture:
// conservative routing, no data loss, network/proof/decision taxonomy.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";
import type { classifyCapture as ClassifyCapture } from "./capture";

let h: Harness;
// Import lazily AFTER the harness sets ANCHOR_DB_PATH. A static import of
// "./capture" pulls in "./storage", which opens its sqlite handle at module load
// against the default data.db — before the harness can point it at the temp DB.
let classifyCapture: typeof ClassifyCapture;

before(async () => {
  h = await makeHarness();
  ({ classifyCapture } = await import("./capture"));
});
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("capture classifier routes books and courses to Learn", () => {
  const book = classifyCapture(1, "Read Superforecasting");
  assert.equal(book.route, "learn");
  assert.equal(book.confidence, "high");
  assert.match(book.reason, /study|practise|prep/i);

  const course = classifyCapture(2, "Study the GovAI course");
  assert.equal(course.route, "learn");
});

test("capture classifier routes people/action outreach to Network", () => {
  const s = classifyCapture(1, "Message Sarah about Anthropic policy jobs");
  assert.equal(s.route, "network");
  assert.equal(s.confidence, "high");
});

test("capture classifier treats figure-out items as decisions, not Learn", () => {
  const s = classifyCapture(1, "Figure out if AI governance is actually right for me");
  assert.equal(s.route, "decision");
  assert.equal(s.confidence, "medium");
});

test("capture classifier routes writing/building outputs to Proof", () => {
  assert.equal(classifyCapture(1, "Write a memo on Gulf AI policy").route, "proof");
  assert.equal(classifyCapture(2, "Build a small Afterline prototype").route, "proof");
});

test("capture classifier keeps vague short captures and asks a question", () => {
  const s = classifyCapture(1, "Sarah");
  assert.equal(s.route, "keep");
  assert.equal(s.confidence, "low");
  assert.ok(s.question, "low-confidence captures ask one clarifying question");
});

test("/api/capture/sort returns confidence, reason, and compatibility category", async () => {
  await h.storage.createTask({ title: "Read Superforecasting", list: "inbox", done: false } as any);
  await h.storage.createTask({ title: "Message Sarah about Anthropic policy jobs", list: "inbox", done: false } as any);
  await h.storage.createTask({ title: "Sarah", list: "inbox", done: false } as any);

  const r = await api(h.base, "POST", "/api/capture/sort", {});
  assert.equal(r.status, 200);
  assert.equal(r.json.suggestions.length, 3);
  const routes = new Map(r.json.suggestions.map((s: any) => [s.id, s]));
  for (const s of routes.values()) {
    assert.ok(s.route, "new route present");
    assert.ok(s.category, "legacy category alias present");
    assert.ok(s.confidence, "confidence present");
    assert.ok(s.reason, "reason present");
  }
  assert.ok(r.json.suggestions.some((s: any) => s.route === "network"));
  assert.ok(r.json.suggestions.some((s: any) => s.route === "keep" && s.question));
});

test("/api/capture/:id/suggest returns a suggestion for one capture without sorting the whole inbox", async () => {
  const urgent = await h.storage.createTask({ title: "Message Sarah about Anthropic policy jobs", list: "inbox", done: false } as any);
  await h.storage.createTask({ title: "Read Superforecasting", list: "inbox", done: false } as any);

  const r = await api(h.base, "POST", `/api/capture/${urgent.id}/suggest`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.suggestion.id, urgent.id);
  assert.equal(r.json.suggestion.route, "network");
  assert.equal(r.json.suggestion.confidence, "high");
  assert.match(r.json.suggestion.reason, /reaching out/i);
});

test("routing to Network creates a contact and preserves the original capture", async () => {
  const cap = await h.storage.createTask({ title: "Message Sarah about Anthropic policy jobs", list: "inbox", done: false } as any);
  const r = await api(h.base, "POST", `/api/capture/${cap.id}/route`, { route: "network" });
  assert.equal(r.status, 200);
  assert.equal(r.json.moved, "network");
  assert.ok(r.json.contact?.id, "contact created");

  const contacts = await h.storage.getContacts();
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].who, "Sarah");
  assert.equal(contacts[0].targetRole, "Anthropic policy jobs");
  assert.match(contacts[0].why, /Anthropic policy jobs/i);
  assert.match(contacts[0].note, /Message Sarah about Anthropic policy jobs/i);

  const original = (await h.storage.getTasks()).find((t) => t.id === cap.id)!;
  assert.equal(original.list, "captured", "original capture is preserved, not deleted");
  assert.equal(original.sourceType, "capture");
  assert.match(original.sourceStatus, /routed:network:contact/);
});

test("generic networking capture stores a target archetype instead of the whole raw sentence", async () => {
  const cap = await h.storage.createTask({ title: "Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat", list: "inbox", done: false } as any);
  const r = await api(h.base, "POST", `/api/capture/${cap.id}/route`, { route: "network" });
  assert.equal(r.status, 200);

  const contacts = await h.storage.getContacts();
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].who, "Bain alum");
  assert.equal(contacts[0].targetOrg, "");
  assert.equal(contacts[0].targetRole, "AI strategy roles");
  assert.equal(contacts[0].askType, "advice");
  assert.match(contacts[0].why, /AI strategy roles/i);
  assert.notEqual(contacts[0].who, cap.title);
});

test("routing to Learn creates a learn item and preserves provenance", async () => {
  const cap = await h.storage.createTask({ title: "Read Superforecasting", list: "inbox", done: false } as any);
  const r = await api(h.base, "POST", `/api/capture/${cap.id}/route`, { route: "learn" });
  assert.equal(r.status, 200);
  assert.ok(r.json.learn?.id, "learn item created");

  const learn = await h.storage.getLearn();
  assert.equal(learn.length, 1);
  assert.equal(learn[0].title, cap.title);

  const original = (await h.storage.getTasks()).find((t) => t.id === cap.id)!;
  assert.equal(original.list, "captured");
  assert.match(original.sourceStatus, /routed:learn:learn/);
});

test("routing a decision keeps it as an actionable inbox task", async () => {
  const cap = await h.storage.createTask({ title: "Figure out if AI governance is right for me", list: "inbox", done: false } as any);
  const r = await api(h.base, "POST", `/api/capture/${cap.id}/route`, { route: "decision" });
  assert.equal(r.status, 200);
  assert.equal(r.json.moved, "decision");

  const task = (await h.storage.getTasks()).find((t) => t.id === cap.id)!;
  assert.equal(task.list, "inbox");
  assert.equal(task.category, "admin");
  assert.match(task.doneWhen, /decision|next action/i);
  assert.match(task.steps, /decision question in one line/i);
  assert.match(task.steps, /Anchor suggest the real options/i);
  assert.equal(task.minimumOutcome, task.doneWhen);
  assert.match(task.sourceStatus, /routed:decision:task/);
});

test("routing to Today moves the task to the today list without a hardcoded block", async () => {
  const cap = await h.storage.createTask({ title: "Finish the policy memo edits", list: "inbox", done: false, size: "deep" } as any);
  const r = await api(h.base, "POST", `/api/capture/${cap.id}/route`, { route: "today" });
  assert.equal(r.status, 200);
  assert.equal(r.json.moved, "today");

  const task = (await h.storage.getTasks()).find((t) => t.id === cap.id)!;
  assert.equal(task.list, "today");
  // Phase 4.6a: never fabricate a time block. No slot context => block stays null.
  assert.equal(task.block, null, "today route must not hardcode a morning/afternoon block");
  assert.match(task.steps, /open the draft, project, or blank note/i);
  assert.equal(task.minimumOutcome, task.doneWhen);
  assert.match(task.sourceStatus, /routed:today:task/);
});

test("routing a blocker makes the capture blocked and gives it an unblock-oriented starter", async () => {
  const cap = await h.storage.createTask({ title: "Blocked waiting on Farah for the org chart", list: "inbox", done: false } as any);
  const r = await api(h.base, "POST", `/api/capture/${cap.id}/route`, { route: "blocker" });
  assert.equal(r.status, 200);
  assert.equal(r.json.moved, "blocker");

  const task = (await h.storage.getTasks()).find((t) => t.id === cap.id)!;
  assert.equal(task.readiness, "blocked");
  assert.match(task.blockerReason || "", /farah/i);
  assert.match(task.steps, /Name the blocked object/i);
  assert.match(task.steps, /Anchor label the blocker type/i);
  assert.match(task.steps, /smallest unblock request or workaround Anchor suggests/i);
  assert.equal(task.minimumOutcome, task.doneWhen);
  assert.match(task.sourceStatus, /blocker_update/);
});

test("legacy proof category alias still works while preserving capture", async () => {
  const cap = await h.storage.createTask({ title: "Write a memo on Gulf AI policy", list: "inbox", done: false } as any);
  const r = await api(h.base, "POST", `/api/capture/${cap.id}/route`, { category: "hustle" });
  assert.equal(r.status, 200);
  assert.equal(r.json.route, "proof");
  assert.ok(r.json.hustle?.id, "proof asset created");

  const original = (await h.storage.getTasks()).find((t) => t.id === cap.id)!;
  assert.equal(original.list, "captured");
  assert.match(original.sourceStatus, /routed:proof:hustle/);
});
