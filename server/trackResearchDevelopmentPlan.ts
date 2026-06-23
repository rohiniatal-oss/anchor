import type {
  RequirementCategory,
  RequirementImportance,
  RequirementModel,
  TargetRequirement,
} from "./trackResearchRequirementModel";
import type {
  CoverageModel,
  CoverageStatus,
  RequirementCoverage,
} from "./trackResearchCoverageModel";

export const DEVELOPMENT_PLAN_MODEL_VERSION = 1;

export type DevelopmentAction = "build" | "strengthen" | "demonstrate" | "verify" | "maintain";
export type DevelopmentScope = "core" | "enhancement" | "conditional" | "maintenance";
export type DevelopmentMethod =
  | "learn"
  | "practice"
  | "gain_experience"
  | "create_proof"
  | "position"
  | "build_relationships"
  | "build_access"
  | "resolve_credential"
  | "resolve_eligibility"
  | "verify"
  | "maintain";
export type DevelopmentModuleType =
  | "syllabus"
  | "practice"
  | "experience"
  | "proof"
  | "narrative"
  | "relationships"
  | "access"
  | "credential"
  | "eligibility"
  | "verification";
export type DevelopmentResourceType = "book" | "course" | "report" | "framework" | "article" | "tool" | "search_query" | "existing_asset" | "other";

export type RequirementDevelopmentDecision = {
  requirementId: string;
  coverageStatus: CoverageStatus;
  action: DevelopmentAction;
  scope: DevelopmentScope;
  reason: string;
  desiredEvidence: string;
  evidenceStillNeeded: string[];
};

export type DevelopmentResource = {
  title: string;
  type: DevelopmentResourceType;
  url: string;
  why: string;
  provenance: "existing_research" | "existing_asset" | "web_research" | "search_query" | "fallback";
};

export type DevelopmentModule = {
  id: string;
  title: string;
  type: DevelopmentModuleType;
  scope: Exclude<DevelopmentScope, "maintenance">;
  objective: string;
  requirementIds: string[];
  resources: DevelopmentResource[];
  activities: string[];
  output: string;
  assessmentCriteria: string[];
};

export type DevelopmentMilestone = {
  id: string;
  label: string;
  sequence: number;
  requirementIds: string[];
  doneWhen: string;
  evidenceCreated: string;
};

export type DevelopmentWorkstream = {
  id: string;
  title: string;
  objective: string;
  rationale: string;
  scopeMix: Array<Exclude<DevelopmentScope, "maintenance">>;
  requirementIds: string[];
  methods: DevelopmentMethod[];
  modules: DevelopmentModule[];
  milestones: DevelopmentMilestone[];
  dependencyNotes: string[];
  completionStandard: string;
};

export type DevelopmentPlanSynthesis = {
  workstreams?: Array<{
    title?: string;
    objective?: string;
    rationale?: string;
    requirementIds?: string[];
    methods?: DevelopmentMethod[];
    modules?: Array<{
      title?: string;
      type?: DevelopmentModuleType;
      scope?: Exclude<DevelopmentScope, "maintenance">;
      objective?: string;
      requirementIds?: string[];
      resources?: Array<{
        title?: string;
        type?: DevelopmentResourceType;
        url?: string;
        why?: string;
        provenance?: DevelopmentResource["provenance"];
      }>;
      activities?: string[];
      output?: string;
      assessmentCriteria?: string[];
    }>;
    milestones?: Array<{
      label?: string;
      sequence?: number;
      requirementIds?: string[];
      doneWhen?: string;
      evidenceCreated?: string;
    }>;
    dependencyNotes?: string[];
    completionStandard?: string;
  }>;
  planSummary?: string;
  qualityNotes?: string[];
};

export type DevelopmentPlanModel = {
  mode: "development_plan_model";
  version: number;
  targetLabel: string;
  requirementModelFingerprint: string;
  coverageFingerprint: string;
  sourceContextFingerprint: string;
  planSummary: string;
  decisions: RequirementDevelopmentDecision[];
  workstreams: DevelopmentWorkstream[];
  maintenanceRequirementIds: string[];
  quality: {
    status: "strong" | "usable" | "provisional";
    coreRequirementCount: number;
    coveredCoreRequirementCount: number;
    plannedRequirementCount: number;
    maintenanceRequirementCount: number;
    conditionalRequirementCount: number;
    enhancementRequirementCount: number;
    unassignedRequirementIds: string[];
    caveats: string[];
  };
  generatedAt: number;
};

