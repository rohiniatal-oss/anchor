import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskIntakeDefaults } from "./taskIntakeInference";

test("message tasks get a concrete send step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Send update message to Sarah" });
  assert.equal(inferred.doneWhen, "Message is sent");
  assert.match(inferred.steps, /Open a blank message to Sarah/i);
  assert.equal(inferred.minimumOutcome, "Message is sent");
});

test("decision tasks get a question-first starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Figure out if AI governance is right for me" });
  assert.match(inferred.doneWhen, /decision or next action/i);
  assert.match(inferred.steps, /exact question you need to decide/i);
});

test("comparison tasks get a comparison-specific starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Compare AI strategy vs chief of staff roles" });
  assert.match(inferred.doneWhen, /comparison note/i);
  assert.match(inferred.steps, /exact options you are comparing/i);
});

test("learning tasks get a smallest-start reading step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Read Superforecasting" });
  assert.equal(inferred.category, "learning");
  assert.match(inferred.doneWhen, /useful note or output/i);
  assert.match(inferred.steps, /open the learning item or source/i);
});

test("role research tasks get a save-real-examples starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Review three AI governance strategy roles and note the requirements that keep coming up." });
  assert.equal(inferred.category, "job");
  assert.match(inferred.doneWhen, /one real role, one repeated requirements pattern, and one next learning move/i);
  assert.match(inferred.steps, /search .*AI governance strategy roles/i);
  assert.match(inferred.steps, /Treat AI Governance & Safety as the likely first knowledge gap to test/i);
});

test("legacy role-scan metadata is upgraded to the stronger intent contract", () => {
  const inferred = buildTaskIntakeDefaults({
    title: "Inspect three AI governance strategy roles and capture repeated requirements.",
    category: "learning",
    doneWhen: "One clear role-family signal is captured",
    minimumOutcome: "One clear role-family signal is captured",
    steps: JSON.stringify([
      { text: "Use the finite knowledge workflow", done: false },
      { text: "Locate the current stage", done: false },
      { text: "Open a note and list the first thing you need to understand", done: false },
      { text: "Orient", done: false },
      { text: "Scope useful slice", done: false },
    ]),
  });

  assert.equal(inferred.category, "job");
  assert.match(inferred.doneWhen, /one real role, one repeated requirements pattern, and one next learning move/i);
  assert.match(inferred.minimumOutcome, /one real role, one repeated requirements pattern, and one next learning move/i);
  assert.match(inferred.steps, /search .*AI governance strategy roles/i);
  assert.match(inferred.steps, /Treat AI Governance & Safety as the likely first knowledge gap to test/i);
  assert.match(inferred.steps, /confirm or disprove that diagnosis/i);
});

test("broad application tasks are shrunk to one live role move", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Apply to several saved roles" });
  assert.equal(inferred.category, "job");
  assert.match(inferred.doneWhen, /one application move/i);
  assert.match(inferred.steps, /open the role and the current application material/i);
});

test("networking tasks without the word message still get a clear ask starter", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Reach out to one Bain alum about AI strategy roles" });
  assert.match(inferred.doneWhen, /one real person is chosen and the outreach ask is ready/i);
  assert.match(inferred.steps, /linkedin and search for one Bain alum AI strategy roles/i);
});

test("deadline tasks get a record-the-date starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "GovAI fellowship deadline closes Friday" });
  assert.match(inferred.doneWhen, /deadline and next timing risk/i);
  assert.match(inferred.steps, /record the exact date/i);
});

test("blocker tasks get an unblock-oriented starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Blocked waiting on Farah for the org chart", blockerReason: "Waiting on Farah" });
  assert.equal(inferred.readiness, "blocked");
  assert.match(inferred.doneWhen, /blocker and next unblock action/i);
  assert.match(inferred.steps, /Write what is blocked/i);
  assert.match(inferred.steps, /Choose the smallest unblock request or workaround/i);
});

test("contextualizeTask sets category and doneWhen for job-linked tasks", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-ctx-${process.pid}.db`);
  const { contextualizeTask } = await import("./taskIntakeInference");
  const { storage } = await import("./storage");

  const job = await storage.createJob({
    title: "Strategy Analyst",
    company: "Deloitte",
    status: "wishlist",
  } as any);

  const task = await storage.createTask({
    title: "Apply to Deloitte",
    category: "admin",
    sourceType: "job",
    sourceId: job.id,
    doneWhen: "",
    steps: "[]",
  } as any);

  await contextualizeTask(task.id);
  const updated = (await storage.getTasks()).find((t) => t.id === task.id);
  assert.equal(updated?.category, "job");
  assert.ok(updated?.doneWhen?.includes("Deloitte"), "doneWhen should mention the company");
});

test("contextualizeTask sets doneWhen for contact-linked tasks", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-ctx-contact-${process.pid}.db`);
  const { contextualizeTask } = await import("./taskIntakeInference");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "Sarah Chen",
    status: "to_contact",
  } as any);

  const task = await storage.createTask({
    title: "Reach out to Sarah",
    sourceType: "contact",
    sourceId: contact.id,
    doneWhen: "",
    steps: "[]",
  } as any);

  await contextualizeTask(task.id);
  const updated = (await storage.getTasks()).find((t) => t.id === task.id);
  assert.ok(updated?.doneWhen?.includes("Sarah Chen"), "doneWhen should mention the contact name");
});

test("contextualizeTask repairs generic contact placeholder tasks to person-first outreach metadata", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-ctx-contact-placeholder-${process.pid}.db`);
  const { contextualizeTask } = await import("./taskIntakeInference");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "",
    who: "Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat",
    status: "to_contact",
    relationshipStrength: "cold",
    targetRole: "AI strategy roles",
  } as any);

  const task = await storage.createTask({
    title: "Draft soft outreach to Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat",
    category: "admin",
    sourceType: "contact",
    sourceId: contact.id,
    doneWhen: "A message is drafted and ready to send",
    minimumOutcome: "A draft message",
    steps: "[]",
  } as any);

  await contextualizeTask(task.id);
  const updated = (await storage.getTasks()).find((t) => t.id === task.id);
  assert.equal(updated?.title, "Find one Bain alum to ask about AI strategy roles");
  assert.match(updated?.doneWhen || "", /one real person is chosen and the outreach ask is ready/i);
  assert.match(updated?.minimumOutcome || "", /one real person is chosen and the outreach ask is ready/i);
  assert.match(updated?.steps || "", /Open LinkedIn and search for Bain alum AI strategy roles/i);
});

test("thinking category is inferred for planning tasks", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Think about what direction makes sense" });
  assert.equal(inferred.category, "thinking");
  assert.match(inferred.doneWhen, /decision or next action/i);
  assert.match(inferred.steps, /exact question you need to decide/i);
});

test("unrecognized tasks get empty steps instead of vague ones", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Something completely unfamiliar" });
  assert.equal(inferred.steps, "[]");
});
