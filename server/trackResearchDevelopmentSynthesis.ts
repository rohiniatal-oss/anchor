import { createHash } from "node:crypto";
import { llmJSON, MODEL_PRIMARY } from "./llm";
import type { CoverageModel } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type {
  DevelopmentMethod,
  DevelopmentModule,
  DevelopmentPlanModel,
  DevelopmentResource,
  DevelopmentWorkstream,
  DevelopmentWorkstreamKind,
  DevelopmentMilestone,
} from "./trackResearchDevelopmentPlan";

const allowedMethods: DevelopmentMethod[] = ["learn", "practice", "produce", "connect", "position", "credential", "research"];
const allowedKinds: DevelopmentWorkstreamKind[] = ["core", "route_specific", "verification", "maintenance"];

export type DevelopmentResourceCandidate = Omit<DevelopmentResource, "id" | "sourceEvidenceId"> & {
  sourceTitle?: string;
};

type SynthesizedWorkstream = {
  key: string;
  title: string;
  kind: DevelopmentWorkstreamKind;
  purpose: string;
  outcome: string;
  requirementIds: string[];
  methods: DevelopmentMethod[];
  roleFamilyIds: string[];
  rationale: string;
  modules: Array<{
    title: string;
    objective: string;
    requirementIds: string[];
    concepts: string[];
    resourceIds?: string[];
    practice: string[];
    output: string;
    doneWhen: string;
  }>;
  milestones: Array<{
    title: string;
    outcome: string;
    doneWhen: string;
    requirementIds: string[];
    evidenceGenerated: Array<{ type: DevelopmentMilestone["evidenceGenerated"][number]["type"]; description: string }>;
    dependencyTitles?: string[];
  }>;
  dependencyKeys?: string[];
};

type DevelopmentSynthesis = {
  planLogic: string;
  workstreams: SynthesizedWorkstream[];
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

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 14);
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

function validRequirementIds(values: unknown[], allowed: Set<string>): string[] {
  return uniqueStrings(values).filter((id) => allowed.has(id));
}

function validMethods(values: unknown[]): DevelopmentMethod[] {
  return uniqueStrings(values).filter((method): method is DevelopmentMethod => allowedMethods.includes(method as DevelopmentMethod));
}

function validKind(value: unknown): DevelopmentWorkstreamKind {
  return allowedKinds.includes(value as DevelopmentWorkstreamKind) ? value as DevelopmentWorkstreamKind : "core";
}

function evidenceType(value: unknown): DevelopmentMilestone["evidenceGenerated"][number]["type"] {
  const allowed: DevelopmentMilestone["evidenceGenerated"][number]["type"][] = ["knowledge", "skill", "experience", "output", "relationship", "credential", "market_signal", "other"];
  return allowed.includes(value as any) ? value as any : "other";
}

function requirementPayload(requirementModel: RequirementModel, coverageModel: CoverageModel) {
  const coverageById = new Map(coverageModel.coverage.map((item) => [item.requirementId, item]));
  return requirementModel.requirements.map((requirement) => {
    const coverage = coverageById.get(requirement.id);
    return {
      id: requirement.id,
      label: requirement.label,
      definition: requirement.definition,
      group: requirement.group,
      category: requirement.category,
      importance: requirement.importance,
      scope: requirement.scope,
      roleFamilyIds: requirement.roleFamilyIds,
      successBar: requirement.successBar,
      coverageState: coverage?.state || "unknown",
      coverageReason: coverage?.reason || "No assessment available",
      missingEvidence: coverage?.missingEvidence || requirement.successBar,
    };
  });
}

