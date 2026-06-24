import type { Task } from "@shared/schema";
import { storage } from "./storage";
import type { CoverageModel, CoverageStatus, RequirementCoverage } from "./trackResearchCoverageModel";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import { ensureExecutionBlueprint } from "./trackResearchExecutionService";
import {
  blueprintTaskIdFromSourceStepType,
} from "./trackResearchExecutionPriority";
import { ensureExecutionPriority } from "./trackResearchExecutionPriorityService";
import type { RequirementModel } from "./trackResearchRequirementModel";
import {
  buildExecutionOutcomeRecord,
  normalizeExecutionOutcomeModel,
  reopenExecutionOutcome,
  upsertExecutionOutcome,
  type ExecutionCoverageDelta,
  type ExecutionMilestoneProgress,
  type ExecutionOutcomeModel,
  type ExecutionOutcomeRecord,
} from "./trackResearchExecutionOutcome";
import {
  registerTaskLifecycleListener,
  type TaskLifecycleEvent,
} from "./taskLifecycle";

export type ExecutionOutcomeConfirmationDecision = "direct" | "supporting" | "none" | "mistaken";

export type ExecutionOutcomeConfirmationInput = {
  decision: ExecutionOutcomeConfirmationDecision;
  answer: string;
  sourceUrl: string;
};

export type ExecutionOutcomeSnapshot = {
  track: any;
  targetLabel: string;
  executionOutcomeModel: ExecutionOutcomeModel;
  replanning: boolean;
  coverageQuality: CoverageModel["quality"] | null;
};

