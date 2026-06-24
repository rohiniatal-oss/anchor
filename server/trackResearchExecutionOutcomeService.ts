import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import type { CoverageModel } from "./trackResearchCoverageModel";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import { ensureExecutionBlueprint } from "./trackResearchExecutionService";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import { ensureExecutionPriority } from "./trackResearchExecutionPriorityService";
import { blueprintTaskIdFromSourceStepType } from "./trackResearchExecutionPriority";
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

export type ExecutionOutcomeReplan = {
  status: "not_required" | "refreshed" | "failed";
  affectedRequirementIds: string[];
  coverageChangedRequirementIds: string[];
  nextSelectedTaskIds: string[];
  message: string;
  completedAt: number | null;
};

export type ExecutionOutcomeRuntimeResult = {
  track: any;
  executionOutcomeModel: ExecutionOutcomeModel;
  pendingConfirmations: ExecutionOutcomeRecord[];
  acceptedOutcomes: ExecutionOutcomeRecord[];
  latestCoverageDelta: ExecutionOutcomeModel["latestCoverageDelta"];
  milestoneProgress: ExecutionOutcomeModel["milestoneProgress"];
  replan: ExecutionOutcomeReplan;
  scannedTaskCount: number;
  changedOutcomeCount: number;
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

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function completed(task: Pick<Task, "done" | "status">): boolean {
  return Boolean(task.done) || task.status === "done";
}

function taskTrackId(task: Task): number | null {
  if (typeof task.relatedTrackId === "number" && Number.isFinite(task.relatedTrackId)) return task.relatedTrackId;
  if (task.sourceType === "career_track" && typeof task.sourceId === "number" && Number.isFinite(task.sourceId)) return task.sourceId;
  return null;
}

function recordFingerprint(record: ExecutionOutcomeRecord | null | undefined): string {
  if (!record) return "missing";
  return JSON.stringify({
    status: record.status,
    usableForCoverage: record.usableForCoverage,
    strength: record.strength,
    detail: record.detail,
    sourceUrl: record.sourceUrl,
    requirementIds: [...record.requirementIds].sort(),
    confirmationAnswer: record.confirmation.answer,
  });
}

function coverageContributionFingerprint(record: ExecutionOutcomeRecord | null | undefined): string {
  if (!record || record.status !== "accepted" || !record.usableForCoverage) return "none";
  return JSON.stringify({
    strength: record.strength,
    detail: record.detail,
    sourceUrl: record.sourceUrl,
    requirementIds: [...record.requirementIds].sort(),
  });
}

function recordChanged(
  before: ExecutionOutcomeRecord | null | undefined,
  after: ExecutionOutcomeRecord,
): boolean {
  return recordFingerprint(before) !== recordFingerprint(after);
}

function coverageContributionChanged(
  before: ExecutionOutcomeRecord | null | undefined,
  after: ExecutionOutcomeRecord,
): boolean {
  return coverageContributionFingerprint(before) !== coverageContributionFingerprint(after);
}

function strongerThan(
  candidate: ExecutionOutcomeRecord,
  existing: ExecutionOutcomeRecord,
): boolean {
  const rank = { planned: 1, supporting: 2, declared: 3, direct: 4, verified: 5 } as const;
  return rank[candidate.strength] > rank[existing.strength]
    || Boolean(candidate.sourceUrl) && !existing.sourceUrl;
}

function nextRecordForCompletedTask(input: {
  trackId: number;
  task: Task;
  blueprint: ExecutionBlueprintModel;
  blueprintTask: TaskBlueprint;
  existing?: ExecutionOutcomeRecord | null;
}): ExecutionOutcomeRecord {
  const candidate = buildExecutionOutcomeRecord(input);
  const existing = input.existing;
  if (!existing || existing.status === "reopened") return candidate;
  if (existing.confirmation.answeredAt) return existing;
  if (candidate.status === "accepted" && (existing.status !== "accepted" || strongerThan(candidate, existing))) return candidate;
  if (candidate.status === "operational_only" && existing.status === "pending_confirmation") return candidate;
  return existing;
}

async function persistOutcomeModel(
  trackId: number,
  model: ExecutionOutcomeModel,
  extra: Record<string, any> = {},
) {
  const latestTrack = await storage.getCareerTrack(trackId);
  if (!latestTrack) return null;
  const intelligence = parseJsonObject(latestTrack.trackIntelligence);
  return storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      executionOutcomeModel: model,
      executionOutcomeUpdatedAt: model.generatedAt,
      ...extra,
      lastUpdated: Date.now(),
    }),
  } as any);
}

