import assert from "node:assert/strict";
import test from "node:test";
import { buildRankedDiscoveryOptions, type DiscoveryEvidence } from "./discoveryOptions";

function evidence(overrides: Partial<DiscoveryEvidence> = {}): DiscoveryEvidence {
  return {
    title: "AI governance roles official update",
    snippet: "Current roles and requirements for AI governance teams, including policy and delivery responsibilities.",
    url: "https://example.org/roles",
    domain: "example.org",
    date: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

test("role searches become ranked role options with a verification next action", () => {
  const result = buildRankedDiscoveryOptions({
    title: "Find three AI governance roles",
    evidence: [
      evidence({ title: "AI Governance Lead role", domain: "greenhouse.io", url: "https://greenhouse.io/job/123" }),
      evidence({ title: "AI policy team update", snippet: "A public update about AI policy hiring requirements.", domain: "gov.uk", url: "https://gov.uk/ai-policy" }),
    ],
  });

  assert.equal(result.options.length, 2);
  assert.equal(result.options[0].rank, 1);
  assert.equal(result.options[0].kind, "role");
  assert.match(result.options[0].nextAction, /verify.*current opportunity/i);
  assert.match(result.recommendedNextAction, /create a Job only if/i);
});

test("people searches become network options rather than contacts", () => {
  const result = buildRankedDiscoveryOptions({
    title: "Search for Bain alumni in AI strategy",
    evidence: [evidence({ title: "Bain alumni AI strategy profile", snippet: "Public profile for an AI strategy leader and former consultant.", domain: "linkedin.com" })],
  });

  assert.equal(result.options[0].kind, "person");
  assert.match(result.options[0].nextAction, /creating a Contact/i);
  assert.match(result.recommendedNextAction, /create a Contact only if/i);
});

test("course searches become learning options without creating learn items", () => {
  const result = buildRankedDiscoveryOptions({
    title: "Look up courses on AI safety",
    evidence: [evidence({ title: "AI safety course catalogue", snippet: "Course curriculum and learning programme details.", domain: "university.edu" })],
  });

  assert.equal(result.options[0].kind, "learning");
  assert.match(result.options[0].nextAction, /Learn item or stay as supporting evidence/i);
});

test("weak or empty evidence does not fabricate options", () => {
  const result = buildRankedDiscoveryOptions({
    title: "Find jobs",
    evidence: [],
  });

  assert.deepEqual(result.options, []);
  assert.match(result.summary, /did not find enough reliable evidence/i);
  assert.match(result.recommendedNextAction, /Clarify the search goal/i);
});
