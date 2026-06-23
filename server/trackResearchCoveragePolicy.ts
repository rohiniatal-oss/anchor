import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type {
  CoverageModel,
  CoverageState,
  RawUserEvidenceSource,
  RequirementCoverage,
  UserEvidenceClaim,
} from "./trackResearchCoverageModel";

export const COVERAGE_POLICY_VERSION = 1;

export type PolicyCoverageModel = CoverageModel & {
  policyVersion: number;
};

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function distinctClaimSources(claims: UserEvidenceClaim[]): number {
  return new Set(claims.map((claim) => `${claim.sourceEntityType}:${claim.sourceEntityId ?? claim.sourceTitle}`)).size;
}

function claimsForCoverage(coverage: RequirementCoverage, model: CoverageModel): UserEvidenceClaim[] {
  const ids = new Set(coverage.evidenceClaimIds);
  return model.evidenceClaims.filter((claim) => ids.has(claim.id));
}

function hasNegativeFeedback(claims: UserEvidenceClaim[]): boolean {
  return claims.some((claim) => claim.type === "feedback" && [
    "below",
    "weak",
    "lacked",
    "missing",
    "not enough",
    "needs improvement",
    "did not meet",
  ].some((term) => normalize(claim.claim).includes(term)));
}

function evidenceCanProve(requirement: TargetRequirement, claims: UserEvidenceClaim[]): boolean {
  const direct = claims.filter((claim) => claim.strength === "direct");
  const relevant = claims.filter((claim) => claim.strength === "direct" || claim.strength === "supporting");

  switch (requirement.category) {
    case "experience":
      return direct.some((claim) => claim.type === "experience" || claim.type === "self_report");
    case "credential":
    case "eligibility":
      return direct.some((claim) => claim.type === "credential" || claim.type === "self_report");
    case "evidence":
      return direct.some((claim) => claim.type === "output");
    case "network":
      return direct.some((claim) => claim.type === "relationship");
    case "access":
      // Reaching a live interview is itself strong evidence that at least one
      // hiring route exists, even when it is not evidence of a professional network.
      return direct.some((claim) => claim.type === "relationship")
        || claims.some((claim) => claim.type === "market_signal" && claim.sourceEntityType === "job");
    case "skill":
      return direct.some((claim) => claim.type === "output" || claim.type === "feedback");
    case "knowledge":
      return direct.some((claim) => claim.type === "output" || claim.type === "feedback")
        || distinctClaimSources(relevant) >= 2;
    case "narrative":
      return direct.some((claim) => claim.type === "feedback")
        || claims.filter((claim) => claim.type === "market_signal").length >= 2;
    default:
      return false;
  }
}

function evidenceBaseCanAssess(requirement: TargetRequirement, sources: RawUserEvidenceSource[]): boolean {
  const has = (...kinds: RawUserEvidenceSource["kind"][]) => sources.some((source) => kinds.includes(source.kind));

  switch (requirement.category) {
    case "experience":
    case "credential":
    case "eligibility":
      return has("cv", "feedback");
    case "evidence":
      return has("output", "proof_asset", "learning", "feedback");
    case "network":
      return has("relationship");
    case "access":
      return has("relationship", "market_signal");
    case "skill":
    case "knowledge":
      return has("cv", "output", "learning", "proof_asset", "win", "feedback");
    case "narrative":
      return has("cv", "market_signal", "feedback");
    default:
      return sources.length > 0;
  }
}

