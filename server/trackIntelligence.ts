import type { CareerTrack, Job, Learn, Contact, Hustle, Win } from "@shared/schema";
import { parseRoleModel, type RoleModel, type RoleModelRequirement } from "./roleModel";
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

export interface TrackIntelligence {
  thesis: string;
  roleFamilies: string[];
  targetOrganizations: string[];
  recurringCapabilities: IntelligenceItem[];
  recurringKnowledgeNeeds: IntelligenceItem[];
  recurringEvidenceBar: IntelligenceItem[];
  recurringNarrativeChallenges: IntelligenceItem[];
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

export async function refreshTrackIntelligence(trackId: number): Promise<TrackIntelligence | null> {
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
