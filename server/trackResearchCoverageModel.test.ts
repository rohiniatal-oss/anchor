import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementCategory, RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { UserEvidenceCorpus, UserEvidenceItem, UserEvidenceSourceType } from "./trackResearchCoverageEvidence";
import { buildCoverageModel } from "./trackResearchCoverageModel";

function requirement(id: string, category: RequirementCategory, label: string): TargetRequirement {
  return {
    id,
    key: `${category}:${label.toLowerCase()}`,
    label,
    aliases: [],
    definition: `${label} for the target role.`,
    group: category === "knowledge" || category === "skill" ? "perform_work" : category === "network" || category === "access" || category === "eligibility" ? "access_opportunity" : "demonstrate_credibility",
    category,
    importance: "important",
    importanceReason: "Repeated target requirement.",
    scope: "shared",
    roleFamilyIds: [],
    successBar: `Can demonstrate ${label}.`,
    evidenceClaimIds: [],
    confidence: "medium",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
  };
}

function requirementModel(requirements: TargetRequirement[]): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements-1",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Target definition", assumption: "Chosen target" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform the work", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate credibility", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access the opportunity", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: { status: "usable", sourceCount: 3, directSourceCount: 1, sourceTypeCount: 2, requirementEvidenceCoverage: 100, directRequirementCoverage: 50, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function evidence(
  id: string,
  sourceType: UserEvidenceSourceType,
  detail: string,
  overrides: Partial<UserEvidenceItem> = {},
): UserEvidenceItem {
  return {
    id,
    sourceType,
    label: detail,
    detail,
    sourceUrl: "",
    strength: "supporting",
    state: "observed",
    usableForCoverage: true,
    sourceEntityType: sourceType,
    sourceEntityId: 1,
    trackIds: [1],
    observedAt: 1,
    ...overrides,
  };
}

function corpus(items: UserEvidenceItem[]): UserEvidenceCorpus {
  const sourceCounts = {
    cv: 0,
    profile_summary: 0,
    win: 0,
    learning_output: 0,
    completed_learning: 0,
    proof_asset: 0,
    relationship: 0,
    interaction: 0,
  };
  for (const item of items) sourceCounts[item.sourceType] += 1;
  return {
    mode: "user_evidence_corpus",
    version: 1,
    targetTrackId: 1,
    fingerprint: "evidence-1",
    items,
    sourceCounts,
    caveats: [],
    generatedAt: 1,
  };
}

test("proof requirements are not marked proven without a verified output", () => {
  const req = requirement("proof", "evidence", "Published geopolitical analysis");
  const item = evidence("draft", "proof_asset", "Geopolitical analysis portfolio", { strength: "supporting" });
  const model = buildCoverageModel(requirementModel([req]), corpus([item]), {
    assessments: [{ requirementId: req.id, status: "proven", confidence: "high", evidenceItemIds: [item.id], reason: "Related asset", successBarAssessment: "Met", evidenceStillNeeded: [] }],
  });

  assert.equal(model.coverage[0]?.status, "partially_proven");
  assert.equal(model.coverage[0]?.confidence, "high");
});

test("a verified published output can prove an evidence requirement", () => {
  const req = requirement("proof", "evidence", "Published geopolitical analysis");
  const item = evidence("published", "learning_output", "Published geopolitical analysis with source link", { strength: "verified", state: "published", sourceUrl: "https://example.com/output" });
  const model = buildCoverageModel(requirementModel([req]), corpus([item]), {
    assessments: [{ requirementId: req.id, status: "proven", confidence: "high", evidenceItemIds: [item.id], reason: "Inspectable output", successBarAssessment: "The output meets the bar", evidenceStillNeeded: [] }],
  });

  assert.equal(model.coverage[0]?.status, "proven");
  assert.deepEqual(model.coverage[0]?.evidenceItemIds, [item.id]);
});

test("access coverage can be proven by a relevant referral interaction", () => {
  const req = requirement("access", "access", "Warm entry route to target employers");
  const item = evidence("referral", "interaction", "Referral introduction to a geopolitical advisory hiring manager", { strength: "direct" });
  const model = buildCoverageModel(requirementModel([req]), corpus([item]), {
    assessments: [{ requirementId: req.id, status: "proven", confidence: "high", evidenceItemIds: [item.id], reason: "Referral route exists", successBarAssessment: "Met", evidenceStillNeeded: [] }],
  });

  assert.equal(model.coverage[0]?.status, "proven");
});

test("network requirements stay unknown when no relationship evidence source exists", () => {
  const req = requirement("network", "network", "Relevant practitioner relationships");
  const item = evidence("cv", "cv", "Strategy consulting and government advisory experience", { strength: "declared" });
  const model = buildCoverageModel(requirementModel([req]), corpus([item]), {
    assessments: [{ requirementId: req.id, status: "unproven", confidence: "medium", evidenceItemIds: [], reason: "No contacts", successBarAssessment: "Not met", evidenceStillNeeded: ["Relationship evidence"] }],
  });

  assert.equal(model.coverage[0]?.status, "unknown");
});

test("invalid evidence IDs cannot support a coverage claim", () => {
  const req = requirement("skill", "skill", "Client-ready geopolitical writing");
  const item = evidence("cv", "cv", "Produced strategy papers for senior government stakeholders", { strength: "declared" });
  const model = buildCoverageModel(requirementModel([req]), corpus([item]), {
    assessments: [{ requirementId: req.id, status: "proven", confidence: "high", evidenceItemIds: ["invented-id"], reason: "Unsupported", successBarAssessment: "Met", evidenceStillNeeded: [] }],
  });

  assert.notEqual(model.coverage[0]?.status, "proven");
  assert.deepEqual(model.coverage[0]?.evidenceItemIds, []);
});
