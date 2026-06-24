import type { Express } from "express";
import type { InsertTask, Task } from "@shared/schema";
import { storage } from "./storage";
import { ensureExecutionBlueprint } from "./trackResearchExecutionRoutes";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import {
  ACTIVE_EXECUTION_SLICE_VERSION,
  activeExecutionSliceSourceFingerprint,
  buildActiveExecutionSlice,
  selectedActiveTasks,
  type ActiveExecutionSliceModel,
} from "./trackResearchExecutionPrioritization";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validActiveExecutionSlice(
  value: any,
  executionBlueprintFingerprint: string,
): value is ActiveExecutionSliceModel {
  return value?.mode === "active_execution_slice_model"
    && value?.version === ACTIVE_EXECUTION_SLICE_VERSION
    && value?.executionBlueprintFingerprint === executionBlueprintFingerprint
    && value?.sourceFingerprint === executionBlueprintFingerprint
    && Array.isArray(value.tasks)
    && Array.isArray(value.activeTaskIds)
    && (value.materializationStatus === "slice_only" || value.materializationStatus === "materialized");
}

async function computeActiveExecutionSlice(
  trackId: number,
  force: boolean,
  retryAfterConcurrentBlueprint = true,
) {
  const blueprintResult = await ensureExecutionBlueprint(trackId, false);
  if (!blueprintResult) return null;
  if (!("executionBlueprintModel" in blueprintResult)) return blueprintResult;

  const blueprint = blueprintResult.executionBlueprintModel;
  const sourceFingerprint = activeExecutionSliceSourceFingerprint(blueprint);
  const intelligence = parseJsonObject(blueprintResult.track.trackIntelligence);
  const stored = intelligence.activeExecutionSliceModel;

  if (!force && validActiveExecutionSlice(stored, sourceFingerprint)) {
    return {
      ...blueprintResult,
      activeExecutionSliceModel: stored as ActiveExecutionSliceModel,
      refreshed: false,
    } as const;
  }

  const activeExecutionSliceModel = buildActiveExecutionSlice(blueprint);

  const latestTrack = await storage.getCareerTrack(trackId) || blueprintResult.track;
  const latestIntelligence = parseJsonObject(latestTrack.trackIntelligence);
  const latestBlueprint = latestIntelligence.executionBlueprintModel as ExecutionBlueprintModel | undefined;
  if (
    retryAfterConcurrentBlueprint
    && latestBlueprint?.mode === "execution_blueprint_model"
    && activeExecutionSliceSourceFingerprint(latestBlueprint) !== sourceFingerprint
  ) {
    return computeActiveExecutionSlice(trackId, true, false);
  }

  const nextIntelligence = {
    ...latestIntelligence,
    activeExecutionSliceModel,
    activeExecutionSliceGeneratedAt: activeExecutionSliceModel.generatedAt,
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(
    trackId,
    { trackIntelligence: JSON.stringify(nextIntelligence) } as any,
  );

  return {
    ...blueprintResult,
    track: updatedTrack || latestTrack,
    activeExecutionSliceModel,
    refreshed: true,
  } as const;
}

type ActiveExecutionSliceResult = Awaited<ReturnType<typeof computeActiveExecutionSlice>>;
const activeSliceInFlight = new Map<number, Promise<ActiveExecutionSliceResult>>();

export async function ensureActiveExecutionSlice(
  trackId: number,
  force = false,
): Promise<ActiveExecutionSliceResult> {
  if (!force) {
    const active = activeSliceInFlight.get(trackId);
    if (active) return active;
  }

  const promise = computeActiveExecutionSlice(trackId, force);
  activeSliceInFlight.set(trackId, promise);
  try {
    return await promise;
  } finally {
    if (activeSliceInFlight.get(trackId) === promise) activeSliceInFlight.delete(trackId);
  }
}

function resultError(result: Exclude<ActiveExecutionSliceResult, null>): string {
  return "error" in result
    ? String(result.error || "The active execution slice is not available yet")
    : "The active execution slice is not available yet";
}

function estimatedMinutes(task: TaskBlueprint) {
  if (task.effort === "quick") return 15;
  if (task.effort === "medium") return 45;
  if (task.effort === "deep") return 90;
  return 120;
}

function taskSteps(task: TaskBlueprint) {
  return JSON.stringify(task.subtasks.map((subtask) => ({
    text: subtask.title,
    done: false,
    outputSpec: subtask.outputSpec,
    doneWhen: subtask.doneWhen,
    executor: subtask.executor,
    condition: subtask.condition,
  })));
}

function sourceNote(task: TaskBlueprint, reason: string) {
  return JSON.stringify({
    taskBlueprintId: task.id,
    workstreamId: task.workstreamId,
    moduleId: task.moduleId,
    reason,
    expectedEvidence: task.expectedEvidence,
  });
}

function existingMaterializedTask(tasks: Task[], trackId: number, taskBlueprintId: string) {
  return tasks.find((task) => {
    if (task.done || task.status === "done") return false;
    if (task.relatedTrackId !== trackId) return false;
    if (task.sourceType !== "career_track" || task.sourceStepType !== "execution_blueprint_task") return false;
    return String(task.sourceNote || "").includes(taskBlueprintId);
  });
}

function materializedTaskValues(
  trackId: number,
  task: TaskBlueprint,
  reason: string,
): InsertTask {
  return {
    title: task.title,
    list: "inbox",
    block: null,
    done: false,
    pinned: false,
    steps: taskSteps(task),
    sort: 0,
    category: task.materialization.taskDraft.category,
    deadline: "",
    size: task.materialization.taskDraft.size,
    status: "not_started",
    skipped: 0,
    doneWhen: task.doneWhen,
    source: "anchor",
    sourceType: "career_track",
    sourceId: trackId,
    sourceStepType: "execution_blueprint_task",
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: sourceNote(task, reason),
    sourceStatus: "active_execution_slice",
    planItemId: null,
    relatedTrackId: trackId,
    relatedOpportunityId: null,
    parentTaskId: null,
    dependsOn: "[]",
    blocks: "[]",
    blockedBy: "",
    blockerReason: "",
    readiness: "ready",
    minimumOutcome: task.minimumOutcome,
    stretchOutcome: task.expectedEvidence,
    estimateMinutes: estimatedMinutes(task),
    estimateConfidence: "med",
    estimateReason: "Derived from the execution blueprint effort band.",
    actualMinutes: null,
  };
}

async function materializeActiveSlice(
  trackId: number,
  model: ActiveExecutionSliceModel,
  blueprint: ExecutionBlueprintModel,
) {
  if (model.quality.status === "blocked") {
    return { model, tasks: [], reused: [], created: [], blocked: true };
  }

  const selected = selectedActiveTasks(model);
  const blueprintById = new Map(blueprint.tasks.map((task) => [task.id, task]));
  const existingTasks = await storage.getTasks();
  const created: Task[] = [];
  const reused: Task[] = [];

  for (const sliceTask of selected) {
    const blueprintTask = blueprintById.get(sliceTask.taskId);
    if (!blueprintTask) continue;
    const existing = existingMaterializedTask(existingTasks, trackId, blueprintTask.id);
    if (existing) {
      reused.push(existing);
      continue;
    }
    const task = await storage.createTask(materializedTaskValues(trackId, blueprintTask, sliceTask.reason) as any);
    created.push(task);
    existingTasks.push(task);
  }

  const materializedTaskIds = [...reused, ...created].map((task) => task.id);
  const nextModel: ActiveExecutionSliceModel = {
    ...model,
    materializationStatus: "materialized",
    materializedTaskIds,
  };
  const track = await storage.getCareerTrack(trackId);
  if (track) {
    const intelligence = parseJsonObject(track.trackIntelligence);
    await storage.updateCareerTrack(trackId, {
      trackIntelligence: JSON.stringify({
        ...intelligence,
        activeExecutionSliceModel: nextModel,
        activeExecutionSliceMaterializedAt: Date.now(),
        lastUpdated: Date.now(),
      }),
    } as any);
  }
  await storage.logActivity({
    eventType: "execution_slice_materialized",
    sourceType: "career_track",
    sourceId: trackId,
    metadata: JSON.stringify({
      activeTaskIds: model.activeTaskIds,
      createdTaskIds: created.map((task) => task.id),
      reusedTaskIds: reused.map((task) => task.id),
    }),
  } as any);

  return { model: nextModel, tasks: [...reused, ...created], reused, created, blocked: false };
}

export function registerTrackResearchExecutionPriorityRoutes(app: Express) {
  app.get("/api/career-tracks/:id/active-execution-slice", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureActiveExecutionSlice(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("activeExecutionSliceModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/active-execution-slice/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureActiveExecutionSlice(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("activeExecutionSliceModel" in result)) return res.status(409).json({ error: resultError(result) });
    return res.json({ ...result, refreshed: true });
  });

  app.post("/api/career-tracks/:id/active-execution-slice/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureActiveExecutionSlice(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("activeExecutionSliceModel" in result)) return res.status(409).json({ error: resultError(result) });
    const materialized = await materializeActiveSlice(
      id,
      result.activeExecutionSliceModel,
      result.executionBlueprintModel,
    );
    if (materialized.blocked) {
      return res.status(409).json({
        error: "No active slice is safe to materialize yet. Anchor needs a ready, unblocked task before creating live work.",
        activeExecutionSliceModel: materialized.model,
      });
    }
    return res.json({
      ...result,
      activeExecutionSliceModel: materialized.model,
      materializedTasks: materialized.tasks,
      createdTaskIds: materialized.created.map((task) => task.id),
      reusedTaskIds: materialized.reused.map((task) => task.id),
    });
  });
}
