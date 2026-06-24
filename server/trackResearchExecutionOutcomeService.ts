import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import type { CoverageModel } from "./trackResearchCoverageModel";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import { ensureExecutionBlueprint } from "./trackResearchExecutionService";
import type { ExecutionBlueprintModel } from "./trackResearchExecutionBlueprint";
import { ensureExecutionPriority } from "./trackResearchExecutionPriorityService";
import { blueprintTaskIdFromSourceStepType } from "./trackResearchExecutionPriority";
import type { RequirementModel } from "./trackResearchRequirementModel";
import {
  buildExecutionOutcomeRecord,
  normalizeExecutionOutcomeModel,
  reopenExecutionOutcome,
  upsertExecutionOutcome,
  type ExecutionOutcomeModel,
  type ExecutionOutcomeRecord,
} from "./trackResearchExecutionOutcome";
import {
  applyExecutionOutcomeConfirmation,
  buildExecutionCoverageDelta,
  buildExecutionMilestoneProgress,
  type ExecutionOutcomeConfirmationInput,
} from "./trackResearchExecutionOutcomePolicy";
import type { TaskLifecycleEvent } from "./taskLifecycle";

export type ExecutionOutcomeWorkspace = {
  trackId: number;
  targetLabel: string;
  outcomeModel: ExecutionOutcomeModel;
  pendingOutcomes: ExecutionOutcomeRecord[];
  acceptedOutcomeCount: number;
  latestCoverageDelta: ExecutionOutcomeModel["latestCoverageDelta"];
  milestoneProgress: ExecutionOutcomeModel["milestoneProgress"];
  nextActiveSlice: {
    selectedTaskIds: string[];
    nowTaskId: string | null;
    status: string;
  } | null;
  updatedAt: number;
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

function executionTrackId(task: Task): number | null {
  if (Number.isFinite(Number(task.relatedTrackId))) return Number(task.relatedTrackId);
  if (task.sourceType === "career_track" && Number.isFinite(Number(task.sourceId))) return Number(task.sourceId);
  return null;
}

function outcomeModelFromTrack(trackId: number, trackIntelligence: string | null | undefined): ExecutionOutcomeModel {
  const intelligence = parseJsonObject(trackIntelligence);
  return normalizeExecutionOutcomeModel(trackId, intelligence.executionOutcomeModel);
}

async function persistOutcomeModel(trackId: number, model: ExecutionOutcomeModel) {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  return storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      executionOutcomeModel: model,
      executionOutcomeUpdatedAt: model.generatedAt,
      lastUpdated: Date.now(),
    }),
  } as any);
}

function currentCoverage(intelligence: Record<string, any>): CoverageModel | null {
  return intelligence.coverageModel?.mode === "coverage_model"
    ? intelligence.coverageModel as CoverageModel
    : null;
}

async function refreshPriorityOnly(trackId: number): Promise<void> {
  await ensureExecutionPriority(trackId, true).catch((error) => {
    console.error("Execution priority refresh after task lifecycle failed:", error);
    return null;
  });
}

async function refreshAdaptiveModels(input: {
  trackId: number;
  outcomeModel: ExecutionOutcomeModel;
  beforeCoverage: CoverageModel | null;
  affectedRequirementIds: string[];
}): Promise<ExecutionOutcomeModel> {
  const coverageResult = await ensureRequirementCoverage(input.trackId, true);
  if (!coverageResult || "error" in coverageResult) {
    await refreshPriorityOnly(input.trackId);
    return input.outcomeModel;
  }

  const developmentResult = await ensureDevelopmentPlan(input.trackId, true);
  const executionResult = await ensureExecutionBlueprint(input.trackId, true);
  const priorityResult = await ensureExecutionPriority(input.trackId, true);
  const requirementModel = coverageResult.requirementModel;
  const coverageModel = coverageResult.coverageModel;
  const blueprint = executionResult && "executionBlueprintModel" in executionResult
    ? executionResult.executionBlueprintModel
    : developmentResult && "developmentPlanModel" in developmentResult
      ? null
      : null;
  const latestTrack = await storage.getCareerTrack(input.trackId);
  const latestIntelligence = parseJsonObject(latestTrack?.trackIntelligence);
  const latestBlueprint = blueprint
    || (latestIntelligence.executionBlueprintModel?.mode === "execution_blueprint_model"
      ? latestIntelligence.executionBlueprintModel as ExecutionBlueprintModel
      : null);
  const latestPriority = priorityResult && "executionPriorityModel" in priorityResult
    ? priorityResult.executionPriorityModel
    : latestIntelligence.executionPriorityModel;

  const next: ExecutionOutcomeModel = {
    ...input.outcomeModel,
    latestCoverageDelta: buildExecutionCoverageDelta({
      requirementModel,
      before: input.beforeCoverage,
      after: coverageModel,
      affectedRequirementIds: input.affectedRequirementIds,
    }),
    milestoneProgress: latestBlueprint
      ? buildExecutionMilestoneProgress({
        blueprint: latestBlueprint,
        coverageModel,
        outcomeModel: input.outcomeModel,
      })
      : input.outcomeModel.milestoneProgress,
    generatedAt: Date.now(),
  };
  await persistOutcomeModel(input.trackId, next);
  await storage.logActivity({
    eventType: "execution_evidence_replanned",
    sourceType: "career_track",
    sourceId: input.trackId,
    metadata: JSON.stringify({
      affectedRequirementIds: input.affectedRequirementIds,
      changedRequirementIds: next.latestCoverageDelta.filter((item) => item.changed).map((item) => item.requirementId),
      nextActiveSliceTaskIds: Array.isArray(latestPriority?.activeSlice?.selectedTaskIds)
        ? latestPriority.activeSlice.selectedTaskIds
        : [],
    }),
  } as any);
  return next;
}

