import assert from "node:assert/strict";
import test from "node:test";
import { buildCantStartMicroStepPrompt, categoryForPlanItem } from "./planningRoutes";

test("goal-derived contact support items become admin tasks when started", () => {
  assert.equal(categoryForPlanItem({
    sourceType: "goal",
    sourceStatus: "broad_parallel_pursuit_network_support",
    title: "Find one person at Frontier Lab to ask how teams hire for AI / technology strategy x Strategy / advisory",
    doneWhen: "One real person is saved with why they are worth messaging and the one question you would ask about AI / technology strategy x Strategy / advisory.",
  }), "admin");
});

test("goal-derived prep support items become learning tasks when started", () => {
  assert.equal(categoryForPlanItem({
    sourceType: "goal",
    sourceStatus: "broad_parallel_pursuit_learning_support",
    title: "Use AI Chief of Staff at Model Lab to identify the first missing requirement for AI / technology strategy x Ops / chief of staff",
    doneWhen: "The first missing requirement and the smallest prep move are saved for AI / technology strategy x Ops / chief of staff.",
  }), "learning");
});

test("goal-derived missing-role items still become job tasks when started", () => {
  assert.equal(categoryForPlanItem({
    sourceType: "goal",
    title: "Add one real role for each missing path",
    doneWhen: "One concrete role or application move exists for each missing path",
  }), "job");
});

test("cant-start shrink prompt uses usefulness criteria instead of generic-filler bans", () => {
  const prompt = buildCantStartMicroStepPrompt("Task: \"Draft follow-up to Priya\"");

  assert.match(prompt, /concrete object, the action to take on it, and the output or checkpoint/i);
  assert.match(prompt, /reducing the user's decision load/i);
  assert.doesNotMatch(prompt, /generic filler/i);
});
