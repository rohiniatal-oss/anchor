import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { registerTaskLifecycleListener } from "./taskLifecycle";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import { refreshCoverageForRequirements } from "./trackResearchCoverageSelectiveRefresh";
import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import { executionBlueprintSourceFingerprint } from "./trackResearchExecutionBlueprint";
import type { ExecutionBlueprintModel } from "./trackResearchExecutionBlueprint";
import { ensureExecutionBlueprint } from "./trackResearchExecutionService";
import {
  blueprintTaskIdFromSourceStepType,
  type ExecutionPriorityModel,
} from "./trackResearchExecutionPriority";
import { ensureExecutionPriority } from "./trackResearchExecutionPriorityService";
import { materializeExecutionPrioritySlice } from "./trackResearchExecutionMaterialization";
import {
  acceptedOutcomeStrength,
  buildExecutionOutcomeCandidate,
  milestoneProgress,
  parseExecutionFeedbackModel,
  upsertExecutionOutcome,
  type CoverageDeltaItem,
  type ExecutionFeedbackModel,
  type ExecutionFeedbackRun,
  type ExecutionOutcomeRecord,
} from "./trackResearchExecutionOutcome";
import { refineExecutionOutcomeCandidate } from "./trackResearchExecutionOutcomeSynthesis";
import type { RequirementModel } from "./trackResearchRequirementModel";

export type ExecutionOutcomeConfirmation = {
  accepted: boolean;
  answer?: string;
  sourceUrl?: string;
};

export type ExecutionFeedbackResult = {
  trackId: number;
  outcome: ExecutionOutcomeRecord;
  feedbackModel: ExecutionFeedbackModel;
  run: ExecutionFeedbackRun | null;
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

function compact(value: unknown, max = 6000): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function safeUrl(value: unknown): string {
  const raw = compact(value, 900);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function trackIdForTask(task: Task): number | null {
  if (typeof task.relatedTrackId === "number" && Number.isFinite(task.relatedTrackId)) return task.relatedTrackId;
  if (task.sourceType === "career_track" && typeof task.sourceId === "number" && Number.isFinite(task.sourceId)) return task.sourceId;
  return null;
}

function completed(task: Task): boolean {
  return Boolean(task.done) || task.status === "done";
}

function validRequirementModel(value: any): value is RequirementModel {
  return value?.mode === "requirement_model" && Array.isArray(value.requirements);
}

function validCoverageModel(value: any): value is CoverageModel {
  return value?.mode === "coverage_model" && Array.isArray(value.coverage);
}

function coverageRank(status: CoverageStatus): number {
  if (status === "proven") return 4;
  if (status === "partially_proven") return 3;
  if (status === "unknown" || status === "unproven") return 2;
  return 1;
}

function coverageDelta(
  requirementModel: RequirementModel,
  before: CoverageModel,
  after: CoverageModel,
  requirementIds: string[],
): CoverageDeltaItem[] {
  const beforeById = new Map(before.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const afterById = new Map(after.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  return [...new Set(requirementIds)].map((requirementId) => {
    const previous = beforeById.get(requirementId);
    const current = afterById.get(requirementId);
    const beforeStatus = previous?.status || "unknown";
    const afterStatus = current?.status || "unknown";
    const beforeEvidence = new Set(previous?.evidenceItemIds || []);
    return {
      requirementId,
      label: requirementById.get(requirementId)?.label || requirementId,
      beforeStatus,
      afterStatus,
      changed: beforeStatus !== afterStatus || (current?.evidenceItemIds || []).some((id) => !beforeEvidence.has(id)),
      improved: coverageRank(afterStatus) > coverageRank(beforeStatus),
      evidenceAddedIds: (current?.evidenceItemIds || []).filter((id) => !beforeEvidence.has(id)),
    };
  });
}

async function persistFeedbackModel(
  trackId: number,
  updater: (model: ExecutionFeedbackModel, intelligence: Record<string, any>) => ExecutionFeedbackModel,
): Promise<{ track: any; model: ExecutionFeedbackModel } | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const blueprintFingerprint = intelligence.executionBlueprintModel?.sourceFingerprint || "";
  const current = parseExecutionFeedbackModel(intelligence.executionFeedbackModel, trackId, blueprintFingerprint);
  const model = updater(current, intelligence);
  const updatedTrack = await storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      executionFeedbackModel: model,
      executionFeedbackUpdatedAt: model.generatedAt,
      lastUpdated: Date.now(),
    }),
  } as any);
  return { track: updatedTrack || track, model };
}

