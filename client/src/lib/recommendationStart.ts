import { buildPrepStarterDraft, type LearnStarterPrefillT } from "@/lib/learnStarter";
import { CAPABILITY_DOMAIN_KEYS, domainLabel } from "@shared/capabilityDomains";
import type { CapabilityDomainKey } from "@shared/capabilityTargets";

type LearnRecommendationLike = {
  title: string;
  whySuggested: string;
  linkedTrackId?: number | null;
  linkedGapKey?: string | null;
  sourceUrl?: string | null;
};

type RecommendationSubdivisionLike = {
  label: string;
  whyItMatters?: string | null;
  suggestedMaterials?: string | null;
};

type RecommendationMilestoneLike = {
  label: string;
  doneWhen?: string | null;
  status?: string | null;
  suggestedTaskTitle?: string | null;
};

type RecommendationDetailLike = {
  subdivisions?: RecommendationSubdivisionLike[] | null;
  milestones?: RecommendationMilestoneLike[] | null;
};

export type RecommendationStartHint = {
  title: string;
  note: string;
};

function parseSuggestedMaterials(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function recommendationDomainKey(raw?: string | null): CapabilityDomainKey | null {
  const key = (raw || "").trim();
  return CAPABILITY_DOMAIN_KEYS.includes(key) ? key as CapabilityDomainKey : null;
}

export function buildLearnRecommendationDraft(
  recommendation: LearnRecommendationLike,
  trackName?: string | null,
): LearnStarterPrefillT {
  const domainKey = recommendationDomainKey(recommendation.linkedGapKey);
  const domainName = domainKey ? domainLabel(domainKey) : null;
  const subjectText = domainName || trackName || recommendation.title;
  const draft = buildPrepStarterDraft({
    subjectText,
    relatedTrackId: recommendation.linkedTrackId ?? null,
    explicitDomainKey: domainKey,
    explicitDomainLabel: domainName,
    noteIntro: recommendation.whySuggested || "",
    fallbackTitle: recommendation.title,
  });

  return {
    ...draft,
    title: recommendation.title.trim() || draft.title,
    url: recommendation.sourceUrl?.trim() || draft.url,
    starterLabel: recommendation.title.trim() || draft.starterLabel,
    starterWhy: recommendation.whySuggested || draft.starterWhy,
  };
}

export function deriveRecommendationStart(detail?: RecommendationDetailLike | null): RecommendationStartHint | null {
  if (!detail) return null;
  const milestones = detail.milestones || [];
  const activeMilestone =
    milestones.find((milestone) => milestone.status === "active")
    || milestones.find((milestone) => milestone.status === "blocked")
    || milestones.find((milestone) => milestone.status === "todo")
    || milestones[0];

  if (activeMilestone) {
    return {
      title: activeMilestone.suggestedTaskTitle?.trim() || activeMilestone.label,
      note: activeMilestone.doneWhen?.trim()
        ? `Done when: ${activeMilestone.doneWhen.trim()}`
        : activeMilestone.label,
    };
  }

  const subdivisions = detail.subdivisions || [];
  const firstSubdivision = subdivisions[0];
  if (!firstSubdivision) return null;
  const materials = parseSuggestedMaterials(firstSubdivision.suggestedMaterials);
  if (materials[0]) {
    return {
      title: materials[0],
      note: firstSubdivision.whyItMatters?.trim() || `Useful for ${firstSubdivision.label}.`,
    };
  }

  return {
    title: firstSubdivision.label,
    note: firstSubdivision.whyItMatters?.trim() || "Start with this topic first.",
  };
}
