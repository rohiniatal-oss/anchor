import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementModel } from "./trackResearchRequirementModel";
import {
  buildCoverageModelFromSynthesis,
  coverageEvidenceFingerprint,
  type RawUserEvidenceSource,
} from "./trackResearchCoverageModel";

const requirementModel: RequirementModel = {
  mode: "requirement_model",
  version: 2,
  sourceFingerprint: "requirement-source",
  sourceResearchAt: 123,
  target: {
    label: "Geopolitical strategy",
    definition: "Translate geopolitical developments into decision-relevant analysis.",
    assumption: "Chosen target",
  },
  marketSegments: [],
  roleFamilies: [],
  groups: [
    { id: "perform_work", label: "Perform the work", description: "", requirementIds: ["skill-writing"] },
    { id: "demonstrate_credibility", label: "Demonstrate credibility", description: "", requirementIds: ["evidence-memo"] },
    { id: "access_opportunity", label: "Access the opportunity", description: "", requirementIds: ["network-practitioners"] },
  ],
  requirements: [
    {
      id: "skill-writing",
      key: "skill:geopolitical writing",
      label: "Client-ready geopolitical writing",
      aliases: [],
      definition: "Write concise analysis for senior decision-makers.",
      group: "perform_work",
      category: "skill",
      importance: "essential",
      importanceReason: "Direct role evidence",
      scope: "shared",
      roleFamilyIds: [],
      successBar: "Can produce a concise, decision-relevant geopolitical brief.",
      evidenceClaimIds: [],
      confidence: "high",
      context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    },
    {
      id: "evidence-memo",
      key: "evidence:published memo",
      label: "Inspectible geopolitical analysis",
      aliases: [],
      definition: "A work sample that demonstrates analytical ability.",
      group: "demonstrate_credibility",
      category: "evidence",
      importance: "important",
      importanceReason: "Employers expect writing samples",
      scope: "shared",
      roleFamilyIds: [],
      successBar: "Has an inspectable geopolitical memo or equivalent analytical output.",
      evidenceClaimIds: [],
      confidence: "high",
      context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    },
    {
      id: "network-practitioners",
      key: "network:practitioners",
      label: "Relevant practitioner relationships",
      aliases: [],
      definition: "Relationships with people working in the target field.",
      group: "access_opportunity",
      category: "network",
      importance: "important",
      importanceReason: "Hiring routes are relationship-driven",
      scope: "shared",
      roleFamilyIds: [],
      successBar: "Has relevant professional relationships that provide market insight or access.",
      evidenceClaimIds: [],
      confidence: "medium",
      context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    },
  ],
  evidenceClaims: [],
  researchQuality: {
    status: "usable",
    sourceCount: 5,
    directSourceCount: 2,
    sourceTypeCount: 3,
    requirementEvidenceCoverage: 100,
    directRequirementCoverage: 67,
    caveats: [],
  },
  boundaries: { includes: [], excludes: [], openQuestions: [] },
  generatedAt: 123,
};

const sources: RawUserEvidenceSource[] = [
  {
    id: "profile-cv",
    kind: "cv",
    title: "Current CV",
    detail: "Produced strategy papers for senior government stakeholders.",
    sourceUrl: "",
    sourceEntityType: "profile",
    sourceEntityId: 1,
    trackId: null,
    observedAt: 100,
  },
  {
    id: "learn-1",
    kind: "output",
    title: "Published geopolitical memo",
    detail: "A two-page geopolitical risk memo for decision-makers.",
    sourceUrl: "https://example.com/memo",
    sourceEntityType: "learn",
    sourceEntityId: 1,
    trackId: 1,
    observedAt: 200,
  },
  {
    id: "contact-1",
    kind: "relationship",
    title: "Political risk consultant",
    detail: "Warm relationship with a political risk consultant who has replied to outreach.",
    sourceUrl: "",
    sourceEntityType: "contact",
    sourceEntityId: 1,
    trackId: 1,
    observedAt: 300,
  },
];

test("a CV-only skill claim cannot be promoted to proven", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel, sources, {
    evidenceClaims: [
      {
        key: "cv-writing",
        sourceId: "profile-cv",
        type: "experience",
        claim: "Produced strategy papers for senior government stakeholders.",
        relevance: "Related writing experience",
        strength: "direct",
        confidence: "high",
      },
    ],
    assessments: [
      {
        requirementId: "skill-writing",
        state: "proven",
        confidence: "high",
        evidenceKeys: ["cv-writing"],
        reason: "The CV shows relevant writing.",
        missingEvidence: "",
      },
    ],
  }, 500);

  const coverage = model.coverage.find((item) => item.requirementId === "skill-writing");
  assert.equal(coverage?.state, "partially_proven");
  assert.equal(coverage?.confidence, "medium");
});

test("a linked output can prove an evidence requirement", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel, sources, {
    evidenceClaims: [
      {
        key: "memo-output",
        sourceId: "learn-1",
        type: "output",
        claim: "Produced a two-page geopolitical risk memo.",
        relevance: "Direct work sample",
        strength: "direct",
        confidence: "high",
      },
    ],
    assessments: [
      {
        requirementId: "evidence-memo",
        state: "proven",
        confidence: "high",
        evidenceKeys: ["memo-output"],
        reason: "The output is inspectable and directly relevant.",
        missingEvidence: "",
      },
    ],
  }, 500);

  const coverage = model.coverage.find((item) => item.requirementId === "evidence-memo");
  assert.equal(coverage?.state, "proven");
  assert.equal(coverage?.evidenceClaimIds.length, 1);
});

test("a real relationship can prove network coverage", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel, sources, {
    evidenceClaims: [
      {
        key: "practitioner-contact",
        sourceId: "contact-1",
        type: "relationship",
        claim: "Has a warm relationship with a political risk consultant.",
        relevance: "Relevant practitioner access",
        strength: "direct",
        confidence: "high",
      },
    ],
    assessments: [
      {
        requirementId: "network-practitioners",
        state: "proven",
        confidence: "high",
        evidenceKeys: ["practitioner-contact"],
        reason: "A relevant practitioner relationship exists.",
        missingEvidence: "",
      },
    ],
  }, 500);

  assert.equal(model.coverage.find((item) => item.requirementId === "network-practitioners")?.state, "proven");
});

test("invented source ids are discarded and cannot create coverage", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel, sources, {
    evidenceClaims: [
      {
        key: "invented",
        sourceId: "not-a-real-source",
        type: "output",
        claim: "Invented publication",
        relevance: "Would support the requirement",
        strength: "direct",
        confidence: "high",
      },
    ],
    assessments: [
      {
        requirementId: "evidence-memo",
        state: "proven",
        confidence: "high",
        evidenceKeys: ["invented"],
        reason: "Invented evidence",
        missingEvidence: "",
      },
    ],
  }, 500);

  assert.equal(model.evidenceClaims.length, 0);
  assert.equal(model.coverage.find((item) => item.requirementId === "evidence-memo")?.state, "unknown");
});

test("evidence fingerprints are stable and change with source evidence", () => {
  const first = coverageEvidenceFingerprint(requirementModel, sources);
  const second = coverageEvidenceFingerprint(requirementModel, sources);
  const changed = coverageEvidenceFingerprint(requirementModel, [{ ...sources[0], detail: "Updated CV evidence" }, ...sources.slice(1)]);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});
