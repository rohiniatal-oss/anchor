type RequirementCategory = "knowledge" | "skill" | "evidence" | "network" | "credential" | "narrative" | "access" | "other";

type TargetProfileRequirement = {
  id: string;
  category: RequirementCategory;
  label: string;
  roleFamilies: string[];
  whyItMatters: string;
  evidence: string;
};

type TargetProfileRoleFamily = {
  id: string;
  title: string;
  description: string;
  typicalOrganizations: string[];
  seniority: string;
  successSignals: string[];
};

type TargetProfileCareerRoute = {
  id: string;
  label: string;
  description: string;
  typicalEntryPoints: string[];
  routeEvidence: string;
};

export type TargetProfile = {
  mode: "target_profile";
  target: {
    label: string;
    definition: string;
    assumption: string;
  };
  roleFamilies: TargetProfileRoleFamily[];
  requirements: TargetProfileRequirement[];
  careerRoutes: TargetProfileCareerRoute[];
  successProfile: {
    commonSignals: string[];
    roleSpecificSignals: Array<{ roleFamily: string; signals: string[] }>;
  };
  evidenceBase: Array<{
    claim: string;
    sourceTitle: string;
    sourceUrl: string;
    usedFor: string;
    confidence: "high" | "medium" | "low";
  }>;
  boundaries: {
    includes: string[];
    excludes: string[];
    openQuestions: string[];
  };
  generatedAt: number;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function idFor(prefix: string, label: string, index: number) {
  return `${prefix}-${normalize(label).replace(/\s+/g, "-").slice(0, 72) || index}`;
}

function uniqueStrings(values: unknown[]) {
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

function inferCategory(value: unknown): RequirementCategory {
  const text = normalize(value);
  if (text.includes("knowledge") || text.includes("domain") || text.includes("sector") || text.includes("economy")) return "knowledge";
  if (text.includes("skill") || text.includes("analysis") || text.includes("writing") || text.includes("forecast") || text.includes("strategy")) return "skill";
  if (text.includes("evidence") || text.includes("proof") || text.includes("publication") || text.includes("portfolio") || text.includes("memo")) return "evidence";
  if (text.includes("network") || text.includes("relationship") || text.includes("conversation")) return "network";
  if (text.includes("credential") || text.includes("degree") || text.includes("certification") || text.includes("clearance")) return "credential";
  if (text.includes("narrative") || text.includes("positioning") || text.includes("story")) return "narrative";
  if (text.includes("access") || text.includes("referral") || text.includes("introduction") || text.includes("entry")) return "access";
  return "other";
}

function targetLabel(track: any, brief: any) {
  return compact(brief.careerHypothesis?.normalizedTitle) || compact(brief.trackName) || compact(track?.name) || compact(brief.domain) || "Chosen target";
}

function targetDefinition(track: any, brief: any) {
  return compact(brief.summary) || compact(track?.description) || compact(brief.trackThesis) || `A target profile for ${targetLabel(track, brief)}.`;
}

function buildRoleFamilies(brief: any): TargetProfileRoleFamily[] {
  return asArray(brief.roleShapes).map((role: any, index) => {
    const title = compact(role.title);
    return {
      id: idFor("role-family", title, index),
      title,
      description: compact(role.what),
      typicalOrganizations: uniqueStrings(asArray(role.typicalOrgs)),
      seniority: compact(role.seniority) || "mixed",
      successSignals: uniqueStrings([
        ...asArray(role.successSignals),
        ...asArray(role.requirements),
        compact(role.what),
      ]).slice(0, 6),
    };
  }).filter((role) => role.title).slice(0, 12);
}

function requirementsFromGraph(brief: any): TargetProfileRequirement[] {
  return asArray(brief.requirementGraph).map((node: any, index) => {
    const label = compact(node.requirement || node.capability || node.knowledge || node.signal);
    return {
      id: idFor("target-requirement", label, index),
      category: compact(node.capitalType) as RequirementCategory || inferCategory(label),
      label,
      roleFamilies: uniqueStrings([node.path, node.route, node.roleFamily].filter(Boolean)),
      whyItMatters: compact(node.whyItMatters || node.importance || node.reason) || "Requirement from the target research model.",
      evidence: compact(node.evidence || node.sourceTitle),
    };
  }).filter((requirement) => requirement.label).slice(0, 30);
}

function fallbackRequirements(brief: any): TargetProfileRequirement[] {
  const requirementMap = brief.requirementMap || {};
  const entries = [
    ...asArray(requirementMap.knowledge).map((label) => ({ label, category: "knowledge" as RequirementCategory })),
    ...asArray(requirementMap.capabilities).map((label) => ({ label, category: "skill" as RequirementCategory })),
    ...asArray(requirementMap.evidence).map((label) => ({ label, category: "evidence" as RequirementCategory })),
    ...asArray(requirementMap.narrative).map((label) => ({ label, category: "narrative" as RequirementCategory })),
  ];

  return entries.map((entry, index) => ({
    id: idFor("target-requirement", entry.label, index),
    category: entry.category,
    label: compact(entry.label),
    roleFamilies: [],
    whyItMatters: "Requirement inferred from the shared target requirement map.",
    evidence: "Shared requirement map",
  })).filter((requirement) => requirement.label).slice(0, 24);
}

function buildRequirements(brief: any) {
  const graphRequirements = requirementsFromGraph(brief);
  const base = graphRequirements.length ? graphRequirements : fallbackRequirements(brief);
  const seen = new Set<string>();
  const result: TargetProfileRequirement[] = [];
  for (const requirement of base) {
    const key = `${requirement.category}:${normalize(requirement.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...requirement,
      category: requirement.category || inferCategory(requirement.label),
      roleFamilies: uniqueStrings(requirement.roleFamilies),
    });
  }
  return result;
}

function buildCareerRoutes(brief: any, roleFamilies: TargetProfileRoleFamily[]): TargetProfileCareerRoute[] {
  const pathRoutes = asArray(brief.pathHypotheses).map((path: any, index) => {
    const label = compact(path.title || path.path || path.name);
    return {
      id: idFor("career-route", label, index),
      label,
      description: compact(path.description || path.whyPromising || path.hypothesis),
      typicalEntryPoints: uniqueStrings([path.entryPoint, path.entryRoute, ...asArray(path.typicalEntryPoints), ...asArray(path.exampleOrgs)]),
      routeEvidence: compact(asArray(path.testSignals).join("; ") || path.evidence || path.whyPromising),
    };
  }).filter((route) => route.label);
  if (pathRoutes.length) return pathRoutes.slice(0, 10);

  return roleFamilies.map((role, index) => ({
    id: idFor("career-route", role.title, index),
    label: role.title,
    description: role.description,
    typicalEntryPoints: role.typicalOrganizations,
    routeEvidence: "Route inferred from role family research.",
  })).slice(0, 10);
}

function buildSuccessProfile(roleFamilies: TargetProfileRoleFamily[], requirements: TargetProfileRequirement[]) {
  const commonSignals = uniqueStrings([
    ...requirements.filter((requirement) => !requirement.roleFamilies.length || requirement.roleFamilies.length > 1).map((requirement) => requirement.label),
    ...roleFamilies.flatMap((role) => role.successSignals),
  ]).slice(0, 12);

  return {
    commonSignals,
    roleSpecificSignals: roleFamilies.map((role) => ({
      roleFamily: role.title,
      signals: uniqueStrings([
        ...role.successSignals,
        ...requirements.filter((requirement) => requirement.roleFamilies.some((family) => normalize(family).includes(normalize(role.title)) || normalize(role.title).includes(normalize(family)))).map((requirement) => requirement.label),
      ]).slice(0, 8),
    })).filter((entry) => entry.signals.length > 0),
  };
}

function buildEvidenceBase(brief: any) {
  return [
    ...asArray(brief.researchEvidence),
    ...asArray(brief.evidencePack),
  ].map((evidence: any) => ({
    claim: compact(evidence.claim || evidence.summary || evidence.title),
    sourceTitle: compact(evidence.sourceTitle || evidence.title || evidence.source),
    sourceUrl: compact(evidence.sourceUrl || evidence.url),
    usedFor: compact(evidence.usedFor || evidence.type || "target_profile"),
    confidence: evidence.confidence === "high" || evidence.confidence === "low" ? evidence.confidence : "medium",
  })).filter((evidence) => evidence.claim || evidence.sourceTitle).slice(0, 20);
}

function buildBoundaries(brief: any, roleFamilies: TargetProfileRoleFamily[]) {
  return {
    includes: uniqueStrings([
      ...asArray(brief.sectorMap).map((sector: any) => sector.sector),
      ...roleFamilies.map((role) => role.title),
    ]).slice(0, 12),
    excludes: uniqueStrings(asArray(brief.excludes || brief.outOfScope || brief.boundaries?.excludes)).slice(0, 8),
    openQuestions: uniqueStrings([
      ...asArray(brief.trackHypotheses).map((hypothesis: any) => hypothesis.howToTest),
      ...asArray(brief.evidenceLoops).map((loop: any) => loop.evidenceToCollect),
    ]).slice(0, 8),
  };
}

export function buildTargetProfile(track: any, brief: any): TargetProfile {
  const roleFamilies = buildRoleFamilies(brief);
  const requirements = buildRequirements(brief);
  const careerRoutes = buildCareerRoutes(brief, roleFamilies);

  return {
    mode: "target_profile",
    target: {
      label: targetLabel(track, brief),
      definition: targetDefinition(track, brief),
      assumption: "This layer defines the destination only. It does not assess the user, diagnose gaps, build plans, or create tasks.",
    },
    roleFamilies,
    requirements,
    careerRoutes,
    successProfile: buildSuccessProfile(roleFamilies, requirements),
    evidenceBase: buildEvidenceBase(brief),
    boundaries: buildBoundaries(brief, roleFamilies),
    generatedAt: Date.now(),
  };
}
