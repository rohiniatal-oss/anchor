import assert from "node:assert/strict";
import test from "node:test";
import { deriveInsights, diagnoseTrack } from "./strategy";

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
  assert.equal(diagnostic.bottleneckLabel, "A project you started has stalled");
  assert.equal(diagnostic.recommendedMove, "Move the active project one concrete step forward");
});

test("warmth insight reflects follow-through when contacts already exist", () => {
  const insights = deriveInsights([{
    id: 1,
    slug: "ai-strategy",
    name: "AI Strategy",
    status: "active",
    priority: 80,
    whyItFits: "Good fit",
    counts: { jobs: 2, learn: 0, contacts: 2, hustles: 0, tasks: 0 },
    signals: {
      directionGap: 0,
      readinessGap: 0,
      proofGap: 0,
      warmthGap: 1,
      executionGap: 0,
      learningGap: 0,
      learnProofGap: 0,
      evidenceGap: 0,
    },
    evidence: emptyEvidence(),
    learningGap: null,
    bottleneck: "warmth",
    bottleneckLabel: "2 contacts need a follow-up",
    recommendedMove: "Follow up with the contacts that need a nudge",
  }] as any);

  const warmth = insights.find((item) => item.kind === "warmth");
  assert.ok(warmth);
  assert.match(warmth!.text, /already has people linked/i);
  assert.match(warmth!.text, /follow up with the contacts that need a nudge/i);
  assert.doesNotMatch(warmth!.text, /no useful person to reach out to yet/i);
});
