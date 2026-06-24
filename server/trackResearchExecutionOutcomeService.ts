import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { ensureRequirementCoverage } from "./trackResearchCoverageRoutes";
import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import { ensureDevelopmentPlan } from "./trackResearchDevelopmentRoutes";
import { ensureExecutionBlueprint } from "./trackResearchExecutionService";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import {
  ensureExecutionPriority,
  materializePrioritizedExecutionSlice,
} from "./trackResearchExecutionPriorityService";
import { blueprintTaskIdFromSourceStepType } from "./trackResearchExecutionPriority";
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
import type { UserEvidenceStrength } from "./trackResearchCoverageEvidence";

export type ExecutionOutcomeConfirmationInput = {
  resolution: "accept" | "supporting" | "no_evidence" | "reopen";
  answer?: string;
  sourceUrl?: string;
};

export type ExecutionOutcomeRefreshResult = {
  trackId: number;
  executionOutcomeModel: ExecutionOutcomeModel;
  requirementModel: RequirementModel | null;
  coverageModel: CoverageModel | null;
  executionBlueprintModel: ExecutionBlueprintModel | null;
  advancedTaskIds: number[];
  refreshedCoverage: boolean;
  refreshedPlan: boolean;
  refreshedPriority: boolean;
};

function compact(value: unknown, max = 5000): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalize(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeExternalUrl(value: unknown): string {
  const raw = compact(value, 1200);
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

function taskCompleted(task: Pick<Task, "done" | "status">): boolean {
  return Boolean(task.done) || task.status === "done";
}

export function executionTaskTrackId(task: Pick<Task, "relatedTrackId" | "sourceType" | "sourceId" | "sourceStepType">): number | null {
  if (!blueprintTaskIdFromSourceStepType(task.sourceStepType)) return null;
  const candidate = task.relatedTrackId ?? (task.sourceType === "career_track" ? task.sourceId : null);
  const trackId = Number(candidate);
  return Number.isFinite(trackId) && trackId > 0 ? trackId : null;
}

function outcomeRecordChanged(
  existing: ExecutionOutcomeRecord | undefined,
  task: Task,
  blueprint: ExecutionBlueprintModel,
  blueprintTask: TaskBlueprint,
): boolean {
  if (!existing) return true;
  if (existing.status === "reopened") return true;
  if (existing.blueprintFingerprint !== blueprint.sourceFingerprint) return true;
  if (existing.sourceUrl !== safeExternalUrl(task.sourceUrl)) return true;
  const stepIds = (() => {
    try {
      const steps = JSON.parse(task.steps || "[]");
      return Array.isArray(steps)
        ? steps.filter((step) => step?.done && step?.blueprintSubtaskId).map((step) => String(step.blueprintSubtaskId)).sort()
        : [];
    } catch {
      return [];
    }
  })();
  if (JSON.stringify([...existing.completedSubtaskIds].sort()) !== JSON.stringify(stepIds)) return true;
  return existing.blueprintTaskId !== blueprintTask.id;
}

function statusLabel(value: CoverageStatus): string {
  if (value === "partially_proven") return "partly evidenced";
  if (value === "below_bar") return "below the target bar";
  if (value === "unproven") return "not yet evidenced";
  return value;
}

export function buildExecutionCoverageDelta(
  before: CoverageModel | null | undefined,
  after: CoverageModel | null | undefined,
  requirementModel: RequirementModel | null | undefined,
  affectedRequirementIds: string[],
): ExecutionCoverageDelta[] {
  if (!after || !requirementModel) return [];
  const affected = new Set(affectedRequirementIds);
  const beforeById = new Map((before?.coverage || []).map((item) => [item.requirementId, item]));
  const afterById = new Map(after.coverage.map((item) => [item.requirementId, item]));
  return requirementModel.requirements
    .filter((requirement) => affected.has(requirement.id))
    .map((requirement) => {
      const prior = beforeById.get(requirement.id);
      const current = afterById.get(requirement.id);
      const beforeStatus = prior?.status || "unknown";
      const afterStatus = current?.status || "unknown";
      const beforeConfidence = prior?.confidence || "low";
      const afterConfidence = current?.confidence || "low";
      const changed = beforeStatus !== afterStatus || beforeConfidence !== afterConfidence;
      return {
        requirementId: requirement.id,
        label: requirement.label,
        beforeStatus,
        afterStatus,
        beforeConfidence,
        afterConfidence,
        changed,
        explanation: changed
          ? `${requirement.label} moved from ${statusLabel(beforeStatus)} to ${statusLabel(afterStatus)} after the new outcome evidence was assessed.`
          : `The new outcome is now recorded against ${requirement.label}, while current coverage remains ${statusLabel(afterStatus)}.`,
      };
    });
}

export function buildExecutionMilestoneProgress(
  blueprint: ExecutionBlueprintModel | null | undefined,
  coverage: CoverageModel | null | undefined,
  model: ExecutionOutcomeModel,
): ExecutionMilestoneProgress[] {
  if (!blueprint) return [];
  const coverageById = new Map((coverage?.coverage || []).map((item) => [item.requirementId, item]));
  const milestones = blueprint.workstreams.flatMap((workstream) => {
    const workstreamTasks = blueprint.tasks.filter((task) => task.workstreamId === workstream.workstreamId);
    return workstream.milestoneIds.map((milestoneId) => {
      const milestoneTasks = workstreamTasks.filter((task) => task.milestoneIds.includes(milestoneId));
      const requirementIds = [...new Set(milestoneTasks.flatMap((task) => task.requirementIds))];
      const linkedRecords = model.records.filter((record) =>
        record.milestoneIds.includes(milestoneId)
        || record.requirementIds.some((id) => requirementIds.includes(id)),
      );
      const acceptedRecords = linkedRecords.filter((record) => record.status === "accepted" && record.usableForCoverage);
      const pendingRecords = linkedRecords.filter((record) => record.status === "pending_confirmation");
      const provenRequirementCount = requirementIds.filter((id) => coverageById.get(id)?.status === "proven").length;
      const totalRequirementCount = requirementIds.length;
      const achieved = totalRequirementCount > 0
        && provenRequirementCount === totalRequirementCount
        && acceptedRecords.length > 0;
      const inProgress = linkedRecords.some((record) => record.status !== "reopened")
        || requirementIds.some((id) => ["proven", "partially_proven"].includes(coverageById.get(id)?.status || ""));
      const status: ExecutionMilestoneProgress["status"] = achieved
        ? "achieved"
        : pendingRecords.length
          ? "pending_confirmation"
          : inProgress
            ? "in_progress"
            : "not_started";
      return {
        milestoneId,
        workstreamId: workstream.workstreamId,
        label: `${workstream.title} milestone`,
        requirementIds,
        status,
        provenRequirementCount,
        totalRequirementCount,
        outcomeIds: linkedRecords.map((record) => record.id),
        doneWhen: milestoneTasks.map((task) => task.doneWhen).filter(Boolean).join("; ") || workstream.objective,
        reason: achieved
          ? "All linked requirements are proven and the milestone has accepted execution evidence."
          : pendingRecords.length
            ? "A completed task still needs one focused outcome confirmation before the milestone can be assessed."
            : inProgress
              ? `${provenRequirementCount} of ${totalRequirementCount} linked requirements are currently proven.`
              : "No accepted execution outcome has reached this milestone yet.",
        updatedAt: Date.now(),
      };
    });
  });
  return milestones;
}

function confirmationStrength(
  record: ExecutionOutcomeRecord,
  input: ExecutionOutcomeConfirmationInput,
  sourceUrl: string,
): UserEvidenceStrength {
  if (sourceUrl) return "verified";
  if (input.resolution === "supporting") return "supporting";
  if (["relationship", "access", "experience", "credential"].includes(record.taskKind)) return "direct";
  return "supporting";
}

function acceptedConfirmationRecord(
  record: ExecutionOutcomeRecord,
  input: ExecutionOutcomeConfirmationInput,
): ExecutionOutcomeRecord {
  const now = Date.now();
  const answer = compact(input.answer, 4000);
  const sourceUrl = safeExternalUrl(input.sourceUrl);
  const strength = confirmationStrength(record, input, sourceUrl);
  return {
    ...record,
    status: "accepted",
    usableForCoverage: true,
    strength,
    sourceUrl: sourceUrl || record.sourceUrl,
    detail: compact([
      record.detail,
      answer ? `User-confirmed outcome: ${answer}.` : "",
      sourceUrl ? `Inspectable evidence: ${sourceUrl}.` : "",
    ].filter(Boolean).join(" "), 8000),
    inference: {
      confidence: sourceUrl || strength === "direct" ? "high" : "medium",
      basis: "user_confirmation",
      reason: sourceUrl
        ? "The user supplied an inspectable output link."
        : "The user supplied a focused factual confirmation of the completed outcome.",
    },
    confirmation: {
      ...record.confirmation,
      required: false,
      answer: answer || sourceUrl,
      answeredAt: now,
    },
    updatedAt: now,
  };
}

function reopenedConfirmationRecord(
  record: ExecutionOutcomeRecord,
  answer: string,
): ExecutionOutcomeRecord {
  const now = Date.now();
  return {
    ...record,
    status: "reopened",
    usableForCoverage: false,
    strength: "planned",
    detail: compact([record.detail, answer ? `Completion correction: ${answer}.` : "The task was reopened because its evidence objective was not met."].join(" "), 8000),
    inference: {
      confidence: "high",
      basis: "user_confirmation",
      reason: "The user confirmed that the completed activity did not yet produce the required evidence.",
    },
    confirmation: {
      ...record.confirmation,
      required: false,
      answer: compact(answer, 4000) || "No usable evidence yet",
      answeredAt: now,
    },
    updatedAt: now,
  };
}

async function persistOutcomeModel(
  trackId: number,
  model: ExecutionOutcomeModel,
): Promise<void> {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return;
  const intelligence = parseJsonObject(track.trackIntelligence);
  await storage.updateCareerTrack(trackId, {
    trackIntelligence: JSON.stringify({
      ...intelligence,
      executionOutcomeModel: model,
      executionOutcomeUpdatedAt: model.generatedAt,
      lastUpdated: Date.now(),
    }),
  } as any);
}

async function refreshPriorityOnly(trackId: number, advance: boolean): Promise<number[]> {
  const priority = await ensureExecutionPriority(trackId, true);
  if (!priority || !("executionPriorityModel" in priority)) return [];
  if (!advance || priority.priorityContext.capacity.maxNewTasks !== 1) return [];
  const materialized = await materializePrioritizedExecutionSlice(
    trackId,
    priority.executionPriorityModel.sourceFingerprint,
  );
  if (!materialized || !("materialization" in materialized)) return [];
  return materialized.materialization.created.map((item) => item.liveTaskId);
}

async function refreshAfterEvidenceChange(input: {
  trackId: number;
  affectedRequirementIds: string[];
  beforeCoverage: CoverageModel | null;
  model: ExecutionOutcomeModel;
  advance: boolean;
}): Promise<ExecutionOutcomeRefreshResult> {
  const coverageResult = await ensureRequirementCoverage(input.trackId, true);
  if (!coverageResult || "error" in coverageResult) {
    return {
      trackId: input.trackId,
      executionOutcomeModel: input.model,
      requirementModel: null,
      coverageModel: null,
      executionBlueprintModel: null,
      advancedTaskIds: [],
      refreshedCoverage: false,
      refreshedPlan: false,
      refreshedPriority: false,
    };
  }

  const delta = buildExecutionCoverageDelta(
    input.beforeCoverage,
    coverageResult.coverageModel,
    coverageResult.requirementModel,
    input.affectedRequirementIds,
  );
  const developmentResult = await ensureDevelopmentPlan(input.trackId, true);
  const blueprintResult = await ensureExecutionBlueprint(input.trackId, true);
  const blueprint = blueprintResult && "executionBlueprintModel" in blueprintResult
    ? blueprintResult.executionBlueprintModel
    : null;
  let model = {
    ...input.model,
    latestCoverageDelta: delta,
    milestoneProgress: buildExecutionMilestoneProgress(blueprint, coverageResult.coverageModel, input.model),
    generatedAt: Date.now(),
  };
  await persistOutcomeModel(input.trackId, model);

  const advancedTaskIds = await refreshPriorityOnly(input.trackId, input.advance);
  const latestTrack = await storage.getCareerTrack(input.trackId);
  const latestIntelligence = parseJsonObject(latestTrack?.trackIntelligence);
  model = normalizeExecutionOutcomeModel(input.trackId, latestIntelligence.executionOutcomeModel || model);

  return {
    trackId: input.trackId,
    executionOutcomeModel: model,
    requirementModel: coverageResult.requirementModel,
    coverageModel: coverageResult.coverageModel,
    executionBlueprintModel: blueprint,
    advancedTaskIds,
    refreshedCoverage: true,
    refreshedPlan: Boolean(developmentResult && "developmentPlanModel" in developmentResult),
    refreshedPriority: true,
  };
}

async function readCurrentState(trackId: number) {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const outcomeModel = normalizeExecutionOutcomeModel(trackId, intelligence.executionOutcomeModel);
  const beforeCoverage = intelligence.coverageModel?.mode === "coverage_model"
    ? intelligence.coverageModel as CoverageModel
    : null;
  return { track, intelligence, outcomeModel, beforeCoverage };
}

const trackQueues = new Map<number, Promise<any>>();

function serializeTrackWork<T>(trackId: number, work: () => Promise<T>): Promise<T> {
  const previous = trackQueues.get(trackId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  trackQueues.set(trackId, current);
  return current.finally(() => {
    if (trackQueues.get(trackId) === current) trackQueues.delete(trackId);
  });
}

async function reconcileExecutionOutcomesUnsafe(
  trackId: number,
  options: { advance?: boolean } = {},
): Promise<ExecutionOutcomeRefreshResult | null> {
  const state = await readCurrentState(trackId);
  if (!state) return null;
  const blueprintResult = await ensureExecutionBlueprint(trackId, false);
  const blueprint = blueprintResult && "executionBlueprintModel" in blueprintResult
    ? blueprintResult.executionBlueprintModel
    : state.intelligence.executionBlueprintModel?.mode === "execution_blueprint_model"
      ? state.intelligence.executionBlueprintModel as ExecutionBlueprintModel
      : null;
  if (!blueprint) {
    return {
      trackId,
      executionOutcomeModel: state.outcomeModel,
      requirementModel: null,
      coverageModel: state.beforeCoverage,
      executionBlueprintModel: null,
      advancedTaskIds: [],
      refreshedCoverage: false,
      refreshedPlan: false,
      refreshedPriority: false,
    };
  }

  const blueprintTaskById = new Map(blueprint.tasks.map((task) => [task.id, task]));
  const tasks = (await storage.getTasks()).filter((task) => executionTaskTrackId(task) === trackId);
  let model = state.outcomeModel;
  const affected = new Set<string>();
  let evidenceChanged = false;
  let operationalCompletion = false;

  for (const task of tasks) {
    const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
    if (!blueprintTaskId) continue;
    const existing = model.records.find((record) => record.liveTaskId === task.id);
    if (!taskCompleted(task)) {
      if (existing && existing.status !== "reopened") {
        if (existing.usableForCoverage) evidenceChanged = true;
        existing.requirementIds.forEach((id) => affected.add(id));
        model = reopenExecutionOutcome(model, task.id);
      }
      continue;
    }

    const blueprintTask = blueprintTaskById.get(blueprintTaskId);
    if (!blueprintTask) continue;
    if (!outcomeRecordChanged(existing, task, blueprint, blueprintTask)) continue;
    const record = buildExecutionOutcomeRecord({
      trackId,
      task,
      blueprint,
      blueprintTask,
      existing: existing || null,
    });
    model = upsertExecutionOutcome(model, record);
    record.requirementIds.forEach((id) => affected.add(id));
    if (record.status === "accepted" && record.usableForCoverage) evidenceChanged = true;
    else operationalCompletion = true;
  }

  model = {
    ...model,
    milestoneProgress: buildExecutionMilestoneProgress(blueprint, state.beforeCoverage, model),
    generatedAt: Date.now(),
  };
  await persistOutcomeModel(trackId, model);

  if (evidenceChanged) {
    return refreshAfterEvidenceChange({
      trackId,
      affectedRequirementIds: [...affected],
      beforeCoverage: state.beforeCoverage,
      model,
      advance: Boolean(options.advance),
    });
  }

  const advancedTaskIds = operationalCompletion
    ? await refreshPriorityOnly(trackId, false)
    : [];
  return {
    trackId,
    executionOutcomeModel: model,
    requirementModel: blueprintResult && "requirementModel" in blueprintResult ? blueprintResult.requirementModel : null,
    coverageModel: state.beforeCoverage,
    executionBlueprintModel: blueprint,
    advancedTaskIds,
    refreshedCoverage: false,
    refreshedPlan: false,
    refreshedPriority: operationalCompletion,
  };
}

export function reconcileExecutionOutcomes(
  trackId: number,
  options: { advance?: boolean } = {},
): Promise<ExecutionOutcomeRefreshResult | null> {
  return serializeTrackWork(trackId, () => reconcileExecutionOutcomesUnsafe(trackId, options));
}

async function confirmExecutionOutcomeUnsafe(
  trackId: number,
  outcomeId: string,
  input: ExecutionOutcomeConfirmationInput,
): Promise<ExecutionOutcomeRefreshResult | null> {
  const state = await readCurrentState(trackId);
  if (!state) return null;
  const existing = state.outcomeModel.records.find((record) => record.id === outcomeId);
  if (!existing) throw Object.assign(new Error("Execution outcome not found"), { status: 404 });
  const answer = compact(input.answer, 4000);
  const sourceUrl = safeExternalUrl(input.sourceUrl);

  if (input.resolution === "accept" || input.resolution === "supporting") {
    if (!answer && !sourceUrl) {
      throw Object.assign(new Error("Add the concrete outcome or an inspectable evidence link."), { status: 400 });
    }
    if (existing.taskKind === "research" || existing.taskKind === "verification") {
      throw Object.assign(new Error("This task resolves the plan but does not itself prove capability."), { status: 409 });
    }
    const record = acceptedConfirmationRecord(existing, { ...input, answer, sourceUrl });
    const model = upsertExecutionOutcome(state.outcomeModel, record);
    await persistOutcomeModel(trackId, model);
    return refreshAfterEvidenceChange({
      trackId,
      affectedRequirementIds: record.requirementIds,
      beforeCoverage: state.beforeCoverage,
      model,
      advance: true,
    });
  }

  const record = reopenedConfirmationRecord(existing, answer || (input.resolution === "reopen" ? "Marked complete by mistake" : "No usable evidence yet"));
  let model = upsertExecutionOutcome(state.outcomeModel, record);
  await persistOutcomeModel(trackId, model);
  const liveTask = (await storage.getTasks()).find((task) => task.id === record.liveTaskId);
  if (liveTask && taskCompleted(liveTask)) {
    await storage.updateTask(liveTask.id, {
      done: false,
      status: "not_started",
      list: liveTask.list === "today" ? "this_week" : liveTask.list,
      sourceStatus: "evidence_needed",
    } as any);
  }
  const refreshed = existing.usableForCoverage
    ? await refreshAfterEvidenceChange({
      trackId,
      affectedRequirementIds: record.requirementIds,
      beforeCoverage: state.beforeCoverage,
      model,
      advance: false,
    })
    : null;
  if (refreshed) return refreshed;

  const priority = await ensureExecutionPriority(trackId, true);
  const latestTrack = await storage.getCareerTrack(trackId);
  const latestIntelligence = parseJsonObject(latestTrack?.trackIntelligence);
  model = normalizeExecutionOutcomeModel(trackId, latestIntelligence.executionOutcomeModel || model);
  return {
    trackId,
    executionOutcomeModel: model,
    requirementModel: priority && "requirementModel" in priority ? priority.requirementModel : null,
    coverageModel: priority && "coverageModel" in priority ? priority.coverageModel : state.beforeCoverage,
    executionBlueprintModel: priority && "executionBlueprintModel" in priority ? priority.executionBlueprintModel : null,
    advancedTaskIds: [],
    refreshedCoverage: false,
    refreshedPlan: false,
    refreshedPriority: Boolean(priority && "executionPriorityModel" in priority),
  };
}

export function confirmExecutionOutcome(
  trackId: number,
  outcomeId: string,
  input: ExecutionOutcomeConfirmationInput,
): Promise<ExecutionOutcomeRefreshResult | null> {
  return serializeTrackWork(trackId, () => confirmExecutionOutcomeUnsafe(trackId, outcomeId, input));
}

export async function handleExecutionTaskLifecycle(task: Task, type: "completed" | "reopened"): Promise<void> {
  const trackId = executionTaskTrackId(task);
  if (!trackId) return;
  await reconcileExecutionOutcomes(trackId, { advance: type === "completed" });
}

export const executionOutcomeServiceInternals = {
  acceptedConfirmationRecord,
  buildExecutionCoverageDelta,
  buildExecutionMilestoneProgress,
  executionTaskTrackId,
  reopenedConfirmationRecord,
  safeExternalUrl,
  taskCompleted,
};