function compact(value: unknown, max = 8_000): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function safeExternalUrl(value: unknown): string {
  const raw = compact(value, 2_000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
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

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = compact(raw, 1_000);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function executionTrackId(task: Task): number | null {
  if (task.sourceType === "career_track" && Number.isFinite(Number(task.sourceId))) {
    return Number(task.sourceId);
  }
  if (Number.isFinite(Number(task.relatedTrackId))) return Number(task.relatedTrackId);
  return null;
}

function executionBlueprintTaskId(task: Task): string | null {
  return blueprintTaskIdFromSourceStepType(task.sourceStepType);
}

export function isExecutionBlueprintTask(task: Task): boolean {
  return Boolean(executionTrackId(task) && executionBlueprintTaskId(task));
}

function outcomeModelFromTrack(trackId: number, track: any): ExecutionOutcomeModel {
  const intelligence = parseJsonObject(track?.trackIntelligence);
  return normalizeExecutionOutcomeModel(trackId, intelligence.executionOutcomeModel);
}

function coverageItemById(model: CoverageModel | null | undefined): Map<string, RequirementCoverage> {
  return new Map((model?.coverage || []).map((item) => [item.requirementId, item]));
}

function coverageState(item: RequirementCoverage | undefined): {
  status: CoverageStatus;
  confidence: "high" | "medium" | "low";
} {
  return {
    status: item?.status || "unknown",
    confidence: item?.confidence || "low",
  };
}

function deltaExplanation(
  before: ReturnType<typeof coverageState>,
  after: ReturnType<typeof coverageState>,
): string {
  if (before.status === after.status && before.confidence === after.confidence) {
    return "The new outcome was retained as evidence, but it did not yet change the requirement-level coverage judgement.";
  }
  if (after.status === "proven") return "The requirement now meets the current success bar with accepted evidence.";
  if (after.status === "partially_proven") return "The evidence position improved, but the full success bar is not yet demonstrated.";
  if (after.status === "below_bar") return "The evidence is relevant, but it still falls below the target success bar.";
  if (after.status === "unproven") return "Anchor reviewed the evidence and still cannot verify the requirement at the target standard.";
  return "Anchor still lacks enough relevant evidence to assess this requirement fairly.";
}

export function buildExecutionCoverageDelta(
  requirementModel: RequirementModel,
  beforeCoverage: CoverageModel | null | undefined,
  afterCoverage: CoverageModel | null | undefined,
  requirementIds: string[],
): ExecutionCoverageDelta[] {
  const beforeById = coverageItemById(beforeCoverage);
  const afterById = coverageItemById(afterCoverage);
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  return [...new Set(requirementIds)].map((requirementId) => {
    const before = coverageState(beforeById.get(requirementId));
    const after = coverageState(afterById.get(requirementId));
    return {
      requirementId,
      label: requirementById.get(requirementId)?.label || requirementId,
      beforeStatus: before.status,
      afterStatus: after.status,
      beforeConfidence: before.confidence,
      afterConfidence: after.confidence,
      changed: before.status !== after.status || before.confidence !== after.confidence,
      explanation: deltaExplanation(before, after),
    };
  });
}

function outcomeMatchesMilestone(
  record: ExecutionOutcomeRecord,
  milestoneId: string,
  workstreamId: string,
  requirementIds: string[],
): boolean {
  if (record.milestoneIds.includes(milestoneId)) return true;
  if (record.workstreamId !== workstreamId) return false;
  return record.requirementIds.some((requirementId) => requirementIds.includes(requirementId));
}

export function buildExecutionMilestoneProgress(
  blueprint: ExecutionBlueprintModel,
  coverageModel: CoverageModel | null | undefined,
  records: ExecutionOutcomeRecord[],
): ExecutionMilestoneProgress[] {
  const coverageById = coverageItemById(coverageModel);
  const now = Date.now();
  const workstreamById = new Map(blueprint.workstreams.map((workstream) => [workstream.workstreamId, workstream]));
  const blueprintTaskById = new Map(blueprint.tasks.map((task) => [task.id, task]));
  const milestoneDetails = new Map<string, {
    workstreamId: string;
    label: string;
    doneWhen: string;
    requirementIds: string[];
  }>();

  for (const workstream of blueprint.workstreams) {
    for (const milestoneId of workstream.milestoneIds) {
      const linkedTasks = workstream.taskIds
        .map((taskId) => blueprintTaskById.get(taskId))
        .filter((task): task is TaskBlueprint => Boolean(task && task.milestoneIds.includes(milestoneId)));
      milestoneDetails.set(milestoneId, {
        workstreamId: workstream.workstreamId,
        label: linkedTasks[linkedTasks.length - 1]?.title || "Milestone evidence completed",
        doneWhen: linkedTasks[linkedTasks.length - 1]?.doneWhen || workstream.objective,
        requirementIds: [...new Set(linkedTasks.flatMap((task) => task.requirementIds))],
      });
    }
  }

  return [...milestoneDetails.entries()].map(([milestoneId, detail]) => {
    const matchingRecords = records.filter((record) => outcomeMatchesMilestone(
      record,
      milestoneId,
      detail.workstreamId,
      detail.requirementIds,
    ));
    const accepted = matchingRecords.filter((record) => record.status === "accepted" && record.usableForCoverage);
    const pending = matchingRecords.filter((record) => record.status === "pending_confirmation");
    const provenRequirementCount = detail.requirementIds.filter((requirementId) => coverageById.get(requirementId)?.status === "proven").length;
    const achieved = detail.requirementIds.length > 0 && provenRequirementCount === detail.requirementIds.length;
    const status: ExecutionMilestoneProgress["status"] = achieved
      ? "achieved"
      : pending.length
        ? "pending_confirmation"
        : accepted.length || provenRequirementCount > 0
          ? "in_progress"
          : "not_started";
    const reason = achieved
      ? "Every linked requirement is now proven against its success bar."
      : pending.length
        ? `${pending.length} completed outcome${pending.length === 1 ? " needs" : "s need"} one focused confirmation before milestone progress can be assessed.`
        : accepted.length
          ? "Accepted evidence exists, but one or more linked requirements still need stronger proof."
          : "No accepted outcome yet demonstrates progress against this milestone.";
    return {
      milestoneId,
      workstreamId: detail.workstreamId,
      label: detail.label,
      requirementIds: detail.requirementIds,
      status,
      provenRequirementCount,
      totalRequirementCount: detail.requirementIds.length,
      outcomeIds: matchingRecords.map((record) => record.id),
      doneWhen: detail.doneWhen,
      reason,
      updatedAt: now,
    };
  }).sort((left, right) => {
    const leftWorkstream = workstreamById.get(left.workstreamId)?.title || left.workstreamId;
    const rightWorkstream = workstreamById.get(right.workstreamId)?.title || right.workstreamId;
    return leftWorkstream.localeCompare(rightWorkstream) || left.label.localeCompare(right.label);
  });
}

export function applyExecutionOutcomeConfirmation(
  record: ExecutionOutcomeRecord,
  input: ExecutionOutcomeConfirmationInput,
): ExecutionOutcomeRecord {
  const now = Date.now();
  const answer = compact(input.answer, 4_000);
  const sourceUrl = safeExternalUrl(input.sourceUrl) || record.sourceUrl;
  const confirmation = {
    ...record.confirmation,
    required: false,
    answer,
    answeredAt: now,
  };
  const confirmedDetail = compact([
    record.detail,
    answer ? `Confirmed outcome: ${answer}.` : "",
  ].filter(Boolean).join(" "));

  if (input.decision === "mistaken") {
    return {
      ...record,
      status: "reopened",
      usableForCoverage: false,
      strength: "planned",
      detail: confirmedDetail,
      sourceUrl,
      inference: {
        confidence: "high",
        basis: "user_confirmation",
        reason: "The user confirmed that the task was marked complete by mistake, so the outcome has been withdrawn from coverage.",
      },
      confirmation,
      updatedAt: now,
    };
  }
  if (input.decision === "none") {
    return {
      ...record,
      status: "insufficient",
      usableForCoverage: false,
      strength: "supporting",
      detail: confirmedDetail,
      sourceUrl,
      inference: {
        confidence: "high",
        basis: "user_confirmation",
        reason: "The user confirmed that the completed activity did not yet create the evidence or external signal required for coverage.",
      },
      confirmation,
      updatedAt: now,
    };
  }
  const direct = input.decision === "direct";
  return {
    ...record,
    status: "accepted",
    usableForCoverage: true,
    strength: direct ? (sourceUrl ? "verified" : "direct") : "supporting",
    detail: confirmedDetail,
    sourceUrl,
    inference: {
      confidence: direct ? "high" : "medium",
      basis: "user_confirmation",
      reason: direct
        ? "The user confirmed a concrete output, result or external signal that can be assessed against the linked requirements."
        : "The user confirmed a relevant partial result that supports coverage but does not by itself prove the full success bar.",
    },
    confirmation,
    updatedAt: now,
  };
}

async function persistOutcomeModel(trackId: number, model: ExecutionOutcomeModel): Promise<any | null> {
  const latestTrack = await storage.getCareerTrack(trackId);
  if (!latestTrack) return null;
  const intelligence = parseJsonObject(latestTrack.trackIntelligence);
  return storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      executionOutcomeModel: {
        ...model,
        pendingConfirmationIds: model.records
          .filter((record) => record.status === "pending_confirmation")
          .map((record) => record.id),
        generatedAt: Date.now(),
      },
      executionOutcomeUpdatedAt: Date.now(),
      lastUpdated: Date.now(),
    }),
  } as any);
}

