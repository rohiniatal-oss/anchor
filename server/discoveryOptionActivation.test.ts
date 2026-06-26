import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";
import type { RankedDiscoveryOption } from "./discoveryOptions";

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

function option(overrides: Partial<RankedDiscoveryOption> = {}): RankedDiscoveryOption {
  return {
    rank: 1,
    kind: "role",
    title: "AI Governance Lead role",
    whyRelevant: "This is a current public role-shaped signal with governance and delivery requirements.",
    confidence: "high",
    evidenceIndex: 0,
    score: 120,
    sourceTitle: "AI Governance Lead role requirements",
    sourceUrl: "https://greenhouse.io/acme/ai-governance-lead",
    sourceDomain: "greenhouse.io",
    nextAction: "Open the source and verify whether this is a real current opportunity before creating a Job.",
    ...overrides,
  };
}

async function capture(title = "Find three AI governance roles", overrides: Record<string, unknown> = {}) {
  return h.storage.createTask({
    title,
    list: "inbox",
    done: false,
    category: "admin",
    ...overrides,
  } as any);
}

test("activating a role option creates one wishlist Job and reuses it on repeat", async () => {
  const task = await capture();
  const before = {
    jobs: (await h.storage.getJobs()).length,
    tasks: (await h.storage.getTasks()).length,
    learn: (await h.storage.getLearn()).length,
    contacts: (await h.storage.getContacts()).length,
    hustles: (await h.storage.getHustles()).length,
  };

  const first = await api(h.base, "POST", `/api/capture/${task.id}/discovery-options/activate`, {
    option: option(),
    activationType: "job",
  });
  const second = await api(h.base, "POST", `/api/capture/${task.id}/discovery-options/activate`, {
    option: option(),
    activationType: "job",
  });

  assert.equal(first.status, 200);
  assert.equal(first.json.activationType, "job");
  assert.equal(first.json.reused, false);
  assert.equal(first.json.followUp.title, "Verify this role");
  assert.match(first.json.followUp.description, /confirm the role is current/);
  assert.equal(first.json.followUp.targetId, first.json.object.id);
  assert.equal(first.json.followUp.sourceUrl, option().sourceUrl);
  assert.equal(first.json.ownership.objectType, "job");
  assert.equal(first.json.ownership.objectId, first.json.object.id);
  assert.equal(first.json.ownership.ownershipState, "candidate_for_direction");
  assert.equal(first.json.ownership.trackId, null);
  assert.equal(second.status, 200);
  assert.equal(second.json.reused, true);
  assert.equal(second.json.object.id, first.json.object.id);
  assert.equal(second.json.followUp.title, "Review the saved Job");
  assert.equal(second.json.followUp.targetId, first.json.object.id);
  assert.equal(second.json.ownership.objectId, first.json.object.id);
  assert.equal(second.json.ownership.ownershipState, "candidate_for_direction");

  const jobs = await h.storage.getJobs();
  assert.equal(jobs.length, before.jobs + 1);
  assert.equal(jobs[0].status, "wishlist");
  assert.equal(jobs[0].sourceType, "discovery_option");
  assert.equal(jobs[0].sourceUrl, option().sourceUrl);
  assert.equal(jobs[0].url, option().sourceUrl);
  assert.equal((await h.storage.getTasks()).length, before.tasks, "role option activation should not create a task");
  assert.equal((await h.storage.getLearn()).length, before.learn);
  assert.equal((await h.storage.getContacts()).length, before.contacts);
  assert.equal((await h.storage.getHustles()).length, before.hustles);
});

