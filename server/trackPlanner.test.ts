import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrackPlan } from "./trackPlanner";

test("thin tracks ask for one real posting with enough detail for Anchor analysis", () => {
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

  assert.match(plan.primaryNeed.move, /save one real AI strategy posting with JD text for Anchor to compare/i);
  assert.match(plan.primaryNeed.doneWhen, /posting is saved with enough JD text/i);
  assert.doesNotMatch(plan.primaryNeed.move, /review three|three .*roles/i);
});
