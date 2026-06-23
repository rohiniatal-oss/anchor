import { createHash } from "node:crypto";
import type { CoverageModel, CoverageStatus, RequirementCoverage } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";

export const DEVELOPMENT_PLAN_MODEL_VERSION = 1;

export type DevelopmentAction = "build" | "strengthen" | "demonstrate" | "verify" | "maintain";
export type DevelopmentMethod = "learn" | "practice" | "gain_experience" | "produce" | "connect" | "position" | "qualify" | "research";
export type DevelopmentInclusion = "core" | "route_module" | "verify" | "maintain" | "deferred";
export type DevelopmentWorkstreamKind = "core" | "route_specific" | "verification";
export type DevelopmentModuleType = "syllabus" | "practice" | "project" | "proof" | "network" | "positioning" | "credential" | "verification";

export type RequirementDevelopmentDecision = {
  requirementId: string;
  coverageStatus: CoverageStatus;
  action: DevelopmentAction;
  methods: DevelopmentMethod[];
  inclusion: DevelopmentInclusion;
  rationale: string;
  primaryWorkstreamId: string | null;
};

export type DevelopmentModule = {
  id: string;
  type: DevelopmentModuleType;
  title: string;
  objective: string;
  requirementIds: string[];
  methods: DevelopmentMethod[];
  concepts: string[];
  approach: string[];
  output: string;
  doneWhen: string;
  resourceNeeds: Array<{
    purpose: string;
    preferredTypes: Array<"book" | "course" | "report" | "framework" | "article" | "dataset" | "community" | "other">;
    freshness: "current" | "durable" | "either";
  }>;
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
  targetLabel: string;
  requirementModelVersion: number;
  requirementModelFingerprint: string;
  coverageModelVersion: number;
  coverageFingerprint: string;
  sourceFingerprint: string;
  objective: string;
  planLogic: string;
  principles: string[];
  decisions: RequirementDevelopmentDecision[];
  workstreams: DevelopmentWorkstream[];
  maintenanceRequirementIds: string[];
  deferredRequirementIds: string[];
  summary: {
    actionCounts: Record<DevelopmentAction, number>;
    coreWorkstreamCount: number;
    routeModuleCount: number;
    verificationRequirementCount: number;
    materialRequirementCount: number;
    materialRequirementsAccountedFor: number;
  };
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    materialCoverageRate: number;
    orphanMaterialRequirementIds: string[];
    duplicatePrimaryRequirementIds: string[];
    invalidDependencyIds: string[];
    caveats: string[];
  };
  generatedAt: number;
};

