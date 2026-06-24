import type { Express } from "express";
import { storage } from "./storage";
import { ensureExecutionBlueprint } from "./trackResearchExecutionRoutes";
import type { ExecutionBlueprintModel } from "./trackResearchExecutionBlueprint";
import {
  buildExecutionPriorityModel,
  EXECUTION_PRIORITY_POLICY_VERSION,
  EXECUTION_PRIORITY_VERSION,
  executionPrioritySourceFingerprint,
  type ExecutionPriorityContext,
  type ExecutionPriorityModel,
} from "./trackResearchExecutionPriority";
import { collectExecutionPriorityContext } from "./trackResearchExecutionPriorityContext";
import { enhanceExecutionPriorityExplanations } from "./trackResearchExecutionPrioritySynthesis";
import {
  materializeExecutionPrioritySlice,
  type ExecutionMaterializationResult,
} from "./trackResearchExecutionMaterialization";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validExecutionPriorityModel(
  value: any,
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
): value is ExecutionPriorityModel {
  const taskIds = new Set(blueprint.tasks.map((task) => task.id));
  const candidates = Array.isArray(value?.candidates) ? value.candidates : [];
  const selectedTaskIds = Array.isArray(value?.activeSlice?.selectedTaskIds)
    ? value.activeSlice.selectedTaskIds
    : [];
  return value?.mode === "execution_priority_model"
    && value?.version === EXECUTION_PRIORITY_VERSION
    && value?.policyVersion === EXECUTION_PRIORITY_POLICY_VERSION
    && value?.executionBlueprintVersion === blueprint.version
    && value?.executionBlueprintFingerprint === blueprint.sourceFingerprint
    && value?.contextFingerprint === context.fingerprint
    && value?.sourceFingerprint === executionPrioritySourceFingerprint(blueprint, context)
    && candidates.length === taskIds.size
    && candidates.every((candidate: any) => taskIds.has(candidate.taskId))
    && selectedTaskIds.every((id: string) => taskIds.has(id));
}

async function computeExecutionPriority(
  trackId: number,
  force: boolean,
  retryAfterConcurrentBlueprint = true,
) {
  const executionResult = await ensureExecutionBlueprint(trackId, false);
  if (!executionResult) return null;
  if (!("executionBlueprintModel" in executionResult)) return executionResult;

  const blueprint = executionResult.executionBlueprintModel;
  const context = await collectExecutionPriorityContext(trackId, blueprint);
  if (!context) return null;
  const intelligence = parseJsonObject(executionResult.track.trackIntelligence);
  const stored = intelligence.executionPriorityModel;
  if (!force && validExecutionPriorityModel(stored, blueprint, context)) {
    return {
      ...executionResult,
      executionPriorityModel: stored as ExecutionPriorityModel,
      priorityContext: context,
      refreshedPriority: false,
    } as const;
  }

  const draft = buildExecutionPriorityModel({
    requirementModel: executionResult.requirementModel,
    coverageModel: executionResult.coverageModel,
    developmentPlanModel: executionResult.developmentPlanModel,
    executionBlueprintModel: blueprint,
    context,
  });
  const executionPriorityModel = await enhanceExecutionPriorityExplanations(blueprint, context, draft);

  const latestTrack = await storage.getCareerTrack(trackId) || executionResult.track;
  const latestIntelligence = parseJsonObject(latestTrack.trackIntelligence);
  const latestBlueprint = latestIntelligence.executionBlueprintModel as ExecutionBlueprintModel | undefined;
  if (
    retryAfterConcurrentBlueprint
    && latestBlueprint?.mode === "execution_blueprint_model"
    && latestBlueprint.sourceFingerprint !== blueprint.sourceFingerprint
  ) {
    return computeExecutionPriority(trackId, true, false);
  }

  const nextIntelligence = {
    ...latestIntelligence,
    executionPriorityModel,
    executionPriorityGeneratedAt: executionPriorityModel.generatedAt,
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(
    trackId,
    { trackIntelligence: JSON.stringify(nextIntelligence) } as any,
  );
  return {
    ...executionResult,
    track: updatedTrack || latestTrack,
    executionPriorityModel,
    priorityContext: context,
    refreshedPriority: true,
  } as const;
}

type ExecutionPriorityResult = Awaited<ReturnType<typeof computeExecutionPriority>>;
type MaterializationRouteResult = Awaited<ReturnType<typeof materializeTrackSlice>>;
const priorityInFlight = new Map<number, Promise<ExecutionPriorityResult>>();
const materializationInFlight = new Map<number, Promise<MaterializationRouteResult>>();

export async function ensureExecutionPriority(
  trackId: number,
  force = false,
): Promise<ExecutionPriorityResult> {
  if (!force) {
    const active = priorityInFlight.get(trackId);
    if (active) return active;
  }
  const promise = computeExecutionPriority(trackId, force);
  priorityInFlight.set(trackId, promise);
  try {
    return await promise;
  } finally {
    if (priorityInFlight.get(trackId) === promise) priorityInFlight.delete(trackId);
  }
}

function resultError(result: Exclude<ExecutionPriorityResult, null>): string {
  return "error" in result
    ? String(result.error || "Execution prioritization is not available yet")
    : "Execution prioritization is not available yet";
}

async function persistMaterializationRun(
  trackId: number,
  result: ExecutionMaterializationResult,
): Promise<void> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const previous = Array.isArray(intelligence.executionMaterializationHistory)
    ? intelligence.executionMaterializationHistory
    : [];
  await storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      executionMaterializationHistory: [...previous, result].slice(-12),
      lastExecutionMaterialization: result,
      lastUpdated: Date.now(),
    }),
  } as any);
}

async function materializeTrackSlice(trackId: number) {
  const priorityResult = await ensureExecutionPriority(trackId, false);
  if (!priorityResult) return null;
  if (!("executionPriorityModel" in priorityResult)) return priorityResult;
  const materialization = await materializeExecutionPrioritySlice({
    trackId,
    blueprint: priorityResult.executionBlueprintModel,
    priorityModel: priorityResult.executionPriorityModel,
    context: priorityResult.priorityContext,
  });
  await persistMaterializationRun(trackId, materialization);
  const refreshed = await ensureExecutionPriority(trackId, true);
  return {
    priorityResult: refreshed && "executionPriorityModel" in refreshed ? refreshed : priorityResult,
    materialization,
  } as const;
}

async function ensureMaterializedTrackSlice(trackId: number): Promise<MaterializationRouteResult> {
  const active = materializationInFlight.get(trackId);
  if (active) return active;
  const promise = materializeTrackSlice(trackId);
  materializationInFlight.set(trackId, promise);
  try {
    return await promise;
  } finally {
    if (materializationInFlight.get(trackId) === promise) materializationInFlight.delete(trackId);
  }
}

export function registerTrackResearchExecutionPriorityRoutes(app: Express) {
  app.get("/api/career-tracks/:id/execution-priority", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionPriority(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionPriorityModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/execution-priority/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionPriority(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionPriorityModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.json({ ...result, refreshedPriority: true });
  });

  app.post("/api/career-tracks/:id/execution-priority/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureMaterializedTrackSlice(id);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("materialization" in result)) {
      return res.status(409).json({
        error: "error" in result
          ? String(result.error || "Execution prioritization is not available yet")
          : "Execution prioritization is not available yet",
      });
    }
    return res.json({
      ...result.priorityResult,
      materializationResult: result.materialization,
    });
  });
}
