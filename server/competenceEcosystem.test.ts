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
  assert.ok(professional);
  assert.match(professional.name, /executive communication|decision support/i);
  assert.deepEqual(professional.requiredContributors, ["practice", "feedback", "experience", "reflection"]);
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
});

test("inactive tracks are excluded from the active competence snapshot", () => {
  const payload = buildCompetenceEcosystems({
    ...emptyInput,
    tracks: [track({ status: "watch" })],
  });

  assert.equal(payload.ecosystems.length, 0);
  assert.match(payload.summary, /No active career directions/i);
});
