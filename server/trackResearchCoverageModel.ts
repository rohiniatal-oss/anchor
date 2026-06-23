import type {
  RequirementCategory,
  RequirementGroupId,
  RequirementModel,
  TargetRequirement,
} from "./trackResearchRequirementModel";
import type { UserEvidenceCorpus, UserEvidenceItem } from "./trackResearchCoverageEvidence";

export const COVERAGE_MODEL_VERSION = 1;

export type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
export type CoverageConfidence = "high" | "medium" | "low";
export type CoverageSourceBasis = "llm" | "deterministic";

export type RequirementCoverage = {
  requirementId: string;
  status: CoverageStatus;
  confidence: CoverageConfidence;
  evidenceItemIds: string[];
  reason: string;
  successBarAssessment: string;
  evidenceStillNeeded: string[];
  sourceBasis: CoverageSourceBasis;
};

export type CoverageAssessmentPatch = {
  requirementId?: string;
  status?: CoverageStatus;
  confidence?: CoverageConfidence;
  evidenceItemIds?: string[];
  reason?: string;
  successBarAssessment?: string;
  evidenceStillNeeded?: string[];
};

export type CoverageSynthesis = {
  assessments?: CoverageAssessmentPatch[];
  qualityNotes?: string[];
};

export type CoverageModel = {
  mode: "coverage_model";
  version: number;
  targetLabel: string;
  requirementModelVersion: number;
  requirementModelFingerprint: string;
  userEvidenceFingerprint: string;
  coverage: RequirementCoverage[];
  evidenceItems: UserEvidenceItem[];
  sourceInventory: UserEvidenceCorpus["sourceCounts"];
  groups: Array<{
    id: RequirementGroupId;
    requirementIds: string[];
    counts: Record<CoverageStatus, number>;
  }>;
  quality: {
    status: "strong" | "usable" | "provisional";
    assessedRequirementCount: number;
    unknownRequirementCount: number;
    citedEvidenceCount: number;
    directEvidenceCount: number;
    assessmentCoverage: number;
    caveats: string[];
  };
  generatedAt: number;
};

const STATUS_VALUES: CoverageStatus[] = ["proven", "partially_proven", "unproven", "unknown", "below_bar"];
const CONFIDENCE_VALUES: CoverageConfidence[] = ["high", "medium", "low"];

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

function tokens(value: unknown): Set<string> {
  const ignored = new Set(["and", "the", "for", "with", "from", "into", "that", "this", "role", "work", "ability", "requirement"]);
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 3 && !ignored.has(token)));
}

function overlapScore(left: unknown, right: unknown): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function parseStatus(value: unknown, fallback: CoverageStatus): CoverageStatus {
  const normalized = normalize(value).replace(/\s+/g, "_") as CoverageStatus;
  return STATUS_VALUES.includes(normalized) ? normalized : fallback;
}

function parseConfidence(value: unknown, fallback: CoverageConfidence): CoverageConfidence {
  const normalized = normalize(value) as CoverageConfidence;
  return CONFIDENCE_VALUES.includes(normalized) ? normalized : fallback;
}

function strengthRank(item: UserEvidenceItem): number {
  if (item.strength === "verified") return 5;
  if (item.strength === "direct") return 4;
  if (item.strength === "declared") return 3;
  if (item.strength === "supporting") return 2;
  return 1;
}

function categoryAllowsEvidence(category: RequirementCategory, item: UserEvidenceItem): boolean {
  if (!item.usableForCoverage || item.strength === "planned") return false;
  if (category === "network") return item.sourceType === "relationship" || item.sourceType === "interaction";
  if (category === "access") return item.sourceType === "relationship" || item.sourceType === "interaction";
  if (category === "credential" || category === "eligibility") return item.sourceType === "cv" || item.sourceType === "profile_summary";
  if (category === "experience") return item.sourceType === "cv" || item.sourceType === "profile_summary" || item.sourceType === "win";
  if (category === "evidence") return item.sourceType === "learning_output" || item.sourceType === "proof_asset";
  if (category === "narrative") return ["cv", "profile_summary", "win", "learning_output", "proof_asset"].includes(item.sourceType);
  return ["cv", "profile_summary", "win", "learning_output", "completed_learning", "proof_asset"].includes(item.sourceType);
}

function categorySourceAvailable(category: RequirementCategory, corpus: UserEvidenceCorpus): boolean {
  const count = corpus.sourceCounts;
  if (category === "network" || category === "access") return count.relationship + count.interaction > 0;
  if (category === "evidence") return count.learning_output + count.proof_asset > 0;
  if (category === "credential" || category === "eligibility") return count.cv + count.profile_summary > 0;
  if (category === "experience") return count.cv + count.profile_summary + count.win > 0;
  return count.cv + count.profile_summary + count.win + count.learning_output + count.completed_learning + count.proof_asset > 0;
}

