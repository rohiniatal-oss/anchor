import type { CareerTrack } from "@shared/schema";
import { storage } from "./storage";
import {
  runStructuredTrackResearch,
  type StructuredTrackResearchResult,
} from "./trackResearchMethod";
import { buildCareerArchitecture } from "./trackResearchArchitecture";
import { buildBottleneckDiagnosis } from "./trackResearchBottlenecks";
import { architectureWorkspaceView } from "./trackResearchArchitectureWorkspace";
import { buildRequirementModel } from "./trackResearchRequirementModel";
import { enhanceRequirementModelWithLlm } from "./trackResearchRequirementSynthesis";

const GENERIC_DIRECTION_WORDS = new Set([
  "career",
  "careers",
  "field",
  "industry",
  "industries",
  "job",
  "jobs",
  "path",
  "paths",
  "role",
  "roles",
  "sector",
  "sectors",
  "space",
  "track",
]);

const inFlightResearch = new Map<string, Promise<StoredStructuredTrackResearchResult | null>>();

export type StoredStructuredTrackResearchResult = {
  track: CareerTrack;
  brief: StructuredTrackResearchResult["brief"];
  plan: StructuredTrackResearchResult["brief"]["plan"];
  searchPlan: StructuredTrackResearchResult["brief"]["searchPlan"];
  evidencePack: StructuredTrackResearchResult["brief"]["evidencePack"];
  researchEvidence: StructuredTrackResearchResult["brief"]["researchEvidence"];
  careerHypothesis: StructuredTrackResearchResult["brief"]["careerHypothesis"];
  pathHypotheses: StructuredTrackResearchResult["brief"]["pathHypotheses"];
  trackHypotheses: StructuredTrackResearchResult["brief"]["trackHypotheses"];
  requirementGraph: StructuredTrackResearchResult["brief"]["requirementGraph"];
  careerCapitalPortfolio: StructuredTrackResearchResult["brief"]["careerCapitalPortfolio"];
  gapPortfolio: StructuredTrackResearchResult["brief"]["gapPortfolio"];
  interventionRecommendations: StructuredTrackResearchResult["brief"]["interventionRecommendations"];
  developmentPlans: StructuredTrackResearchResult["brief"]["developmentPlans"];
  evidenceLoops: StructuredTrackResearchResult["brief"]["evidenceLoops"];
  fitGapMatrix: StructuredTrackResearchResult["brief"]["fitGapMatrix"];
  requirementModel: any;
  organizedWorkspace: any;
  careerArchitecture: any;
  bottleneckDiagnosis: any;
  automaticSelection: any;
  materialized: null;
  createdTrack: boolean;
  reusedTrack: boolean;
};

export type StructuredTrackResearchRunner = (
  domain: string,
  options?: { materialize?: boolean },
) => Promise<StructuredTrackResearchResult | null>;