function synthesisPrompt(requirementModel: RequirementModel, coverageModel: CoverageModel, draft: DevelopmentPlanModel): string {
  const nonMaintenance = draft.workstreams.filter((workstream) => workstream.kind !== "maintenance");
  return `You are Anchor's development-plan architect. The user has already chosen this target. Convert the requirement and coverage models into a detailed, coherent development plan.

TARGET: ${requirementModel.target.label}
TARGET DEFINITION: ${requirementModel.target.definition}

REQUIREMENTS AND COVERAGE:
${JSON.stringify(requirementPayload(requirementModel, coverageModel), null, 2)}

DETERMINISTIC CANDIDATE WORKSTREAMS:
${JSON.stringify(nonMaintenance.map((workstream) => ({
    key: workstream.key,
    title: workstream.title,
    kind: workstream.kind,
    purpose: workstream.purpose,
    outcome: workstream.outcome,
    requirementIds: workstream.requirementIds,
    methods: workstream.methods,
    roleFamilyIds: workstream.roleFamilyIds,
  })), null, 2)}

Return ONLY valid JSON:
{
  "planLogic": "one concise explanation of how the workstreams collectively build target readiness",
  "workstreams": [
    {
      "key": "stable short key",
      "title": "clear outcome-led workstream title",
      "kind": "core|route_specific|verification",
      "purpose": "why this coherent body of development exists",
      "outcome": "what will be materially different when complete",
      "requirementIds": ["exact requirement IDs only"],
      "methods": ["learn|practice|produce|connect|position|credential|research"],
      "roleFamilyIds": ["exact role family IDs only"],
      "rationale": "why these requirements belong together",
      "modules": [
        {
          "title": "module title",
          "objective": "capability or evidence objective",
          "requirementIds": ["exact linked requirement IDs"],
          "concepts": ["concepts to master"],
          "practice": ["applied exercises, not tiny tasks"],
          "output": "artifact or demonstrated outcome",
          "doneWhen": "assessment standard tied to the success bar"
        }
      ],
      "milestones": [
        {
          "title": "durable checkpoint",
          "outcome": "meaningful intermediate outcome",
          "doneWhen": "observable completion standard",
          "requirementIds": ["exact linked requirement IDs"],
          "evidenceGenerated": [{ "type": "knowledge|skill|experience|output|relationship|credential|market_signal|other", "description": "evidence created" }],
          "dependencyTitles": ["titles of earlier milestones only when genuinely required"]
        }
      ],
      "dependencyKeys": ["workstream keys only when genuinely required"]
    }
  ]
}

Rules:
- This is a DEVELOPMENT PLAN, not a task list. Do not create tasks, subtasks, schedules, daily actions, or priority rankings.
- Cover every essential and important requirement. Proven requirements need no development work unless they must be packaged into evidence.
- Unknown coverage must create verification, not an assumption that the user lacks the ability.
- Prefer 3-6 coherent shared workstreams. Keep truly role-specific requirements in modular route-specific workstreams.
- A workstream may improve several requirements; avoid one plan per requirement.
- Learning must include application, synthesis, practice, or output. Do not create passive reading lists.
- Milestones must be output-led and assessed against requirement success bars.
- Use ONLY supplied requirement IDs and role-family IDs.
- Do not invent books, courses, reports, URLs, people, employers, or credentials. Resources are researched separately.
- Preserve meaningful dependencies, but do not impose a fully sequential plan when workstreams can run in parallel.`;
}

function fallbackForMissingRequirement(draft: DevelopmentPlanModel, requirementId: string): DevelopmentWorkstream | null {
  return draft.workstreams.find((workstream) => workstream.requirementIds.includes(requirementId)) || null;
}

function cleanModules(rawModules: SynthesizedWorkstream["modules"], workstreamId: string, workstreamRequirementIds: string[], allowed: Set<string>): DevelopmentModule[] {
  return (Array.isArray(rawModules) ? rawModules : []).map((module, index) => {
    const requirementIds = validRequirementIds(module.requirementIds || [], allowed).filter((id) => workstreamRequirementIds.includes(id));
    const title = compact(module.title) || `Module ${index + 1}`;
    return {
      id: `${workstreamId}-module-${slug(title)}-${index + 1}`,
      title,
      objective: compact(module.objective),
      requirementIds,
      concepts: uniqueStrings(module.concepts || []).slice(0, 10),
      resourceIds: [],
      practice: uniqueStrings(module.practice || []).slice(0, 8),
      output: compact(module.output),
      doneWhen: compact(module.doneWhen),
    };
  }).filter((module) => module.requirementIds.length > 0 && module.objective && module.doneWhen);
}

