import type { CoverageModel } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type {
  DevelopmentMethod,
  DevelopmentPlanModel,
  DevelopmentWorkstream,
  RequirementDevelopmentDecision,
} from "./trackResearchDevelopmentPlan";

export const DEVELOPMENT_POLICY_VERSION = 1;

export type PolicyDevelopmentPlanModel = DevelopmentPlanModel & {
  policyVersion: number;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(compact).filter(Boolean)) {
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function mustVerifyRequirement(requirement: TargetRequirement, coverageState: string): boolean {
  if (coverageState === "proven") return false;
  if (requirement.confidence === "low") return true;
  // Eligibility can be a hard gate, a resolvable administrative issue, or an
  // employer-specific preference. Verify which it is before prescribing work.
  if (requirement.category === "eligibility") return true;
  // Credentials are often costly. Require high-confidence evidence that they
  // matter before creating a qualification plan.
  if (requirement.category === "credential" && requirement.confidence !== "high") return true;
  return false;
}

function verificationDecision(decision: RequirementDevelopmentDecision, requirement: TargetRequirement): RequirementDevelopmentDecision {
  return {
    ...decision,
    action: "verify",
    methods: ["research"],
    rationale: requirement.category === "eligibility"
      ? `${requirement.label} may be a formal gate, but Anchor must verify whether it applies to the relevant role families and whether it is resolvable before prescribing work.`
      : requirement.category === "credential"
        ? `${requirement.label} may require substantial time or money. Anchor must verify that it is genuinely material before recommending a qualification.`
        : `${requirement.label} is supported by low-confidence market evidence. Verify the requirement before investing in development.`,
    workstreamIds: [],
  };
}

function stripRequirements(workstream: DevelopmentWorkstream, ids: Set<string>): DevelopmentWorkstream | null {
  const requirementIds = workstream.requirementIds.filter((id) => !ids.has(id));
  if (!requirementIds.length) return null;
  return {
    ...workstream,
    requirementIds,
    modules: workstream.modules.map((module) => ({
      ...module,
      requirementIds: module.requirementIds.filter((id) => !ids.has(id)),
    })).filter((module) => module.requirementIds.length > 0),
    milestones: workstream.milestones.map((milestone) => ({
      ...milestone,
      requirementIds: milestone.requirementIds.filter((id) => !ids.has(id)),
    })).filter((milestone) => milestone.requirementIds.length > 0),
  };
}

function verificationWorkstream(requirements: TargetRequirement[], existing?: DevelopmentWorkstream): DevelopmentWorkstream {
  const ids = requirements.map((requirement) => requirement.id);
  const labels = requirements.map((requirement) => requirement.label);
  const roleFamilyIds = uniqueStrings(requirements.flatMap((requirement) => requirement.roleFamilyIds));
  const methods: DevelopmentMethod[] = ["research"];
  const id = existing?.id || "workstream-verify-requirements";
  return {
    id,
    key: existing?.key || "verify-requirements",
    title: "Verify uncertain requirements before investing",
    kind: "verification",
    purpose: "Confirm that low-confidence requirements and formal gates genuinely apply before Anchor creates costly or unnecessary development work.",
    outcome: "Each uncertain requirement is either validated with stronger market evidence, narrowed to the context where it applies, or removed from the development plan.",
    requirementIds: uniqueStrings([...(existing?.requirementIds || []), ...ids]),
    methods,
    modules: requirements.map((requirement, index) => ({
      id: `${id}-module-${index + 1}`,
      title: requirement.label,
      objective: `Verify whether ${requirement.label} is material for the relevant target roles and contexts.`,
      requirementIds: [requirement.id],
      concepts: [],
      resourceIds: [],
      practice: [],
      output: `A source-backed requirement decision for ${requirement.label}`,
      doneWhen: `At least two credible sources, including one direct employer or institutional source where available, confirm or disconfirm the requirement and its applicable context.`,
    }),
    milestones: [{
      id: `${id}-milestone-1`,
      title: "Resolve the uncertain requirement set",
      outcome: `A defensible requirement decision for ${labels.join(", ")}.`,
      doneWhen: "Every linked requirement has stronger evidence, explicit context, and a confirmed importance level before substantive development begins.",
      requirementIds: uniqueStrings([...(existing?.requirementIds || []), ...ids]),
      evidenceGenerated: requirements.map((requirement) => ({ type: "market_signal" as const, description: `Source-backed validation of ${requirement.label}` })),
      dependencyIds: [],
      sequence: 1,
    }],
    dependencyIds: [],
    roleFamilyIds,
    rationale: "Verification prevents low-confidence market assumptions from becoming expensive courses, credentials, or projects.",
  };
}

function qualityFor(plan: DevelopmentPlanModel, workstreams: DevelopmentWorkstream[], decisions: RequirementDevelopmentDecision[]) {
  const mapped = new Set(workstreams.flatMap((workstream) => workstream.requirementIds));
  const maintained = new Set(decisions.filter((decision) => decision.action === "maintain").map((decision) => decision.requirementId));
  const material = decisions.filter((decision) => decision.material).map((decision) => decision.requirementId);
  const materialMapped = material.filter((id) => mapped.has(id) || maintained.has(id));
  const orphanRequirementIds = material.filter((id) => !mapped.has(id) && !maintained.has(id));
  const useCounts = new Map<string, number>();
  for (const workstream of workstreams) for (const id of workstream.requirementIds) useCounts.set(id, (useCounts.get(id) || 0) + 1);
  const duplicateRequirementCount = [...useCounts.values()].filter((count) => count > 1).length;
  const materialCoverageRate = material.length ? Math.round((materialMapped.length / material.length) * 100) : 100;
  const caveats = [...plan.quality.caveats.filter((caveat) => !caveat.toLowerCase().includes("material requirement"))];
  if (orphanRequirementIds.length) caveats.push(`${orphanRequirementIds.length} material requirements are not yet mapped.`);
  if (duplicateRequirementCount) caveats.push(`${duplicateRequirementCount} requirements have multiple primary workstreams.`);

  return {
    status: materialCoverageRate === 100 && workstreams.length <= 7 ? "complete" as const : materialCoverageRate >= 85 ? "usable_with_caveats" as const : "provisional" as const,
    materialRequirementCount: material.length,
    materialRequirementsMapped: materialMapped.length,
    materialCoverageRate,
    workstreamCount: workstreams.length,
    duplicateRequirementCount,
    orphanRequirementIds,
    caveats,
  };
}

export function applyDevelopmentPlanPolicy(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  plan: DevelopmentPlanModel,
): PolicyDevelopmentPlanModel {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const coverageById = new Map(coverageModel.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const verifyRequirements = requirementModel.requirements.filter((requirement) => {
    const state = coverageById.get(requirement.id)?.state || "unknown";
    return mustVerifyRequirement(requirement, state);
  });
  const verifyIds = new Set(verifyRequirements.map((requirement) => requirement.id));

  if (!verifyIds.size) return { ...plan, policyVersion: DEVELOPMENT_POLICY_VERSION };

  const decisions = plan.decisions.map((decision) => {
    const requirement = requirementById.get(decision.requirementId);
    return requirement && verifyIds.has(requirement.id) ? verificationDecision(decision, requirement) : decision;
  });

  const existingVerification = plan.workstreams.find((workstream) => workstream.kind === "verification");
  const workstreams = plan.workstreams
    .filter((workstream) => workstream.id !== existingVerification?.id)
    .map((workstream) => stripRequirements(workstream, verifyIds))
    .filter(Boolean) as DevelopmentWorkstream[];
  workstreams.push(verificationWorkstream(verifyRequirements, existingVerification));

  const idsByRequirement = new Map<string, string[]>();
  for (const workstream of workstreams) {
    for (const requirementId of workstream.requirementIds) idsByRequirement.set(requirementId, [...(idsByRequirement.get(requirementId) || []), workstream.id]);
  }
  const linkedDecisions = decisions.map((decision) => ({ ...decision, workstreamIds: idsByRequirement.get(decision.requirementId) || [] }));
  const requirementCoverage = plan.requirementCoverage.map((item) => {
    if (!verifyIds.has(item.requirementId)) return { ...item, workstreamIds: idsByRequirement.get(item.requirementId) || item.workstreamIds };
    return {
      ...item,
      decision: "verify" as const,
      workstreamIds: idsByRequirement.get(item.requirementId) || [],
      reason: linkedDecisions.find((decision) => decision.requirementId === item.requirementId)?.rationale || item.reason,
    };
  });

  return {
    ...plan,
    policyVersion: DEVELOPMENT_POLICY_VERSION,
    decisions: linkedDecisions,
    workstreams,
    unresolvedRequirementIds: uniqueStrings([...plan.unresolvedRequirementIds, ...verifyIds]),
    requirementCoverage,
    quality: qualityFor(plan, workstreams, linkedDecisions),
    generatedAt: Date.now(),
  };
}
