export const REQUIREMENT_MODEL_VERSION = 1;

export type RequirementGroupId = "perform_work" | "demonstrate_credibility" | "access_opportunity";
export type RequirementCategory = "knowledge" | "skill" | "experience" | "evidence" | "credential" | "narrative" | "network" | "access" | "eligibility";
export type RequirementImportance = "essential" | "important" | "differentiator" | "contextual";
export type RequirementConfidence = "high" | "medium" | "low";
export type RequirementScope = "shared" | "role_specific";
export type EvidenceDirectness = "direct" | "supporting" | "inferred";

export type RequirementEvidenceClaim = {
  id: string;
  claim: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
  usedFor: string;
  confidence: RequirementConfidence;
  directness: EvidenceDirectness;
  whyReliable: string;
  checkedAt: number;
};

export type RequirementRoleFamily = {
  id: string;
  title: string;
  description: string;
  typicalOrganizations: string[];
  seniority: string;
  marketSegmentIds: string[];
  evidenceClaimIds: string[];
};

export type RequirementMarketSegment = {
  id: string;
  title: string;
  description: string;
  exampleOrganizations: string[];
  evidenceClaimIds: string[];
};

export type TargetRequirement = {
  id: string;
  key: string;
  label: string;
  aliases: string[];
  definition: string;
  group: RequirementGroupId;
  category: RequirementCategory;
  importance: RequirementImportance;
  importanceReason: string;
  scope: RequirementScope;
  roleFamilyIds: string[];
  successBar: string;
  evidenceClaimIds: string[];
  confidence: RequirementConfidence;
  context: {
    seniority: string[];
    geographies: string[];
    employerTypes: string[];
    notes: string[];
  };
};

export type RequirementModel = {
  mode: "requirement_model";
  version: number;
  sourceFingerprint: string;
  sourceResearchAt: number;
  target: {
    label: string;
    definition: string;
    assumption: string;
  };
  marketSegments: RequirementMarketSegment[];
  roleFamilies: RequirementRoleFamily[];
  groups: Array<{
    id: RequirementGroupId;
    label: string;
    description: string;
    requirementIds: string[];
  }>;
  requirements: TargetRequirement[];
  evidenceClaims: RequirementEvidenceClaim[];
  researchQuality: {
    status: "strong" | "usable" | "provisional";
    sourceCount: number;
    directSourceCount: number;
    sourceTypeCount: number;
    requirementEvidenceCoverage: number;
    directRequirementCoverage: number;
    caveats: string[];
  };
  boundaries: {
    includes: string[];
    excludes: string[];
    openQuestions: string[];
  };
  generatedAt: number;
};

type RequirementCandidate = {
  label: string;
  aliases: string[];
  category: RequirementCategory;
  roleFamilyLabels: string[];
  priority: number;
  definition: string;
  successBar: string;
  evidenceText: string;
  seniority: string[];
  geographies: string[];
  employerTypes: string[];
  notes: string[];
};

