import type { CareerTrack, Task } from "@shared/schema";
import { storage } from "./storage";
import { registerTaskLifecycleListener, type TaskLifecycleEvent } from "./taskLifecycle";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import type { CoverageModel } from "./trackResearchCoverageModel";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import { ensureExecutionBlueprint } from "./trackResearchExecutionService";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import {
  ensureExecutionPriority,
  materializePrioritizedExecutionSlice,
} from "./trackResearchExecutionPriorityService";
import { blueprintTaskIdFromSourceStepType } from "./trackResearchExecutionPriority";
import {
  buildExecutionOutcome,
  confirmExecutionOutcome,
  emptyExecutionOutcomeModel,
  normalizeExecutionOutcomeModel,
  type ConfirmExecutionOutcomeInput,
  type ExecutionOutcome,
  type ExecutionOutcomeCoverageImpact,
  type ExecutionOutcomeModel,
} from "./trackResearchExecutionOutcome";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function currentBlueprint(intelligence: Record<string, any>): ExecutionBlueprintModel | null {
  const value = intelligence.executionBlueprintModel;
  return value?.mode === "execution_blueprint_model" && Array.isArray(value.tasks)
    ? value as ExecutionBlueprintModel
    : null;
}

function executionTaskTrackId(task: Task): number | null {
  const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
  if (!blueprintTaskId) return null;
  const trackId = Number(task.relatedTrackId || (task.sourceType === "career_track" ? task.sourceId : 0));
  return Number.isFinite(trackId) && trackId > 0 ? trackId : null;
}

function isCompleted(task: Task): boolean {
  return Boolean(task.done) || task.status === "done";
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))];
}

function statusRank(value: unknown): number {
  const status = String(value || "");
  if (status === "proven") return 4;
  if (status === "partially_proven") return 3;
  if (status === "below_bar") return 2;
  if (status === "unproven") return 1;
  return 0;
}

function coverageChanges(
  requirementIds: string[],
  before: CoverageModel | null,
  after: CoverageModel | null,
) {
  const beforeById = new Map((before?.coverage || []).map((item) => [item.requirementId, item.status]));
  const afterById = new Map((after?.coverage || []).map((item) => [item.requirementId, item.status]));
  return requirementIds.map((requirementId) => {
    const beforeStatus = beforeById.get(requirementId) || "unknown";
    const afterStatus = afterById.get(requirementId) || beforeStatus;
    return {
      requirementId,
      beforeStatus,
      afterStatus,
      improved: statusRank(afterStatus) > statusRank(beforeStatus),
    };
  });
}

const mutationChains = new Map<number, Promise<unknown>>();

async function withTrackMutation<T>(trackId: number, operation: () => Promise<T>): Promise<T> {
  const previous = mutationChains.get(trackId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  mutationChains.set(trackId, current);
  try {
    return await current;
  } finally {
    if (mutationChains.get(trackId) === current) mutationChains.delete(trackId);
  }
}

async function persistOutcomeModel(
  trackId: number,
  model: ExecutionOutcomeModel,
  extra: Record<string, any> = {},
): Promise<CareerTrack | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const nextModel = normalizeExecutionOutcomeModel(
    model,
    trackId,
    currentBlueprint(intelligence)?.sourceFingerprint || model.currentBlueprintFingerprint,
  );
  const updated = await storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      executionOutcomeModel: nextModel,
      executionOutcomeUpdatedAt: Date.now(),
      ...extra,
      lastUpdated: Date.now(),
    }),
  } as any);
  return updated || track;
}

function latestOutcomeForTask(model: ExecutionOutcomeModel, liveTaskId: number): ExecutionOutcome | null {
  return [...model.outcomes]
    .filter((outcome) => outcome.liveTaskId === liveTaskId)
    .sort((left, right) => right.completionSequence - left.completionSequence || right.updatedAt - left.updatedAt)[0] || null;
}

function replaceOutcome(model: ExecutionOutcomeModel, outcome: ExecutionOutcome): ExecutionOutcomeModel {
  const outcomes = model.outcomes.filter((candidate) => candidate.id !== outcome.id);
  outcomes.push(outcome);
  return normalizeExecutionOutcomeModel(
    { ...model, outcomes: outcomes.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 120) },
    model.trackId,
    model.currentBlueprintFingerprint,
  );
}

