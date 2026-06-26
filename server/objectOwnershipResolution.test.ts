import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";
import { assessExistingTasks } from "./anchorToday";
import { LANE_NAME } from "./lanes";
import {
  deriveStrategicObjectOwnership,
  resolveStrategicObjectOwnership,
  type StrategicObjectOwnership,
  type StrategicObjectType,
} from "./objectOwnership";

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

function ownershipFor(records: StrategicObjectOwnership[], objectType: StrategicObjectType, objectId: number) {
  const ownership = records.find((record) => record.objectType === objectType && record.objectId === objectId);
  assert.ok(ownership, `Missing ownership for ${objectType}:${objectId}`);
  return ownership;
}

async function track(name = "AI governance") {
  return h.storage.createCareerTrack({
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name,
    status: "active",
    priority: 10,
  } as any);
}

test("assigning ownership links the object to a career direction and persists a manual record", async () => {
  const direction = await track();
  const job = await h.storage.createJob({
    title: "AI Governance Lead",
    company: "Example Org",
    status: "wishlist",
    sourceType: "discovery_option",
  } as any);

  const result = await resolveStrategicObjectOwnership({
    objectType: "job",
    objectId: job.id,
    action: "assign_to_track",
    trackId: direction.id,
  });

  assert.ok(result);
  assert.equal(result.action, "assign_to_track");
  assert.equal(result.ownership.ownershipState, "linked_to_direction");
  assert.equal(result.ownership.trackId, direction.id);
  assert.equal(result.ownership.source, "manual");

  const updated = await h.storage.getJob(job.id);
  assert.equal(updated?.relatedTrackId, direction.id);

  const ownership = ownershipFor(await deriveStrategicObjectOwnership(), "job", job.id);
  assert.equal(ownership.source, "manual");
  assert.equal(ownership.trackId, direction.id);
});

test("parking a discovery task clears the track and keeps Today from executing it", async () => {
  const direction = await track();
  const task = await h.storage.createTask({
    title: "Assess AI governance discovery result",
    list: "today",
    done: false,
    category: "thinking",
    sourceType: "discovery_option",
    sourceStatus: "activated",
    relatedTrackId: direction.id,
    steps: JSON.stringify([{ text: "Open the source link", done: false }]),
    doneWhen: "A decision is recorded.",
  } as any);

  const result = await resolveStrategicObjectOwnership({
    objectType: "task",
    objectId: task.id,
    action: "park",
  });

  assert.ok(result);
  assert.equal(result.ownership.ownershipState, "parked");
  assert.equal(result.ownership.trackId, null);
  assert.equal(result.ownership.source, "manual");

  const updated = (await h.storage.getTasks()).find((item) => item.id === task.id);
  assert.ok(updated);
  assert.equal(updated.relatedTrackId, null);
  assert.equal(updated.sourceStatus, "parked");
  assert.equal(updated.readiness, "waiting");

  const assessed = assessExistingTasks([updated], { title: "AI governance discovery result", lane: LANE_NAME.DIRECTION });
  assert.equal(assessed[0].action, "ignore");
  assert.match(assessed[0].reason, /parked/i);
});

test("stopping a learn item closes it and records manual ownership", async () => {
  const direction = await track();
  const learn = await h.storage.createLearn({
    title: "AI safety course",
    type: "course",
    learnStatus: "active",
    active: true,
    relatedTrackId: direction.id,
    requiredOutput: "A note deciding whether the course is worth doing.",
    proofIntent: true,
  } as any);

  const response = await api(h.base, "POST", "/api/ownership/strategic-objects/resolve", {
    objectType: "learn",
    objectId: learn.id,
    action: "stop",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.action, "stop");
  assert.equal(response.json.ownership.ownershipState, "stopped");
  assert.equal(response.json.ownership.source, "manual");

  const updated = await h.storage.getLearnItem(learn.id);
  assert.equal(updated?.relatedTrackId, null);
  assert.equal(updated?.learnStatus, "closed");
  assert.equal(updated?.active, false);
});

test("background ownership resolution is blocked before object mutation", async () => {
  const direction = await track();
  const job = await h.storage.createJob({
    title: "AI Policy Analyst",
    company: "Example Org",
    status: "wishlist",
    sourceType: "discovery_option",
  } as any);

  const response = await fetch(`${h.base}/api/ownership/strategic-objects/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Anchor-User-Intent": "background",
    },
    body: JSON.stringify({
      objectType: "job",
      objectId: job.id,
      action: "assign_to_track",
      trackId: direction.id,
    }),
  });
  const json = await response.json();

  assert.equal(response.status, 409);
  assert.equal(json.code, "explicit_user_intent_required");
  const updated = await h.storage.getJob(job.id);
  assert.equal(updated?.relatedTrackId, null);
});

test("assigning without a track id is rejected", async () => {
  const task = await h.storage.createTask({
    title: "Assess discovery option",
    list: "inbox",
    done: false,
    category: "thinking",
    sourceType: "discovery_option",
  } as any);

  const response = await api(h.base, "POST", "/api/ownership/strategic-objects/resolve", {
    objectType: "task",
    objectId: task.id,
    action: "assign_to_track",
  });

  assert.equal(response.status, 400);
  assert.match(response.json.error, /trackId/);
});