import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementModel } from "./trackResearchRequirementModel";
import { coverageRequirementFingerprint } from "./trackResearchCoverageFingerprint";

function model(): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "same-market-sources",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform the work", description: "", requirementIds: ["req-writing"] },
      { id: "demonstrate_credibility", label: "Demonstrate credibility", description: "", requirementIds: [] },
      { id: "access_opportunity", label: "Access the opportunity", description: "", requirementIds: [] },
    ],
    requirements: [{
      id: "req-writing",
      key: "skill:writing",
      label: "Decision-ready writing",
      aliases: [],
      definition: "Write concise analysis for senior decision-makers.",
      group: "perform_work",
      category: "skill",
      importance: "essential",
      importanceReason: "Repeated direct evidence",
      scope: "shared",
      roleFamilyIds: ["role-advisory"],
      successBar: "Produces a concise brief with clear implications.",
      evidenceClaimIds: ["market-claim-1"],
      confidence: "high",
      context: { seniority: ["mid"], geographies: ["global"], employerTypes: ["advisory"], notes: [] },
    }],
    evidenceClaims: [],
    researchQuality: {
      status: "strong",
      sourceCount: 6,
      directSourceCount: 3,
      sourceTypeCount: 3,
      requirementEvidenceCoverage: 100,
      directRequirementCoverage: 100,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

test("coverage fingerprint is stable when the assessment contract is unchanged", () => {
  const first = model();
  const reordered = model();
  reordered.requirements[0].context.geographies = ["global"];
  assert.equal(coverageRequirementFingerprint(first), coverageRequirementFingerprint(reordered));
});

test("coverage fingerprint changes when an LLM-refined success bar changes", () => {
  const first = model();
  const changed = model();
  changed.requirements[0].successBar = "Produces a sourced board-ready brief with explicit scenarios and recommendations.";
  assert.notEqual(coverageRequirementFingerprint(first), coverageRequirementFingerprint(changed));
});

test("coverage fingerprint changes when category or context changes", () => {
  const first = model();
  const categoryChanged = model();
  categoryChanged.requirements[0].category = "evidence";
  const contextChanged = model();
  contextChanged.requirements[0].context.seniority = ["senior"];

  assert.notEqual(coverageRequirementFingerprint(first), coverageRequirementFingerprint(categoryChanged));
  assert.notEqual(coverageRequirementFingerprint(first), coverageRequirementFingerprint(contextChanged));
});