export type StructuredTrackResearchDependencies = {
  runBaseResearch?: StructuredTrackResearchRunner;
  buildRequirementModel?: typeof buildRequirementModel;
  enhanceRequirementModel?: typeof enhanceRequirementModelWithLlm;
  buildCareerArchitecture?: typeof buildCareerArchitecture;
  buildBottleneckDiagnosis?: typeof buildBottleneckDiagnosis;
  buildWorkspaceView?: typeof architectureWorkspaceView;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * A stable identity key for career directions. It removes routing verbs and
 * generic suffixes, but never invents an acronym expansion.
 */
export function careerDirectionKey(value: unknown): string {
  const normalized = compact(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^(?:explore|get into|break into|look into|research|understand|map out)\s+/i, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  while (tokens.length > 1 && GENERIC_DIRECTION_WORDS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

function trackIdentityKeys(track: CareerTrack): string[] {
  const intelligence = parseJsonObject(track.trackIntelligence);
  return [
    track.name,
    track.slug,
    intelligence.sourceDomain,
    intelligence.careerHypothesis?.input,
    intelligence.careerHypothesis?.normalizedTitle,
  ]
    .map(careerDirectionKey)
    .filter(Boolean);
}

function comparableDirectionKeys(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size) >= 0.8;
}

export function findExistingCareerDirection(tracks: CareerTrack[], domain: string): CareerTrack | null {
  const targetKey = careerDirectionKey(domain);
  if (!targetKey) return null;
  return tracks.find((track) => trackIdentityKeys(track).some((key) => comparableDirectionKeys(key, targetKey))) || null;
}

async function reconcileDuplicateTrack(
  existing: CareerTrack,
  researched: CareerTrack,
): Promise<CareerTrack> {
  if (existing.id === researched.id) return researched;
  const merged = await storage.updateCareerTrack(existing.id, {
    name: existing.name || researched.name,
    description: researched.description || existing.description,
    targetRoleArchetype: researched.targetRoleArchetype || existing.targetRoleArchetype,
    priority: Math.max(existing.priority || 0, researched.priority || 0, 70),
    status: existing.status || researched.status || "active",
    whyItFits: researched.whyItFits || existing.whyItFits,
    trackIntelligence: researched.trackIntelligence || existing.trackIntelligence,
  } as any);
  await storage.deleteCareerTrack(researched.id);
  return merged || existing;
}

async function runResearchPipeline(
  domain: string,
  dependencies: StructuredTrackResearchDependencies,
): Promise<StoredStructuredTrackResearchResult | null> {
  const cleaned = compact(domain);
  if (!cleaned) return null;

  const tracksBefore = await storage.getCareerTracks();
  const existingBefore = findExistingCareerDirection(tracksBefore, cleaned);
  const idsBefore = new Set(tracksBefore.map((track) => track.id));
  const baseRunner = dependencies.runBaseResearch || runStructuredTrackResearch;

  // This is the only permitted broad-direction research call. Materialization is
  // explicitly disabled; activation remains a separate user command.
  const result = await baseRunner(cleaned, { materialize: false });
  if (!result) return null;

  const canonicalTrack = existingBefore
    ? await reconcileDuplicateTrack(existingBefore, result.track)
    : result.track;
  const currentIntelligence = parseJsonObject(canonicalTrack.trackIntelligence);
  const sourceResearchAt = Number(currentIntelligence.researchedAt || Date.now());
  const buildRequirements = dependencies.buildRequirementModel || buildRequirementModel;
  const enhanceRequirements = dependencies.enhanceRequirementModel || enhanceRequirementModelWithLlm;
  const buildArchitecture = dependencies.buildCareerArchitecture || buildCareerArchitecture;
  const diagnoseBottlenecks = dependencies.buildBottleneckDiagnosis || buildBottleneckDiagnosis;
  const buildWorkspace = dependencies.buildWorkspaceView || architectureWorkspaceView;

  const draftRequirementModel = buildRequirements(canonicalTrack, result.brief, sourceResearchAt);
  const requirementModel = await enhanceRequirements(canonicalTrack, result.brief, draftRequirementModel);
  const careerArchitecture = buildArchitecture(canonicalTrack, result.brief, result.organizedWorkspace);
  const bottleneckDiagnosis = diagnoseBottlenecks(canonicalTrack, result.brief, careerArchitecture);
  const organizedWorkspace = buildWorkspace(
    result.organizedWorkspace,
    careerArchitecture,
    bottleneckDiagnosis,
  );
  const nextIntelligence = {
    ...currentIntelligence,
    requirementModel,
    organizedWorkspace,
    careerArchitecture,
    bottleneckDiagnosis,
    automaticSelection: careerArchitecture.automaticSelection,
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(canonicalTrack.id, {
    trackIntelligence: JSON.stringify(nextIntelligence),
  } as any);
  const track = updatedTrack || canonicalTrack;
  const reusedTrack = !!existingBefore || idsBefore.has(result.track.id);

  return {
    track,
    brief: result.brief,
    plan: result.brief.plan,
    searchPlan: result.brief.searchPlan,
    evidencePack: result.brief.evidencePack,
    researchEvidence: result.brief.researchEvidence,
    careerHypothesis: result.brief.careerHypothesis,
    pathHypotheses: result.brief.pathHypotheses,
    trackHypotheses: result.brief.trackHypotheses,
    requirementGraph: result.brief.requirementGraph,
    careerCapitalPortfolio: result.brief.careerCapitalPortfolio,
    gapPortfolio: result.brief.gapPortfolio,
    interventionRecommendations: result.brief.interventionRecommendations,
    developmentPlans: result.brief.developmentPlans,
    evidenceLoops: result.brief.evidenceLoops,
    fitGapMatrix: result.brief.fitGapMatrix,
    requirementModel,
    organizedWorkspace,
    careerArchitecture,
    bottleneckDiagnosis,
    automaticSelection: careerArchitecture.automaticSelection,
    materialized: null,
    createdTrack: !reusedTrack,
    reusedTrack,
  };
}

/**
 * Research and persist one career direction without creating jobs, learning
 * items, contacts, proof assets, projects, or tasks. Concurrent requests for the
 * same normalized direction share one in-flight run.
 */
export async function researchCareerDirection(
  domain: string,
  dependencies: StructuredTrackResearchDependencies = {},
): Promise<StoredStructuredTrackResearchResult | null> {
  const key = careerDirectionKey(domain);
  if (!key) return null;
  if (dependencies.runBaseResearch) return runResearchPipeline(domain, dependencies);

  const existing = inFlightResearch.get(key);
  if (existing) return existing;
  const pending = runResearchPipeline(domain, dependencies).finally(() => {
    if (inFlightResearch.get(key) === pending) inFlightResearch.delete(key);
  });
  inFlightResearch.set(key, pending);
  return pending;
}
