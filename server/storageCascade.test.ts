import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

async function makeTrack(name = "Test Track") {
  return h.storage.createCareerTrack({
    name,
    slug: `test-${Date.now()}`,
    description: "",
    targetRoleArchetype: "advisory",
    priority: 80,
    status: "active",
    whyItFits: "",
  } as any);
}

test("deleteCareerTrack nullifies relatedTrackId on jobs", async () => {
  const track = await makeTrack();
  const job = await h.storage.createJob({
    title: "Analyst", company: "Corp", url: "", status: "applied", notes: "", excitement: 7, relatedTrackId: track.id,
  } as any);
  await h.storage.deleteCareerTrack(track.id);
  const jobs = await h.storage.getJobs();
  const updated = jobs.find((j) => j.id === job.id);
  assert.ok(updated, "job should still exist");
  assert.equal(updated!.relatedTrackId, null);
});

test("deleteCareerTrack nullifies relatedTrackId on contacts", async () => {
  const track = await makeTrack();
  const contact = await h.storage.createContact({
    name: "", who: "Insider", sector: "Tech", why: "Advice", status: "to_contact", note: "", relatedTrackId: track.id,
  } as any);
  await h.storage.deleteCareerTrack(track.id);
  const contacts = await h.storage.getContacts();
  const updated = contacts.find((c) => c.id === contact.id);
  assert.ok(updated);
  assert.equal(updated!.relatedTrackId, null);
});

test("deleteCareerTrack nullifies relatedTrackId on learn items", async () => {
  const track = await makeTrack();
  const item = await h.storage.createLearn({
    title: "Study AI", category: "AI", cost: "", url: "", note: "", done: false, active: false, type: "resource",
    learnStatus: "open", capabilityBuilt: "AI governance", requiredOutput: "", proofIntent: false, relatedTrackId: track.id,
  } as any);
  await h.storage.deleteCareerTrack(track.id);
  const items = await h.storage.getLearn();
  const updated = items.find((l) => l.id === item.id);
  assert.ok(updated);
  assert.equal(updated!.relatedTrackId, null);
});

test("deleteCareerTrack nullifies proofAssetForTrack on hustles", async () => {
  const track = await makeTrack();
  const hustle = await h.storage.createHustle({
    title: "Write report", note: "", nextStep: "", stage: "idea", coreClaim: "", contentPillar: "", proofAssetForTrack: track.id,
  } as any);
  await h.storage.deleteCareerTrack(track.id);
  const hustles = await h.storage.getHustles();
  const updated = hustles.find((hs) => hs.id === hustle.id);
  assert.ok(updated);
  assert.equal(updated!.proofAssetForTrack, null);
});

test("deleteCareerTrack deletes network gaps for the track", async () => {
  const track = await makeTrack();
  await h.storage.upsertNetworkGaps(track.id, [
    { archetype: "Insider", description: "Needs an insider", priority: "high" } as any,
  ]);
  const before = await h.storage.getNetworkGaps(track.id);
  assert.ok(before.length > 0);
  await h.storage.deleteCareerTrack(track.id);
  const after = await h.storage.getNetworkGaps(track.id);
  assert.equal(after.length, 0);
});

test("deleteCareerTrack deletes recommendations linked to the track", async () => {
  const track = await makeTrack();
  await h.storage.createRecommendation({
    collection: "learning-corpus", kind: "learning-theme", status: "new", source: "system",
    title: "Learn AI", whySuggested: "Gap", linkedTrackId: track.id, linkedGapKey: "ai",
    linkedCombination: "", freshnessLabel: "", sourceLabel: "Anchor", sourceUrl: "",
    rankScore: 10, rankReason: "test", executionShape: "single-step",
    acceptanceEntityType: "learn", acceptanceDraft: "{}", confidenceScore: null, duplicateOfId: null,
  });
  await h.storage.deleteCareerTrack(track.id);
  const recs = await h.storage.getRecommendations();
  assert.equal(recs.filter((r) => r.linkedTrackId === track.id).length, 0);
});

test("deleteCareerTrack removes the track itself", async () => {
  const track = await makeTrack();
  await h.storage.deleteCareerTrack(track.id);
  const tracks = await h.storage.getCareerTracks();
  assert.ok(!tracks.find((t) => t.id === track.id));
});

test("deleteLearn cleans up entityLinks", async () => {
  const item = await h.storage.createLearn({
    title: "Study X", category: "AI", cost: "", url: "", note: "", done: false, active: false, type: "resource",
    learnStatus: "open", capabilityBuilt: "AI", requiredOutput: "", proofIntent: false,
  } as any);
  const task = await h.storage.createTask({
    title: "Apply X", list: "inbox", block: null, done: false, pinned: false, steps: "[]", sort: 0,
    category: "learning", size: "medium", status: "not_started", skipped: 0,
  } as any);
  await h.storage.markLearnEvidenced(item.id, "http://example.com", task.id);
  const linksBefore = await h.storage.getLearnProofLinkIds();
  assert.ok(linksBefore.has(item.id));
  await h.storage.deleteLearn(item.id);
  const linksAfter = await h.storage.getLearnProofLinkIds();
  assert.ok(!linksAfter.has(item.id));
});

test("deleteContact cleans up classifications and interactions", async () => {
  const contact = await h.storage.createContact({
    name: "", who: "Person", sector: "Tech", why: "Advice", status: "to_contact", note: "",
  } as any);
  await h.storage.upsertContactClassifications(contact.id, [
    { trackId: 1, archetype: "insider", relevanceScore: 4, accessTypes: "[]", reasoning: "test" } as any,
  ]);
  await h.storage.createContactInteraction({
    contactId: contact.id, type: "email", note: "Sent intro", outcome: "positive",
  } as any);
  await h.storage.deleteContact(contact.id);
  const cls = await h.storage.getContactClassifications(contact.id);
  assert.equal(cls.length, 0);
  const interactions = await h.storage.getContactInteractions(contact.id);
  assert.equal(interactions.length, 0);
});

test("updateCareerTrack updates fields", async () => {
  const track = await makeTrack("Original");
  const updated = await h.storage.updateCareerTrack(track.id, { name: "Updated", priority: 90 } as any);
  assert.equal(updated.name, "Updated");
  assert.equal(updated.priority, 90);
});
