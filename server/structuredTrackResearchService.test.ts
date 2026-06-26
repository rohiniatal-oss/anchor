import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";
import type {
  careerDirectionKey as CareerDirectionKey,
  findExistingCareerDirection as FindExistingCareerDirection,
  researchCareerDirection as ResearchCareerDirection,
} from "./structuredTrackResearchService";

let h: Harness;
let careerDirectionKey: typeof CareerDirectionKey;
let findExistingCareerDirection: typeof FindExistingCareerDirection;
let researchCareerDirection: typeof ResearchCareerDirection;

before(async () => {
  h = await makeHarness();
  ({
    careerDirectionKey,
    findExistingCareerDirection,
    researchCareerDirection,
  } = await import("./structuredTrackResearchService"));
});

after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

function brief(domain: string) {
  return {
    domain,
    trackName: "AI Strategy",
    trackThesis: "Use strategy and delivery experience in AI-facing work",
    targetRoleArchetype: "AI strategy roles",
    summary: "A structured direction",
    careerHypothesis: { input: domain, normalizedTitle: "AI Strategy", confidence: 0.8, whyAttractive: "fit", coreUncertainties: [] },
    searchPlan: { marketQueries: [], roleQueries: [], organizationQueries: [], requirementQueries: [], learningQueries: [], networkQueries: [], sourcePriorities: [], ambiguityNotes: [] },
    evidencePack: [],
    researchEvidence: [],
    pathHypotheses: [],
    trackHypotheses: [],
    sectorMap: [],
    roleShapes: [],
    requirementMap: { capabilities: [], knowledge: [], evidence: [], narrative: [] },
    requirementGraph: [],
    careerCapitalPortfolio: [],
    gapPortfolio: [],
    interventionRecommendations: [],
    developmentPlans: [],
    evidenceLoops: [],
    fitGapMatrix: {
      technicalOrDomainKnowledge: { strengths: [], gaps: [], evidenceNeeded: [] },
      roleSpecificSkills: { strengths: [], gaps: [], evidenceNeeded: [] },
      sectorCredibility: { strengths: [], gaps: [], evidenceNeeded: [] },
      networkAccess: { strengths: [], gaps: [], evidenceNeeded: [] },
      narrativeFit: { strengths: [], gaps: [], evidenceNeeded: [] },
    },
    gapAnalysis: { strengths: [], gaps: [], biggestGap: "" },
    learningPaths: [],
    networkArchetypes: [],
    proofAssetIdeas: [],
    plan: { horizon: "", logic: "", lanes: [] },
  } as any;
}

function injectedPipeline() {
  let runCount = 0;
  return {
    get runCount() { return runCount; },
    dependencies: {
      runBaseResearch: async (domain: string, options?: { materialize?: boolean }) => {
        runCount += 1;
        assert.equal(options?.materialize, false, "broad direction research must never materialize execution objects");
        const track = await h.storage.createCareerTrack({
          slug: `ai-strategy-${runCount}`,
          name: "AI Strategy",
          description: `Research run ${runCount}`,
          targetRoleArchetype: "AI strategy roles",
          priority: 70,
          status: "active",
          whyItFits: "Uses strategy experience",
          trackIntelligence: JSON.stringify({ sourceDomain: domain, researchedAt: Date.now() }),
        } as any);
        return { track, brief: brief(domain), organizedWorkspace: { lanes: [] }, materialized: null } as any;
      },
      buildRequirementModel: () => ({ mode: "requirement_model", requirements: [] }),
      enhanceRequirementModel: async (_track: any, _brief: any, draft: any) => draft,
      buildCareerArchitecture: () => ({ mode: "chosen_target_development", stages: [], automaticSelection: null }),
      buildBottleneckDiagnosis: () => ({ mode: "route_bottleneck_diagnosis", routes: [] }),
      buildWorkspaceView: () => ({ lanes: [] }),
    } as any,
  };
}

test("direction identity removes routing language and generic suffixes", () => {
  assert.equal(careerDirectionKey("Explore AI strategy roles"), "ai strategy");
  assert.equal(careerDirectionKey("AI Strategy career"), "ai strategy");
  assert.equal(careerDirectionKey("Climate-finance sector"), "climate finance");
});

test("existing direction lookup uses name, slug, source domain, and hypothesis identity", async () => {
  const track = await h.storage.createCareerTrack({
    slug: "ai-strategy",
    name: "AI Strategy",
    description: "",
    targetRoleArchetype: "",
    priority: 70,
    status: "active",
    whyItFits: "",
    trackIntelligence: JSON.stringify({ sourceDomain: "AI strategy roles" }),
  } as any);
  const found = findExistingCareerDirection(await h.storage.getCareerTracks(), "Explore AI strategy");
  assert.equal(found?.id, track.id);
});

test("researching the same direction twice updates one track instead of creating a duplicate", async () => {
  const pipeline = injectedPipeline();
  const first = await researchCareerDirection("AI strategy roles", pipeline.dependencies);
  const second = await researchCareerDirection("Explore AI strategy career", pipeline.dependencies);

  assert.ok(first);
  assert.ok(second);
  assert.equal(pipeline.runCount, 2, "the second request refreshes research rather than returning stale data");
  assert.equal(first.track.id, second.track.id, "the original direction remains canonical");
  assert.equal(first.createdTrack, true);
  assert.equal(first.reusedTrack, false);
  assert.equal(second.createdTrack, false);
  assert.equal(second.reusedTrack, true);
  const tracks = await h.storage.getCareerTracks();
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].id, first.track.id);
  assert.match(tracks[0].description, /Research run 2/);
  assert.equal((await h.storage.getJobs()).length, 0);
  assert.equal((await h.storage.getLearn()).length, 0);
  assert.equal((await h.storage.getContacts()).length, 0);
  assert.equal((await h.storage.getHustles()).length, 0);
});