function policyState(
  requirement: TargetRequirement,
  coverage: RequirementCoverage,
  claims: UserEvidenceClaim[],
  sources: RawUserEvidenceSource[],
): { state: CoverageState; reason?: string; confidence?: "high" | "medium" | "low" } {
  if (coverage.state === "proven" && !evidenceCanProve(requirement, claims)) {
    return {
      state: claims.length ? "partially_proven" : "unknown",
      reason: claims.length
        ? "Anchor found relevant evidence, but this requirement needs a stronger form of proof before it can be marked evidenced."
        : "Anchor does not have enough evidence to assess this requirement yet.",
      confidence: claims.length ? "medium" : "low",
    };
  }

  if (coverage.state === "below_bar" && !hasNegativeFeedback(claims)) {
    return {
      state: claims.length ? "partially_proven" : "unknown",
      reason: claims.length
        ? "Relevant evidence exists, but Anchor has no explicit negative feedback supporting a below-bar judgement."
        : "Anchor has no explicit feedback that would justify a below-bar judgement.",
      confidence: "low",
    };
  }

  if (coverage.state === "unproven" && !evidenceBaseCanAssess(requirement, sources)) {
    return {
      state: "unknown",
      reason: "Anchor does not yet have the right type of evidence to assess this requirement fairly.",
      confidence: "low",
    };
  }

  return { state: coverage.state };
}

function importanceRank(value: TargetRequirement["importance"]): number {
  return value === "essential" ? 0 : value === "important" ? 1 : value === "differentiator" ? 2 : 3;
}

function summarize(requirementModel: RequirementModel, coverage: RequirementCoverage[]): CoverageModel["summary"] {
  const counts: Record<CoverageState, number> = {
    proven: 0,
    partially_proven: 0,
    unproven: 0,
    unknown: 0,
    below_bar: 0,
  };
  for (const item of coverage) counts[item.state] += 1;

  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const core = coverage.filter((item) => {
    const importance = requirementById.get(item.requirementId)?.importance;
    return importance === "essential" || importance === "important";
  });
  const points = core.reduce((sum, item) => sum + (item.state === "proven" ? 1 : item.state === "partially_proven" ? 0.5 : 0), 0);
  const sorted = [...coverage].sort((left, right) => importanceRank(requirementById.get(left.requirementId)?.importance || "contextual") - importanceRank(requirementById.get(right.requirementId)?.importance || "contextual"));

  return {
    counts,
    coreRequirementCount: core.length,
    coreCoverageRate: core.length ? Math.round((points / core.length) * 100) : 0,
    provenRequirementIds: sorted.filter((item) => item.state === "proven").map((item) => item.requirementId).slice(0, 8),
    needsEvidenceRequirementIds: sorted.filter((item) => ["partially_proven", "unproven", "below_bar"].includes(item.state)).map((item) => item.requirementId).slice(0, 10),
    unknownRequirementIds: sorted.filter((item) => item.state === "unknown").map((item) => item.requirementId).slice(0, 10),
  };
}

export function applyCoveragePolicy(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  sources: RawUserEvidenceSource[],
): PolicyCoverageModel {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  let downgradeCount = 0;

  const coverage = coverageModel.coverage.map((item) => {
    const requirement = requirementById.get(item.requirementId);
    if (!requirement) return item;
    const claims = claimsForCoverage(item, coverageModel);
    const policy = policyState(requirement, item, claims, sources);
    if (policy.state === item.state) return item;
    downgradeCount += 1;
    return {
      ...item,
      state: policy.state,
      reason: policy.reason || item.reason,
      confidence: policy.confidence || item.confidence,
      missingEvidence: policy.state === "proven" ? "" : item.missingEvidence || requirement.successBar,
    };
  });

  const policyCaveat = downgradeCount > 0
    ? [`Anchor conservatively downgraded ${downgradeCount} coverage judgement${downgradeCount === 1 ? "" : "s"} because the available evidence type did not meet the category-specific proof standard.`]
    : [];

  return {
    ...coverageModel,
    policyVersion: COVERAGE_POLICY_VERSION,
    coverage,
    summary: summarize(requirementModel, coverage),
    evidenceQuality: {
      ...coverageModel.evidenceQuality,
      caveats: [...new Set([...coverageModel.evidenceQuality.caveats, ...policyCaveat])],
    },
  };
}
