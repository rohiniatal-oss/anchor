import { createHash } from "node:crypto";
import type { CoverageModel, CoverageStatus, RequirementCoverage } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";

export const DEVELOPMENT_PLAN_VERSION = 1;

export type DevelopmentAction = "maintain" | "verify" | "demonstrate" | "strengthen" | "build";
export type DevelopmentMethod =
  | "learn"
  | "practice"
  | "gain_experience"
  | "produce_evidence"
  | "build_relationships"
  | "pursue_opportunities"
  | "position"
  | "verify"
  | "credential";
export type DevelopmentWorkstreamKind = "shared" | "route_specific" | "verification";
export type DevelopmentModuleKind = "syllabus" | "practice" | "project" | "proof" | "network" | "positioning" | "verification" | "credential";
export type EvidenceOutputType = "knowledge" | "skill" | "experience" | "output" | "relationship" | "credential" | "market_signal" | "positioning" | "other";

export type RequirementDevelopmentDecision = {
  requirementId: string;
  coverageStatus: CoverageStatus;
  action: DevelopmentAction;
  methods: DevelopmentMethod[];
  rationale: string;
  material: boolean;
  routeSpecific: boolean;
  primaryWorkstreamId: string | null;
};

export type DevelopmentResource = {
  id: string;
  title: string;
  type: "book" | "course" | "report" | "framework" | "article" | "dataset" | "community" | "other";
  url: string;
  publisher: string;
  selectionReason: string;
  requirementIds: string[];
  authority: "primary" | "canonical" | "credible" | "supporting";
  freshness: "current" | "durable" | "unknown";
  checkedAt: number;
  verifiedBy: "web_search" | "existing_research";
};

export type DevelopmentModule = {
  id: string;
  kind: DevelopmentModuleKind;
  title: string;
  objective: string;
  requirementIds: string[];
  concepts: string[];
  practice: string[];
  output: string;
  doneWhen: string;
  resourceIds: string[];
};

export type DevelopmentMilestone = {
  id: string;
  key: string;
  title: string;
  outcome: string;
  doneWhen: string;
  primaryRequirementIds: string[];
  supportedRequirementIds: string[];
  evidenceGenerated: Array<{
    type: EvidenceOutputType;
    description: string;
  }>;
  dependencyIds: string[];
  sequence: number;
};

export type DevelopmentWorkstream = {
  id: string;
  key: string;
  title: string;
  kind: DevelopmentWorkstreamKind;
  purpose: string;
  outcome: string;
  primaryRequirementIds: string[];
  supportedRequirementIds: string[];
  methods: DevelopmentMethod[];
  modules: DevelopmentModule[];
  milestones: DevelopmentMilestone[];
  dependencyIds: string[];
  roleFamilyIds: string[];
  canRunInParallel: boolean;
  rationale: string;
};

export type DevelopmentPlanCoverageDecision = {
  requirementId: string;
  disposition: "maintain" | "verify" | "planned_shared" | "planned_route" | "optional" | "deferred";
  workstreamIds: string[];
  reason: string;
};

export type DevelopmentResourceSet = {
  status: "not_generated" | "ready" | "partial" | "unavailable";
  resources: DevelopmentResource[];
  checkedAt: number | null;
  refreshAfter: number | null;
  sourceFingerprint: string;
  caveats: string[];
};

export type DevelopmentPlanModel = {
  mode: "development_plan_model";
  version: number;
  targetLabel: string;
  requirementModelVersion: number;
  requirementModelFingerprint: string;
  coverageModelVersion: number;
  coverageModelFingerprint: string;
  sourceFingerprint: string;
  objective: string;
  sequencingPrinciple: string;
  generationMethod: "deterministic" | "llm_guarded";
  decisions: RequirementDevelopmentDecision[];
  workstreams: DevelopmentWorkstream[];
  maintainedRequirementIds: string[];
  unresolvedRequirementIds: string[];
  coverageDecisions: DevelopmentPlanCoverageDecision[];
  resourceSet: DevelopmentResourceSet;
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    materialRequirementCount: number;
    materialRequirementsAccountedFor: number;
    materialCoverageRate: number;
    sharedWorkstreamCount: number;
    routeModuleCount: number;
    duplicatePrimaryRequirementIds: string[];
    orphanMaterialRequirementIds: string[];
    invalidDependencyCount: number;
    caveats: string[];
  };
  generatedAt: number;
};

