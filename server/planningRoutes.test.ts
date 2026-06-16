import assert from "node:assert/strict";
import test from "node:test";
import { categoryForPlanItem } from "./planningRoutes";

test("goal-derived contact support items become admin tasks when started", () => {
  assert.equal(categoryForPlanItem({
    sourceType: "goal",
    title: "Add one useful contact for AI / technology strategy x Strategy / advisory",
    doneWhen: "One useful contact or outreach path exists for AI / technology strategy x Strategy / advisory",
  }), "admin");
});

test("goal-derived prep support items become learning tasks when started", () => {
  assert.equal(categoryForPlanItem({
    sourceType: "goal",
    title: "Add one prep item for AI / technology strategy x Ops / chief of staff",
    doneWhen: "One prep item exists for AI / technology strategy x Ops / chief of staff",
  }), "learning");
});

test("goal-derived missing-role items still become job tasks when started", () => {
  assert.equal(categoryForPlanItem({
    sourceType: "goal",
    title: "Add one real role for each missing path",
    doneWhen: "One concrete role or application move exists for each missing path",
  }), "job");
});
