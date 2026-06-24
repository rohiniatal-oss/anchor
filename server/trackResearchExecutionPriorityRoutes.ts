import type { Express } from "express";
import { storage } from "./storage";
import { ensureExecutionBlueprint } from "./trackResearchExecutionRoutes";
import {
  buildExecutionPriorityModel,
  executionPriorityContextFingerprint,
  EXECUTION_ACTIVATION_STATE_VERSION,
  EXECUTION_PRIORITY_MODEL_VERSION,
  type ExecutionActivationState,
  type ExecutionPriorityContext,
  type ExecutionPriorityModel,
} from "./trackResearchExecutionPriority";
import { activateExecutionSlice, type ExecutionActivationResult } from "./trackResearchExecutionMaterialization";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function activationStateFromIntelligence(
  intelligence: Record<string, any>,
  blueprintFingerprint: string,
): ExecutionActivationState | null {
  const value = intelligence.executionActivationState;
  if (value?.mode !== "execution_activation_state"
    || value?.version !== EXECUTION_ACTIVATION_STATE_VERSION
    || value?.blueprintFingerprint !== blueprintFingerprint
    || !Array.isArray(value.records)) return null;
  return value as ExecutionActivationState;
}

async function priorityContext(
  trackId: number,
  intelligence: Record<string, any>,
  blueprintFingerprint: string,
): Promise<ExecutionPriorityContext> {
  const [tasks, jobs, learn, contacts, dayPlan] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getContacts(),
    storage.getPlanByDate(todayKey()),
  ]);
  return {
    trackId,
    tasks,
    jobs,
    learn,
    contacts,
    dayPlan: dayPlan || null,
    activationState: activationStateFromIntelligence(intelligence, blueprintFingerprint),
  };
}

function validPriorityModel(
  value: any,
  blueprintFingerprint: string,
  contextFingerprint: string,
): value is ExecutionPriorityModel {
  return value?.mode === "execution_priority_model"
    && value?.version === EXECUTION_PRIORITY_MODEL_VERSION
    && value?.executionBlueprintFingerprint === blueprintFingerprint
    && value?.contextFingerprint === contextFingerprint
    && Array.isArray(value.activeSlice)
    && Array.isArray(value.scorecards);
}

async function persistPriorityState(
  trackId: number,
  priorityModel: ExecutionPriorityModel,
  activationState?: ExecutionActivationState | null,
) {
  const latestTrack = await storage.getCareerTrack(trackId);
  if (!latestTrack) return null;
  const intelligence = parseJsonObject(latestTrack.trackIntelligence);
  const nextIntelligence = {
    ...intelligence,
    executionPriorityModel: priorityModel,
    ...(activationState ? { executionActivationState: activationState } : {}),
    executionPriorityUpdatedAt: priorityModel.generatedAt,
    lastUpdated: Date.now(),
  };
  return storage.updateCareerTrack(
    trackId,
    { trackIntelligence: JSON.stringify(nextIntelligence) } as any,
  );
}

async function computeExecutionPriority(trackId: number, force: boolean) {
  const blueprintResult = await ensureExecutionBlueprint(trackId, false);
  if (!blueprintResult) return null;
  if (!("executionBlueprintModel" in blueprintResult)) return blueprintResult;

  const latestTrack = await storage.getCareerTrack(trackId) || blueprintResult.track;
  const intelligence = parseJsonObject(latestTrack.trackIntelligence);
  const blueprint = blueprintResult.executionBlueprintModel;
  const context = await priorityContext(trackId, intelligence, blueprint.sourceFingerprint);
  const contextFingerprint = executionPriorityContextFingerprint(blueprint, context);
  const stored = intelligence.executionPriorityModel;
  if (!force && validPriorityModel(stored, blueprint.sourceFingerprint, contextFingerprint)) {
    return {
      track: latestTrack,
      requirementModel: blueprintResult.requirementModel,
      coverageModel: blueprintResult.coverageModel,
      developmentPlanModel: blueprintResult.developmentPlanModel,
      executionBlueprintModel: blueprint,
      executionPriorityModel: stored as ExecutionPriorityModel,
      executionActivationState: context.activationState,
      refreshed: false,
    } as const;
  }

  const executionPriorityModel = buildExecutionPriorityModel(
    blueprint,
    blueprintResult.requirementModel,
    blueprintResult.coverageModel,
    blueprintResult.developmentPlanModel,
    context,
  );
  const updatedTrack = await persistPriorityState(trackId, executionPriorityModel, context.activationState);
  return {
    track: updatedTrack || latestTrack,
    requirementModel: blueprintResult.requirementModel,
    coverageModel: blueprintResult.coverageModel,
    developmentPlanModel: blueprintResult.developmentPlanModel,
    executionBlueprintModel: blueprint,
    executionPriorityModel,
    executionActivationState: context.activationState,
    refreshed: true,
  } as const;
}

