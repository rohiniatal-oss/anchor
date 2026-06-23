import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { UserEvidenceCorpus, UserEvidenceItem, UserEvidenceSourceType } from "./trackResearchCoverageEvidence";
import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import {
  applyCoverageQualityPolicy,
  coverageRequirementFingerprint,
  COVERAGE_QUALITY_POLICY_VERSION,
} from "./trackResearchCoverageQuality";

function requirement(
  id: string,
  category: TargetRequirement["category"],
  successBar = `Observable success bar for ${id}`,
): TargetRequirement {
  return {
    id,
    key: `${category}:${id}`,
    label: id.replace(/-/g, " "),
    aliases: [],
    definition: `${id.replace(/-/g, " ")} for the target role.`,
    group: category === "knowledge" || category === "skill"
      ? "perform_work"
      : category === "network" || category === "access" || category === "eligibility"
        ? "access_opportunity"
        : "demonstrate_credibility",
    category,
    importance: "important",
    importanceReason: "Supported by market evidence.",
    scope: "shared",
    roleFamilyIds: [],
    successBar,
    evidenceClaimIds: [],
    confidence: "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
  };
}

function requirementModel(requirements: TargetRequirement[]): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "same-market-evidence",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: {
      status: "strong",
      sourceCount: 8,
      directSourceCount: 4,
      sourceTypeCount: 3,
      requirementEvidenceCoverage: 100,
      directRequirementCoverage: 80,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function evidence(
  id: string,
  sourceType: UserEvidenceSourceType,
  overrides: Partial<UserEvidenceItem> = {},
): UserEvidenceItem {
  return {
    id,
    sourceType,
    label: "Geopolitical strategy evidence",
    detail: "Applied geopolitical strategy in a relevant professional context.",
    sourceUrl: "",
    strength: "supporting",
    state: "observed",
    usableForCoverage: true,
    sourceEntityType: sourceType,
    sourceEntityId: Number(id.replace(/\D/g, "")) || 1,
    trackIds: [1],
    observedAt: 1,
    ...overrides,
  };
}

function sourceCounts(items: UserEvidenceItem[]): UserEvidenceCorpus["sourceCounts"] {
  const counts: UserEvidenceCorpus["sourceCounts"] = {
    cv: 0,
    profile_summary: 0,
    win: 0,
    learning_output: 0,
    completed_learning: 0,
    proof_asset: 0,
    relationship: 0,
    interaction: 0,
  };
  for (const item of items) counts[item.sourceType] += 1;
  return counts;
}

function corpus(items: UserEvidenceItem[]): UserEvidenceCorpus {
  return {
    mode: "user_evidence_corpus",
    version: 1,
    targetTrackId: 1,
    fingerprint: "user-evidence",
    items,
    sourceCounts: sourceCounts(items),
    caveats: [],
    generatedAt: 1,
  };
}

function coverageModel(
  requirements: RequirementModel,
  items: UserEvidenceItem[],
  statuses: Array<{ requirementId: string; status: CoverageStatus; evidenceItemIds?: string[] }>,
): CoverageModel {
  const coverage = statuses.map((item) => ({
    requirementId: item.requirementId,
    status: item.status,
    confidence: "high" as const,
    evidenceItemIds: item.evidenceItemIds || [],
    reason: "Initial assessment",
    successBarAssessment: "Initial success-bar assessment",
    evidenceStillNeeded: [],
    sourceBasis: "llm" as const,
  }));
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: requirements.target.label,
    requirementModelVersion: requirements.version,
    requirementModelFingerprint: requirements.sourceFingerprint,
    userEvidenceFingerprint: "user-evidence",
    coverage,
    evidenceItems: items,
    sourceInventory: sourceCounts(items),
    groups: requirements.groups.map((group) => ({
      id: group.id,
      requirementIds: group.requirementIds,
      counts: { proven: 0, partially_proven: 0, unproven: 0, unknown: 0, below_bar: 0 },
    })),
    quality: {
      status: "usable",
      assessedRequirementCount: coverage.length,
      unknownRequirementCount: 0,
      citedEvidenceCount: items.length,
      directEvidenceCount: items.filter((item) => item.strength === "verified" || item.strength === "direct").length,
      assessmentCoverage: 100,
      caveats: [],
    },
    generatedAt: 1,
  };
}

test("the exact requirement fingerprint changes when the success bar changes", () => {
  const first = requirementModel([requirement("writing", "skill", "Produces a concise client brief.")]);
  const changed = requirementModel([requirement("writing", "skill", "Produces a sourced board-ready brief with scenarios and recommendations.")]);
  assert.notEqual(coverageRequirementFingerprint(first), coverageRequirementFingerprint(changed));
});

test("the exact requirement fingerprint changes when context changes", () => {
  const first = requirementModel([requirement("writing", "skill")]);
  const changed = requirementModel([requirement("writing", "skill")]);
  changed.requirements[0].context.seniority = ["senior"];
  assert.notEqual(coverageRequirementFingerprint(first), coverageRequirementFingerprint(changed));
});