function cleanMilestones(rawMilestones: SynthesizedWorkstream["milestones"], workstreamId: string, workstreamRequirementIds: string[], allowed: Set<string>): DevelopmentMilestone[] {
  const cleaned = (Array.isArray(rawMilestones) ? rawMilestones : []).map((milestone, index) => {
    const requirementIds = validRequirementIds(milestone.requirementIds || [], allowed).filter((id) => workstreamRequirementIds.includes(id));
    const title = compact(milestone.title) || `Milestone ${index + 1}`;
    return {
      id: `${workstreamId}-milestone-${slug(title)}-${index + 1}`,
      title,
      outcome: compact(milestone.outcome),
      doneWhen: compact(milestone.doneWhen),
      requirementIds,
      evidenceGenerated: (Array.isArray(milestone.evidenceGenerated) ? milestone.evidenceGenerated : []).map((item) => ({
        type: evidenceType(item.type),
        description: compact(item.description),
      })).filter((item) => item.description),
      dependencyIds: [] as string[],
      sequence: index + 1,
      dependencyTitles: uniqueStrings(milestone.dependencyTitles || []),
    };
  }).filter((milestone) => milestone.requirementIds.length > 0 && milestone.outcome && milestone.doneWhen);

  const idByTitle = new Map(cleaned.map((milestone) => [normalize(milestone.title), milestone.id]));
  return cleaned.map(({ dependencyTitles, ...milestone }) => ({
    ...milestone,
    dependencyIds: dependencyTitles.map((title) => idByTitle.get(normalize(title))).filter(Boolean) as string[],
  }));
}