const GROUP_META: Record<RequirementGroupId, { label: string; description: string }> = {
  perform_work: {
    label: "Perform the work",
    description: "The knowledge, skills, and judgement needed to do the work well.",
  },
  demonstrate_credibility: {
    label: "Demonstrate credibility",
    description: "The experience, proof, credentials, and narrative needed to be believed.",
  },
  access_opportunity: {
    label: "Access the opportunity",
    description: "The relationships, routes, and formal eligibility needed to enter the field.",
  },
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

function stableId(prefix: string, ...parts: unknown[]): string {
  const normalized = parts.map(normalize).filter(Boolean).join("|");
  return `${prefix}-${stableHash(normalized || prefix)}`;
}

function boundedPriority(value: unknown): number {
  const priority = Number(value);
  if (!Number.isFinite(priority)) return 3;
  return Math.max(1, Math.min(5, Math.round(priority)));
}

function parseConfidence(value: unknown): RequirementConfidence {
  const normalized = normalize(value);
  if (normalized === "high" || normalized === "low") return normalized;
  return "medium";
}

function confidenceRank(value: RequirementConfidence): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function directnessRank(value: EvidenceDirectness): number {
  if (value === "direct") return 3;
  if (value === "supporting") return 2;
  return 1;
}

function inferDirectness(sourceType: unknown, usedFor: unknown): EvidenceDirectness {
  const source = normalize(sourceType);
  const use = normalize(usedFor);
  if ((source === "job posting" || source === "job_posting" || source === "employer") && (use.includes("requirement") || use.includes("role"))) {
    return "direct";
  }
  if (["institution", "report", "profile", "course"].includes(source)) return "supporting";
  return "inferred";
}

function buildEvidenceClaims(brief: any, checkedAt: number): RequirementEvidenceClaim[] {
  const rawEvidence = [...asArray(brief.researchEvidence), ...asArray(brief.evidencePack)];
  const byKey = new Map<string, RequirementEvidenceClaim>();

  for (const evidence of rawEvidence) {
    const claim = compact(evidence.claimSupported || evidence.claim || evidence.summary || evidence.title);
    const sourceTitle = compact(evidence.sourceTitle || evidence.title || evidence.source);
    if (!claim && !sourceTitle) continue;
    const sourceUrl = compact(evidence.sourceUrl || evidence.url);
    const sourceType = compact(evidence.sourceType || evidence.type || "other") || "other";
    const usedFor = compact(evidence.usedFor || "target_requirements") || "target_requirements";
    const confidence = parseConfidence(evidence.confidence);
    const directness = inferDirectness(sourceType, usedFor);
    const key = `${normalize(sourceUrl || sourceTitle)}|${normalize(claim || sourceTitle)}`;
    const item: RequirementEvidenceClaim = {
      id: stableId("requirement-evidence", key),
      claim: claim || sourceTitle,
      sourceTitle: sourceTitle || "Research source",
      sourceUrl,
      sourceType,
      usedFor,
      confidence,
      directness,
      whyReliable: compact(evidence.whyReliable),
      checkedAt,
    };
    const existing = byKey.get(key);
    if (!existing || (confidenceRank(item.confidence) + directnessRank(item.directness)) > (confidenceRank(existing.confidence) + directnessRank(existing.directness))) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].slice(0, 30);
}

function tokens(value: unknown): Set<string> {
  const ignored = new Set(["and", "the", "for", "with", "from", "into", "that", "this", "role", "roles", "work", "ability", "experience"]);
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !ignored.has(token)));
}

function overlapScore(left: unknown, right: unknown): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function matchingEvidenceIds(searchText: string, evidenceClaims: RequirementEvidenceClaim[], limit = 5): string[] {
  return evidenceClaims
    .map((claim) => {
      const similarity = overlapScore(searchText, `${claim.claim} ${claim.sourceTitle}`);
      const useBonus = normalize(claim.usedFor).includes("requirement") ? 0.18 : normalize(claim.usedFor).includes("role") ? 0.08 : 0;
      const directBonus = claim.directness === "direct" ? 0.12 : claim.directness === "supporting" ? 0.04 : 0;
      return { id: claim.id, similarity, score: similarity + useBonus + directBonus };
    })
    .filter((item) => item.similarity >= 0.12 && item.score >= 0.24)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.id);
}

function inferCategory(value: unknown, fallbackText: unknown): RequirementCategory {
  const explicit = normalize(value);
  const text = normalize(`${value || ""} ${fallbackText || ""}`);
  if (explicit === "knowledge" || text.includes("knowledge") || text.includes("domain expertise") || text.includes("political economy")) return "knowledge";
  if (explicit === "experience" || text.includes("years of experience") || text.includes("track record") || text.includes("client experience") || text.includes("sector experience") || text.includes("delivery experience")) return "experience";
  if (explicit === "skill" || explicit === "skills" || text.includes("skill") || text.includes("analysis") || text.includes("writing") || text.includes("forecast") || text.includes("judgement") || text.includes("judgment")) return "skill";
  if (explicit === "credential" || text.includes("degree") || text.includes("certification") || text.includes("qualification")) return "credential";
  if (explicit === "narrative" || text.includes("narrative") || text.includes("positioning") || text.includes("career story")) return "narrative";
  if (text.includes("citizenship") || text.includes("visa") || text.includes("clearance") || text.includes("work authorization") || text.includes("language requirement") || text.includes("eligibility")) return "eligibility";
  if (explicit === "network" || text.includes("network") || text.includes("relationship") || text.includes("practitioner contact")) return "network";
  if (explicit === "access" || text.includes("referral") || text.includes("introduction") || text.includes("hiring route") || text.includes("entry point")) return "access";
  if (explicit === "evidence" || explicit === "reputation" || text.includes("publication") || text.includes("portfolio") || text.includes("proof") || text.includes("work sample") || text.includes("reputation")) return "evidence";
  return explicit === "information" ? "knowledge" : "skill";
}

