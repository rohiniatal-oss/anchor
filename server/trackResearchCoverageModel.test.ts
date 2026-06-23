import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoverageModelFromEvidence,
  coverageModelMatchesRequirementModel,
  type UserEvidenceItem,
} from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";

function requirement(overrides: Partial<TargetRequirement> = {}): TargetRequirement {
  return {
    id: "target-requirement-writing",
    key: "skill:client ready geopolitical writing",
    label: "Client-ready geopolitical writing",
    aliases: [],
    definition: "Translate geopolitical analysis into concise implications for senior decision-makers.",
    group: "perform_work",
    category: "skill",
    importance: "essential",
    importanceReason: "Direct role evidence treats this as core to the work.",
    scope: "shared",
    roleFamilyIds: [],
    successBar: "Can produce a concise, decision-ready geopolitical brief with clear implications.",
    evidenceClaimIds: ["market-evidence-1"],
    confidence: "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    ...overrides,
  };
}

function model(requirements: TargetRequirement[]): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements-v1",
    sourceResearchAt: 123,
    target: { label: "Geopolitical strategy", definition: "Target", assumption: "Chosen target" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform the work", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate credibility", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access the opportunity", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: {
      status: "usable",
      sourceCount: 4,
      directSourceCount: 2,
      sourceTypeCount: 2,
      requirementEvidenceCoverage: 100,
      directRequirementCoverage: 100,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 123,
  };
}

function evidence(overrides: Partial<UserEvidenceItem> = {}): UserEvidenceItem {
  return {
    id: "user-evidence-1",
    sourceType: "proof_asset",
    sourceId: "1",
    title: "Published geopolitical memo",
    detail: "Published a two-page geopolitical risk memo for senior decision-makers with implications and scenarios.",
    url: "https://example.com/memo",
    evidenceType: "output",
    directness: "direct",
    polarity: "positive",
    relatedTrackId: 1,
    createdAt: 123,
    ...overrides,
  };
}

test("direct compatible evidence can substantiate a requirement", () => {
  const requirementModel = model([requirement()]);
  const coverage = buildCoverageModelFromEvidence(requirementModel, [evidence()], {
    assessments: [{
      requirementId: "target-requirement-writing",
      status: "proven",
      confidence: "high",
      evidenceItemIds: ["user-evidence-1"],
      summary: "Direct proof exists.",
    }],
  }, 456);

  assert.equal(coverage.coverage[0]?.status, "proven");
  assert.equal(coverage.coverage[0]?.confidence, "high");
  assert.deepEqual(coverage.coverage[0]?.evidenceItemIds, ["user-evidence-1"]);
});

test("completed learning alone cannot prove applied skill", () => {
  const requirementModel = model([requirement()]);
  const completedCourse = evidence({
    id: "user-evidence-course",
    sourceType: "learn",
    title: "Completed course",
    detail: "Completed a course on geopolitical analysis.",
    evidenceType: "learning",
    directness: "supporting",
    url: "",
  });
  const coverage = buildCoverageModelFromEvidence(requirementModel, [completedCourse], {
    assessments: [{
      requirementId: "target-requirement-writing",
      status: "proven",
      confidence: "high",
      evidenceItemIds: ["user-evidence-course"],
    }],
  });

  assert.notEqual(coverage.coverage[0]?.status, "proven");
  assert.equal(coverage.coverage[0]?.status, "unknown");
});

test("invented evidence ids are ignored and absence is not treated as below bar", () => {
  const requirementModel = model([requirement()]);
  const coverage = buildCoverageModelFromEvidence(requirementModel, [], {
    assessments: [{
      requirementId: "target-requirement-writing",
      status: "below_bar",
      confidence: "high",
      evidenceItemIds: ["invented-evidence"],
    }],
  });

  assert.equal(coverage.coverage[0]?.status, "unknown");
  assert.deepEqual(coverage.coverage[0]?.evidenceItemIds, []);
});

test("warm relationship evidence can prove a network requirement", () => {
  const networkRequirement = requirement({
    id: "target-requirement-network",
    key: "network:practitioner relationships",
    label: "Practitioner relationships",
    category: "network",
    group: "access_opportunity",
    successBar: "Has relevant practitioners who respond and can provide market insight.",
  });
  const relationship = evidence({
    id: "user-evidence-contact",
    sourceType: "contact",
    title: "Relevant professional relationship",
    detail: "Warm relationship with a political risk consultant who has replied and met.",
    evidenceType: "relationship",
    directness: "direct",
    url: "",
  });
  const coverage = buildCoverageModelFromEvidence(model([networkRequirement]), [relationship], {
    assessments: [{
      requirementId: "target-requirement-network",
      status: "proven",
      confidence: "high",
      evidenceItemIds: ["user-evidence-contact"],
    }],
  });

  assert.equal(coverage.coverage[0]?.status, "proven");
});

test("coverage compatibility is invalidated when the requirement model changes", () => {
  const first = model([requirement()]);
  const coverage = buildCoverageModelFromEvidence(first, [evidence()]);
  assert.equal(coverageModelMatchesRequirementModel(coverage, first), true);

  const changed = { ...first, sourceFingerprint: "requirements-v2" };
  assert.equal(coverageModelMatchesRequirementModel(coverage, changed), false);
});
