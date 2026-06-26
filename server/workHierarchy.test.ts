import assert from "node:assert/strict";
import test from "node:test";
import { decomposeWorkDeterministically } from "./workDecomposition";
import {
  forceDefinitionAsTask,
  interpretWorkDeterministically,
  needsWorkInterpretation,
  normalizeContextForWork,
} from "./workInterpretation";

const careerContext = normalizeContextForWork([
  "User profile: Rohini is an ex-Tony Blair Institute operator and ex-Bain consultant.",
  "Explicit goals/preferences: Target role types: AI governance, strategic advisory, and chief of staff.",
].join("\n"));

test("broad research is identified as a project before any action steps exist", () => {
  const definition = interpretWorkDeterministically({
    title: "Research TBI",
    sourceType: "capture",
    sourceId: 42,
    context: careerContext,
  });

  assert.equal(definition.workType, "project");
  assert.equal(definition.estimatedScope, "multi_session");
  assert.equal(definition.needsClarification, false);
  assert.match(definition.title, /Tony Blair Institute/i);
  assert.match(definition.objective, /prior experience|present goals/i);
  assert.equal("steps" in definition, false);
});

test("a research request with a bounded deliverable remains a one-session task", () => {
  const definition = interpretWorkDeterministically({
    title: "Research TBI so I can produce one short application decision brief",
    sourceType: "capture",
    context: careerContext,
  });

  assert.equal(definition.workType, "task");
  assert.equal(definition.estimatedScope, "single_session");
  assert.match(definition.objective, /produce one short application decision brief/i);
});

test("search discovery titles are interpreted before legacy step breakdown", () => {
  assert.equal(needsWorkInterpretation({
    title: "Find three AI governance roles",
    doneWhen: "You've done something concrete, even if small",
    steps: JSON.stringify([{ text: "Write one rough sentence to break the blank page", done: false }]),
  }), true);

  const definition = interpretWorkDeterministically({
    title: "Find three AI governance roles",
    sourceType: "capture",
    context: careerContext,
  });

  assert.equal(definition.workType, "task");
  assert.equal(definition.estimatedScope, "single_session");
  assert.match(definition.title, /three AI governance roles/i);
  assert.match(definition.desiredOutcome, /sourced answer/i);
  assert.ok(definition.successCriteria.some((criterion) => /source|claim|implication|question/i.test(criterion)));
  assert.equal("steps" in definition, false);
});

test("unbounded search discovery becomes project-shaped until the user narrows it", () => {
  const definition = interpretWorkDeterministically({
    title: "Search for Bain alumni in AI strategy",
    sourceType: "capture",
    context: careerContext,
  });

  assert.equal(definition.workType, "project");
  assert.equal(definition.estimatedScope, "multi_session");
  assert.match(definition.desiredOutcome, /decision-ready result/i);
});

test("multi-session work with a credible parent becomes a milestone candidate", () => {
  const definition = interpretWorkDeterministically({
    title: "Build the TBI opportunity map",
    context: careerContext,
    candidateParent: {
      projectId: 7,
      projectTitle: "Decide whether and how to pursue TBI",
      reason: "Same direction and outcome.",
      confidence: 0.8,
    },
  });

  assert.equal(definition.workType, "milestone");
  assert.equal(definition.candidateParent?.projectId, 7);
  assert.match(definition.desiredOutcome, /advances Decide whether and how to pursue TBI/i);
});

test("project decomposition separates milestones tasks and physical steps", () => {
  const definition = interpretWorkDeterministically({
    title: "Research TBI",
    sourceType: "capture",
    context: careerContext,
  });
  const decomposition = decomposeWorkDeterministically(definition);

  assert.equal(decomposition.kind, "project");
  if (decomposition.kind !== "project") return;
  assert.ok(decomposition.project.milestones.length >= 3);
  assert.ok(decomposition.project.currentTasks.length >= 1);
  assert.ok(decomposition.project.activeTaskSteps.length >= 1);
  assert.equal("steps" in decomposition.project.currentTasks[0], false);
  assert.doesNotMatch(
    decomposition.project.activeTaskSteps.map((step) => step.text).join(" "),
    /rough sentence|blank page|something concrete/i,
  );
});

test("treating a proposed project as one task creates only a task-level plan", () => {
  const project = interpretWorkDeterministically({
    title: "Research TBI",
    sourceType: "capture",
    context: careerContext,
  });
  const taskDefinition = forceDefinitionAsTask(project);
  const decomposition = decomposeWorkDeterministically(taskDefinition);

  assert.equal(taskDefinition.workType, "task");
  assert.equal(decomposition.kind, "task");
  if (decomposition.kind !== "task") return;
  assert.ok(decomposition.task.steps.length >= 1);
  assert.doesNotMatch(
    decomposition.task.steps.map((step) => step.text).join(" "),
    /rough sentence|blank page|something concrete/i,
  );
});
