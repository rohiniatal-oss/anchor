import assert from "node:assert/strict";
import test from "node:test";
import { buildStrategyBuilder } from "./strategyBuilder";

test("strategy builder separates optional example/project ideas from learning resources", () => {
  const strategy = buildStrategyBuilder([], [], [], [], []);

  assert.ok(Array.isArray(strategy.exampleProjectIdeas));
  assert.ok(strategy.exampleProjectIdeas.length >= 1);
  assert.equal("proofGaps" in strategy, false);
  assert.ok(strategy.exampleProjectIdeas.every((item) => /reusable|interview|capability|evidence/i.test(`${item.asset} ${item.doneWhen}`)));
  assert.ok(strategy.nextSystemMoves.some((move) => /optional example\/project/i.test(move)));
});

test("strategy builder fallback experiments capture postings for Anchor analysis", () => {
  const strategy = buildStrategyBuilder([], [], [], [], []);
  const experiments = strategy.roleArchetypes.map((role) => role.nextExperiment).join(" | ");

  assert.match(experiments, /posting with JD text so Anchor can compare/i);
  assert.doesNotMatch(experiments, /top requirement you'd need to prove|note which of your experiences/i);
});