function groupForCategory(category: RequirementCategory): RequirementGroupId {
  if (category === "knowledge" || category === "skill") return "perform_work";
  if (category === "network" || category === "access" || category === "eligibility") return "access_opportunity";
  return "demonstrate_credibility";
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

function roleFamilyTitle(value: unknown): string {
  return compact(value);
}

function buildMarketSegments(brief: any, evidenceClaims: RequirementEvidenceClaim[]): RequirementMarketSegment[] {
  return asArray(brief.sectorMap).map((sector: any, index) => {
    const title = compact(sector.sector || sector.title || sector.name);
    const description = compact(sector.description || sector.what);
    const exampleOrganizations = uniqueStrings(asArray(sector.exampleOrgs || sector.typicalOrganizations));
    return {
      id: stableId("market-segment", title || index),
      title,
      description,
      exampleOrganizations,
      evidenceClaimIds: matchingEvidenceIds(`${title} ${description} ${exampleOrganizations.join(" ")}`, evidenceClaims, 4),
    };
  }).filter((segment) => segment.title).slice(0, 12);
}

function buildRoleFamilies(brief: any, marketSegments: RequirementMarketSegment[], evidenceClaims: RequirementEvidenceClaim[]): RequirementRoleFamily[] {
  const candidates = [
    ...asArray(brief.roleShapes).map((role: any) => ({
      title: roleFamilyTitle(role.title),
      description: compact(role.what || role.description),
      typicalOrganizations: uniqueStrings(asArray(role.typicalOrgs || role.typicalOrganizations)),
      seniority: compact(role.seniority) || "mixed",
    })),
    ...asArray(brief.pathHypotheses).map((path: any) => ({
      title: roleFamilyTitle(path.title || path.path || path.name),
      description: compact(path.description || path.whyPromising || path.hypothesis),
      typicalOrganizations: uniqueStrings([...asArray(path.exampleOrgs), ...asArray(path.typicalOrganizations)]),
      seniority: compact(path.seniority) || "mixed",
    })),
  ].filter((candidate) => candidate.title);

  const byTitle = new Map<string, RequirementRoleFamily>();
  for (const candidate of candidates) {
    const key = normalize(candidate.title);
    const marketSegmentIds = marketSegments
      .filter((segment) => overlapScore(`${candidate.title} ${candidate.description} ${candidate.typicalOrganizations.join(" ")}`, `${segment.title} ${segment.description} ${segment.exampleOrganizations.join(" ")}`) >= 0.18)
      .map((segment) => segment.id);
    const evidenceClaimIds = matchingEvidenceIds(`${candidate.title} ${candidate.description} ${candidate.typicalOrganizations.join(" ")}`, evidenceClaims, 5);
    const existing = byTitle.get(key);
    if (existing) {
      existing.typicalOrganizations = uniqueStrings([...existing.typicalOrganizations, ...candidate.typicalOrganizations]);
      existing.marketSegmentIds = uniqueStrings([...existing.marketSegmentIds, ...marketSegmentIds]);
      existing.evidenceClaimIds = uniqueStrings([...existing.evidenceClaimIds, ...evidenceClaimIds]);
      if (!existing.description && candidate.description) existing.description = candidate.description;
      continue;
    }
    byTitle.set(key, {
      id: stableId("role-family", candidate.title),
      title: candidate.title,
      description: candidate.description,
      typicalOrganizations: candidate.typicalOrganizations,
      seniority: candidate.seniority,
      marketSegmentIds,
      evidenceClaimIds,
    });
  }

  return [...byTitle.values()].slice(0, 12);
}

function candidateFromGraph(node: any): RequirementCandidate | null {
  const label = compact(node.requirement || node.capability || node.knowledge || node.signal || node.label);
  if (!label) return null;
  const category = inferCategory(node.capitalType || node.category || node.type, label);
  return {
    label,
    aliases: uniqueStrings(asArray(node.aliases)),
    category,
    roleFamilyLabels: uniqueStrings([node.path, node.route, node.roleFamily, ...asArray(node.roleFamilies)].filter(Boolean)),
    priority: boundedPriority(node.priority),
    definition: compact(node.definition || node.whyItMatters || node.reason || node.evidence),
    successBar: compact(node.successBar || node.doneWhen || node.assessmentCriteria),
    evidenceText: compact(node.evidence || node.sourceTitle || node.reason),
    seniority: uniqueStrings([node.seniority, ...asArray(node.seniorityLevels)].filter(Boolean)),
    geographies: uniqueStrings([node.geography, node.location, ...asArray(node.geographies)].filter(Boolean)),
    employerTypes: uniqueStrings([node.employerType, ...asArray(node.employerTypes)].filter(Boolean)),
    notes: uniqueStrings(asArray(node.contextNotes || node.notes)),
  };
}

function fallbackCandidates(brief: any): RequirementCandidate[] {
  const map = brief.requirementMap || {};
  const entries = [
    ...asArray(map.knowledge).map((label) => ({ label, category: "knowledge" as RequirementCategory })),
    ...asArray(map.capabilities).map((label) => ({ label, category: "skill" as RequirementCategory })),
    ...asArray(map.evidence).map((label) => ({ label, category: "evidence" as RequirementCategory })),
    ...asArray(map.narrative).map((label) => ({ label, category: "narrative" as RequirementCategory })),
  ];
  return entries.map((entry) => ({
    label: compact(entry.label),
    aliases: [],
    category: entry.category,
    roleFamilyLabels: [],
    priority: 3,
    definition: "Recurring requirement inferred from the shared target research.",
    successBar: "",
    evidenceText: "Shared requirement map",
    seniority: [],
    geographies: [],
    employerTypes: [],
    notes: [],
  })).filter((candidate) => candidate.label);
}

function mergeCandidates(candidates: RequirementCandidate[]): RequirementCandidate[] {
  const byKey = new Map<string, RequirementCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.category}:${normalize(candidate.label)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate });
      continue;
    }
    existing.aliases = uniqueStrings([...existing.aliases, candidate.label, ...candidate.aliases]);
    existing.roleFamilyLabels = uniqueStrings([...existing.roleFamilyLabels, ...candidate.roleFamilyLabels]);
    existing.priority = Math.min(existing.priority, candidate.priority);
    existing.definition = existing.definition || candidate.definition;
    existing.successBar = existing.successBar || candidate.successBar;
    existing.evidenceText = uniqueStrings([existing.evidenceText, candidate.evidenceText]).join("; ");
    existing.seniority = uniqueStrings([...existing.seniority, ...candidate.seniority]);
    existing.geographies = uniqueStrings([...existing.geographies, ...candidate.geographies]);
    existing.employerTypes = uniqueStrings([...existing.employerTypes, ...candidate.employerTypes]);
    existing.notes = uniqueStrings([...existing.notes, ...candidate.notes]);
  }
  return [...byKey.values()];
}

