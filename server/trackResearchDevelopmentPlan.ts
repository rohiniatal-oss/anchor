import { createHash } from "node:crypto";
import type { CoverageModel, CoverageState, RequirementCoverage } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";

export const DEVELOPMENT_PLAN_VERSION = 1;

export type DevelopmentAction = "build" | "strengthen" | "demonstrate" | "verify" | "maintain";
export type DevelopmentMethod = "learn" | "practice" | "produce" | "connect" | "position" | "credential" | "research";
export type DevelopmentWorkstreamKind = "core" | "route_specific" | "verification" | "maintenance";

export type RequirementDevelopmentDecision = {
  requirementId: string;
  coverageState: CoverageState;
  action: DevelopmentAction;
  methods: DevelopmentMethod[];
  rationale: string;
  material: boolean;
  workstreamIds: string[];
};

export type DevelopmentResource = {
  id: string;
  title: string;
  type: "book" | "course" | "report" | "framework" | "article" | "dataset" | "community" | "other";
  url: string;
  publisher: string;
  whySelected: string;
  requirementIds: string[];
  authority: "primary" | "canonical" | "credible" | "supporting";
  freshness: "current" | "durable" | "unknown";
  sourceEvidenceId: string;
};

export type DevelopmentModule = {
  id: string;
  title: string;
  objective: string;
  requirementIds: string[];
  concepts: string[];
  resourceIds: string[];
  practice: string[];
  output: string;
  doneWhen: string;
};

export type DevelopmentMilestone = {
  id: string;
  title: string;
  outcome: string;
  doneWhen: string;
  requirementIds: string[];
  evidenceGenerated: Array<{
    type: "knowledge" | "skill" | "experience" | "output" | "relationship" | "credential" | "market_signal" | "other";
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
  requirementIds: string[];
  methods: DevelopmentMethod[];
  modules: DevelopmentModule[];
  milestones: DevelopmentMilestone[];
  dependencyIds: string[];
  roleFamilyIds: string[];
  rationale: string;
};

export type DevelopmentPlanModel = {
  mode: "development_plan_model";
  version: number;
  requirementModelVersion: number;
  requirementFingerprint: string;
  coverageModelVersion: number;
  coverageFingerprint: string;
  sourceFingerprint: string;
  targetLabel: string;
  objective: string;
  principles: string[];
  decisions: RequirementDevelopmentDecision[];
  workstreams: DevelopmentWorkstream[];
  resources: DevelopmentResource[];
  maintenanceRequirementIds: string[];
  unresolvedRequirementIds: string[];
  requirementCoverage: Array<{
    requirementId: string;
    decision: "planned" | "verify" | "maintain" | "route_module" | "deferred";
    workstreamIds: string[];
    reason: string;
  }>;
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    materialRequirementCount: number;
    materialRequirementsMapped: number;
    materialCoverageRate: number;
    workstreamCount: number;
    duplicateRequirementCount: number;
    orphanRequirementIds: string[];
    caveats: string[];
  };
  generatedAt: number;
};

