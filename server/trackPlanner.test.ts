import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrackPlan } from "./trackPlanner";

test("thin tracks ask for one real role and one requirements pattern", () => {
  const plan = buildTrackPlan({
    id: 1,
    slug: "ai-strategy",
    name: "AI strategy",
    status: "active",
    priority: 50,
  } as any, {
    tasks: [],
    jobs: [],
    learn: [],
    hustles: [],
    contacts: [],
  });

  assert.match(plan.primaryNeed.move, /find one real AI strategy role/i);
  assert.match(plan.primaryNeed.doneWhen, /one real role and one repeated requirements pattern/i);
  assert.doesNotMatch(plan.primaryNeed.move, /review three|three .*roles/i);
});
