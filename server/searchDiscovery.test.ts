import assert from "node:assert/strict";
import test from "node:test";
import { classifySearchDiscoveryCapture, isSearchDiscoveryCapture } from "./searchDiscovery";

test("search-like captures are identified before object routes", () => {
  const examples = [
    "Find three AI governance roles",
    "Search for Bain alumni in AI strategy",
    "Look up courses on AI safety",
    "Identify companies hiring for frontier AI policy",
    "Shortlist fellowships in tech policy",
    "Map organisations working on AI assurance",
  ];

  for (const example of examples) {
    assert.equal(isSearchDiscoveryCapture(example), true, example);
    const suggestion = classifySearchDiscoveryCapture(1, example);
    assert.ok(suggestion, example);
    assert.equal(suggestion?.route, "research");
    assert.equal(suggestion?.label, "Search / Discover");
    assert.match(suggestion?.reason || "", /before creating jobs, contacts, learning items, or tasks/i);
  }
});

test("search-like job, people, and course requests do not route directly to object creation", () => {
  const roleSearch = classifySearchDiscoveryCapture(2, "Find AI governance jobs in London");
  const peopleSearch = classifySearchDiscoveryCapture(3, "Find people at TBI working on AI");
  const courseSearch = classifySearchDiscoveryCapture(4, "Find courses on AI governance");

  assert.equal(roleSearch?.route, "research");
  assert.equal(peopleSearch?.route, "research");
  assert.equal(courseSearch?.route, "research");
});

test("atomic actions are not misclassified as discovery", () => {
  assert.equal(isSearchDiscoveryCapture("Send Sarah the deck"), false);
  assert.equal(isSearchDiscoveryCapture("Message Priya about Ofcom roles"), false);
  assert.equal(isSearchDiscoveryCapture("Apply to Policy Lead at Acme"), false);
  assert.equal(isSearchDiscoveryCapture("Write a memo on AI assurance"), false);
});

test("generic search requests ask for the missing purpose", () => {
  const suggestion = classifySearchDiscoveryCapture(5, "Find jobs");
  assert.ok(suggestion);
  assert.equal(suggestion?.confidence, "low");
  assert.match(suggestion?.question || "", /decide, produce, or change/i);
});