async function currentExecutionContext(trackId: number) {
  const result = await ensureExecutionBlueprint(trackId, false);
  if (!result || !("executionBlueprintModel" in result)) return null;
  return result;
}

const replanInFlight = new Map<number, Promise<ExecutionOutcomeSnapshot | null>>();

async function performAdaptiveReplan(
  trackId: number,
  beforeCoverage: CoverageModel | null | undefined,
  affectedRequirementIds: string[],
): Promise<ExecutionOutcomeSnapshot | null> {
  const coverageResult = await ensureRequirementCoverage(trackId, true);
  if (!coverageResult || "error" in coverageResult) return null;
  const developmentResult = await ensureDevelopmentPlan(trackId, true);
  if (!developmentResult || "error" in developmentResult) return null;
  const blueprintResult = await ensureExecutionBlueprint(trackId, true);
  if (!blueprintResult || !("executionBlueprintModel" in blueprintResult)) return null;
  await ensureExecutionPriority(trackId, true);

  const latestTrack = await storage.getCareerTrack(trackId) || blueprintResult.track;
  const intelligence = parseJsonObject(latestTrack.trackIntelligence);
  const currentModel = normalizeExecutionOutcomeModel(trackId, intelligence.executionOutcomeModel);
  const nextModel: ExecutionOutcomeModel = {
    ...currentModel,
    latestCoverageDelta: buildExecutionCoverageDelta(
      blueprintResult.requirementModel,
      beforeCoverage,
      coverageResult.coverageModel,
      affectedRequirementIds,
    ),
    milestoneProgress: buildExecutionMilestoneProgress(
      blueprintResult.executionBlueprintModel,
      coverageResult.coverageModel,
      currentModel.records,
    ),
    generatedAt: Date.now(),
  };
  const updatedTrack = await persistOutcomeModel(trackId, nextModel) || latestTrack;
  await storage.logActivity({
    eventType: "execution_evidence_replanned",
    sourceType: "career_track",
    sourceId: trackId,
    metadata: JSON.stringify({
      affectedRequirementIds,
      changedRequirementIds: nextModel.latestCoverageDelta
        .filter((delta) => delta.changed)
        .map((delta) => delta.requirementId),
      pendingConfirmationIds: nextModel.pendingConfirmationIds,
    }),
  } as any);
  return {
    track: updatedTrack,
    targetLabel: blueprintResult.executionBlueprintModel.targetLabel,
    executionOutcomeModel: nextModel,
    replanning: false,
    coverageQuality: coverageResult.coverageModel.quality,
  };
}

