import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";
import {
  materializeTrackResearchActivation,
  roleModelExamplesFromResearch,
} from "./trackResearchActivationInventory";

let h: Harness;

before(async () => {
  h = await makeHarness();
});

after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

function activationBrief() {
  return {
    domain: "AI strategy",
    roleShapes: [
      {
        title: "AI Strategy Lead",
        what: "Shapes the operating model for responsible AI adoption.",
        typicalOrgs: ["Acme AI", "Cabinet Office"],
        seniority: "senior",
      },
      {
        title: "AI Governance Advisor",
        what: "Translates governance requirements into delivery choices.",
        typicalOrgs: ["Policy Lab"],
        seniority: "mid",
      },
    ],
    learningPaths: [
      {
        topic: "AI governance operating models",
        why: "Repeated requirement across the role family",
        resourceType: "resource",
        suggestedResource: "OECD AI policy resources",
        output: "A reusable note on governance operating-model choices",
      },
    ],
    networkArchetypes: [
      {
        who: "AI strategy lead in government delivery",
        why: "Can validate whether this route is live and credible",
        searchTip: "Search LinkedIn for AI strategy government delivery",
      },
    ],
    proofAssetIdeas: [
      {
        title: "AI adoption risk memo",
        why: "Shows judgment on strategy, governance, and delivery trade-offs",
        format: "memo",
        firstStep: "Draft the one-page outline",
      },
    ],
  } as any;
}

async function createTrack() {
  return h.storage.createCareerTrack({
    slug: "ai-strategy",
    name: "AI Strategy",
    description: "Evidence-backed direction",
    targetRoleArchetype: "AI strategy roles",
    priority: 70,
    status: "active",
    whyItFits: "Uses strategy and delivery experience",
    trackIntelligence: "",
  } as any);
}

test("role shapes become role model examples, not Jobs", async () => {
  const brief = activationBrief();
  const examples = roleModelExamplesFromResearch(brief);

  assert.equal(examples.length, 2);
  assert.equal(examples[0].title, "AI Strategy Lead");
  assert.deepEqual(examples[0].typicalOrgs, ["Acme AI", "Cabinet Office"]);
  assert.equal(examples[0].sourceType, "track_research_role_shape");
});

test("activation inventory creates no Jobs from role examples", async () => {
  const track = await createTrack();
  const before = {
    jobs: (await h.storage.getJobs()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };

  const result = await materializeTrackResearchActivation(track, activationBrief());

  assert.equal(result.trackId, track.id);
  assert.deepEqual(result.jobIds, []);
  assert.equal((await h.storage.getJobs()).length, before.jobs, "role examples must not become opportunities");
  assert.equal(result.roleModelExamples.length, 2);
  assert.match(result.roleModelExamples[0].what, /operating model/i);

  assert.equal((await h.storage.getLearn()).length, before.learn + 1);
  assert.equal((await h.storage.getContacts()).length, before.contacts + 1);
  assert.equal((await h.storage.getHustles()).length, before.hustles + 1);
});

test("re-running activation still does not create Jobs or duplicate role model examples", async () => {
  const track = await createTrack();
  const brief = activationBrief();

  const first = await materializeTrackResearchActivation(track, brief);
  const second = await materializeTrackResearchActivation(track, brief);

  assert.deepEqual(first.jobIds, []);
  assert.deepEqual(second.jobIds, []);
  assert.equal(first.roleModelExamples.length, 2);
  assert.equal(second.roleModelExamples.length, 2);
  assert.equal((await h.storage.getJobs()).length, 0);
  assert.equal((await h.storage.getLearn()).length, 1, "learning candidates dedupe by title");
  assert.equal((await h.storage.getContacts()).length, 1, "network candidates dedupe by who/name");
  assert.equal((await h.storage.getHustles()).length, 1, "proof candidates dedupe by title");
});
