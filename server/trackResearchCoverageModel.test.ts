import assert from "node:assert/strict";
import test from "node:test";
import { buildCoverageModel, type UserEvidenceBundle, type UserEvidenceItem, type UserEvidenceSourceType } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";

const sourceTypes: UserEvidenceSourceType[] = [
  "cv",
  "profile_summary",
  "win",
  "proof_asset",
  "learning_output",
  "learning_activity",
  "network_relationship",
  "contact_interaction",
  "application_signal",
  "task_completion",
];

function requirement(overrides: Partial<TargetRequirement> = {}): TargetRequirement {
  return {
    id: "req-1",
    key: "skill:strategic writing",
    label: "Strategic writing",
    aliases: ["client-ready writing"],
    definition: "Translate complex analysis into concise decision-ready writing.",
    group: "perform_work",
    category: "skill",
    importance: "important",
    importanceReason: "Repeated across target roles.",
    scope: "shared",
    roleFamilyIds: ["role-1"],
    successBar: "Can produce a concise, decision-ready analytical memo.",
    evidenceClaimIds: ["market-1"],
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
    roleFamilies: [{
      id: "role-1",
      title: "Political Risk Consultant",
      description: "Advisory role",
      typicalOrganizations: [],
      seniority: "mid",
      marketSegmentIds: [],
      evidenceClaimIds: [],
    }],
    groups: [],
    requirements,
    evidenceClaims: [],
    researchQuality: {
      status: "usable",
      sourceCount: 3,
      directSourceCount: 1,
      sourceTypeCount: 2,
      requirementEvidenceCoverage: 100,
      directRequirementCoverage: 50,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 123,
  };
}

function evidenceItem(overrides: Partial<UserEvidenceItem> = {}): UserEvidenceItem {
  return {
    id: "evidence-1",
    sourceType: "cv",
    title: "CV evidence",
    detail: "Produced strategy papers and executive briefings for senior government stakeholders.",
    sourceEntityType: "user_profile",
    sourceEntityId: 1,
    sourceUrl: "",
    trackId: null,
    targetSpecific: false,
    strength: "supporting",
    observedAt: 123,
    ...overrides,
  };
}

function bundle(items: UserEvidenceItem[]): UserEvidenceBundle {
  const sourceCounts = Object.fromEntries(sourceTypes.map((sourceType) => [sourceType, 0])) as UserEvidenceBundle["sourceCounts"];
  items.forEach((item) => { sourceCounts[item.sourceType] += 1; });
  return {
    items,
    fingerprint: "user-evidence-v1",
    sourceCounts,
    sourceCaveats: [],
    collectedAt: 123,
  };
}

test("a CV claim can partially evidence a skill but does not automatically prove it", () => {
  const coverage = buildCoverageModel(model([requirement()]), bundle([evidenceItem()]));
  const assessment = coverage.assessments[0];

  assert.equal(assessment.state, "partially_proven");
  assert.equal(assessment.evidenceItemIds.length, 1);
  assert.match(assessment.rationale, /does not yet fully demonstrate/i);
});

test("a direct inspectable output can prove an evidence requirement", () => {
  const req = requirement({
    id: "req-proof",
    key: "evidence:geopolitical memo",
    label: "Geopolitical analytical work sample",
    aliases: ["geopolitical memo"],
    category: "evidence",
    group: "demonstrate_credibility",
    successBar: "Has an inspectable geopolitical memo that demonstrates analytical judgement.",
  });
  const output = evidenceItem({
    id: "proof-1",
    sourceType: "learning_output",
    title: "Geopolitical analytical memo",
    detail: "Published geopolitical memo demonstrating analytical judgement and implications for decision-makers.",
    sourceUrl: "https://example.com/memo",
    strength: "direct",
  });
  const coverage = buildCoverageModel(model([req]), bundle([output]));

  assert.equal(coverage.assessments[0].state, "proven");
  assert.equal(coverage.assessments[0].missingEvidence, "");
});

test("missing user data remains unknown rather than being treated as weakness", () => {
  const req = requirement({
    id: "req-eligibility",
    key: "eligibility:security clearance",
    label: "Security clearance eligibility",
    category: "eligibility",
    group: "access_opportunity",
    successBar: "Meets the formal security clearance condition.",
  });
  const coverage = buildCoverageModel(model([req]), bundle([]));

  assert.equal(coverage.assessments[0].state, "unknown");
  assert.match(coverage.assessments[0].rationale, /does not have enough/i);
});

test("an inspected evidence source with no matching proof is marked unproven, not missing ability", () => {
  const req = requirement({
    id: "req-forecasting",
    key: "skill:forecasting",
    label: "Geopolitical forecasting",
    aliases: [],
    definition: "Make explicit, testable geopolitical forecasts.",
    successBar: "Can produce calibrated forecasts and review accuracy.",
  });
  const unrelatedCv = evidenceItem({ detail: "Managed a complex stakeholder engagement programme across government ministries." });
  const coverage = buildCoverageModel(model([req]), bundle([unrelatedCv]));

  assert.equal(coverage.assessments[0].state, "unproven");
  assert.match(coverage.assessments[0].rationale, /unproven in Anchor, not absent/i);
});

test("explicit negative outcome evidence can support a below-bar assessment", () => {
  const req = requirement({
    id: "req-writing",
    key: "skill:strategic writing",
    label: "Strategic writing",
  });
  const feedback = evidenceItem({
    id: "feedback-1",
    sourceType: "win",
    title: "Interview feedback on strategic writing",
    detail: "Negative feedback: strategic writing was not concise enough and needs improvement.",
    strength: "direct",
  });
  const coverage = buildCoverageModel(model([req]), bundle([feedback]));

  assert.equal(coverage.assessments[0].state, "below_bar");
});