test("multiple CV declarations cannot by themselves prove job-ready skill", () => {
  const req = requirement("client-writing", "skill", "Produces a client-ready geopolitical brief.");
  const requirements = requirementModel([req]);
  const items = [
    evidence("cv-1", "cv", {
      label: "Client writing experience",
      detail: "Produced geopolitical client writing for senior decision-makers.",
      strength: "declared",
    }),
    evidence("cv-2", "cv", {
      label: "Geopolitical brief experience",
      detail: "Drafted client-ready geopolitical briefs in a strategy role.",
      strength: "declared",
      sourceEntityId: 2,
    }),
  ];
  const initial = coverageModel(requirements, items, [{ requirementId: req.id, status: "proven", evidenceItemIds: items.map((item) => item.id) }]);
  const result = applyCoverageQualityPolicy(requirements, corpus(items), initial);

  assert.equal(result.qualityPolicyVersion, COVERAGE_QUALITY_POLICY_VERSION);
  assert.equal(result.coverage[0].status, "partially_proven");
  assert.equal(result.coverage[0].confidence, "medium");
});

test("a verified applied output can preserve proven skill coverage", () => {
  const req = requirement("client-writing", "skill", "Produces a client-ready geopolitical brief.");
  const requirements = requirementModel([req]);
  const item = evidence("output-1", "learning_output", {
    label: "Client-ready geopolitical brief",
    detail: "Published a concise geopolitical brief for senior decision-makers.",
    strength: "verified",
    state: "published",
    sourceUrl: "https://example.com/brief",
  });
  const initial = coverageModel(requirements, [item], [{ requirementId: req.id, status: "proven", evidenceItemIds: [item.id] }]);
  const result = applyCoverageQualityPolicy(requirements, corpus([item]), initial);

  assert.equal(result.coverage[0].status, "proven");
});

test("same-track evidence still requires relevance to the specific requirement", () => {
  const req = requirement("published-country-risk-analysis", "evidence", "Has an inspectable country-risk analysis.");
  const requirements = requirementModel([req]);
  const unrelated = evidence("output-2", "learning_output", {
    label: "Stakeholder workshop facilitation guide",
    detail: "Published a workshop guide on facilitation and meeting design.",
    strength: "verified",
    state: "published",
    sourceUrl: "https://example.com/workshop",
    trackIds: [1],
  });
  const initial = coverageModel(requirements, [unrelated], [{ requirementId: req.id, status: "proven", evidenceItemIds: [unrelated.id] }]);
  const result = applyCoverageQualityPolicy(requirements, corpus([unrelated]), initial);

  assert.equal(result.coverage[0].status, "unknown");
  assert.deepEqual(result.coverage[0].evidenceItemIds, []);
});

test("topically relevant same-track evidence remains usable", () => {
  const req = requirement("published-country-risk-analysis", "evidence", "Has an inspectable country-risk analysis.");
  const requirements = requirementModel([req]);
  const related = evidence("output-3", "learning_output", {
    label: "Published country risk analysis",
    detail: "Published an inspectable geopolitical country-risk analysis and scenario brief.",
    strength: "verified",
    state: "published",
    sourceUrl: "https://example.com/country-risk",
    trackIds: [1],
  });
  const initial = coverageModel(requirements, [related], [{ requirementId: req.id, status: "proven", evidenceItemIds: [related.id] }]);
  const result = applyCoverageQualityPolicy(requirements, corpus([related]), initial);

  assert.equal(result.coverage[0].status, "proven");
  assert.deepEqual(result.coverage[0].evidenceItemIds, [related.id]);
});

test("one relationship record is too thin to call a network requirement unproven", () => {
  const req = requirement("practitioner-network", "network");
  const requirements = requirementModel([req]);
  const item = evidence("relationship-1", "relationship", {
    label: "Political risk practitioner relationship",
    detail: "Active relationship with a political risk practitioner in geopolitical strategy.",
    strength: "direct",
  });
  const initial = coverageModel(requirements, [], [{ requirementId: req.id, status: "unproven" }]);
  const result = applyCoverageQualityPolicy(requirements, corpus([item]), initial);

  assert.equal(result.coverage[0].status, "unknown");
  assert.equal(result.quality.unknownRequirementCount, 1);
});

test("a broad relationship corpus can support an unproven network judgement", () => {
  const req = requirement("practitioner-network", "network");
  const requirements = requirementModel([req]);
  const items = [1, 2, 3].map((id) => evidence(`relationship-${id}`, "relationship", {
    label: `Political risk practitioner ${id}`,
    detail: `Relevant geopolitical strategy practitioner relationship ${id}.`,
    sourceEntityId: id,
  }));
  const initial = coverageModel(requirements, [], [{ requirementId: req.id, status: "unproven" }]);
  const result = applyCoverageQualityPolicy(requirements, corpus(items), initial);

  assert.equal(result.coverage[0].status, "unproven");
});