function blueprintTaskFor(
  blueprint: ExecutionBlueprintModel,
  blueprintTaskId: string,
): TaskBlueprint | null {
  return blueprint.tasks.find((task) => task.id === blueprintTaskId) || null;
}

async function captureCompletedTaskLocked(trackId: number, task: Task): Promise<ExecutionOutcome | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const blueprint = currentBlueprint(intelligence);
  if (!blueprint) return null;
  const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
  if (!blueprintTaskId) return null;
  const blueprintTask = blueprintTaskFor(blueprint, blueprintTaskId);
  if (!blueprintTask) return null;
  let model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint.sourceFingerprint);
  const previous = latestOutcomeForTask(model, task.id);
  if (previous && isCompleted(task) && previous.state !== "reopened") return previous;

  const outcome = buildExecutionOutcome(task, blueprintTask, blueprint, previous, Date.now());
  model = replaceOutcome(model, outcome);
  await persistOutcomeModel(trackId, model);
  await storage.logActivity({
    eventType: outcome.state === "pending_confirmation" ? "execution_outcome_pending" : "execution_outcome_captured",
    sourceType: "career_track",
    sourceId: trackId,
    taskId: task.id,
    metadata: JSON.stringify({
      outcomeId: outcome.id,
      blueprintTaskId: outcome.blueprintTaskId,
      requirementIds: outcome.requirementIds,
      state: outcome.state,
    }),
  } as any);
  if (outcome.processingState === "queued") queueExecutionOutcomeProcessing(trackId);
  return outcome;
}

async function markTaskReopenedLocked(trackId: number, task: Task): Promise<void> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const blueprint = currentBlueprint(intelligence);
  const model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
  const previous = latestOutcomeForTask(model, task.id);
  if (!previous || previous.state === "reopened") return;
  const reopened: ExecutionOutcome = {
    ...previous,
    state: "reopened",
    strength: "none",
    usableForCoverage: false,
    reopenedAt: Date.now(),
    processingState: "complete",
    processingError: "",
    coverageImpact: null,
    updatedAt: Date.now(),
  };
  await persistOutcomeModel(trackId, replaceOutcome(model, reopened));
}

export async function reconcileExecutionOutcomesForTrack(trackId: number): Promise<ExecutionOutcomeModel | null> {
  return withTrackMutation(trackId, async () => {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    if (!blueprint) return normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, "");
    const taskIds = new Set(blueprint.tasks.map((task) => task.id));
    const tasks = (await storage.getTasks()).filter((task) => {
      const taskTrackId = executionTaskTrackId(task);
      const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
      return taskTrackId === trackId && blueprintTaskId && taskIds.has(blueprintTaskId);
    });
    let model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint.sourceFingerprint);
    let changed = false;

    for (const task of tasks) {
      const previous = latestOutcomeForTask(model, task.id);
      if (isCompleted(task)) {
        if (previous && previous.state !== "reopened") continue;
        const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType)!;
        const blueprintTask = blueprintTaskFor(blueprint, blueprintTaskId);
        if (!blueprintTask) continue;
        const outcome = buildExecutionOutcome(task, blueprintTask, blueprint, previous, Date.now());
        model = replaceOutcome(model, outcome);
        changed = true;
      } else if (previous && previous.state !== "reopened") {
        model = replaceOutcome(model, {
          ...previous,
          state: "reopened",
          strength: "none",
          usableForCoverage: false,
          reopenedAt: Date.now(),
          processingState: "complete",
          processingError: "",
          coverageImpact: null,
          updatedAt: Date.now(),
        });
        changed = true;
      }
    }

    if (changed) await persistOutcomeModel(trackId, model);
    if (model.queuedOutcomeIds.length) queueExecutionOutcomeProcessing(trackId);
    return model;
  });
}

async function handleTaskLifecycle(event: TaskLifecycleEvent): Promise<void> {
  const trackId = executionTaskTrackId(event.after);
  if (!trackId) return;
  if (event.type === "completed") {
    await withTrackMutation(trackId, () => captureCompletedTaskLocked(trackId, event.after));
  } else {
    await withTrackMutation(trackId, () => markTaskReopenedLocked(trackId, event.after));
  }
}

function pendingConfirmationExists(intelligence: Record<string, any>, trackId: number): boolean {
  const blueprint = currentBlueprint(intelligence);
  const model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
  return model.pendingOutcomeIds.length > 0;
}

