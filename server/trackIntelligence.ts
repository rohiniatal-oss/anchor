import type { CareerTrack, Job, Learn, Contact, Hustle, Win } from "@shared/schema";
import { parseRoleModel, type RoleModel, type RoleModelRequirement } from "./roleModel";
import { llm, llmJSON, MODEL_LIGHT } from "./llm";
import { storage } from "./storage";

// ─────────────────────────────────────────────────────────────────────────
// TRACK INTELLIGENCE — aggregated understanding of a career direction.
//
// The track is the persistent, top-level object. Roles are data points
// inside it. Track intelligence gets richer over time as more roles are
// analyzed, learning is completed, and networking happens.
//
// Progressive enrichment stages:
//   1. Track created → name, thesis, role families
//   2. First role added → capabilities, knowledge areas, evidence expectations
//   3. Multiple roles → recurring requirements, common gaps, market patterns
//   4. User applies → actual opportunity interest confirmed
//   5. Learning/proof done → gap partially closed
// ─────────────────────────────────────────────────────────────────────────

export interface IntelligenceItem {
  text: string;
  source: "role_model" | "jd" | "user" | "inferred" | "observed";
  confidence: "high" | "medium" | "low";
  frequency: number;
  sourceRoles: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// REQUIREMENT BRIEFS — deep understanding of each recurring requirement.
//
// For every high-frequency requirement (capability, knowledge, evidence, or
// narrative), the system researches what it actually means in context, finds
// real resources, maps what the user already has, and plans concrete actions
// that simultaneously build the skill and produce evidence.
// ─────────────────────────────────────────────────────────────────────────

export type RequirementDimension = "capability" | "knowledge" | "evidence" | "narrative";

export interface BriefResource {
  title: string;
  url: string;
  whatItCovers: string;
  depth: "foundational" | "intermediate" | "advanced";
}

export interface BriefAction {
  action: string;
  producesEvidence: string;
  dependsOn: string[];
  timeEstimate: string;
}

export interface RequirementBrief {
  requirement: string;
  dimension: RequirementDimension;
  frequency: number;
  sourceRoles: string[];
  whatThisMeansHere: string;
  resources: BriefResource[];
  coverageAreas: string[];
  uncoveredAreas: string[];
  existingEvidence: string[];
  gapAssessment: string;
  actions: BriefAction[];
  proofArtifact: string;
  researchedAt: number;
}

export interface TrackIntelligence {
  thesis: string;
  roleFamilies: string[];
  targetOrganizations: string[];
  recurringCapabilities: IntelligenceItem[];
  recurringKnowledgeNeeds: IntelligenceItem[];
  recurringEvidenceBar: IntelligenceItem[];
  recurringNarrativeChallenges: IntelligenceItem[];
  requirementBriefs: RequirementBrief[];
  learningPriorities: string[];
  proofAssetsToBuild: string[];
  networkingTargets: string[];
  activeOpportunityCount: number;
  roleModelsAnalyzed: number;
  lastUpdated: number;
}

export function parseTrackIntelligence(raw: string): TrackIntelligence | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function emptyTrackIntelligence(track: CareerTrack): TrackIntelligence {
  return {
    thesis: track.whyItFits || track.description || "",
    roleFamilies: track.targetRoleArchetype ? [track.targetRoleArchetype] : [],
    targetOrganizations: [],
    recurringCapabilities: [],
    recurringKnowledgeNeeds: [],
    recurringEvidenceBar: [],
    recurringNarrativeChallenges: [],
    requirementBriefs: [],
    learningPriorities: [],
    proofAssetsToBuild: [],
    networkingTargets: [],
    activeOpportunityCount: 0,
    roleModelsAnalyzed: 0,
    lastUpdated: Date.now(),
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function isSimilar(a: string, b: string): boolean {
  const aNorm = normalizeText(a);
  const bNorm = normalizeText(b);
  if (aNorm === bNorm) return true;
  const aWords = new Set(aNorm.split(" ").filter((w) => w.length > 3));
  const bWords = bNorm.split(" ").filter((w) => w.length > 3);
  if (aWords.size === 0 || bWords.length === 0) return false;
  const overlap = bWords.filter((w) => aWords.has(w)).length;
  return overlap / Math.max(aWords.size, bWords.length) >= 0.6;
}

function mergeIntoRecurring(
  existing: IntelligenceItem[],
  newItems: RoleModelRequirement[],
  roleLabel: string,
  source: IntelligenceItem["source"],
): IntelligenceItem[] {
  const result = [...existing];
  for (const item of newItems) {
    const match = result.find((r) => isSimilar(r.text, item.text));
    if (match) {
      match.frequency += 1;
      if (!match.sourceRoles.includes(roleLabel)) match.sourceRoles.push(roleLabel);
      if (item.explicit && match.confidence === "low") match.confidence = "medium";
      if (item.explicit && match.confidence === "medium" && match.frequency >= 3) match.confidence = "high";
    } else {
      result.push({
        text: item.text,
        source,
        confidence: item.explicit ? (item.confidence || "medium") : "low",
        frequency: 1,
        sourceRoles: [roleLabel],
      });
    }
  }
  return result.sort((a, b) => b.frequency - a.frequency);
}

function deduplicateStrings(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const norm = normalizeText(item);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// DEEP RESEARCH — produces a RequirementBrief for a recurring requirement.
//
// Uses web_search_preview to find real resources, then synthesizes what
// each covers, maps gaps against what the user already has, and produces
// a concrete action plan where each step produces evidence.
// ─────────────────────────────────────────────────────────────────────────

function collectExistingEvidence(
  requirement: string,
  learn: Learn[],
  wins: Win[],
  hustles: Hustle[],
): string[] {
  const evidence: string[] = [];
  for (const l of learn) {
    if (l.done && isSimilar(requirement, l.capabilityBuilt || l.title)) {
      evidence.push(`Completed: ${l.title}`);
    }
  }
  for (const w of wins) {
    if (isSimilar(requirement, w.text) || isSimilar(requirement, w.takeaway || "")) {
      evidence.push(`Win: ${w.text}`);
    }
  }
  for (const h of hustles) {
    if (h.stage === "earning" && isSimilar(requirement, h.title)) {
      evidence.push(`Proof asset: ${h.title}`);
    }
  }
  return evidence;
}

function collectContextForRequirement(
  item: IntelligenceItem,
  dimension: RequirementDimension,
  jobs: Job[],
): string {
  const parts: string[] = [];
  for (const roleName of item.sourceRoles) {
    const job = jobs.find((j) => {
      const label = `${j.title}${j.company ? ` at ${j.company}` : ""}`;
      return label === roleName;
    });
    if (!job) continue;
    const rm = parseRoleModel(job.roleModel || "");
    if (!rm) continue;

    const coreWork = rm.coreWork.slice(0, 3).join("; ");
    if (dimension === "capability") {
      const evidenceItems = rm.evidenceBar.map((e) => e.text).slice(0, 2).join("; ");
      parts.push(`${roleName}: Core work includes "${coreWork}". Evidence expected: "${evidenceItems}".`);
    } else if (dimension === "knowledge") {
      parts.push(`${roleName}: Core work includes "${coreWork}". Mandate: "${rm.mandate.slice(0, 200)}".`);
    } else if (dimension === "evidence") {
      const fitSignals = rm.fitSignals.map((f) => f.text).slice(0, 2).join("; ");
      parts.push(`${roleName}: Fit signals include "${fitSignals}". Core work: "${coreWork}".`);
    } else {
      const hidden = rm.hiddenRequirements.map((h) => h.text).slice(0, 2).join("; ");
      parts.push(`${roleName}: Hidden requirements include "${hidden}". Core work: "${coreWork}".`);
    }
  }
  return parts.join("\n");
}

const DIMENSION_LABELS: Record<RequirementDimension, string> = {
  capability: "skill or method",
  knowledge: "sector or domain knowledge",
  evidence: "proof or evidence of experience",
  narrative: "working style or fit signal",
};

export async function researchRequirement(
  item: IntelligenceItem,
  dimension: RequirementDimension,
  trackName: string,
  jobs: Job[],
  learn: Learn[],
  wins: Win[],
  hustles: Hustle[],
): Promise<RequirementBrief> {
  const existing = collectExistingEvidence(item.text, learn, wins, hustles);
  const roleContext = collectContextForRequirement(item, dimension, jobs);
  const dimLabel = DIMENSION_LABELS[dimension];

  const prompt = `You are a career development researcher. A user is pursuing roles in "${trackName}".
Across ${item.frequency} roles (${item.sourceRoles.join(", ")}), the recurring ${dimLabel} requirement is:

"${item.text}"

Here is how this requirement appears in each role's context:
${roleContext || "No detailed role context available."}

${existing.length ? `The user already has this relevant experience:\n${existing.join("\n")}` : "The user has no existing evidence for this requirement."}

SEARCH for real resources (articles, frameworks, courses, case studies, examples) that would help someone build and demonstrate this ${dimLabel}. Then produce a JSON object:

{
  "whatThisMeansHere": "2-3 sentences: what '${item.text}' actually means in the context of these specific roles. Not a generic definition — what does day-to-day execution look like?",
  "resources": [
    {
      "title": "Exact title of the resource",
      "url": "Real URL",
      "whatItCovers": "One sentence: what specifically this resource teaches or demonstrates",
      "depth": "foundational|intermediate|advanced"
    }
  ],
  "coverageAreas": ["What topics/skills the found resources collectively cover"],
  "uncoveredAreas": ["What's still missing — topics the resources don't address that the roles need"],
  "gapAssessment": "One paragraph: given what the user already has and what the roles need, what specifically is the gap? Be concrete — not 'needs more experience' but 'has policy analysis background but no evidence of translating between technical and non-technical stakeholders in a regulatory context'.",
  "actions": [
    {
      "action": "Specific thing to do — read X then write Y, have conversation Z, build project W. Each action should produce something.",
      "producesEvidence": "What this action creates that serves as proof — a document, a conversation outcome, a project deliverable",
      "dependsOn": ["action texts this depends on, or empty"],
      "timeEstimate": "e.g. '2 hours', '1 week part-time'"
    }
  ],
  "proofArtifact": "The single most valuable thing the user could produce that simultaneously builds this ${dimLabel} AND creates credible evidence for these roles. Should be specific — not 'write something' but 'draft a two-page comparison of EU and UK AI governance approaches, structured as a policy brief suitable for a non-technical executive audience'."
}

Rules:
- Resources must be REAL — use web search. Include 3-5 resources at different depths.
- Actions should be sequenced so each builds on the previous. The last action should produce the proof artifact.
- Every action must produce something tangible — no "reflect on" or "think about".
- The proof artifact should be something that works in an interview, a portfolio, or a conversation — real evidence.
- Be specific to these roles and this track, not generic career advice.`;

  try {
    const result = await llmJSON<Omit<RequirementBrief, "requirement" | "dimension" | "frequency" | "sourceRoles" | "existingEvidence" | "researchedAt">>(
      prompt,
      { model: MODEL_LIGHT, tools: [{ type: "web_search_preview" }] },
    );

    if (!result || !result.whatThisMeansHere) {
      return fallbackBrief(item, dimension, existing);
    }

    return {
      requirement: item.text,
      dimension,
      frequency: item.frequency,
      sourceRoles: [...item.sourceRoles],
      whatThisMeansHere: result.whatThisMeansHere,
      resources: Array.isArray(result.resources) ? result.resources.slice(0, 5) : [],
      coverageAreas: Array.isArray(result.coverageAreas) ? result.coverageAreas : [],
      uncoveredAreas: Array.isArray(result.uncoveredAreas) ? result.uncoveredAreas : [],
      existingEvidence: existing,
      gapAssessment: result.gapAssessment || "",
      actions: Array.isArray(result.actions) ? result.actions : [],
      proofArtifact: result.proofArtifact || "",
      researchedAt: Date.now(),
    };
  } catch {
    return fallbackBrief(item, dimension, existing);
  }
}

function fallbackBrief(
  item: IntelligenceItem,
  dimension: RequirementDimension,
  existing: string[],
): RequirementBrief {
  return {
    requirement: item.text,
    dimension,
    frequency: item.frequency,
    sourceRoles: [...item.sourceRoles],
    whatThisMeansHere: "",
    resources: [],
    coverageAreas: [],
    uncoveredAreas: [],
    existingEvidence: existing,
    gapAssessment: existing.length
      ? `Has some related experience but depth against role requirements is unknown.`
      : `No existing evidence found. Research needed.`,
    actions: [],
    proofArtifact: "",
    researchedAt: 0,
  };
}

export async function researchTrackRequirements(
  track: CareerTrack,
  intel: TrackIntelligence,
  jobs: Job[],
  learn: Learn[],
  wins: Win[],
  hustles: Hustle[],
): Promise<RequirementBrief[]> {
  const trackJobs = jobs.filter((j) => j.relatedTrackId === track.id && j.status !== "closed");
  const trackLearn = learn.filter((l) => l.relatedTrackId === track.id);
  const trackWins = wins.filter((w) => w.trackId === track.id);
  const trackHustles = hustles.filter((h) => h.proofAssetForTrack === track.id);

  const existingBriefs = intel.requirementBriefs || [];
  const existingKeys = new Set(existingBriefs.map((b) => `${b.dimension}::${normalizeText(b.requirement)}`));

  const toResearch: Array<{ item: IntelligenceItem; dimension: RequirementDimension }> = [];

  const dimensions: Array<{ items: IntelligenceItem[]; dimension: RequirementDimension }> = [
    { items: intel.recurringCapabilities, dimension: "capability" },
    { items: intel.recurringKnowledgeNeeds, dimension: "knowledge" },
    { items: intel.recurringEvidenceBar, dimension: "evidence" },
    { items: intel.recurringNarrativeChallenges, dimension: "narrative" },
  ];

  for (const { items, dimension } of dimensions) {
    for (const item of items) {
      if (item.frequency < 2) continue;
      const key = `${dimension}::${normalizeText(item.text)}`;
      if (existingKeys.has(key)) continue;
      toResearch.push({ item, dimension });
    }
  }

  if (toResearch.length === 0) return existingBriefs;

  const maxParallel = 3;
  const batch = toResearch.slice(0, maxParallel);
  const briefs = await Promise.all(
    batch.map(({ item, dimension }) =>
      researchRequirement(item, dimension, track.name, trackJobs, trackLearn, trackWins, trackHustles),
    ),
  );

  return [...existingBriefs, ...briefs];
}

export function aggregateTrackIntelligence(
  track: CareerTrack,
  jobs: Job[],
  learn: Learn[],
  contacts: Contact[],
  hustles: Hustle[],
  wins: Win[],
): TrackIntelligence {
  const existing = parseTrackIntelligence(track.trackIntelligence || "") || emptyTrackIntelligence(track);
  const trackJobs = jobs.filter((j) => j.relatedTrackId === track.id && j.status !== "closed");
  const trackLearn = learn.filter((l) => l.relatedTrackId === track.id && !l.done);
  const trackContacts = contacts.filter((c) => c.relatedTrackId === track.id);
  const trackHustles = hustles.filter((h) => h.proofAssetForTrack === track.id);
  const trackWins = wins.filter((w) => w.trackId === track.id);

  let intel = { ...existing };
  intel.activeOpportunityCount = trackJobs.length;
  intel.lastUpdated = Date.now();

  const organizations = new Set(intel.targetOrganizations);
  const roleFamilies = new Set(intel.roleFamilies);
  let roleModelsAnalyzed = 0;

  for (const job of trackJobs) {
    if (job.company) organizations.add(job.company);
    if (job.roleArchetype) roleFamilies.add(job.roleArchetype);

    const roleModel = parseRoleModel(job.roleModel || "");
    if (!roleModel) continue;
    roleModelsAnalyzed++;

    const roleLabel = `${job.title}${job.company ? ` at ${job.company}` : ""}`;

    intel.recurringCapabilities = mergeIntoRecurring(
      intel.recurringCapabilities, roleModel.capabilityRequirements, roleLabel, "role_model",
    );
    intel.recurringKnowledgeNeeds = mergeIntoRecurring(
      intel.recurringKnowledgeNeeds, roleModel.sectorFluency, roleLabel, "role_model",
    );
    intel.recurringEvidenceBar = mergeIntoRecurring(
      intel.recurringEvidenceBar, roleModel.evidenceBar, roleLabel, "role_model",
    );
    intel.recurringNarrativeChallenges = mergeIntoRecurring(
      intel.recurringNarrativeChallenges, roleModel.fitSignals, roleLabel, "role_model",
    );

    if (roleModel.mandate && !intel.thesis) {
      intel.thesis = roleModel.mandate;
    }
  }

  intel.targetOrganizations = deduplicateStrings([...organizations]);
  intel.roleFamilies = deduplicateStrings([...roleFamilies]);
  intel.roleModelsAnalyzed = roleModelsAnalyzed;

  intel.learningPriorities = deduplicateStrings([
    ...trackLearn.map((l) => l.title),
    ...intel.learningPriorities,
  ]).slice(0, 10);

  intel.proofAssetsToBuild = deduplicateStrings([
    ...trackHustles.filter((h) => h.stage !== "earning").map((h) => h.title),
    ...intel.proofAssetsToBuild,
  ]).slice(0, 5);

  intel.networkingTargets = deduplicateStrings([
    ...trackContacts.map((c) => c.name || c.who),
    ...intel.networkingTargets,
  ]).slice(0, 10);

  return intel;
}

export async function refreshTrackIntelligence(trackId: number, deepResearch = false): Promise<TrackIntelligence | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;

  const [jobs, learn, contacts, hustles, wins] = await Promise.all([
    storage.getJobs(),
    storage.getLearn(),
    storage.getContacts(),
    storage.getHustles(),
    storage.getWins(),
  ]);

  const intel = aggregateTrackIntelligence(track, jobs, learn, contacts, hustles, wins);

  if (deepResearch && intel.roleModelsAnalyzed > 0) {
    intel.requirementBriefs = await researchTrackRequirements(track, intel, jobs, learn, wins, hustles);
  }

  await storage.updateCareerTrack(trackId, { trackIntelligence: JSON.stringify(intel) });
  return intel;
}

export async function getTrackIntelligence(track: CareerTrack): Promise<TrackIntelligence> {
  if ((track.trackIntelligence || "").trim()) {
    const cached = parseTrackIntelligence(track.trackIntelligence);
    if (cached) return cached;
  }
  const refreshed = await refreshTrackIntelligence(track.id);
  return refreshed || emptyTrackIntelligence(track);
}

export function trackRecurringGapsSummary(intel: TrackIntelligence): string {
  const topCapabilities = intel.recurringCapabilities.filter((i) => i.frequency >= 2).slice(0, 3);
  const topKnowledge = intel.recurringKnowledgeNeeds.filter((i) => i.frequency >= 2).slice(0, 3);
  const topEvidence = intel.recurringEvidenceBar.filter((i) => i.frequency >= 2).slice(0, 3);

  const parts: string[] = [];
  if (topCapabilities.length) {
    parts.push(`Recurring capabilities: ${topCapabilities.map((i) => i.text).join("; ")}`);
  }
  if (topKnowledge.length) {
    parts.push(`Recurring knowledge needs: ${topKnowledge.map((i) => i.text).join("; ")}`);
  }
  if (topEvidence.length) {
    parts.push(`Recurring evidence bar: ${topEvidence.map((i) => i.text).join("; ")}`);
  }
  return parts.join(". ") || "Not enough role data yet to identify recurring patterns.";
}
