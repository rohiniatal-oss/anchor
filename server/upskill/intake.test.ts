import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeights, gatherUpskillIntake } from "./intake";
import type { CareerTrack, UserProfile } from "@shared/schema";

function track(over: Partial<CareerTrack>): CareerTrack {
  return {
    id: 1, slug: "", name: "Track", description: "", targetRoleArchetype: "",
    priority: 0, status: "active", whyItFits: "", aspiration: "",
    trackIntelligence: "", createdAt: 0, ...over,
  } as CareerTrack;
}

test("computeWeights splits proportionally by priority", () => {
  assert.deepEqual(computeWeights([{ priority: 3 }, { priority: 1 }]), [0.75, 0.25]);
});

test("computeWeights falls back to equal split when all priorities are 0", () => {
  assert.deepEqual(computeWeights([{ priority: 0 }, { priority: 0 }]), [0.5, 0.5]);
  assert.deepEqual(computeWeights([]), []);
});

test("gatherUpskillIntake includes only active tracks with weights and aspiration", () => {
  const tracks = [
    track({ id: 1, name: "AI gov", priority: 3, aspiration: "lead AI policy", status: "active" }),
    track({ id: 2, name: "Geopolitics", priority: 1, status: "active" }),
    track({ id: 3, name: "Paused lane", priority: 5, status: "paused" }),
  ];
  const profile = { targetRoles: "advisor", locationPreferences: "London", searchPhase: "active" } as UserProfile;
  const intake = gatherUpskillIntake(tracks, profile, ["did X"], [{ title: "Item 1", phaseLabel: "Foundations" }], "Foundations");

  assert.equal(intake.tracks.length, 2);
  assert.equal(intake.tracks[0].name, "AI gov");
  assert.equal(intake.tracks[0].aspiration, "lead AI policy");
  assert.equal(intake.tracks[0].weight, 0.75);
  assert.equal(intake.tracks[1].weight, 0.25);
  assert.equal(intake.profile.targetRoles, "advisor");
  assert.deepEqual(intake.signals, ["did X"]);
  assert.equal(intake.recentCompleted[0].title, "Item 1");
  assert.equal(intake.currentPhaseLabel, "Foundations");
});

test("gatherUpskillIntake tolerates a null profile", () => {
  const intake = gatherUpskillIntake([track({ status: "active" })], null, []);
  assert.equal(intake.profile.targetRoles, "");
  assert.equal(intake.tracks[0].weight, 1);
});