function resultView(
  track: any,
  model: ExecutionOutcomeModel,
  replan: ExecutionOutcomeReplan,
  scannedTaskCount: number,
  changedOutcomeCount: number,
): ExecutionOutcomeRuntimeResult {
  return {
    track,
    executionOutcomeModel: model,
    pendingConfirmations: model.records.filter((record) => record.status === "pending_confirmation"),
    acceptedOutcomes: model.records.filter((record) => record.status === "accepted"),
    latestCoverageDelta: model.latestCoverageDelta,
    milestoneProgress: model.milestoneProgress,
    replan,
    scannedTaskCount,
    changedOutcomeCount,
  };
}

function noReplan(affectedRequirementIds: string[] = []): ExecutionOutcomeReplan {
  return {
    status: "not_required",
    affectedRequirementIds,
    coverageChangedRequirementIds: [],
    nextSelectedTaskIds: [],
    message: affectedRequirementIds.length
      ? "The outcome record changed, but no coverage-bearing evidence was added or withdrawn."
      : "No new execution outcome required replanning.",
    completedAt: null,
  };
}

async function refreshDownstreamModels(input: {
  trackId: number;
  model: ExecutionOutcomeModel;
  beforeCoverage: CoverageModel | null;
  affectedRequirementIds: string[];
}): Promise<{ model: ExecutionOutcomeModel; replan: ExecutionOutcomeReplan; track: any }> {
  const affectedRequirementIds = [...new Set(input.affectedRequirementIds)];
  if (!affectedRequirementIds.length) {
    const track = await storage.getCareerTrack(input.trackId);
    return { model: input.model, replan: noReplan(), track };
  }

  try {
    const coverageResult = await ensureRequirementCoverage(input.trackId, true);
    if (!coverageResult || "error" in coverageResult) {
      throw new Error(coverageResult && "error" in coverageResult ? coverageResult.error : "Coverage refresh failed");
    }
    const developmentResult = await ensureDevelopmentPlan(input.trackId, true);
    if (!developmentResult || !("developmentPlanModel" in developmentResult)) {
      throw new Error(developmentResult && "error" in developmentResult ? developmentResult.error : "Development plan refresh failed");
    }
    const blueprintResult = await ensureExecutionBlueprint(input.trackId, true);
    if (!blueprintResult || !("executionBlueprintModel" in blueprintResult)) {
      throw new Error(blueprintResult && "error" in blueprintResult ? blueprintResult.error : "Execution blueprint refresh failed");
    }
    const priorityResult = await ensureExecutionPriority(input.trackId, true);
    if (!priorityResult || !("executionPriorityModel" in priorityResult)) {
      throw new Error(priorityResult && "error" in priorityResult ? priorityResult.error : "Execution priority refresh failed");
    }

    const latestTrack = await storage.getCareerTrack(input.trackId) || priorityResult.track;
    const latestIntelligence = parseJsonObject(latestTrack.trackIntelligence);
    const latestModel = normalizeExecutionOutcomeModel(input.trackId, latestIntelligence.executionOutcomeModel || input.model);
    const latestCoverageDelta = buildExecutionCoverageDelta(
      coverageResult.requirementModel,
      input.beforeCoverage,
      coverageResult.coverageModel,
      affectedRequirementIds,
    );
    const milestoneProgress = buildExecutionMilestoneProgress(
      developmentResult.developmentPlanModel,
      coverageResult.coverageModel,
      latestModel.records,
    );
    const model: ExecutionOutcomeModel = {
      ...latestModel,
      latestCoverageDelta,
      milestoneProgress,
      pendingConfirmationIds: latestModel.records.filter((record) => record.status === "pending_confirmation").map((record) => record.id),
      generatedAt: Date.now(),
    };
    const changedIds = latestCoverageDelta.filter((delta) => delta.changed).map((delta) => delta.requirementId);
    const replan: ExecutionOutcomeReplan = {
      status: "refreshed",
      affectedRequirementIds,
      coverageChangedRequirementIds: changedIds,
      nextSelectedTaskIds: priorityResult.executionPriorityModel.activeSlice.selectedTaskIds,
      message: changedIds.length
        ? `Coverage changed for ${changedIds.length} requirement${changedIds.length === 1 ? "" : "s"}; the development plan, blueprint and active slice were refreshed.`
        : "The new evidence was assessed. Coverage did not change yet, but milestones and the active slice were refreshed.",
      completedAt: Date.now(),
    };
    const updatedTrack = await persistOutcomeModel(input.trackId, model, {
      lastExecutionOutcomeReplan: replan,
    }) || latestTrack;
    return { model, replan, track: updatedTrack };
  } catch (error: any) {
    const track = await storage.getCareerTrack(input.trackId);
    const replan: ExecutionOutcomeReplan = {
      status: "failed",
      affectedRequirementIds,
      coverageChangedRequirementIds: [],
      nextSelectedTaskIds: [],
      message: compact(error?.message || "The outcome was saved, but downstream replanning did not complete."),
      completedAt: Date.now(),
    };
    await persistOutcomeModel(input.trackId, input.model, { lastExecutionOutcomeReplan: replan });
    return { model: input.model, replan, track };
  }
}

