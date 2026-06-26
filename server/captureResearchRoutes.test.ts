import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";

let h: Harness;

before(async () => {
  h = await makeHarness();
});

after(async () => {
  await h.close();
});

beforeEach(() => {
  h.reset();
});

test("researchDomainForCapture extracts the direction rather than the task mechanics", async () => {
  const { researchDomainForCapture } = await import("./captureResearchRoutes");

  assert.equal(researchDomainForCapture("Explore AI strategy roles"), "AI strategy");
  assert.equal(researchDomainForCapture("research AI governance"), "AI governance");
  assert.equal(researchDomainForCapture("Look into climate philanthropy careers"), "climate philanthropy");
});

test("routeResearchCapture stores one direction model and creates zero execution objects", async () => {
  const { routeResearchCapture } = await import("./captureResearchRoutes");
  const capture = await h.storage.createTask({
    title: "Explore AI strategy roles",
    list: "inbox",
    done: false,
    category: "admin",
  } as any);

  const before = {
    tasks: (await h.storage.getTasks()).length,
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };

  let calledWith: { domain: string; materialize: boolean | undefined } | null = null;
  const fakeRunner = async (domain: string, options?: { materialize?: boolean }) => {
    calledWith = { domain, materialize: options?.materialize };
    const track = await h.storage.createCareerTrack({
      slug: "ai-strategy",
      name: "AI Strategy",
      description: "Evidence-backed direction model",
      targetRoleArchetype: "AI strategy roles",
      priority: 70,
      status: "active",
      whyItFits: "Exploration result",
      trackIntelligence: JSON.stringify({ sourceDomain: domain, researchSummary: "Stored only as career intelligence" }),
    } as any);
    return {
      track,
      brief: { domain, trackName: "AI Strategy", summary: "Stored direction model" },
      organizedWorkspace: { lanes: [], assessmentQueue: [], priorityQueue: [] },
      // The route must not trust or forward accidental materialization payloads.
      materialized: { trackId: track.id, jobIds: [999], learnIds: [999], contactIds: [999], hustleIds: [999] },
    } as any;
  };

  const result = await routeResearchCapture(capture.id, fakeRunner);
  const body = result.body as any;

  assert.equal(result.status, 200);
  assert.deepEqual(calledWith, { domain: "AI strategy", materialize: false });
  assert.deepEqual(body.materialized, {
    trackId: undefined,
    jobIds: [],
    learnIds: [],
    contactIds: [],
    hustleIds: [],
  });

  const after = {
    tasks: (await h.storage.getTasks()).length,
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };
  assert.equal(after.tasks, before.tasks, "the original capture is updated, not duplicated into a live task");
  assert.equal(after.jobs, before.jobs, "no synthetic jobs are created");
  assert.equal(after.learn, before.learn, "no learning items are created");
  assert.equal(after.contacts, before.contacts, "no contacts are created");
  assert.equal(after.hustles, before.hustles, "no proof assets are created");

  const updated = (await h.storage.getTasks()).find((task) => task.id === capture.id)!;
  assert.equal(updated.list, "captured");
  assert.equal(updated.sourceType, "career_track");
  assert.equal(updated.sourceStatus, "routed:research:track");
  assert.equal(updated.relatedTrackId, body.track.id);
});

test("routeResearchCapture leaves failed research retryable and creates no downstream objects", async () => {
  const { routeResearchCapture } = await import("./captureResearchRoutes");
  const capture = await h.storage.createTask({
    title: "Research climate philanthropy",
    list: "inbox",
    done: false,
    category: "admin",
  } as any);
  const before = {
    tracks: (await h.storage.getCareerTracks()).length,
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };

  const result = await routeResearchCapture(capture.id, async () => null);
  const body = result.body as any;

  assert.equal(result.status, 200);
  assert.equal(body.retryable, true);
  assert.deepEqual(body.materialized, {
    trackId: undefined,
    jobIds: [],
    learnIds: [],
    contactIds: [],
    hustleIds: [],
  });

  const after = {
    tracks: (await h.storage.getCareerTracks()).length,
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };
  assert.deepEqual(after, before);

  const updated = (await h.storage.getTasks()).find((task) => task.id === capture.id)!;
  assert.equal(updated.list, "inbox");
  assert.equal(updated.sourceStatus, "routed:research:retryable");
});
