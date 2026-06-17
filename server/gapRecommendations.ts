import { storage } from "./storage";
import { computeLearningGaps } from "./learningStrategy";
import { learningGapPrepStarter } from "@shared/learningGapSuggestions";
import { domainLabel } from "@shared/capabilityDomains";
import type { CapabilityDomainKey } from "@shared/capabilityTargets";
import { generateLearningCurriculum, generateContactArchetypes } from "./learningCurriculum";
import { buildUserContext, contextFingerprint } from "./userContext";

// Statuses that can be staled when a gap closes. Terminal statuses (accepted /
// rejected / archived / duplicate / stale) are never touched by the sync.
const LIVE_STATUSES = new Set(["new", "ranked", "saved"]);
// Statuses that mean "already covered" — don't create another rec for this gap.
const COVERED_STATUSES = new Set(["new", "ranked", "saved", "accepted"]);

// Deterministic recommendation sync — called on every GET /api/recommendations.
// Idempotent: deduped by (linkedTrackId + linkedGapKey + collection) so running
// it twice leaves the same state. Never touches manually-created or accepted recs.
export async function syncGapRecommendations(): Promise<void> {
  const [recs, tracks, learningGapsResult, contacts, jobs, userCtx] = await Promise.all([
    storage.getRecommendations(),
    storage.getCareerTracks(),
    computeLearningGaps(),
    storage.getContacts(),
    storage.getJobs(),
    buildUserContext(),
  ]);
  const ctxHash = contextFingerprint(userCtx);

  const activeTrackIds = new Set(tracks.filter((t) => t.status === "active").map((t) => t.id));

  const contactsByTrack = new Map<number, number>();
  for (const c of contacts) {
    if (c.relatedTrackId != null)
      contactsByTrack.set(c.relatedTrackId, (contactsByTrack.get(c.relatedTrackId) ?? 0) + 1);
  }

  // Count non-closed jobs per track (approximates "live" without importing domainState).
  const liveJobsByTrack = new Map<number, number>();
  for (const j of jobs) {
    if (j.status !== "closed" && j.relatedTrackId != null)
      liveJobsByTrack.set(j.relatedTrackId, (liveJobsByTrack.get(j.relatedTrackId) ?? 0) + 1);
  }

  const openGapDomainsByTrack = new Map<number, Set<string>>();
  for (const lg of learningGapsResult.tracks) {
    if (lg.status === "active")
      openGapDomainsByTrack.set(lg.trackId, new Set(lg.gapDomains));
  }

  // ── Step 1: stale system recs whose underlying condition no longer holds ──
  const systemLive = recs.filter((r) => r.source === "system" && LIVE_STATUSES.has(r.status));
  for (const rec of systemLive) {
    const trackId = rec.linkedTrackId;
    if (trackId == null) continue;

    if (!activeTrackIds.has(trackId)) {
      await storage.updateRecommendation(rec.id, { status: "stale" });
      continue;
    }

    if (rec.collection === "learning-corpus" && rec.linkedGapKey) {
      const open = openGapDomainsByTrack.get(trackId);
      if (!open?.has(rec.linkedGapKey))
        await storage.updateRecommendation(rec.id, { status: "stale" });
    } else if (rec.collection === "network-targets") {
      if ((contactsByTrack.get(trackId) ?? 0) > 0)
        await storage.updateRecommendation(rec.id, { status: "stale" });
    }
  }

  // Reload after staling so dedup below sees the updated state.
  const freshRecs = await storage.getRecommendations();

  const trackById = new Map(tracks.map((t) => [t.id, t]));

  // ── Step 2: create learning-theme recs for open gaps with no existing coverage ──
  const newLearningRecs: Array<{ id: number; domain: string; label: string; trackId: number }> = [];

  for (const lg of learningGapsResult.tracks) {
    if (lg.status !== "active") continue;
    for (const domain of lg.gapDomains) {
      const covered = freshRecs.some(
        (r) =>
          r.linkedTrackId === lg.trackId &&
          r.linkedGapKey === domain &&
          r.collection === "learning-corpus" &&
          COVERED_STATUSES.has(r.status),
      );
      if (covered) continue;

      const label = domainLabel(domain as CapabilityDomainKey);
      const starter = learningGapPrepStarter(domain as CapabilityDomainKey, label);

      const created = await storage.createRecommendation({
        collection: "learning-corpus",
        kind: "learning-theme",
        status: "new",
        source: "system",
        title: starter.title,
        whySuggested: `${lg.name} has a gap in ${label}. ${starter.note}`,
        linkedTrackId: lg.trackId,
        linkedGapKey: domain,
        linkedCombination: "",
        freshnessLabel: "",
        sourceLabel: "Anchor",
        sourceUrl: "",
        rankScore: lg.priority * 10,
        rankReason: `${label} is a required learning area for ${lg.name}`,
        executionShape: "single-step",
        acceptanceEntityType: "learn",
        acceptanceDraft: JSON.stringify({
          title: starter.title,
          note: starter.note,
          requiredOutput: starter.optionalResult,
          category: label,
          capabilityBuilt: label,
          relatedTrackId: lg.trackId,
          sourceType: "recommendation",
        }),
        confidenceScore: null,
        duplicateOfId: null,
        contextHash: ctxHash,
      });

      newLearningRecs.push({ id: created.id, domain, label, trackId: lg.trackId });
    }
  }

  // Fire-and-forget: generate full study curricula for new learning-theme recs.
  // Does not block the sync — if the LLM call fails, the rec still exists.
  for (const { id, label, trackId } of newLearningRecs) {
    const track = trackById.get(trackId);
    if (track) {
      generateLearningCurriculum(id, label, track.name, track.targetRoleArchetype || "advisory").catch(() => {
        console.error(`curriculum generation skipped for rec ${id}`);
      });
    }
  }

  // ── Step 3: create network-target recs for active tracks with jobs but no contacts ──
  for (const track of tracks) {
    if (track.status !== "active") continue;
    if ((liveJobsByTrack.get(track.id) ?? 0) === 0) continue;
    if ((contactsByTrack.get(track.id) ?? 0) > 0) continue;

    const covered = freshRecs.some(
      (r) =>
        r.linkedTrackId === track.id &&
        r.collection === "network-targets" &&
        COVERED_STATUSES.has(r.status),
    );
    if (covered) continue;

    const created = await storage.createRecommendation({
      collection: "network-targets",
      kind: "contact-person-type",
      status: "new",
      source: "system",
      title: `Someone who can open doors for ${track.name}`,
      whySuggested: `You have live roles on ${track.name} but no one to reach out to yet. A warm intro or referral from the right person would help far more than saving another role.`,
      linkedTrackId: track.id,
      linkedGapKey: "warmth",
      linkedCombination: "",
      freshnessLabel: "",
      sourceLabel: "Anchor",
      sourceUrl: "",
      rankScore: track.priority * 10,
      rankReason: `${track.name} has no contacts yet`,
      executionShape: "single-step",
      acceptanceEntityType: "contact",
      acceptanceDraft: JSON.stringify({
        sector: track.name,
        targetRole: track.name,
        who: `Someone working in ${track.name.toLowerCase()}`,
        why: `Could help you reality-check or open doors for ${track.name}.`,
        relatedTrackId: track.id,
        askType: "advice",
        relationshipStrength: "cold",
        status: "to_contact",
      }),
      confidenceScore: null,
      duplicateOfId: null,
      contextHash: ctxHash,
    });

    // Fire-and-forget: generate specific contact archetypes with LLM
    generateContactArchetypes(created.id, track.name, track.targetRoleArchetype || "advisory").catch(() => {
      console.error(`contact archetype generation skipped for rec ${created.id}`);
    });
  }
}