type ReconcileResult = {
  model: ExecutionOutcomeModel;
  affectedRequirementIds: string[];
  scannedTaskCount: number;
  changedOutcomeCount: number;
};

function reconcileCompletedTasks(input: {
  trackId: number;
  blueprint: ExecutionBlueprintModel;
  tasks: Task[];
  model: ExecutionOutcomeModel;
}): ReconcileResult {
  let model = input.model;
  const blueprintById = new Map(input.blueprint.tasks.map((task) => [task.id, task]));
  const affectedRequirementIds = new Set<string>();
  let scannedTaskCount = 0;
  let changedOutcomeCount = 0;

  for (const task of input.tasks) {
    if (taskTrackId(task) !== input.trackId) continue;
    const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
    if (!blueprintTaskId) continue;
    const existing = model.records.find((record) => record.liveTaskId === task.id || record.blueprintTaskId === blueprintTaskId);
    const blueprintTask = blueprintById.get(blueprintTaskId);

    if (!completed(task)) {
      if (existing && existing.status !== "reopened") {
        const reopened = reopenExecutionOutcome(model, task.id);
        const next = reopened.records.find((record) => record.liveTaskId === task.id);
        if (next && recordChanged(existing, next)) {
          if (coverageContributionChanged(existing, next)) {
            existing.requirementIds.forEach((id) => affectedRequirementIds.add(id));
          }
          changedOutcomeCount += 1;
        }
        model = reopened;
      }
      continue;
    }

    if (!blueprintTask) continue;
    scannedTaskCount += 1;
    const record = nextRecordForCompletedTask({
      trackId: input.trackId,
      task,
      blueprint: input.blueprint,
      blueprintTask,
      existing,
    });
    if (!existing || record !== existing) {
      if (coverageContributionChanged(existing, record)) {
        record.requirementIds.forEach((id) => affectedRequirementIds.add(id));
      }
      model = upsertExecutionOutcome(model, record);
      changedOutcomeCount += 1;
    }
  }

  return {
    model,
    affectedRequirementIds: [...affectedRequirementIds],
    scannedTaskCount,
    changedOutcomeCount,
  };
}

const trackLocks = new Map<number, Promise<any>>();

async function withTrackLock<T>(trackId: number, operation: () => Promise<T>): Promise<T> {
  const previous = trackLocks.get(trackId) || Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  trackLocks.set(trackId, queued);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (trackLocks.get(trackId) === queued) trackLocks.delete(trackId);
  }
}

async function scanUnlocked(trackId: number): Promise<ExecutionOutcomeRuntimeResult | null> {
  const blueprintResult = await ensureExecutionBlueprint(trackId, false);
  if (!blueprintResult || !("executionBlueprintModel" in blueprintResult)) return null;
  const track = await storage.getCareerTrack(trackId) || blueprintResult.track;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const beforeCoverage = intelligence.coverageModel?.mode === "coverage_model"
    ? intelligence.coverageModel as CoverageModel
    : blueprintResult.coverageModel;
  const model = normalizeExecutionOutcomeModel(trackId, intelligence.executionOutcomeModel);
  const tasks = await storage.getTasks();
  const reconciled = reconcileCompletedTasks({
    trackId,
    blueprint: blueprintResult.executionBlueprintModel,
    tasks,
    model,
  });

  if (!reconciled.changedOutcomeCount) {
    const milestoneProgress = buildExecutionMilestoneProgress(
      blueprintResult.developmentPlanModel,
      blueprintResult.coverageModel,
      reconciled.model.records,
    );
    const stableModel: ExecutionOutcomeModel = {
      ...reconciled.model,
      milestoneProgress,
      generatedAt: reconciled.model.generatedAt,
    };
    return resultView(track, stableModel, noReplan(), reconciled.scannedTaskCount, 0);
  }

  await persistOutcomeModel(trackId, reconciled.model);
  if (!reconciled.affectedRequirementIds.length) {
    const milestoneProgress = buildExecutionMilestoneProgress(
      blueprintResult.developmentPlanModel,
      blueprintResult.coverageModel,
      reconciled.model.records,
    );
    const nextModel: ExecutionOutcomeModel = {
      ...reconciled.model,
      milestoneProgress,
      generatedAt: Date.now(),
    };
    const updatedTrack = await persistOutcomeModel(trackId, nextModel) || track;
    return resultView(updatedTrack, nextModel, noReplan(), reconciled.scannedTaskCount, reconciled.changedOutcomeCount);
  }

  const refreshed = await refreshDownstreamModels({
    trackId,
    model: reconciled.model,
    beforeCoverage,
    affectedRequirementIds: reconciled.affectedRequirementIds,
  });
  return resultView(refreshed.track || track, refreshed.model, refreshed.replan, reconciled.scannedTaskCount, reconciled.changedOutcomeCount);
}