function cleanWorkstreams(raw: DevelopmentSynthesis | null, requirementModel: RequirementModel, draft: DevelopmentPlanModel): DevelopmentWorkstream[] {
  if (!raw || !Array.isArray(raw.workstreams)) return draft.workstreams;
  const allowedRequirements = new Set(requirementModel.requirements.map((requirement) => requirement.id));
  const allowedRoleFamilies = new Set(requirementModel.roleFamilies.map((role) => role.id));
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const seenRequirement = new Set<string>();
  const workstreams: DevelopmentWorkstream[] = [];

  for (const [index, candidate] of raw.workstreams.entries()) {
    const candidateIds = validRequirementIds(candidate.requirementIds || [], allowedRequirements);
    const requirementIds = candidateIds.filter((id) => {
      const requirement = requirementById.get(id);
      if (!requirement) return false;
      // A requirement receives one primary home. Multi-purpose outputs can still
      // generate evidence for other requirements through milestone links later.
      if (seenRequirement.has(id)) return false;
      return true;
    });
    if (!requirementIds.length) continue;

    const requirements = requirementIds.map((id) => requirementById.get(id)!).filter(Boolean);
    const containsShared = requirements.some((requirement) => requirement.scope !== "role_specific");
    const containsRouteSpecific = requirements.some((requirement) => requirement.scope === "role_specific");
    if (containsShared && containsRouteSpecific) {
      // Mixed shared/route workstreams obscure what is reusable. Keep shared items
      // here and let the route-specific requirements fall back to their draft modules.
      for (let itemIndex = requirementIds.length - 1; itemIndex >= 0; itemIndex -= 1) {
        if (requirementById.get(requirementIds[itemIndex])?.scope === "role_specific") requirementIds.splice(itemIndex, 1);
      }
    }
    if (!requirementIds.length) continue;

    requirementIds.forEach((id) => seenRequirement.add(id));
    const key = compact(candidate.key) || `workstream-${index + 1}`;
    const id = `workstream-${slug(key)}`;
    const kind = requirementIds.every((reqId) => requirementById.get(reqId)?.scope === "role_specific")
      ? "route_specific" as const
      : validKind(candidate.kind) === "maintenance" ? "core" as const : validKind(candidate.kind);
    const methods = validMethods(candidate.methods || []);
    const modules = cleanModules(candidate.modules || [], id, requirementIds, allowedRequirements);
    const milestones = cleanMilestones(candidate.milestones || [], id, requirementIds, allowedRequirements);
    const fallback = draft.workstreams.find((workstream) => workstream.requirementIds.some((reqId) => requirementIds.includes(reqId)));

    workstreams.push({
      id,
      key,
      title: compact(candidate.title) || fallback?.title || "Development workstream",
      kind,
      purpose: compact(candidate.purpose) || fallback?.purpose || "Improve coverage of the linked target requirements.",
      outcome: compact(candidate.outcome) || fallback?.outcome || "The linked requirements meet their success bars.",
      requirementIds,
      methods: methods.length ? methods : fallback?.methods || ["research"],
      modules: modules.length ? modules : (fallback?.modules || []).filter((module) => module.requirementIds.some((reqId) => requirementIds.includes(reqId))),
      milestones: milestones.length ? milestones : (fallback?.milestones || []).map((milestone, milestoneIndex) => ({ ...milestone, id: `${id}-milestone-${milestoneIndex + 1}`, sequence: milestoneIndex + 1 })),
      dependencyIds: [],
      roleFamilyIds: validRequirementIds(candidate.roleFamilyIds || [], allowedRoleFamilies),
      rationale: compact(candidate.rationale) || fallback?.rationale || "The linked requirements share a common development method and outcome.",
      dependencyKeys: uniqueStrings(candidate.dependencyKeys || []),
    } as DevelopmentWorkstream & { dependencyKeys: string[] });
  }

  // Restore every material requirement that the model omitted, and preserve
  // route-specific requirements stripped from mixed workstreams.
  const materialIds = requirementModel.requirements
    .filter((requirement) => requirement.importance === "essential" || requirement.importance === "important")
    .map((requirement) => requirement.id);
  const requiredIds = uniqueStrings([
    ...materialIds,
    ...draft.workstreams.filter((workstream) => workstream.kind === "route_specific" || workstream.kind === "verification").flatMap((workstream) => workstream.requirementIds),
  ]);
  for (const requirementId of requiredIds) {
    if (seenRequirement.has(requirementId)) continue;
    const fallback = fallbackForMissingRequirement(draft, requirementId);
    if (!fallback) continue;
    const existingFallback = workstreams.find((workstream) => workstream.key === fallback.key);
    if (existingFallback) {
      existingFallback.requirementIds = uniqueStrings([...existingFallback.requirementIds, requirementId]);
      existingFallback.modules = uniqueModules([...existingFallback.modules, ...fallback.modules.filter((module) => module.requirementIds.includes(requirementId))]);
      existingFallback.milestones = uniqueMilestones([...existingFallback.milestones, ...fallback.milestones]);
    } else {
      workstreams.push({ ...fallback, requirementIds: fallback.requirementIds.filter((id) => !seenRequirement.has(id)) });
    }
    seenRequirement.add(requirementId);
  }

  const idByKey = new Map(workstreams.map((workstream) => [normalize(workstream.key), workstream.id]));
  return workstreams.map((workstream) => {
    const candidate = workstream as DevelopmentWorkstream & { dependencyKeys?: string[] };
    const dependencyIds = uniqueStrings(candidate.dependencyKeys || []).map((key) => idByKey.get(normalize(key))).filter(Boolean) as string[];
    const { dependencyKeys, ...cleaned } = candidate;
    return { ...cleaned, dependencyIds: uniqueStrings([...cleaned.dependencyIds, ...dependencyIds]).filter((id) => id !== cleaned.id) };
  });
}

