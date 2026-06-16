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
