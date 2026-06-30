import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrackPlan } from "./trackPlanner";

test("thin tracks ask Anchor to discover real role targets before manual job entry", () => {
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

  assert.match(plan.primaryNeed.move, /Anchor discover real AI strategy role targets/i);
  assert.match(plan.primaryNeed.doneWhen, /ranked from public evidence/i);
  assert.doesNotMatch(plan.primaryNeed.move, /save one real AI strategy posting/i);
});
