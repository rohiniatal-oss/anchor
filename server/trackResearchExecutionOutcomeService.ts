import type { CareerTrack, Task } from "@shared/schema";
import { storage } from "./storage";
import { registerTaskLifecycleListener, type TaskLifecycleEvent } from "./taskLifecycle";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import type { CoverageModel } from "./trackResearchCoverageModel";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import type { DevelopmentMilestone, DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
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
  normalizeExecutionOutcomeModel,
  type ConfirmExecutionOutcomeInput,
  type ExecutionCoverageChange,
  type ExecutionMilestoneChange,
  type ExecutionMilestoneState,
  type ExecutionOutcome,
  type ExecutionOutcomeCoverageImpact,
  type ExecutionOutcomeModel,
} from "./trackResearchExecutionOutcome";

function compact(value: unknown, max = 1_000): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
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

function currentBlueprint(intelligence: Record<string, any>): ExecutionBlueprintModel | null {
  const value = intelligence.executionBlueprintModel;
  return value?.mode === "execution_blueprint_model" && Array.isArray(value.tasks)
    ? value as ExecutionBlueprintModel
    : null;
}

function currentDevelopmentPlan(intelligence: Record<string, any>): DevelopmentPlanModel | null {
  const value = intelligence.developmentPlanModel;
  return value?.mode === "development_plan_model" && Array.isArray(value.workstreams)
    ? value as DevelopmentPlanModel
    : null;
}

