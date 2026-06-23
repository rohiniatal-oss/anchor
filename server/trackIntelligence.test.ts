import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateTrackIntelligence, type RequirementBrief } from "./trackIntelligence";

const makeTrack = (overrides: any = {}) => ({
  id: 1,
  slug: "ai-governance",
  name: "AI governance strategy and implementation",
  description: "Strategy roles in AI governance and safety policy",
  targetRoleArchetype: "advisory",
  priority: 80,
  status: "active",
  whyItFits: "Combines policy background with AI interest",
  trackIntelligence: "",
  createdAt: Date.now(),
  ...overrides,
});

const makeJob = (id: number, overrides: any = {}) => ({
  id,
  title: `Role ${id}`,
  company: `Company ${id}`,
  status: "wishlist",
  applicationWindowStatus: "open",
  location: "London",
  roleArchetype: "advisory",
  relatedTrackId: 1,
  jdText: "",
  roleModel: "",
  ...overrides,
});

const makeRoleModel = (overrides: any = {}) => JSON.stringify({
  mandate: "Shape AI governance policy",
  coreWork: ["Draft position papers", "Engage regulators"],
  capabilityRequirements: [
    { text: "Stakeholder translation", explicit: true },
    { text: "Cross-jurisdiction regulation", explicit: true },
  ],
  sectorFluency: [
    { text: "EU AI Act and governance frameworks", explicit: true },
  ],
  evidenceBar: [
    { text: "Led a policy initiative from draft to adoption", explicit: true },
  ],
  fitSignals: [
    { text: "Comfortable across technical and non-technical audiences", explicit: true },
  ],
  hiddenRequirements: [],
  ambiguities: [],
  ...overrides,
});

test("aggregateTrackIntelligence builds intelligence from role models", () => {
  const track = makeTrack();
  const jobs = [
    makeJob(1, { title: "AI Governance Advisor", company: "DeepMind", roleModel: makeRoleModel() }),
    makeJob(2, { title: "AI Policy Lead", company: "Google", roleModel: makeRoleModel({
      capabilityRequirements: [
        { text: "Stakeholder translation", explicit: true },
        { text: "Policy analysis and drafting", explicit: true },
      ],
      sectorFluency: [
        { text: "EU AI Act and governance frameworks", explicit: true },
        { text: "US executive orders on AI", explicit: true },
      ],
    }) }),
  ] as any[];

  const intel = aggregateTrackIntelligence(track, jobs, [], [], [], []);
  assert.equal(intel.roleModelsAnalyzed, 2);
  assert.equal(intel.activeOpportunityCount, 2);
  assert.ok(intel.targetOrganizations.includes("DeepMind"));
  assert.ok(intel.targetOrganizations.includes("Google"));

  const stakeholderCap = intel.recurringCapabilities.find((c) => /stakeholder/i.test(c.text));
  assert.ok(stakeholderCap, "should find recurring stakeholder translation capability");
  assert.equal(stakeholderCap!.frequency, 2, "should count frequency across roles");
  assert.equal(stakeholderCap!.sourceRoles.length, 2);

  const euAiAct = intel.recurringKnowledgeNeeds.find((k) => /EU AI Act/i.test(k.text));
  assert.ok(euAiAct, "should find recurring EU AI Act knowledge need");
  assert.equal(euAiAct!.frequency, 2);
});

test("aggregateTrackIntelligence includes learning and proof assets", () => {
  const track = makeTrack();
  const learn = [
    { id: 1, title: "EU AI Act deep dive", relatedTrackId: 1, done: false, learnStatus: "active", capabilityBuilt: "AI governance" },
  ] as any[];
  const hustles = [
    { id: 1, title: "AI governance strategy note", proofAssetForTrack: 1, stage: "idea" },
  ] as any[];

  const intel = aggregateTrackIntelligence(track, [], learn, [], hustles, []);
  assert.ok(intel.learningPriorities.includes("EU AI Act deep dive"));
  assert.ok(intel.proofAssetsToBuild.includes("AI governance strategy note"));
});

test("aggregateTrackIntelligence with no role models uses track defaults", () => {
  const track = makeTrack();
  const intel = aggregateTrackIntelligence(track, [], [], [], [], []);
  assert.equal(intel.thesis, "Combines policy background with AI interest");
  assert.ok(intel.roleFamilies.includes("advisory"));
  assert.equal(intel.roleModelsAnalyzed, 0);
  assert.equal(intel.recurringCapabilities.length, 0);
  assert.deepEqual(intel.requirementBriefs, []);
});

test("aggregateTrackIntelligence preserves existing requirementBriefs from cache", () => {
  const existingBrief: RequirementBrief = {
    requirement: "Stakeholder translation",
    dimension: "capability",
    frequency: 2,
    sourceRoles: ["AI Governance Advisor at DeepMind"],
    whatThisMeansHere: "Translating between technical AI teams and policy stakeholders",
    resources: [{ title: "Test resource", url: "https://example.com", whatItCovers: "basics", depth: "foundational" }],
    coverageAreas: ["stakeholder management basics"],
    uncoveredAreas: ["cross-jurisdiction context"],
    existingEvidence: [],
    gapAssessment: "No evidence of stakeholder translation in regulatory context",
    actions: [{ action: "Draft a stakeholder map", producesEvidence: "Stakeholder map document", dependsOn: [], timeEstimate: "2 hours" }],
    proofArtifact: "Stakeholder translation brief for AI governance context",
    researchedAt: Date.now(),
  };

  const track = makeTrack({
    trackIntelligence: JSON.stringify({
      thesis: "test",
      roleFamilies: ["advisory"],
      targetOrganizations: [],
      recurringCapabilities: [],
      recurringKnowledgeNeeds: [],
      recurringEvidenceBar: [],
      recurringNarrativeChallenges: [],
      requirementBriefs: [existingBrief],
      learningPriorities: [],
      proofAssetsToBuild: [],
      networkingTargets: [],
      activeOpportunityCount: 0,
      roleModelsAnalyzed: 0,
      lastUpdated: Date.now(),
    }),
  });

  const intel = aggregateTrackIntelligence(track, [], [], [], [], []);
  assert.equal(intel.requirementBriefs.length, 1);
  assert.equal(intel.requirementBriefs[0].requirement, "Stakeholder translation");
  assert.equal(intel.requirementBriefs[0].resources.length, 1);
  assert.equal(intel.requirementBriefs[0].actions.length, 1);
});