export function scheduleAdaptiveExecutionReplan(
  trackId: number,
  beforeCoverage: CoverageModel | null | undefined,
  affectedRequirementIds: string[],
): Promise<ExecutionOutcomeSnapshot | null> {
  const active = replanInFlight.get(trackId);
  if (active) return active;
  const promise = performAdaptiveReplan(trackId, beforeCoverage, affectedRequirementIds)
    .catch((error) => {
      console.error("Adaptive execution replan failed:", error);
      return null;
    });
  replanInFlight.set(trackId, promise);
  void promise.finally(() => {
    if (replanInFlight.get(trackId) === promise) replanInFlight.delete(trackId);
  });
  return promise;
}

async function createOutcomeForCompletedTask(event: TaskLifecycleEvent): Promise<ExecutionOutcomeSnapshot | null> {
  const trackId = executionTrackId(event.after);
  const blueprintTaskId = executionBlueprintTaskId(event.after);
  if (!trackId || !blueprintTaskId) return null;
  const execution = await currentExecutionContext(trackId);
  if (!execution) return null;
  const blueprintTask = execution.executionBlueprintModel.tasks.find((task) => task.id === blueprintTaskId);
  if (!blueprintTask) {
    await storage.logActivity({
      eventType: "execution_outcome_unmatched",
      sourceType: "career_track",
      sourceId: trackId,
      taskId: event.after.id,
      metadata: JSON.stringify({ blueprintTaskId, reason: "Blueprint task no longer exists in the current model." }),
    } as any);
    return null;
  }

  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  let model = outcomeModelFromTrack(trackId, track);
  const existing = model.records.find((record) => record.liveTaskId === event.after.id) || null;
  if (existing && existing.status !== "reopened") {
    return {
      track,
      targetLabel: execution.executionBlueprintModel.targetLabel,
      executionOutcomeModel: model,
      replanning: replanInFlight.has(trackId),
      coverageQuality: execution.coverageModel.quality,
    };
  }
  const record = buildExecutionOutcomeRecord({
    trackId,
    task: event.after,
    blueprint: execution.executionBlueprintModel,
    blueprintTask,
    existing,
  });
  model = upsertExecutionOutcome(model, record);
  model = {
    ...model,
    milestoneProgress: buildExecutionMilestoneProgress(
      execution.executionBlueprintModel,
      execution.coverageModel,
      model.records,
    ),
  };
  const updatedTrack = await persistOutcomeModel(trackId, model) || track;
  await storage.logActivity({
    eventType: "execution_outcome_captured",
    sourceType: "career_track",
    sourceId: trackId,
    taskId: event.after.id,
    metadata: JSON.stringify({
      outcomeId: record.id,
      blueprintTaskId,
      status: record.status,
      usableForCoverage: record.usableForCoverage,
      requirementIds: record.requirementIds,
    }),
  } as any);
  if (record.usableForCoverage) {
    void scheduleAdaptiveExecutionReplan(trackId, execution.coverageModel, record.requirementIds);
  }
  return {
    track: updatedTrack,
    targetLabel: execution.executionBlueprintModel.targetLabel,
    executionOutcomeModel: model,
    replanning: replanInFlight.has(trackId),
    coverageQuality: execution.coverageModel.quality,
  };
}

