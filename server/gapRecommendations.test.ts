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

async function addLiveJob(trackId: number) {
  const jobRes = await api(h.base, "POST", "/api/jobs", {
    title: "Strategy Analyst",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: trackId,
  });
  assert.equal(jobRes.status, 200);
  return jobRes.json;
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

test("learning-theme recs are created for each open gap domain on an active track with live jobs", async () => {
  const track = await makeAdvisoryTrack(h);
  await addLiveJob(track.id);

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

test("direction-signals rec is created before learning when a track has no live jobs", async () => {
  const track = await makeAdvisoryTrack(h);

  const res = await syncRecommendations();
  const recs = res.json as any[];

  const directionRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "direction-signals");
  const learningRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "learning-corpus");

  assert.ok(directionRec, "should create a direction-evidence rec");
  assert.equal(directionRec.kind, "role-market-evidence");
  assert.equal(directionRec.acceptanceEntityType, "task");
  assert.ok(!learningRec, "should not create learning recs before any live role evidence exists");
});

test("sync is idempotent with live-role-gated learning recs", async () => {
  const track = await makeAdvisoryTrack(h);
  await addLiveJob(track.id);

  await syncRecommendations();
  const second = await syncRecommendations();
  assert.equal(second.status, 200);

  const recs = second.json as any[];
  const geoCount = recs.filter((r) => r.linkedGapKey === "geo" && r.collection === "learning-corpus").length;
  assert.equal(geoCount, 1, "only one geo rec should exist after two syncs");
});

test("learning rec is staled when the gap domain becomes evidenced", async () => {
  const track = await makeAdvisoryTrack(h);
  await addLiveJob(track.id);

  await syncRecommendations();

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

  await syncRecommendations();

  h.sqlite.prepare("UPDATE career_tracks SET status = ? WHERE id = ?").run("paused", track.id);

  const afterPause = await syncRecommendations();
  const recs = afterPause.json as any[];
  const directionRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "direction-signals");

  assert.ok(directionRec, "direction rec should still exist");
  assert.equal(directionRec.status, "stale", "direction rec should be staled when track is paused");
});

test("direction-signals rec is staled once a live job exists and learning recs can then appear", async () => {
  const track = await makeAdvisoryTrack(h);

  await syncRecommendations();
  await addLiveJob(track.id);

  const res = await syncRecommendations();
  const recs = res.json as any[];

  const directionRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "direction-signals");
  const learningRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "learning-corpus");

  assert.ok(directionRec, "direction rec should still exist in history");
  assert.equal(directionRec.status, "stale");
  assert.ok(learningRec, "learning recs should become eligible after live job evidence exists");
});

test("network-target rec is created for active tracks with live jobs but no contacts", async () => {
  const track = await makeAdvisoryTrack(h);
  await addLiveJob(track.id);

  const res = await syncRecommendations();
  const recs = res.json as any[];
  const networkRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "network-targets");

  assert.ok(networkRec, "should create a network-target rec");
  assert.equal(networkRec.kind, "contact-person-type");
  assert.equal(networkRec.source, "system");
  assert.equal(networkRec.acceptanceEntityType, "contact");
});

test("no network rec is created when a track has no live jobs", async () => {
  const track = await makeAdvisoryTrack(h);

  const res = await syncRecommendations();
  const recs = res.json as any[];
  const networkRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "network-targets");

  assert.ok(!networkRec, "should not create a network rec with no live jobs");
});

test("network rec is staled when a contact is added for the track", async () => {
  const track = await makeAdvisoryTrack(h);
  await addLiveJob(track.id);

  await syncRecommendations();

  const contactRes = await api(h.base, "POST", "/api/contacts", {
    name: "Jane Doe",
    who: "Strategy partner",
    status: "to_contact",
    relatedTrackId: track.id,
  });
  assert.equal(contactRes.status, 200);

  const afterContact = await syncRecommendations();
  const recs = afterContact.json as any[];
  const networkRec = recs.find((r) => r.linkedTrackId === track.id && r.collection === "network-targets");

  assert.ok(networkRec, "network rec should still exist");
  assert.equal(networkRec.status, "stale", "network rec should be staled once contacts exist");
});

test("accepted or rejected recs are never staled by the sync", async () => {
  const track = await makeAdvisoryTrack(h);
  await addLiveJob(track.id);

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

  const after = await syncRecommendations();
  const recs = after.json as any[];

  const rejectedRec = recs.find((r) => r.id === rejectedId);
  assert.equal(rejectedRec.status, "rejected", "rejected status should be unchanged by sync");

  const newRec = recs.find((r) =>
    r.linkedTrackId === track.id &&
    r.linkedGapKey === "geo" &&
    r.id !== rejectedId &&
    r.status === "new",
  );
  assert.ok(newRec, "a fresh geo rec should be created alongside the rejected one");
});
