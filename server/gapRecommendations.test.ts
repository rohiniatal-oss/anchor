import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

async function makeAdvisoryTrack(h: Harness, extra: Record<string, unknown> = {}) {
  return h.storage.createCareerTrack({
    name: "Geopolitics Advisory",
    slug: `geo-advisory-${Date.now()}`,
    description: "",
    targetRoleArchetype: "advisory",
    priority: 80,
    status: "active",
    whyItFits: "",
    ...extra,
  } as any);
}

async function syncRecommendations() {
  const sync = await api(h.base, "POST", "/api/recommendations/sync", {});
  assert.equal(sync.status, 200);
  return api(h.base, "GET", "/api/recommendations");
}

test("GET /api/recommendations is read-only until sync is triggered", async () => {
  await makeAdvisoryTrack(h);

  const before = await api(h.base, "GET", "/api/recommendations");
  assert.equal(before.status, 200);
  assert.equal((before.json as any[]).length, 0);

  const after = await syncRecommendations();
  assert.ok((after.json as any[]).length > 0);
});

test("learning-theme recs are created for each open gap domain on an active track", async () => {
  const track = await makeAdvisoryTrack(h);

  const res = await syncRecommendations();
  assert.equal(res.status, 200);

  const recs = res.json as any[];
  const geoRec = recs.find((r) => r.linkedTrackId === track.id && r.linkedGapKey === "geo");
  const commsRec = recs.find((r) => r.linkedTrackId === track.id && r.linkedGapKey === "comms");

  assert.ok(geoRec, "should create a geo gap rec");
  assert.equal(geoRec.kind, "learning-theme");
  assert.equal(geoRec.source, "system");
  assert.equal(geoRec.status, "new");
  assert.equal(geoRec.collection, "learning-corpus");
  assert.equal(geoRec.acceptanceEntityType, "learn");

  assert.ok(commsRec, "should create a comms gap rec");
  assert.equal(commsRec.kind, "learning-theme");
  assert.equal(commsRec.source, "system");
});

test("sync is idempotent — no duplicate recs on repeated POST /api/recommendations/sync", async () => {
  await makeAdvisoryTrack(h);

  await syncRecommendations();
  const second = await syncRecommendations();
  assert.equal(second.status, 200);

  const recs = second.json as any[];
  const geoCount = recs.filter((r) => r.linkedGapKey === "geo" && r.collection === "learning-corpus").length;
  assert.equal(geoCount, 1, "only one geo rec should exist after two syncs");
});

test("learning rec is staled when the gap domain becomes evidenced", async () => {
  const track = await makeAdvisoryTrack(h);

  // First sync creates recs
  await syncRecommendations();

  // Create a learn item that covers the geo domain and mark it evidenced
  const learnRes = await api(h.base, "POST", "/api/learn", {
    title: "Geopolitics fundamentals",
    category: "geopol",
    capabilityBuilt: "geopolitical analysis",
    relatedTrackId: track.id,
    done: false,
    active: false,
  });
  assert.equal(learnRes.status, 200);

  const evidenceRes = await api(h.base, "POST", `/api/learn/${learnRes.json.id}/mark-evidenced`, {
    outputEvidenceUrl: "https://example.com/geo-brief",
  });
  assert.equal(evidenceRes.status, 200);

  // Second sync should stale the geo rec
  const afterEvidence = await syncRecommendations();
  const recs = afterEvidence.json as any[];
  const geoRec = recs.find((r) => r.linkedTrackId === track.id && r.linkedGapKey === "geo");
  const commsRec = recs.find((r) => r.linkedTrackId === track.id && r.linkedGapKey === "comms");

  assert.ok(geoRec, "geo rec should still exist in the list");
  assert.equal(geoRec.status, "stale", "geo rec should be staled once gap is evidenced");
  assert.ok(commsRec && commsRec.status !== "stale", "comms rec should remain active");
});