const ACTION_VALUES: DevelopmentAction[] = ["build", "strengthen", "demonstrate", "verify", "maintain"];
const SCOPE_VALUES: DevelopmentScope[] = ["core", "enhancement", "conditional", "maintenance"];
const METHOD_VALUES: DevelopmentMethod[] = [
  "learn",
  "practice",
  "gain_experience",
  "create_proof",
  "position",
  "build_relationships",
  "build_access",
  "resolve_credential",
  "resolve_eligibility",
  "verify",
  "maintain",
];
const MODULE_VALUES: DevelopmentModuleType[] = [
  "syllabus",
  "practice",
  "experience",
  "proof",
  "narrative",
  "relationships",
  "access",
  "credential",
  "eligibility",
  "verification",
];
const RESOURCE_VALUES: DevelopmentResourceType[] = ["book", "course", "report", "framework", "article", "tool", "search_query", "existing_asset", "other"];
const PROVENANCE_VALUES: DevelopmentResource["provenance"][] = ["existing_research", "existing_asset", "web_research", "search_query", "fallback"];

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

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, ...parts: unknown[]): string {
  const value = parts.map(normalize).filter(Boolean).join("|") || prefix;
  return `${prefix}-${stableHash(value)}`;
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

function parseMethod(value: unknown): DevelopmentMethod | null {
  const method = normalize(value).replace(/\s+/g, "_") as DevelopmentMethod;
  return METHOD_VALUES.includes(method) ? method : null;
}

function parseModuleType(value: unknown, fallback: DevelopmentModuleType): DevelopmentModuleType {
  const type = normalize(value).replace(/\s+/g, "_") as DevelopmentModuleType;
  return MODULE_VALUES.includes(type) ? type : fallback;
}

function parseResourceType(value: unknown): DevelopmentResourceType {
  const type = normalize(value).replace(/\s+/g, "_") as DevelopmentResourceType;
  return RESOURCE_VALUES.includes(type) ? type : "other";
}

function parseScope(value: unknown, fallback: Exclude<DevelopmentScope, "maintenance">): Exclude<DevelopmentScope, "maintenance"> {
  const scope = normalize(value).replace(/\s+/g, "_") as DevelopmentScope;
  if (scope === "core" || scope === "enhancement" || scope === "conditional") return scope;
  return fallback;
}

function parseProvenance(value: unknown, url: string, type: DevelopmentResourceType): DevelopmentResource["provenance"] {
  const provenance = normalize(value).replace(/\s+/g, "_") as DevelopmentResource["provenance"];
  if (PROVENANCE_VALUES.includes(provenance)) return provenance;
  if (type === "search_query") return "search_query";
  return url ? "web_research" : "fallback";
}

function validUrl(value: unknown): string {
  const url = compact(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function actionFor(requirement: TargetRequirement, coverage: RequirementCoverage): DevelopmentAction {
  if (coverage.status === "proven") return "maintain";
  if (coverage.status === "unknown") return "verify";
  if (coverage.status === "below_bar") return "strengthen";
  if (requirement.category === "evidence" || requirement.category === "narrative") return "demonstrate";
  if (coverage.status === "partially_proven") return "strengthen";
  return "build";
}

function scopeFor(requirement: TargetRequirement, action: DevelopmentAction, roleFamilyCount: number): DevelopmentScope {
  if (action === "maintain") return "maintenance";
  if (requirement.scope === "role_specific" && roleFamilyCount > 1) return "conditional";
  if (requirement.importance === "contextual") return "conditional";
  if (requirement.importance === "differentiator") return "enhancement";
  return "core";
}

function decisionReason(requirement: TargetRequirement, coverage: RequirementCoverage, action: DevelopmentAction): string {
  if (action === "maintain") return `Existing evidence currently meets the success bar for this ${requirement.importance} requirement.`;
  if (action === "verify") return `Anchor lacks enough relevant evidence to assess this requirement, so the plan must verify the current position before prescribing development.`;
  if (action === "demonstrate") return coverage.status === "partially_proven"
    ? "Related capability is visible, but the target requires clearer proof or positioning."
    : "The requirement is not yet evidenced and is best addressed by producing or packaging credible proof.";
  if (action === "strengthen") return coverage.status === "below_bar"
    ? "Explicit evidence indicates the current standard needs improvement."
    : "Relevant evidence exists, but it does not yet meet the target success bar.";
  return "The requirement is materially relevant to the target and is not yet supported by adequate evidence.";
}

function deriveDecisions(requirementModel: RequirementModel, coverageModel: CoverageModel): RequirementDevelopmentDecision[] {
  const coverageByRequirement = new Map(coverageModel.coverage.map((coverage) => [coverage.requirementId, coverage]));
  return requirementModel.requirements.map((requirement) => {
    const coverage = coverageByRequirement.get(requirement.id) || {
      requirementId: requirement.id,
      status: "unknown" as CoverageStatus,
      confidence: "low" as const,
      evidenceItemIds: [],
      reason: "No coverage assessment was available.",
      successBarAssessment: "Not assessed.",
      evidenceStillNeeded: [`Evidence that demonstrates: ${requirement.successBar}`],
      sourceBasis: "deterministic" as const,
    };
    const action = actionFor(requirement, coverage);
    return {
      requirementId: requirement.id,
      coverageStatus: coverage.status,
      action,
      scope: scopeFor(requirement, action, requirementModel.roleFamilies.length),
      reason: decisionReason(requirement, coverage, action),
      desiredEvidence: requirement.successBar,
      evidenceStillNeeded: uniqueStrings(coverage.evidenceStillNeeded).slice(0, 4),
    };
  });
}

type WorkstreamBucket = "capability" | "experience" | "proof_positioning" | "access" | "formal_gates";

function bucketFor(category: RequirementCategory): WorkstreamBucket {
  if (category === "knowledge" || category === "skill") return "capability";
  if (category === "experience") return "experience";
  if (category === "evidence" || category === "narrative") return "proof_positioning";
  if (category === "network" || category === "access") return "access";
  return "formal_gates";
}

const BUCKET_META: Record<WorkstreamBucket, { title: string; objective: string; rationale: string }> = {
  capability: {
    title: "Build role-ready capability",
    objective: "Develop and apply the knowledge, skills, and judgement required to perform the target work.",
    rationale: "Learning only creates value when it is combined with practice, application, and an observable standard.",
  },
  experience: {
    title: "Build relevant applied experience",
    objective: "Create credible experience in contexts that resemble the target role's real work.",
    rationale: "Experience requirements need applied responsibility and reflection, not passive study alone.",
  },
  proof_positioning: {
    title: "Create credible proof and positioning",
    objective: "Turn capability and experience into outputs and a narrative that target employers can inspect and understand.",
    rationale: "Being able to do the work and being believed are separate requirements; this workstream closes the credibility layer.",
  },
  access: {
    title: "Build relationships and hiring access",
    objective: "Develop the relationships, market knowledge, and entry routes required to reach relevant opportunities.",
    rationale: "A target can be understood and technically achievable while remaining inaccessible without relationships or hiring routes.",
  },
  formal_gates: {
    title: "Resolve credentials and eligibility",
    objective: "Verify and resolve formal credentials, authorizations, language, location, clearance, or other eligibility conditions.",
    rationale: "Formal gates should be verified before the user invests significant time or money in addressing them.",
  },
};

function methodFor(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): DevelopmentMethod {
  if (decision.action === "verify") return "verify";
  if (decision.action === "maintain") return "maintain";
  if (requirement.category === "knowledge") return "learn";
  if (requirement.category === "skill") return "practice";
  if (requirement.category === "experience") return "gain_experience";
  if (requirement.category === "evidence") return "create_proof";
  if (requirement.category === "narrative") return "position";
  if (requirement.category === "network") return "build_relationships";
  if (requirement.category === "access") return "build_access";
  if (requirement.category === "credential") return "resolve_credential";
  return "resolve_eligibility";
}

function moduleTypeFor(requirement: TargetRequirement, decision: RequirementDevelopmentDecision): DevelopmentModuleType {
  if (decision.action === "verify") return "verification";
  if (requirement.category === "knowledge") return "syllabus";
  if (requirement.category === "skill") return "practice";
  if (requirement.category === "experience") return "experience";
  if (requirement.category === "evidence") return "proof";
  if (requirement.category === "narrative") return "narrative";
  if (requirement.category === "network") return "relationships";
  if (requirement.category === "access") return "access";
  if (requirement.category === "credential") return "credential";
  return "eligibility";
}

function moduleTitle(type: DevelopmentModuleType): string {
  const labels: Record<DevelopmentModuleType, string> = {
    syllabus: "Knowledge syllabus",
    practice: "Applied practice",
    experience: "Relevant experience",
    proof: "Proof portfolio",
    narrative: "Positioning narrative",
    relationships: "Relationship development",
    access: "Hiring access",
    credential: "Credential route",
    eligibility: "Eligibility resolution",
    verification: "Evidence verification",
  };
  return labels[type];
}

function moduleOutput(type: DevelopmentModuleType, requirements: TargetRequirement[]): string {
  const labels = requirements.map((requirement) => requirement.label).join(", ");
  if (type === "syllabus") return `A reusable synthesis that applies ${labels} to a realistic target-role problem.`;
  if (type === "practice") return `Assessed practice evidence demonstrating ${labels}.`;
  if (type === "experience") return `A documented applied example that demonstrates ${labels} in a relevant context.`;
  if (type === "proof") return `An inspectable portfolio output demonstrating ${labels}.`;
  if (type === "narrative") return `A consistent positioning narrative covering ${labels}.`;
  if (type === "relationships") return `Relevant active relationships that support ${labels}.`;
  if (type === "access") return `A documented hiring route, introduction, or entry path supporting ${labels}.`;
  if (type === "credential") return `Verified evidence of the required credential or an evidence-backed accepted alternative.`;
  if (type === "eligibility") return `Verified resolution of the formal eligibility condition.`;
  return `Evidence sufficient to assess current coverage of ${labels}.`;
}

function defaultActivities(type: DevelopmentModuleType, decisions: RequirementDevelopmentDecision[]): string[] {
  if (type === "verification") return uniqueStrings(decisions.flatMap((decision) => decision.evidenceStillNeeded)).slice(0, 5);
  if (type === "syllabus") return ["Build a structured syllabus around the required concepts and frameworks.", "Apply the concepts to at least one realistic target-role problem.", "Synthesize the learning into a reusable output rather than stopping at consumption."];
  if (type === "practice") return ["Define representative exercises that mirror the target work.", "Complete repeated practice with an observable quality standard.", "Capture feedback and revise the approach until the success bar is met."];
  if (type === "experience") return ["Identify a realistic context in which the requirement can be applied.", "Take responsibility for an outcome that resembles the target work.", "Document the decisions, contribution, and result as evidence."];
  if (type === "proof") return ["Define the smallest credible proof artifact.", "Produce and refine the artifact against the requirement success bars.", "Make the finished output inspectable and reusable across the target."];
  if (type === "narrative") return ["Translate existing evidence into a coherent target-specific story.", "Align the story across CV, outreach, and interview contexts.", "Test the narrative for clarity, specificity, and credibility."];
  if (type === "relationships") return ["Map the relationship types that provide unique insight or access.", "Develop substantive interactions rather than collecting names.", "Capture what each relationship reveals or enables."];
  if (type === "access") return ["Map the credible hiring routes for the relevant role families.", "Establish at least one realistic entry path or introduction route.", "Document access evidence and remaining route constraints."];
  if (type === "credential") return ["Verify whether the credential is genuinely required and in which contexts.", "Compare credible routes and accepted alternatives.", "Complete or document the selected resolution route."];
  return ["Verify the exact eligibility condition and its scope.", "Identify acceptable evidence or resolution routes.", "Record the resolved condition or the remaining formal constraint."];
}

function fallbackResources(type: DevelopmentModuleType, requirements: TargetRequirement[]): DevelopmentResource[] {
  if (type !== "syllabus" && type !== "credential" && type !== "eligibility") return [];
  const query = type === "syllabus"
    ? `${requirements.map((requirement) => requirement.label).join(" ")} authoritative course book framework report`
    : `${requirements.map((requirement) => requirement.label).join(" ")} official requirements accepted alternatives`;
  return [{
    title: query,
    type: "search_query",
    url: "",
    why: "A precise fallback search query when an evidence-backed resource has not yet been identified.",
    provenance: "search_query",
  }];
}

function fallbackModules(
  bucketRequirements: TargetRequirement[],
  decisionsByRequirement: Map<string, RequirementDevelopmentDecision>,
): DevelopmentModule[] {
  const groups = new Map<DevelopmentModuleType, TargetRequirement[]>();
  for (const requirement of bucketRequirements) {
    const decision = decisionsByRequirement.get(requirement.id);
    if (!decision || decision.action === "maintain") continue;
    const type = moduleTypeFor(requirement, decision);
    groups.set(type, [...(groups.get(type) || []), requirement]);
  }
  return [...groups.entries()].map(([type, requirements]) => {
    const decisions = requirements.map((requirement) => decisionsByRequirement.get(requirement.id)).filter(Boolean) as RequirementDevelopmentDecision[];
    const scope: Exclude<DevelopmentScope, "maintenance"> = decisions.some((decision) => decision.scope === "core")
      ? "core"
      : decisions.some((decision) => decision.scope === "enhancement")
        ? "enhancement"
        : "conditional";
    return {
      id: stableId("development-module", type, ...requirements.map((requirement) => requirement.id)),
      title: moduleTitle(type),
      type,
      scope,
      objective: `Improve coverage of ${requirements.map((requirement) => requirement.label).join(", ")}.`,
      requirementIds: requirements.map((requirement) => requirement.id),
      resources: fallbackResources(type, requirements),
      activities: defaultActivities(type, decisions),
      output: moduleOutput(type, requirements),
      assessmentCriteria: requirements.map((requirement) => requirement.successBar),
    };
  });
}

function fallbackMilestones(bucket: WorkstreamBucket, modules: DevelopmentModule[]): DevelopmentMilestone[] {
  const requirementIds = uniqueStrings(modules.flatMap((module) => module.requirementIds));
  if (!requirementIds.length) return [];
  const labels: Record<WorkstreamBucket, Array<{ label: string; doneWhen: string; evidence: string }>> = {
    capability: [
      { label: "Development architecture defined", doneWhen: "The syllabus and practice structure cover each linked requirement and its success bar.", evidence: "A structured capability-development architecture." },
      { label: "Capability applied", doneWhen: "The linked knowledge and skills have been applied to realistic target-role problems.", evidence: "Applied practice and synthesis outputs." },
      { label: "Capability assessed", doneWhen: "The outputs have been assessed against the target success bars and revised where needed.", evidence: "Assessment notes and improved outputs." },
    ],
    experience: [
      { label: "Relevant context secured", doneWhen: "A credible context exists in which the linked requirements can be applied.", evidence: "Defined responsibility, context, and intended outcome." },
      { label: "Applied experience completed", doneWhen: "The user has taken responsibility for a result resembling the target work.", evidence: "A completed applied experience." },
      { label: "Experience documented", doneWhen: "The contribution, judgement, and result are documented as reusable evidence.", evidence: "An evidence-backed experience story." },
    ],
    proof_positioning: [
      { label: "Proof brief defined", doneWhen: "The intended audience, claim, format, and linked success bars are explicit.", evidence: "A proof-asset brief." },
      { label: "Proof produced", doneWhen: "The output exists in an inspectable, target-relevant form.", evidence: "A completed proof artifact." },
      { label: "Positioning aligned", doneWhen: "The evidence and transition narrative are consistent across relevant career materials.", evidence: "A coherent positioning package." },
    ],
    access: [
      { label: "Relationship and access map defined", doneWhen: "The relevant relationship types and hiring routes are mapped to the target role families.", evidence: "A relationship and route map." },
      { label: "Relevant interactions established", doneWhen: "Substantive interactions or entry routes exist for the linked requirements.", evidence: "Relationship and access evidence." },
      { label: "Market learning captured", doneWhen: "Insights from relationships and routes are recorded and linked back to the target model.", evidence: "Structured interaction notes and route updates." },
    ],
    formal_gates: [
      { label: "Formal gate verified", doneWhen: "The exact credential or eligibility requirement, scope, and accepted alternatives are confirmed.", evidence: "An evidence-backed gate assessment." },
      { label: "Resolution route selected", doneWhen: "A proportionate route to resolve the confirmed condition is defined.", evidence: "A documented resolution route." },
      { label: "Formal condition resolved", doneWhen: "The required evidence exists or the remaining constraint is explicitly documented.", evidence: "Credential or eligibility evidence." },
    ],
  };
  return labels[bucket].map((item, index) => ({
    id: stableId("development-milestone", bucket, index, ...requirementIds),
    label: item.label,
    sequence: index + 1,
    requirementIds,
    doneWhen: item.doneWhen,
    evidenceCreated: item.evidence,
  }));
}

function buildFallbackWorkstreams(requirementModel: RequirementModel, decisions: RequirementDevelopmentDecision[]): DevelopmentWorkstream[] {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const decisionsByRequirement = new Map(decisions.map((decision) => [decision.requirementId, decision]));
  const buckets = new Map<WorkstreamBucket, TargetRequirement[]>();
  for (const decision of decisions) {
    if (decision.action === "maintain") continue;
    const requirement = requirementById.get(decision.requirementId);
    if (!requirement) continue;
    const bucket = bucketFor(requirement.category);
    buckets.set(bucket, [...(buckets.get(bucket) || []), requirement]);
  }
  return [...buckets.entries()].map(([bucket, requirements]) => {
    const meta = BUCKET_META[bucket];
    const modules = fallbackModules(requirements, decisionsByRequirement);
    const methods = uniqueStrings(requirements.map((requirement) => methodFor(requirement, decisionsByRequirement.get(requirement.id)!)))
      .map(parseMethod)
      .filter((method): method is DevelopmentMethod => Boolean(method));
    return {
      id: stableId("development-workstream", bucket, ...requirements.map((requirement) => requirement.id)),
      title: meta.title,
      objective: meta.objective,
      rationale: meta.rationale,
      scopeMix: uniqueStrings(requirements.map((requirement) => decisionsByRequirement.get(requirement.id)?.scope || "core"))
        .filter((scope): scope is Exclude<DevelopmentScope, "maintenance"> => scope === "core" || scope === "enhancement" || scope === "conditional"),
      requirementIds: requirements.map((requirement) => requirement.id),
      methods,
      modules,
      milestones: fallbackMilestones(bucket, modules),
      dependencyNotes: [],
      completionStandard: `Every linked requirement is either evidenced at its success bar or has a documented reason it remains conditional or unresolved.`,
    };
  });
}

function fallbackModuleType(requirements: TargetRequirement[], decisionsByRequirement: Map<string, RequirementDevelopmentDecision>): DevelopmentModuleType {
  const requirement = requirements[0];
  const decision = requirement ? decisionsByRequirement.get(requirement.id) : undefined;
  return requirement && decision ? moduleTypeFor(requirement, decision) : "verification";
}

function sanitizeResource(raw: any): DevelopmentResource | null {
  const title = compact(raw?.title);
  if (!title) return null;
  const type = parseResourceType(raw?.type);
  const url = validUrl(raw?.url);
  return {
    title,
    type,
    url,
    why: compact(raw?.why) || "Supports this development module.",
    provenance: parseProvenance(raw?.provenance, url, type),
  };
}

function sanitizeModule(
  raw: any,
  workstreamRequirementIds: string[],
  requirementById: Map<string, TargetRequirement>,
  decisionsByRequirement: Map<string, RequirementDevelopmentDecision>,
): DevelopmentModule | null {
  const requirementIds = uniqueStrings(raw?.requirementIds || []).filter((id) => workstreamRequirementIds.includes(id) && decisionsByRequirement.get(id)?.action !== "maintain");
  if (!requirementIds.length) return null;
  const requirements = requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  const decisions = requirementIds.map((id) => decisionsByRequirement.get(id)).filter(Boolean) as RequirementDevelopmentDecision[];
  const fallbackType = fallbackModuleType(requirements, decisionsByRequirement);
  const type = parseModuleType(raw?.type, fallbackType);
  const fallbackScope: Exclude<DevelopmentScope, "maintenance"> = decisions.some((decision) => decision.scope === "core")
    ? "core"
    : decisions.some((decision) => decision.scope === "enhancement")
      ? "enhancement"
      : "conditional";
  const resources = (Array.isArray(raw?.resources) ? raw.resources : []).map(sanitizeResource).filter(Boolean) as DevelopmentResource[];
  return {
    id: stableId("development-module", raw?.title || type, ...requirementIds),
    title: compact(raw?.title) || moduleTitle(type),
    type,
    scope: parseScope(raw?.scope, fallbackScope),
    objective: compact(raw?.objective) || `Improve coverage of ${requirements.map((requirement) => requirement.label).join(", ")}.`,
    requirementIds,
    resources: resources.slice(0, 8),
    activities: uniqueStrings(raw?.activities || []).slice(0, 8),
    output: compact(raw?.output) || moduleOutput(type, requirements),
    assessmentCriteria: uniqueStrings(raw?.assessmentCriteria || requirements.map((requirement) => requirement.successBar)).slice(0, 8),
  };
}

function sanitizeMilestone(raw: any, workstreamRequirementIds: string[], index: number): DevelopmentMilestone | null {
  const label = compact(raw?.label);
  if (!label) return null;
  const requirementIds = uniqueStrings(raw?.requirementIds || []).filter((id) => workstreamRequirementIds.includes(id));
  return {
    id: stableId("development-milestone", label, index, ...requirementIds),
    label,
    sequence: Number.isFinite(Number(raw?.sequence)) ? Math.max(1, Math.round(Number(raw.sequence))) : index + 1,
    requirementIds: requirementIds.length ? requirementIds : workstreamRequirementIds,
    doneWhen: compact(raw?.doneWhen) || "The milestone's linked requirements have observable evidence against their success bars.",
    evidenceCreated: compact(raw?.evidenceCreated) || "Reusable evidence linked to the target requirements.",
  };
}

function sanitizeWorkstream(
  raw: any,
  requirementById: Map<string, TargetRequirement>,
  decisionsByRequirement: Map<string, RequirementDevelopmentDecision>,
): DevelopmentWorkstream | null {
  const requirementIds = uniqueStrings(raw?.requirementIds || [])
    .filter((id) => requirementById.has(id) && decisionsByRequirement.get(id)?.action !== "maintain");
  if (!requirementIds.length) return null;
  const requirements = requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  const modules = (Array.isArray(raw?.modules) ? raw.modules : [])
    .map((module: any) => sanitizeModule(module, requirementIds, requirementById, decisionsByRequirement))
    .filter(Boolean) as DevelopmentModule[];
  const coveredByModule = new Set(modules.flatMap((module) => module.requirementIds));
  const missingModuleRequirements = requirements.filter((requirement) => !coveredByModule.has(requirement.id));
  if (missingModuleRequirements.length) {
    modules.push(...fallbackModules(missingModuleRequirements, decisionsByRequirement));
  }
  const milestones = (Array.isArray(raw?.milestones) ? raw.milestones : [])
    .map((milestone: any, index: number) => sanitizeMilestone(milestone, requirementIds, index))
    .filter(Boolean) as DevelopmentMilestone[];
  const bucket = bucketFor(requirements[0]?.category || "skill");
  const fallback = BUCKET_META[bucket];
  return {
    id: stableId("development-workstream", raw?.title || fallback.title, ...requirementIds),
    title: compact(raw?.title) || fallback.title,
    objective: compact(raw?.objective) || fallback.objective,
    rationale: compact(raw?.rationale) || fallback.rationale,
    scopeMix: uniqueStrings(requirementIds.map((id) => decisionsByRequirement.get(id)?.scope || "core"))
      .filter((scope): scope is Exclude<DevelopmentScope, "maintenance"> => scope === "core" || scope === "enhancement" || scope === "conditional"),
    requirementIds,
    methods: uniqueStrings(raw?.methods || requirementIds.map((id) => methodFor(requirementById.get(id)!, decisionsByRequirement.get(id)!)))
      .map(parseMethod)
      .filter((method): method is DevelopmentMethod => Boolean(method)),
    modules,
    milestones: (milestones.length ? milestones : fallbackMilestones(bucket, modules)).sort((left, right) => left.sequence - right.sequence).slice(0, 6),
    dependencyNotes: uniqueStrings(raw?.dependencyNotes || []).slice(0, 6),
    completionStandard: compact(raw?.completionStandard) || `Every linked requirement is evidenced at its success bar or explicitly documented as conditional or unresolved.`,
  };
}

function mergeMissingRequirements(
  workstreams: DevelopmentWorkstream[],
  fallback: DevelopmentWorkstream[],
  decisions: RequirementDevelopmentDecision[],
): DevelopmentWorkstream[] {
  const activeIds = decisions.filter((decision) => decision.action !== "maintain").map((decision) => decision.requirementId);
  const assigned = new Set(workstreams.flatMap((workstream) => workstream.requirementIds));
  const missing = new Set(activeIds.filter((id) => !assigned.has(id)));
  if (!missing.size) return workstreams;
  const result = [...workstreams];
  for (const fallbackWorkstream of fallback) {
    const requirementIds = fallbackWorkstream.requirementIds.filter((id) => missing.has(id));
    if (!requirementIds.length) continue;
    const existing = result.find((workstream) => normalize(workstream.title) === normalize(fallbackWorkstream.title));
    if (existing) {
      const moduleIds = new Set(existing.modules.flatMap((module) => module.requirementIds));
      existing.requirementIds = uniqueStrings([...existing.requirementIds, ...requirementIds]);
      existing.modules.push(...fallbackWorkstream.modules.filter((module) => module.requirementIds.some((id) => requirementIds.includes(id) && !moduleIds.has(id))));
      existing.milestones = existing.milestones.length ? existing.milestones : fallbackWorkstream.milestones;
      existing.methods = uniqueStrings([...existing.methods, ...fallbackWorkstream.methods]).map(parseMethod).filter((method): method is DevelopmentMethod => Boolean(method));
      existing.scopeMix = uniqueStrings([...existing.scopeMix, ...fallbackWorkstream.scopeMix])
        .filter((scope): scope is Exclude<DevelopmentScope, "maintenance"> => scope === "core" || scope === "enhancement" || scope === "conditional");
    } else {
      result.push({
        ...fallbackWorkstream,
        requirementIds,
        modules: fallbackWorkstream.modules.map((module) => ({ ...module, requirementIds: module.requirementIds.filter((id) => requirementIds.includes(id)) })).filter((module) => module.requirementIds.length > 0),
        milestones: fallbackWorkstream.milestones.map((milestone) => ({ ...milestone, requirementIds: milestone.requirementIds.filter((id) => requirementIds.includes(id)) })),
      });
    }
    requirementIds.forEach((id) => missing.delete(id));
  }
  return result;
}

function coverageFingerprint(coverageModel: CoverageModel): string {
  const value = coverageModel.coverage
    .map((coverage) => `${coverage.requirementId}:${coverage.status}:${coverage.confidence}:${coverage.evidenceItemIds.slice().sort().join(",")}`)
    .sort()
    .join("|");
  return stableHash(`${coverageModel.requirementModelFingerprint}|${coverageModel.userEvidenceFingerprint}|${value}`);
}

function buildQuality(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  decisions: RequirementDevelopmentDecision[],
  workstreams: DevelopmentWorkstream[],
  qualityNotes: string[],
): DevelopmentPlanModel["quality"] {
  const activeDecisions = decisions.filter((decision) => decision.action !== "maintain");
  const assigned = new Set(workstreams.flatMap((workstream) => workstream.requirementIds));
  const unassignedRequirementIds = activeDecisions.map((decision) => decision.requirementId).filter((id) => !assigned.has(id));
  const coreRequirementIds = decisions.filter((decision) => decision.scope === "core").map((decision) => decision.requirementId);
  const coveredCoreRequirementCount = coreRequirementIds.filter((id) => assigned.has(id) || decisions.find((decision) => decision.requirementId === id)?.action === "maintain").length;
  const caveats = uniqueStrings(qualityNotes);
  if (coverageModel.quality.status === "provisional") caveats.push("The coverage assessment is provisional, so verification modules should be completed before expensive development decisions.");
  if (requirementModel.researchQuality.status === "provisional") caveats.push("The market requirement model is provisional; formal gates and costly interventions need stronger source evidence.");
  if (unassignedRequirementIds.length) caveats.push(`${unassignedRequirementIds.length} uncovered requirement${unassignedRequirementIds.length === 1 ? " is" : "s are"} not yet assigned to a workstream.`);
  if (workstreams.length > 6) caveats.push("The plan contains more than six workstreams and may need consolidation before execution planning.");
  const status: DevelopmentPlanModel["quality"]["status"] = !unassignedRequirementIds.length && coverageModel.quality.status !== "provisional" && workstreams.length <= 6
    ? "strong"
    : !unassignedRequirementIds.length
      ? "usable"
      : "provisional";
  return {
    status,
    coreRequirementCount: coreRequirementIds.length,
    coveredCoreRequirementCount,
    plannedRequirementCount: activeDecisions.length,
    maintenanceRequirementCount: decisions.filter((decision) => decision.scope === "maintenance").length,
    conditionalRequirementCount: decisions.filter((decision) => decision.scope === "conditional").length,
    enhancementRequirementCount: decisions.filter((decision) => decision.scope === "enhancement").length,
    unassignedRequirementIds,
    caveats,
  };
}

export function buildDevelopmentPlanModel(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  sourceContextFingerprint: string,
  synthesis: DevelopmentPlanSynthesis | null = null,
): DevelopmentPlanModel {
  const decisions = deriveDecisions(requirementModel, coverageModel);
  const fallback = buildFallbackWorkstreams(requirementModel, decisions);
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const decisionsByRequirement = new Map(decisions.map((decision) => [decision.requirementId, decision]));
  const rawWorkstreams = Array.isArray(synthesis?.workstreams) ? synthesis!.workstreams! : [];
  const synthesized = rawWorkstreams
    .map((workstream) => sanitizeWorkstream(workstream, requirementById, decisionsByRequirement))
    .filter(Boolean) as DevelopmentWorkstream[];
  const workstreams = mergeMissingRequirements(synthesized.length ? synthesized : fallback, fallback, decisions)
    .filter((workstream) => workstream.requirementIds.length > 0)
    .slice(0, 8);
  const maintenanceRequirementIds = decisions.filter((decision) => decision.action === "maintain").map((decision) => decision.requirementId);
  const planSummary = compact(synthesis?.planSummary) || (workstreams.length
    ? `A ${workstreams.length}-workstream plan to build, strengthen, demonstrate, or verify the requirements not yet fully evidenced for ${requirementModel.target.label}.`
    : `The available evidence currently meets the target requirements; the development plan is focused on maintaining and reusing existing evidence.`);
  return {
    mode: "development_plan_model",
    version: DEVELOPMENT_PLAN_MODEL_VERSION,
    targetLabel: requirementModel.target.label,
    requirementModelFingerprint: requirementModel.sourceFingerprint,
    coverageFingerprint: coverageFingerprint(coverageModel),
    sourceContextFingerprint,
    planSummary,
    decisions,
    workstreams,
    maintenanceRequirementIds,
    quality: buildQuality(requirementModel, coverageModel, decisions, workstreams, synthesis?.qualityNotes || []),
    generatedAt: Date.now(),
  };
}

export function developmentPlanCoverageFingerprint(coverageModel: CoverageModel): string {
  return coverageFingerprint(coverageModel);
}