async function updateOutcomeProcessingState(
  trackId: number,
  outcomeId: string,
  patch: Partial<ExecutionOutcome>,
): Promise<ExecutionOutcome | null> {
  return withTrackMutation(trackId, async () => {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    let model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
    const outcome = model.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) return null;
    const updated = { ...outcome, ...patch, updatedAt: Date.now() } as ExecutionOutcome;
    model = replaceOutcome(model, updated);
    await persistOutcomeModel(trackId, model);
    return updated;
  });
}

async function processOutcome(trackId: number, outcome: ExecutionOutcome): Promise<void> {
  await updateOutcomeProcessingState(trackId, outcome.id, { processingState: "processing", processingError: "" });
  try {
    const beforeTrack = await storage.getCareerTrack(trackId);
    if (!beforeTrack) throw new Error("Career track not found");
    const beforeIntelligence = parseJsonObject(beforeTrack.trackIntelligence);
    const beforeCoverage = beforeIntelligence.coverageModel?.mode === "coverage_model"
      ? beforeIntelligence.coverageModel as CoverageModel
      : null;
    const beforePlan = beforeIntelligence.developmentPlanModel?.mode === "development_plan_model"
      ? beforeIntelligence.developmentPlanModel as DevelopmentPlanModel
      : null;
    const beforeBlueprint = currentBlueprint(beforeIntelligence);

    let afterCoverage = beforeCoverage;
    if (outcome.state === "accepted" && outcome.usableForCoverage) {
      const coverageResult = await ensureRequirementCoverage(trackId, true);
      if (coverageResult && !("error" in coverageResult)) afterCoverage = coverageResult.coverageModel;
    }

    const developmentResult = await ensureDevelopmentPlan(trackId, true);
    const afterPlan = developmentResult && !("error" in developmentResult)
      ? developmentResult.developmentPlanModel
      : beforePlan;
    const blueprintResult = await ensureExecutionBlueprint(trackId, true);
    const afterBlueprint = blueprintResult && "executionBlueprintModel" in blueprintResult
      ? blueprintResult.executionBlueprintModel
      : beforeBlueprint;
    const priorityResult = await ensureExecutionPriority(trackId, true);
    const materialization = priorityResult && "executionPriorityModel" in priorityResult
      ? await materializePrioritizedExecutionSlice(trackId, {
        expectedSourceFingerprint: priorityResult.executionPriorityModel.sourceFingerprint,
        maxNewTasks: 1,
      })
      : null;
    const newTaskIds = materialization && "materialization" in materialization
      ? materialization.materialization.created.map((item) => item.liveTaskId)
      : [];
    const changes = coverageChanges(outcome.requirementIds, beforeCoverage, afterCoverage);
    const impact: ExecutionOutcomeCoverageImpact = {
      changes,
      improvedRequirementIds: changes.filter((change) => change.improved).map((change) => change.requirementId),
      newlyProvenRequirementIds: changes.filter((change) => change.afterStatus === "proven" && change.beforeStatus !== "proven").map((change) => change.requirementId),
      unchangedRequirementIds: changes.filter((change) => !change.improved).map((change) => change.requirementId),
      developmentPlanChanged: Boolean(beforePlan && afterPlan && beforePlan.coverageFingerprint !== afterPlan.coverageFingerprint),
      executionBlueprintChanged: Boolean(beforeBlueprint && afterBlueprint && beforeBlueprint.sourceFingerprint !== afterBlueprint.sourceFingerprint),
      nextMaterializedTaskIds: uniqueNumbers(newTaskIds),
      processedAt: Date.now(),
    };
    await updateOutcomeProcessingState(trackId, outcome.id, {
      processingState: "complete",
      processingError: "",
      coverageImpact: impact,
    });
    await storage.logActivity({
      eventType: "execution_outcome_processed",
      sourceType: "career_track",
      sourceId: trackId,
      taskId: outcome.liveTaskId,
      metadata: JSON.stringify({
        outcomeId: outcome.id,
        improvedRequirementIds: impact.improvedRequirementIds,
        newlyProvenRequirementIds: impact.newlyProvenRequirementIds,
        nextMaterializedTaskIds: impact.nextMaterializedTaskIds,
      }),
    } as any);
  } catch (error: any) {
    await updateOutcomeProcessingState(trackId, outcome.id, {
      processingState: "failed",
      processingError: String(error?.message || "Execution outcome processing failed").slice(0, 700),
    });
  }
}

const processingInFlight = new Map<number, Promise<void>>();