test("activation reports linked ownership when the capture has a direction", async () => {
  const task = await capture("Find three AI governance roles", { relatedTrackId: 42 });
  const response = await api(h.base, "POST", `/api/capture/${task.id}/discovery-options/activate`, {
    option: option(),
    activationType: "job",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.ownership.objectType, "job");
  assert.equal(response.json.ownership.ownershipState, "linked_to_direction");
  assert.equal(response.json.ownership.trackId, 42);
});

test("activating people learning proof and evidence options creates the matching explicit object", async () => {
  const peopleCapture = await capture("Search for Bain alumni in AI strategy");
  const learnCapture = await capture("Look up courses on AI safety");
  const proofCapture = await capture("Shortlist AI governance memo examples");
  const evidenceCapture = await capture("Identify organizations working on AI assurance");

  const person = await api(h.base, "POST", `/api/capture/${peopleCapture.id}/discovery-options/activate`, {
    option: option({ kind: "person", title: "Bain alumni in AI strategy", sourceUrl: "https://linkedin.com/in/example", sourceDomain: "linkedin.com" }),
  });
  const learn = await api(h.base, "POST", `/api/capture/${learnCapture.id}/discovery-options/activate`, {
    option: option({ kind: "learning", title: "AI safety course syllabus", sourceUrl: "https://university.edu/ai-safety", sourceDomain: "university.edu" }),
  });
  const proof = await api(h.base, "POST", `/api/capture/${proofCapture.id}/discovery-options/activate`, {
    option: option({ kind: "proof", title: "AI governance memo example", sourceUrl: "https://example.org/memo", sourceDomain: "example.org" }),
  });
  const task = await api(h.base, "POST", `/api/capture/${evidenceCapture.id}/discovery-options/activate`, {
    option: option({ kind: "evidence", title: "AI assurance organization landscape", sourceUrl: "https://example.org/landscape", sourceDomain: "example.org" }),
  });

  assert.equal(person.status, 200);
  assert.equal(person.json.activationType, "contact");
  assert.equal(person.json.followUp.title, "Prepare one outreach angle");
  assert.equal(person.json.ownership.objectType, "contact");
  assert.equal(person.json.ownership.ownershipState, "candidate_for_direction");
  assert.equal((await h.storage.getContacts()).length, 1);

  assert.equal(learn.status, 200);
  assert.equal(learn.json.activationType, "learn");
  assert.equal(learn.json.followUp.title, "Define the learning output");
  assert.equal(learn.json.ownership.objectType, "learn");
  assert.equal(learn.json.ownership.ownershipState, "candidate_for_direction");
  assert.equal((await h.storage.getLearn()).length, 1);

  assert.equal(proof.status, 200);
  assert.equal(proof.json.activationType, "proof");
  assert.equal(proof.json.followUp.title, "Outline the proof asset");
  assert.equal(proof.json.ownership.objectType, "hustle");
  assert.equal(proof.json.ownership.ownershipState, "candidate_for_direction");
  assert.equal((await h.storage.getHustles()).length, 1);

  assert.equal(task.status, 200);
  assert.equal(task.json.activationType, "task");
  assert.equal(task.json.followUp.title, "Make the pursue-or-stop decision");
  assert.equal(task.json.ownership.objectType, "task");
  assert.equal(task.json.ownership.ownershipState, "candidate_for_direction");
  assert.equal((await h.storage.getTasks()).filter((item) => item.sourceType === "discovery_option").length, 1);
});

test("background activation is blocked before object creation", async () => {
  const task = await capture();
  const response = await fetch(`${h.base}/api/capture/${task.id}/discovery-options/activate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Anchor-User-Intent": "background",
    },
    body: JSON.stringify({ option: option(), activationType: "job" }),
  });
  const json = await response.json();

  assert.equal(response.status, 409);
  assert.equal(json.code, "explicit_user_intent_required");
  assert.equal((await h.storage.getJobs()).length, 0);
});

test("activation rejects missing ranked options", async () => {
  const task = await capture();
  const response = await api(h.base, "POST", `/api/capture/${task.id}/discovery-options/activate`, {
    activationType: "job",
  });

  assert.equal(response.status, 400);
  assert.equal((await h.storage.getJobs()).length, 0);
});