async function updateMilestonesWithoutCoverageRefresh(input: {
  trackId: number;
  outcomeModel: ExecutionOutcomeModel;
  blueprint: ExecutionBlueprintModel;
  coverageModel: CoverageModel;
}): Promise<ExecutionOutcomeModel> {
  const next: ExecutionOutcomeModel = {
    ...input.outcomeModel,
    milestoneProgress: buildExecutionMilestoneProgress({
      blueprint: input.blueprint,
      coverageModel: input.coverageModel,
      outcomeModel: input.outcomeModel,
    }),
    generatedAt: Date.now(),
  };
  await persistOutcomeModel(input.trackId, next);
  await refreshPriorityOnly(input.trackId);
  return next;
}

async function executionModels(trackId: number) {
  const result = await ensureExecutionBlueprint(trackId, false);
  if (!result || !("executionBlueprintModel" in result)) return null;
  return result;
}

const trackQueues = new Map<number, Promise<unknown>>();

function withTrackOutcomeLock<T>(trackId: number, work: () => Promise<T>): Promise<T> {
  const previous = trackQueues.get(trackId) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(work);
  trackQueues.set(trackId, current);
  current.finally(() => {
    if (trackQueues.get(trackId) === current) trackQueues.delete(trackId);
  }).catch(() => undefined);
  return current;
}

async function captureCompletedTask(task: Task): Promise<ExecutionOutcomeWorkspace | null> {
  const trackId = executionTrackId(task);
  const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
  if (!trackId || !blueprintTaskId) return null;

  return withTrackOutcomeLock(trackId, async () => {
    const models = await executionModels(trackId);
    if (!models) return null;
    const blueprintTask = models.executionBlueprintModel.tasks.find((item) => item.id === blueprintTaskId);
    if (!blueprintTask) {
      await storage.logActivity({
        eventType: "execution_outcome_stale_blueprint",
        sourceType: "career_track",
        sourceId: trackId,
        taskId: task.id,
        metadata: JSON.stringify({ blueprintTaskId }),
      } as any);
      await refreshPriorityOnly(trackId);
      return getExecutionOutcomeWorkspace(trackId);
    }

    const track = await storage.getCareerTrack(trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const beforeCoverage = currentCoverage(intelligence) || models.coverageModel;
    const model = outcomeModelFromTrack(trackId, track.trackIntelligence);
    const existing = model.records.find((record) => record.liveTaskId === task.id) || null;
    const record = buildExecutionOutcomeRecord({
      trackId,
      task,
      blueprint: models.executionBlueprintModel,
      blueprintTask,
      existing,
    });
    let next = upsertExecutionOutcome(model, record);
    await persistOutcomeModel(trackId, next);
    await storage.logActivity({
      eventType: "execution_outcome_captured",
      sourceType: "career_track",
      sourceId: trackId,
      taskId: task.id,
      metadata: JSON.stringify({
        outcomeId: record.id,
        blueprintTaskId,
        status: record.status,
        usableForCoverage: record.usableForCoverage,
        requirementIds: record.requirementIds,
      }),
    } as any);

    if (record.status === "accepted" && record.usableForCoverage) {
      next = await refreshAdaptiveModels({
        trackId,
        outcomeModel: next,
        beforeCoverage,
        affectedRequirementIds: record.requirementIds,
      });
    } else {
      next = await updateMilestonesWithoutCoverageRefresh({
        trackId,
        outcomeModel: next,
        blueprint: models.executionBlueprintModel,
        coverageModel: models.coverageModel,
      });
    }
    return workspaceFromModels