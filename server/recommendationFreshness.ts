import { storage } from "./storage";
import { computeLearningGaps } from "./learningStrategy";
import { buildUserContext, contextFingerprint } from "./userContext";
import { syncGapRecommendations } from "./gapRecommendations";
import { refreshNetworkIntelligence } from "./networkIntelligenceSync";

const LIVE_STATUSES = new Set(["new", "ranked", "saved"]);
const COVERED_STATUSES = new Set(["new", "ranked", "saved", "accepted"]);

function hasContactSignal(contact: { who?: string; targetOrg?: string; targetRole?: string }) {
  return !!((contact.who || "").trim() || (contact.targetOrg || "").trim() || (contact.targetRole || "").trim());
}

export type RecommendationFreshnessSnapshot = {
  currentContextHash: string;
  profileUpdatedAt: number | null;
  staleAcceptedCount: number;
  staleSystemCount: number;
  missingLearningCount: number;
  missingNetworkCount: number;
  staleNetworkGapTrackCount: number;
  staleContactClassificationCount: number;
  needsRecommendationSync: boolean;
  needsNetworkRefresh: boolean;
  needsSync: boolean;
};

export async function getRecommendationFreshnessSnapshot(): Promise<RecommendationFreshnessSnapshot> {
  const [recs, tracks, learningGapsResult, contacts, jobs, userCtx, profile, networkGaps, contactClassifications] = await Promise.all([
    storage.getRecommendations(),
    storage.getCareerTracks(),
    computeLearningGaps(),
    storage.getContacts(),
    storage.getJobs(),
    buildUserContext(),
    storage.getProfile(),
    storage.getNetworkGaps(),
    storage.getContactClassifications(),
  ]);

  const currentContextHash = contextFingerprint(userCtx);
  const profileUpdatedAt = profile?.updatedAt ?? null;
  const activeTracks = tracks.filter((track) => track.status === "active");
  const activeTrackIds = new Set(activeTracks.map((track) => track.id));

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

  const staleNetworkGapTrackCount = activeTracks.filter((track) => {
    const trackGapRows = networkGaps.filter((gap) => gap.trackId === track.id);
    if (trackGapRows.length === 0) return true;
    if (profileUpdatedAt == null) return false;
    const latestGapAt = Math.max(...trackGapRows.map((gap) => gap.createdAt || 0));
    return latestGapAt < profileUpdatedAt;
  }).length;

  const contactsWithSignal = contacts.filter(hasContactSignal);
  const latestClassificationAt = contactClassifications.reduce(
    (max, classification) => Math.max(max, classification.createdAt || 0),
    0,
  );
  const staleContactClassificationCount = (
    contactsWithSignal.length > 0
    && (
      contactClassifications.length === 0
      || (profileUpdatedAt != null && latestClassificationAt < profileUpdatedAt)
    )
  )
    ? contactsWithSignal.length
    : 0;

  const needsRecommendationSync =
    staleAcceptedCount > 0 || staleSystemCount > 0 || missingLearningCount > 0 || missingNetworkCount > 0;
  const needsNetworkRefresh =
    staleNetworkGapTrackCount > 0 || staleContactClassificationCount > 0;

  return {
    currentContextHash,
    profileUpdatedAt,
    staleAcceptedCount,
    staleSystemCount,
    missingLearningCount,
    missingNetworkCount,
    staleNetworkGapTrackCount,
    staleContactClassificationCount,
    needsRecommendationSync,
    needsNetworkRefresh,
    needsSync: needsRecommendationSync || needsNetworkRefresh,
  };
}

export async function syncFreshIntelligence(snapshot?: RecommendationFreshnessSnapshot): Promise<RecommendationFreshnessSnapshot> {
  const current = snapshot ?? await getRecommendationFreshnessSnapshot();
  if (current.needsRecommendationSync) {
    await syncGapRecommendations();
  }
  if (current.needsNetworkRefresh) {
    await refreshNetworkIntelligence();
  }
  return getRecommendationFreshnessSnapshot();
}
