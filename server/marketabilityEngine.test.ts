import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketabilityPlan } from "./marketabilityEngine";

test("marketability direction moves ask for one posting Anchor can analyse", () => {
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
  assert.match(directionMove!.title, /save one real AI governance strategy posting with JD text/i);
  assert.match(directionMove!.doneWhen, /posting is saved with enough JD text/i);
  assert.doesNotMatch(directionMove!.title, /review three|three .*roles/i);
});
