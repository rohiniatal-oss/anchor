import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";

let h: Harness;
let getUnlinkedItems: typeof import("./strategy").getUnlinkedItems;
let resolveStrategicObjectOwnership: typeof import("./objectOwnership").resolveStrategicObjectOwnership;

before(async () => {
  h = await makeHarness();
  ({ getUnlinkedItems } = await import("./strategy"));
  ({ resolveStrategicObjectOwnership } = await import("./objectOwnership"));
});

after(async () => {
  await h.close();
});

beforeEach(() => {
  h.reset();
});

function hasUnlinkedItem(bucket: Awaited<ReturnType<typeof getUnlinkedItems>>, entity: string, id: number) {
  return bucket.items.some((item) => item.entity === entity && item.id === id);
}

async function createTrack(name = "AI governance") {
  return h.storage.createCareerTrack({
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name,
    status: "active",
    priority: 10,
    whyItFits: "Test direction",
  } as any);
}

test("parked unlinked jobs leave the Strategy unlinked queue", async () => {
  const job = await h.storage.createJob({
    title: "AI Governance Lead",
    company: "Example Org",
    status: "wishlist",
    sourceType: "discovery_option",
  } as any);

  assert.equal(hasUnlinkedItem(await getUnlinkedItems(), "jobs", job.id), true);

  const result = await resolveStrategicObjectOwnership({
    objectType: "job",
    objectId: job.id,
    action: "park",
  });

  assert.ok(result);
  assert.equal(result.ownership.source, "manual");
  assert.equal(result.ownership.ownershipState, "unclassified_capture");
  assert.equal(result.ownership.trackId, null);

  const bucket = await getUnlinkedItems();
  assert.equal(hasUnlinkedItem(bucket, "jobs", job.id), false);
  assert.equal(bucket.counts.jobs, 0);
});

test("stopped contacts leave the Strategy unlinked queue even when their status is non-canonical", async () => {
  const contact = await h.storage.createContact({
    who: "AI policy operator",
    status: "to_contact",
    relationshipStrength: "cold",
    askType: "advice",
  } as any);

  assert.equal(hasUnlinkedItem(await getUnlinkedItems(), "contacts", contact.id), true);

  const result = await resolveStrategicObjectOwnership({
    objectType: "contact",
    objectId: contact.id,
    action: "stop",
  });

  assert.ok(result);
  assert.equal(result.action, "stop");
  assert.equal(result.ownership.source, "manual");
  assert.equal(result.ownership.ownershipState, "unclassified_capture");

  const updated = (await h.storage.getContacts()).find((item) => item.id === contact.id);
  assert.equal(updated?.status, "archived");
  assert.equal(hasUnlinkedItem(await getUnlinkedItems(), "contacts", contact.id), false);
});

test("assigning a learn item to a role type removes it from the Strategy unlinked queue", async () => {
  const track = await createTrack();
  const learn = await h.storage.createLearn({
    title: "AI safety primer",
    type: "resource",
    learnStatus: "open",
    requiredOutput: "A short note on whether this source is useful for AI governance roles.",
    proofIntent: true,
  } as any);

  assert.equal(hasUnlinkedItem(await getUnlinkedItems(), "learn", learn.id), true);

  const result = await resolveStrategicObjectOwnership({
    objectType: "learn",
    objectId: learn.id,
    action: "assign_to_track",
    trackId: track.id,
  });

  assert.ok(result);
  assert.equal(result.ownership.ownershipState, "linked_to_direction");
  assert.equal(result.ownership.trackId, track.id);

  const updated = await h.storage.getLearnItem(learn.id);
  assert.equal(updated?.relatedTrackId, track.id);
  assert.equal(hasUnlinkedItem(await getUnlinkedItems(), "learn", learn.id), false);
});
