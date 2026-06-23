import { createHash } from "node:crypto";
import type { CoverageModel } from "./trackResearchCoverageModel";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fingerprint every coverage field that can change plan decisions, verification
 * activities, quality caveats, or user-facing explanations.
 */
export function developmentCoverageFingerprint(coverageModel: CoverageModel): string {
  const policyAware = coverageModel as CoverageModel & { qualityPolicyVersion?: number };
  return createHash("sha256")
    .update(stableJson({
      version: coverageModel.version,
      qualityPolicyVersion: policyAware.qualityPolicyVersion ?? null,
      requirementModelVersion: coverageModel.requirementModelVersion,
      requirementModelFingerprint: coverageModel.requirementModelFingerprint,
      userEvidenceFingerprint: coverageModel.userEvidenceFingerprint,
      coverage: [...coverageModel.coverage]
        .map((coverage) => ({
          requirementId: coverage.requirementId,
          status: coverage.status,
          confidence: coverage.confidence,
          evidenceItemIds: [...coverage.evidenceItemIds].sort(),
          reason: coverage.reason,
          successBarAssessment: coverage.successBarAssessment,
          evidenceStillNeeded: [...coverage.evidenceStillNeeded].sort(),
          sourceBasis: coverage.sourceBasis,
        }))
        .sort((left, right) => left.requirementId.localeCompare(right.requirementId)),
      quality: coverageModel.quality,
      sourceInventory: coverageModel.sourceInventory,
      groups: coverageModel.groups,
    }))
    .digest("hex");
}
