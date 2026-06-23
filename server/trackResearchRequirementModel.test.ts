import assert from "node:assert/strict";
import test from "node:test";
import { buildRequirementModel } from "./trackResearchRequirementModel";

const track = {
  id: 1,
  name: "Geopolitical strategy",
  description: "Strategic analysis of geopolitical risk for decision-makers.",
};

function brief() {
  return {
    domain: "geopolitical strategy",
    trackName: "Geopolitical strategy",
    summary: "Work that translates geopolitical and political-economy developments into decisions for governments and organizations.",
    careerHypothesis: { normalizedTitle: "Geopolitical strategy" },
    evidencePack: [
      {
        sourceTitle: "Political Risk Consultant careers page",
        sourceUrl: "https://example.com/political-risk-consultant",
        sourceType: "job_posting",
        claimSupported: "Candidates must apply political economy analysis and communicate implications to senior clients.",
        usedFor: "requirements",
        confidence: "high",
        whyReliable: "Direct employer requirement evidence.",
      },
      {
        sourceTitle: "Geopolitical risk team profile",
        sourceUrl: "https://example.com/geopolitical-risk-team",
        sourceType: "employer",
        claimSupported: "The team produces client-ready geopolitical risk analysis and scenario assessments.",
        usedFor: "role_map",
        confidence: "high",
        whyReliable: "Employer description of the work.",
      },
      {
        sourceTitle: "Strategic foresight institute report",
        sourceUrl: "https://example.com/strategic-foresight",
        sourceType: "institution",
        claimSupported: "Scenario analysis is a common method used to examine uncertain geopolitical developments.",
        usedFor: "requirements",
        confidence: "medium",
        whyReliable: "Institutional methodology source.",
      },
    ],
    researchEvidence: [],
    sectorMap: [
      {
        sector: "Political risk consulting",
        description: "Advisory work for organizations exposed to geopolitical uncertainty.",
        exampleOrgs: ["Example Advisory"],
      },
    ],
    roleShapes: [
      {
        title: "Political Risk Consultant",
        what: "Produces client-ready political economy and geopolitical risk analysis.",
        typicalOrgs: ["Example Advisory"],
        seniority: "mid",
      },
    ],
    pathHypotheses: [],
    requirementGraph: [
      {
        path: "Political Risk Consultant",
        capitalType: "knowledge",
        requirement: "Political economy analysis",
        evidence: "Candidates must apply political economy analysis for senior clients.",
        priority: 1,
      },
      {
        path: "Political Risk Consultant",
        capitalType: "skill",
        requirement: "Client-ready geopolitical writing",
        evidence: "The team produces client-ready geopolitical risk analysis.",
        priority: 2,
      },
      {
        path: "Political Risk Consultant",
        capitalType: "evidence",
        requirement: "Relevant analytical work samples",
        evidence: "Evidence inferred from the role's client-output expectations.",
        priority: 3,
      },
    ],
    requirementMap: { capabilities: [], knowledge: [], evidence: [], narrative: [] },
    trackHypotheses: [],
    evidenceLoops: [],
    searchPlan: { ambiguityNotes: [] },
  };
}

test("buildRequirementModel preserves source claims and creates stable requirement identities", () => {
  const first = buildRequirementModel(track, brief(), 1234);
  const second = buildRequirementModel(track, brief(), 1234);

  assert.equal(first.mode, "requirement_model");
  assert.equal(first.sourceResearchAt, 1234);
  assert.equal(first.evidenceClaims[0]?.claim, "Candidates must apply political economy analysis and communicate implications to senior clients.");
  assert.deepEqual(first.requirements.map((requirement) => requirement.id), second.requirements.map((requirement) => requirement.id));
  assert.ok(first.requirements.every((requirement) => requirement.successBar.length > 0));
});

test("direct market evidence can support an essential role-specific requirement", () => {
  const model = buildRequirementModel(track, brief(), 1234);
  const requirement = model.requirements.find((item) => item.label === "Political economy analysis");

  assert.ok(requirement);
  assert.equal(requirement?.importance, "essential");
  assert.equal(requirement?.scope, "role_specific");
  assert.equal(requirement?.roleFamilyIds.length, 1);
  assert.ok((requirement?.evidenceClaimIds.length || 0) > 0);
});

test("unsupported requirements are not promoted to essential", () => {
  const input = brief();
  input.requirementGraph = [
    {
      path: "Political Risk Consultant",
      capitalType: "credential",
      requirement: "Niche certification",
      evidence: "A potentially useful signal, but not present in direct employer evidence.",
      priority: 1,
    },
  ];
  const model = buildRequirementModel(track, input, 1234);
  const requirement = model.requirements[0];

  assert.ok(requirement);
  assert.notEqual(requirement.importance, "essential");
  assert.equal(requirement.confidence, "medium");
});
