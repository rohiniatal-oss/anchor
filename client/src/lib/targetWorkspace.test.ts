import assert from "node:assert/strict";
import test from "node:test";
import type { CareerTrack } from "@shared/schema";
import {
  chooseActiveTargetWorkspace,
  researchedTargetWorkspaces,
  targetWorkspaceSummary,
} from "./targetWorkspace";

function track(id: number, options: Record<string, any> = {}): CareerTrack {
  return {
    id,
    slug: options.slug || `track-${id}`,
    name: options.name || `Track ${id}`,
    description: options.description || "",
    targetRoleArchetype: options.targetRoleArchetype || "",
    priority: options.priority ?? 0,
    status: options.status || "active",
    whyItFits: options.whyItFits || "",
    trackIntelligence: JSON.stringify(options.intelligence || {}),
    createdAt: options.createdAt ?? id,
  };
}

test("unresearched tracks are excluded from the target workspace", () => {
  assert.equal(targetWorkspaceSummary(track(1)), null);
});

test("a researched track is summarized from its current requirement model", () => {
  const summary = targetWorkspaceSummary(track(2, {
    name: "AI strategy",
    intelligence: {
      researchedAt: 100,
      requirementModel: {
        mode: "requirement_model",
        target: { definition: "Strategy roles working with AI adoption." },
        researchQuality: { sourceCount: 9 },
        generatedAt: 120,
      },
    },
  }));

  assert.equal(summary?.id, 2);
  assert.equal(summary?.name, "AI strategy");
  assert.equal(summary?.evidenceCount, 9);
  assert.equal(summary?.updatedAt, 120);
});

test("the persisted target wins when it is still available", () => {
  const tracks = [
    track(1, { priority: 20, intelligence: { researchedAt: 100 } }),
    track(2, { priority: 5, intelligence: { researchedAt: 200 } }),
  ];

  assert.equal(chooseActiveTargetWorkspace(tracks, 2)?.id, 2);
});

test("the fallback prefers active high-priority recent targets", () => {
  const tracks = [
    track(1, { status: "paused", priority: 99, intelligence: { researchedAt: 500 } }),
    track(2, { status: "active", priority: 5, intelligence: { researchedAt: 100 } }),
    track(3, { status: "active", priority: 10, intelligence: { researchedAt: 50 } }),
  ];
  const candidates = researchedTargetWorkspaces(tracks);

  assert.deepEqual(candidates.map((candidate) => candidate.id), [3, 2, 1]);
  assert.equal(chooseActiveTargetWorkspace(tracks, null)?.id, 3);
});
