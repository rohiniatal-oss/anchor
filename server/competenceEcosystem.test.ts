import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetenceEcosystems } from "./competenceEcosystem";

function track(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "ai-governance",
    name: "AI Governance",
    description: "AI governance and frontier model risk work",
    targetRoleArchetype: "AI governance strategy roles",
    priority: 90,
    status: "active",
    whyItFits: "Builds on strategy and delivery experience",
    trackIntelligence: JSON.stringify({ domains: ["risk frameworks", "model governance", "AI regulation"] }),
    createdAt: 1,
    ...overrides,
  } as any;
}

const emptyInput = {
  tracks: [],
  jobs: [],
  learn: [],
  contacts: [],
  hustles: [],
  tasks: [],
  wins: [],
};

test("competence ecosystems separate domain professional experience and evidence areas", () => {
  const payload = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track()],
    learn: [
      { id: 1, title: "AI governance primer", learnStatus: "open", done: false, relatedTrackId: 1, requiredOutput: "terrain map", type: "resource" } as any,
    ],
  });

  assert.equal(payload.readOnlySnapshot, true);
  assert.equal(payload.ecosystems.length, 1);
  const ecosystem = payload.ecosystems[0];
  assert.deepEqual(ecosystem.competenceAreas.map((area) => area.kind), ["domain", "professional", "experience", "evidence"]);
  assert.match(ecosystem.operatingPrinciple, /coherent experiences/i);
  assert.equal(ecosystem.programSlice?.experiences.length, 3, "planner should offer a program slice, not one isolated step");
});

test("when knowledge exists but practice is absent the next slice moves into application", () => {
  const payload = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track()],
    learn: [
      { id: 1, title: "AI governance primer", learnStatus: "open", done: false, relatedTrackId: 1, requiredOutput: "terrain map", type: "resource" } as any,
    ],
  });
  const ecosystem = payload.ecosystems[0];

  assert.equal(ecosystem.contributors.find((item) => item.key === "knowledge")?.state, "active");
  assert.equal(ecosystem.weakestContributor?.key, "practice");
  assert.equal(ecosystem.programSlice?.focusContributor, "practice");
  assert.equal(ecosystem.programSlice?.stage, "application");
  assert.match(ecosystem.programSlice?.experiences[0].title || "", /Apply one AI Governance framework/i);
});

test("role competency profile adds target standards evidence gaps and estimate confidence", () => {
  const payload = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track()],
    learn: [
      { id: 1, title: "AI governance primer", learnStatus: "open", done: false, relatedTrackId: 1, requiredOutput: "terrain map", type: "resource" } as any,
    ],
  });
  const ecosystem = payload.ecosystems[0];
  const profile = ecosystem.roleProfile;
  const domain = profile.requiredCompetencies.find((item) => item.key === "domain_judgement")!;

  assert.equal(profile.profileType, "ai_governance");
  assert.match(profile.targetStandard, /AI governance strategy roles/i);
  assert.equal(domain.importance, "critical");
  assert.equal(domain.targetLevel, "strong");
  assert.equal(domain.currentLevel, "emerging");
  assert.equal(domain.confidence, "low", "missing practice/reflection should keep estimate confidence low");
  assert.match(domain.evidenceGap, /Practice|Reflection|Missing/i);
  assert.ok(domain.evidenceRequired.includes("applied case note"));
  assert.ok(domain.subdomains.includes("risk frameworks"));
  assert.match(ecosystem.programSlice?.thesis || "", /domain judgement|practice/i);
  assert.equal(ecosystem.programSlice?.targetCompetencyKey, "domain_judgement");
});

test("passive learning does not count as visible evidence but output evidence does", () => {
  const passive = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track()],
    learn: [
      { id: 1, title: "AI governance reading list", learnStatus: "open", done: false, relatedTrackId: 1, type: "resource" } as any,
      { id: 2, title: "Responsible AI podcast", learnStatus: "open", done: false, relatedTrackId: 1, type: "podcast" } as any,
    ],
  }).ecosystems[0];
  const applied = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track()],
    learn: [
      { id: 3, title: "AI governance case analysis", learnStatus: "done", done: true, relatedTrackId: 1, type: "practice", outputTitle: "AI governance case note", outputEvidenceUrl: "https://example.com/case-note" } as any,
    ],
  }).ecosystems[0];

  const passiveKnowledge = passive.contributors.find((item) => item.key === "knowledge")!;
  const passiveEvidence = passive.contributors.find((item) => item.key === "evidence")!;
  const appliedEvidence = applied.contributors.find((item) => item.key === "evidence")!;

  assert.notEqual(passiveKnowledge.state, "empty");
  assert.equal(passiveEvidence.state, "empty", "reading alone should not create market evidence");
  assert.notEqual(appliedEvidence.state, "empty");
  assert.ok(appliedEvidence.evidenceScore > passiveEvidence.evidenceScore);
  assert.equal(appliedEvidence.evidenceSignals[0].evidenceType, "published");
});

test("professional tracks infer professional operating capability instead of domain-only learning", () => {
  const payload = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track({
      id: 2,
      slug: "chief-of-staff",
      name: "Chief of Staff",
      description: "Founder office, executive decision support, prioritisation, and operating cadence",
      targetRoleArchetype: "chief of staff",
      whyItFits: "Uses operating and stakeholder experience",
      trackIntelligence: "",
    })],
  });

  const professional = payload.ecosystems[0].competenceAreas.find((area) => area.kind === "professional");
  const professionalRequirement = payload.ecosystems[0].roleProfile.requiredCompetencies.find((item) => item.key === "professional_operating_capability");
  assert.ok(professional);
  assert.match(professional.name, /executive communication|decision support/i);
  assert.deepEqual(professional.requiredContributors, ["practice", "feedback", "experience", "reflection"]);
  assert.equal(professionalRequirement?.importance, "critical");
  assert.equal(professionalRequirement?.targetLevel, "strong");
  assert.match(professionalRequirement?.subdomains.join(" ") || "", /executive communication|decision support|prioritisation/i);
});

test("evidence feedback and network signals change contributor states", () => {
  const payload = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track()],
    contacts: [
      { id: 1, who: "AI governance operator", why: "Can give feedback on memo", status: "replied", relatedTrackId: 1, askType: "advice" } as any,
    ],
    hustles: [
      { id: 1, title: "AI governance memo", note: "proof asset", stage: "idea", proofAssetForTrack: 1 } as any,
    ],
    wins: [
      { id: 1, text: "Published a short AI governance note", winCategory: "proof_asset", trackId: 1, takeaway: "My model improved", createdAt: Date.now() } as any,
    ],
  });
  const contributors = new Map(payload.ecosystems[0].contributors.map((item) => [item.key, item]));

  assert.notEqual(contributors.get("network")?.state, "empty");
  assert.notEqual(contributors.get("feedback")?.state, "empty");
  assert.notEqual(contributors.get("evidence")?.state, "empty");
  assert.notEqual(contributors.get("reflection")?.state, "empty");
  assert.ok((contributors.get("feedback")?.evidenceScore || 0) >= 4, "replied practitioner contact should carry more weight than a saved name");
});

test("inactive tracks are excluded from the active competence snapshot", () => {
  const payload = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track({ status: "watch" })],
  });

  assert.equal(payload.ecosystems.length, 0);
  assert.match(payload.summary, /No active career directions/i);
});
