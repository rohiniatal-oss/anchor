import type { Express } from "express";
import { storage } from "./storage";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import {
  buildExecutionBlueprintDraft,
  EXECUTION_BLUEPRINT_VERSION,
  executionBlueprintSourceFingerprint,
  type ExecutionBlueprintModel,
} from "./trackResearchExecutionBlueprint";
import { enhanceExecutionBlueprintWithLlm } from "./trackResearchExecutionSynthesis";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validExecutionBlueprint(
  value: any,
  developmentPlanFingerprint: string,
): value is ExecutionBlueprintModel {
  return value?.mode === "execution_blueprint_model"
    && value?.version === EXECUTION_BLUEPRINT_VERSION
    && value?.developmentPlanFingerprint === developmentPlanFingerprint
    && value?.sourceFingerprint === developmentPlanFingerprint
    && value?.materializationStatus === "blueprint_only"
    && Array.isArray(value.tasks)
    && Array.isArray(value.workstreams)
    && value.tasks.every((task: any) => task?.materialization?.state === "blueprint_only");
}

async function computeExecutionBlueprint(
  trackId: number,
  force: boolean,
  retryAfterConcurrentDevelopment = true,
) {
  const developmentResult = await ensureDevelopmentPlan(trackId, false);
  if (!developmentResult) return null;
  if (!("developmentPlanModel" in developmentResult)) return developmentResult;

  const developmentPlan = developmentResult.developmentPlanModel;
  const developmentPlanFingerprint = executionBlueprintSourceFingerprint(developmentPlan);
  const intelligence = parseJsonObject(developmentResult.track.trackIntelligence);
  const stored = intelligence.executionBlueprintModel;

  if (!force && validExecutionBlueprint(stored, developmentPlanFingerprint)) {
    return {
      track: developmentResult.track,
      requirementModel: developmentResult.requirementModel,
      coverageModel: developmentResult.coverageModel,
      developmentPlanModel: developmentPlan,
      executionBlueprintModel: stored as ExecutionBlueprintModel,
      refreshed: false,
    } as const;
  }

  const draft = buildExecutionBlueprintDraft(developmentPlan);
  const executionBlueprintModel = await enhanceExecutionBlueprintWithLlm(developmentPlan, draft);
  executionBlueprintModel.developmentPlanFingerprint = developmentPlanFingerprint;
  executionBlueprintModel.sourceFingerprint = developmentPlanFingerprint;
  executionBlueprintModel.materializationStatus = "blueprint_only";

  // Persist against the latest intelligence and retry once if the development
  // plan changed while the slower refinement call was running.
  const latestTrack = await storage.getCareerTrack(trackId) || developmentResult.track;
  const latestIntelligence = parseJsonObject(latestTrack.trackIntelligence);
  const latestDevelopmentPlan = latestIntelligence.developmentPlanModel as DevelopmentPlanModel | undefined;
  if (
    retryAfterConcurrentDevelopment
    && latestDevelopmentPlan?.mode === "development_plan_model"
    && executionBlueprintSourceFingerprint(latestDevelopmentPlan) !== developmentPlanFingerprint
  ) {
    return computeExecutionBlueprint(trackId, true, false);
  }

  const nextIntelligence = {
    ...latestIntelligence,
    executionBlueprintModel,
    executionBlueprintGeneratedAt: executionBlueprintModel.generatedAt,
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(
    trackId,
    { trackIntelligence: JSON.stringify(nextIntelligence) } as any,
  );

  return {
    track: updatedTrack || latestTrack,
    requirementModel: developmentResult.requirementModel,
    coverageModel: developmentResult.coverageModel,
    developmentPlanModel: developmentPlan,
    executionBlueprintModel,
    refreshed: true,
  } as const;
}

type ExecutionBlueprintResult = Awaited<ReturnType<typeof computeExecutionBlueprint>>;
const executionBlueprintInFlight = new Map<number, Promise<ExecutionBlueprintResult>>();

export async function ensureExecutionBlueprint(
  trackId: number,
  force = false,
): Promise<ExecutionBlueprintResult> {
  if (!force) {
    const active = executionBlueprintInFlight.get(trackId);
    if (active) return active;
  }

  const promise = computeExecutionBlueprint(trackId, force);
  executionBlueprintInFlight.set(trackId, promise);
  try {
    return await promise;
  } finally {
    if (executionBlueprintInFlight.get(trackId) === promise) {
      executionBlueprintInFlight.delete(trackId);
    }
  }
}

function resultError(result: Exclude<ExecutionBlueprintResult, null>): string {
  return "error" in result
    ? String(result.error || "The execution blueprint is not available yet")
    : "The execution blueprint is not available yet";
}

export function registerTrackResearchExecutionRoutes(app: Express) {
  app.get("/api/career-tracks/:id/execution-blueprint", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionBlueprint(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionBlueprintModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/execution-blueprint/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionBlueprint(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionBlueprintModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.json({ ...result, refreshed: true });
  });

  app.post("/api/career-tracks/:id/execution-blueprint/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionBlueprint(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionBlueprintModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.status(409).json({
      error: "The complete work hierarchy now exists, but Anchor has not prioritized or selected the active execution slice. No live tasks were created.",
      nextStage: "execution_prioritization",
      executionBlueprintModel: result.executionBlueprintModel,
    });
  });
}