function uniqueModules(modules: DevelopmentModule[]): DevelopmentModule[] {
  const seen = new Set<string>();
  return modules.filter((module) => {
    const key = `${normalize(module.title)}:${module.requirementIds.sort().join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueMilestones(milestones: DevelopmentMilestone[]): DevelopmentMilestone[] {
  const seen = new Set<string>();
  return milestones.filter((milestone) => {
    const key = normalize(milestone.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((milestone, index) => ({ ...milestone, sequence: index + 1 }));
}

function rebuildPlan(draft: DevelopmentPlanModel, workstreams: DevelopmentWorkstream[], planLogic: string): DevelopmentPlanModel {
  const workstreamIdsByRequirement = new Map<string, string[]>();
  for (const workstream of workstreams) {
    for (const requirementId of workstream.requirementIds) {
      workstreamIdsByRequirement.set(requirementId, [...(workstreamIdsByRequirement.get(requirementId) || []), workstream.id]);
    }
  }
  const decisions = draft.decisions.map((decision) => ({
    ...decision,
    workstreamIds: workstreamIdsByRequirement.get(decision.requirementId) || [],
  }));
  const requirementCoverage = draft.requirementCoverage.map((item) => {
    const workstreamIds = workstreamIdsByRequirement.get(item.requirementId) || [];
    if (item.decision === "maintain") return { ...item, workstreamIds };
    return {
      ...item,
      workstreamIds,
      decision: workstreamIds.length
        ? item.decision === "verify" ? "verify" as const : item.decision === "route_module" ? "route_module" as const : "planned" as const
        : "deferred" as const,
    };
  });
  const materialIds = new Set(draft.decisions.filter((decision) => decision.material).map((decision) => decision.requirementId));
  const mapped = new Set([...workstreamIdsByRequirement.keys(), ...draft.maintenanceRequirementIds]);
  const orphanRequirementIds = [...materialIds].filter((id) => !mapped.has(id));
  const duplicateRequirementCount = [...workstreamIdsByRequirement.values()].filter((ids) => ids.length > 1).length;
  const materialRequirementsMapped = [...materialIds].filter((id) => mapped.has(id)).length;
  const materialCoverageRate = materialIds.size ? Math.round((materialRequirementsMapped / materialIds.size) * 100) : 100;
  const caveats = [...draft.quality.caveats.filter((item) => !item.includes("workstream"))];
  if (orphanRequirementIds.length) caveats.push(`${orphanRequirementIds.length} material requirements remain unmapped.`);
  if (duplicateRequirementCount) caveats.push(`${duplicateRequirementCount} requirements have more than one primary workstream.`);
  if (workstreams.filter((item) => item.kind !== "maintenance").length > 7) caveats.push("The plan may still be too broad for a low-overload user experience and should be consolidated before task generation.");

  return {
    ...draft,
    objective: planLogic || draft.objective,
    decisions,
    workstreams,
    requirementCoverage,
    quality: {
      status: materialCoverageRate === 100 && workstreams.length <= 7 ? "complete" : materialCoverageRate >= 85 ? "usable_with_caveats" : "provisional",
      materialRequirementCount: materialIds.size,
      materialRequirementsMapped,
      materialCoverageRate,
      workstreamCount: workstreams.length,
      duplicateRequirementCount,
      orphanRequirementIds,
      caveats,
    },
    generatedAt: Date.now(),
  };
}

export async function enhanceDevelopmentPlanWithLlm(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  draft: DevelopmentPlanModel,
): Promise<DevelopmentPlanModel> {
  if (!draft.workstreams.some((workstream) => workstream.kind !== "maintenance")) return draft;
  try {
    const raw = await llmJSON<DevelopmentSynthesis>(synthesisPrompt(requirementModel, coverageModel, draft), { model: MODEL_PRIMARY });
    const workstreams = cleanWorkstreams(raw, requirementModel, draft);
    return rebuildPlan(draft, workstreams, compact(raw?.planLogic));
  } catch {
    return {
      ...draft,
      quality: {
        ...draft.quality,
        status: draft.quality.status === "complete" ? "usable_with_caveats" : draft.quality.status,
        caveats: [...new Set([...draft.quality.caveats, "Anchor used the deterministic development-plan fallback because plan synthesis was unavailable."])],
      },
    };
  }
}

function resourceType(value: unknown): DevelopmentResource["type"] {
  const normalized = normalize(value);
  const allowed: DevelopmentResource["type"][] = ["book", "course", "report", "framework", "article", "dataset", "community", "other"];
  return allowed.includes(normalized as any) ? normalized as any : "other";
}

function authority(value: unknown): DevelopmentResource["authority"] {
  const normalized = normalize(value);
  return ["primary", "canonical", "credible", "supporting"].includes(normalized) ? normalized as any : "credible";
}

function freshness(value: unknown): DevelopmentResource["freshness"] {
  const normalized = normalize(value);
  return ["current", "durable", "unknown"].includes(normalized) ? normalized as any : "unknown";
}

function validUrl(value: unknown): string {
  const url = compact(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function existingResourceCandidates(intelligence: Record<string, any>, allowedRequirements: Set<string>): DevelopmentResource[] {
  const raw = [
    ...(Array.isArray(intelligence.evidencePack) ? intelligence.evidencePack : []),
    ...(Array.isArray(intelligence.researchEvidence) ? intelligence.researchEvidence : []),
  ];
  const resources: DevelopmentResource[] = [];
  for (const item of raw) {
    const type = resourceType(item.sourceType || item.type);
    if (!["course", "report", "framework", "article", "book", "dataset"].includes(type)) continue;
    const title = compact(item.sourceTitle || item.title);
    const url = validUrl(item.sourceUrl || item.url);
    if (!title || !url) continue;
    const requirementIds = validRequirementIds(item.requirementIds || [], allowedRequirements);
    const sourceEvidenceId = compact(item.id) || `research-${shortHash(url)}`;
    resources.push({
      id: `resource-${shortHash(url)}`,
      title,
      type,
      url,
      publisher: compact(item.publisher || item.organization),
      whySelected: compact(item.claimSupported || item.claim || item.whyReliable),
      requirementIds,
      authority: item.sourceType === "institution" || item.sourceType === "employer" ? "primary" : "credible",
      freshness: "unknown",
      sourceEvidenceId,
    });
  }
  return resources;
}

async function researchResources(requirementModel: RequirementModel, plan: DevelopmentPlanModel): Promise<DevelopmentResource[]> {
  const learningRequirementIds = uniqueStrings(plan.workstreams
    .filter((workstream) => workstream.methods.some((method) => ["learn", "practice", "credential", "research"].includes(method)))
    .flatMap((workstream) => workstream.requirementIds));
  if (!learningRequirementIds.length) return [];
  const allowed = new Set(learningRequirementIds);
  const requirements = requirementModel.requirements.filter((requirement) => allowed.has(requirement.id));

  const prompt = `You are Anchor's resource research agent. Find a compact, authoritative resource set for the development plan below. Use web search. Resources must help the user meet the documented success bars, not merely provide interesting reading.

TARGET: ${requirementModel.target.label}
REQUIREMENTS:
${JSON.stringify(requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    definition: requirement.definition,
    importance: requirement.importance,
    successBar: requirement.successBar,
    context: requirement.context,
  })), null, 2)}

