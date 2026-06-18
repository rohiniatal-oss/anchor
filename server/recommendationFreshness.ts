import { storage } from "./storage";
import { computeLearningGaps } from "./learningStrategy";
import { buildUserContext, contextFingerprint } from "./userContext";

const LIVE_STATUSES = new Set(["new", "ranked", "saved"]);
const COVERED_STATUSES = new Set(["new", "ranked", "saved", "accepted"]);

export type RecommendationFreshnessSnapshot = {
  currentContextHash: string;
  staleAcceptedCount: number;
  staleSystemCount: number;
  missingLearningCount: number;
  missingNetworkCount: number;
  needsSync: boolean;
};

export async function getRecommendationFreshnessSnapshot(): Promise<RecommendationFreshnessSnapshot> {
  const [recs, tracks, learningGapsResult, contacts, jobs, userCtx] = await Promise.all([
    storage.getRecommendations(),
    storage.getCareerTracks(),
    computeLearningGaps(),
    storage.getContacts(),
    storage.getJobs(),
    buildUserContext(),
  ]);

  const currentContextHash = contextFingerprint(userCtx);
  const activeTrackIds = new Set(tracks.filter((track) => track.status === "active").map((track) => track.id));

  const contactsByTrack = new Map<number, number>();
  for (const contact of contacts) {
    if (contact.relatedTrackId != null) {
      contactsByTrack.set(contact.relatedTrackId, (contactsByTrack.get(contact.relatedTrackId) ?? 0) + 1);
    }
  }

  const liveJobsByTrack = new Map<number, number>();
  for (const job of jobs) {
    if (job.status !== "closed" && job.relatedTrackId != null) {
      liveJobsByTrack.set(job.relatedTrackId, (liveJobsByTrack.get(job.relatedTrackId) ?? 0) + 1);
    }
  }

  const openGapDomainsByTrack = new Map<number, Set<string>>();
  for (const gap of learningGapsResult.tracks) {
    if (gap.status === "active") {
      openGapDomainsByTrack.set(gap.trackId, new Set(gap.gapDomains));
    }
  }

  let staleSystemCount = 0;
  for (const rec of recs.filter((rec) => rec.source === "system" && LIVE_STATUSES.has(rec.status))) {
    const trackId = rec.linkedTrackId;
    if (trackId == null) continue;
    if (!activeTrackIds.has(trackId)) {
      staleSystemCount++;
      continue;
    }
    if (rec.collection === "learning-corpus" && rec.linkedGapKey) {
      const openDomains = openGapDomainsByTrack.get(trackId);
      if (!openDomains?.has(rec.linkedGapKey)) staleSystemCount++;
      continue;
    }
    if (rec.collection === "network-targets" && (contactsByTrack.get(trackId) ?? 0) > 0) {
      staleSystemCount++;
    }
  }

  const staleAcceptedCount = recs.filter((rec) =>
    rec.status === "accepted"
    && rec.source === "system"
    && !!rec.contextHash
    && rec.contextHash !== currentContextHash,
  ).length;

  let missingLearningCount = 0;
  for (const gap of learningGapsResult.tracks) {
    if (gap.status !== "active") continue;
    for (const domain of gap.gapDomains) {
      const covered = recs.some((rec) =>
        rec.linkedTrackId === gap.trackId
        && rec.linkedGapKey === domain
        && rec.collection === "learning-corpus"
        && COVERED_STATUSES.has(rec.status),
      );
      if (!covered) missingLearningCount++;
    }
  }

  let missingNetworkCount = 0;
  for (const track of tracks) {
    if (track.status !== "active") continue;
    if ((liveJobsByTrack.get(track.id) ?? 0) === 0) continue;
    if ((contactsByTrack.get(track.id) ?? 0) > 0) continue;
    const covered = recs.some((rec) =>
      rec.linkedTrackId === track.id
      && rec.collection === "network-targets"
      && COVERED_STATUSES.has(rec.status),
    );
    if (!covered) missingNetworkCount++;
  }

  return {
    currentContextHash,
    staleAcceptedCount,
    staleSystemCount,
    missingLearningCount,
    missingNetworkCount,
    needsSync: staleAcceptedCount > 0 || staleSystemCount > 0 || missingLearningCount > 0 || missingNetworkCount > 0,
  };
}
