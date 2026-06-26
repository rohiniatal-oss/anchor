import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";
import {
  backfillStrategicObjectOwnership,
  deriveStrategicObjectOwnership,
  deriveTaskOwnership,
  ensureObjectOwnershipSchema,
  getPersistedOwnership,
  ownershipSnapshot,
  resolveStrategicObjectOwnership,
} from "./objectOwnership";

let h: Harness;

before(async () => {
  h = await makeHarness();
  ensureObjectOwnershipSchema();
});

after(async () => { await h.close(); });
beforeEach(() => {
  h.reset();
  ensureObjectOwnershipSchema();
  h.sqlite.prepare("DELETE FROM strategic_object_ownership").run();
  h.sqlite.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run("strategic_object_ownership");
});

async function createTrack() {
  return h.storage.createCareerTrack({
    slug: "ai-strategy",
    name: "AI Strategy",
    description: "Track",
    targetRoleArchetype: "AI strategy roles",
    priority: 70,
    status: "active",
    whyItFits: "Uses strategy experience",
    trackIntelligence: "",
  } as any);
}

test("linked objects are classified as linked_to_direction", async () => {
  const track = await createTrack();
  const job = await h.storage.createJob({
    title: "AI Strategy Lead",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: track.id,
  } as any);
  const learn = await h.storage.createLearn({
    title: "AI governance operating models",
    type: "resource",
    learnStatus: "open",
    relatedTrackId: track.id,
  } as any);
  const contact = await h.storage.createContact({
    who: "AI governance leader",
    why: "Can validate route",
    status: "to_contact",
    relatedTrackId: track.id,
  } as any);
  const hustle = await h.storage.createHustle({
    title: "AI governance memo",
    stage: "idea",
    proofAssetForTrack: track.id,
  } as any);

  const ownership = await deriveStrategicObjectOwnership();
  const byKey = new Map(ownership.map((item) => [`${item.objectType}:${item.objectId}`, item]));

  for (const [type, id] of [["job", job.id], ["learn", learn.id], ["contact", contact.id], ["hustle", hustle.id]] as const) {
    const record = byKey.get(`${type}:${id}`)!;
    assert.equal(record.ownershipState, "linked_to_direction");
    assert.equal(record.trackId, track.id);
    assert.equal(record.confidence, "high");
  }
});

test("strategic but unlinked objects are candidates for a direction", async () => {
  const job = await h.storage.createJob({
    title: "Policy Lead",
    company: "Acme",
    status: "wishlist",
  } as any);
  const learn = await h.storage.createLearn({
    title: "AI policy brief practice",
    type: "practice",
    learnStatus: "open",
    requiredOutput: "A reusable policy brief",
    proofIntent: true,
  } as any);
  const contact = await h.storage.createContact({
    who: "ex-Bain AI strategy operator",
    why: "Can validate access route",
    status: "to_contact",
    targetRole: "AI strategy",
  } as any);
  const hustle = await h.storage.createHustle({
    title: "AI adoption risk memo",
    stage: "idea",
  } as any);

  const ownership = await deriveStrategicObjectOwnership();
  const byKey = new Map(ownership.map((item) => [`${item.objectType}:${item.objectId}`, item]));

  for (const [type, id] of [["job", job.id], ["learn", learn.id], ["contact", contact.id], ["hustle", hustle.id]] as const) {
    const record = byKey.get(`${type}:${id}`)!;
    assert.equal(record.ownershipState, "candidate_for_direction");
    assert.equal(record.trackId, null);
  }
});

test("ordinary captures remain unclassified until they are linked or routed", async () => {
  const task = await h.storage.createTask({
    title: "Buy printer paper",
    list: "inbox",
    done: false,
    category: "admin",
  } as any);

  const ownership = deriveTaskOwnership(task);

  assert.equal(ownership.ownershipState, "unclassified_capture");
  assert.equal(ownership.trackId, null);
  assert.match(ownership.reason, /no direction link/i);
});

test("snapshot is read-only and backfill explicitly persists derived ownership", async () => {
  const track = await createTrack();
  await h.storage.createJob({
    title: "AI Strategy Lead",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: track.id,
  } as any);
  await h.storage.createTask({
    title: "Buy printer paper",
    list: "inbox",
    done: false,
    category: "admin",
  } as any);

  const before = await ownershipSnapshot();
  assert.equal(before.summary.total, 2);
  assert.equal(before.summary.persisted, 0);
  assert.equal(getPersistedOwnership().size, 0, "GET-style snapshot must not persist ownership rows");

  const result = await backfillStrategicObjectOwnership();
  assert.equal(result.upserted, 2);

  const persisted = getPersistedOwnership();
  assert.equal(persisted.size, 2);
  const after = await ownershipSnapshot();
  assert.equal(after.summary.persisted, 2);
  assert.equal(after.summary.linked_to_direction, 1);
  assert.equal(after.summary.unclassified_capture, 1);
});

test("manual ownership overrides are preserved during backfill", async () => {
  const task = await h.storage.createTask({
    title: "Research ambiguous thing",
    list: "inbox",
    done: false,
    category: "admin",
  } as any);

  const { rawDb } = await import("./storage");
  rawDb.prepare(`
    INSERT INTO strategic_object_ownership (
      object_type, object_id, ownership_state, track_id, reason, confidence, source, created_at, updated_at
    ) VALUES ('task', ?, 'candidate_for_direction', NULL, 'Manually reviewed', 'high', 'manual', ?, ?)
  `).run(task.id, Date.now(), Date.now());

  await backfillStrategicObjectOwnership();
  const stored = getPersistedOwnership().get(`task:${task.id}`)!;
  assert.equal(stored.source, "manual");
  assert.equal(stored.ownershipState, "candidate_for_direction");
  assert.equal(stored.reason, "Manually reviewed");
});

test("manual park and stop resolutions persist distinct states", async () => {
  const job = await h.storage.createJob({
    title: "Ambiguous role",
    company: "Acme",
    status: "wishlist",
  } as any);
  const contact = await h.storage.createContact({
    who: "Ambiguous person",
    status: "to_contact",
    relationshipStrength: "cold",
    askType: "advice",
  } as any);

  const parked = await resolveStrategicObjectOwnership({ objectType: "job", objectId: job.id, action: "park" });
  const stopped = await resolveStrategicObjectOwnership({ objectType: "contact", objectId: contact.id, action: "stop" });

  assert.equal(parked?.ownership.ownershipState, "parked");
  assert.equal(stopped?.ownership.ownershipState, "stopped");

  const persisted = getPersistedOwnership();
  assert.equal(persisted.get(`job:${job.id}`)?.ownershipState, "parked");
  assert.equal(persisted.get(`contact:${contact.id}`)?.ownershipState, "stopped");

  const snapshot = await ownershipSnapshot();
  assert.equal(snapshot.summary.parked, 1);
  assert.equal(snapshot.summary.stopped, 1);
});
