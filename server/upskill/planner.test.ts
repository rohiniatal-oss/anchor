import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "../spine.harness";
import { composeHorizon, recompose, __setHorizonLlmForTest } from "./planner";
import { gatherUpskillIntake } from "./intake";
import * as repo from "./repository";
import type { CareerTrack } from "@shared/schema";

let h: Harness;
before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); __setHorizonLlmForTest(null); });

function track(id: number, over: Partial<CareerTrack> = {}): CareerTrack {
  return {
    id, slug: `t${id}`, name: `Track ${id}`, description: "", targetRoleArchetype: "",
    priority: 1, status: "active", whyItFits: "", aspiration: "", trackIntelligence: "",
    createdAt: 0, ...over,
  } as CareerTrack;
}

function fakeItem(trackId: number, i: number, over: any = {}) {
  return {
    trackId, phaseLabel: "Foundations", title: `Item ${i}`, activity: "Do the thing",
    doneWhen: "It is done", morning: { hours: 2, focus: "read", items: ["src"] },
    afternoon: { hours: 2, focus: "write", items: ["draft"] },
    sources: [{ title: "S", author: "A", url: "search: x", why: "w" }],
    artifact: { techniqueKey: "bluf", title: "Artifact", prompt: "p", wordTarget: 300, saveAs: `a-${i}.md` },
    rationale: "because", ...over,
  };
}

function horizonLlm(items: any[]) {
  return async () => ({ ok: true as const, value: { items } });
}

test("composeHorizon returns no_active_tracks when intake is empty", async () => {
  const result = await composeHorizon(gatherUpskillIntake([], null, []));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_active_tracks");
});

test("composeHorizon reports missing_openai_key when no override and no real key", async () => {
  // beforeEach resets the override to the real llmJSONLarge; the harness key is "test-noop".
  const result = await composeHorizon(gatherUpskillIntake([track(1)], null, []));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing_openai_key");
});

test("composeHorizon validates and returns the 10 items from the model", async () => {
  __setHorizonLlmForTest(horizonLlm(Array.from({ length: 10 }, (_, i) => fakeItem(1, i))));
  const result = await composeHorizon(gatherUpskillIntake([track(1)], null, []));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.items.length, 10);
});

test("composeHorizon rejects malformed model output", async () => {
  __setHorizonLlmForTest(horizonLlm([{ trackId: 1, title: "" }]));
  const result = await composeHorizon(gatherUpskillIntake([track(1)], null, []));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_model_output");
});

test("composeHorizon drops items for unknown tracks and bad technique keys", async () => {
  __setHorizonLlmForTest(horizonLlm([
    fakeItem(1, 0, { artifact: { techniqueKey: "not_a_real_technique", saveAs: "x.md" } }),
    fakeItem(99, 1),
  ]));
  const result = await composeHorizon(gatherUpskillIntake([track(1)], null, []));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].artifact?.techniqueKey, undefined);
  }
});

test("recompose persists a horizon and replaces stale items on the second pass", async () => {
  await h.storage.createCareerTrack({ name: "AI gov", slug: "ai", status: "active", priority: 2 } as any);

  __setHorizonLlmForTest(horizonLlm(Array.from({ length: 10 }, (_, i) => fakeItem(1, i))));
  const first = await recompose();
  assert.equal(first.ok, true);
  assert.equal(repo.countByStatus("queued"), 10);

  __setHorizonLlmForTest(horizonLlm(Array.from({ length: 10 }, (_, i) => fakeItem(1, i + 100))));
  const second = await recompose();
  assert.equal(second.ok, true);
  assert.equal(repo.countByStatus("queued"), 10); // new queued
  assert.equal(repo.countByStatus("stale"), 10);  // old queued retired
});