function resolveRoleFamilyIds(labels: string[], roleFamilies: RequirementRoleFamily[]): string[] {
  const ids = new Set<string>();
  for (const label of labels) {
    const normalizedLabel = normalize(label);
    const match = roleFamilies.find((role) => {
      const normalizedRole = normalize(role.title);
      return normalizedRole === normalizedLabel || normalizedRole.includes(normalizedLabel) || normalizedLabel.includes(normalizedRole);
    });
    if (match) ids.add(match.id);
  }
  return [...ids];
}

function explicitGate(text: string): boolean {
  const normalized = normalize(text);
  return ["mandatory", "must have", "required", "clearance", "citizenship", "work authorization", "licence", "license"].some((term) => normalized.includes(term));
}

function deriveImportance(candidate: RequirementCandidate, roleFamilyIds: string[], linkedEvidence: RequirementEvidenceClaim[]): { importance: RequirementImportance; reason: string } {
  const directEvidence = linkedEvidence.filter((claim) => claim.directness === "direct");
  const shared = roleFamilyIds.length !== 1;
  const gate = explicitGate(`${candidate.label} ${candidate.definition} ${candidate.evidenceText}`);

  if ((candidate.priority === 1 && directEvidence.length > 0) || (gate && directEvidence.length > 0)) {
    return { importance: "essential", reason: "Direct employer or job evidence indicates this is a core requirement or formal gate." };
  }
  if (candidate.priority <= 2 || directEvidence.length >= 2 || (shared && linkedEvidence.length >= 2)) {
    return { importance: "important", reason: shared ? "This requirement recurs across the target or multiple role families." : "Credible sources indicate this materially affects competitiveness." };
  }
  if (!shared && linkedEvidence.length <= 1) {
    return { importance: "contextual", reason: "This appears specific to one role family or context rather than the whole target." };
  }
  return { importance: "differentiator", reason: "This is not consistently a formal gate, but stronger evidence here can differentiate a candidate." };
}