function limitedPriorityModel(model: ExecutionPriorityModel): ExecutionPriorityModel {
  const openIds = model.candidates
    .filter((candidate) => candidate.selected && candidate.liveState === "open")
    .map((candidate) => candidate.taskId);
  const firstNewId = model.activeSlice.newTaskIds[0] || null;
  const selectedIds = [...new Set([...openIds, ...(firstNewId ? [firstNewId] : [])])];
  const selectedSet = new Set(selectedIds);
  const candidates = model.candidates.map((candidate) => ({
    ...candidate,
    selected: selectedSet.has(candidate.taskId),
    rank: selectedSet.has(candidate.taskId) ? selectedIds.indexOf(candidate.taskId) + 1 : 0,
    slot: candidate.taskId === model.activeSlice.nowTaskId && selectedSet.has(candidate.taskId)
      ? "now" as const
      : candidate.liveState === "open" && selectedSet.has(candidate.taskId)
        ? "active" as const
        : firstNewId === candidate.taskId
          ? candidate.slot
          : candidate.selected
            ? "later" as const
            : candidate.slot,
  }));
  return {
    ...model,
    candidates,
    activeSlice: {
      ...model.activeSlice,
      selectedTaskIds: selectedIds,
      newTaskIds: firstNewId ? [firstNewId] : [],
      existingActiveTaskIds: openIds,
      activeTaskIds: openIds,
      nowTaskId: selectedSet.has(model.activeSlice.nowTaskId || "")
        ? model.activeSlice.nowTaskId
        : firstNewId || openIds[0] || null,
    },
  };
}

