import { storage } from "./storage";
import { ensureExecutionBlueprint } from "./trackResearchExecutionService";
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
import { hardenExecutionPriorityModel } from "./trackResearchExecutionPriorityPolicy";
import { enhanceExecutionPriorityExplanations } from "./trackResearchExecutionPrioritySynthesis";
import {
  materializeExecutionPrioritySlice,
  type ExecutionMaterializationResult,
} from "./trackResearchExecutionMaterialization";

export type ExecutionMaterializationOptions = {
  expectedSourceFingerprint?: string;
  maxNewTasks?: number;
};

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function scopedPriorityContext(
  trackId: number,
  context: ExecutionPriorityContext,
): ExecutionPriorityContext {
  // Global load remains part of activeLoad and the fingerprint, but blueprint
  // task identities may repeat across tracks. Live state and materialization
  // mappings must therefore be scoped to the current track.
  return {
    ...context,
    liveTasks: context.liveTasks.filter((task) => task.relatedTrackId === trackId),
  };
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
  const collectedContext = await collectExecutionPriorityContext(trackId, blueprint);
  if (!collectedContext) return null;
  const context = scopedPriorityContext(trackId, collectedContext);
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
  const explained = await enhanceExecutionPriorityExplanations(blueprint, context, draft);
  const executionPriorityModel = hardenExecutionPriorityModel(explained, blueprint, context);

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

export type ExecutionPriorityResult = Awaited<ReturnType<typeof computeExecutionPriority>>;
const priorityInFlight = new Map<number, Promise<ExecutionPriorityResult>>();

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

async function materializeTrackSlice(
  trackId: number,
  options: ExecutionMaterializationOptions = {},
) {
  const priorityResult = await ensureExecutionPriority(trackId, false);
  if (!priorityResult) return null;
  if (!("executionPriorityModel" in priorityResult)) return priorityResult;
  if (
    options.expectedSourceFingerprint
    && options.expectedSourceFingerprint !== priorityResult.executionPriorityModel.sourceFingerprint
  ) {
    return {
      error: "The displayed active slice is stale. Refresh the recommendation before activating work.",
      currentSourceFingerprint: priorityResult.executionPriorityModel.sourceFingerprint,
    } as const;
  }
  if (priorityResult.executionBlueprintModel.quality.status === "provisional") {
    return { error: "The execution blueprint must be repaired before live tasks can be created." } as const;
  }
  if (priorityResult.executionPriorityModel.quality.status === "provisional") {
    return { error: "The active slice is not safe to activate yet." } as const;
  }
  if (priorityResult.priorityContext.trackStatus !== "active") {
    return { error: "This career track is not active, so Anchor will not create new execution tasks." } as const;
  }

  const requestedLimit = Number.isFinite(Number(options.maxNewTasks))
    ? Math.max(0, Math.floor(Number(options.maxNewTasks)))
    : priorityResult.priorityContext.capacity.maxNewTasks;
  const boundedContext: ExecutionPriorityContext = {
    ...priorityResult.priorityContext,
    capacity: {
      ...priorityResult.priorityContext.capacity,
      maxNewTasks: Math.min(priorityResult.priorityContext.capacity.maxNewTasks, requestedLimit),
    },
  };
  const materialization = await materializeExecutionPrioritySlice({
    trackId,
    blueprint: priorityResult.executionBlueprintModel,
    priorityModel: priorityResult.executionPriorityModel,
    context: boundedContext,
  });
  await persistMaterializationRun(trackId, materialization);
  const refreshed = await ensureExecutionPriority(trackId, true);
  return {
    priorityResult: refreshed && "executionPriorityModel" in refreshed ? refreshed : priorityResult,
    materialization,
  } as const;
}

export type ExecutionMaterializationRouteResult = Awaited<ReturnType<typeof materializeTrackSlice>>;
const materializationInFlight = new Map<string, Promise<ExecutionMaterializationRouteResult>>();

export async function materializePrioritizedExecutionSlice(
  trackId: number,
  options: ExecutionMaterializationOptions = {},
): Promise<ExecutionMaterializationRouteResult> {
  const key = `${trackId}:${options.expectedSourceFingerprint || "current"}:${Number.isFinite(Number(options.maxNewTasks)) ? Number(options.maxNewTasks) : "default"}`;
  const active = materializationInFlight.get(key);
  if (active) return active;
  const promise = materializeTrackSlice(trackId, options);
  materializationInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (materializationInFlight.get(key) === promise) materializationInFlight.delete(key);
  }
}

export function executionPriorityResultError(
  result: Exclude<ExecutionPriorityResult, null>,
): string {
  return "error" in result
    ? String(result.error || "Execution prioritization is not available yet")
    : "Execution prioritization is not available yet";
}

export const executionPriorityServiceInternals = {
  scopedPriorityContext,
};