export async function scanExecutionOutcomes(trackId: number): Promise<ExecutionOutcomeRuntimeResult | null> {
  return withTrackLock(trackId, () => scanUnlocked(trackId));
}

export async function processTaskLifecycleTransition(input: {
  before: Task;
  after: Task;
  type: "completed" | "reopened";
}): Promise<ExecutionOutcomeRuntimeResult | null> {
  const trackId = taskTrackId(input.after) || taskTrackId(input.before);
  const blueprintTaskId = blueprintTaskIdFromSourceStepType(input.after.sourceStepType || input.before.sourceStepType);
  if (!trackId || !blueprintTaskId) return null;
  return scanExecutionOutcomes(trackId);
}

export async function confirmExecutionOutcome(input: {
  trackId: number;
  outcomeId: string;
  confirmation: ExecutionOutcomeConfirmationInput;
}): Promise<ExecutionOutcomeRuntimeResult | null> {
  return withTrackLock(input.trackId, async () => {
    const track = await storage.getCareerTrack(input.trackId);
    if (!track) return null;
    const intelligence = parseJsonObject(track.trackIntelligence);
    const beforeCoverage = intelligence.coverageModel?.mode === "coverage_model"
      ? intelligence.coverageModel as CoverageModel
      : null;
    const currentModel = normalizeExecutionOutcomeModel(input.trackId, intelligence.executionOutcomeModel);
    const existing = currentModel.records.find((record) => record.id === input.outcomeId);
    if (!existing) throw new Error("Execution outcome not found");
    const updated = applyExecutionOutcomeConfirmation(existing, input.confirmation);
    const contributionChanged = coverageContributionChanged(existing, updated);
    let model = upsertExecutionOutcome(currentModel, updated);

    if (input.confirmation.resolution === "mistaken") {
      const task = (await storage.getTasks()).find((candidate) => candidate.id === existing.liveTaskId);
      if (task && completed(task)) {
        await storage.updateTask(task.id, {
          done: false,
          status: "not_started",
          pinned: false,
          list: task.list === "today" ? "this_week" : task.list,
        } as any);
      }
    }

    await persistOutcomeModel(input.trackId, model);
    await storage.logActivity({
      eventType: "execution_outcome_confirmed",
      sourceType: "career_track",
      sourceId: input.trackId,
      taskId: existing.liveTaskId,
      metadata: JSON.stringify({
        outcomeId: existing.id,
        resolution: input.confirmation.resolution,
        usableForCoverage: updated.usableForCoverage,
        strength: updated.strength,
      }),
    } as any);

    if (!contributionChanged) {
      const developmentPlan = intelligence.developmentPlanModel as DevelopmentPlanModel | undefined;
      const coverage = beforeCoverage;
      if (developmentPlan?.mode === "development_plan_model" && coverage?.mode === "coverage_model") {
        model = {
          ...model,
          milestoneProgress: buildExecutionMilestoneProgress(developmentPlan, coverage, model.records),
          generatedAt: Date.now(),
        };
        const updatedTrack = await persistOutcomeModel(input.trackId, model) || track;
        return resultView(updatedTrack, model, noReplan(existing.requirementIds), 0, 1);
      }
      return resultView(track, model, noReplan(existing.requirementIds), 0, 1);
    }

    const refreshed = await refreshDownstreamModels({
      trackId: input.trackId,
      model,
      beforeCoverage,
      affectedRequirementIds: existing.requirementIds,
    });
    return resultView(refreshed.track || track, refreshed.model, refreshed.replan, 0, 1);
  });
}

export const executionOutcomeServiceInternals = {
  coverageContributionChanged,
  coverageContributionFingerprint,
  nextRecordForCompletedTask,
  reconcileCompletedTasks,
  recordChanged,
  recordFingerprint,
  taskTrackId,
};