async function runAdaptiveFeedback(
  trackId: number,
  outcome: ExecutionOutcomeRecord,
): Promise<ExecutionFeedbackRun | null> {
  const beforeTrack = await storage.getCareerTrack(trackId);
  if (!beforeTrack) return null;
  const beforeIntelligence = parseJsonObject(beforeTrack.trackIntelligence);
  const beforeCoverage = beforeIntelligence.coverageModel as CoverageModel | undefined;
  const beforeDevelopment = beforeIntelligence.developmentPlanModel;
  const beforeBlueprint = beforeIntelligence.executionBlueprintModel as ExecutionBlueprintModel | undefined;
  const beforePriority = beforeIntelligence.executionPriorityModel as ExecutionPriorityModel | undefined;

  let coverageResult = await refreshCoverageForRequirements(trackId, outcome.requirementIds);
  if (!coverageResult) {
    const full = await ensureRequirementCoverage(trackId, true);
    if (!full || "error" in full) return null;
    coverageResult = {
      track: full.track,
      requirementModel: full.requirementModel,
      beforeCoverageModel: validCoverageModel(beforeCoverage) ? beforeCoverage : full.coverageModel,
      coverageModel: full.coverageModel,
      refreshedRequirementIds: outcome.requirementIds,
    };
  }

  const developmentResult = await ensureDevelopmentPlan(trackId, true);
  if (!developmentResult || !("developmentPlanModel" in developmentResult)) return null;
  const executionResult = await ensureExecutionBlueprint(trackId, true);
  if (!executionResult || !("executionBlueprintModel" in executionResult)) return null;
  let priorityResult = await ensureExecutionPriority(trackId, true);
  if (!priorityResult || !("executionPriorityModel" in priorityResult)) return null;

  let materializedLiveTaskIds: number[] = [];
  const warnings: string[] = [];
  if (
    priorityResult.executionBlueprintModel.quality.status !== "provisional"
    && priorityResult.executionPriorityModel.quality.status !== "provisional"
    && priorityResult.priorityContext.trackStatus === "active"
  ) {
    const limited = limitedPriorityModel(priorityResult.executionPriorityModel);
    const materialization = await materializeExecutionPrioritySlice({
      trackId,
      blueprint: priorityResult.executionBlueprintModel,
      priorityModel: limited,
      context: priorityResult.priorityContext,
    });
    materializedLiveTaskIds = materialization.created.map((item) => item.liveTaskId);
    if (materialization.skipped.length) warnings.push(...materialization.skipped.map((item) => item.reason));
    priorityResult = await ensureExecutionPriority(trackId, true) || priorityResult;
  }

  const afterPriority = "executionPriorityModel" in priorityResult
    ? priorityResult.executionPriorityModel
    : beforePriority;
  const changes = coverageDelta(
    coverageResult.requirementModel,
    coverageResult.beforeCoverageModel,
    coverageResult.coverageModel,
    outcome.requirementIds,
  );
  const afterDevelopmentFingerprint = executionBlueprintSourceFingerprint(developmentResult.developmentPlanModel);
  const beforeDevelopmentFingerprint = beforeDevelopment?.mode === "development_plan_model"
    ? executionBlueprintSourceFingerprint(beforeDevelopment)
    : "";
  const run: ExecutionFeedbackRun = {
    id: `execution-feedback-run-${stableHash(`${outcome.id}|${Date.now()}`)}`,
    outcomeId: outcome.id,
    affectedRequirementIds: outcome.requirementIds,
    coverageChanges: changes,
    changedRequirementCount: changes.filter((change) => change.changed).length,
    improvedRequirementCount: changes.filter((change) => change.improved).length,
    developmentPlanChanged: beforeDevelopmentFingerprint !== afterDevelopmentFingerprint,
    executionBlueprintChanged: beforeBlueprint?.sourceFingerprint !== executionResult.executionBlueprintModel.sourceFingerprint,
    executionPriorityChanged: beforePriority?.sourceFingerprint !== afterPriority?.sourceFingerprint,
    materializedLiveTaskIds,
    warnings: [...new Set(warnings)],
    generatedAt: Date.now(),
  };

  await persistFeedbackModel(trackId, (model) => ({
    ...model,
    blueprintFingerprint: executionResult.executionBlueprintModel.sourceFingerprint,
    runs: [...model.runs.filter((item) => item.outcomeId !== outcome.id), run].slice(-24),
    milestones: milestoneProgress(
      developmentResult.developmentPlanModel,
      new Map(coverageResult!.coverageModel.coverage.map((coverage) => [coverage.requirementId, coverage.status])),
      model.outcomes,
    ),
    generatedAt: Date.now(),
  }));
  await storage.logActivity({
    eventType: "execution_feedback_applied",
    sourceType: "career_track",
    sourceId: trackId,
    taskId: outcome.liveTaskId,
    metadata: JSON.stringify({
      outcomeId: outcome.id,
      affectedRequirementIds: outcome.requirementIds,
      changedRequirementCount: run.changedRequirementCount,
      improvedRequirementCount: run.improvedRequirementCount,
      materializedLiveTaskIds,
    }),
  } as any);
  return run;
}

