import { llmJSON, MODEL_PRIMARY } from "./llm";
import type {
  RequirementCategory,
  RequirementConfidence,
  RequirementGroupId,
  RequirementImportance,
  RequirementModel,
  TargetRequirement,
} from "./trackResearchRequirementModel";

const REQUIREMENT_CATEGORIES: RequirementCategory[] = ["knowledge", "skill", "experience", "evidence", "credential", "narrative", "network", "access", "eligibility"];
const REQUIREMENT_IMPORTANCE: RequirementImportance[] = ["essential", "important", "differentiator", "contextual"];

type RequirementPatch = {
  id?: string;
  label?: string;
  aliases?: string[];
  definition?: string;
  category?: RequirementCategory;
  importance?: RequirementImportance;
  importanceReason?: string;
  scope?: "shared" | "role_specific";
  roleFamilyIds?: string[];
  successBar?: string;
  evidenceClaimIds?: string[];
  context?: {
    seniority?: string[];
    geographies?: string[];
    employerTypes?: string[];
    notes?: string[];
  };
};

type RequirementSynthesis = {
  targetDefinition?: string;
  roleFamilyPatches?: Array<{
    id: string;
    title?: string;
    description?: string;
    seniority?: string;
    typicalOrganizations?: string[];
    evidenceClaimIds?: string[];
  }>;
  requirementPatches?: RequirementPatch[];
  additionalRequirements?: RequirementPatch[];
  boundaries?: {
    includes?: string[];
    excludes?: string[];
    openQuestions?: string[];
  };
  qualityNotes?: string[];
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
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

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableRequirementId(category: RequirementCategory, label: string): string {
  return `target-requirement-${stableHash(`${category}:${normalize(label)}`)}`;
}

function parseCategory(value: unknown, fallback: RequirementCategory): RequirementCategory {
  const category = normalize(value) as RequirementCategory;
  return REQUIREMENT_CATEGORIES.includes(category) ? category : fallback;
}

function groupForCategory(category: RequirementCategory): RequirementGroupId {
  if (category === "knowledge" || category === "skill") return "perform_work";
  if (category === "network" || category === "access" || category === "eligibility") return "access_opportunity";
  return "demonstrate_credibility";
}

function formalGate(value: unknown): boolean {
  const text = normalize(value);
  return ["mandatory", "must have", "required", "clearance", "citizenship", "work authorization", "licence", "license", "eligibility"].some((term) => text.includes(term));
}

function evidenceConfidence(requirement: Pick<TargetRequirement, "evidenceClaimIds">, model: RequirementModel): RequirementConfidence {
  const claims = requirement.evidenceClaimIds.map((id) => model.evidenceClaims.find((claim) => claim.id === id)).filter(Boolean);
  const direct = claims.filter((claim) => claim?.directness === "direct").length;
  const high = claims.filter((claim) => claim?.confidence === "high").length;
  if (direct >= 2 || (direct >= 1 && high >= 1)) return "high";
  if (claims.length > 0) return "medium";
  return "low";
}

function safeImportance(
  requested: unknown,
  fallback: RequirementImportance,
  requirementText: string,
  evidenceClaimIds: string[],
  model: RequirementModel,
): RequirementImportance {
  const importance = REQUIREMENT_IMPORTANCE.includes(requested as RequirementImportance) ? requested as RequirementImportance : fallback;
  if (importance !== "essential") return importance;
  const hasDirectEvidence = evidenceClaimIds.some((id) => model.evidenceClaims.find((claim) => claim.id === id)?.directness === "direct");
  return hasDirectEvidence || formalGate(requirementText) ? "essential" : "important";
}

function defaultSuccessBar(category: RequirementCategory, label: string): string {
  if (category === "knowledge") return `Can explain and apply ${label} to a realistic target-role problem.`;
  if (category === "skill") return `Can perform ${label} to a role-relevant standard and show the result.`;
  if (category === "experience") return `Has at least one credible example of applying ${label} in a relevant context.`;
  if (category === "evidence") return `Has an inspectable output or external signal that demonstrates ${label}.`;
  if (category === "credential") return `Holds the credential where it is a formal gate, or has evidence that employers accept an alternative.`;
  if (category === "narrative") return `Can explain ${label} clearly and consistently across CV, outreach, and interviews.`;
  if (category === "network") return `Has relevant professional relationships that support ${label}.`;
  if (category === "access") return `Has a credible hiring route, referral path, or entry point for ${label}.`;
  return `Meets the formal eligibility condition for the relevant roles.`;
}

function patchRequirement(base: TargetRequirement, patch: RequirementPatch, model: RequirementModel): TargetRequirement {
  const validRoleIds = new Set(model.roleFamilies.map((role) => role.id));
  const validEvidenceIds = new Set(model.evidenceClaims.map((claim) => claim.id));
  const category = parseCategory(patch.category, base.category);
  const roleFamilyIds = uniqueStrings(asArray(patch.roleFamilyIds).filter((id) => validRoleIds.has(id)));
  const evidenceClaimIds = uniqueStrings(asArray(patch.evidenceClaimIds).filter((id) => validEvidenceIds.has(id)));
  const finalEvidenceIds = evidenceClaimIds.length ? evidenceClaimIds : base.evidenceClaimIds;
  const label = compact(patch.label) || base.label;
  const importance = safeImportance(
    patch.importance,
    base.importance,
    `${label} ${patch.definition || base.definition} ${patch.importanceReason || base.importanceReason}`,
    finalEvidenceIds,
    model,
  );
  const next: TargetRequirement = {
    ...base,
    key: `${category}:${normalize(label)}`,
    label,
    aliases: uniqueStrings([...base.aliases, ...asArray(patch.aliases)]).filter((alias) => normalize(alias) !== normalize(label)),
    definition: compact(patch.definition) || base.definition,
    group: groupForCategory(category),
    category,
    importance,
    importanceReason: compact(patch.importanceReason) || base.importanceReason,
    roleFamilyIds: roleFamilyIds.length || patch.scope === "shared" ? roleFamilyIds : base.roleFamilyIds,
    scope: patch.scope === "role_specific" && roleFamilyIds.length > 0 ? "role_specific" : patch.scope === "shared" ? "shared" : base.scope,
    successBar: compact(patch.successBar) || base.successBar || defaultSuccessBar(category, label),
    evidenceClaimIds: finalEvidenceIds,
    context: {
      seniority: uniqueStrings([...base.context.seniority, ...asArray(patch.context?.seniority)]),
      geographies: uniqueStrings([...base.context.geographies, ...asArray(patch.context?.geographies)]),
      employerTypes: uniqueStrings([...base.context.employerTypes, ...asArray(patch.context?.employerTypes)]),
      notes: uniqueStrings([...base.context.notes, ...asArray(patch.context?.notes)]),
    },
  };
  next.confidence = evidenceConfidence(next, model);
  return next;
}

function additionalRequirement(patch: RequirementPatch, model: RequirementModel): TargetRequirement | null {
  const label = compact(patch.label);
  if (!label) return null;
  const category = parseCategory(patch.category, "skill");
  const validRoleIds = new Set(model.roleFamilies.map((role) => role.id));
  const validEvidenceIds = new Set(model.evidenceClaims.map((claim) => claim.id));
  const roleFamilyIds = uniqueStrings(asArray(patch.roleFamilyIds).filter((id) => validRoleIds.has(id)));
  const evidenceClaimIds = uniqueStrings(asArray(patch.evidenceClaimIds).filter((id) => validEvidenceIds.has(id)));
  if (!evidenceClaimIds.length) return null;
  const importance = safeImportance(
    patch.importance,
    "contextual",
    `${label} ${patch.definition || ""} ${patch.importanceReason || ""}`,
    evidenceClaimIds,
    model,
  );
  const requirement: TargetRequirement = {
    id: stableRequirementId(category, label),
    key: `${category}:${normalize(label)}`,
    label,
    aliases: uniqueStrings(asArray(patch.aliases)).filter((alias) => normalize(alias) !== normalize(label)),
    definition: compact(patch.definition) || `A ${category} requirement supported by the target evidence base.`,
    group: groupForCategory(category),
    category,
    importance,
    importanceReason: compact(patch.importanceReason) || "This requirement is supported by the cited market evidence.",
    scope: patch.scope === "role_specific" && roleFamilyIds.length > 0 ? "role_specific" : "shared",
    roleFamilyIds,
    successBar: compact(patch.successBar) || defaultSuccessBar(category, label),
    evidenceClaimIds,
    confidence: "medium",
    context: {
      seniority: uniqueStrings(asArray(patch.context?.seniority)),
      geographies: uniqueStrings(asArray(patch.context?.geographies)),
      employerTypes: uniqueStrings(asArray(patch.context?.employerTypes)),
      notes: uniqueStrings(asArray(patch.context?.notes)),
    },
  };
  requirement.confidence = evidenceConfidence(requirement, model);
  return requirement;
}

function mergeRequirements(requirements: TargetRequirement[]): TargetRequirement[] {
  const byKey = new Map<string, TargetRequirement>();
  for (const requirement of requirements) {
    const key = `${requirement.category}:${normalize(requirement.label)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, requirement);
      continue;
    }
    existing.aliases = uniqueStrings([...existing.aliases, ...requirement.aliases]);
    existing.roleFamilyIds = uniqueStrings([...existing.roleFamilyIds, ...requirement.roleFamilyIds]);
    existing.evidenceClaimIds = uniqueStrings([...existing.evidenceClaimIds, ...requirement.evidenceClaimIds]);
    existing.context = {
      seniority: uniqueStrings([...existing.context.seniority, ...requirement.context.seniority]),
      geographies: uniqueStrings([...existing.context.geographies, ...requirement.context.geographies]),
      employerTypes: uniqueStrings([...existing.context.employerTypes, ...requirement.context.employerTypes]),
      notes: uniqueStrings([...existing.context.notes, ...requirement.context.notes]),
    };
    if (existing.definition.length < requirement.definition.length) existing.definition = requirement.definition;
    if (existing.successBar.length < requirement.successBar.length) existing.successBar = requirement.successBar;
  }
  return [...byKey.values()];
}

function sortRequirements(requirements: TargetRequirement[]): TargetRequirement[] {
  const importanceRank: Record<RequirementImportance, number> = { essential: 0, important: 1, differentiator: 2, contextual: 3 };
  const groupRank: Record<RequirementGroupId, number> = { perform_work: 0, demonstrate_credibility: 1, access_opportunity: 2 };
  return [...requirements].sort((left, right) => importanceRank[left.importance] - importanceRank[right.importance]
    || groupRank[left.group] - groupRank[right.group]
    || left.label.localeCompare(right.label));
}

function recomputeResearchQuality(model: RequirementModel, requirements: TargetRequirement[]) {
  const directSourceCount = model.evidenceClaims.filter((claim) => claim.directness === "direct").length;
  const sourceTypeCount = new Set(model.evidenceClaims.map((claim) => normalize(claim.sourceType)).filter(Boolean)).size;
  const withEvidence = requirements.filter((requirement) => requirement.evidenceClaimIds.length > 0).length;
  const withDirectEvidence = requirements.filter((requirement) => requirement.evidenceClaimIds.some((id) => model.evidenceClaims.find((claim) => claim.id === id)?.directness === "direct")).length;
  const requirementEvidenceCoverage = requirements.length ? Math.round((withEvidence / requirements.length) * 100) : 0;
  const directRequirementCoverage = requirements.length ? Math.round((withDirectEvidence / requirements.length) * 100) : 0;
  const caveats = [...model.researchQuality.caveats];
  if (requirementEvidenceCoverage < 60) caveats.push("Several requirements still lack a directly linked source claim.");
  const status = model.evidenceClaims.length >= 8 && directSourceCount >= 3 && requirementEvidenceCoverage >= 70 && directRequirementCoverage >= 35
    ? "strong"
    : model.evidenceClaims.length >= 5 && directSourceCount >= 1 && requirementEvidenceCoverage >= 50
      ? "usable"
      : "provisional";
  return {
    status,
    sourceCount: model.evidenceClaims.length,
    directSourceCount,
    sourceTypeCount,
    requirementEvidenceCoverage,
    directRequirementCoverage,
    caveats: uniqueStrings(caveats),
  } as const;
}

function applySynthesis(model: RequirementModel, synthesis: RequirementSynthesis): RequirementModel {
  const rolePatchById = new Map(asArray(synthesis.roleFamilyPatches).map((patch) => [patch.id, patch]));
  const validEvidenceIds = new Set(model.evidenceClaims.map((claim) => claim.id));
  const roleFamilies = model.roleFamilies.map((role) => {
    const patch = rolePatchById.get(role.id);
    if (!patch) return role;
    return {
      ...role,
      title: compact(patch.title) || role.title,
      description: compact(patch.description) || role.description,
      seniority: compact(patch.seniority) || role.seniority,
      typicalOrganizations: uniqueStrings([...role.typicalOrganizations, ...asArray(patch.typicalOrganizations)]),
      evidenceClaimIds: uniqueStrings([...role.evidenceClaimIds, ...asArray(patch.evidenceClaimIds).filter((id) => validEvidenceIds.has(id))]),
    };
  });
  const modelForPatching = { ...model, roleFamilies };
  const patchById = new Map(asArray(synthesis.requirementPatches).filter((patch) => patch.id).map((patch) => [patch.id as string, patch]));
  const patched = model.requirements.map((requirement) => patchRequirement(requirement, patchById.get(requirement.id) || {}, modelForPatching));
  const additional = asArray(synthesis.additionalRequirements).map((patch) => additionalRequirement(patch, modelForPatching)).filter(Boolean) as TargetRequirement[];
  const requirements = sortRequirements(mergeRequirements([...patched, ...additional])).slice(0, 40);
  const groups = model.groups.map((group) => ({
    ...group,
    requirementIds: requirements.filter((requirement) => requirement.group === group.id).map((requirement) => requirement.id),
  }));
  const next = {
    ...model,
    target: {
      ...model.target,
      definition: compact(synthesis.targetDefinition) || model.target.definition,
    },
    roleFamilies,
    groups,
    requirements,
    boundaries: {
      includes: uniqueStrings([...model.boundaries.includes, ...asArray(synthesis.boundaries?.includes)]),
      excludes: uniqueStrings([...model.boundaries.excludes, ...asArray(synthesis.boundaries?.excludes)]),
      openQuestions: uniqueStrings([...model.boundaries.openQuestions, ...asArray(synthesis.boundaries?.openQuestions), ...asArray(synthesis.qualityNotes)]).slice(0, 12),
    },
  };
  return { ...next, researchQuality: recomputeResearchQuality(next, requirements) };
}

export async function enhanceRequirementModelWithLlm(track: any, brief: any, draft: RequirementModel): Promise<RequirementModel> {
  const prompt = `You are Anchor's requirement synthesis agent. The user has already chosen this target. Your job is to improve the requirement model, not to judge fit, identify personal gaps, recommend development, or create tasks.

TARGET:
${draft.target.label}

TARGET SUMMARY:
${draft.target.definition}

MARKET SEGMENTS:
${JSON.stringify(draft.marketSegments, null, 2)}

ROLE FAMILIES WITH STABLE IDS:
${JSON.stringify(draft.roleFamilies, null, 2)}

EVIDENCE CLAIMS WITH STABLE IDS:
${JSON.stringify(draft.evidenceClaims, null, 2)}

DETERMINISTIC REQUIREMENT DRAFT WITH STABLE IDS:
${JSON.stringify(draft.requirements, null, 2)}

SUPPORTING RESEARCH SHAPES:
${JSON.stringify({
    sectorMap: asArray(brief.sectorMap),
    roleShapes: asArray(brief.roleShapes),
    requirementGraph: asArray(brief.requirementGraph),
    requirementMap: brief.requirementMap || {},
  }, null, 2)}

Return ONLY valid JSON with this shape:
{
  "targetDefinition": "precise definition of what this target includes",
  "roleFamilyPatches": [{
    "id": "existing role-family id only",
    "title": "normalized role-family title",
    "description": "what this family does",
    "seniority": "junior|mid|senior|mixed",
    "typicalOrganizations": ["real organizations already supported by the evidence"],
    "evidenceClaimIds": ["existing evidence claim ids only"]
  }],
  "requirementPatches": [{
    "id": "existing requirement id only",
    "label": "specific non-overlapping requirement",
    "aliases": ["market synonyms"],
    "definition": "what the requirement means in this target",
    "category": "knowledge|skill|experience|evidence|credential|narrative|network|access|eligibility",
    "importance": "essential|important|differentiator|contextual",
    "importanceReason": "why the evidence supports this level",
    "scope": "shared|role_specific",
    "roleFamilyIds": ["existing role-family ids only"],
    "successBar": "observable standard for sufficient coverage, not a task",
    "evidenceClaimIds": ["existing evidence claim ids only"],
    "context": { "seniority": [], "geographies": [], "employerTypes": [], "notes": [] }
  }],
  "additionalRequirements": [{
    "label": "requirement missing from the deterministic draft",
    "aliases": [],
    "definition": "precise meaning",
    "category": "knowledge|skill|experience|evidence|credential|narrative|network|access|eligibility",
    "importance": "essential|important|differentiator|contextual",
    "importanceReason": "why it is supported",
    "scope": "shared|role_specific",
    "roleFamilyIds": ["existing role-family ids only"],
    "successBar": "observable standard",
    "evidenceClaimIds": ["existing evidence claim ids only"],
    "context": { "seniority": [], "geographies": [], "employerTypes": [], "notes": [] }
  }],
  "boundaries": { "includes": [], "excludes": [], "openQuestions": [] },
  "qualityNotes": ["remaining research limitations only"]
}

Quality rules:
- Use only the supplied market evidence. Do not use the user's CV, current strengths, preferences, or inferred fit.
- Preserve existing IDs. Additional requirements must cite at least one supplied evidence claim ID or they will be discarded.
- Requirements must be MECE enough to assess separately. Split vague labels such as "strategy" or "communication" into precise requirements only when the evidence supports the split.
- Essential means a formal gate or a repeatedly direct requirement in employer or job evidence. Do not label a generic advantage essential.
- Distinguish ability to perform from proof of ability, previous relevant experience, narrative credibility, hiring access, and formal eligibility.
- Shared requirements apply broadly across the target. Role-specific requirements must identify the relevant role-family IDs.
- Success bars describe observable sufficiency. They must not prescribe learning resources, projects, or tasks.
- Do not invent employers, credentials, source claims, URLs, or requirements beyond the supplied evidence.`;

  const synthesis = await llmJSON<RequirementSynthesis>(prompt, { model: MODEL_PRIMARY, retries: 1 });
  if (!synthesis) return draft;
  return applySynthesis(draft, synthesis);
}