function currentCoverage(intelligence: Record<string, any>): CoverageModel | null {
  const value = intelligence.coverageModel;
  return value?.mode === "coverage_model" && Array.isArray(value.coverage)
    ? value as CoverageModel
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

function requirementLabels(intelligence: Record<string, any>): Record<string, string> {
  const requirements = Array.isArray(intelligence.requirementModel?.requirements)
    ? intelligence.requirementModel.requirements
    : [];
  return Object.fromEntries(requirements
    .filter((requirement: any) => typeof requirement?.id === "string")
    .map((requirement: any) => [requirement.id, compact(requirement.label || requirement.id, 300)]));
}

function coverageChanges(
  requirementIds: string[],
  labels: Record<string, string>,
  before: CoverageModel | null,
  after: CoverageModel | null,
): ExecutionCoverageChange[] {
  const beforeById = new Map((before?.coverage || []).map((item) => [item.requirementId, item.status]));
  const afterById = new Map((after?.coverage || []).map((item) => [item.requirementId, item.status]));
  return requirementIds.map((requirementId) => {
    const beforeStatus = beforeById.get(requirementId) || "unknown";
    const afterStatus = afterById.get(requirementId) || beforeStatus;
    return {
      requirementId,
      requirementLabel: labels[requirementId] || requirementId,
      beforeStatus,
      afterStatus,
      improved: statusRank(afterStatus) > statusRank(beforeStatus),
      regressed: statusRank(afterStatus) < statusRank(beforeStatus),
    };
  });
}

function milestoneState(milestone: DevelopmentMilestone, coverage: CoverageModel | null): ExecutionMilestoneState {
  if (!milestone.requirementIds.length) return "not_started";
  const statusById = new Map((coverage?.coverage || []).map((item) => [item.requirementId, item.status]));
  const statuses = milestone.requirementIds.map((id) => statusById.get(id) || "unknown");
  if (statuses.every((status) => status === "proven")) return "achieved";
  if (statuses.some((status) => status === "proven" || status === "partially_proven" || status === "below_bar")) return "progressing";
  return "not_started";
}

function milestoneChanges(
  milestoneIds: string[],
  beforePlan: DevelopmentPlanModel | null,
  beforeCoverage: CoverageModel | null,
  afterCoverage: CoverageModel | null,
): ExecutionMilestoneChange[] {
  if (!beforePlan || !milestoneIds.length) return [];
  const milestoneById = new Map(
    beforePlan.workstreams.flatMap((workstream) => workstream.milestones).map((milestone) => [milestone.id, milestone]),
  );
  return milestoneIds.flatMap((milestoneId) => {
    const milestone = milestoneById.get(milestoneId);
    if (!milestone) return [];
    const beforeState = milestoneState(milestone, beforeCoverage);
    const afterState = milestoneState(milestone, afterCoverage);
    return [{
      milestoneId,
      milestoneLabel: milestone.label,
      requirementIds: [...milestone.requirementIds],
      beforeState,
      afterState,
      achieved: beforeState !== "achieved" && afterState === "achieved",
      regressed: beforeState === "achieved" && afterState !== "achieved",
    }];
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
  return outcome;
}

async function markTaskReopenedLocked(trackId: number, task: Task): Promise<ExecutionOutcome | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const blueprint = currentBlueprint(intelligence);
  const model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
  const previous = latestOutcomeForTask(model, task.id);
  if (!previous || previous.state === "reopened") return previous;
  const reopened: ExecutionOutcome = {
    ...previous,
    state: "reopened",
    selectedOptionId: "not_completed",
    strength: "none",
    usableForCoverage: false,
    reopenedAt: Date.now(),
    processingState: "queued",
    processingError: "",
    coverageImpact: null,
    updatedAt: Date.now(),
  };
  await persistOutcomeModel(trackId, replaceOutcome(model, reopened));
  return reopened;
}

export async function captureCompletedExecutionTask(task: Task): Promise<ExecutionOutcome | null> {
  const trackId = executionTaskTrackId(task);
  if (!trackId || !isCompleted(task)) return null;
  const outcome = await withTrackMutation(trackId, () => captureCompletedTaskLocked(trackId, task));
  if (outcome?.processingState === "queued") queueExecutionOutcomeProcessing(trackId);
  return outcome;
}

export async function reconcileExecutionOutcomesForTrack(trackId: number): Promise<ExecutionOutcomeModel | null> {
  const result = await withTrackMutation(trackId, async () => {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    if (!blueprint) return normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, "");
    const blueprintTaskIds = new Set(blueprint.tasks.map((task) => task.id));
    const tasks = (await storage.getTasks()).filter((task) => {
      const taskTrackId = executionTaskTrackId(task);
      const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
      return taskTrackId === trackId && blueprintTaskId && blueprintTaskIds.has(blueprintTaskId);
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
        model = replaceOutcome(model, buildExecutionOutcome(task, blueprintTask, blueprint, previous, Date.now()));
        changed = true;
      } else if (previous && previous.state !== "reopened") {
        model = replaceOutcome(model, {
          ...previous,
          state: "reopened",
          selectedOptionId: "not_completed",
          strength: "none",
          usableForCoverage: false,
          reopenedAt: Date.now(),
          processingState: "queued",
          processingError: "",
          coverageImpact: null,
          updatedAt: Date.now(),
        });
        changed = true;
      }
    }

    if (changed) await persistOutcomeModel(trackId, model);
    return model;
  });
  if (result?.queuedOutcomeIds.length) queueExecutionOutcomeProcessing(trackId);
  return result;
}

async function handleTaskLifecycle(event: TaskLifecycleEvent): Promise<void> {
  const trackId = executionTaskTrackId(event.after);
  if (!trackId) return;
  const outcome = event.type === "completed"
    ? await withTrackMutation(trackId, () => captureCompletedTaskLocked(trackId, event.after))
    : await withTrackMutation(trackId, () => markTaskReopenedLocked(trackId, event.after));
  if (outcome?.processingState === "queued") queueExecutionOutcomeProcessing(trackId);
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

async function finalizeOutcomeProcessing(
  trackId: number,
  processingSnapshot: ExecutionOutcome,
  patch: Partial<ExecutionOutcome>,
): Promise<boolean> {
  return withTrackMutation(trackId, async () => {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return false;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    let model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
    const current = model.outcomes.find((candidate) => candidate.id === processingSnapshot.id);
    if (!current) return false;
    const changedDuringProcessing = current.state !== processingSnapshot.state
      || current.selectedOptionId !== processingSnapshot.selectedOptionId
      || current.updatedAt !== processingSnapshot.updatedAt;
    const updated: ExecutionOutcome = changedDuringProcessing
      ? {
          ...current,
          processingState: "queued",
          processingError: "The outcome changed while Anchor was reassessing it; the current state will be processed next.",
          updatedAt: Date.now(),
        }
      : {
          ...current,
          ...patch,
          updatedAt: Date.now(),
        };
    model = replaceOutcome(model, updated);
    await persistOutcomeModel(trackId, model);
    return !changedDuringProcessing;
  });
}

async function processOutcome(trackId: number, queuedOutcome: ExecutionOutcome): Promise<void> {
  const processing = await updateOutcomeProcessingState(trackId, queuedOutcome.id, {
    processingState: "processing",
    processingError: "",
  });
  if (!processing) return;

  try {
    const beforeTrack = await storage.getCareerTrack(trackId);
    if (!beforeTrack) throw new Error("Career track not found");
    const beforeIntelligence = parseJsonObject(beforeTrack.trackIntelligence);
    const beforeCoverage = currentCoverage(beforeIntelligence);
    const beforePlan = currentDevelopmentPlan(beforeIntelligence);
    const beforeBlueprint = currentBlueprint(beforeIntelligence);
    const labels = requirementLabels(beforeIntelligence);

    let afterCoverage = beforeCoverage;
    let afterPlan = beforePlan;
    let afterBlueprint = beforeBlueprint;

    const evidenceChanged = processing.state === "accepted" || processing.state === "reopened";
    if (evidenceChanged) {
      const coverageResult = await ensureRequirementCoverage(trackId, true);
      if (!coverageResult || "error" in coverageResult) {
        throw new Error(coverageResult && "error" in coverageResult ? coverageResult.error : "Coverage refresh failed");
      }
      afterCoverage = coverageResult.coverageModel;

      const developmentResult = await ensureDevelopmentPlan(trackId, true);
      if (!developmentResult || "error" in developmentResult) {
        throw new Error(developmentResult && "error" in developmentResult ? developmentResult.error : "Development plan refresh failed");
      }
      afterPlan = developmentResult.developmentPlanModel;

      const blueprintResult = await ensureExecutionBlueprint(trackId, true);
      if (!blueprintResult || !("executionBlueprintModel" in blueprintResult)) {
        throw new Error("Execution blueprint refresh failed");
      }
      afterBlueprint = blueprintResult.executionBlueprintModel;
    }

    const priorityResult = await ensureExecutionPriority(trackId, true);
    if (!priorityResult || !("executionPriorityModel" in priorityResult)) {
      throw new Error("Execution priority refresh failed");
    }

    let nextMaterializedTaskIds: number[] = [];
    if (processing.state !== "reopened") {
      const materialization = await materializePrioritizedExecutionSlice(trackId, {
        expectedSourceFingerprint: priorityResult.executionPriorityModel.sourceFingerprint,
        maxNewTasks: 1,
      });
      if (materialization && "materialization" in materialization) {
        nextMaterializedTaskIds = materialization.materialization.created.map((item) => item.liveTaskId);
      }
    }

    const changes = coverageChanges(processing.requirementIds, labels, beforeCoverage, afterCoverage);
    const milestones = milestoneChanges(processing.milestoneIds, beforePlan, beforeCoverage, afterCoverage);
    const impact: ExecutionOutcomeCoverageImpact = {
      changes,
      milestoneChanges: milestones,
      improvedRequirementIds: changes.filter((change) => change.improved).map((change) => change.requirementId),
      newlyProvenRequirementIds: changes.filter((change) => change.afterStatus === "proven" && change.beforeStatus !== "proven").map((change) => change.requirementId),
      regressedRequirementIds: changes.filter((change) => change.regressed).map((change) => change.requirementId),
      unchangedRequirementIds: changes.filter((change) => !change.improved && !change.regressed).map((change) => change.requirementId),
      newlyAchievedMilestoneIds: milestones.filter((milestone) => milestone.achieved).map((milestone) => milestone.milestoneId),
      developmentPlanChanged: Boolean(beforePlan && afterPlan && beforePlan.coverageFingerprint !== afterPlan.coverageFingerprint),
      executionBlueprintChanged: Boolean(beforeBlueprint && afterBlueprint && beforeBlueprint.sourceFingerprint !== afterBlueprint.sourceFingerprint),
      nextMaterializedTaskIds: uniqueNumbers(nextMaterializedTaskIds),
      processedAt: Date.now(),
    };
    const finalized = await finalizeOutcomeProcessing(trackId, processing, {
      processingState: "complete",
      processingError: "",
      coverageImpact: impact,
    });
    if (!finalized) queueExecutionOutcomeProcessing(trackId);
  } catch (error: any) {
    const finalized = await finalizeOutcomeProcessing(trackId, processing, {
      processingState: "failed",
      processingError: compact(error?.message || "The evidence and planning refresh failed.", 700),
    });
    if (!finalized) queueExecutionOutcomeProcessing(trackId);
  }
}

const processingByTrack = new Map<number, Promise<void>>();

async function drainExecutionOutcomeQueue(trackId: number): Promise<void> {
  while (true) {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    const model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
    const queued = [...model.outcomes]
      .filter((outcome) => outcome.processingState === "queued")
      .sort((left, right) => left.updatedAt - right.updatedAt)[0];
    if (!queued) return;
    await processOutcome(trackId, queued);
  }
}

export function queueExecutionOutcomeProcessing(trackId: number): void {
  if (processingByTrack.has(trackId)) return;
  const promise = Promise.resolve()
    .then(() => drainExecutionOutcomeQueue(trackId))
    .catch((error) => console.error("Execution outcome processing failed:", error))
    .finally(() => {
      if (processingByTrack.get(trackId) === promise) processingByTrack.delete(trackId);
    });
  processingByTrack.set(trackId, promise);
}

export async function confirmOutcomeForTrack(
  trackId: number,
  outcomeId: string,
  input: ConfirmExecutionOutcomeInput,
): Promise<{ outcome: ExecutionOutcome; model: ExecutionOutcomeModel } | null> {
  const confirmed = await withTrackMutation(trackId, async () => {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    let model = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
    const outcome = model.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) return null;
    if (outcome.state !== "pending_confirmation") return { outcome, model };

    const nextOutcome = confirmExecutionOutcome(outcome, input, Date.now());
    if (nextOutcome.state === "reopened") {
      const liveTask = (await storage.getTasks()).find((task) => task.id === nextOutcome.liveTaskId);
      if (!liveTask) throw new Error("The source task no longer exists");
      const reopened = await storage.updateTask(liveTask.id, {
        done: false,
        status: "not_started",
        pinned: false,
      } as any);
      if (!reopened) throw new Error("The source task could not be reopened");
    }

    model = replaceOutcome(model, nextOutcome);
    await persistOutcomeModel(trackId, model);
    await storage.logActivity({
      eventType: nextOutcome.state === "reopened" ? "execution_outcome_reopened" : "execution_outcome_confirmed",
      sourceType: "career_track",
      sourceId: trackId,
      taskId: nextOutcome.liveTaskId,
      metadata: JSON.stringify({
        outcomeId: nextOutcome.id,
        optionId: nextOutcome.selectedOptionId,
        usableForCoverage: nextOutcome.usableForCoverage,
      }),
    } as any);
    return { outcome: nextOutcome, model };
  });
  if (confirmed?.outcome.processingState === "queued") queueExecutionOutcomeProcessing(trackId);
  return confirmed;
}

export async function retryExecutionOutcomeProcessing(trackId: number): Promise<ExecutionOutcomeModel | null> {
  const model = await withTrackMutation(trackId, async () => {
    const track = await storage.getCareerTrack(trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const blueprint = currentBlueprint(intelligence);
    let current = normalizeExecutionOutcomeModel(intelligence.executionOutcomeModel, trackId, blueprint?.sourceFingerprint || "");
    const now = Date.now();
    current = normalizeExecutionOutcomeModel({
      ...current,
      outcomes: current.outcomes.map((outcome) => (
        outcome.processingState === "failed"
          || (outcome.processingState === "processing" && now - outcome.updatedAt > 5 * 60 * 1000)
          ? { ...outcome, processingState: "queued", processingError: "", updatedAt: now }
          : outcome
      )),
    }, trackId, current.currentBlueprintFingerprint);
    await persistOutcomeModel(trackId, current);
    return current;
  });
  if (model?.queuedOutcomeIds.length) queueExecutionOutcomeProcessing(trackId);
  return model;
}

export async function getExecutionOutcomeState(trackId: number) {
  const model = await reconcileExecutionOutcomesForTrack(trackId);
  if (!model) return null;
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const labels = requirementLabels(intelligence);
  const milestoneLabels = Object.fromEntries((currentDevelopmentPlan(intelligence)?.workstreams || [])
    .flatMap((workstream) => workstream.milestones)
    .map((milestone) => [milestone.id, milestone.label]));
  const pendingOutcomes = [...model.outcomes]
    .filter((outcome) => outcome.state === "pending_confirmation")
    .sort((left, right) => left.completedAt - right.completedAt);
  const recentOutcomes = [...model.outcomes]
    .filter((outcome) => outcome.state !== "pending_confirmation")
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 8);
  const failedOutcomes = model.outcomes.filter((outcome) => outcome.processingState === "failed");
  return {
    executionOutcomeModel: model,
    pendingOutcomes,
    recentOutcomes,
    failedOutcomes,
    processing: model.outcomes.some((outcome) => outcome.processingState === "queued" || outcome.processingState === "processing"),
    requirementLabels: labels,
    milestoneLabels,
  };
}

let lifecycleRegistered = false;

export function registerExecutionOutcomeLifecycle(): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  registerTaskLifecycleListener(handleTaskLifecycle);
}

export const executionOutcomeServiceInternals = {
  coverageChanges,
  executionTaskTrackId,
  isCompleted,
  milestoneChanges,
  milestoneState,
  statusRank,
};
