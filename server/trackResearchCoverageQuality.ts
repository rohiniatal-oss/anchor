import { createHash } from "node:crypto";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { UserEvidenceCorpus, UserEvidenceItem } from "./trackResearchCoverageEvidence";
import type { CoverageModel, CoverageStatus, RequirementCoverage } from "./trackResearchCoverageModel";

export const COVERAGE_QUALITY_POLICY_VERSION = 2;

export type QualityCoverageModel = CoverageModel & {
  qualityPolicyVersion: number;
};

const GENERIC_TOKENS = new Set([
  "ability",
  "access",
  "and",
  "apply",
  "can",
  "capability",
  "current",
  "demonstrate",
  "evidence",
  "experience",
  "for",
  "from",
  "has",
  "knowledge",
  "output",
  "professional",
  "relevant",
  "requirement",
  "role",
  "skill",
  "target",
  "that",
  "the",
  "this",
  "with",
  "work",
]);

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(compact).filter(Boolean)) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

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

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * Fingerprint the exact requirement contract used by coverage assessment.
 * Market sources can stay unchanged while LLM refinement changes the category,
 * context, wording, or observable success bar; those changes must invalidate
 * cached coverage.
 */
export function coverageRequirementFingerprint(model: RequirementModel): string {
  return hash({
    version: model.version,
    requirements: [...model.requirements]
      .map((requirement) => ({
        id: requirement.id,
        key: requirement.key,
        label: requirement.label,
        definition: requirement.definition,
        group: requirement.group,
        category: requirement.category,
        importance: requirement.importance,
        scope: requirement.scope,
        roleFamilyIds: [...requirement.roleFamilyIds].sort(),
        successBar: requirement.successBar,
        confidence: requirement.confidence,
        context: {
          seniority: [...requirement.context.seniority].sort(),
          geographies: [...requirement.context.geographies].sort(),
          employerTypes: [...requirement.context.employerTypes].sort(),
          notes: [...requirement.context.notes].sort(),
        },
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function claimsFor(item: RequirementCoverage, model: CoverageModel): UserEvidenceItem[] {
  const ids = new Set(item.evidenceItemIds);
  return model.evidenceItems.filter((evidence) => ids.has(evidence.id));
}

function tokenSet(value: unknown): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token)),
  );
}

function overlapScore(left: unknown, right: unknown): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function requirementSearchText(requirement: TargetRequirement, model: RequirementModel): string {
  const roleTitles = requirement.roleFamilyIds
    .map((id) => model.roleFamilies.find((role) => role.id === id)?.title)
    .filter(Boolean);
  return [
    requirement.label,
    ...requirement.aliases,
    requirement.definition,
    requirement.successBar,
    model.target.label,
    ...roleTitles,
    ...requirement.context.employerTypes,
    ...requirement.context.geographies,
  ].join(" ");
}

function evidenceTopicallyRelevant(
  requirement: TargetRequirement,
  item: UserEvidenceItem,
  requirementModel: RequirementModel,
  corpus: UserEvidenceCorpus,
): boolean {
  const requirementText = requirementSearchText(requirement, requirementModel);
  const evidenceText = `${item.label} ${item.detail}`;
  const overlap = overlapScore(requirementText, evidenceText);
  if (overlap <= 0) return false;

  // Track linkage improves confidence that an item belongs in this target area,
  // but never substitutes for topical relevance to the specific requirement.
  const sameTrack = item.trackIds.includes(corpus.targetTrackId);
  const threshold = requirement.category === "network" || requirement.category === "access"
    ? 0.09
    : requirement.category === "credential" || requirement.category === "eligibility"
      ? 0.12
      : 0.1;
  return overlap + (sameTrack ? 0.04 : 0) >= threshold;
}

function distinctEntities(items: UserEvidenceItem[]): number {
  return new Set(items.map((item) => `${item.sourceEntityType}:${item.sourceEntityId ?? item.id}`)).size;
}

function distinctTypes(items: UserEvidenceItem[]): number {
  return new Set(items.map((item) => item.sourceType)).size;
}

function verifiedAppliedOutput(items: UserEvidenceItem[]): boolean {
  return items.some((item) => item.strength === "verified" && ["learning_output", "proof_asset"].includes(item.sourceType));
}

function appliedSignals(items: UserEvidenceItem[]): UserEvidenceItem[] {
  return items.filter((item) => item.usableForCoverage && ["win", "learning_output", "proof_asset", "completed_learning"].includes(item.sourceType));
}

function evidenceCanProve(requirement: TargetRequirement, items: UserEvidenceItem[]): boolean {
  if (requirement.category === "evidence") {
    return verifiedAppliedOutput(items);
  }
  if (requirement.category === "skill") {
    const applied = appliedSignals(items);
    return verifiedAppliedOutput(items)
      || (distinctEntities(applied) >= 2 && distinctTypes(applied) >= 2);
  }
  if (requirement.category === "knowledge") {
    const applied = appliedSignals(items);
    return verifiedAppliedOutput(items)
      || (applied.some((item) => item.sourceType === "completed_learning")
        && applied.some((item) => ["win", "learning_output", "proof_asset"].includes(item.sourceType))
        && distinctEntities(applied) >= 2);
  }
  if (requirement.category === "narrative") {
    return items.some((item) => item.strength === "verified")
      || (distinctEntities(items) >= 2 && distinctTypes(items) >= 2);
  }
  return true;
}

function corpusCanSupportAbsence(requirement: TargetRequirement, corpus: UserEvidenceCorpus): boolean {
  const usable = corpus.items.filter((item) => item.usableForCoverage && item.strength !== "planned");
  const byType = (...types: UserEvidenceItem["sourceType"][]) => usable.filter((item) => types.includes(item.sourceType));

  if (requirement.category === "network" || requirement.category === "access") {
    const relationships = byType("relationship", "interaction");
    return distinctEntities(relationships) >= 3;
  }
  if (requirement.category === "evidence") {
    return distinctEntities(byType("learning_output", "proof_asset")) >= 3;
  }
  if (requirement.category === "skill" || requirement.category === "knowledge") {
    const foundational = byType("cv", "profile_summary").length > 0;
    const applied = byType("win", "learning_output", "completed_learning", "proof_asset");
    return foundational && distinctEntities(applied) >= 3 && distinctTypes(applied) >= 2;
  }
  if (requirement.category === "narrative") {
    return byType("cv", "profile_summary").length > 0
      && distinctEntities(byType("win", "learning_output", "proof_asset")) >= 2;
  }
  if (["experience", "credential", "eligibility"].includes(requirement.category)) {
    return byType("cv", "profile_summary").length > 0;
  }
  return usable.length >= 4 && distinctTypes(usable) >= 2;
}

function qualityState(
  requirement: TargetRequirement,
  coverage: RequirementCoverage,
  evidence: UserEvidenceItem[],
  corpus: UserEvidenceCorpus,
): { status: CoverageStatus; confidence?: "high" | "medium" | "low"; reason?: string } {
  if (coverage.status === "proven" && !evidenceCanProve(requirement, evidence)) {
    return {
      status: evidence.length ? "partially_proven" : "unknown",
      confidence: evidence.length ? "medium" : "low",
      reason: evidence.length
        ? "Anchor found relevant evidence, but not a sufficiently applied or independently supported demonstration of the success bar."
        : "Anchor does not yet have enough topically relevant evidence to assess this requirement.",
    };
  }
  if (coverage.status === "partially_proven" && !evidence.length) {
    return {
      status: "unknown",
      confidence: "low",
      reason: "The cited evidence was not topically relevant enough to this specific requirement, so Anchor cannot assess it yet.",
    };
  }
  if (coverage.status === "unproven" && !corpusCanSupportAbsence(requirement, corpus)) {
    return {
      status: "unknown",
      confidence: "low",
      reason: "Anchor has not reviewed a sufficiently broad and relevant evidence set to call this requirement unproven. It remains unknown rather than a deficit.",
    };
  }
  return { status: coverage.status };
}

function emptyCounts(): Record<CoverageStatus, number> {
  return { proven: 0, partially_proven: 0, unproven: 0, unknown: 0, below_bar: 0 };
}

function recomputeModel(
  requirementModel: RequirementModel,
  corpus: UserEvidenceCorpus,
  model: CoverageModel,
  coverage: RequirementCoverage[],
  downgradeCount: number,
  removedEvidenceCount: number,
): QualityCoverageModel {
  const groups = requirementModel.groups.map((group) => {
    const groupCoverage = coverage.filter((item) => group.requirementIds.includes(item.requirementId));
    const counts = emptyCounts();
    for (const item of groupCoverage) counts[item.status] += 1;
    return { id: group.id, requirementIds: group.requirementIds, counts };
  });
  const citedIds = new Set(coverage.flatMap((item) => item.evidenceItemIds));
  const evidenceItems = corpus.items.filter((item) => citedIds.has(item.id));
  const assessedRequirementCount = coverage.filter((item) => item.status !== "unknown").length;
  const unknownRequirementCount = coverage.length - assessedRequirementCount;
  const assessmentCoverage = coverage.length ? Math.round((assessedRequirementCount / coverage.length) * 100) : 0;
  const directEvidenceCount = evidenceItems.filter((item) => item.strength === "verified" || item.strength === "direct").length;
  const caveats = [...model.quality.caveats];
  if (downgradeCount > 0) {
    caveats.push(`Anchor conservatively revised ${downgradeCount} coverage judgement${downgradeCount === 1 ? "" : "s"} because the evidence did not meet the category-specific proof or corpus standard.`);
  }
  if (removedEvidenceCount > 0) {
    caveats.push(`Anchor removed ${removedEvidenceCount} cited evidence item${removedEvidenceCount === 1 ? "" : "s"} that matched the broad track but not the specific requirement.`);
  }
  const status: CoverageModel["quality"]["status"] = assessmentCoverage >= 75 && directEvidenceCount >= 3
    ? "strong"
    : assessmentCoverage >= 45
      ? "usable"
      : "provisional";

  return {
    ...model,
    qualityPolicyVersion: COVERAGE_QUALITY_POLICY_VERSION,
    requirementModelFingerprint: coverageRequirementFingerprint(requirementModel),
    coverage,
    evidenceItems,
    groups,
    quality: {
      status,
      assessedRequirementCount,
      unknownRequirementCount,
      citedEvidenceCount: evidenceItems.length,
      directEvidenceCount,
      assessmentCoverage,
      caveats: uniqueStrings(caveats),
    },
  };
}

export function applyCoverageQualityPolicy(
  requirementModel: RequirementModel,
  corpus: UserEvidenceCorpus,
  model: CoverageModel,
): QualityCoverageModel {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  let downgradeCount = 0;
  let removedEvidenceCount = 0;
  const coverage = model.coverage.map((item) => {
    const requirement = requirementById.get(item.requirementId);
    if (!requirement) return item;
    const allEvidence = claimsFor(item, model);
    const evidence = allEvidence.filter((candidate) => evidenceTopicallyRelevant(requirement, candidate, requirementModel, corpus));
    removedEvidenceCount += allEvidence.length - evidence.length;
    const decision = qualityState(requirement, item, evidence, corpus);
    const evidenceChanged = evidence.length !== allEvidence.length;
    if (decision.status === item.status && !evidenceChanged) return item;
    if (decision.status !== item.status) downgradeCount += 1;
    return {
      ...item,
      status: decision.status,
      confidence: decision.confidence || item.confidence,
      evidenceItemIds: evidence.map((candidate) => candidate.id),
      reason: decision.reason || item.reason,
      successBarAssessment: decision.status === "unknown"
        ? `Coverage cannot yet be assessed reliably against: ${requirement.successBar}`
        : item.successBarAssessment,
      evidenceStillNeeded: decision.status === "proven"
        ? []
        : item.evidenceStillNeeded.length
          ? item.evidenceStillNeeded
          : [`Evidence that directly demonstrates: ${requirement.successBar}`],
    };
  });
  return recomputeModel(requirementModel, corpus, model, coverage, downgradeCount, removedEvidenceCount);
}

export const coverageQualityInternals = {
  evidenceTopicallyRelevant,
  overlapScore,
};
