import assert from "node:assert/strict";
import test from "node:test";
import { decomposeWorkDeterministically } from "./workDecomposition";
import { interpretWorkDeterministically, normalizeContextForWork } from "./workInterpretation";

const careerContext = normalizeContextForWork([
  "User profile: Rohini is an ex-Tony Blair Institute operator and ex-Bain consultant.",
  "Explicit goals/preferences: Target role types: strategic advisory and chief of staff.",
].join("\n"));

test("bounded search requests are one-session tasks, not synthetic jobs", () => {
  const definition = interpretWorkDeterministically({
    title: "Find three policy strategy roles",
    sourceType: "capture",
    context: careerContext,
  });

  assert.equal(definition.workType, "task");
  assert.equal(definition.estimatedScope, "single_session");
  assert.match(definition.desiredOutcome, /sourced search result/i);
  assert.match(definition.successCriteria.join(" "), /source links/i);
});

test("people and course searches stay in the discovery lane", () => {
  const people = interpretWorkDeterministically({ title: "Search for Bain alumni in strategy", context: careerContext });
  const courses = interpretWorkDeterministically({ title: "Look up courses on policy strategy", context: careerContext });

  assert.equal(people.workType, "task");
  assert.equal(courses.workType, "task");
  assert.match(people.desiredOutcome, /sourced search result/i);
  assert.match(courses.desiredOutcome, /sourced search result/i);
});

test("generic search asks for the missing purpose instead of inventing a checklist", () => {
  const definition = interpretWorkDeterministically({ title: "Find jobs", sourceType: "capture", context: "" });

  assert.equal(definition.needsClarification, true);
  assert.match(definition.clarifyingQuestion, /searching jobs/i);
});

test("multi-outcome search projects separate milestones, tasks, and physical steps", () => {
  const definition = interpretWorkDeterministically({
    title: "Search the TBI landscape across teams and roles before deciding whether to pursue it",
    sourceType: "capture",
    context: careerContext,
  });
  const decomposition = decomposeWorkDeterministically(definition);

  assert.equal(decomposition.kind, "project");
  if (decomposition.kind !== "project") return;
  assert.match(decomposition.project.currentTasks[0].title, /Map three current/i);
  assert.equal("steps" in decomposition.project.currentTasks[0], false);
  assert.doesNotMatch(
    decomposition.project.activeTaskSteps.map((step) => step.text).join(" "),
    /rough sentence|blank page|something concrete/i,
  );
});
