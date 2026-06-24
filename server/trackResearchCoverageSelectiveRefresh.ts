import { storage } from "./storage";
import { buildCanonicalUserEvidenceCorpus } from "./trackResearchCoverageCorpus";
import type { CoverageModel, RequirementCoverage } from "./trackResearchCoverageModel";
import { assessRequirementCoverageWithLlm } from "./trackResearchCoverageSynthesis";
import {
  applyCoverageQualityPolicy,
  coverageRequirementFingerprint,
} from "./trackResearchCoverageQuality";
import type { RequirementModel } from "./trackResearchRequirementModel";

export type SelectiveCoverageRefreshResult = {
  track: any;
  requirementModel: RequirementModel;
  beforeCoverageModel: CoverageModel;
  coverageModel: CoverageModel;
  refreshedRequirementIds: string[];
};

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function validRequirementModel(value: any): value is RequirementModel {
  return value?.mode === "requirement_model"
    && Array.isArray(value.requirements)
    && value.requirements.length > 0;
}

function validCoverageModel(value: any, requirementModel: RequirementModel): value is CoverageModel {
  const requirementIds = new Set(requirementModel.requirements.map((requirement) => requirement.id));
  return value?.mode === "coverage_model"
    && Array.isArray(value.coverage)
    && value.coverage.length === requirementIds.size
    && value.coverage.every((coverage: any) => requirementIds.has(coverage.requirementId));
}

function subsetRequirementModel(
  requirementModel: RequirementModel,
  requirementIds: Set<string>,
): RequirementModel {
  const requirements = requirementModel.requirements.filter((requirement) => requirementIds.has(requirement.id));
  const claimIds = new Set(requirements.flatMap((requirement) => requirement.evidenceClaimIds));
  return {
    ...requirementModel,
    groups: requirementModel.groups
      .map((group) => ({
        ...group,
        requirementIds: group.requirementIds.filter((id) => requirementIds.has(id)),
      }))
      .filter((group) => group.requirementIds.length > 0),
    requirements,
    evidenceClaims: requirementModel.evidenceClaims.filter((claim) => claimIds.has(claim.id)),
  };
}

function unknownCoverage(requirementId: string, successBar: string): RequirementCoverage {
  return {
    requirementId,
    status: "unknown",
    confidence: "low",
    evidenceItemIds: [],
    reason: "Anchor has not yet reassessed this requirement against the current evidence corpus.",
    successBarAssessment: `Coverage cannot yet be assessed reliably against: ${successBar}`,
    evidenceStillNeeded: [`Evidence that directly demonstrates: ${successBar}`],
    sourceBasis: "deterministic",
  };
}

async function computeSelectiveCoverageRefresh(
  trackId: number,
  requestedRequirementIds: string[],
  retryAfterConcurrentRequirementChange = true,
): Promise<SelectiveCoverageRefreshResult | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const requirementModel = intelligence.requirementModel;
  if (!validRequirementModel(requirementModel)) return null;
  const beforeCoverageModel = intelligence.coverageModel;
  if (!validCoverageModel(beforeCoverageModel, requirementModel)) return null;

  const validIds = new Set(requirementModel.requirements.map((requirement) => requirement.id));
  const refreshedRequirementIds = uniqueStrings(requestedRequirementIds).filter((id) => validIds.has(id));
  if (!refreshedRequirementIds.length) {
    return {
      track,
      requirementModel,
      beforeCoverageModel,
      coverageModel: beforeCoverageModel,
      refreshedRequirementIds: [],
    };
  }

  const corpus = await buildCanonicalUserEvidenceCorpus(trackId);
  const subset = subsetRequirementModel(requirementModel, new Set(refreshedRequirementIds));
  const assessedSubset = await assessRequirementCoverageWithLlm(subset, corpus);
  const hardenedSubset = applyCoverageQualityPolicy(subset, corpus, assessedSubset);
  const refreshedById = new Map(hardenedSubset.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const beforeById = new Map(beforeCoverageModel.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const mergedCoverage = requirementModel.requirements.map((requirement) => (
    refreshedById.get(requirement.id)
    || beforeById.get(requirement.id)
    || unknownCoverage(requirement.id, requirement.successBar)
  ));
  const mergedDraft: CoverageModel = {
    ...beforeCoverageModel,
    targetLabel: requirementModel.target.label,
    requirementModelVersion: requirementModel.version,
    requirementModelFingerprint: coverageRequirementFingerprint(requirementModel),
    userEvidenceFingerprint: corpus.fingerprint,
    coverage: mergedCoverage,
    evidenceItems: corpus.items,
    sourceInventory: corpus.sourceCounts,
    generatedAt: Date.now(),
  };
  const coverageModel = applyCoverageQualityPolicy(requirementModel, corpus, mergedDraft);

  const latestTrack = await storage.getCareerTrack(trackId) || track;
  const latestIntelligence = parseJsonObject(latestTrack.trackIntelligence);
  const latestRequirementModel = latestIntelligence.requirementModel as RequirementModel | undefined;
  if (
    retryAfterConcurrentRequirementChange
    && latestRequirementModel?.mode === "requirement_model"
    && coverageRequirementFingerprint(latestRequirementModel) !== coverageRequirementFingerprint(requirementModel)
  ) {
    return computeSelectiveCoverageRefresh(trackId, requestedRequirementIds, false);
  }

  const nextIntelligence = {
    ...latestIntelligence,
    requirementModel,
    coverageModel,
    coverageAssessedAt: coverageModel.generatedAt,
    lastSelectiveCoverageRefresh: {
      requirementIds: refreshedRequirementIds,
      evidenceFingerprint: corpus.fingerprint,
      generatedAt: coverageModel.generatedAt,
    },
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(
    trackId,
    { trackIntelligence: JSON.stringify(nextIntelligence) } as any,
  );

  return {
    track: updatedTrack || latestTrack,
    requirementModel,
    beforeCoverageModel,
    coverageModel,
    refreshedRequirementIds,
  };
}

const selectiveRefreshInFlight = new Map<number, Promise<SelectiveCoverageRefreshResult | null>>();

export async function refreshCoverageForRequirements(
  trackId: number,
  requirementIds: string[],
): Promise<SelectiveCoverageRefreshResult | null> {
  const active = selectiveRefreshInFlight.get(trackId);
  if (active) return active;
  const promise = computeSelectiveCoverageRefresh(trackId, requirementIds);
  selectiveRefreshInFlight.set(trackId, promise);
  try {
    return await promise;
  } finally {
    if (selectiveRefreshInFlight.get(trackId) === promise) selectiveRefreshInFlight.delete(trackId);
  }
}

export const selectiveCoverageRefreshInternals = {
  subsetRequirementModel,
  validCoverageModel,
  validRequirementModel,
};
