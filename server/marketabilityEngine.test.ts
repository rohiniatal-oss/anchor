import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketabilityPlan } from "./marketabilityEngine";

test("marketability direction moves use a one-role requirements pattern", () => {
  const plan = buildMarketabilityPlan({
    tasks: [],
    jobs: [],
    learn: [],
    hustles: [],
    contacts: [],
    tracks: [{
      id: 1,
      slug: "ai-governance",
      name: "AI governance strategy",
      status: "active",
      priority: 80,
    } as any],
  });

  const directionMove = plan.moves.find((move) => move.lane === "Direction");
  assert.ok(directionMove, "direction move should exist when the track has no roles");
  assert.match(directionMove!.title, /find one real AI governance strategy role/i);
  assert.match(directionMove!.doneWhen, /one real role, one repeated requirements pattern, and one next learning move/i);
  assert.doesNotMatch(directionMove!.title, /review three|three .*roles/i);
});