function accessEvidenceIsStrong(item: UserEvidenceItem): boolean {
  if (item.sourceType === "interaction") {
    const text = normalize(`${item.label} ${item.detail}`);
    return ["intro", "referral", "meeting"].some((term) => text.includes(term));
  }
  return item.sourceType === "relationship" && item.strength === "direct";
}

function canProve(requirement: TargetRequirement, evidence: UserEvidenceItem[]): boolean {
  const usable = evidence.filter((item) => categoryAllowsEvidence(requirement.category, item));
  if (!usable.length) return false;
  if (requirement.category === "evidence") return usable.some((item) => item.strength === "verified");
  if (requirement.category === "network") return usable.some((item) => item.strength === "direct" || item.strength === "verified");
  if (requirement.category === "access") return usable.some(accessEvidenceIsStrong);
  if (requirement.category === "credential" || requirement.category === "eligibility") {
    return usable.some((item) => item.sourceType === "cv" || item.sourceType === "profile_summary");
  }
  if (requirement.category === "experience") {
    return usable.some((item) => item.sourceType === "cv" || item.sourceType === "win");
  }
  if (requirement.category === "narrative") {
    return usable.some((item) => item.strength === "verified") || usable.length >= 2;
  }
  return usable.some((item) => item.strength === "verified")
    || usable.filter((item) => item.strength === "direct" || item.strength === "declared" || item.strength === "supporting").length >= 2;
}

function hasExplicitNegativeEvidence(items: UserEvidenceItem[]): boolean {
  const negativeTerms = ["needs improvement", "below the bar", "weak", "struggled", "could not", "failed", "negative feedback"];
  return items.some((item) => negativeTerms.some((term) => normalize(item.detail).includes(term)));
}

function requirementSearchText(requirement: TargetRequirement): string {
  return [requirement.label, ...requirement.aliases, requirement.definition, requirement.successBar].join(" ");
}

function evidenceScore(requirement: TargetRequirement, item: UserEvidenceItem): number {
  if (!categoryAllowsEvidence(requirement.category, item)) return 0;
  const overlap = overlapScore(requirementSearchText(requirement), `${item.label} ${item.detail}`);
  const sameCategoryBonus = requirement.category === "network" && ["relationship", "interaction"].includes(item.sourceType)
    ? 0.25
    : requirement.category === "access" && ["relationship", "interaction"].includes(item.sourceType)
      ? 0.22
      : requirement.category === "evidence" && ["learning_output", "proof_asset"].includes(item.sourceType)
        ? 0.22
        : requirement.category === "experience" && ["cv", "win"].includes(item.sourceType)
          ? 0.12
          : 0;
  return overlap + sameCategoryBonus + strengthRank(item) * 0.025;
}

function deterministicAssessment(requirement: TargetRequirement, corpus: UserEvidenceCorpus): RequirementCoverage {
  const candidates = corpus.items
    .map((item) => ({ item, score: evidenceScore(requirement, item) }))
    .filter((entry) => entry.score >= 0.3)
    .sort((left, right) => right.score - left.score || strengthRank(right.item) - strengthRank(left.item))
    .slice(0, 5)
    .map((entry) => entry.item);
  const sourceAvailable = categorySourceAvailable(requirement.category, corpus);
  const proven = canProve(requirement, candidates);
  const status: CoverageStatus = candidates.length ? (proven ? "proven" : "partially_proven") : sourceAvailable ? "unproven" : "unknown";
  const confidence: CoverageConfidence = status === "proven" && candidates.some((item) => item.strength === "verified" || item.strength === "direct")
    ? "high"
    : status === "unknown"
      ? "low"
      : "medium";
  return {
    requirementId: requirement.id,
    status,
    confidence,
    evidenceItemIds: candidates.map((item) => item.id),
    reason: candidates.length
      ? `Anchor found ${candidates.length} relevant evidence source${candidates.length === 1 ? "" : "s"}, but this deterministic pass is deliberately conservative.`
      : sourceAvailable
        ? "Anchor checked the available evidence sources but did not find a credible match for this requirement. This means not yet evidenced, not unable."
        : "Anchor does not yet have the right type of user evidence to assess this requirement.",
    successBarAssessment: proven
      ? `The available evidence appears consistent with the success bar: ${requirement.successBar}`
      : `The current evidence does not yet demonstrate the full success bar: ${requirement.successBar}`,
    evidenceStillNeeded: proven ? [] : [`Evidence that directly demonstrates: ${requirement.successBar}`],
    sourceBasis: "deterministic",
  };
}

