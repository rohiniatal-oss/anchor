import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskIntakeDefaults } from "./taskIntakeInference";

function parseSteps(raw: string) {
  return JSON.parse(raw) as Array<{ text: string; done: boolean; estimateMinutes?: number }>;
}

test("message tasks get a concrete send step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Send update message to Sarah" });
  const steps = parseSteps(inferred.steps);
  assert.equal(inferred.doneWhen, "Message is sent");
  assert.match(inferred.steps, /draft the message/i);
  assert.equal(inferred.minimumOutcome, "Message is sent");
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((step) => step.estimateMinutes), [5, 5, 5]);
});

test("decision tasks get a question-first starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Figure out if AI governance is right for me" });
  const steps = parseSteps(inferred.steps);
  assert.match(inferred.doneWhen, /decision or next action/i);
  assert.match(inferred.steps, /exact question/i);
  assert.equal(steps.length, 3);
  assert.match(steps[2]?.text || "", /next test|decision|move/i);
});

test("comparison tasks get a comparison-specific starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Compare AI strategy vs chief of staff roles" });
  const steps = parseSteps(inferred.steps);
  assert.match(inferred.doneWhen, /comparison note/i);
  assert.match(inferred.steps, /options you are comparing/i);
  assert.equal(steps.length, 3);
  assert.match(steps[1]?.text || "", /criteria/i);
});

test("learning tasks get a smallest-start reading step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Read Superforecasting" });
  const steps = parseSteps(inferred.steps);
  assert.equal(inferred.category, "learning");
  assert.match(inferred.doneWhen, /useful note or output/i);
  assert.match(inferred.steps, /read only the first section/i);
  assert.equal(steps.length, 3);
  assert.match(steps[2]?.text || "", /reusable takeaway|question/i);
});

test("role research tasks get a save-real-examples starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Review three AI governance strategy roles and note the requirements that keep coming up." });
  const steps = parseSteps(inferred.steps);
  assert.equal(inferred.category, "job");
  assert.match(inferred.doneWhen, /real role examples/i);
  assert.match(inferred.steps, /save the first two relevant roles/i);
  assert.equal(steps.length, 3);
  assert.match(steps[2]?.text || "", /requirement|pattern/i);
});

test("broad application tasks are shrunk to one live role move", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Apply to several saved roles" });
  const steps = parseSteps(inferred.steps);
  assert.equal(inferred.category, "job");
  assert.match(inferred.doneWhen, /one application move/i);
  assert.match(inferred.steps, /strongest live role/i);
  assert.equal(steps.length, 3);
  assert.match(steps[1]?.text || "", /next application move/i);
});

test("networking tasks without the word message still get a clear ask starter", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Reach out to one Bain alum about AI strategy roles" });
  const steps = parseSteps(inferred.steps);
  assert.match(inferred.doneWhen, /one person and a clear ask/i);
  assert.match(inferred.steps, /pick one person and write the exact ask/i);
  assert.equal(steps.length, 3);
  assert.match(steps[1]?.text || "", /draft a short message/i);
});

test("deadline tasks get a record-the-date starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "GovAI fellowship deadline closes Friday" });
  const steps = parseSteps(inferred.steps);
  assert.match(inferred.doneWhen, /deadline and next timing risk/i);
  assert.match(inferred.steps, /record the exact date/i);
  assert.equal(steps.length, 3);
  assert.match(steps[1]?.text || "", /timing risk/i);
});

test("blocker tasks get an unblock-oriented starter step", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Blocked waiting on Farah for the org chart", blockerReason: "Waiting on Farah" });
  const steps = parseSteps(inferred.steps);
  assert.equal(inferred.readiness, "blocked");
  assert.match(inferred.doneWhen, /blocker and next unblock action/i);
  assert.match(inferred.steps, /what is blocked and what you are waiting for/i);
  assert.equal(steps.length, 3);
});

test("waiting tasks infer waiting readiness even without an explicit blocker field", () => {
  const inferred = buildTaskIntakeDefaults({ title: "Waiting for Sarah to send the org chart" });
  assert.equal(inferred.readiness, "waiting");
  assert.match(inferred.doneWhen, /blocker and next unblock action/i);
});
