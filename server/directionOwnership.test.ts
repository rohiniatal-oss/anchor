import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";

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

async function createTrack(name = "AI Governance") {
  return h.storage.createCareerTrack({
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    description: "Direction",
    targetRoleArchetype: `${name} roles`,
    priority: 80,
    status: "active",
    whyItFits: "Test direction",
    trackIntelligence: "",
  } as any);
}

function ownershipRowCount() {
  return Number((h.sqlite.prepare("SELECT COUNT(*) AS count FROM direction_ownerships").get() as any).count || 0);
}

test("GET audit derives linked and unclassified states without writing registry rows", async () => {
  const track = await createTrack();
  const job = await h.storage.createJob({ title: "Policy Lead", company: "Acme", relatedTrackId: track.id } as any);
  const learn = await h.storage.createLearn({ title: "EU AI Act primer", learnStatus: "open" } as any);
  const contact = await h.storage.createContact({ who: "AI policy operator", why: "Validate route" } as any);
  const hustle = await h.storage.createHustle({ title: "AI governance memo", proofAssetForTrack: track.id } as any);

  assert.equal(ownershipRowCount(), 0);
  const first = await api(h.base, "GET", "/api/direction-ownership/audit");
  const second = await api(h.base, "GET", "/api/direction-ownership/audit");

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(ownershipRowCount(), 0, "auditing must not create registry rows");
  assert.deepEqual(first.json.totals, {
    linked_to_direction: 2,
    candidate_for_direction: 0,
    unclassified_capture: 2,
    total: 4,
  });

  const byKey = new Map(first.json.objects.map((object: any) => [`${object.entityType}:${object.entityId}`, object]));
  assert.equal(byKey.get(`job:${job.id}`).ownershipState, "linked_to_direction");
  assert.equal(byKey.get(`job:${job.id}`).trackId, track.id);
  assert.equal(byKey.get(`job:${job.id}`).persisted, false);
  assert.equal(byKey.get(`hustle:${hustle.id}`).ownershipState, "linked_to_direction");
  assert.equal(byKey.get(`learn:${learn.id}`).ownershipState, "unclassified_capture");
  assert.equal(byKey.get(`contact:${contact.id}`).ownershipState, "unclassified_capture");
});

test("POST backfill persists explicit ownership rows for existing strategic objects", async () => {
  const track = await createTrack();
  await h.storage.createJob({ title: "Strategy Lead", company: "Acme", relatedTrackId: track.id } as any);
  await h.storage.createLearn({ title: "Responsible AI course", learnStatus: "open" } as any);
  await h.storage.createContact({ who: "Responsible AI lead", why: "Validate access" } as any);
  await h.storage.createHustle({ title: "Responsible AI memo", proofAssetForTrack: track.id } as any);

  const response = await api(h.base, "POST", "/api/direction-ownership/backfill", {});

  assert.equal(response.status, 200);
  assert.equal(response.json.changed.length, 4);
  assert.equal(ownershipRowCount(), 4);
  assert.deepEqual(response.json.audit.totals, {
    linked_to_direction: 2,
    candidate_for_direction: 0,
    unclassified_capture: 2,
    total: 4,
  });
  assert.equal(response.json.audit.objects.every((object: any) => object.persisted), true);
});

test("candidate ownership records a proposed direction without mutating the source object link", async () => {
  const track = await createTrack("Geopolitical Advisory");
  const learn = await h.storage.createLearn({ title: "Geopolitical risk primer", learnStatus: "open" } as any);

  const response = await api(h.base, "POST", `/api/direction-ownership/learn/${learn.id}`, {
    ownershipState: "candidate_for_direction",
    candidateTrackId: track.id,
    reason: "Could support this direction but not confirmed yet",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.ownership.ownershipState, "candidate_for_direction");
  assert.equal(response.json.ownership.candidateTrackId, track.id);
  const storedLearn = (await h.storage.getLearn()).find((item) => item.id === learn.id)!;
  assert.equal(storedLearn.relatedTrackId, null);
});

test("linked ownership updates the underlying object track link", async () => {
  const track = await createTrack("Chief of Staff");
  const contact = await h.storage.createContact({ who: "Founder office operator", why: "Route validation" } as any);

  const response = await api(h.base, "POST", `/api/direction-ownership/contact/${contact.id}`, {
    ownershipState: "linked_to_direction",
    trackId: track.id,
    reason: "Confirmed this relationship supports the direction",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.ownership.ownershipState, "linked_to_direction");
  assert.equal(response.json.ownership.trackId, track.id);
  const storedContact = (await h.storage.getContacts()).find((item) => item.id === contact.id)!;
  assert.equal(storedContact.relatedTrackId, track.id);
});

test("unclassified ownership refuses to unlink an existing direction unless explicitly confirmed", async () => {
  const track = await createTrack("AI Strategy");
  const job = await h.storage.createJob({ title: "AI Strategy Lead", company: "Acme", relatedTrackId: track.id } as any);

  const rejected = await api(h.base, "POST", `/api/direction-ownership/job/${job.id}`, {
    ownershipState: "unclassified_capture",
    reason: "Not actually relevant",
  });
  assert.equal(rejected.status, 409);
  assert.equal((await h.storage.getJobs()).find((item) => item.id === job.id)!.relatedTrackId, track.id);

  const accepted = await api(h.base, "POST", `/api/direction-ownership/job/${job.id}`, {
    ownershipState: "unclassified_capture",
    reason: "Not actually relevant",
    confirmUnlink: true,
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.ownership.ownershipState, "unclassified_capture");
  assert.equal(accepted.json.ownership.trackId, null);
  assert.equal((await h.storage.getJobs()).find((item) => item.id === job.id)!.relatedTrackId, null);
});

test("unsupported ownership entity types are rejected", async () => {
  const response = await api(h.base, "POST", "/api/direction-ownership/project/1", {
    ownershipState: "linked_to_direction",
    trackId: 1,
  });
  assert.equal(response.status, 400);
});