async function captureCompletedTask(taskId: number): Promise<ExecutionFeedbackResult | null> {
  const task = (await storage.getTasks()).find((item) => item.id === taskId);
  if (!task || !completed(task)) return null;
  const trackId = trackIdForTask(task);
  const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
  if (!trackId || !blueprintTaskId) return null;

  const executionResult = await ensureExecutionBlueprint(trackId, false);
  if (!executionResult || !("executionBlueprintModel" in executionResult)) return null;
  const blueprintTask = executionResult.executionBlueprintModel.tasks.find((item) => item.id === blueprintTaskId);
  if (!blueprintTask) {
    await storage.logActivity({
      eventType: "execution_outcome_unmapped",
      sourceType: "career_track",
      sourceId: trackId,
      taskId,
      metadata: JSON.stringify({ blueprintTaskId, reason: "Task belongs to a superseded blueprint without a retained task contract." }),
    } as any);
    return null;
  }

  const existingTrack = await storage.getCareerTrack(trackId);
  const existingIntelligence = parseJsonObject(existingTrack?.trackIntelligence);
  const existingModel = parseExecutionFeedbackModel(
    existingIntelligence.executionFeedbackModel,
    trackId,
    executionResult.executionBlueprintModel.sourceFingerprint,
  );
  const existing = existingModel.outcomes.find((outcome) => outcome.liveTaskId === taskId && outcome.status !== "superseded");
  if (existing) return { trackId, outcome: existing, feedbackModel: existingModel, run: existingModel.runs.find((run) => run.outcomeId === existing.id) || null };

  const candidate = buildExecutionOutcomeCandidate({
    trackId,
    task,
    blueprintTask,
    blueprint: executionResult.executionBlueprintModel,
    requirementModel: executionResult.requirementModel,
  });
  const outcome = await refineExecutionOutcomeCandidate({
    task,
    blueprintTask,
    blueprint: executionResult.executionBlueprintModel,
    requirementModel: executionResult.requirementModel,
    candidate,
  });
  const persisted = await persistFeedbackModel(trackId, (model) => upsertExecutionOutcome(model, outcome));
  if (!persisted) return null;
  await storage.logActivity({
    eventType: outcome.status === "accepted" ? "execution_outcome_captured" : "execution_outcome_confirmation_needed",
    sourceType: "career_track",
    sourceId: trackId,
    taskId,
    metadata: JSON.stringify({ outcomeId: outcome.id, requirementIds: outcome.requirementIds, status: outcome.status }),
  } as any);
  const run = outcome.status === "accepted" ? await runAdaptiveFeedback(trackId, outcome) : null;
  const latest = await storage.getCareerTrack(trackId);
  const latestIntelligence = parseJsonObject(latest?.trackIntelligence);
  const feedbackModel = parseExecutionFeedbackModel(
    latestIntelligence.executionFeedbackModel,
    trackId,
    latestIntelligence.executionBlueprintModel?.sourceFingerprint || outcome.blueprintFingerprint,
  );
  return { trackId, outcome: feedbackModel.outcomes.find((item) => item.id === outcome.id) || outcome, feedbackModel, run };
}

async function supersedeTaskOutcome(taskId: number): Promise<ExecutionFeedbackResult | null> {
  const task = (await storage.getTasks()).find((item) => item.id === taskId);
  if (!task) return null;
  const trackId = trackIdForTask(task);
  if (!trackId) return null;
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const model = parseExecutionFeedbackModel(
    intelligence.executionFeedbackModel,
    trackId,
    intelligence.executionBlueprintModel?.sourceFingerprint || "",
  );
  const existing = model.outcomes.find((outcome) => outcome.liveTaskId === taskId && !["superseded", "rejected"].includes(outcome.status));
  if (!existing) return null;
  const wasUsable = existing.usableForCoverage;
  const outcome: ExecutionOutcomeRecord = {
    ...existing,
    status: "superseded",
    usableForCoverage: false,
    strength: "planned",
    updatedAt: Date.now(),
    acceptedAt: null,
  };
  const persisted = await persistFeedbackModel(trackId, (current) => upsertExecutionOutcome(current, outcome));
  const run = wasUsable ? await runAdaptiveFeedback(trackId, outcome) : null;
  return persisted ? { trackId, outcome, feedbackModel: persisted.model, run } : null;
}