type Cluster = {
  key: string;
  title: string;
  kind: DevelopmentWorkstreamKind;
  purpose: string;
  outcome: string;
  requirementIds: string[];
  roleFamilyIds: string[];
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

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}-${hash(parts.map(normalize)).slice(0, 16)}`;
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

function coverageByRequirement(model: CoverageModel): Map<string, RequirementCoverage> {
  return new Map(model.coverage.map((coverage) => [coverage.requirementId, coverage]));
}

function isMaterial(requirement: TargetRequirement): boolean {
  return requirement.importance === "essential" || requirement.importance === "important";
}

function actionFor(requirement: TargetRequirement, coverage: RequirementCoverage): DevelopmentAction {
  if (coverage.status === "proven") return "maintain";
  if (coverage.status === "unknown") return "verify";
  if ((requirement.category === "credential" || requirement.category === "eligibility") && coverage.status !== "proven") return "verify";
  if (requirement.confidence === "low") return "verify";
  if (coverage.status === "below_bar") return "strengthen";
  if (coverage.status === "partially_proven") {
    return requirement.category === "evidence" || requirement.category === "narrative" ? "demonstrate" : "strengthen";
  }
  return requirement.category === "evidence" || requirement.category === "narrative" ? "demonstrate" : "build";
}

function methodsFor(requirement: TargetRequirement, action: DevelopmentAction): DevelopmentMethod[] {
  if (action === "maintain") return [];
  if (action === "verify") return ["research"];

  switch (requirement.category) {
    case "knowledge":
      return action === "build" ? ["learn", "practice", "produce"] : ["practice", "produce"];
    case "skill":
      return ["practice", "produce"];
    case "experience":
      return ["gain_experience", "produce"];
    case "evidence":
      return ["produce"];
    case "network":
      return ["connect"];
    case "access":
      return ["connect", "research"];
    case "narrative":
      return ["position", "produce"];
    case "credential":
      return ["qualify"];
    case "eligibility":
      return ["research", "qualify"];
    default:
      return ["research"];
  }
}

function inclusionFor(requirement: TargetRequirement, action: DevelopmentAction): DevelopmentInclusion {
  if (action === "maintain") return "maintain";
  if (action === "verify") return "verify";
  if (requirement.scope === "role_specific") return "route_module";
  if (isMaterial(requirement)) return "core";
  return "deferred";
}

function rationaleFor(requirement: TargetRequirement, coverage: RequirementCoverage, action: DevelopmentAction): string {
  if (action === "maintain") return `${requirement.label} already meets the current success bar; preserve and reuse the evidence rather than create redundant work.`;
  if (action === "verify") return `${requirement.label} is not sufficiently established by the market or user evidence. Resolve the uncertainty before prescribing substantial development.`;
  if (action === "demonstrate") return `${requirement.label} is primarily an evidence or positioning requirement. Create or surface proof that meets the documented success bar.`;
  if (action === "strengthen") return `${requirement.label} has relevant evidence or explicit below-bar feedback, so the plan should raise it to the target standard rather than treat it as absent.`;
  return `${requirement.label} is materially required and current coverage is unproven, so build the underlying asset and generate evidence against the success bar.`;
}

function decisionFor(requirement: TargetRequirement, coverage: RequirementCoverage): RequirementDevelopmentDecision {
  const action = actionFor(requirement, coverage);
  return {
    requirementId: requirement.id,
    coverageStatus: coverage.status,
    action,
    methods: methodsFor(requirement, action),
    inclusion: inclusionFor(requirement, action),
    rationale: rationaleFor(requirement, coverage, action),
    primaryWorkstreamId: null,
  };
}

function clusterKey(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): string | null {
  if (decision.inclusion === "maintain" || decision.inclusion === "deferred") return null;
  if (decision.inclusion === "verify") return "verification";
  if (decision.inclusion === "route_module") {
    const roleKey = [...requirement.roleFamilyIds].sort().join("+") || "contextual";
    return `route:${roleKey}`;
  }
  if (requirement.category === "knowledge") return "knowledge-foundation";
  if (requirement.category === "skill") return "applied-capability";
  if (requirement.category === "experience" || requirement.category === "evidence") return "experience-and-proof";
  if (requirement.category === "network" || requirement.category === "access") return "market-access";
  if (requirement.category === "narrative") return "positioning";
  if (requirement.category === "credential" || requirement.category === "eligibility") return "formal-gates";
  return "verification";
}

function clusterTemplate(key: string): Omit<Cluster, "requirementIds" | "roleFamilyIds"> {
  if (key.startsWith("route:")) return {
    key,
    title: "Role-family-specific development",
    kind: "route_specific",
    purpose: "Build specialised requirements without inflating the shared core plan.",
    outcome: "The selected role-family requirements meet their success bars when that route becomes active.",
  };
  const templates: Record<string, Omit<Cluster, "requirementIds" | "roleFamilyIds">> = {
    verification: {
      key,
      title: "Verify what is genuinely needed",
      kind: "verification",
      purpose: "Resolve material uncertainty before Anchor recommends unnecessary or expensive development.",
      outcome: "Unknown and low-confidence requirements have enough evidence for a defensible coverage and investment decision.",
    },
    "knowledge-foundation": {
      key,
      title: "Build the target knowledge base",
      kind: "core",
      purpose: "Develop the domain understanding repeatedly required across the target role families.",
      outcome: "Core concepts can be applied to realistic target-role problems and demonstrated through outputs.",
    },
    "applied-capability": {
      key,
      title: "Strengthen applied capability",
      kind: "core",
      purpose: "Build and demonstrate the judgement and methods needed to perform the work.",
      outcome: "The required skills can be performed consistently to the documented success bars.",
    },
    "experience-and-proof": {
      key,
      title: "Build relevant experience and credible proof",
      kind: "core",
      purpose: "Create real or realistic application opportunities and convert them into inspectable evidence.",
      outcome: "A compact evidence portfolio demonstrates relevant experience and target-level performance.",
    },
    "market-access": {
      key,
      title: "Build practitioner relationships and hiring access",
      kind: "core",
      purpose: "Develop the relationships and entry routes required to understand and reach the market.",
      outcome: "Relevant practitioner relationships and credible routes into target opportunities are established.",
    },
    positioning: {
      key,
      title: "Build evidence-backed positioning",
      kind: "core",
      purpose: "Translate existing and newly created evidence into a coherent account of target credibility.",
      outcome: "The transition narrative is consistent across CV, outreach, applications and interviews.",
    },
    "formal-gates": {
      key,
      title: "Resolve formal requirements",
      kind: "core",
      purpose: "Confirm and satisfy only the credentials or eligibility conditions that are genuinely required.",
      outcome: "Every material formal gate is verified, satisfied or ruled non-essential by evidence.",
    },
  };
  return templates[key] || templates.verification;
}

function buildClusters(requirementModel: RequirementModel, decisions: RequirementDevelopmentDecision[]): Cluster[] {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const buckets = new Map<string, TargetRequirement[]>();
  for (const decision of decisions) {
    const requirement = requirementById.get(decision.requirementId);
    if (!requirement) continue;
    const key = clusterKey(requirement, decision);
    if (!key) continue;
    buckets.set(key, [...(buckets.get(key) || []), requirement]);
  }
  return [...buckets.entries()].map(([key, requirements]) => ({
    ...clusterTemplate(key),
    requirementIds: requirements.map((requirement) => requirement.id),
    roleFamilyIds: uniqueStrings(requirements.flatMap((requirement) => requirement.roleFamilyIds)),
  }));
}

function moduleTypeFor(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): DevelopmentModuleType {
  if (decision.action === "verify") return "verification";
  if (requirement.category === "knowledge") return "syllabus";
  if (requirement.category === "skill") return "practice";
  if (requirement.category === "experience") return "project";
  if (requirement.category === "evidence") return "proof";
  if (requirement.category === "network" || requirement.category === "access") return "network";
  if (requirement.category === "narrative") return "positioning";
  if (requirement.category === "credential" || requirement.category === "eligibility") return "credential";
  return "verification";
}

function approachFor(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): string[] {
  if (decision.action === "verify") {
    return [
      "Inspect the missing user evidence before assuming a capability gap.",
      "Strengthen the market evidence if the requirement itself is low confidence or context-specific.",
    ];
  }
  const approaches: Partial<Record<TargetRequirement["category"], string[]>> = {
    knowledge: [
      "Learn the smallest coherent concept set required by the success bar.",
      "Apply the concepts to a realistic target-role case.",
      "Produce a synthesis that makes understanding inspectable.",
    ],
    skill: [
      "Practise on progressively realistic cases.",
      "Use explicit assessment criteria tied to the success bar.",
      "Retain the strongest output as evidence.",
    ],
    experience: [
      "Use a real, simulated or adjacent project that reproduces the target responsibility.",
      "Capture the decision, contribution and outcome as reusable evidence.",
    ],
    evidence: [
      "Select the smallest credible artifact that demonstrates the linked capabilities.",
      "Make the result inspectable and usable in applications or conversations.",
    ],
    network: [
      "Build a small set of relevant practitioner relationships around a clear learning or contribution objective.",
      "Record substantive interactions rather than counting a contact list.",
    ],
    access: [
      "Identify credible hiring routes and test them through warm introductions, referrals or live processes.",
      "Treat access evidence separately from general networking volume.",
    ],
    narrative: [
      "Anchor each transition claim in existing or newly created evidence.",
      "Test consistency across CV, outreach and interview formats.",
    ],
    credential: [
      "Verify that the credential is a genuine gate before investing.",
      "Where required, choose the narrowest credible qualification route.",
    ],
    eligibility: [
      "Confirm the exact condition, context and available alternatives.",
      "Resolve only conditions that actually block the relevant role families.",
    ],
  };
  return approaches[requirement.category] || ["Use the most direct evidence-generating method available."];
}

function outputFor(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): string {
  if (decision.action === "verify") return `A defensible evidence decision for ${requirement.label}`;
  if (requirement.category === "knowledge") return `An applied synthesis demonstrating ${requirement.label}`;
  if (requirement.category === "skill") return `An assessed work sample demonstrating ${requirement.label}`;
  if (requirement.category === "experience") return `A documented target-relevant example of ${requirement.label}`;
  if (requirement.category === "evidence") return `An inspectable proof asset for ${requirement.label}`;
  if (requirement.category === "network") return `Substantive practitioner relationships supporting ${requirement.label}`;
  if (requirement.category === "access") return `A credible and evidenced route for ${requirement.label}`;
  if (requirement.category === "narrative") return `A tested positioning asset for ${requirement.label}`;
  if (requirement.category === "credential" || requirement.category === "eligibility") return `Verified status for ${requirement.label}`;
  return `Evidence against the success bar for ${requirement.label}`;
}

function resourceNeedsFor(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): DevelopmentModule["resourceNeeds"] {
  if (decision.action === "verify") return [{ purpose: `Verify ${requirement.label} and its applicable context`, preferredTypes: ["report", "article", "other"], freshness: "current" }];
  if (requirement.category === "knowledge") return [{ purpose: `Build and apply ${requirement.label}`, preferredTypes: ["book", "course", "report", "framework"], freshness: "either" }];
  if (requirement.category === "skill") return [{ purpose: `Practise ${requirement.label} against a credible method`, preferredTypes: ["framework", "course", "report"], freshness: "either" }];
  if (requirement.category === "credential" || requirement.category === "eligibility") return [{ purpose: `Verify the formal requirement for ${requirement.label}`, preferredTypes: ["report", "article", "other"], freshness: "current" }];
  return [];
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

function workstreamFromCluster(
  cluster: Cluster,
  requirementModel: RequirementModel,
  decisions: RequirementDevelopmentDecision[],
): DevelopmentWorkstream {
  const decisionById = new Map(decisions.map((decision) => [decision.requirementId, decision]));
  const requirements = cluster.requirementIds
    .map((id) => requirementModel.requirements.find((requirement) => requirement.id === id))
    .filter(Boolean) as TargetRequirement[];
  const id = stableId("development-workstream", cluster.key, ...cluster.requirementIds.slice().sort());
  const modules = requirements.map((requirement) => {
    const decision = decisionById.get(requirement.id)!;
    return {
      id: stableId("development-module", id, requirement.id),
      type: moduleTypeFor(requirement, decision),
      title: requirement.label,
      objective: requirement.successBar,
      requirementIds: [requirement.id],
      methods: decision.methods,
      concepts: uniqueStrings([requirement.definition, ...requirement.aliases]).slice(0, 8),
      approach: approachFor(requirement, decision),
      output: outputFor(requirement, decision),
      doneWhen: requirement.successBar,
      resourceNeeds: resourceNeedsFor(requirement, decision),
    } satisfies DevelopmentModule;
  });
  const methods = uniqueStrings(modules.flatMap((module) => module.methods)) as DevelopmentMethod[];
  const milestone: DevelopmentMilestone = {
    id: stableId("development-milestone", id, "success-bars"),
    title: cluster.kind === "verification" ? "Resolve the linked uncertainties" : `Meet the success bars for ${cluster.title.toLowerCase()}`,
    outcome: cluster.outcome,
    doneWhen: requirements.length <= 3
      ? requirements.map((requirement) => requirement.successBar).join("; ")
      : `All ${requirements.length} linked requirements meet their documented success bars and have retained evidence.`,
    requirementIds: cluster.requirementIds,
    evidenceGenerated: requirements.map((requirement) => ({
      type: cluster.kind === "verification" ? "other" : evidenceTypeFor(requirement),
      description: cluster.kind === "verification"
        ? `Evidence sufficient to assess ${requirement.label}`
        : `Evidence that meets the success bar for ${requirement.label}`,
    })),
    dependencyIds: [],
    sequence: 1,
  };
  return {
    id,
    key: cluster.key,
    title: cluster.title,
    kind: cluster.kind,
    purpose: cluster.purpose,
    outcome: cluster.outcome,
    requirementIds: cluster.requirementIds,
    methods,
    modules,
    milestones: [milestone],
    dependencyIds: [],
    roleFamilyIds: cluster.roleFamilyIds,
    rationale: `This workstream gives ${requirements.length} related requirement${requirements.length === 1 ? "" : "s"} one coherent primary home instead of creating disconnected plans.`,
  };
}

function developmentCoverageFingerprint(coverageModel: CoverageModel): string {
  return hash({
    version: coverageModel.version,
    requirementModelFingerprint: coverageModel.requirementModelFingerprint,
    userEvidenceFingerprint: coverageModel.userEvidenceFingerprint,
    coverage: [...coverageModel.coverage]
      .map((coverage) => ({
        requirementId: coverage.requirementId,
        status: coverage.status,
        confidence: coverage.confidence,
        evidenceItemIds: [...coverage.evidenceItemIds].sort(),
        successBarAssessment: coverage.successBarAssessment,
        evidenceStillNeeded: [...coverage.evidenceStillNeeded].sort(),
      }))
      .sort((left, right) => left.requirementId.localeCompare(right.requirementId)),
  });
}

export function developmentPlanSourceFingerprint(requirementModel: RequirementModel, coverageModel: CoverageModel): string {
  return hash({
    requirementModelVersion: requirementModel.version,
    requirementModelFingerprint: coverageModel.requirementModelFingerprint,
    coverageFingerprint: developmentCoverageFingerprint(coverageModel),
  });
}

function planQuality(
  requirementModel: RequirementModel,
  decisions: RequirementDevelopmentDecision[],
  workstreams: DevelopmentWorkstream[],
): DevelopmentPlanModel["quality"] {
  const materialIds = new Set(requirementModel.requirements.filter(isMaterial).map((requirement) => requirement.id));
  const maintainedIds = new Set(decisions.filter((decision) => decision.inclusion === "maintain").map((decision) => decision.requirementId));
  const primaryHomes = new Map<string, string[]>();
  for (const workstream of workstreams) {
    for (const requirementId of workstream.requirementIds) {
      primaryHomes.set(requirementId, [...(primaryHomes.get(requirementId) || []), workstream.id]);
    }
  }
  const accountedFor = [...materialIds].filter((id) => maintainedIds.has(id) || (primaryHomes.get(id)?.length || 0) === 1);
  const orphanMaterialRequirementIds = [...materialIds].filter((id) => !maintainedIds.has(id) && !(primaryHomes.get(id)?.length));
  const duplicatePrimaryRequirementIds = [...primaryHomes.entries()].filter(([, ids]) => ids.length > 1).map(([id]) => id);
  const workstreamIds = new Set(workstreams.map((workstream) => workstream.id));
  const invalidDependencyIds = uniqueStrings(workstreams.flatMap((workstream) => workstream.dependencyIds).filter((id) => !workstreamIds.has(id)));
  const materialCoverageRate = materialIds.size ? Math.round((accountedFor.length / materialIds.size) * 100) : 100;
  const caveats: string[] = [];
  const coreWorkstreams = workstreams.filter((workstream) => workstream.kind !== "route_specific");
  if (orphanMaterialRequirementIds.length) caveats.push(`${orphanMaterialRequirementIds.length} material requirement${orphanMaterialRequirementIds.length === 1 ? "" : "s"} lack a primary workstream or maintenance decision.`);
  if (duplicatePrimaryRequirementIds.length) caveats.push(`${duplicatePrimaryRequirementIds.length} requirement${duplicatePrimaryRequirementIds.length === 1 ? "" : "s"} have more than one primary home.`);
  if (invalidDependencyIds.length) caveats.push(`${invalidDependencyIds.length} dependency reference${invalidDependencyIds.length === 1 ? "" : "s"} are invalid.`);
  if (coreWorkstreams.length > 6) caveats.push("The shared plan has more than six workstreams and may create avoidable cognitive load.");
  const status = materialCoverageRate === 100 && !duplicatePrimaryRequirementIds.length && !invalidDependencyIds.length && coreWorkstreams.length <= 6
    ? "complete"
    : materialCoverageRate >= 85
      ? "usable_with_caveats"
      : "provisional";
  return {
    status,
    materialCoverageRate,
    orphanMaterialRequirementIds,
    duplicatePrimaryRequirementIds,
    invalidDependencyIds,
    caveats,
  };
}

export function buildDevelopmentPlanDraft(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
): DevelopmentPlanModel {
  const coverageMap = coverageByRequirement(coverageModel);
  const decisions = requirementModel.requirements.map((requirement) => {
    const coverage = coverageMap.get(requirement.id) || {
      requirementId: requirement.id,
      status: "unknown" as const,
      confidence: "low" as const,
      evidenceItemIds: [],
      reason: "No coverage assessment is available.",
      successBarAssessment: `Coverage cannot yet be assessed against: ${requirement.successBar}`,
      evidenceStillNeeded: [`Evidence that directly demonstrates: ${requirement.successBar}`],
      sourceBasis: "deterministic" as const,
    };
    return decisionFor(requirement, coverage);
  });
  const clusters = buildClusters(requirementModel, decisions);
  const workstreams = clusters.map((cluster) => workstreamFromCluster(cluster, requirementModel, decisions));
  const workstreamByRequirement = new Map<string, string>();
  for (const workstream of workstreams) {
    for (const requirementId of workstream.requirementIds) workstreamByRequirement.set(requirementId, workstream.id);
  }
  const linkedDecisions = decisions.map((decision) => ({
    ...decision,
    primaryWorkstreamId: workstreamByRequirement.get(decision.requirementId) || null,
  }));
  const actionCounts: Record<DevelopmentAction, number> = { build: 0, strengthen: 0, demonstrate: 0, verify: 0, maintain: 0 };
  for (const decision of linkedDecisions) actionCounts[decision.action] += 1;
  const materialRequirements = requirementModel.requirements.filter(isMaterial);
  const accountedFor = linkedDecisions.filter((decision) => isMaterial(requirementModel.requirements.find((requirement) => requirement.id === decision.requirementId)!) && (decision.primaryWorkstreamId || decision.inclusion === "maintain"));
  const coverageFingerprint = developmentCoverageFingerprint(coverageModel);
  const sourceFingerprint = developmentPlanSourceFingerprint(requirementModel, coverageModel);

  return {
    mode: "development_plan_model",
    version: DEVELOPMENT_PLAN_MODEL_VERSION,
    targetLabel: requirementModel.target.label,
    requirementModelVersion: requirementModel.version,
    requirementModelFingerprint: coverageModel.requirementModelFingerprint,
    coverageModelVersion: coverageModel.version,
    coverageFingerprint,
    sourceFingerprint,
    objective: `Build, strengthen or demonstrate the requirements needed for ${requirementModel.target.label} without duplicating what is already proven.`,
    planLogic: "Verification resolves uncertainty first. Shared workstreams build reusable capability and evidence in parallel, while specialised requirements remain in role-family modules.",
    principles: [
      "Requirements determine the plan; tasks do not determine the strategy.",
      "Unknown coverage creates verification, not an assumed weakness.",
      "One primary workstream should improve several related requirements where possible.",
      "Learning must lead to application, practice or inspectable evidence.",
      "Proven requirements are maintained and reused rather than rebuilt.",
      "Role-family-specific requirements stay modular so the shared plan remains manageable.",
      "This layer stops at workstreams, modules and milestones; tasks and priorities come later.",
    ],
    decisions: linkedDecisions,
    workstreams,
    maintenanceRequirementIds: linkedDecisions.filter((decision) => decision.inclusion === "maintain").map((decision) => decision.requirementId),
    deferredRequirementIds: linkedDecisions.filter((decision) => decision.inclusion === "deferred").map((decision) => decision.requirementId),
    summary: {
      actionCounts,
      coreWorkstreamCount: workstreams.filter((workstream) => workstream.kind === "core").length,
      routeModuleCount: workstreams.filter((workstream) => workstream.kind === "route_specific").length,
      verificationRequirementCount: linkedDecisions.filter((decision) => decision.inclusion === "verify").length,
      materialRequirementCount: materialRequirements.length,
      materialRequirementsAccountedFor: accountedFor.length,
    },
    quality: planQuality(requirementModel, linkedDecisions, workstreams),
    generatedAt: Date.now(),
  };
}
