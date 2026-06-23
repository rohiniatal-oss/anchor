import type { Express } from "express";
import { storage } from "./storage";
import { buildCanonicalUserEvidenceCorpus } from "./trackResearchCoverageCorpus";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import {
  DEVELOPMENT_PLAN_MODEL_VERSION,
  developmentPlanCoverageFingerprint,
  type DevelopmentPlanModel,
} from "./trackResearchDevelopmentPlan";
import { hardenDevelopmentPlan } from "./trackResearchDevelopmentGuardrails";
import {
  developmentPlanContextFromIntelligence,
  enhanceDevelopmentPlanWithLlm,
} from "./trackResearchDevelopmentSynthesis";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function completeContextFingerprint(context: ReturnType<typeof developmentPlanContextFromIntelligence>): string {
  const assets = context.existingAssets.map((item) => ({
    id: item.id,
    state: item.state,
    strength: item.strength,
    usableForCoverage: item.usableForCoverage,
    detail: item.detail,
    sourceUrl: item.sourceUrl,
    trackIds: [...item.trackIds].sort((left, right) => left - right),
  }));
  return stableHash(JSON.stringify({ base: context.sourceContextFingerprint, assets }));
}

function validDevelopmentPlan(
  value: any,
  requirementModelFingerprint: string,
  coverageFingerprint: string,
  sourceContextFingerprint: string,
): value is DevelopmentPlanModel {
  return value?.mode === "development_plan_model"
    && value?.version === DEVELOPMENT_PLAN_MODEL_VERSION
    && value?.requirementModelFingerprint === requirementModelFingerprint
    && value?.coverageFingerprint === coverageFingerprint
    && value?.sourceContextFingerprint === sourceContextFingerprint
    && Array.isArray(value.decisions)
    && Array.isArray(value.workstreams)
    && Array.isArray(value.maintenanceRequirementIds);
}

async function computeDevelopmentPlan(trackId: number, force: boolean) {
  const coverageResult = await ensureRequirementCoverage(trackId, false);
  if (!coverageResult) return null;
  if ("error" in coverageResult) return coverageResult;

  const intelligence = parseJsonObject(coverageResult.track.trackIntelligence);
  const corpus = await buildCanonicalUserEvidenceCorpus(trackId);
  const context = developmentPlanContextFromIntelligence(intelligence, corpus.items);
  context.sourceContextFingerprint = completeContextFingerprint(context);
  const requirementFingerprint = coverageResult.coverageModel.requirementModelFingerprint;
  const coverageFingerprint = developmentPlanCoverageFingerprint(coverageResult.coverageModel);
  const stored = intelligence.developmentPlanModel;

  if (!force && validDevelopmentPlan(
    stored,
    requirementFingerprint,
    coverageFingerprint,
    context.sourceContextFingerprint,
  )) {
    return {
      track: coverageResult.track,
      requirementModel: coverageResult.requirementModel,
      coverageModel: coverageResult.coverageModel,
      developmentPlanModel: stored as DevelopmentPlanModel,
      refreshed: false,
    } as const;
  }

  const synthesizedPlan = await enhanceDevelopmentPlanWithLlm(
    coverageResult.requirementModel,
    coverageResult.coverageModel,
    context,
  );
  const developmentPlanModel = hardenDevelopmentPlan(
    synthesizedPlan,
    coverageResult.requirementModel,
    coverageResult.coverageModel,
  );
  developmentPlanModel.requirementModelFingerprint = requirementFingerprint;

  // Merge against the latest track intelligence so a concurrent coverage or
  // profile refresh is not overwritten by this slower planning request.
  const latestTrack = await storage.getCareerTrack(trackId) || coverageResult.track;
  const latestIntelligence = parseJsonObject(latestTrack.trackIntelligence);
  const nextIntelligence = {
    ...latestIntelligence,
    developmentPlanModel,
    developmentPlannedAt: developmentPlanModel.generatedAt,
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(
    trackId,
    { trackIntelligence: JSON.stringify(nextIntelligence) } as any,
  );

  return {
    track: updatedTrack || latestTrack,
    requirementModel: coverageResult.requirementModel,
    coverageModel: coverageResult.coverageModel,
    developmentPlanModel,
    refreshed: true,
  } as const;
}

type DevelopmentResult = Awaited<ReturnType<typeof computeDevelopmentPlan>>;
const developmentInFlight = new Map<number, Promise<DevelopmentResult>>();

export async function ensureDevelopmentPlan(trackId: number, force = false): Promise<DevelopmentResult> {
  if (!force) {
    const active = developmentInFlight.get(trackId);
    if (active) return active;
  }

  const promise = computeDevelopmentPlan(trackId, force);
  developmentInFlight.set(trackId, promise);
  try {
    return await promise;
  } finally {
    if (developmentInFlight.get(trackId) === promise) developmentInFlight.delete(trackId);
  }
}

export function registerTrackResearchDevelopmentRoutes(app: Express) {
  app.get("/api/career-tracks/:id/development-plan", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureDevelopmentPlan(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if ("error" in result) return res.status(409).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/development-plan/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureDevelopmentPlan(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if ("error" in result) return res.status(409).json({ error: result.error });
    return res.json({ ...result, refreshed: true });
  });
}
