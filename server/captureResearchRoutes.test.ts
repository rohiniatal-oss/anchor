import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";
import type {
  careerDirectionDomain as CareerDirectionDomain,
  isCareerDirectionResearchCapture as IsCareerDirectionResearchCapture,
  routeCareerDirectionCapture as RouteCareerDirectionCapture,
} from "./captureResearchRoutes";

let h: Harness;
let routeCareerDirectionCapture: typeof RouteCareerDirectionCapture;
let isCareerDirectionResearchCapture: typeof IsCareerDirectionResearchCapture;
let careerDirectionDomain: typeof CareerDirectionDomain;

before(async () => {
  h = await makeHarness();
  ({
    routeCareerDirectionCapture,
    isCareerDirectionResearchCapture,
    careerDirectionDomain,
  } = await import("./captureResearchRoutes"));
});

after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

function fakeStoredResearch(track: any, domain: string) {
  return {
    track,
    brief: { domain },
    plan: null,
    searchPlan: null,
    evidencePack: [],
    researchEvidence: [],
    careerHypothesis: null,
    pathHypotheses: [],
    trackHypotheses: [],
    requirementGraph: [],
    careerCapitalPortfolio: [],
    gapPortfolio: [],
    interventionRecommendations: [],
    developmentPlans: [],
    evidenceLoops: [],
    fitGapMatrix: null,
    requirementModel: null,
    organizedWorkspace: null,
    careerArchitecture: null,
    bottleneckDiagnosis: null,
    automaticSelection: null,
    materialized: null,
    createdTrack: true,
    reusedTrack: false,
  } as any;
}

test("career-direction detection separates field exploration from bounded entity research", () => {
  assert.equal(isCareerDirectionResearchCapture("Explore AI strategy"), true);
  assert.equal(isCareerDirectionResearchCapture("Get into climate finance"), true);
  assert.equal(isCareerDirectionResearchCapture("Research AI governance roles"), true);
  assert.equal(isCareerDirectionResearchCapture("Research Tony Blair Institute"), false);
  assert.equal(isCareerDirectionResearchCapture("Research TBI"), false);
  assert.equal(careerDirectionDomain("Explore AI strategy roles"), "AI strategy");
});

test("successful direction research attaches the capture to one track and creates no execution objects", async () => {
  const capture = await h.storage.createTask({
    title: "Explore AI strategy roles",
    list: "inbox",
    done: false,
  } as any);
  const before = {
    tasks: (await h.storage.getTasks()).length,
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };

  const result = await routeCareerDirectionCapture(capture.id, async (domain) => {
    assert.equal(domain, "AI strategy");
    const track = await h.storage.createCareerTrack({
      slug: "ai-strategy",
      name: "AI Strategy",
      description: "Evidence-backed direction",
      targetRoleArchetype: "AI strategy roles",
      priority: 70,
      status: "active",
      whyItFits: "Uses strategy and delivery experience",
      trackIntelligence: JSON.stringify({ sourceDomain: domain }),
    } as any);
    return fakeStoredResearch(track, domain);
  });

  assert.equal(result.status, 200);
  assert.equal((result.body as any).materialized, null);
  assert.deepEqual((result.body as any).downstreamObjectsCreated, {
    jobs: 0,
    learningItems: 0,
    contacts: 0,
    proofAssets: 0,
    projects: 0,
    tasks: 0,
  });
  assert.equal((await h.storage.getTasks()).length, before.tasks, "the original capture is updated, not duplicated");
  assert.equal((await h.storage.getJobs()).length, before.jobs);
  assert.equal((await h.storage.getLearn()).length, before.learn);
  assert.equal((await h.storage.getContacts()).length, before.contacts);
  assert.equal((await h.storage.getHustles()).length, before.hustles);
  assert.equal((await h.storage.getCareerTracks()).length, 1);

  const stored = (await h.storage.getTasks()).find((task) => task.id === capture.id)!;
  assert.equal(stored.list, "captured");
  assert.equal(stored.sourceType, "career_track");
  assert.equal(stored.sourceId, (result.body as any).track.id);
  assert.equal(stored.relatedTrackId, (result.body as any).track.id);
  assert.match(stored.sourceStatus, /routed:research:career_track/);
  assert.match(stored.sourceNote, /without activating jobs, learning items, contacts, proof assets, projects, or tasks/i);
});

test("bounded research is refused by the career-direction route and remains available for work interpretation", async () => {
  const capture = await h.storage.createTask({
    title: "Research Tony Blair Institute",
    list: "inbox",
    done: false,
    sourceNote: "Need to understand whether there is a current move",
  } as any);
  let called = false;

  const result = await routeCareerDirectionCapture(capture.id, async () => {
    called = true;
    return null;
  });

  assert.equal(result.status, 409);
  assert.equal((result.body as any).code, "work_interpretation_required");
  assert.equal((result.body as any).nextAction, "interpret_work");
  assert.equal(called, false);
  const stored = (await h.storage.getTasks()).find((task) => task.id === capture.id)!;
  assert.equal(stored.list, "inbox");
  assert.equal(stored.title, capture.title);
  assert.equal(stored.sourceNote, capture.sourceNote);
});

test("research failure leaves the original capture unchanged and retryable", async () => {
  const capture = await h.storage.createTask({
    title: "Break into climate finance",
    list: "inbox",
    done: false,
    sourceNote: "Original user note",
    pinned: true,
  } as any);
  const before = (await h.storage.getTasks()).find((task) => task.id === capture.id)!;

  const result = await routeCareerDirectionCapture(capture.id, async () => {
    throw new Error("research provider unavailable");
  });

  assert.equal(result.status, 502);
  assert.equal((result.body as any).retryable, true);
  assert.equal((result.body as any).code, "career_direction_research_failed");
  const afterFailure = (await h.storage.getTasks()).find((task) => task.id === capture.id)!;
  assert.deepEqual(afterFailure, before);
  assert.equal((await h.storage.getCareerTracks()).length, 0);
  assert.equal((await h.storage.getJobs()).length, 0);
  assert.equal((await h.storage.getLearn()).length, 0);
  assert.equal((await h.storage.getContacts()).length, 0);
  assert.equal((await h.storage.getHustles()).length, 0);
});