async function reopenOutcomeForTask(event: TaskLifecycleEvent): Promise<ExecutionOutcomeSnapshot | null> {
  const trackId = executionTrackId(event.after);
  if (!trackId) return null;
  const execution = await currentExecutionContext(trackId);
  if (!execution) return null;
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const currentModel = outcomeModelFromTrack(trackId, track);
  const previous = currentModel.records.find((record) => record.liveTaskId === event.after.id);
  if (!previous || previous.status === "reopened") {
    return {
      track,
      targetLabel: execution.executionBlueprintModel.targetLabel,
      executionOutcomeModel: currentModel,
      replanning: replanInFlight.has(trackId),
      coverageQuality: execution.coverageModel.quality,
    };
  }
  const model = reopenExecutionOutcome(currentModel, event.after.id);
  const updatedTrack = await persistOutcomeModel(trackId, model) || track;
  await storage.logActivity({
    eventType: "execution_outcome_reopened",
    sourceType: "career_track",
    sourceId: trackId,
    taskId: event.after.id,
    metadata: JSON.stringify({ outcomeId: previous.id, requirementIds: previous.requirementIds }),
  } as any);
  if (previous.usableForCoverage) {
    void scheduleAdaptiveExecutionReplan(trackId, execution.coverageModel, previous.requirementIds);
  }
  return {
    track: updatedTrack,
    targetLabel: execution.executionBlueprintModel.targetLabel,
    executionOutcomeModel: model,
    replanning: replanInFlight.has(trackId),
    coverageQuality: execution.coverageModel.quality,
  };
}

const trackMutationQueues = new Map<number, Promise<unknown>>();

function runSerializedForTrack<T>(trackId: number, operation: () => Promise<T>): Promise<T> {
  const previous = trackMutationQueues.get(trackId) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(operation);
  trackMutationQueues.set(trackId, current);
  void current.finally(() => {
    if (trackMutationQueues.get(trackId) === current) trackMutationQueues.delete(trackId);
  });
  return current;
}

export function handleExecutionTaskLifecycleEvent(event: TaskLifecycleEvent): Promise<ExecutionOutcomeSnapshot | null> {
  const task = event.after;
  const trackId = executionTrackId(task);
  if (!trackId || !executionBlueprintTaskId(task)) return Promise.resolve(null);
  return runSerializedForTrack(trackId, () => event.type === "completed"
    ? createOutcomeForCompletedTask(event)
    : reopenOutcomeForTask(event));
}

let runtimeRegistered = false;

export function registerExecutionOutcomeRuntime(): void {
  if (runtimeRegistered) return;
  runtimeRegistered = true;
  registerTaskLifecycleListener((event) => {
    if (!isExecutionBlueprintTask(event.after)) return;
    void handleExecutionTaskLifecycleEvent(event).catch((error) => {
      console.error("Execution outcome processing failed:", error);
    });
  });
}

async function reconcileExecutionTasksInternal(trackId: number): Promise<ExecutionOutcomeSnapshot | null> {
  const execution = await currentExecutionContext(trackId);
  if (!execution) return null;
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  let model = outcomeModelFromTrack(trackId, track);
  const tasks = (await storage.getTasks()).filter((task) => executionTrackId(task) === trackId && executionBlueprintTaskId(task));
  const blueprintById = new Map(execution.executionBlueprintModel.tasks.map((task) => [task.id, task]));
  const beforeCoverage = execution.coverageModel;
  const affected = new Set<string>();
  let changed = false;

  for (const task of tasks) {
    const blueprintTaskId = executionBlueprintTaskId(task)!;
    const blueprintTask = blueprintById.get(blueprintTaskId);
    if (!blueprintTask) continue;
    const existing = model.records.find((record) => record.liveTaskId === task.id) || null;
    const completed = task.done || task.status === "done";
    if (completed && (!existing || existing.status === "reopened")) {
      const record = buildExecutionOutcomeRecord({
        trackId,
        task,
        blueprint: execution.executionBlueprintModel,
        blueprintTask,
        existing,
      });
      model = upsertExecutionOutcome(model, record);
      if (record.usableForCoverage) record.requirementIds.forEach((id) => affected.add(id));
      changed = true;
    } else if (!completed && existing && existing.status !== "reopened") {
      if (existing.usableForCoverage) existing.requirementIds.forEach((id) => affected.add(id));
      model = reopenExecutionOutcome(model, task.id);
      changed = true;
    }
  }

  model = {
    ...model,
    milestoneProgress: buildExecutionMilestoneProgress(
      execution.executionBlueprintModel,
      execution.coverageModel,
      model.records,
    ),
  };
  const updatedTrack = changed ? await persistOutcomeModel(trackId, model) || track : track;
  if (affected.size) {
    void scheduleAdaptiveExecutionReplan(trackId, beforeCoverage, [...affected]);
  }
  return {
    track: updatedTrack,
    targetLabel: execution.executionBlueprintModel.targetLabel,
    executionOutcomeModel: model,
    replanning: replanInFlight.has(trackId),
    coverageQuality: execution.coverageModel.quality,
  };
}

