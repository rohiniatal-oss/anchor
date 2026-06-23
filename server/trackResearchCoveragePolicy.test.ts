import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { CoverageModel, RawUserEvidenceSource, UserEvidenceClaim } from "./trackResearchCoverageModel";
import { applyCoveragePolicy, COVERAGE_POLICY_VERSION } from "./trackResearchCoveragePolicy";

function requirement(category: TargetRequirement["category"], id = category): TargetRequirement {
  return {
    id,
    key: `${category}:${id}`,
    label: id,
    aliases: [],
    definition: id,
    group: category === "knowledge" || category === "skill" ? "perform_work" : category === "network" || category === "access" || category === "eligibility" ? "access_opportunity" : "demonstrate_credibility",
    category,
    importance: "important",
    importanceReason: "Test",
    scope: "shared",
    roleFamilyIds: [],
    successBar: `Success bar for ${id}`,
    evidenceClaimIds: [],
    confidence: "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
  };
}

function requirementModel(requirements: TargetRequirement[]): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements",
    sourceResearchAt: 1,
    target: { label: "Target", definition: "Target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: { status: "usable", sourceCount: 5, directSourceCount: 2, sourceTypeCount: 2, requirementEvidenceCoverage: 100, directRequirementCoverage: 50, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function claim(overrides: Partial<UserEvidenceClaim> = {}): UserEvidenceClaim {
  return {
    id: "claim-1",
    key: "claim-1",
    sourceId: "source-1",
    type: "experience",
    claim: "Relevant experience",
    relevance: "Relevant",
    strength: "direct",
    confidence: "high",
    sourceTitle: "CV",
    sourceUrl: "",
    sourceEntityType: "profile",
    sourceEntityId: 1,
    observedAt: 1,
    ...overrides,
  };
}

function source(overrides: Partial<RawUserEvidenceSource> = {}): RawUserEvidenceSource {
  return {
    id: "source-1",
    kind: "cv",
    title: "CV",
    detail: "Relevant experience",
    sourceUrl: "",
    sourceEntityType: "profile",
    sourceEntityId: 1,
    trackId: null,
    observedAt: 1,
    ...overrides,
  };
}

function coverageModel(requirementId: string, evidenceClaims: UserEvidenceClaim[], state: CoverageModel["coverage"][number]["state"] = "proven"): CoverageModel {
  return {
    mode: "coverage_model",
    version: 1,
    requirementModelVersion: 2,
    requirementFingerprint: "requirements",
    evidenceFingerprint: "evidence",
    targetLabel: "Target",
    evidenceClaims,
    coverage: [{ requirementId, state, confidence: "high", reason: "LLM assessment", evidenceClaimIds: evidenceClaims.map((item) => item.id), missingEvidence: "", assessedAt: 1 }],
    summary: {
      counts: { proven: state === "proven" ? 1 : 0, partially_proven: 0, unproven: 0, unknown: 0, below_bar: 0 },
      coreRequirementCount: 1,
      coreCoverageRate: state === "proven" ? 100 : 0,
      provenRequirementIds: state === "proven" ? [requirementId] : [],
      needsEvidenceRequirementIds: [],
      unknownRequirementIds: [],
    },
    evidenceQuality: { status: "usable", sourceCount: 1, directClaimCount: 1, sourceTypeCount: 1, caveats: [] },
    assessmentMethod: "llm_with_deterministic_guards",
    generatedAt: 1,
  };
}

test("a CV experience claim cannot prove a skill requirement", () => {
  const requirementItem = requirement("skill", "strategic-writing");
  const evidenceClaim = claim();
  const result = applyCoveragePolicy(requirementModel([requirementItem]), coverageModel(requirementItem.id, [evidenceClaim]), [source()]);
  assert.equal(result.policyVersion, COVERAGE_POLICY_VERSION);
  assert.equal(result.coverage[0].state, "partially_proven");
  assert.equal(result.summary.counts.partially_proven, 1);
});

test("an inspectable output can prove a skill requirement", () => {
  const requirementItem = requirement("skill", "strategic-writing");
  const evidenceClaim = claim({ type: "output", sourceEntityType: "learn", sourceEntityId: 2 });
  const result = applyCoveragePolicy(
    requirementModel([requirementItem]),
    coverageModel(requirementItem.id, [evidenceClaim]),
    [source({ id: "source-output", kind: "output", sourceEntityType: "learn", sourceEntityId: 2 })],
  );
  assert.equal(result.coverage[0].state, "proven");
});

test("interview progress may prove an access route but not a professional network", () => {
  const accessRequirement = requirement("access", "hiring-route");
  const networkRequirement = requirement("network", "practitioner-network");
  const marketClaim = claim({ id: "market", key: "market", sourceId: "job-1", type: "market_signal", strength: "supporting", sourceEntityType: "job", sourceEntityId: 1 });
  const marketSource = source({ id: "job-1", kind: "market_signal", sourceEntityType: "job", sourceEntityId: 1 });

  const access = applyCoveragePolicy(requirementModel([accessRequirement]), coverageModel(accessRequirement.id, [marketClaim]), [marketSource]);
  const network = applyCoveragePolicy(requirementModel([networkRequirement]), coverageModel(networkRequirement.id, [marketClaim]), [marketSource]);

  assert.equal(access.coverage[0].state, "proven");
  assert.equal(network.coverage[0].state, "partially_proven");
});

test("unproven becomes unknown when the app lacks the relevant evidence type", () => {
  const networkRequirement = requirement("network", "practitioner-network");
  const model = coverageModel(networkRequirement.id, [], "unproven");
  const result = applyCoveragePolicy(requirementModel([networkRequirement]), model, [source({ kind: "cv" })]);
  assert.equal(result.coverage[0].state, "unknown");
  assert.equal(result.summary.counts.unknown, 1);
});

test("below-bar judgements require explicit negative feedback", () => {
  const skillRequirement = requirement("skill", "forecasting");
  const experienceClaim = claim();
  const model = coverageModel(skillRequirement.id, [experienceClaim], "below_bar");
  const result = applyCoveragePolicy(requirementModel([skillRequirement]), model, [source()]);
  assert.equal(result.coverage[0].state, "partially_proven");
});
