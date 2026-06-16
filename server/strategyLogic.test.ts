import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseTrack } from "./strategy";

function track(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    slug: overrides.slug ?? "ai-strategy",
    name: overrides.name ?? "AI Strategy",
    status: overrides.status ?? "active",
    priority: overrides.priority ?? 80,
    whyItFits: overrides.whyItFits ?? "Good fit",
    targetRoleArchetype: overrides.targetRoleArchetype ?? "strategy",
    ...overrides,
  } as any;
}

function job(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "AI Strategy Associate",
    company: overrides.company ?? "Target Org",
    status: overrides.status ?? "wishlist",
    applicationReadiness: overrides.applicationReadiness ?? "questions",
    applicationWindowStatus: overrides.applicationWindowStatus ?? "open",
    warmPathScore: overrides.warmPathScore ?? 72,
    relatedTrackId: overrides.relatedTrackId ?? 1,
    ...overrides,
  } as any;
}

function contact(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Warm Contact",
    who: overrides.who ?? "Warm Contact",
    status: overrides.status ?? "replied",
    relationshipStrength: overrides.relationshipStrength ?? "warm",
    relatedTrackId: overrides.relatedTrackId ?? 1,
    nextFollowUpDate: overrides.nextFollowUpDate ?? "",
    ...overrides,
  } as any;
}

function hustle(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "AI memo series",
    stage: overrides.stage ?? "testing",
    proofAssetForTrack: overrides.proofAssetForTrack ?? 1,
    ...overrides,
  } as any;
}

function emptyEvidence(trackId = 1) {
  return {
    trackId,
    evidenceCount: 0,
    evidenceCountAllTime: 0,
    evidenceByCategory: { job_progress: 0, learning: 0, network: 0, proof_asset: 0, mindset: 0, admin: 0 },
    topCategory: null,
    lastEvidenceAt: null,
    executionRatio: null,
    executionEvents: 0,
    openTasks: 0,
    producingVsPlanning: "idle",
  } as any;
}

test("missing proof asset does not become a frontline strategy bottleneck", () => {
  const diagnostic = diagnoseTrack(
    track(),
    [job()],
    [],
    [contact()],
    [],
    [],
    new Map(),
    new Map(),
    emptyEvidence(),
    undefined,
  );

  assert.equal(diagnostic.signals.proofGap, 0);
  assert.notEqual(diagnostic.bottleneck, "proof");
  assert.equal(diagnostic.bottleneck, "none");
});

test("only a stalled active proof asset surfaces as low-priority proof support", () => {
  const diagnostic = diagnoseTrack(
    track(),
    [],
    [],
    [contact()],
    [hustle()],
    [],
    new Map(),
    new Map([[1, [{ id: 11, stepLabel: "Draft one memo", status: "todo" }, { id: 12, stepLabel: "Publish one output", status: "todo" }] as any]]),
    emptyEvidence(),
    undefined,
  );

  assert.equal(diagnostic.signals.proofGap, 1);
  assert.equal(diagnostic.bottleneck, "proof");
  assert.equal(diagnostic.bottleneckLabel, "Active project or public-work item stalled");
  assert.equal(diagnostic.recommendedMove, "Move the active project or public-work item one concrete step forward");
});
