import { Briefcase, GraduationCap, ListChecks, Rocket, Users } from "lucide-react";
import type { Recommendation } from "@shared/schema";
import type { Tab } from "@/lib/homeTypes";
import {
  buildPrefillHash,
  PENDING_CONTACT_DRAFT_KEY,
  PENDING_LEARN_DRAFT_KEY,
  queueIntakeDraft,
} from "@/lib/homeTypes";
import { buildPrepStarterDraft } from "@/lib/learnStarter";

export type TrackActionDiagnostic = {
  id: number;
  name: string;
  status: string;
  bottleneck: string;
  bottleneckLabel: string;
  recommendedMove: string;
  learningGap?: { topGapDomain: string | null; topGapLabel: string | null } | null;
  counts: { jobs: number; contacts: number; tasks?: number };
};

type RecommendationRef = {
  id: number;
  collection: string;
  status: string;
  title: string;
  linkedTrackId?: number | null;
  linkedGapKey?: string | null;
};

export type TrackNextAction = {
  icon: typeof Briefcase;
  title: string;
  detail: string;
  action: string;
  mode: "setup" | "do-now";
  kind:
    | "direction_saved"
    | "direction_missing"
    | "learning_saved"
    | "learning_missing"
    | "warmth_saved"
    | "warmth_missing"
    | "warmth_follow"
    | "readiness"
    | "proof";
  trackId: number;
  trackName: string;
  gapDomain?: string | null;
  gapLabel?: string | null;
  recommendation?: RecommendationRef | null;
};

function visibleRecommendationForTrack(
  recs: RecommendationRef[],
  input: { trackId: number; collection: string; gapKey?: string | null },
) {
  return recs.find((rec) =>
    rec.linkedTrackId === input.trackId &&
    rec.collection === input.collection &&
    !["accepted", "rejected", "archived", "duplicate", "stale"].includes(rec.status) &&
    (!input.gapKey || rec.linkedGapKey === input.gapKey),
  ) || null;
}

