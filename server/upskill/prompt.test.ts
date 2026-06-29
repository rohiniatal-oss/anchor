import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHorizonPrompt, TECHNIQUE_KEYS } from "./prompt";
import { gatherUpskillIntake } from "./intake";
import type { CareerTrack } from "@shared/schema";

function track(over: Partial<CareerTrack>): CareerTrack {
  return {
    id: 1, slug: "ai", name: "AI gov", description: "desc", targetRoleArchetype: "advisor",
    priority: 3, status: "active", whyItFits: "fits", aspiration: "lead AI policy",
    trackIntelligence: "", createdAt: 0, ...over,
  } as CareerTrack;
}

function prompt() {
  const intake = gatherUpskillIntake(
    [track({ id: 1, priority: 3 }), track({ id: 2, name: "Geo", aspiration: "", priority: 1 })],
    { targetRoles: "advisor", locationPreferences: "London", searchPhase: "active" } as any,
    ["did X"],
    [{ title: "Earlier item", phaseLabel: "Foundations" }],
    "Foundations",
  );
  return buildHorizonPrompt(intake);
}

test("prompt includes aspirations, why-it-fits, and the profile", () => {
  const p = prompt();
  assert.match(p, /lead AI policy/);
  assert.match(p, /Why it fits: fits/);
  assert.match(p, /Target roles: advisor/);
});

test("prompt states the multi-track allocation ratio by weight", () => {
  const p = prompt();
  assert.match(p, /Allocate the next 10 items/);
  assert.match(p, /AI gov \(id 1\)=0\.75/);
  assert.match(p, /Geo \(id 2\)=0\.25/);
});

test("prompt carries the technique taxonomy and confidence language", () => {
  const p = prompt();
  for (const key of TECHNIQUE_KEYS) assert.ok(p.includes(key), `missing technique ${key}`);
  assert.match(p, /Almost certainly/);
  assert.match(p, /Roughly even odds/);
});

test("prompt forbids weeks, modules, and a capstone rather than requesting them", () => {
  const p = prompt();
  assert.match(p, /do not produce weeks, modules,\s*\n?\s*a capstone/);
  assert.match(p, /no-end-date/);
  // It must not frame the plan as a fixed-duration course.
  assert.ok(!/\d+\s*weeks?/i.test(p), "should not name a fixed number of weeks");
});

test("prompt notes where the user left off and the current phase", () => {
  const p = prompt();
  assert.match(p, /Earlier item/);
  assert.match(p, /CURRENT PHASE LABEL: Foundations/);
});
