import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "./spine.harness";

let h: Harness;
let getUnlinkedItems: typeof import("./strategy").getUnlinkedItems;
let resolveStrategicObjectOwnership: typeof import("./objectOwnership").resolveStrategicObjectOwnership;
let getOwnershipFeedback: typeof import("./objectOwnership").getOwnershipFeedback;

before(async () => {
  h = await makeHarness();
  ({ getUnlinkedItems } = await import("./strategy"));
  ({ resolveStrategicObjectOwnership, getOwnershipFeedback } = await import("./objectOwnership"));
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

function unlinkedItem(bucket: Awaited<ReturnType<typeof getUnlinkedItems>>, entity: string, id: number) {
  return bucket.items.find((item) => item.entity === entity && item.id === id);
}

async function createTrack(name = "AI governance", overrides: Record<string, unknown> = {}) {
  return h.storage.createCareerTrack({
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name,
    status: "active",
    priority: 10,
    whyItFits: "Test direction",
    ...overrides,
  } as any);
}

test("unlinked items include an ownership recommendation with reason confidence priority and next action", async () => {
  const track = await createTrack("AI governance");
  const job = await h.storage.createJob({
    title: "AI Governance Lead",
    company: "Example Org",
    status: "wishlist",
    sourceType: "discovery_option",
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "jobs", job.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "assign_to_track");
  assert.equal(item.suggestion.trackId, track.id);
  assert.equal(item.suggestion.trackName, "AI governance");
  assert.equal(item.suggestion.confidence, "high");
  assert.equal(item.suggestion.priority, "now");
  assert.match(item.suggestion.reason, /matches AI governance/i);
  assert.match(item.suggestion.priorityReason, /no live role signal/i);
  assert.match(item.suggestion.nextAction, /Verify the source/i);
});

test("ownership recommendations use saved source evidence when the visible title is generic", async () => {
  const track = await createTrack("AI governance");
  const job = await h.storage.createJob({
    title: "Policy Analyst",
    company: "Example Org",
    status: "wishlist",
    sourceType: "discovery_option",
    sourceUrl: "https://jobs.example.org/frontier-ai-governance-policy",
    roleModel: JSON.stringify({
      sourceTitle: "Frontier AI governance policy role",
      requirements: ["model governance", "AI regulation", "risk management"],
      nextAction: "Verify whether the role is current before applying.",
    }),
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "jobs", job.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "assign_to_track");
  assert.equal(item.suggestion.trackId, track.id);
  assert.equal(item.suggestion.trackName, "AI governance");
  assert.equal(item.suggestion.confidence, "high");
  assert.equal(item.suggestion.priority, "now");
  assert.match(item.suggestion.reason, /source evidence.*matches AI governance/i);
});

test("ownership recommendations compare source evidence with track intelligence", async () => {
  const track = await createTrack("Policy operations", {
    trackIntelligence: JSON.stringify({
      roleFamilies: ["frontier model governance"],
      capabilityDomains: ["model evaluations", "risk controls"],
    }),
  });
  const learn = await h.storage.createLearn({
    title: "Reading packet",
    type: "resource",
    learnStatus: "open",
    note: "Source discusses model evaluations for frontier governance teams.",
    proofIntent: true,
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "learn", learn.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "assign_to_track");
  assert.equal(item.suggestion.trackId, track.id);
  assert.equal(item.suggestion.trackName, "Policy operations");
  assert.ok(["medium", "high"].includes(item.suggestion.confidence));
  assert.match(item.suggestion.reason, /source evidence/i);
});

test("matched items become later when the track already has live work", async () => {
  const track = await createTrack("AI governance");
  await h.storage.createJob({
    title: "Existing AI Governance role",
    company: "Example Org",
    status: "wishlist",
    relatedTrackId: track.id,
  } as any);
  const job = await h.storage.createJob({
    title: "AI Governance Analyst",
    company: "Another Org",
    status: "wishlist",
    sourceType: "discovery_option",
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "jobs", job.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "assign_to_track");
  assert.equal(item.suggestion.trackId, track.id);
  assert.equal(item.suggestion.priority, "later");
  assert.match(item.suggestion.priorityReason, /already has live work/i);
  assert.match(item.suggestion.nextAction, /saved context/i);
});

test("contact suggestions become now when a track has live roles but no contact path", async () => {
  const track = await createTrack("AI governance");
  await h.storage.createJob({
    title: "AI Governance Lead",
    company: "Example Org",
    status: "wishlist",
    relatedTrackId: track.id,
  } as any);
  const contact = await h.storage.createContact({
    who: "AI governance hiring manager",
    status: "to_contact",
    relationshipStrength: "cold",
    askType: "advice",
    targetRole: "AI governance",
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "contacts", contact.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "assign_to_track");
  assert.equal(item.suggestion.trackId, track.id);
  assert.equal(item.suggestion.priority, "now");
  assert.match(item.suggestion.priorityReason, /no active contact path/i);
});

test("contact suggestions become later when an active contact path already exists", async () => {
  const track = await createTrack("AI governance");
  await h.storage.createJob({
    title: "AI Governance Lead",
    company: "Example Org",
    status: "wishlist",
    relatedTrackId: track.id,
  } as any);
  await h.storage.createContact({
    who: "Existing AI governance advisor",
    status: "to_contact",
    relationshipStrength: "warm",
    askType: "advice",
    targetRole: "AI governance",
    relatedTrackId: track.id,
  } as any);
  const contact = await h.storage.createContact({
    who: "AI governance recruiter",
    status: "to_contact",
    relationshipStrength: "cold",
    askType: "advice",
    targetRole: "AI governance",
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "contacts", contact.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "assign_to_track");
  assert.equal(item.suggestion.trackId, track.id);
  assert.equal(item.suggestion.priority, "later");
  assert.match(item.suggestion.priorityReason, /already has live work/i);
  assert.match(item.suggestion.nextAction, /saved context/i);
});

test("ownership overrides are stored as recommendation feedback", async () => {
  const track = await createTrack("AI governance");
  const job = await h.storage.createJob({
    title: "AI Governance Lead",
    company: "Example Org",
    status: "wishlist",
  } as any);
  const item = unlinkedItem(await getUnlinkedItems(), "jobs", job.id);

  assert.ok(item);
  assert.equal(item.suggestion.trackId, track.id);
  await resolveStrategicObjectOwnership({
    objectType: "job",
    objectId: job.id,
    action: "park",
    reason: "User corrected Anchor during Strategy cleanup.",
    recommendation: item.suggestion,
  });

  const feedback = getOwnershipFeedback();
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].objectType, "job");
  assert.equal(feedback[0].objectId, job.id);
  assert.equal(feedback[0].recommendedAction, "assign_to_track");
  assert.equal(feedback[0].recommendedTrackId, track.id);
  assert.equal(feedback[0].chosenAction, "park");
  assert.equal(feedback[0].chosenTrackId, null);
  assert.match(feedback[0].reason, /User corrected Anchor/i);
});

test("track override feedback shifts future close ownership suggestions", async () => {
  const governance = await createTrack("AI governance");
  const operations = await createTrack("Policy operations", {
    trackIntelligence: JSON.stringify({
      roleFamilies: ["AI governance operations"],
      capabilityDomains: ["operations"],
    }),
  });
  const firstJob = await h.storage.createJob({
    title: "AI Governance Operations Lead",
    company: "Example Org",
    status: "wishlist",
  } as any);
  const firstItem = unlinkedItem(await getUnlinkedItems(), "jobs", firstJob.id);

  assert.ok(firstItem);
  assert.equal(firstItem.suggestion.trackId, governance.id);
  await resolveStrategicObjectOwnership({
    objectType: "job",
    objectId: firstJob.id,
    action: "assign_to_track",
    trackId: operations.id,
    reason: "This is actually the operations track.",
    recommendation: firstItem.suggestion,
  });

  const nextJob = await h.storage.createJob({
    title: "AI Governance Operations Manager",
    company: "Another Org",
    status: "wishlist",
  } as any);
  const nextItem = unlinkedItem(await getUnlinkedItems(), "jobs", nextJob.id);

  assert.ok(nextItem);
  assert.equal(nextItem.suggestion.action, "assign_to_track");
  assert.equal(nextItem.suggestion.trackId, operations.id);
  assert.equal(nextItem.suggestion.trackName, "Policy operations");
  assert.match(nextItem.suggestion.reason, /prior cleanup feedback/i);
});

test("inactive tracks can match but stay later instead of entering execution", async () => {
  const track = await createTrack("AI governance", { status: "watch" });
  const job = await h.storage.createJob({
    title: "AI Governance Lead",
    company: "Example Org",
    status: "wishlist",
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "jobs", job.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "assign_to_track");
  assert.equal(item.suggestion.trackId, track.id);
  assert.equal(item.suggestion.priority, "later");
  assert.match(item.suggestion.priorityReason, /not active/i);
});

test("ambiguous unlinked items recommend parking instead of forcing a role type", async () => {
  await createTrack("AI governance");
  const learn = await h.storage.createLearn({
    title: "General systems thinking",
    type: "resource",
    learnStatus: "open",
    requiredOutput: "A general note",
    proofIntent: true,
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "learn", learn.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "park");
  assert.equal(item.suggestion.trackId, null);
  assert.equal(item.suggestion.confidence, "low");
  assert.equal(item.suggestion.priority, "parked");
  assert.match(item.suggestion.reason, /No role type clearly matches/i);
  assert.match(item.suggestion.nextAction, /Leave it parked/i);
});

test("inactive contacts recommend stop priority", async () => {
  const contact = await h.storage.createContact({
    who: "Past networking lead",
    status: "archived",
    relationshipStrength: "cold",
    askType: "advice",
  } as any);

  const item = unlinkedItem(await getUnlinkedItems(), "contacts", contact.id);

  assert.ok(item);
  assert.equal(item.suggestion.action, "stop");
  assert.equal(item.suggestion.priority, "stop");
  assert.match(item.suggestion.nextAction, /Stop tracking/i);
});

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
  assert.equal(result.ownership.ownershipState, "parked");
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
  assert.equal(result.ownership.ownershipState, "stopped");

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