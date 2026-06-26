import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscoveryRecommendation } from "./discoveryOptions";

test("role searches produce ranked role options and a safe next move", () => {
  const recommendation = buildDiscoveryRecommendation("Find three AI governance roles", [
    {
      title: "AI Governance Lead role requirements",
      snippet: "Role page describing AI governance requirements, policy experience, and delivery skills.",
      url: "https://greenhouse.io/acme/ai-governance-lead",
      domain: "greenhouse.io",
      date: "2026-06-01",
    },
    {
      title: "AI governance report",
      snippet: "Background report about responsible AI governance trends.",
      url: "https://example.org/report",
      domain: "example.org",
      date: "2026-05-01",
    },
  ]);

  assert.equal(recommendation.options.length, 2);
  assert.equal(recommendation.options[0].rank, 1);
  assert.equal(recommendation.options[0].kind, "role");
  assert.match(recommendation.options[0].nextAction, /verified opportunity|role model example/i);
  assert.match(recommendation.recommendedNextMove, /verified opportunity|role model example/i);
  assert.match(recommendation.summary, /role-shaped signal/i);
});

test("people searches produce outreach-oriented options", () => {
  const recommendation = buildDiscoveryRecommendation("Search for Bain alumni in AI strategy", [
    {
      title: "LinkedIn results for AI strategy alumni",
      snippet: "People and alumni working on AI strategy, policy, and delivery.",
      url: "https://linkedin.com/search/results/people",
      domain: "linkedin.com",
      date: "2026-06-01",
    },
  ]);

  assert.equal(recommendation.options[0].kind, "person");
  assert.match(recommendation.options[0].nextAction, /draft a small ask|low-friction ask/i);
  assert.match(recommendation.recommendedNextMove, /outreach|ask|archetype/i);
});

test("course searches produce learning-proof options", () => {
  const recommendation = buildDiscoveryRecommendation("Look up courses on AI safety", [
    {
      title: "AI safety course syllabus",
      snippet: "Course programme with cohort dates, syllabus, and a final project output.",
      url: "https://university.edu/ai-safety-course",
      domain: "university.edu",
      date: "2026-06-01",
    },
  ]);

  assert.equal(recommendation.options[0].kind, "course");
  assert.match(recommendation.options[0].fitSignal, /visible output|proof/i);
  assert.match(recommendation.recommendedNextMove, /proof artifact|course/i);
});

test("empty evidence returns a clarification recommendation rather than fake options", () => {
  const recommendation = buildDiscoveryRecommendation("Find jobs", []);

  assert.equal(recommendation.options.length, 0);
  assert.match(recommendation.summary, /did not find enough usable/i);
  assert.match(recommendation.recommendedNextMove, /Clarify|narrower/i);
});