export async function confirmExecutionOutcome(
  trackId: number,
  outcomeId: string,
  input: ExecutionOutcomeConfirmation,
): Promise<ExecutionFeedbackResult | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const model = parseExecutionFeedbackModel(
    intelligence.executionFeedbackModel,
    trackId,
    intelligence.executionBlueprintModel?.sourceFingerprint || "",
  );
  const existing = model.outcomes.find((outcome) => outcome.id === outcomeId);
  if (!existing) return null;
  const answer = compact(input.answer, 3000);
  const sourceUrl = safeUrl(input.sourceUrl) || existing.sourceUrl;
  if (input.accepted && existing.confirmationRequired && !answer && !sourceUrl) {
    throw new Error("Add one factual outcome or evidence link before confirming this result.");
  }
  const wasUsable = existing.usableForCoverage;
  const now = Date.now();
  const outcome: ExecutionOutcomeRecord = input.accepted
    ? {
      ...existing,
      status: "accepted",
      summary: existing.summary,
      detail: compact(`${existing.detail}${answer ? ` Confirmed outcome: ${answer}.` : ""}`, 7000),
      sourceUrl,
      strength: acceptedOutcomeStrength(existing, answer, sourceUrl),
      usableForCoverage: true,
      confirmationRequired: false,
      confirmationQuestion: "",
      confirmationAnswer: answer,
      updatedAt: now,
      acceptedAt: now,
    }
    : {
      ...existing,
      status: "rejected",
      usableForCoverage: false,
      strength: "planned",
      confirmationRequired: false,
      confirmationQuestion: "",
      confirmationAnswer: answer || "User confirmed that task completion did not create reusable evidence.",
      updatedAt: now,
      acceptedAt: null,
    };
  const persisted = await persistFeedbackModel(trackId, (current) => upsertExecutionOutcome(current, outcome));
  if (!persisted) return null;
  const run = outcome.usableForCoverage || wasUsable ? await runAdaptiveFeedback(trackId, outcome) : null;
  const latest = await storage.getCareerTrack(trackId);
  const latestIntelligence = parseJsonObject(latest?.trackIntelligence);
  const feedbackModel = parseExecutionFeedbackModel(
    latestIntelligence.executionFeedbackModel,
    trackId,
    latestIntelligence.executionBlueprintModel?.sourceFingerprint || outcome.blueprintFingerprint,
  );
  return { trackId, outcome, feedbackModel, run };
}

const taskInFlight = new Map<number, Promise<ExecutionFeedbackResult | null>>();

export function queueExecutionTaskFeedback(taskId: number, type: "completed" | "reopened"): Promise<ExecutionFeedbackResult | null> {
  const active = taskInFlight.get(taskId);
  if (active) return active;
  const promise = type === "completed" ? captureCompletedTask(taskId) : supersedeTaskOutcome(taskId);
  taskInFlight.set(taskId, promise);
  promise.finally(() => {
    if (taskInFlight.get(taskId) === promise) taskInFlight.delete(taskId);
  });
  return promise;
}

let lifecycleRegistered = false;

export function registerExecutionFeedbackLifecycle(): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  registerTaskLifecycleListener((event) => {
    const blueprintTaskId = blueprintTaskIdFromSourceStepType(event.after.sourceStepType || event.before.sourceStepType);
    if (!blueprintTaskId) return;
    void queueExecutionTaskFeedback(event.after.id, event.type);
  });
}

export async function getExecutionFeedbackModel(trackId: number): Promise<ExecutionFeedbackModel | null> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  return parseExecutionFeedbackModel(
    intelligence.executionFeedbackModel,
    trackId,
    intelligence.executionBlueprintModel?.sourceFingerprint || "",
  );
}

export const executionFeedbackServiceInternals = {
  completed,
  coverageDelta,
  limitedPriorityModel,
  trackIdForTask,
};
