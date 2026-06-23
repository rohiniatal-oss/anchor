import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import {
  buildCoverageEvidenceSourcesFromSnapshot,
  buildCoverageModelFromSynthesis,
  coverageEvidenceFingerprint,
  type RawUserEvidenceSource,
} from "./trackResearchCoverageModel";

function requirement(
  id: string,
  label: string,
  category: TargetRequirement["category"],
  successBar: string,
): TargetRequirement {
  return {
    id,
    key: `${category}:${label.toLowerCase()}`,
    label,
    aliases: [],
    definition: `${label} for target-role work.`,
    group: category === "knowledge" || category === "skill"
      ? "perform_work"
      : category === "network" || category === "access" || category === "eligibility"
        ? "access_opportunity"
        : "demonstrate_credibility",
    category,
    importance: "important",
    importanceReason: "Supported by target research.",
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
    sourceFingerprint: "requirements-v1",
    sourceResearchAt: 1,
    target: {
      label: "Geopolitical strategy",
      definition: "Translate geopolitical developments into decisions.",
      assumption: "Chosen target",
    },
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
      status: "strong",
      sourceCount: 10,
      directSourceCount: 4,
      sourceTypeCount: 4,
      requirementEvidenceCoverage: 100,
      directRequirementCoverage: 70,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

const writing = requirement(
  "req-writing",
  "Client-ready geopolitical writing",
  "skill",
  "Can produce a concise geopolitical brief with clear implications for a senior decision-maker.",
);

const publishedProof = requirement(
  "req-proof",
  "Published geopolitical analysis",
  "evidence",
  "Has an inspectable geopolitical analysis that demonstrates judgement and writing quality.",
);

const practitionerNetwork = requirement(
  "req-network",
  "Relevant practitioner relationships",
  "network",
  "Has active relationships with practitioners who understand the target field and hiring market.",
);

const hiringAccess = requirement(
  "req-access",
  "Credible hiring access",
  "access",
  "Has at least one credible route into relevant hiring processes.",
);

const cvSource: RawUserEvidenceSource = {
  id: "profile-cv",
  kind: "cv",
  title: "Current CV",
  detail: "Produced strategy papers for senior government stakeholders.",
  sourceUrl: "",
  sourceEntityType: "profile",
  sourceEntityId: 1,
  trackId: null,
  observedAt: 100,
};

const outputSource: RawUserEvidenceSource = {
  id: "learn-1",
  kind: "output",
  title: "Published geopolitical memo",
  detail: "A two-page geopolitical risk memo for decision-makers.",
  sourceUrl: "https://example.com/memo",
  sourceEntityType: "learn",
  sourceEntityId: 1,
  trackId: 1,
  observedAt: 200,
};

const relationshipSource: RawUserEvidenceSource = {
  id: "contact-1",
  kind: "relationship",
  title: "Political risk consultant",
  detail: "Warm relationship with a political risk consultant who has replied to outreach.",
  sourceUrl: "",
  sourceEntityType: "contact",
  sourceEntityId: 1,
  trackId: 1,
  observedAt: 300,
};

const marketSignalSource: RawUserEvidenceSource = {
  id: "job-1",
  kind: "market_signal",
  title: "Political Risk Consultant interview",
  detail: "Invited to interview for a political risk consulting role.",
  sourceUrl: "https://example.com/job",
  sourceEntityType: "job",
  sourceEntityId: 1,
  trackId: 1,
  observedAt: 400,
};

test("a CV-only skill claim cannot be promoted to proven", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel([writing]), [cvSource], {
    evidenceClaims: [{
      key: "cv-writing",
      sourceId: "profile-cv",
      type: "experience",
      claim: "Produced strategy papers for senior government stakeholders.",
      relevance: "Related writing experience",
      strength: "direct",
      confidence: "high",
    }],
    assessments: [{
      requirementId: writing.id,
      state: "proven",
      confidence: "high",
      evidenceKeys: ["cv-writing"],
      reason: "The CV shows relevant writing.",
      missingEvidence: "",
    }],
  }, 500);

  const coverage = model.coverage[0];
  assert.equal(coverage.state, "partially_proven");
  assert.equal(coverage.confidence, "medium");
});

test("a linked inspectable output can prove an evidence requirement", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel([publishedProof]), [outputSource], {
    evidenceClaims: [{
      key: "memo-output",
      sourceId: outputSource.id,
      type: "output",
      claim: "Produced a two-page geopolitical risk memo.",
      relevance: "Direct work sample",
      strength: "direct",
      confidence: "high",
    }],
    assessments: [{
      requirementId: publishedProof.id,
      state: "proven",
      confidence: "high",
      evidenceKeys: ["memo-output"],
      reason: "The output is inspectable and directly relevant.",
      missingEvidence: "",
    }],
  }, 500);

  assert.equal(model.coverage[0].state, "proven");
});

test("cold named contacts are not treated as established relationship evidence", () => {
  const sources = buildCoverageEvidenceSourcesFromSnapshot({
    contacts: [{
      id: 10,
      name: "Named person",
      who: "Political risk consultant",
      relationshipStrength: "cold",
      status: "to_contact",
    }],
  }, 1);

  assert.equal(sources.some((source) => source.id === "contact-10"), false);
});

test("a completed course with only a planned output title remains learning evidence", () => {
  const sources = buildCoverageEvidenceSourcesFromSnapshot({
    learns: [{
      id: 8,
      title: "Geopolitical writing course",
      done: true,
      outputTitle: "Planned country risk memo",
      outputEvidenceUrl: "",
      outputStatus: "",
      url: "https://example.com/course",
    }],
  }, 1);

  assert.equal(sources[0]?.kind, "learning");
  assert.equal(sources[0]?.sourceUrl, "https://example.com/course");
});

