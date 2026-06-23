import assert from "node:assert/strict";
import test from "node:test";
import type { CoverageModel } from "./trackResearchCoverageModel";
import { developmentCoverageFingerprint } from "./trackResearchDevelopmentFingerprint";

function coverageModel(): CoverageModel {
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Geopolitical strategy",
    requirementModelVersion: 2,
    requirementModelFingerprint: "requirement-contract",
    userEvidenceFingerprint: "user-evidence",
    coverage: [{
      requirementId: "requirement-writing",
      status: "unknown",
      confidence: "low",
      evidenceItemIds: [],
      reason: "The available record is too limited to assess this fairly.",
      successBarAssessment: "Not yet assessable.",
      evidenceStillNeeded: ["A relevant client-ready writing sample"],
      sourceBasis: "llm",
    }],
    evidenceItems: [],
    sourceInventory: {
      cv: 1,
      profile_summary: 0,
      win: 0,
      learning_output: 0,
      completed_learning: 0,
      proof_asset: 0,
      relationship: 0,
      interaction: 0,
    },
    groups: [],
    quality: {
      status: "provisional",
      assessedRequirementCount: 0,
      unknownRequirementCount: 1,
      citedEvidenceCount: 0,
      directEvidenceCount: 0,
      assessmentCoverage: 0,
      caveats: ["Evidence is currently limited."],
    },
    generatedAt: 1,
  };
}

test("coverage fingerprint changes when verification evidence changes", () => {
  const first = coverageModel();
  const changed = coverageModel();
  changed.coverage[0].evidenceStillNeeded = ["A published board-ready geopolitical brief"];

  assert.notEqual(developmentCoverageFingerprint(first), developmentCoverageFingerprint(changed));
});

test("coverage fingerprint changes when assessment explanation changes", () => {
  const first = coverageModel();
  const changed = coverageModel();
  changed.coverage[0].reason = "A broader evidence review still could not establish current capability.";

  assert.notEqual(developmentCoverageFingerprint(first), developmentCoverageFingerprint(changed));
});

test("coverage fingerprint changes when quality policy output changes", () => {
  const first = coverageModel() as CoverageModel & { qualityPolicyVersion?: number };
  const changed = coverageModel() as CoverageModel & { qualityPolicyVersion?: number };
  first.qualityPolicyVersion = 1;
  changed.qualityPolicyVersion = 2;
  changed.quality.status = "usable";

  assert.notEqual(developmentCoverageFingerprint(first), developmentCoverageFingerprint(changed));
});

test("coverage fingerprint is stable when only generated time changes", () => {
  const first = coverageModel();
  const changed = coverageModel();
  changed.generatedAt = 999;

  assert.equal(developmentCoverageFingerprint(first), developmentCoverageFingerprint(changed));
});