function deriveRequirementConfidence(linkedEvidence: RequirementEvidenceClaim[], evidenceText: string): RequirementConfidence {
  const direct = linkedEvidence.filter((claim) => claim.directness === "direct");
  const high = linkedEvidence.filter((claim) => claim.confidence === "high");
  if (direct.length >= 2 || (direct.length >= 1 && high.length >= 1)) return "high";
  if (linkedEvidence.length >= 1 || compact(evidenceText)) return "medium";
  return "low";
}

function buildRequirements(brief: any, roleFamilies: RequirementRoleFamily[], evidenceClaims: RequirementEvidenceClaim[]): TargetRequirement[] {
  const fromGraph = asArray(brief.requirementGraph).map(candidateFromGraph).filter(Boolean) as RequirementCandidate[];
  const candidates = mergeCandidates(fromGraph.length ? fromGraph : fallbackCandidates(brief));

  return candidates.map((candidate) => {
    const roleFamilyIds = resolveRoleFamilyIds(candidate.roleFamilyLabels, roleFamilies);
    const searchText = `${candidate.label} ${candidate.definition} ${candidate.evidenceText} ${candidate.roleFamilyLabels.join(" ")}`;
    const evidenceClaimIds = matchingEvidenceIds(searchText, evidenceClaims, 6);
    const linkedEvidence = evidenceClaims.filter((claim) => evidenceClaimIds.includes(claim.id));
    const importance = deriveImportance(candidate, roleFamilyIds, linkedEvidence);
    const key = `${candidate.category}:${normalize(candidate.label)}`;
    return {
      id: stableId("target-requirement", key),
      key,
      label: candidate.label,
      aliases: uniqueStrings(candidate.aliases.filter((alias) => normalize(alias) !== normalize(candidate.label))),
      definition: candidate.definition || `A ${candidate.category} requirement for the selected target.`,
      group: groupForCategory(candidate.category),
      category: candidate.category,
      importance: importance.importance,
      importanceReason: importance.reason,
      scope: roleFamilyIds.length === 1 ? "role_specific" : "shared",
      roleFamilyIds,
      successBar: candidate.successBar || defaultSuccessBar(candidate.category, candidate.label),
      evidenceClaimIds,
      confidence: deriveRequirementConfidence(linkedEvidence, candidate.evidenceText),
      context: {
        seniority: candidate.seniority,
        geographies: candidate.geographies,
        employerTypes: candidate.employerTypes,
        notes: candidate.notes,
      },
    } satisfies TargetRequirement;
  }).sort((left, right) => {
    const importanceRank: Record<RequirementImportance, number> = { essential: 0, important: 1, differentiator: 2, contextual: 3 };
    const groupRank: Record<RequirementGroupId, number> = { perform_work: 0, demonstrate_credibility: 1, access_opportunity: 2 };
    return importanceRank[left.importance] - importanceRank[right.importance]
      || groupRank[left.group] - groupRank[right.group]
      || left.label.localeCompare(right.label);
  }).slice(0, 40);
}

