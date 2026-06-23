import type { RequirementCategory, RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { CoverageModel, CoverageStatus, RequirementCoverage } from "./trackResearchCoverageModel";
import type {
  DevelopmentAction,
  DevelopmentMethod,
  DevelopmentModule,
  DevelopmentModuleType,
  DevelopmentPlanModel,
  DevelopmentScope,
  DevelopmentWorkstream,
  RequirementDevelopmentDecision,
} from "./trackResearchDevelopmentPlan";

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
  return `${prefix}-${stableHash(parts.map(normalize).filter(Boolean).join("|") || prefix)}`;
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

function expectedAction(requirement: TargetRequirement, coverage: RequirementCoverage): DevelopmentAction {
  if (coverage.status === "proven") return "maintain";
  if (coverage.status === "unknown") return "verify";
  if ((requirement.category === "credential" || requirement.category === "eligibility") && requirement.confidence !== "high") return "verify";
  if (coverage.status === "below_bar") return "strengthen";
  if (requirement.category === "evidence" || requirement.category === "narrative") return "demonstrate";
  if (coverage.status === "partially_proven") return "strengthen";
  return "build";
}

function expectedScope(requirement: TargetRequirement, action: DevelopmentAction, roleFamilyCount: number): DevelopmentScope {
  if (action === "maintain") return "maintenance";
  if (requirement.scope === "role_specific" && roleFamilyCount > 1) return "conditional";
  if (requirement.importance === "contextual") return "conditional";
  if (requirement.importance === "differentiator") return "enhancement";
  return "core";
}

function reasonFor(requirement: TargetRequirement, coverage: RequirementCoverage, action: DevelopmentAction): string {
  if (action === "maintain") return `Existing evidence meets the current success bar for ${requirement.label}; retain and reuse the strongest proof.`;
  if (action === "verify") {
    if (requirement.category === "credential" || requirement.category === "eligibility") {
      return `${requirement.label} could require significant time, money, or formal action. Verify that it genuinely applies before prescribing development.`;
    }
    return `Anchor does not yet have enough relevant evidence to assess ${requirement.label}, so verification must precede development.`;
  }
  if (action === "demonstrate") return `The main need is credible proof or positioning against the success bar for ${requirement.label}.`;
  if (action === "strengthen") return coverage.status === "below_bar"
    ? `Explicit evidence indicates that ${requirement.label} needs strengthening to reach the target standard.`
    : `${requirement.label} is partly evidenced but does not yet meet the success bar consistently.`;
  return `${requirement.label} is materially relevant and is not yet supported by sufficient evidence of the underlying asset.`;
}

function hardenDecisions(model: DevelopmentPlanModel, requirementModel: RequirementModel, coverageModel: CoverageModel): RequirementDevelopmentDecision[] {
  const coverageById = new Map(coverageModel.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const originalById = new Map(model.decisions.map((decision) => [decision.requirementId, decision]));
  return requirementModel.requirements.map((requirement) => {
    const coverage = coverageById.get(requirement.id) || {
      requirementId: requirement.id,
      status: "unknown" as CoverageStatus,
      confidence: "low" as const,
      evidenceItemIds: [],
      reason: "No coverage assessment is available.",
      successBarAssessment: "Not assessed.",
      evidenceStillNeeded: [`Evidence that demonstrates: ${requirement.successBar}`],
      sourceBasis: "deterministic" as const,
    };
    const original = originalById.get(requirement.id);
    const action = expectedAction(requirement, coverage);
    return {
      requirementId: requirement.id,
      coverageStatus: coverage.status,
      action,
      scope: expectedScope(requirement, action, requirementModel.roleFamilies.length),
      reason: original?.action === action && compact(original.reason) ? original.reason : reasonFor(requirement, coverage, action),
      desiredEvidence: requirement.successBar,
      evidenceStillNeeded: uniqueStrings(coverage.evidenceStillNeeded).slice(0, 4),
    };
  });
}

function expectedModuleType(requirement: TargetRequirement, action: DevelopmentAction): DevelopmentModuleType {
  if (action === "verify") return "verification";
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

function expectedMethod(requirement: TargetRequirement, action: DevelopmentAction): DevelopmentMethod {
  if (action === "verify") return "verify";
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

function moduleTypeCompatible(type: DevelopmentModuleType, requirement: TargetRequirement, decision: RequirementDevelopmentDecision): boolean {
  if (decision.action === "verify") return type === "verification";
  if (type === expectedModuleType(requirement, decision.action)) return true;
  if (type === "proof") return ["knowledge", "skill", "evidence", "narrative"].includes(requirement.category);
  if (type === "experience") return ["knowledge", "skill", "experience"].includes(requirement.category);
  if (type === "practice") return requirement.category === "knowledge" || requirement.category === "skill";
  if (type === "relationships" || type === "access") return requirement.category === "network" || requirement.category === "access";
  if (type === "credential" || type === "eligibility") return requirement.category === "credential" || requirement.category === "eligibility";
  return false;
}

function derivedScope(decisions: RequirementDevelopmentDecision[]): Exclude<DevelopmentScope, "maintenance"> {
  if (decisions.some((decision) => decision.scope === "core")) return "core";
  if (decisions.some((decision) => decision.scope === "enhancement")) return "enhancement";
  return "conditional";
}

function fallbackActivities(type: DevelopmentModuleType, decisions: RequirementDevelopmentDecision[]): string[] {
  if (type === "verification") return uniqueStrings(decisions.flatMap((decision) => decision.evidenceStillNeeded)).slice(0, 5);
  if (type === "syllabus") return ["Structure the concepts and frameworks required by the target.", "Apply them to a realistic target-role problem.", "Synthesize the learning into a reusable output."];
  if (type === "practice") return ["Define practice that mirrors the target work.", "Use feedback against an observable quality bar.", "Revise until the linked success bars are met."];
  if (type === "experience") return ["Identify a realistic applied context.", "Take responsibility for a relevant outcome.", "Document the contribution and result as evidence."];
  if (type === "proof") return ["Define the smallest credible artifact.", "Produce it against the linked success bars.", "Make the final output inspectable and reusable."];
  if (type === "narrative") return ["Translate existing evidence into a target-specific story.", "Align the story across relevant materials.", "Test it for clarity and credibility."];
  if (type === "relationships") return ["Identify the relationship types that add unique value.", "Develop substantive interactions.", "Capture what each relationship reveals or enables."];
  if (type === "access") return ["Map credible hiring routes.", "Establish a realistic entry path.", "Document the route and remaining constraints."];
  if (type === "credential") return ["Verify that the credential is genuinely required.", "Compare accepted routes and alternatives.", "Document or complete the proportionate resolution route."];
  return ["Verify the exact formal condition.", "Identify accepted evidence or resolution routes.", "Document the resolved condition or remaining constraint."];
}

function fallbackOutput(type: DevelopmentModuleType, requirements: TargetRequirement[]): string {
  const labels = requirements.map((requirement) => requirement.label).join(", ");
  if (type === "verification") return `Evidence sufficient to assess current coverage of ${labels}.`;
  if (type === "syllabus") return `An applied synthesis demonstrating ${labels}.`;
  if (type === "practice") return `Assessed practice evidence demonstrating ${labels}.`;
  if (type === "experience") return `A documented applied example demonstrating ${labels}.`;
  if (type === "proof") return `An inspectable output demonstrating ${labels}.`;
  if (type === "narrative") return `A consistent target-specific narrative covering ${labels}.`;
  if (type === "relationships") return `Relevant active relationships supporting ${labels}.`;
  if (type === "access") return `A documented entry route supporting ${labels}.`;
  if (type === "credential") return "Verified credential evidence or an accepted alternative.";
  return "Verified resolution of the formal eligibility condition.";
}

function fallbackResource(type: DevelopmentModuleType, requirements: TargetRequirement[]): DevelopmentModule["resources"] {
  if (type !== "syllabus" && type !== "credential" && type !== "eligibility") return [];
  const query = type === "syllabus"
    ? `${requirements.map((requirement) => requirement.label).join(" ")} authoritative course book framework report`
    : `${requirements.map((requirement) => requirement.label).join(" ")} official requirement accepted alternatives`;
  return [{ title: query, type: "search_query", url: "", why: "Fallback research query when no verified resource is linked.", provenance: "search_query" }];
}

function fallbackModule(type: DevelopmentModuleType, requirementIds: string[], requirementById: Map<string, TargetRequirement>, decisionById: Map<string, RequirementDevelopmentDecision>): DevelopmentModule {
  const requirements = requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  const decisions = requirementIds.map((id) => decisionById.get(id)).filter(Boolean) as RequirementDevelopmentDecision[];
  return {
    id: stableId("development-module", type, ...requirementIds),
    title: type === "verification" ? "Evidence verification" : `${type.replace(/_/g, " ")} development`,
    type,
    scope: derivedScope(decisions),
    objective: type === "verification"
      ? `Establish the current position before prescribing development for ${requirements.map((requirement) => requirement.label).join(", ")}.`
      : `Improve coverage of ${requirements.map((requirement) => requirement.label).join(", ")}.`,
    requirementIds,
    resources: fallbackResource(type, requirements),
    activities: fallbackActivities(type, decisions),
    output: fallbackOutput(type, requirements),
    assessmentCriteria: requirements.map((requirement) => requirement.successBar),
  };
}

function preservedModule(module: DevelopmentModule, requirementIds: string[], requirementById: Map<string, TargetRequirement>, decisionById: Map<string, RequirementDevelopmentDecision>): DevelopmentModule {
  const requirements = requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  const decisions = requirementIds.map((id) => decisionById.get(id)).filter(Boolean) as RequirementDevelopmentDecision[];
  return {
    ...module,
    id: stableId("development-module", module.title, module.type, ...requirementIds),
    scope: derivedScope(decisions),
    requirementIds,
    resources: module.resources.length ? module.resources : fallbackResource(module.type, requirements),
    activities: module.activities.length ? module.activities : fallbackActivities(module.type, decisions),
    output: compact(module.output) || fallbackOutput(module.type, requirements),
    assessmentCriteria: uniqueStrings([...module.assessmentCriteria, ...requirements.map((requirement) => requirement.successBar)]).slice(0, 10),
  };
}

function hardenModule(module: DevelopmentModule, workstreamRequirementIds: string[], requirementById: Map<string, TargetRequirement>, decisionById: Map<string, RequirementDevelopmentDecision>): DevelopmentModule[] {
  const validIds = uniqueStrings(module.requirementIds).filter((id) => workstreamRequirementIds.includes(id) && decisionById.get(id)?.action !== "maintain");
  const compatibleIds: string[] = [];
  const fallbackByType = new Map<DevelopmentModuleType, string[]>();
  for (const id of validIds) {
    const requirement = requirementById.get(id);
    const decision = decisionById.get(id);
    if (!requirement || !decision) continue;
    if (moduleTypeCompatible(module.type, requirement, decision)) compatibleIds.push(id);
    else {
      const type = expectedModuleType(requirement, decision.action);
      fallbackByType.set(type, [...(fallbackByType.get(type) || []), id]);
    }
  }
  const result: DevelopmentModule[] = [];
  if (compatibleIds.length) result.push(preservedModule(module, compatibleIds, requirementById, decisionById));
  for (const [type, ids] of fallbackByType) result.push(fallbackModule(type, ids, requirementById, decisionById));
  return result;
}

function bucketTitle(category: RequirementCategory): string {
  if (category === "knowledge" || category === "skill") return "Develop and evidence role-ready capability";
  if (category === "experience") return "Build relevant applied experience";
  if (category === "evidence" || category === "narrative") return "Create credible proof and positioning";
  if (category === "network" || category === "access") return "Build relationships and hiring access";
  return "Resolve credentials and eligibility";
}

function fallbackWorkstream(requirementIds: string[], requirementById: Map<string, TargetRequirement>, decisionById: Map<string, RequirementDevelopmentDecision>): DevelopmentWorkstream {
  const requirements = requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  const typeGroups = new Map<DevelopmentModuleType, string[]>();
  for (const requirement of requirements) {
    const decision = decisionById.get(requirement.id)!;
    const type = expectedModuleType(requirement, decision.action);
    typeGroups.set(type, [...(typeGroups.get(type) || []), requirement.id]);
  }
  const modules = [...typeGroups.entries()].map(([type, ids]) => fallbackModule(type, ids, requirementById, decisionById));
  const title = bucketTitle(requirements[0]?.category || "skill");
  const methods = uniqueStrings(requirements.map((requirement) => expectedMethod(requirement, decisionById.get(requirement.id)!.action))) as DevelopmentMethod[];
  return {
    id: stableId("development-workstream", title, ...requirementIds),
    title,
    objective: `Create sufficient coverage across ${requirements.map((requirement) => requirement.label).join(", ")}.`,
    rationale: "These requirements share a development method or output and can be addressed coherently rather than through duplicate plans.",
    scopeMix: uniqueStrings(requirementIds.map((id) => decisionById.get(id)?.scope || "core")) as Array<Exclude<DevelopmentScope, "maintenance">>,
    requirementIds,
    methods,
    modules,
    milestones: [{
      id: stableId("development-milestone", title, ...requirementIds),
      label: "Requirement coverage created",
      sequence: 1,
      requirementIds,
      doneWhen: "The linked requirements have observable evidence against their success bars.",
      evidenceCreated: "Reusable evidence linked to the target requirements.",
    }],
    dependencyNotes: [],
    completionStandard: "Every linked requirement is evidenced at its success bar or explicitly documented as conditional or unresolved.",
  };
}

export function hardenDevelopmentPlan(model: DevelopmentPlanModel, requirementModel: RequirementModel, coverageModel: CoverageModel): DevelopmentPlanModel {
  const decisions = hardenDecisions(model, requirementModel, coverageModel);
  const decisionById = new Map(decisions.map((decision) => [decision.requirementId, decision]));
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const activeIds = decisions.filter((decision) => decision.action !== "maintain").map((decision) => decision.requirementId);
  const assignedPrimary = new Set<string>();

  const workstreams = model.workstreams.map((workstream) => {
    const requirementIds = uniqueStrings(workstream.requirementIds).filter((id) => activeIds.includes(id) && requirementById.has(id) && !assignedPrimary.has(id));
    requirementIds.forEach((id) => assignedPrimary.add(id));
    if (!requirementIds.length) return null;

    const modules = workstream.modules.flatMap((module) => hardenModule(module, requirementIds, requirementById, decisionById));
    const moduleCoverage = new Set(modules.flatMap((module) => module.requirementIds));
    const missingByType = new Map<DevelopmentModuleType, string[]>();
    for (const id of requirementIds.filter((id) => !moduleCoverage.has(id))) {
      const requirement = requirementById.get(id)!;
      const decision = decisionById.get(id)!;
      const type = expectedModuleType(requirement, decision.action);
      missingByType.set(type, [...(missingByType.get(type) || []), id]);
    }
    modules.push(...[...missingByType.entries()].map(([type, ids]) => fallbackModule(type, ids, requirementById, decisionById)));

    const milestones = workstream.milestones.map((milestone) => ({
      ...milestone,
      requirementIds: uniqueStrings(milestone.requirementIds).filter((id) => requirementIds.includes(id)),
    })).filter((milestone) => milestone.requirementIds.length > 0);
    const milestoneCoverage = new Set(milestones.flatMap((milestone) => milestone.requirementIds));
    const missingMilestoneIds = requirementIds.filter((id) => !milestoneCoverage.has(id));
    if (missingMilestoneIds.length) {
      milestones.push({
        id: stableId("development-milestone", workstream.title, "coverage", ...missingMilestoneIds),
        label: "Remaining requirement evidence created",
        sequence: Math.max(0, ...milestones.map((milestone) => milestone.sequence)) + 1,
        requirementIds: missingMilestoneIds,
        doneWhen: "The remaining linked requirements have observable evidence against their success bars.",
        evidenceCreated: "Reusable evidence linked to the previously uncovered requirements.",
      });
    }

    const requirements = requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
    return {
      ...workstream,
      requirementIds,
      scopeMix: uniqueStrings(requirementIds.map((id) => decisionById.get(id)?.scope || "core")) as Array<Exclude<DevelopmentScope, "maintenance">>,
      methods: uniqueStrings(requirements.map((requirement) => expectedMethod(requirement, decisionById.get(requirement.id)!.action))) as DevelopmentMethod[],
      modules,
      milestones: milestones.sort((left, right) => left.sequence - right.sequence),
    };
  }).filter((workstream): workstream is DevelopmentWorkstream => Boolean(workstream));

  const unassigned = activeIds.filter((id) => !assignedPrimary.has(id));
  const byBucket = new Map<string, string[]>();
  for (const id of unassigned) {
    const requirement = requirementById.get(id);
    if (!requirement) continue;
    const title = bucketTitle(requirement.category);
    byBucket.set(title, [...(byBucket.get(title) || []), id]);
  }
  for (const ids of byBucket.values()) workstreams.push(fallbackWorkstream(ids, requirementById, decisionById));

  const finalAssigned = new Set(workstreams.flatMap((workstream) => workstream.requirementIds));
  const finalUnassigned = activeIds.filter((id) => !finalAssigned.has(id));
  const maintenanceRequirementIds = decisions.filter((decision) => decision.action === "maintain").map((decision) => decision.requirementId);
  const coreRequirementIds = decisions.filter((decision) => decision.scope === "core").map((decision) => decision.requirementId);
  const coveredCoreRequirementCount = coreRequirementIds.filter((id) => maintenanceRequirementIds.includes(id) || finalAssigned.has(id)).length;
  const caveats = uniqueStrings(model.quality.caveats.filter((caveat) => !/unassigned|uncovered|more than six workstreams/i.test(caveat)));
  if (coverageModel.quality.status === "provisional") caveats.push("The coverage assessment is provisional, so verification must precede expensive development decisions.");
  if (workstreams.length > 6) caveats.push("The plan contains more than six workstreams and should be consolidated before task decomposition.");
  if (finalUnassigned.length) caveats.push(`${finalUnassigned.length} requirement${finalUnassigned.length === 1 ? " remains" : "s remain"} unassigned.`);

  const status: DevelopmentPlanModel["quality"]["status"] = finalUnassigned.length
    ? "provisional"
    : coverageModel.quality.status !== "provisional" && workstreams.length <= 6
      ? "strong"
      : "usable";

  return {
    ...model,
    decisions,
    workstreams,
    maintenanceRequirementIds,
    quality: {
      status,
      coreRequirementCount: coreRequirementIds.length,
      coveredCoreRequirementCount,
      plannedRequirementCount: activeIds.length,
      maintenanceRequirementCount: maintenanceRequirementIds.length,
      conditionalRequirementCount: decisions.filter((decision) => decision.scope === "conditional").length,
      enhancementRequirementCount: decisions.filter((decision) => decision.scope === "enhancement").length,
      unassignedRequirementIds: finalUnassigned,
      caveats,
    },
  };
}