WORKSTREAMS:
${JSON.stringify(plan.workstreams.filter((workstream) => workstream.requirementIds.some((id) => allowed.has(id))).map((workstream) => ({
    key: workstream.key,
    title: workstream.title,
    requirementIds: workstream.requirementIds,
    methods: workstream.methods,
    modules: workstream.modules.map((module) => ({ title: module.title, objective: module.objective, requirementIds: module.requirementIds, output: module.output })),
  })), null, 2)}

Return ONLY a JSON array:
[
  {
    "title": "exact resource title",
    "type": "book|course|report|framework|article|dataset|community|other",
    "url": "real source URL",
    "publisher": "authoritative publisher or institution",
    "whySelected": "how this resource supports the success bar",
    "requirementIds": ["exact requirement IDs only"],
    "authority": "primary|canonical|credible|supporting",
    "freshness": "current|durable|unknown",
    "sourceTitle": "page or source title used to verify it"
  }
]

Rules:
- Return no more than 16 resources total and normally 2-4 per workstream.
- Prefer primary institutions, employer frameworks, canonical books, respected courses, and high-quality applied reports.
- Prefer a small complementary set over a long reading list.
- Every resource must support at least one supplied requirement ID.
- Use current sources for changing regulation, policy, tools, markets, and institutions. Mark foundational books/frameworks durable.
- Do not invent URLs. Omit anything you cannot verify.
- A resource must be linked to application, practice, synthesis, or an output in the plan.`;

  try {
    const raw = await llmJSON<DevelopmentResourceCandidate[]>(prompt, {
      model: MODEL_PRIMARY,
      tools: [{ type: "web_search_preview" }],
    });
    const seen = new Set<string>();
    return (Array.isArray(raw) ? raw : []).map((item) => {
      const url = validUrl(item.url);
      const title = compact(item.title);
      const requirementIds = validRequirementIds(item.requirementIds || [], allowed);
      if (!url || !title || !requirementIds.length) return null;
      const key = normalize(url);
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: `resource-${shortHash(url)}`,
        title,
        type: resourceType(item.type),
        url,
        publisher: compact(item.publisher),
        whySelected: compact(item.whySelected),
        requirementIds,
        authority: authority(item.authority),
        freshness: freshness(item.freshness),
        sourceEvidenceId: `web-${shortHash(`${item.sourceTitle || title}:${url}`)}`,
      } satisfies DevelopmentResource;
    }).filter(Boolean).slice(0, 16) as DevelopmentResource[];
  } catch {
    return [];
  }
}

function attachResources(plan: DevelopmentPlanModel, resources: DevelopmentResource[]): DevelopmentPlanModel {
  const resourcesByRequirement = new Map<string, string[]>();
  for (const resource of resources) {
    for (const requirementId of resource.requirementIds) {
      resourcesByRequirement.set(requirementId, [...(resourcesByRequirement.get(requirementId) || []), resource.id]);
    }
  }
  const workstreams = plan.workstreams.map((workstream) => ({
    ...workstream,
    modules: workstream.modules.map((module) => ({
      ...module,
      resourceIds: uniqueStrings([
        ...module.resourceIds,
        ...module.requirementIds.flatMap((requirementId) => resourcesByRequirement.get(requirementId) || []),
      ]).slice(0, 5),
    })),
  }));
  return { ...plan, workstreams, resources, generatedAt: Date.now() };
}

export async function enrichDevelopmentPlanResources(
  requirementModel: RequirementModel,
  plan: DevelopmentPlanModel,
  intelligence: Record<string, any>,
): Promise<DevelopmentPlanModel> {
  const allowedRequirements = new Set(requirementModel.requirements.map((requirement) => requirement.id));
  const existing = existingResourceCandidates(intelligence, allowedRequirements);
  const researched = await researchResources(requirementModel, plan);
  const seen = new Set<string>();
  const resources = [...existing, ...researched].filter((resource) => {
    const key = normalize(resource.url || resource.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return resource.requirementIds.length > 0;
  }).slice(0, 20);

  const enriched = attachResources(plan, resources);
  const modulesNeedingResources = enriched.workstreams.flatMap((workstream) => workstream.modules).filter((module) => module.requirementIds.length && module.resourceIds.length === 0);
  if (!modulesNeedingResources.length) return enriched;
  return {
    ...enriched,
    quality: {
      ...enriched.quality,
      status: enriched.quality.status === "complete" ? "usable_with_caveats" : enriched.quality.status,
      caveats: [...new Set([...enriched.quality.caveats, `${modulesNeedingResources.length} syllabus module${modulesNeedingResources.length === 1 ? "" : "s"} still need verified resources.`])],
    },
  };
}
