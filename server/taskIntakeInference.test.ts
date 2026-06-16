import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskIntakeDefaults } from "./taskIntakeInference";

test("message tasks get a concrete send step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Send update message to Sarah" });
  assert.equal(inferred.doneWhen, "Message is sent");
  assert.match(inferred.steps, /draft the message/i);
  assert.equal(inferred.minimumOutcome, "Message is sent");
});

test("decision tasks get a question-first starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Figure out if AI governance is right for me" });
  assert.match(inferred.doneWhen, /decision or next action/i);
  assert.match(inferred.steps, /exact question/i);
});

test("comparison tasks get a comparison-specific starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Compare AI strategy vs chief of staff roles" });
  assert.match(inferred.doneWhen, /comparison note/i);
  assert.match(inferred.steps, /options you are comparing/i);
});

test("learning tasks get a smallest-start reading step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Read Superforecasting" });
  assert.equal(inferred.category, "learning");
  assert.match(inferred.doneWhen, /useful note or output/i);
  assert.match(inferred.steps, /read only the first section/i);
});

test("role research tasks get a save-real-examples starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Review three AI governance strategy roles and note the requirements that keep coming up." });
  assert.equal(inferred.category, "job");
  assert.match(inferred.doneWhen, /real role examples/i);
  assert.match(inferred.steps, /save the first two relevant roles/i);
});

test("broad application tasks are shrunk to one live role move", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Apply to several saved roles" });
  assert.equal(inferred.category, "job");
  assert.match(inferred.doneWhen, /one application move/i);
  assert.match(inferred.steps, /strongest live role/i);
});

test("networking tasks without the word message still get a clear ask starter", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Reach out to one Bain alum about AI strategy roles" });
  assert.match(inferred.doneWhen, /one person and a clear ask/i);
  assert.match(inferred.steps, /pick one person and write the exact ask/i);
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
  assert.match(inferred.steps, /what is blocked and what would unblock it/i);
});