export function ensureExecutionOutcomeSnapshot(trackId: number): Promise<ExecutionOutcomeSnapshot | null> {
  return runSerializedForTrack(trackId, () => reconcileExecutionTasksInternal(trackId));
}

export function confirmExecutionOutcome(input: {
  trackId: number;
  outcomeId: string;
  confirmation: ExecutionOutcomeConfirmationInput;
}): Promise<ExecutionOutcomeSnapshot | null> {
  return runSerializedForTrack(input.trackId, async () => {
    const execution = await currentExecutionContext(input.trackId);
    if (!execution) return null;
    const track = await storage.getCareerTrack(input.trackId);
    if (!track) return null;
    let model = outcomeModelFromTrack(input.trackId, track);
    const existing = model.records.find((record) => record.id === input.outcomeId);
    if (!existing) return null;
    const beforeCoverage = execution.coverageModel;
    const wasUsable = existing.usableForCoverage;
    const record = applyExecutionOutcomeConfirmation(existing, input.confirmation);
    model = upsertExecutionOutcome(model, record);

    if (input.confirmation.decision === "mistaken") {
      const liveTask = (await storage.getTasks()).find((task) => task.id === existing.liveTaskId);
      if (liveTask && (liveTask.done || liveTask.status === "done")) {
        await storage.updateTask(liveTask.id, {
          done: false,
          status: "not_started",
          pinned: false,
          list: liveTask.list === "today" ? "this_week" : liveTask.list,
        } as any);
      }
    } else if (record.sourceUrl) {
      await storage.updateTask(record.liveTaskId, { sourceUrl: record.sourceUrl } as any).catch(() => undefined);
    }

    await persistOutcomeModel(input.trackId, model);
    await storage.logActivity({
      eventType: "execution_outcome_confirmed",
      sourceType: "career_track",
      sourceId: input.trackId,
      taskId: record.liveTaskId,
      metadata: JSON.stringify({
        outcomeId: record.id,
        decision: input.confirmation.decision,
        usableForCoverage: record.usableForCoverage,
        strength: record.strength,
        requirementIds: record.requirementIds,
      }),
    } as any);

    const coverageChanged = wasUsable !== record.usableForCoverage
      || (record.usableForCoverage && (existing.strength !== record.strength || existing.detail !== record.detail || existing.sourceUrl !== record.sourceUrl));
    if (coverageChanged) {
      const replanned = await scheduleAdaptiveExecutionReplan(
        input.trackId,
        beforeCoverage,
        record.requirementIds,
      );
      if (replanned) return replanned;
    }

    const latestTrack = await storage.getCareerTrack(input.trackId) || track;
    const latestIntelligence = parseJsonObject(latestTrack.trackIntelligence);
    model = normalizeExecutionOutcomeModel(input.trackId, latestIntelligence.executionOutcomeModel);
    model = {
      ...model,
      milestoneProgress: buildExecutionMilestoneProgress(
        execution.executionBlueprintModel,
        execution.coverageModel,
        model.records,
      ),
    };
    const updatedTrack = await persistOutcomeModel(input.trackId, model) || latestTrack;
    return {
      track: updatedTrack,
      targetLabel: execution.executionBlueprintModel.targetLabel,
      executionOutcomeModel: model,
      replanning: replanInFlight.has(input.trackId),
      coverageQuality: execution.coverageModel.quality,
    };
  });
}

export async function forceRefreshExecutionOutcomes(trackId: number): Promise<ExecutionOutcomeSnapshot | null> {
  const snapshot = await ensureExecutionOutcomeSnapshot(trackId);
  if (!snapshot) return null;
  const affected = uniqueStrings(snapshot.executionOutcomeModel.records
    .filter((record) => record.usableForCoverage || record.status === "reopened")
    .flatMap((record) => record.requirementIds));
  if (!affected.length) return snapshot;
  const intelligence = parseJsonObject(snapshot.track.trackIntelligence);
  const beforeCoverage = intelligence.coverageModel as CoverageModel | undefined;
  return await scheduleAdaptiveExecutionReplan(trackId, beforeCoverage, affected) || snapshot;
}

export const executionOutcomeServiceInternals = {
  executionBlueprintTaskId,
  executionTrackId,
  safeExternalUrl,
};