type CandidateCluster = {
  key: string;
  title: string;
  kind: DevelopmentWorkstreamKind;
  purpose: string;
  outcome: string;
  methods: DevelopmentMethod[];
  requirementIds: string[];
  roleFamilyIds: string[];
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function slug(value: unknown): string {
  return normalize(value).replace(/\s+/g, "-").slice(0, 72) || "development";
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

function coverageByRequirement(model: CoverageModel): Map<string, RequirementCoverage> {
  return new Map(model.coverage.map((coverage) => [coverage.requirementId, coverage]));
}

function isMaterial(requirement: TargetRequirement): boolean {
  return requirement.importance === "essential" || requirement.importance === "important";
}

function methodsFor(requirement: TargetRequirement, action: DevelopmentAction): DevelopmentMethod[] {
  if (action === "verify") return ["research"];
  if (action === "maintain") return [];

  switch (requirement.category) {
    case "knowledge":
      return action === "demonstrate" ? ["produce"] : ["learn", "practice", "produce"];
    case "skill":
      return action === "demonstrate" ? ["practice", "produce"] : ["practice", "produce"];
    case "experience":
      return ["practice", "produce"];
    case "evidence":
      return ["produce"];
    case "network":
      return ["connect"];
    case "access":
      return ["connect", "research"];
    case "narrative":
      return ["position", "produce"];
    case "credential":
      return ["credential"];
    case "eligibility":
      return ["research", "credential"];
    default:
      return ["research"];
  }
}

function developmentAction(requirement: TargetRequirement, coverage: RequirementCoverage): DevelopmentAction {
  if (coverage.state === "unknown") return "verify";
  if (coverage.state === "below_bar") return requirement.category === "evidence" || requirement.category === "narrative" ? "demonstrate" : "build";
  if (coverage.state === "partially_proven") {
    if (["evidence", "experience", "narrative", "network", "access"].includes(requirement.category)) return "demonstrate";
    return "strengthen";
  }
  if (coverage.state === "unproven") {
    if (["credential", "eligibility", "network", "access"].includes(requirement.category)) return "build";
    return "demonstrate";
  }
  return "maintain";
}

function rationaleFor(requirement: TargetRequirement, coverage: RequirementCoverage, action: DevelopmentAction): string {
  if (action === "maintain") return `${requirement.label} is already evidenced against the current success bar; preserve and reuse that evidence.`;
  if (action === "verify") return `${requirement.label} cannot yet be assessed fairly. Gather the specific evidence needed before prescribing substantial development.`;
  if (action === "demonstrate") return `${requirement.label} is not yet evidenced strongly enough. Create or surface proof against the stated success bar.`;
  if (action === "strengthen") return `${requirement.label} is partly evidenced but should be strengthened to meet the target standard consistently.`;
  return `${requirement.label} is material to the target and current evidence indicates that the underlying asset must be built.`;
}

function decisionFor(requirement: TargetRequirement, coverage: RequirementCoverage): RequirementDevelopmentDecision {
  const action = developmentAction(requirement, coverage);
  return {
    requirementId: requirement.id,
    coverageState: coverage.state,
    action,
    methods: methodsFor(requirement, action),
    rationale: rationaleFor(requirement, coverage, action),
    material: isMaterial(requirement),
    workstreamIds: [],
  };
}

function clusterKey(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): string {
  if (decision.action === "verify") return "verification";
  if (decision.action === "maintain") return "maintenance";
  if (requirement.scope === "role_specific" && requirement.roleFamilyIds.length) return `route:${requirement.roleFamilyIds.sort().join("+")}`;

  switch (requirement.category) {
    case "knowledge": return "knowledge-foundation";
    case "skill": return "applied-capability";
    case "experience":
    case "evidence": return "proof-portfolio";
    case "network":
    case "access": return "access-and-relationships";
    case "narrative": return "positioning";
    case "credential":
    case "eligibility": return "formal-requirements";
    default: return "verification";
  }
}

function clusterTemplate(key: string): Omit<CandidateCluster, "requirementIds" | "roleFamilyIds"> {
  if (key.startsWith("route:")) return {
    key,
    title: "Role-family specific development",
    kind: "route_specific",
    purpose: "Build the requirements that apply only to a specific role family without inflating the shared core plan.",
    outcome: "The relevant route-specific success bars are met or evidenced when that role family becomes the immediate target.",
    methods: ["learn", "practice", "produce", "connect"],
  };
  const templates: Record<string, Omit<CandidateCluster, "requirementIds" | "roleFamilyIds">> = {
    verification: {
      key,
      title: "Verify current coverage",
      kind: "verification",
      purpose: "Resolve unknowns before Anchor prescribes unnecessary development.",
      outcome: "Each unknown requirement has enough evidence to be assessed as proven, partial, unproven, or below bar.",
      methods: ["research"],
    },
    maintenance: {
      key,
      title: "Preserve proven strengths",
      kind: "maintenance",
      purpose: "Keep strong evidence reusable without creating redundant work.",
      outcome: "Current evidence remains easy to retrieve and apply to the target.",
      methods: [],
    },
    "knowledge-foundation": {
      key,
      title: "Build the target knowledge base",
      kind: "core",
      purpose: "Develop the domain knowledge repeatedly required across the target role families.",
      outcome: "Core concepts can be applied and explained through target-relevant outputs, not only recalled.",
      methods: ["learn", "practice", "produce"],
    },
    "applied-capability": {
      key,
      title: "Strengthen applied capability",
      kind: "core",
      purpose: "Build and demonstrate the skills required to perform the work at the target standard.",
      outcome: "The user can perform the required methods consistently and produce inspectable evidence.",
      methods: ["practice", "produce"],
    },
    "proof-portfolio": {
      key,
      title: "Create credible proof",
      kind: "core",
      purpose: "Turn relevant capability and experience into inspectable evidence against the target success bars.",
      outcome: "A compact portfolio of outputs demonstrates the material requirements that are currently under-evidenced.",
      methods: ["produce"],
    },
    "access-and-relationships": {
      key,
      title: "Build access and practitioner relationships",
      kind: "core",
      purpose: "Develop the relationships and hiring routes required to reach the opportunity.",
      outcome: "Relevant practitioners and credible routes into target organizations are established and evidenced.",
      methods: ["connect", "research"],
    },
    positioning: {
      key,
      title: "Build target positioning",
      kind: "core",
      purpose: "Translate existing evidence into a coherent, target-specific account of credibility and motivation.",
      outcome: "The target narrative is evidence-backed and usable across outreach, applications, and interviews.",
      methods: ["position", "produce"],
    },
    "formal-requirements": {
      key,
      title: "Resolve formal requirements",
      kind: "core",
      purpose: "Confirm and, only where necessary, satisfy credentials, eligibility, clearance, or other formal gates.",
      outcome: "Every material formal requirement is either satisfied, in progress, or explicitly ruled non-essential by evidence.",
      methods: ["research", "credential"],
    },
  };
  return templates[key] || templates.verification;
}

function moduleForRequirement(requirement: TargetRequirement, workstreamId: string): DevelopmentModule | null {
  if (!["knowledge", "skill", "credential", "eligibility"].includes(requirement.category)) return null;
  return {
    id: `${workstreamId}-module-${slug(requirement.key || requirement.label)}`,
    title: requirement.label,
    objective: requirement.successBar,
    requirementIds: [requirement.id],
    concepts: uniqueStrings([requirement.definition, ...requirement.aliases]).slice(0, 6),
    resourceIds: [],
    practice: requirement.category === "skill" ? [`Apply ${requirement.label} to a target-relevant case.`] : [],
    output: requirement.category === "credential" || requirement.category === "eligibility"
      ? `Verified evidence for ${requirement.label}`
      : `A concise applied synthesis demonstrating ${requirement.label}`,
    doneWhen: requirement.successBar,
  };
}

function evidenceTypeFor(requirement: TargetRequirement): DevelopmentMilestone["evidenceGenerated"][number]["type"] {
  if (requirement.category === "knowledge") return "knowledge";
  if (requirement.category === "skill") return "skill";
  if (requirement.category === "experience") return "experience";
  if (requirement.category === "evidence" || requirement.category === "narrative") return "output";
  if (requirement.category === "network" || requirement.category === "access") return "relationship";
  if (requirement.category === "credential" || requirement.category === "eligibility") return "credential";
  return "other";
}

function milestoneForCluster(cluster: CandidateCluster, requirements: TargetRequirement[], index: number): DevelopmentMilestone {
  const successBars = uniqueStrings(requirements.map((requirement) => requirement.successBar));
  const requirementLabels = requirements.map((requirement) => requirement.label);
  return {
    id: `milestone-${slug(cluster.key)}-${index + 1}`,
    title: cluster.kind === "verification" ? "Resolve the evidence unknowns" : `Complete ${cluster.title.toLowerCase()}`,
    outcome: cluster.outcome,
    doneWhen: successBars.length <= 3 ? successBars.join("; ") : `The linked requirements meet their documented success bars: ${requirementLabels.slice(0, 5).join(", ")}.`,
    requirementIds: requirements.map((requirement) => requirement.id),
    evidenceGenerated: requirements.map((requirement) => ({
      type: cluster.kind === "verification" ? "other" : evidenceTypeFor(requirement),
      description: cluster.kind === "verification" ? `Evidence sufficient to assess ${requirement.label}` : `Evidence against the success bar for ${requirement.label}`,
    })),
    dependencyIds: [],
    sequence: index + 1,
  };
}

function buildCandidateClusters(requirementModel: RequirementModel, decisions: RequirementDevelopmentDecision[]): CandidateCluster[] {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const buckets = new Map<string, { requirements: TargetRequirement[]; decisions: RequirementDevelopmentDecision[] }>();

  for (const decision of decisions) {
    const requirement = requirementById.get(decision.requirementId);
    if (!requirement) continue;
    // Contextual differentiators remain visible in the model, but do not inflate
    // the core plan unless they are already partially evidenced or below bar.
    if (!decision.material && requirement.importance === "contextual" && ["unproven", "unknown"].includes(decision.coverageState)) continue;
    const key = clusterKey(requirement, decision);
    const bucket = buckets.get(key) || { requirements: [], decisions: [] };
    bucket.requirements.push(requirement);
    bucket.decisions.push(decision);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()].map(([key, bucket]) => {
    const template = clusterTemplate(key);
    const methods = uniqueStrings(bucket.decisions.flatMap((decision) => decision.methods)) as DevelopmentMethod[];
    return {
      ...template,
      methods: methods.length ? methods : template.methods,
      requirementIds: bucket.requirements.map((requirement) => requirement.id),
      roleFamilyIds: uniqueStrings(bucket.requirements.flatMap((requirement) => requirement.roleFamilyIds)),
    };
  });
}

function workstreamFromCluster(cluster: CandidateCluster, requirementModel: RequirementModel, index: number): DevelopmentWorkstream {
  const requirements = cluster.requirementIds
    .map((id) => requirementModel.requirements.find((requirement) => requirement.id === id))
    .filter(Boolean) as TargetRequirement[];
  const id = `workstream-${slug(cluster.key)}`;
  const modules = requirements.map((requirement) => moduleForRequirement(requirement, id)).filter(Boolean) as DevelopmentModule[];
  return {
    id,
    key: cluster.key,
    title: cluster.title,
    kind: cluster.kind,
    purpose: cluster.purpose,
    outcome: cluster.outcome,
    requirementIds: cluster.requirementIds,
    methods: cluster.methods,
    modules,
    milestones: [milestoneForCluster(cluster, requirements, index)],
    dependencyIds: cluster.kind === "route_specific" ? ["workstream-knowledge-foundation"] : [],
    roleFamilyIds: cluster.roleFamilyIds,
    rationale: `This workstream groups ${requirements.length} related requirement${requirements.length === 1 ? "" : "s"} so Anchor can improve coverage without creating one disconnected plan per requirement.`,
  };
}

function planQuality(requirementModel: RequirementModel, decisions: RequirementDevelopmentDecision[], workstreams: DevelopmentWorkstream[]) {
  const materialIds = new Set(requirementModel.requirements.filter(isMaterial).map((requirement) => requirement.id));
  const mappedIds = new Set(workstreams.flatMap((workstream) => workstream.requirementIds));
  const maintenanceIds = new Set(decisions.filter((decision) => decision.action === "maintain").map((decision) => decision.requirementId));
  const mappedMaterial = [...materialIds].filter((id) => mappedIds.has(id) || maintenanceIds.has(id));
  const orphanRequirementIds = [...materialIds].filter((id) => !mappedIds.has(id) && !maintenanceIds.has(id));
  const useCounts = new Map<string, number>();
  for (const workstream of workstreams) {
    for (const id of workstream.requirementIds) useCounts.set(id, (useCounts.get(id) || 0) + 1);
  }
  const duplicateRequirementCount = [...useCounts.values()].filter((count) => count > 1).length;
  const rate = materialIds.size ? Math.round((mappedMaterial.length / materialIds.size) * 100) : 100;
  const caveats: string[] = [];
  if (orphanRequirementIds.length) caveats.push(`${orphanRequirementIds.length} material requirements are not yet mapped to a workstream.`);
  if (duplicateRequirementCount) caveats.push(`${duplicateRequirementCount} requirements appear in more than one workstream and should be checked for purposeful leverage rather than duplication.`);
  if (workstreams.length > 7) caveats.push("The plan has more than seven workstreams and may need further consolidation before execution decomposition.");

  return {
    status: rate === 100 && workstreams.length <= 7 ? "complete" as const : rate >= 85 ? "usable_with_caveats" as const : "provisional" as const,
    materialRequirementCount: materialIds.size,
    materialRequirementsMapped: mappedMaterial.length,
    materialCoverageRate: rate,
    workstreamCount: workstreams.length,
    duplicateRequirementCount,
    orphanRequirementIds,
    caveats,
  };
}

export function developmentPlanFingerprint(requirementModel: RequirementModel, coverageModel: CoverageModel): string {
  return hash({
    requirementVersion: requirementModel.version,
    requirementFingerprint: requirementModel.sourceFingerprint,
    coverageVersion: coverageModel.version,
    coverageEvidenceFingerprint: coverageModel.evidenceFingerprint,
    coverage: coverageModel.coverage.map((item) => ({ requirementId: item.requirementId, state: item.state, evidenceClaimIds: item.evidenceClaimIds })),
  });
}

export function buildDevelopmentPlanDraft(requirementModel: RequirementModel, coverageModel: CoverageModel): DevelopmentPlanModel {
  const coverageMap = coverageByRequirement(coverageModel);
  const decisions = requirementModel.requirements.map((requirement) => {
    const coverage = coverageMap.get(requirement.id) || {
      requirementId: requirement.id,
      state: "unknown" as const,
      confidence: "low" as const,
      reason: "No coverage assessment is available.",
      evidenceClaimIds: [],
      missingEvidence: requirement.successBar,
      assessedAt: Date.now(),
    };
    return decisionFor(requirement, coverage);
  });

  const clusters = buildCandidateClusters(requirementModel, decisions);
  const workstreams = clusters.map((cluster, index) => workstreamFromCluster(cluster, requirementModel, index));
  const workstreamIdsByRequirement = new Map<string, string[]>();
  for (const workstream of workstreams) {
    for (const requirementId of workstream.requirementIds) {
      const current = workstreamIdsByRequirement.get(requirementId) || [];
      current.push(workstream.id);
      workstreamIdsByRequirement.set(requirementId, current);
    }
  }
  const linkedDecisions = decisions.map((decision) => ({ ...decision, workstreamIds: workstreamIdsByRequirement.get(decision.requirementId) || [] }));
  const maintenanceRequirementIds = linkedDecisions.filter((decision) => decision.action === "maintain").map((decision) => decision.requirementId);
  const unresolvedRequirementIds = linkedDecisions.filter((decision) => decision.action === "verify").map((decision) => decision.requirementId);
  const requirementCoverage = linkedDecisions.map((decision) => {
    const requirement = requirementModel.requirements.find((item) => item.id === decision.requirementId)!;
    const planned = decision.workstreamIds.length > 0;
    const decisionType = decision.action === "maintain" ? "maintain" as const
      : decision.action === "verify" ? "verify" as const
      : planned && requirement.scope === "role_specific" ? "route_module" as const
      : planned ? "planned" as const
      : "deferred" as const;
    return {
      requirementId: decision.requirementId,
      decision: decisionType,
      workstreamIds: decision.workstreamIds,
      reason: decision.rationale,
    };
  });
  const sourceFingerprint = developmentPlanFingerprint(requirementModel, coverageModel);

  return {
    mode: "development_plan_model",
    version: DEVELOPMENT_PLAN_VERSION,
    requirementModelVersion: requirementModel.version,
    requirementFingerprint: requirementModel.sourceFingerprint,
    coverageModelVersion: coverageModel.version,
    coverageFingerprint: coverageModel.evidenceFingerprint,
    sourceFingerprint,
    targetLabel: requirementModel.target.label,
    objective: `Build and evidence the requirements needed for ${requirementModel.target.label}, while avoiding redundant work on requirements that are already proven.`,
    principles: [
      "Requirements determine the plan; tasks do not determine the strategy.",
      "Unknown coverage creates verification work, not an assumed weakness.",
      "One workstream should improve several related requirements where possible.",
      "Learning must lead to application or evidence rather than passive consumption.",
      "Role-family-specific requirements remain modular so the shared core stays manageable.",
      "This layer defines workstreams and milestones only; tasks, subtasks, and execution priority come later.",
    ],
    decisions: linkedDecisions,
    workstreams,
    resources: [],
    maintenanceRequirementIds,
    unresolvedRequirementIds,
    requirementCoverage,
    quality: planQuality(requirementModel, linkedDecisions, workstreams),
    generatedAt: Date.now(),
  };
}