export type DevelopmentPlanCandidate = {
  key: string;
  title: string;
  kind: DevelopmentWorkstreamKind;
  purpose: string;
  outcome: string;
  primaryRequirementIds: string[];
  supportedRequirementIds: string[];
  methods: DevelopmentMethod[];
  modules: DevelopmentModule[];
  milestones: DevelopmentMilestone[];
  dependencyKeys: string[];
  roleFamilyIds: string[];
  rationale: string;
};

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

function slug(value: unknown): string {
  return normalize(value).replace(/\s+/g, "-").slice(0, 80) || "development";
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

function shortHash(value: unknown): string {
  return hash(value).slice(0, 16);
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

function sortedUnique(values: string[]): string[] {
  return uniqueStrings(values).sort((left, right) => left.localeCompare(right));
}

function isMaterial(requirement: TargetRequirement): boolean {
  return requirement.importance === "essential" || requirement.importance === "important";
}

function isFormalGate(requirement: TargetRequirement): boolean {
  return requirement.category === "eligibility"
    || (requirement.category === "credential" && requirement.importance === "essential" && requirement.confidence === "high");
}

function actionFor(requirement: TargetRequirement, coverage: RequirementCoverage): DevelopmentAction {
  if (coverage.status === "proven") return "maintain";
  if (coverage.status === "unknown") return "verify";
  if (requirement.category === "eligibility") return "verify";
  if (requirement.category === "credential" && !isFormalGate(requirement)) return "verify";

  if (coverage.status === "below_bar") return "strengthen";

  if (coverage.status === "partially_proven") {
    if (requirement.category === "evidence" || requirement.category === "narrative") return "demonstrate";
    return "strengthen";
  }

  if (requirement.category === "evidence" || requirement.category === "narrative") return "demonstrate";
  return "build";
}

function methodsFor(requirement: TargetRequirement, action: DevelopmentAction): DevelopmentMethod[] {
  if (action === "maintain") return [];
  if (action === "verify") return ["verify"];

  switch (requirement.category) {
    case "knowledge":
      return action === "demonstrate" ? ["produce_evidence"] : ["learn", "practice", "produce_evidence"];
    case "skill":
      return ["practice", "produce_evidence"];
    case "experience":
      return ["gain_experience", "produce_evidence"];
    case "evidence":
      return ["produce_evidence"];
    case "network":
      return ["build_relationships"];
    case "access":
      return ["build_relationships", "pursue_opportunities"];
    case "narrative":
      return ["position", "produce_evidence"];
    case "credential":
      return ["credential"];
    case "eligibility":
      return ["verify"];
    default:
      return ["verify"];
  }
}

function rationaleFor(requirement: TargetRequirement, coverage: RequirementCoverage, action: DevelopmentAction): string {
  if (action === "maintain") {
    return `${requirement.label} already meets the current success bar. Preserve and reuse the existing evidence instead of creating redundant work.`;
  }
  if (action === "verify") {
    if (requirement.category === "credential" || requirement.category === "eligibility") {
      return `${requirement.label} may be costly, formal, or context-specific. Verify that it genuinely applies before investing in it.`;
    }
    return `${requirement.label} cannot yet be assessed fairly from the available evidence. Resolve the uncertainty before prescribing substantial development.`;
  }
  if (action === "demonstrate") {
    return `${requirement.label} is primarily an evidence problem. Create or surface proof against the stated success bar rather than assuming the underlying capability is absent.`;
  }
  if (action === "strengthen") {
    return `${requirement.label} has relevant evidence but does not yet meet the target bar consistently. Strengthen the asset and its proof.`;
  }
  return `${requirement.label} is material to the target and current coverage indicates that the underlying asset needs to be built.`;
}

function decisionFor(requirement: TargetRequirement, coverage: RequirementCoverage): RequirementDevelopmentDecision {
  const action = actionFor(requirement, coverage);
  return {
    requirementId: requirement.id,
    coverageStatus: coverage.status,
    action,
    methods: methodsFor(requirement, action),
    rationale: rationaleFor(requirement, coverage, action),
    material: isMaterial(requirement),
    routeSpecific: requirement.scope === "role_specific",
    primaryWorkstreamId: null,
  };
}

function clusterKey(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): string {
  if (decision.action === "verify") return "verification";
  if (requirement.scope === "role_specific" && requirement.roleFamilyIds.length) {
    return `route:${sortedUnique(requirement.roleFamilyIds).join("+")}`;
  }
  if (requirement.category === "knowledge" || requirement.category === "skill") return "capability-core";
  if (requirement.category === "experience" || requirement.category === "evidence") return "experience-and-proof";
  if (requirement.category === "network" || requirement.category === "access") return "market-access";
  if (requirement.category === "narrative") return "positioning";
  if (requirement.category === "credential" || requirement.category === "eligibility") return "formal-gates";
  return "verification";
}

function clusterTemplate(key: string): Omit<DevelopmentPlanCandidate, "primaryRequirementIds" | "supportedRequirementIds" | "modules" | "milestones" | "dependencyKeys" | "roleFamilyIds"> {
  if (key.startsWith("route:")) {
    return {
      key,
      title: "Build the role-specific requirements",
      kind: "route_specific",
      purpose: "Develop requirements that apply only to a particular role family without inflating the shared core plan.",
      outcome: "The route-specific success bars are met when that role family becomes the immediate path.",
      methods: ["learn", "practice", "gain_experience", "produce_evidence", "build_relationships", "pursue_opportunities"],
      rationale: "Role-specific requirements remain modular so the shared plan stays reusable and manageable.",
    };
  }

  const templates: Record<string, Omit<DevelopmentPlanCandidate, "primaryRequirementIds" | "supportedRequirementIds" | "modules" | "milestones" | "dependencyKeys" | "roleFamilyIds">> = {
    verification: {
      key,
      title: "Resolve the important unknowns",
      kind: "verification",
      purpose: "Gather enough evidence to distinguish a real development need from missing information.",
      outcome: "Each linked requirement can be assessed as proven, partially proven, unproven, or below bar.",
      methods: ["verify"],
      rationale: "Unknown coverage should create a bounded verification step, not an assumed weakness or a large development commitment.",
    },
    "capability-core": {
      key,
      title: "Build and apply the core capability",
      kind: "shared",
      purpose: "Develop the knowledge and skills repeatedly required across the target role families.",
      outcome: "Core concepts and methods can be applied to realistic target-role problems and demonstrated through inspectable outputs.",
      methods: ["learn", "practice", "produce_evidence"],
      rationale: "Knowledge and skill are most efficient when learned, practised, and evidenced together rather than through separate passive tracks.",
    },
    "experience-and-proof": {
      key,
      title: "Create credible experience and proof",
      kind: "shared",
      purpose: "Turn capability into relevant experience and market-readable evidence.",
      outcome: "A compact portfolio demonstrates the material requirements that are currently under-evidenced.",
      methods: ["gain_experience", "produce_evidence"],
      rationale: "Projects and outputs can improve experience and proof coverage simultaneously when they are assessed against explicit success bars.",
    },
    "market-access": {
      key,
      title: "Build relationships and market access",
      kind: "shared",
      purpose: "Develop practitioner insight, warm pathways, and credible entry routes into the target market.",
      outcome: "Relevant relationships and live opportunity routes are established and evidenced.",
      methods: ["build_relationships", "pursue_opportunities"],
      rationale: "Networking and opportunity pursuit should run in parallel with capability development rather than waiting until learning is complete.",
    },
    positioning: {
      key,
      title: "Build evidence-backed positioning",
      kind: "shared",
      purpose: "Translate existing and newly created evidence into a coherent target-specific narrative.",
      outcome: "The target story is consistent across CV, outreach, conversations, applications, and interviews.",
      methods: ["position", "produce_evidence"],
      rationale: "Positioning should package real evidence; it should not substitute for capability or proof.",
    },
    "formal-gates": {
      key,
      title: "Resolve the confirmed formal gates",
      kind: "shared",
      purpose: "Satisfy only the credentials or formal conditions that the market evidence confirms are genuinely material.",
      outcome: "Each confirmed formal gate is satisfied or has a credible accepted alternative.",
      methods: ["credential"],
      rationale: "Credentials and eligibility can be expensive or binary, so they remain separate from general capability development.",
    },
  };

  return templates[key] || templates.verification;
}

function moduleKindFor(requirement: TargetRequirement, action: DevelopmentAction): DevelopmentModuleKind {
  if (action === "verify") return "verification";
  if (requirement.category === "knowledge") return "syllabus";
  if (requirement.category === "skill") return "practice";
  if (requirement.category === "experience") return "project";
  if (requirement.category === "evidence") return "proof";
  if (requirement.category === "network" || requirement.category === "access") return "network";
  if (requirement.category === "narrative") return "positioning";
  return "credential";
}

function fallbackModule(requirement: TargetRequirement, decision: RequirementDevelopmentDecision, workstreamId: string): DevelopmentModule {
  const kind = moduleKindFor(requirement, decision.action);
  const practice = kind === "syllabus" || kind === "practice"
    ? [`Apply ${requirement.label} to a realistic target-role case and compare the result with the documented success bar.`]
    : kind === "project"
      ? [`Use a real, simulated, volunteer, or adjacent-work project to practise ${requirement.label} in a relevant context.`]
      : kind === "network"
        ? [`Use structured practitioner and hiring-market interactions to build or validate ${requirement.label}.`]
        : [];
  const output = kind === "verification"
    ? `An evidence-backed coverage decision for ${requirement.label}`
    : kind === "network"
      ? `Documented relationships or access signals relevant to ${requirement.label}`
      : kind === "credential"
        ? `Verified evidence that ${requirement.label} is satisfied or not required`
        : `An inspectable artifact or outcome demonstrating ${requirement.label}`;

  return {
    id: `${workstreamId}-module-${shortHash(requirement.id)}`,
    kind,
    title: requirement.label,
    objective: decision.action === "verify" ? `Determine whether current evidence meets: ${requirement.successBar}` : requirement.successBar,
    requirementIds: [requirement.id],
    concepts: kind === "syllabus" || kind === "practice" ? uniqueStrings([requirement.definition, ...requirement.aliases]).slice(0, 8) : [],
    practice,
    output,
    doneWhen: decision.action === "verify"
      ? `Anchor has enough relevant evidence to assign a non-unknown coverage status against ${requirement.successBar}`
      : requirement.successBar,
    resourceIds: [],
  };
}

function evidenceTypeFor(requirement: TargetRequirement, action: DevelopmentAction): EvidenceOutputType {
  if (action === "verify") return "other";
  if (requirement.category === "knowledge") return "knowledge";
  if (requirement.category === "skill") return "skill";
  if (requirement.category === "experience") return "experience";
  if (requirement.category === "evidence") return "output";
  if (requirement.category === "network") return "relationship";
  if (requirement.category === "access") return "market_signal";
  if (requirement.category === "narrative") return "positioning";
  if (requirement.category === "credential" || requirement.category === "eligibility") return "credential";
  return "other";
}

function fallbackMilestone(
  candidate: Pick<DevelopmentPlanCandidate, "key" | "title" | "kind" | "outcome">,
  requirements: TargetRequirement[],
  decisions: Map<string, RequirementDevelopmentDecision>,
  sequence: number,
): DevelopmentMilestone {
  const primaryRequirementIds = requirements.map((requirement) => requirement.id);
  const successBars = uniqueStrings(requirements.map((requirement) => requirement.successBar));
  const key = `${candidate.key}-outcome`;
  return {
    id: `milestone-${shortHash({ key, primaryRequirementIds })}`,
    key,
    title: candidate.kind === "verification" ? "Resolve the evidence unknowns" : `Deliver ${candidate.title.toLowerCase()}`,
    outcome: candidate.outcome,
    doneWhen: successBars.length <= 3
      ? successBars.join("; ")
      : `The linked requirements meet their documented success bars: ${requirements.slice(0, 5).map((requirement) => requirement.label).join(", ")}.`,
    primaryRequirementIds,
    supportedRequirementIds: [],
    evidenceGenerated: requirements.map((requirement) => ({
      type: evidenceTypeFor(requirement, decisions.get(requirement.id)?.action || "build"),
      description: decisions.get(requirement.id)?.action === "verify"
        ? `Evidence sufficient to assess ${requirement.label}`
        : `Evidence against the success bar for ${requirement.label}`,
    })),
    dependencyIds: [],
    sequence,
  };
}

function buildCandidateWorkstreams(
  requirementModel: RequirementModel,
  decisions: RequirementDevelopmentDecision[],
): DevelopmentPlanCandidate[] {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const decisionById = new Map(decisions.map((decision) => [decision.requirementId, decision]));
  const buckets = new Map<string, string[]>();

  for (const decision of decisions) {
    const requirement = requirementById.get(decision.requirementId);
    if (!requirement || decision.action === "maintain") continue;
    if (!decision.material && requirement.importance === "contextual" && ["unknown", "unproven"].includes(decision.coverageStatus)) continue;
    const key = clusterKey(requirement, decision);
    buckets.set(key, [...(buckets.get(key) || []), requirement.id]);
  }

  return [...buckets.entries()].map(([key, requirementIds], index) => {
    const requirements = requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
    const template = clusterTemplate(key);
    const methods = uniqueStrings(requirements.flatMap((requirement) => decisionById.get(requirement.id)?.methods || [])) as DevelopmentMethod[];
    const workstreamId = `workstream-${shortHash({ key, requirementIds: sortedUnique(requirementIds) })}`;
    const candidate: DevelopmentPlanCandidate = {
      ...template,
      primaryRequirementIds: requirementIds,
      supportedRequirementIds: [],
      methods: methods.length ? methods : template.methods,
      modules: requirements.map((requirement) => fallbackModule(requirement, decisionById.get(requirement.id)!, workstreamId)),
      milestones: [],
      dependencyKeys: [],
      roleFamilyIds: sortedUnique(requirements.flatMap((requirement) => requirement.roleFamilyIds)),
    };
    candidate.milestones = [fallbackMilestone(candidate, requirements, decisionById, index + 1)];
    return candidate;
  });
}

function workstreamId(candidate: Pick<DevelopmentPlanCandidate, "kind" | "primaryRequirementIds">): string {
  return `workstream-${shortHash({ kind: candidate.kind, primaryRequirementIds: sortedUnique(candidate.primaryRequirementIds) })}`;
}

function acyclicDependencies(workstreams: DevelopmentWorkstream[]): { workstreams: DevelopmentWorkstream[]; invalidDependencyCount: number } {
  const ids = new Set(workstreams.map((workstream) => workstream.id));
  let invalidDependencyCount = 0;
  const graph = new Map<string, string[]>();
  for (const workstream of workstreams) {
    const valid = uniqueStrings(workstream.dependencyIds)
      .filter((id) => {
        const okay = ids.has(id) && id !== workstream.id;
        if (!okay) invalidDependencyCount += 1;
        return okay;
      });
    graph.set(workstream.id, valid);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const safeEdges = new Map<string, string[]>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visiting.add(id);
    const safe: string[] = [];
    for (const dependency of graph.get(id) || []) {
      if (visiting.has(dependency)) {
        invalidDependencyCount += 1;
        continue;
      }
      visit(dependency);
      safe.push(dependency);
    }
    visiting.delete(id);
    visited.add(id);
    safeEdges.set(id, safe);
  };

  for (const id of ids) visit(id);

  return {
    workstreams: workstreams.map((workstream) => {
      const dependencyIds = safeEdges.get(workstream.id) || [];
      return { ...workstream, dependencyIds, canRunInParallel: dependencyIds.length === 0 };
    }),
    invalidDependencyCount,
  };
}

function qualityFor(
  requirementModel: RequirementModel,
  decisions: RequirementDevelopmentDecision[],
  workstreams: DevelopmentWorkstream[],
  invalidDependencyCount: number,
  additionalCaveats: string[],
): DevelopmentPlanModel["quality"] {
  const materialRequirementIds = requirementModel.requirements.filter(isMaterial).map((requirement) => requirement.id);
  const maintained = new Set(decisions.filter((decision) => decision.action === "maintain").map((decision) => decision.requirementId));
  const primaryCounts = new Map<string, number>();
  for (const workstream of workstreams) {
    for (const requirementId of workstream.primaryRequirementIds) {
      primaryCounts.set(requirementId, (primaryCounts.get(requirementId) || 0) + 1);
    }
  }
  const accounted = materialRequirementIds.filter((id) => maintained.has(id) || (primaryCounts.get(id) || 0) >= 1);
  const duplicatePrimaryRequirementIds = [...primaryCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const orphanMaterialRequirementIds = materialRequirementIds.filter((id) => !maintained.has(id) && !primaryCounts.has(id));
  const materialCoverageRate = materialRequirementIds.length ? Math.round((accounted.length / materialRequirementIds.length) * 100) : 100;
  const sharedWorkstreamCount = workstreams.filter((workstream) => workstream.kind !== "route_specific").length;
  const routeModuleCount = workstreams.filter((workstream) => workstream.kind === "route_specific").length;
  const caveats = [...additionalCaveats];
  if (duplicatePrimaryRequirementIds.length) caveats.push(`${duplicatePrimaryRequirementIds.length} requirements have more than one primary workstream.`);
  if (orphanMaterialRequirementIds.length) caveats.push(`${orphanMaterialRequirementIds.length} material requirements are not yet accounted for.`);
  if (sharedWorkstreamCount > 6) caveats.push("The shared plan has more than six workstreams and may need further consolidation before execution decomposition.");
  if (invalidDependencyCount) caveats.push(`${invalidDependencyCount} invalid or cyclic dependencies were removed.`);
  const status: DevelopmentPlanModel["quality"]["status"] = materialCoverageRate === 100
    && duplicatePrimaryRequirementIds.length === 0
    && sharedWorkstreamCount <= 6
    ? "complete"
    : materialCoverageRate >= 85
      ? "usable_with_caveats"
      : "provisional";

  return {
    status,
    materialRequirementCount: materialRequirementIds.length,
    materialRequirementsAccountedFor: accounted.length,
    materialCoverageRate,
    sharedWorkstreamCount,
    routeModuleCount,
    duplicatePrimaryRequirementIds,
    orphanMaterialRequirementIds,
    invalidDependencyCount,
    caveats: uniqueStrings(caveats),
  };
}

export function developmentPlanSourceFingerprint(requirementModel: RequirementModel, coverageModel: CoverageModel): string {
  return hash({
    developmentPlanVersion: DEVELOPMENT_PLAN_VERSION,
    requirementModelVersion: requirementModel.version,
    target: requirementModel.target,
    requirements: requirementModel.requirements.map((requirement) => ({
      id: requirement.id,
      key: requirement.key,
      label: requirement.label,
      definition: requirement.definition,
      category: requirement.category,
      importance: requirement.importance,
      scope: requirement.scope,
      roleFamilyIds: sortedUnique(requirement.roleFamilyIds),
      successBar: requirement.successBar,
      confidence: requirement.confidence,
      context: requirement.context,
    })),
    coverageModelVersion: coverageModel.version,
    requirementModelFingerprint: coverageModel.requirementModelFingerprint,
    userEvidenceFingerprint: coverageModel.userEvidenceFingerprint,
    coverage: coverageModel.coverage.map((coverage) => ({
      requirementId: coverage.requirementId,
      status: coverage.status,
      confidence: coverage.confidence,
      evidenceItemIds: sortedUnique(coverage.evidenceItemIds),
      evidenceStillNeeded: sortedUnique(coverage.evidenceStillNeeded),
      successBarAssessment: coverage.successBarAssessment,
    })),
  });
}

export function finalizeDevelopmentPlan(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  draft: DevelopmentPlanModel,
  candidates: DevelopmentPlanCandidate[],
  generationMethod: DevelopmentPlanModel["generationMethod"],
  additionalCaveats: string[] = [],
): DevelopmentPlanModel {
  const validRequirementIds = new Set(requirementModel.requirements.map((requirement) => requirement.id));
  const validRoleFamilyIds = new Set(requirementModel.roleFamilies.map((role) => role.id));
  const decisionById = new Map(draft.decisions.map((decision) => [decision.requirementId, decision]));
  const candidateIds = new Map<string, string>();

  for (const candidate of candidates) {
    candidateIds.set(candidate.key, workstreamId(candidate));
  }

  let workstreams: DevelopmentWorkstream[] = candidates.map((candidate) => {
    const id = candidateIds.get(candidate.key)!;
    const primaryRequirementIds = uniqueStrings(candidate.primaryRequirementIds).filter((value) => validRequirementIds.has(value));
    const supportedRequirementIds = uniqueStrings(candidate.supportedRequirementIds)
      .filter((value) => validRequirementIds.has(value) && !primaryRequirementIds.includes(value));
    const dependencyIds = uniqueStrings(candidate.dependencyKeys).map((key) => candidateIds.get(key)).filter(Boolean) as string[];
    return {
      id,
      key: candidate.key,
      title: compact(candidate.title),
      kind: candidate.kind,
      purpose: compact(candidate.purpose),
      outcome: compact(candidate.outcome),
      primaryRequirementIds,
      supportedRequirementIds,
      methods: uniqueStrings(candidate.methods) as DevelopmentMethod[],
      modules: candidate.modules.map((module) => ({
        ...module,
        id: module.id || `${id}-module-${shortHash({ title: module.title, requirementIds: sortedUnique(module.requirementIds) })}`,
        requirementIds: uniqueStrings(module.requirementIds).filter((value) => validRequirementIds.has(value)),
        concepts: uniqueStrings(module.concepts).slice(0, 10),
        practice: uniqueStrings(module.practice).slice(0, 8),
        resourceIds: uniqueStrings(module.resourceIds),
      })).filter((module) => module.requirementIds.length > 0 && compact(module.objective) && compact(module.doneWhen)),
      milestones: candidate.milestones.map((milestone, index) => ({
        ...milestone,
        id: milestone.id || `${id}-milestone-${shortHash({ key: milestone.key, index })}`,
        primaryRequirementIds: uniqueStrings(milestone.primaryRequirementIds).filter((value) => validRequirementIds.has(value)),
        supportedRequirementIds: uniqueStrings(milestone.supportedRequirementIds).filter((value) => validRequirementIds.has(value)),
        dependencyIds: uniqueStrings(milestone.dependencyIds),
        sequence: index + 1,
      })).filter((milestone) => milestone.primaryRequirementIds.length > 0 && compact(milestone.outcome) && compact(milestone.doneWhen)),
      dependencyIds,
      roleFamilyIds: uniqueStrings(candidate.roleFamilyIds).filter((value) => validRoleFamilyIds.has(value)),
      canRunInParallel: dependencyIds.length === 0,
      rationale: compact(candidate.rationale),
    };
  }).filter((workstream) => workstream.primaryRequirementIds.length > 0);

  const dependencyResult = acyclicDependencies(workstreams);
  workstreams = dependencyResult.workstreams;

  const primaryWorkstreamByRequirement = new Map<string, string>();
  for (const workstream of workstreams) {
    for (const requirementId of workstream.primaryRequirementIds) {
      if (!primaryWorkstreamByRequirement.has(requirementId)) primaryWorkstreamByRequirement.set(requirementId, workstream.id);
    }
  }

  const decisions = draft.decisions.map((decision) => ({
    ...decision,
    primaryWorkstreamId: decision.action === "maintain" ? null : primaryWorkstreamByRequirement.get(decision.requirementId) || null,
  }));
  const maintainedRequirementIds = decisions.filter((decision) => decision.action === "maintain").map((decision) => decision.requirementId);
  const unresolvedRequirementIds = decisions.filter((decision) => decision.action === "verify").map((decision) => decision.requirementId);
  const coverageDecisions: DevelopmentPlanCoverageDecision[] = requirementModel.requirements.map((requirement) => {
    const decision = decisionById.get(requirement.id)!;
    const workstreamIdForRequirement = primaryWorkstreamByRequirement.get(requirement.id);
    if (decision.action === "maintain") {
      return { requirementId: requirement.id, disposition: "maintain", workstreamIds: [], reason: decision.rationale };
    }
    if (decision.action === "verify") {
      return { requirementId: requirement.id, disposition: "verify", workstreamIds: workstreamIdForRequirement ? [workstreamIdForRequirement] : [], reason: decision.rationale };
    }
    if (workstreamIdForRequirement) {
      return {
        requirementId: requirement.id,
        disposition: requirement.scope === "role_specific" ? "planned_route" : "planned_shared",
        workstreamIds: [workstreamIdForRequirement],
        reason: decision.rationale,
      };
    }
    return {
      requirementId: requirement.id,
      disposition: isMaterial(requirement) ? "deferred" : "optional",
      workstreamIds: [],
      reason: isMaterial(requirement)
        ? `${requirement.label} is material but has not yet been assigned a defensible primary workstream.`
        : `${requirement.label} is retained as a differentiator or contextual option rather than inflating the shared core plan.`,
    };
  });

  return {
    ...draft,
    generationMethod,
    decisions,
    workstreams,
    maintainedRequirementIds,
    unresolvedRequirementIds,
    coverageDecisions,
    quality: qualityFor(requirementModel, decisions, workstreams, dependencyResult.invalidDependencyCount, additionalCaveats),
    generatedAt: Date.now(),
  };
}

export function buildDevelopmentPlanDraft(requirementModel: RequirementModel, coverageModel: CoverageModel): DevelopmentPlanModel {
  const coverageById = new Map(coverageModel.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const decisions = requirementModel.requirements.map((requirement) => {
    const coverage = coverageById.get(requirement.id) || {
      requirementId: requirement.id,
      status: "unknown" as const,
      confidence: "low" as const,
      evidenceItemIds: [],
      reason: "No coverage assessment is available.",
      successBarAssessment: `Coverage cannot yet be assessed against ${requirement.successBar}`,
      evidenceStillNeeded: [`Evidence that directly demonstrates: ${requirement.successBar}`],
      sourceBasis: "deterministic" as const,
    };
    return decisionFor(requirement, coverage);
  });
  const candidates = buildCandidateWorkstreams(requirementModel, decisions);
  const sourceFingerprint = developmentPlanSourceFingerprint(requirementModel, coverageModel);
  const draft: DevelopmentPlanModel = {
    mode: "development_plan_model",
    version: DEVELOPMENT_PLAN_VERSION,
    targetLabel: requirementModel.target.label,
    requirementModelVersion: requirementModel.version,
    requirementModelFingerprint: coverageModel.requirementModelFingerprint,
    coverageModelVersion: coverageModel.version,
    coverageModelFingerprint: hash({
      userEvidenceFingerprint: coverageModel.userEvidenceFingerprint,
      coverage: coverageModel.coverage,
    }),
    sourceFingerprint,
    objective: `Build, strengthen, or demonstrate the requirements needed for ${requirementModel.target.label} while avoiding redundant work on requirements that are already proven.`,
    sequencingPrinciple: "Shared capability, proof, relationships, positioning, and opportunity work can run in parallel unless an explicit evidence dependency requires otherwise.",
    generationMethod: "deterministic",
    decisions,
    workstreams: [],
    maintainedRequirementIds: [],
    unresolvedRequirementIds: [],
    coverageDecisions: [],
    resourceSet: {
      status: "not_generated",
      resources: [],
      checkedAt: null,
      refreshAfter: null,
      sourceFingerprint,
      caveats: [],
    },
    quality: {
      status: "provisional",
      materialRequirementCount: 0,
      materialRequirementsAccountedFor: 0,
      materialCoverageRate: 0,
      sharedWorkstreamCount: 0,
      routeModuleCount: 0,
      duplicatePrimaryRequirementIds: [],
      orphanMaterialRequirementIds: [],
      invalidDependencyCount: 0,
      caveats: [],
    },
    generatedAt: Date.now(),
  };
  return finalizeDevelopmentPlan(requirementModel, coverageModel, draft, candidates, "deterministic");
}
