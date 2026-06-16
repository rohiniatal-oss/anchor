import { domainLabel } from "@shared/capabilityDomains";
import { learningGapPrepStarter } from "@shared/learningGapSuggestions";
import { requiredDomainsForTrack, type CapabilityDomainKey } from "@shared/capabilityTargets";
import type { CareerTrack } from "@shared/schema";
import type { LearnFormT } from "@/lib/learnShared";

type StarterTrackT = Pick<CareerTrack, "slug" | "name" | "targetRoleArchetype">;
type StarterBasisT = "explicit-gap" | "subject-match" | "track-gap" | "fallback";

export type LearnStarterPrefillT = Partial<LearnFormT> & {
  starterLabel?: string;
  starterWhy?: string;
};

type LearnStarterDraftArgsT = {
  subjectText: string;
  relatedTrackId?: number | null;
  track?: StarterTrackT | null;
  explicitDomainKey?: CapabilityDomainKey | null;
  explicitDomainLabel?: string | null;
  noteIntro?: string;
  fallbackTitle?: string;
};

function inferStarterDomain(subjectText: string, track?: StarterTrackT | null): {
  domainKey: CapabilityDomainKey | null;
  basis: StarterBasisT;
} {
  const raw = subjectText.toLowerCase();

  if (/chief of staff|strategy\s*&\s*ops|strategy and ops|ops\b|operations|special projects|delivery|execution/.test(raw)) {
    return { domainKey: "product", basis: "subject-match" };
  }
  if (/\bai\b|technology|frontier|governance|safety|responsible ai|alignment|risk/.test(raw)) {
    return { domainKey: "ai-gov", basis: "subject-match" };
  }
  if (/geopolit|foreign policy|international|regional|security studies|geostrateg/.test(raw)) {
    return { domainKey: "geo", basis: "subject-match" };
  }
  if (/policy|regulat|compliance|law|legal|framework/.test(raw)) {
    return { domainKey: "policy", basis: "subject-match" };
  }

  const required = track ? requiredDomainsForTrack(track) : [];
  if (required[0]) return { domainKey: required[0] as CapabilityDomainKey, basis: "track-gap" };
  return { domainKey: null, basis: "fallback" };
}

function starterWhyText(
  basis: StarterBasisT,
  label: string,
  subjectText: string,
): string {
  if (basis === "explicit-gap") return `Suggested because ${subjectText} still looks thinnest in ${label}.`;
  if (basis === "subject-match") return `Suggested because ${subjectText} looks closest to ${label} prep right now.`;
  if (basis === "track-gap") return `Suggested because the linked role type most likely needs ${label} prep first.`;
  return `Suggested as a simple first prep item for ${subjectText}.`;
}

export function buildLearnStarterDraft({
  subjectText,
  relatedTrackId = null,
  track = null,
  explicitDomainKey = null,
  explicitDomainLabel = null,
  noteIntro = "",
  fallbackTitle,
}: LearnStarterDraftArgsT): LearnStarterPrefillT {
  const inferred = inferStarterDomain(subjectText, track);
  const domainKey = explicitDomainKey || inferred.domainKey;
  const label = explicitDomainLabel?.trim() || (domainKey ? domainLabel(domainKey) : "");
  const basis: StarterBasisT = explicitDomainKey ? "explicit-gap" : inferred.basis;

  if (domainKey && label) {
    const starter = learningGapPrepStarter(domainKey, label);
    const noteParts = [noteIntro.trim(), starter.note, `If it helps later, you can keep ${starter.optionalResult}.`]
      .filter(Boolean);
    return {
      title: starter.title,
      category: label,
      capabilityBuilt: label,
      requiredOutput: "",
      url: "",
      note: noteParts.join(" "),
      relatedTrackId,
      proofIntent: false,
      learnStatus: "open",
      starterLabel: starter.title,
      starterWhy: starterWhyText(basis, label, subjectText),
    };
  }

  return {
    title: fallbackTitle || `Prep for ${subjectText}`,
    category: "",
    capabilityBuilt: "",
    requiredOutput: "",
    url: "",
    note: [noteIntro.trim(), "If something useful comes out of this later, you can save notes here."]
      .filter(Boolean)
      .join(" "),
    relatedTrackId,
    proofIntent: false,
    learnStatus: "open",
    starterLabel: fallbackTitle || `Prep for ${subjectText}`,
    starterWhy: starterWhyText("fallback", "", subjectText),
  };
}