function buildResearchQuality(requirements: TargetRequirement[], evidenceClaims: RequirementEvidenceClaim[], roleFamilies: RequirementRoleFamily[]) {
  const directSourceCount = evidenceClaims.filter((claim) => claim.directness === "direct").length;
  const sourceTypeCount = new Set(evidenceClaims.map((claim) => normalize(claim.sourceType)).filter(Boolean)).size;
  const withEvidence = requirements.filter((requirement) => requirement.evidenceClaimIds.length > 0).length;
  const withDirectEvidence = requirements.filter((requirement) => requirement.evidenceClaimIds.some((id) => evidenceClaims.find((claim) => claim.id === id)?.directness === "direct")).length;
  const requirementEvidenceCoverage = requirements.length ? Math.round((withEvidence / requirements.length) * 100) : 0;
  const directRequirementCoverage = requirements.length ? Math.round((withDirectEvidence / requirements.length) * 100) : 0;
  const caveats: string[] = [];

  if (directSourceCount === 0) caveats.push("No direct job-posting or employer requirement evidence was captured, so this model should be treated as provisional.");
  if (requirementEvidenceCoverage < 60) caveats.push("Several requirements are not yet linked to a specific source claim and need stronger provenance.");
  if (roleFamilies.length > 6) caveats.push("The target spans several role families; shared requirements are reliable, but contextual requirements may vary materially.");
  if (sourceTypeCount < 3) caveats.push("The evidence base lacks source diversity and may over-represent one view of the market.");
  if (evidenceClaims.some((claim) => !claim.sourceUrl)) caveats.push("Some source URLs were unavailable, so those claims carry lower auditability.");

  const status = evidenceClaims.length >= 8 && directSourceCount >= 3 && requirementEvidenceCoverage >= 70 && directRequirementCoverage >= 35
    ? "strong"
    : evidenceClaims.length >= 5 && directSourceCount >= 1 && requirementEvidenceCoverage >= 50
      ? "usable"
      : "provisional";

  return {
    status,
    sourceCount: evidenceClaims.length,
    directSourceCount,
    sourceTypeCount,
    requirementEvidenceCoverage,
    directRequirementCoverage,
    caveats: uniqueStrings(caveats),
  } as const;
}

function targetLabel(track: any, brief: any): string {
  return compact(brief.careerHypothesis?.normalizedTitle) || compact(brief.trackName) || compact(track?.name) || compact(brief.domain) || "Chosen target";
}

function targetDefinition(track: any, brief: any): string {
  return compact(brief.summary) || compact(track?.description) || compact(brief.trackThesis) || `Requirements for ${targetLabel(track, brief)}.`;
}

function buildBoundaries(brief: any, marketSegments: RequirementMarketSegment[], roleFamilies: RequirementRoleFamily[]) {
  return {
    includes: uniqueStrings([...marketSegments.map((segment) => segment.title), ...roleFamilies.map((role) => role.title)]).slice(0, 16),
    excludes: uniqueStrings(asArray(brief.excludes || brief.outOfScope || brief.boundaries?.excludes)).slice(0, 10),
    openQuestions: uniqueStrings([
      ...asArray(brief.trackHypotheses).map((hypothesis: any) => hypothesis.howToTest),
      ...asArray(brief.evidenceLoops).map((loop: any) => loop.evidenceToCollect),
      ...asArray(brief.searchPlan?.ambiguityNotes),
    ]).slice(0, 10),
  };
}

export function buildRequirementModel(track: any, brief: any, sourceResearchAt = 0): RequirementModel {
  const generatedAt = Date.now();
  const evidenceClaims = buildEvidenceClaims(brief, generatedAt);
  const marketSegments = buildMarketSegments(brief, evidenceClaims);
  const roleFamilies = buildRoleFamilies(brief, marketSegments, evidenceClaims);
  const requirements = buildRequirements(brief, roleFamilies, evidenceClaims);
  const groups = (Object.keys(GROUP_META) as RequirementGroupId[]).map((id) => ({
    id,
    ...GROUP_META[id],
    requirementIds: requirements.filter((requirement) => requirement.group === id).map((requirement) => requirement.id),
  }));
  const fingerprintInput = [
    targetLabel(track, brief),
    ...marketSegments.map((segment) => segment.title),
    ...roleFamilies.map((role) => role.title),
    ...requirements.map((requirement) => `${requirement.key}:${requirement.importance}:${requirement.roleFamilyIds.join(",")}`),
    ...evidenceClaims.map((claim) => `${claim.sourceUrl || claim.sourceTitle}:${claim.claim}`),
  ].sort().join("|");

  return {
    mode: "requirement_model",
    version: REQUIREMENT_MODEL_VERSION,
    sourceFingerprint: stableHash(fingerprintInput),
    sourceResearchAt: Number(sourceResearchAt || 0),
    target: {
      label: targetLabel(track, brief),
      definition: targetDefinition(track, brief),
      assumption: "The user selected this target. Anchor is determining what it requires, not deciding whether the user should want it.",
    },
    marketSegments,
    roleFamilies,
    groups,
    requirements,
    evidenceClaims,
    researchQuality: buildResearchQuality(requirements, evidenceClaims, roleFamilies),
    boundaries: buildBoundaries(brief, marketSegments, roleFamilies),
    generatedAt,
  };
}