export function deriveTrackNextAction(
  track: TrackActionDiagnostic,
  recs: RecommendationRef[],
): TrackNextAction | null {
  if (track.status !== "active") return null;
  const b = track.bottleneck;
  if (b === "none" || b === "execution") return null;

  if (b === "direction") {
    const hasSavedRole = track.counts.jobs > 0;
    return {
      icon: Briefcase,
      title: hasSavedRole
        ? `Review the strongest role for "${track.name}"`
        : `Add a job or role for "${track.name}"`,
      detail: hasSavedRole
        ? track.recommendedMove || track.bottleneckLabel || "You already have roles here, so the next move is to sharpen which one is worth pursuing."
        : "Even a wishlist role gives this track direction - the search cannot move without one.",
      action: hasSavedRole ? "Open jobs" : "Add a job",
      mode: hasSavedRole ? "do-now" : "setup",
      kind: hasSavedRole ? "direction_saved" : "direction_missing",
      trackId: track.id,
      trackName: track.name,
    };
  }

  if (b === "learning") {
    const gapDomain = track.learningGap?.topGapDomain || null;
    const gapLabel = track.learningGap?.topGapLabel || null;
    const savedLearningRec = visibleRecommendationForTrack(recs, {
      trackId: track.id,
      collection: "learning-corpus",
      gapKey: gapDomain,
    });
    return savedLearningRec ? {
      icon: GraduationCap,
      title: gapLabel
        ? `Use the saved ${gapLabel} learning item for "${track.name}"`
        : `Use the saved learning item for "${track.name}"`,
      detail: `${savedLearningRec.title} is already waiting in Learn, so you can begin from that instead of setting one up from scratch.`,
      action: "Use saved learning item",
      mode: "do-now",
      kind: "learning_saved",
      trackId: track.id,
      trackName: track.name,
      gapDomain,
      gapLabel,
      recommendation: savedLearningRec,
    } : {
      icon: GraduationCap,
      title: gapLabel
        ? `Add one ${gapLabel} learning item for "${track.name}"`
        : `Add one learning item for "${track.name}"`,
      detail: gapLabel
        ? `${gapLabel} is the main weak area here, so the next useful move is one targeted learning item instead of generic browsing.`
        : "This track needs one targeted learning item before it will feel more ready to pursue.",
      action: "Add learning item",
      mode: "setup",
      kind: "learning_missing",
      trackId: track.id,
      trackName: track.name,
      gapDomain,
      gapLabel,
    };
  }

  if (b === "warmth") {
    const hasContacts = track.counts.contacts > 0;
    const savedContactRec = !hasContacts
      ? visibleRecommendationForTrack(recs, { trackId: track.id, collection: "network-targets" })
      : null;
    if (savedContactRec) {
      return {
        icon: Users,
        title: `Use the saved contact suggestion for "${track.name}"`,
        detail: `${savedContactRec.title} is already saved, so you can use that contact path instead of starting from a blank network entry.`,
        action: "Use saved suggestion",
        mode: "do-now",
        kind: "warmth_saved",
        trackId: track.id,
        trackName: track.name,
        recommendation: savedContactRec,
      };
    }
    return {
      icon: Users,
      title: hasContacts
        ? `Follow up or sharpen the ask for "${track.name}"`
        : `Add a contact for "${track.name}"`,
      detail: hasContacts
        ? track.recommendedMove || track.bottleneckLabel || "You already have people linked here, so the next move is to use that access better."
        : "You have live roles for this track but no one useful to reach out to yet. One advice conversation could open doors.",
      action: hasContacts ? "Open network" : "Add a contact",
      mode: hasContacts ? "do-now" : "setup",
      kind: hasContacts ? "warmth_follow" : "warmth_missing",
      trackId: track.id,
      trackName: track.name,
    };
  }

  if (b === "readiness") {
    const hasTaskTrail = (track.counts.tasks || 0) > 0;
    return {
      icon: hasTaskTrail ? ListChecks : Briefcase,
      title: hasTaskTrail
        ? `Review the strongest role for "${track.name}"`
        : `Work the strongest role for "${track.name}"`,
      detail: track.recommendedMove || track.bottleneckLabel || "A real role is close enough to work on now, so the next move should make it more ready rather than add more learning.",
      action: "Open jobs",
      mode: "do-now",
      kind: "readiness",
      trackId: track.id,
      trackName: track.name,
    };
  }

  if (b === "proof") {
    return {
      icon: Rocket,
      title: `Move a stalled project forward for "${track.name}"`,
      detail: "A project you started has stalled. One concrete step today keeps it moving.",
      action: "Open projects",
      mode: "do-now",
      kind: "proof",
      trackId: track.id,
      trackName: track.name,
    };
  }

  return null;
}

export function deriveTrackNextActions(
  tracks: TrackActionDiagnostic[],
  recs: RecommendationRef[],
) {
  return tracks
    .map((track) => deriveTrackNextAction(track, recs))
    .filter((action): action is TrackNextAction => !!action);
}

export async function runTrackNextAction(
  action: TrackNextAction,
  onOpenTab: (tab: Tab) => void,
  acceptRecommendation: (rec: RecommendationRef) => Promise<void>,
) {
  if (action.recommendation) {
    await acceptRecommendation(action.recommendation);
    return;
  }

  if (action.kind === "direction_saved" || action.kind === "direction_missing" || action.kind === "readiness") {
    onOpenTab("jobs");
    return;
  }

  if (action.kind === "proof") {
    onOpenTab("learn");
    return;
  }

  if (action.kind === "warmth_follow") {
    onOpenTab("network");
    return;
  }

  if (action.kind === "warmth_missing") {
    const draft = {
      relatedTrackId: action.trackId,
      askType: "advice",
      relationshipStrength: "cold",
      status: "to_contact",
      who: `Someone working in ${action.trackName.toLowerCase()}`,
      why: `Could help you reality-check or open doors for ${action.trackName}.`,
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/network", "contactDraft", draft);
    onOpenTab("network");
    return;
  }

  if (action.kind === "learning_missing") {
    const draft = buildPrepStarterDraft({
      subjectText: action.gapLabel || action.trackName,
      relatedTrackId: action.trackId,
      explicitDomainKey: action.gapDomain as any,
      explicitDomainLabel: action.gapLabel || undefined,
      noteIntro: `Needed for ${action.trackName}.`,
      fallbackTitle: `Intro to ${action.gapLabel || action.trackName}`,
    });
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
    onOpenTab("learn");
    return;
  }

  onOpenTab("learn");
}
