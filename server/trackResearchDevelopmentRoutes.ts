import type { Express } from "express";
import { storage } from "./storage";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import {
  buildDevelopmentPlanDraft,
  developmentPlanSourceFingerprint,
  DEVELOPMENT_PLAN_VERSION,
  type DevelopmentPlanModel,
} from "./trackResearchDevelopmentPlan";
import { enhanceDevelopmentPlanWithLlm } from "./trackResearchDevelopmentSynthesis";
import {
  developmentResourcesNeedRefresh,
  refreshDevelopmentPlanResources,
  seedDevelopmentPlanResources,
} from "./trackResearchDevelopmentResources";
import type { RequirementModel } from "./trackResearchRequirementModel";
import type { CoverageModel } from "./trackResearchCoverageModel";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validDevelopmentPlan(
  value: any,
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
): value is DevelopmentPlanModel {
  const sourceFingerprint = developmentPlanSourceFingerprint(requirementModel, coverageModel);
  const requirementIds = new Set(requirementModel.requirements.map((requirement) => requirement.id));
  return value?.mode === "development_plan_model"
    && value?.version === DEVELOPMENT_PLAN_VERSION
    && value?.requirementModelVersion === requirementModel.version
    && value?.requirementModelFingerprint === coverageModel.requirementModelFingerprint
    && value?.coverageModelVersion === coverageModel.version
    && value?.sourceFingerprint === sourceFingerprint
    && Array.isArray(value.workstreams)
    && Array.isArray(value.decisions)
    && value.decisions.length === requirementIds.size
    && value.decisions.every((decision: any) => requirementIds.has(decision.requirementId));
}

async function persistDevelopmentPlan(trackId: number, plan: DevelopmentPlanModel) {
  const latestTrack = await storage.getCareerTrack(trackId);
  if (!latestTrack) return null;
  const intelligence = parseJsonObject(latestTrack.trackIntelligence);
  return storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      developmentPlanModel: plan,
      developmentPlanUpdatedAt: plan.generatedAt,
      lastUpdated: Date.now(),
    }),
  } as any);
}

const planLocks = new Map<number, Promise<any>>();
const resourceLocks = new Map<number, Promise<any>>();

async function withLock<T>(locks: Map<number, Promise<any>>, trackId: number, work: () => Promise<T>): Promise<T> {
  const existing = locks.get(trackId);
  if (existing) return existing as Promise<T>;
  const promise = work().finally(() => {
    if (locks.get(trackId) === promise) locks.delete(trackId);
  });
  locks.set(trackId, promise);
  return promise;
}

export async function ensureDevelopmentPlan(trackId: number, force = false) {
  return withLock(planLocks, trackId, async () => {
    const coverageResult = await ensureRequirementCoverage(trackId, false);
    if (!coverageResult) return null;
    if ("error" in coverageResult) return coverageResult;

    const latestTrack = await storage.getCareerTrack(trackId) || coverageResult.track;
    const intelligence = parseJsonObject(latestTrack.trackIntelligence);
    const { requirementModel, coverageModel } = coverageResult;
    const stored = intelligence.developmentPlanModel;
    if (!force && validDevelopmentPlan(stored, requirementModel, coverageModel)) {
      return {
        track: latestTrack,
        requirementModel,
        coverageModel,
        developmentPlanModel: stored as DevelopmentPlanModel,
        refreshed: false,
        resourceRefreshRecommended: developmentResourcesNeedRefresh(stored as DevelopmentPlanModel),
      } as const;
    }

    const draft = buildDevelopmentPlanDraft(requirementModel, coverageModel);
    const enhanced = await enhanceDevelopmentPlanWithLlm(requirementModel, coverageModel, draft);
    const developmentPlanModel = seedDevelopmentPlanResources(requirementModel, enhanced);
    const updatedTrack = await persistDevelopmentPlan(trackId, developmentPlanModel);
    return {
      track: updatedTrack || latestTrack,
      requirementModel,
      coverageModel,
      developmentPlanModel,
      refreshed: true,
      resourceRefreshRecommended: developmentResourcesNeedRefresh(developmentPlanModel),
    } as const;
  });
}

export async function ensureDevelopmentResources(trackId: number, force = false) {
  return withLock(resourceLocks, trackId, async () => {
    const planResult = await ensureDevelopmentPlan(trackId, false);
    if (!planResult || "error" in planResult) return planResult;
    if (!force && !developmentResourcesNeedRefresh(planResult.developmentPlanModel)) return planResult;

    const developmentPlanModel = await refreshDevelopmentPlanResources(
      planResult.requirementModel,
      planResult.developmentPlanModel,
    );
    const updatedTrack = await persistDevelopmentPlan(trackId, developmentPlanModel);
    return {
      ...planResult,
      track: updatedTrack || planResult.track,
      developmentPlanModel,
      refreshed: true,
      resourceRefreshRecommended: developmentResourcesNeedRefresh(developmentPlanModel),
    } as const;
  });
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
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/development-plan/resources/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureDevelopmentResources(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if ("error" in result) return res.status(409).json({ error: result.error });
    return res.json(result);
  });
}