function applyPatch(
  requirement: TargetRequirement,
  fallback: RequirementCoverage,
  patch: CoverageAssessmentPatch | undefined,
  corpus: UserEvidenceCorpus,
): RequirementCoverage {
  if (!patch) return fallback;
  const validItems = new Map(corpus.items.map((item) => [item.id, item]));
  const evidence = uniqueStrings(patch.evidenceItemIds || [])
    .map((id) => validItems.get(id))
    .filter((item): item is UserEvidenceItem => Boolean(item) && categoryAllowsEvidence(requirement.category, item));
  const sourceAvailable = categorySourceAvailable(requirement.category, corpus);
  let status = parseStatus(patch.status, fallback.status);
  if (status === "proven" && !canProve(requirement, evidence)) status = evidence.length ? "partially_proven" : sourceAvailable ? "unproven" : "unknown";
  if (status === "partially_proven" && !evidence.length) status = sourceAvailable ? "unproven" : "unknown";
  if (status === "unproven" && !sourceAvailable) status = "unknown";
  if (status === "below_bar" && !hasExplicitNegativeEvidence(evidence)) status = evidence.length ? "partially_proven" : sourceAvailable ? "unproven" : "unknown";

  let confidence = parseConfidence(patch.confidence, fallback.confidence);
  if (status === "unknown") confidence = "low";
  if (status === "proven" && !evidence.some((item) => item.strength === "verified" || item.strength === "direct")) confidence = "medium";

  return {
    requirementId: requirement.id,
    status,
    confidence,
    evidenceItemIds: evidence.map((item) => item.id),
    reason: compact(patch.reason) || fallback.reason,
    successBarAssessment: compact(patch.successBarAssessment) || fallback.successBarAssessment,
    evidenceStillNeeded: status === "proven" ? [] : uniqueStrings(patch.evidenceStillNeeded || fallback.evidenceStillNeeded).slice(0, 4),
    sourceBasis: "llm",
  };
}

function emptyCounts(): Record<CoverageStatus, number> {
  return { proven: 0, partially_proven: 0, unproven: 0, unknown: 0, below_bar: 0 };
}

function buildQuality(coverage: RequirementCoverage[], citedItems: UserEvidenceItem[], corpus: UserEvidenceCorpus, qualityNotes: string[]): CoverageModel["quality"] {
  const assessedRequirementCount = coverage.filter((item) => item.status !== "unknown").length;
  const unknownRequirementCount = coverage.filter((item) => item.status === "unknown").length;
  const assessmentCoverage = coverage.length ? Math.round((assessedRequirementCount / coverage.length) * 100) : 0;
  const directEvidenceCount = citedItems.filter((item) => item.strength === "verified" || item.strength === "direct").length;
  const caveats = uniqueStrings([...corpus.caveats, ...qualityNotes]);
  if (unknownRequirementCount > 0) caveats.push(`${unknownRequirementCount} requirement${unknownRequirementCount === 1 ? "" : "s"} cannot yet be assessed from the available user evidence.`);
  if (!citedItems.some((item) => item.strength === "verified")) caveats.push("No cited evidence has a verified output link, so proof and skill conclusions remain conservative.");
  const status: CoverageModel["quality"]["status"] = assessmentCoverage >= 75 && directEvidenceCount >= 3
    ? "strong"
    : assessmentCoverage >= 45
      ? "usable"
      : "provisional";
  return {
    status,
    assessedRequirementCount,
    unknownRequirementCount,
    citedEvidenceCount: citedItems.length,
    directEvidenceCount,
    assessmentCoverage,
    caveats: uniqueStrings(caveats),
  };
}

export function buildCoverageModel(
  requirementModel: RequirementModel,
  corpus: UserEvidenceCorpus,
  synthesis: CoverageSynthesis | null = null,
): CoverageModel {
  const patchByRequirement = new Map(
    (synthesis?.assessments || [])
      .filter((patch) => compact(patch.requirementId))
      .map((patch) => [compact(patch.requirementId), patch]),
  );

  const coverage = requirementModel.requirements.map((requirement) => {
    const fallback = deterministicAssessment(requirement, corpus);
    return applyPatch(requirement, fallback, patchByRequirement.get(requirement.id), corpus);
  });

  const citedIds = new Set(coverage.flatMap((item) => item.evidenceItemIds));
  const evidenceItems = corpus.items.filter((item) => citedIds.has(item.id));
  const groups = requirementModel.groups.map((group) => {
    const groupCoverage = coverage.filter((item) => group.requirementIds.includes(item.requirementId));
    const counts = emptyCounts();
    for (const item of groupCoverage) counts[item.status] += 1;
    return { id: group.id, requirementIds: group.requirementIds, counts };
  });

  return {
    mode: "coverage_model",
    version: COVERAGE_MODEL_VERSION,
    targetLabel: requirementModel.target.label,
    requirementModelVersion: requirementModel.version,
    requirementModelFingerprint: requirementModel.sourceFingerprint,
    userEvidenceFingerprint: corpus.fingerprint,
    coverage,
    evidenceItems,
    sourceInventory: corpus.sourceCounts,
    groups,
    quality: buildQuality(coverage, evidenceItems, corpus, synthesis?.qualityNotes || []),
    generatedAt: Date.now(),
  };
}