type ExecutionPriorityResult = Awaited<ReturnType<typeof computeExecutionPriority>>;
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

function resultError(result: Exclude<ExecutionPriorityResult, null>): string {
  return "error" in result
    ? String(result.error || "Execution prioritization is not available yet")
    : "Execution prioritization is not available yet";
}

async function persistActivationState(
  trackId: number,
  state: ExecutionActivationState,
) {
  const latestTrack = await storage.getCareerTrack(trackId);
  if (!latestTrack) return null;
  const intelligence = parseJsonObject(latestTrack.trackIntelligence);
  const nextIntelligence = {
    ...intelligence,
    executionActivationState: state,
    executionActivatedAt: Date.now(),
    lastUpdated: Date.now(),
  };
  return storage.updateCareerTrack(trackId, { trackIntelligence: JSON.stringify(nextIntelligence) } as any);
}

async function runActivation(trackId: number) {
  let priorityResult = await ensureExecutionPriority(trackId, false);
  if (!priorityResult || !("executionPriorityModel" in priorityResult)) return priorityResult;

  const aggregate: ExecutionActivationResult = {
    state: priorityResult.executionActivationState || {
      mode: "execution_activation_state",
      version: EXECUTION_ACTIVATION_STATE_VERSION,
      blueprintFingerprint: priorityResult.executionBlueprintModel.sourceFingerprint,
      records: [],
      generatedAt: Date.now(),
    },
    records: [],
    createdTaskIds: [],
    reusedTaskIds: [],
    completedByAnchorTaskIds: [],
    failedBlueprintTaskIds: [],
  };

  // First pass lets Anchor complete up to two preparatory tasks. A second pass
  // is allowed only when that completion unlocked a new user-facing task.
  for (let round = 0; round < 2; round += 1) {
    const activation = await activateExecutionSlice(
      trackId,
      priorityResult.executionBlueprintModel,
      priorityResult.executionPriorityModel,
      priorityResult.requirementModel,
      priorityResult.coverageModel,
      priorityResult.developmentPlanModel,
      aggregate.state,
    );
    aggregate.state = activation.state;
    aggregate.records.push(...activation.records);
    aggregate.createdTaskIds.push(...activation.createdTaskIds);
    aggregate.reusedTaskIds.push(...activation.reusedTaskIds);
    aggregate.completedByAnchorTaskIds.push(...activation.completedByAnchorTaskIds);
    aggregate.failedBlueprintTaskIds.push(...activation.failedBlueprintTaskIds);
    await persistActivationState(trackId, aggregate.state);

    if (!activation.completedByAnchorTaskIds.length || round === 1) break;
    const refreshed = await ensureExecutionPriority(trackId, true);
    if (!refreshed || !("executionPriorityModel" in refreshed)) break;
    priorityResult = refreshed;
  }

  const finalPriority = await ensureExecutionPriority(trackId, true);
  if (!finalPriority || !("executionPriorityModel" in finalPriority)) return finalPriority;
  await persistPriorityState(trackId, finalPriority.executionPriorityModel, aggregate.state);
  const liveTasks = (await storage.getTasks()).filter((task) => aggregate.createdTaskIds.includes(task.id) || aggregate.reusedTaskIds.includes(task.id));

  return {
    ...finalPriority,
    executionActivationState: aggregate.state,
    activation: {
      ...aggregate,
      createdTaskIds: [...new Set(aggregate.createdTaskIds)],
      reusedTaskIds: [...new Set(aggregate.reusedTaskIds)],
      completedByAnchorTaskIds: [...new Set(aggregate.completedByAnchorTaskIds)],
      failedBlueprintTaskIds: [...new Set(aggregate.failedBlueprintTaskIds)],
      liveTasks,
    },
  } as const;
}

type ActivationResult = Awaited<ReturnType<typeof runActivation>>;
const activationInFlight = new Map<number, Promise<ActivationResult>>();

export async function activatePrioritizedExecution(trackId: number): Promise<ActivationResult> {
  const active = activationInFlight.get(trackId);
  if (active) return active;
  const promise = runActivation(trackId);
  activationInFlight.set(trackId, promise);
  try {
    return await promise;
  } finally {
    if (activationInFlight.get(trackId) === promise) activationInFlight.delete(trackId);
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
    return res.json({ ...result, refreshed: true });
  });

  app.post("/api/career-tracks/:id/execution-priority/activate", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await activatePrioritizedExecution(id);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionPriorityModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.json(result);
  });
}