test("system recs are staled when a track is deactivated", async () => {
  const track = await makeAdvisoryTrack(h);

  // First sync creates recs
  await syncRecommendations();

  // Deactivate the track directly (no PATCH route for career-tracks exists)
  h.sqlite.prepare("UPDATE career_tracks SET status = ? WHERE id = ?").run("paused", track.id);

  const afterPause = await syncRecommendations();
  const recs = afterPause.json as any[];
  const geoRec = recs.find((r) => r.linkedTrackId === track.id && r.linkedGapKey === "geo");

  assert.ok(geoRec, "geo rec should still exist");
  assert.equal(geoRec.status, "stale", "geo rec should be staled when track is paused");
});

test("network-target rec is created for active tracks with live jobs but no contacts", async () => {
  const track = await makeAdvisoryTrack(h);

  const jobRes = await api(h.base, "POST", "/api/jobs", {
    title: "Strategy Analyst",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: track.id,
  });
  assert.equal(jobRes.status, 200);

  const res = await syncRecommendations();
  const recs = res.json as any[];
  const networkRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "network-targets");

  assert.ok(networkRec, "should create a network-target rec");
  assert.equal(networkRec.kind, "contact-person-type");
  assert.equal(networkRec.source, "system");
  assert.equal(networkRec.acceptanceEntityType, "contact");
  assert.equal(networkRec.executionShape, "ongoing-program");
  assert.doesNotMatch(String(networkRec.title || ""), /someone who can open doors/i);

  const subdivisions = await h.storage.getRecommendationSubdivisions(networkRec.id);
  const milestones = await h.storage.getRecommendationMilestones(networkRec.id);
  assert.ok(subdivisions.length >= 2, "network rec should have starter archetypes immediately");
  assert.ok(milestones.length >= 4, "network rec should have starter networking checkpoints immediately");
  assert.equal(milestones[0].status, "active");
  assert.match(String(milestones[0].suggestedTaskTitle || ""), /map|networking targets|people/i);
});

test("no network rec is created when a track has no live jobs", async () => {
  const track = await makeAdvisoryTrack(h);
  // No jobs added

  const res = await syncRecommendations();
  const recs = res.json as any[];
  const networkRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "network-targets");

  assert.ok(!networkRec, "should not create a network rec with no live jobs");
});

test("network rec is staled when a contact is added for the track", async () => {
  const track = await makeAdvisoryTrack(h);

  await api(h.base, "POST", "/api/jobs", {
    title: "Strategy Analyst",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: track.id,
  });

  // First sync creates network rec
  await syncRecommendations();

  // Add a contact for the track
  const contactRes = await api(h.base, "POST", "/api/contacts", {
    name: "Jane Doe",
    who: "Strategy partner",
    status: "to_contact",
    relatedTrackId: track.id,
  });
  assert.equal(contactRes.status, 200);

  // Second sync should stale the network rec
  const afterContact = await syncRecommendations();
  const recs = afterContact.json as any[];
  const networkRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "network-targets");

  assert.ok(networkRec, "network rec should still exist");
  assert.equal(networkRec.status, "stale", "network rec should be staled once contacts exist");
});

test("accepted or rejected recs are never staled by the sync", async () => {
  const track = await makeAdvisoryTrack(h);

  // Manually create a learning rec and mark it rejected
  const recRes = await api(h.base, "POST", "/api/recommendations", {
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "rejected",
    source: "system",
    title: "Old geo rec",
    whySuggested: "Gap",
    linkedTrackId: track.id,
    linkedGapKey: "geo",
  });
  assert.equal(recRes.status, 200);
  const rejectedId = recRes.json.id;

  // Sync should create a NEW geo rec (the rejected one doesn't count as coverage)
  const after = await syncRecommendations();
  const recs = after.json as any[];

  const rejectedRec = recs.find((r) => r.id === rejectedId);
  assert.equal(rejectedRec.status, "rejected", "rejected status should be unchanged by sync");

  // A new system rec should have been created since rejected doesn't cover the gap
  const newRec = recs.find((r) =>
    r.linkedTrackId === track.id &&
    r.linkedGapKey === "geo" &&
    r.id !== rejectedId &&
    r.status === "new",
  );
  assert.ok(newRec, "a fresh geo rec should be created alongside the rejected one");
});
