import { test } from "node:test";
import assert from "node:assert/strict";
import { contractForTaskIntent, hasRoleMarketScanContract, inferTaskIntent, roleMarketScanLabel } from "./taskIntent";

test("role market scan intent creates a real-posting requirements flow", () => {
  const contract = contractForTaskIntent({
    title: "Find three real AI governance strategy roles and note what they keep asking for",
    sourceType: "strategy_builder",
  });

  assert.equal(contract.intent, "role_market_scan");
  assert.equal(contract.category, "job");
  assert.match(contract.firstStep, /search "AI governance strategy roles"/i);
  assert.match(contract.doneWhen, /one real role and one repeated requirements pattern/i);
  assert.equal(contract.maxSteps, 5);
  assert.equal(hasRoleMarketScanContract(contract.steps), true);
});

test("role market scan label removes task mechanics from the search phrase", () => {
  assert.equal(
    roleMarketScanLabel("Review three AI governance strategy roles and note the requirements that keep coming up."),
    "AI governance strategy roles",
  );
});

test("networking tasks start from the ask rather than generic research", () => {
  const contract = contractForTaskIntent({
    title: "Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat",
    sourceType: "contact",
  });

  assert.equal(contract.intent, "networking_message");
  assert.match(contract.firstStep, /blank message to a Bain alum/i);
  assert.match(contract.steps.join(" "), /exploring AI strategy roles/i);
  assert.match(contract.steps.join(" "), /Ask for a 15-minute chat about AI strategy roles/i);
  assert.doesNotMatch(contract.steps.join(" "), /research|provider|external/i);
  assert.doesNotMatch(contract.steps.join(" "), /write the smallest specific ask|why you are reaching out now/i);
});

test("comparison and decision tasks stay distinct", () => {
  assert.equal(inferTaskIntent({ title: "Compare AI strategy vs chief of staff roles" }), "comparison");
  assert.equal(inferTaskIntent({ title: "Figure out if AI governance is right for me" }), "decision");

  const comparison = contractForTaskIntent({ title: "Compare AI strategy vs chief of staff roles" });
  const decision = contractForTaskIntent({ title: "Figure out if AI governance is right for me" });
  assert.match(comparison.firstStep, /options you are comparing/i);
  assert.match(decision.firstStep, /question you need to decide/i);
});

test("status updates remain small and do not become strategic research", () => {
  const contract = contractForTaskIntent({
    title: "Mark the Chatham House application as closed - they rejected me",
    sourceType: "job",
  });

  assert.equal(contract.intent, "status_update");
  assert.equal(contract.maxSteps, 1);
  assert.doesNotMatch(contract.steps.join(" "), /research|lessons|strategy/i);
});
