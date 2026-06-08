import assert from "node:assert/strict";
import test from "node:test";
import { buildStrategyBuilder } from "./strategyBuilder";

test("strategy builder frames lane support as capability support rather than role-specific proof", () => {
  const strategy = buildStrategyBuilder([], [], [], [], []);

  assert.ok(Array.isArray(strategy.capabilitySupport));
  assert.ok(strategy.capabilitySupport.length >= 1);
  assert.equal("proofGaps" in strategy, false);
  assert.ok(strategy.capabilitySupport.every((item) => /reusable|interview|capability|evidence/i.test(`${item.asset} ${item.doneWhen}`)));
  assert.ok(strategy.nextSystemMoves.some((move) => /strengthen capability/i.test(move)));
});
