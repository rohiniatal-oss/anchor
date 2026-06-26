import type { CareerTrack } from "@shared/schema";
import { storage } from "./storage";
import type { MaterializedTrackResearch, TrackResearchBrief } from "./trackResearchAgent";

export type RoleModelExample = {
  title: string;
  what: string;
  typicalOrgs: string[];
  seniority: string;
  sourceType: "track_research_role_shape";
};

export type TrackResearchActivationInventory = MaterializedTrackResearch & {
  /**
   * Role shapes discovered by research. These are market examples, not verified
   * opportunities, so they intentionally do not enter the Jobs table.
   */
  roleModelExamples: RoleModelExample[];
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items.map(compact).filter(Boolean)) {
    const key = normalize(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function roleModelExamplesFromResearch(brief: TrackResearchBrief): RoleModelExample[] {
  return asArray(brief.roleShapes).slice(0, 8).map((role) => ({
    title: compact(role.title),
    what: compact(role.what),
    typicalOrgs: uniqueStrings(asArray(role.typicalOrgs)),
    seniority: compact(role.seniority) || "mixed",
    sourceType: "track_research_role_shape" as const,
  })).filter((role) => role.title);
}

/**
 * Explicit activation inventory for track research. It can create learning,
 * contact, and proof candidates from selected development recommendations, but
 * it never creates Jobs from role shapes. A Job must represent a verified
 * opportunity supplied or confirmed elsewhere.
 */
export async function materializeTrackResearchActivation(
  track: CareerTrack,
  brief: TrackResearchBrief,
): Promise<TrackResearchActivationInventory> {
  const result: TrackResearchActivationInventory = {
    trackId: track.id,
    jobIds: [],
    learnIds: [],
    contactIds: [],
    hustleIds: [],
    roleModelExamples: roleModelExamplesFromResearch(brief),
  };

  const existingLearn = await storage.getLearn();
  const learnKeys = new Set(existingLearn.map((learn) => normalize(learn.title)));
  for (const path of asArray(brief.learningPaths).slice(0, 5)) {
    const key = normalize(path.topic);
    if (!key || learnKeys.has(key)) continue;
    try {
      const learn = await storage.createLearn({
        title: path.topic,
        type: path.resourceType || "resource",
        learnStatus: "open",
        note: `${path.why}${path.suggestedResource ? ` Suggested resource: ${path.suggestedResource}.` : ""}`,
        capabilityBuilt: path.topic,
        requiredOutput: path.output || `A reusable note or artifact on ${path.topic}`,
        relatedTrackId: track.id,
        sourceType: "track_research",
        proofIntent: true,
      } as any);
      result.learnIds.push(learn.id);
      learnKeys.add(key);
    } catch {}
  }

  const existingContacts = await storage.getContacts();
  const contactKeys = new Set(existingContacts.map((contact) => normalize(contact.who || contact.name)));
  for (const archetype of asArray(brief.networkArchetypes).slice(0, 5)) {
    const key = normalize(archetype.who);
    if (!key || contactKeys.has(key)) continue;
    try {
      const contact = await storage.createContact({
        name: "",
        who: archetype.who,
        why: archetype.why,
        status: "to_contact",
        relationshipStrength: "cold",
        askType: "advice",
        note: archetype.searchTip,
        relatedTrackId: track.id,
      } as any);
      result.contactIds.push(contact.id);
      contactKeys.add(key);
    } catch {}
  }

  const existingHustles = await storage.getHustles();
  const hustleKeys = new Set(existingHustles.map((hustle) => normalize(hustle.title)));
  for (const idea of asArray(brief.proofAssetIdeas).slice(0, 3)) {
    const key = normalize(idea.title);
    if (!key || hustleKeys.has(key)) continue;
    try {
      const hustle = await storage.createHustle({
        title: idea.title,
        note: `${idea.why}${idea.format ? ` Format: ${idea.format}.` : ""}`,
        nextStep: idea.firstStep || "Define the first useful artifact outline.",
        stage: "idea",
        proofAssetForTrack: track.id,
      } as any);
      result.hustleIds.push(hustle.id);
      hustleKeys.add(key);
    } catch {}
  }

  return result;
}
