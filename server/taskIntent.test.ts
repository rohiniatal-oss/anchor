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
  assert.match(contract.doneWhen, /posting is saved, its strongest asks are mapped to your evidence/i);
  assert.match(contract.steps.join(" "), /Pull out the 3 strongest asks/i);
  assert.match(contract.steps.join(" "), /Map the posting against your own evidence/i);
  assert.match(contract.steps.join(" "), /Choose one small prep move for AI Governance & Safety/i);
  assert.equal(contract.maxSteps, 5);
  assert.equal(hasRoleMarketScanContract(contract.steps), true);
});

test("role market scan does not collapse into a status update when doneWhen mentions a next learning move", () => {
  const contract = contractForTaskIntent({
    title: "Inspect three AI governance strategy roles and capture repeated requirements.",
    category: "learning",
    sourceType: "task",
    doneWhen: "One real role, one repeated requirements pattern, and one next learning move are captured",
  });

  assert.equal(contract.intent, "role_market_scan");
  assert.match(contract.firstStep, /search "AI governance strategy roles"/i);
});

test("role market scan label removes task mechanics from the search phrase", () => {
  assert.equal(
    roleMarketScanLabel("Review three AI governance strategy roles and note the requirements that keep coming up."),
    "AI governance strategy roles",
  );
  assert.equal(
    roleMarketScanLabel("Save one real geopolitical advisory role and note which of your experiences would back up the top requirement."),
    "geopolitical advisory roles",
  );
});

test("unknown role scans avoid fake-specific learning-gap labels", () => {
  const contract = contractForTaskIntent({
    title: "Find three climate philanthropy roles and note what they keep asking for",
    sourceType: "strategy_builder",
  });
  const joined = contract.steps.join(" ");

  assert.match(joined, /strongest repeated requirement in the posting/i);
  assert.match(joined, /Map the posting against your own evidence/i);
  assert.doesNotMatch(joined, /AI Governance & Safety|Policy & Regulatory Frameworks|Product & Delivery/i);
  assert.doesNotMatch(joined, /the first repeated requirement as the likely first knowledge gap/i);
});

test("single-role evidence-mapping tasks are treated as role market scans", () => {
  const contract = contractForTaskIntent({
    title: "Save one real geopolitical advisory role and note which of your experiences would back up the top requirement.",
    sourceType: "career_track",
  });

  assert.equal(contract.intent, "role_market_scan");
  assert.match(contract.firstStep, /search "geopolitical advisory roles"/i);
  assert.match(contract.doneWhen, /strongest asks are mapped to your evidence/i);
  assert.doesNotMatch(contract.steps.join(" "), /note which of your experiences|top requirement you'd need to prove/i);
});

test("generic networking tasks find the right real person before drafting outreach", () => {
  const contract = contractForTaskIntent({
    title: "Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat",
    sourceType: "contact",
  });

  assert.equal(contract.intent, "networking_message");
  assert.match(contract.firstStep, /linkedin and search for Bain alum AI strategy roles/i);
  assert.match(contract.steps.join(" "), /save one real person who fits Bain alum/i);
  assert.match(contract.steps.join(" "), /Ask for a 15-minute chat about AI strategy roles/i);
  assert.match(contract.doneWhen, /one real person is chosen and the outreach ask is ready/i);
  assert.doesNotMatch(contract.steps.join(" "), /research|provider|external/i);
  assert.doesNotMatch(contract.steps.join(" "), /write the smallest specific ask|why you are reaching out now/i);
});

test("find-one-person networking titles still keep the success condition at person-plus-ask, not drafted-message", () => {
  const contract = contractForTaskIntent({
    title: "Find one Bain alum to ask about AI strategy roles",
    sourceType: "contact",
  });

  assert.equal(contract.intent, "networking_message");
  assert.match(contract.firstStep, /linkedin and search for Bain alum AI strategy roles/i);
  assert.match(contract.doneWhen, /one real person is chosen and the outreach ask is ready/i);
  assert.match(contract.stopCondition, /one real person and a sendable ask are ready/i);
});

test("named networking tasks still start from the draft", () => {
  const contract = contractForTaskIntent({
    title: "Draft follow-up message to Priya about Ofcom AI policy roles",
    sourceType: "contact",
  });

  assert.equal(contract.intent, "networking_message");
  assert.match(contract.firstStep, /blank message to Priya/i);
  assert.match(contract.doneWhen, /message is drafted, sent, or clearly scheduled/i);
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