export function queueExecutionOutcomeProcessing(trackId: number): void {
  if (processingInFlight.has(trackId)) return;
  const promise = (async () => {
    while (true) {
      const track = await storage.getCareerTrack(trackId);
      if (!track) return;
      const intelligence = parseJsonObject(track.trackIntelligence);
      if (pendingConfirmationExists(intelligence, trackId)) return;
      const blueprint = currentBlueprint(intelligence);
      const model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
      const next = model.outcomes
        .filter((outcome) => (outcome.state === "accepted" || outcome.state === "no_evidence")
          && (outcome.processingState === "queued" || outcome.processingState === "failed"))
        .sort((left, right) => left.completedAt - right.completedAt)[0];
      if (!next) return;
      await processOutcome(trackId, next);
    }
  })().finally(() => {
    if (processingInFlight.get(trackId) === promise) processingInFlight.delete(trackId);
  });
  processingInFlight.set(trackId, promise);
}

export async function confirmOutcomeForTrack(
  trackId: number,
  outcomeId: string,
  input: ConfirmExecutionOutcomeInput,
): Promise<{ model: ExecutionOutcomeModel; outcome: ExecutionOutcome } | null> {
  const result = await withTrackMutation(trackId, async () => {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    let model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
    const outcome = model.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) return null;
    const confirmed = confirmExecutionOutcome(outcome, input);
    model = replaceOutcome(model, confirmed);
    await persistOutcomeModel(trackId, model);
    if (confirmed.state === "reopened") {
      const task = (await storage.getTasks()).find((candidate) => candidate.id === confirmed.liveTaskId);
      if (task && isCompleted(task)) {
        await storage.updateTask(task.id, {
          done: false,
          status: "not_started",
          pinned: false,
          list: "inbox",
        } as any);
      }
      await ensureExecutionPriority(trackId, true);
    }
    await storage.logActivity({
      eventType: "execution_outcome_confirmed",
      sourceType: "career_track",
      sourceId: trackId,
      taskId: confirmed.liveTaskId,
      metadata: JSON.stringify({ outcomeId, optionId: input.optionId, state: confirmed.state }),
    } as any);
    return { model, outcome: confirmed };
  });
  if (result?.outcome.processingState === "queued") queueExecutionOutcomeProcessing(trackId);
  return result;
}

export async function getExecutionOutcomeState(trackId: number) {
  const model = await reconcileExecutionOutcomesForTrack(trackId);
  if (!model) return null;
  if (model.queuedOutcomeIds.length) queueExecutionOutcomeProcessing(trackId);
  const refreshedTrack = await storage.getCareerTrack(trackId);
  const refreshedIntelligence = parseJsonObject(refreshedTrack?.trackIntelligence);
  const refreshedBlueprint = currentBlueprint(refreshedIntelligence);
  const refreshedModel = normalizeExecutionOutcomeModel(
    refreshedIntelligence.executionOutcomeModel,
    trackId,
    refreshedBlueprint?.sourceFingerprint || model.currentBlueprintFingerprint,
  );
  return {
    track: refreshedTrack,
    executionOutcomeModel: refreshedModel,
    pendingOutcomes: refreshedModel.outcomes.filter((outcome) => outcome.state === "pending_confirmation"),
    recentOutcomes: [...refreshedModel.outcomes]
      .filter((outcome) => outcome.state !== "pending_confirmation")
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 8),
    processing: processingInFlight.has(trackId) || refreshedModel.queuedOutcomeIds.length > 0,
  };
}

let lifecycleRegistered = false;
let reconciliationTimer: ReturnType<typeof setInterval> | null = null;

export function registerExecutionOutcomeLifecycle(): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  registerTaskLifecycleListener((event) => {
    void handleTaskLifecycle(event).catch((error) => console.error("Execution outcome lifecycle failed:", error));
  });
  reconciliationTimer = setInterval(() => {
    void storage.getCareerTracks().then((tracks) => {
      for (const track of tracks.filter((candidate) => candidate.status === "active")) {
        void reconcileExecutionOutcomesForTrack(track.id).catch(() => {});
      }
    }).catch(() => {});
  }, 30_000);
  reconciliationTimer.unref?.();
}

export function stopExecutionOutcomeLifecycleForTests(): void {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = null;
  lifecycleRegistered = false;
}

export const executionOutcomeServiceInternals = {
  coverageChanges,
  executionTaskTrackId,
  isCompleted,
  latestOutcomeForTask,
  replaceOutcome,
  statusRank,
};