test("an idea-stage proof asset is not counted as current evidence", () => {
  const sources = buildCoverageEvidenceSourcesFromSnapshot({
    hustles: [{
      id: 3,
      title: "Country risk memo",
      stage: "idea",
      coreClaim: "A planned analysis",
    }],
  }, 1);

  assert.equal(sources.length, 0);
});

test("a real relationship can prove network coverage", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel([practitionerNetwork]), [relationshipSource], {
    evidenceClaims: [{
      key: "relationship",
      sourceId: relationshipSource.id,
      type: "relationship",
      claim: "Has a warm relationship with a political risk consultant.",
      relevance: "Relevant practitioner relationship",
      strength: "direct",
      confidence: "high",
    }],
    assessments: [{
      requirementId: practitionerNetwork.id,
      state: "proven",
      confidence: "high",
      evidenceKeys: ["relationship"],
      reason: "A relevant practitioner relationship exists.",
      missingEvidence: "",
    }],
  }, 500);

  assert.equal(model.coverage[0].state, "proven");
});

test("an interview-stage signal can prove access but cannot prove a network", () => {
  const requirements = requirementModel([practitionerNetwork, hiringAccess]);
  const synthesis = {
    evidenceClaims: [{
      key: "interview",
      sourceId: marketSignalSource.id,
      type: "market_signal" as const,
      claim: "Invited to interview for a political risk consulting role.",
      relevance: "Demonstrates access to a live hiring process",
      strength: "direct" as const,
      confidence: "high" as const,
    }],
    assessments: [
      { requirementId: practitionerNetwork.id, state: "proven" as const, confidence: "high" as const, evidenceKeys: ["interview"], reason: "Shows network access.", missingEvidence: "" },
      { requirementId: hiringAccess.id, state: "proven" as const, confidence: "high" as const, evidenceKeys: ["interview"], reason: "Shows access to a live process.", missingEvidence: "" },
    ],
  };
  const model = buildCoverageModelFromSynthesis(requirements, [marketSignalSource], synthesis, 500);

  assert.notEqual(model.coverage.find((item) => item.requirementId === practitionerNetwork.id)?.state, "proven");
  assert.equal(model.coverage.find((item) => item.requirementId === hiringAccess.id)?.state, "proven");
});

test("unproven is downgraded to unknown when the evidence corpus is too thin", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel([writing]), [cvSource], {
    evidenceClaims: [],
    assessments: [{
      requirementId: writing.id,
      state: "unproven",
      confidence: "high",
      evidenceKeys: [],
      reason: "No proof found.",
      missingEvidence: writing.successBar,
    }],
  }, 500);

  assert.equal(model.coverage[0].state, "unknown");
  assert.equal(model.coverage[0].confidence, "low");
});

test("unproven remains valid after a broad relevant evidence corpus was reviewed", () => {
  const broadSources: RawUserEvidenceSource[] = [
    cvSource,
    ...[1, 2, 3].map((id) => ({
      id: `win-${id}`,
      kind: "win" as const,
      title: `Other demonstrated capability ${id}`,
      detail: `Led and delivered a distinct complex workstream with measurable outcomes ${id}.`,
      sourceUrl: "",
      sourceEntityType: "win",
      sourceEntityId: id,
      trackId: 1,
      observedAt: 100 + id,
    })),
  ];
  const model = buildCoverageModelFromSynthesis(requirementModel([writing]), broadSources, {
    evidenceClaims: [],
    assessments: [{
      requirementId: writing.id,
      state: "unproven",
      confidence: "high",
      evidenceKeys: [],
      reason: "A broad evidence set did not demonstrate this requirement.",
      missingEvidence: writing.successBar,
    }],
  }, 500);

  assert.equal(model.coverage[0].state, "unproven");
  assert.equal(model.coverage[0].confidence, "medium");
});

test("below-bar coverage requires explicit negative feedback", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel([writing]), [cvSource], {
    evidenceClaims: [{
      key: "not-feedback",
      sourceId: cvSource.id,
      type: "experience",
      claim: "Produced strategy papers for senior government stakeholders.",
      relevance: "Related experience",
      strength: "direct",
      confidence: "high",
    }],
    assessments: [{
      requirementId: writing.id,
      state: "below_bar",
      confidence: "high",
      evidenceKeys: ["not-feedback"],
      reason: "Below bar.",
      missingEvidence: writing.successBar,
    }],
  }, 500);

  assert.notEqual(model.coverage[0].state, "below_bar");
});

test("invented source ids are discarded and cannot create coverage", () => {
  const model = buildCoverageModelFromSynthesis(requirementModel([publishedProof]), [outputSource], {
    evidenceClaims: [{
      key: "invented",
      sourceId: "not-a-real-source",
      type: "output",
      claim: "Invented publication",
      relevance: "Would support the requirement",
      strength: "direct",
      confidence: "high",
    }],
    assessments: [{
      requirementId: publishedProof.id,
      state: "proven",
      confidence: "high",
      evidenceKeys: ["invented"],
      reason: "Invented evidence",
      missingEvidence: "",
    }],
  }, 500);

  assert.equal(model.evidenceClaims.length, 0);
  assert.equal(model.coverage[0].state, "unknown");
});

test("evidence fingerprints are stable and change with source evidence", () => {
  const requirements = requirementModel([writing]);
  const sources = [cvSource, outputSource];
  const first = coverageEvidenceFingerprint(requirements, sources);
  const second = coverageEvidenceFingerprint(requirements, sources);
  const changed = coverageEvidenceFingerprint(requirements, [{ ...cvSource, detail: "Updated CV evidence" }, outputSource]);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});
