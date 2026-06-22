import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobScoringPrompt, computeWarmPathScore, sanitizeJobScore, shouldRefreshJobScore } from "./jobScoring";

function job(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    title: "AI Governance Strategy Advisor",
    company: "Ofcom",
    location: "London",
    note: "Online safety and AI governance policy role",
    jdText: "Translate technical AI risk into proportionate regulatory policy language.",
    roleArchetype: "AI policy strategy",
    eligibilityRisk: "",
    deadline: "",
    applicationReadiness: "none",
    fitScore: null,
    strategicValue: null,
    frictionScore: null,
    narrativeAngle: "",
    relatedTrackId: 7,
    ...overrides,
  } as any;
}

test("warm path score uses company, track, relationship, and role overlap", () => {
  const score = computeWarmPathScore(job(), [
    {
      targetOrg: "Ofcom",
      targetRole: "AI governance policy",
      sector: "online safety",
      relationshipStrength: "warm",
      status: "replied",
      askType: "referral",
      referralPotential: "Can introduce me",
      relatedTrackId: 7,
      why: "Senior policy advisor",
      messageDraft: "",
    } as any,
  ]);

  assert.ok(score >= 85, `expected a strong warm path score, got ${score}`);
});

test("warm path score returns zero when no contact is relevant to the role", () => {
  const score = computeWarmPathScore(job(), [
    {
      targetOrg: "Unrelated Org",
      targetRole: "Marketing",
      sector: "consumer",
      relationshipStrength: "cold",
      status: "to_contact",
      relatedTrackId: null,
      why: "",
    } as any,
  ]);

  assert.equal(score, 0);
});

test("explicitly linked contacts create a warm-path signal even when metadata is sparse", () => {
  const score = computeWarmPathScore(job({ company: "Stealth AI" }), [
    {
      id: 9,
      targetOrg: "",
      targetRole: "",
      sector: "",
      relationshipStrength: "warm",
      status: "replied",
      relatedTrackId: null,
      why: "",
    } as any,
  ], { linkedContactIds: [9] });

  assert.ok(score >= 70, `expected an explicit linked contact to create a usable warm-path score, got ${score}`);
});

test("job score refresh triggers on role facts but not explicit score edits", () => {
  assert.equal(shouldRefreshJobScore({ jdText: "new JD" }), true);
  assert.equal(shouldRefreshJobScore({ company: "Ofcom" }), true);
  assert.equal(shouldRefreshJobScore({ fitScore: 80 }), false);
  assert.equal(shouldRefreshJobScore({ jdText: "new JD", fitScore: 80 }), false);
});

test("LLM score sanitization clamps scores and preserves existing eligibility risk", () => {
  const patch = sanitizeJobScore({
    fitScore: 105,
    strategicValue: "72",
    frictionScore: -4,
    narrativeAngle: "Strong bridge from technical risk translation into policy strategy.",
    eligibilityRisk: "citizenship",
  }, job({ eligibilityRisk: "visa" }));

  assert.equal(patch.fitScore, 100);
  assert.equal(patch.strategicValue, 72);
  assert.equal(patch.frictionScore, 0);
  assert.equal(patch.narrativeAngle, "Strong bridge from technical risk translation into policy strategy.");
  assert.equal(patch.eligibilityRisk, undefined);
});

test("job scoring prompt is bounded and asks for scores, not planning steps", () => {
  const prompt = buildJobScoringPrompt(job({ jdText: "x ".repeat(3000) }), {
    profile: "Targets AI governance and strategy roles.",
    cv: "CV ".repeat(1000),
    explicitGoals: "Target role types: AI governance strategy; Location preferences: UAE first",
    phase: "active-pursuit",
    trackSummaries: "AI governance: 1 live role",
    recentWins: "",
    recentTakeaways: "",
    activitySignal: "1 track producing",
    activeLearning: "",
    proofAssets: "",
  });

  assert.match(prompt, /fitScore/);
  assert.match(prompt, /strategicValue/);
  assert.match(prompt, /frictionScore/);
  assert.match(prompt, /Anchor remains the planner/);
  assert.doesNotMatch(prompt, /write final task steps/i);
  assert.ok(prompt.length < 7000, `prompt should stay bounded, got ${prompt.length}`);
});
