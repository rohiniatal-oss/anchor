import type { InsertTask, Task } from "@shared/schema";
import { storage } from "./storage";
import type { CoverageModel } from "./trackResearchCoverageModel";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import type { ExecutionBlueprintModel, SubtaskBlueprint, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import type { RequirementModel } from "./trackResearchRequirementModel";
import { prepareSelectedBlueprintTask } from "./trackResearchExecutionPreparation";
import {
  blueprintTaskIdFromLiveTask,
  blueprintTaskSourceStepType,
  emptyExecutionActivationState,
  EXECUTION_ACTIVATION_STATE_VERSION,
  MAX_ACTIVE_USER_TASKS,
  type ActiveExecutionSliceItem,
  type AnchorPreparationArtifact,
  type ExecutionActivationRecord,
  type ExecutionActivationState,
  type ExecutionPriorityModel,
} from "./trackResearchExecutionPriority";

export type MaterializedExecutionTask = {
  blueprintTaskId: string;
  liveTaskId: number | null;
  reused: boolean;
  status: ExecutionActivationRecord["status"];
  preparationId: string;
};

export type ExecutionActivationResult = {
  state: ExecutionActivationState;
  records: MaterializedExecutionTask[];
  createdTaskIds: number[];
  reusedTaskIds: number[];
  completedByAnchorTaskIds: string[];
  failedBlueprintTaskIds: string[];
};

function compact(value: unknown, max = 1_400): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function currentState(
  blueprintFingerprint: string,
  value: ExecutionActivationState | null | undefined,
): ExecutionActivationState {
  if (value?.mode === "execution_activation_state"
    && value.version === EXECUTION_ACTIVATION_STATE_VERSION
    && value.blueprintFingerprint === blueprintFingerprint
    && Array.isArray(value.records)) {
    return {
      ...value,
      records: [...value.records],
    };
  }
  return emptyExecutionActivationState(blueprintFingerprint);
}

function upsertRecord(
  state: ExecutionActivationState,
  record: ExecutionActivationRecord,
): ExecutionActivationState {
  const records = state.records.filter((item) => item.blueprintTaskId !== record.blueprintTaskId);
  records.push(record);
  return { ...state, records, generatedAt: Date.now() };
}

function liveTaskMap(trackId: number, tasks: Task[]): Map<string, Task> {
  const result = new Map<string, Task>();
  for (const task of tasks) {
    if (task.sourceType !== "career_track" || task.sourceId !== trackId) continue;
    const blueprintTaskId = blueprintTaskIdFromLiveTask(task);
    if (!blueprintTaskId) continue;
    const existing = result.get(blueprintTaskId);
    if (!existing || Number(task.createdAt || 0) > Number(existing.createdAt || 0)) result.set(blueprintTaskId, task);
  }
  return result;
}

function nonSystemSubtasks(task: TaskBlueprint): SubtaskBlueprint[] {
  return task.subtasks.filter((subtask) => subtask.executor !== "system" && subtask.condition === "always");
}

function focusedQuestionSteps(
  task: TaskBlueprint,
  preparation: AnchorPreparationArtifact | null,
): Array<{ text: string; done: boolean }> {
  const steps: Array<{ text: string; done: boolean }> = [];
  if (preparation?.needsUserInput && preparation.focusedQuestion) {
    steps.push({ text: preparation.focusedQuestion, done: false });
  }
  for (const subtask of nonSystemSubtasks(task)) {
    if (steps.some((step) => step.text === subtask.title)) continue;
    steps.push({ text: subtask.title, done: false });
  }
  return steps.slice(0, 5);
}

function taskSize(task: TaskBlueprint): InsertTask["size"] {
  if (task.effort === "quick") return "quick";
  if (task.effort === "medium") return "medium";
  return "deep";
}

function estimateMinutes(task: TaskBlueprint): number {
  if (task.effort === "quick") return 15;
  if (task.effort === "medium") return 45;
  if (task.effort === "deep") return 90;
  return 180;
}

function readableSourceNote(
  selected: ActiveExecutionSliceItem,
  task: TaskBlueprint,
  preparation: AnchorPreparationArtifact | null,
): string {
  return compact([
    `Selected from the execution blueprint because ${selected.reason}`,
    `Expected evidence: ${task.expectedEvidence}.`,
    preparation?.summary ? `Anchor preparation: ${preparation.summary}` : "",
    preparation?.id ? `Preparation record: ${preparation.id}.` : "",
  ].filter(Boolean).join(" "), 4_000);
}

function taskInsert(
  trackId: number,
  selected: ActiveExecutionSliceItem,
  blueprintTask: TaskBlueprint,
  preparation: AnchorPreparationArtifact | null,
  list: "today" | "inbox",
  sort: number,
): InsertTask {
  const steps = focusedQuestionSteps(blueprintTask, preparation);
  const title = preparation?.needsUserInput && preparation.focusedQuestion
    ? `Provide one detail for ${blueprintTask.title}`
    : blueprintTask.title;
  return {
    title,
    list,
    block: null,
    done: false,
    pinned: list === "today",
    steps: JSON.stringify(steps),
    sort,
    category: blueprintTask.materialization.taskDraft.category,
    deadline: "",
    size: taskSize(blueprintTask),
    status: "not_started",
    skipped: 0,
    doneWhen: blueprintTask.doneWhen,
    source: "coach",
    sourceType: "career_track",
    sourceId: trackId,
    sourceStepType: blueprintTaskSourceStepType(blueprintTask.id),
    sourceStepId: null,
    sourceUrl: preparation?.sources[0]?.url || "",
    sourceNote: readableSourceNote(selected, blueprintTask, preparation),
    sourceStatus: "execution_active_slice",
    planItemId: null,
    relatedTrackId: trackId,
    relatedOpportunityId: null,
    parentTaskId: null,
    dependsOn: "[]",
    blocks: "[]",
    blockedBy: "",
    blockerReason: "",
    readiness: "ready",
    minimumOutcome: blueprintTask.minimumOutcome,
    stretchOutcome: blueprintTask.expectedEvidence,
    estimateMinutes: estimateMinutes(blueprintTask),
    estimateConfidence: "med",
    estimateReason: "Derived from the execution-blueprint effort band.",
    actualMinutes: null,
  };
}

async function createOrReuseLiveTask(
  trackId: number,
  selected: ActiveExecutionSliceItem,
  blueprintTask: TaskBlueprint,
  preparation: AnchorPreparationArtifact | null,
  tasks: Task[],
  list: "today" | "inbox",
): Promise<{ task: Task; reused: boolean }> {
  const mapped = liveTaskMap(trackId, tasks).get(blueprintTask.id);
  if (mapped && !mapped.done && mapped.status !== "done") return { task: mapped, reused: true };

  // Recheck immediately before the write so concurrent activation requests are
  // idempotent even if they began from the same task snapshot.
  const latestTasks = await storage.getTasks();
  const latestMapped = liveTaskMap(trackId, latestTasks).get(blueprintTask.id);
  if (latestMapped && !latestMapped.done && latestMapped.status !== "done") return { task: latestMapped, reused: true };

  const sort = Math.max(0, ...latestTasks.map((task) => Number(task.sort || 0))) + 1;
  const created = await storage.createTask(taskInsert(trackId, selected, blueprintTask, preparation, list, sort));
  await storage.logActivity({
    eventType: "execution_blueprint_materialized",
    sourceType: "career_track",
    sourceId: trackId,
    taskId: created.id,
    metadata: JSON.stringify({
      blueprintTaskId: blueprintTask.id,
      workstreamId: blueprintTask.workstreamId,
      moduleId: blueprintTask.moduleId,
      requirementIds: blueprintTask.requirementIds,
      priorityScore: selected.score,
      priorityReason: selected.reason,
      preparationId: preparation?.id || "",
    }),
  } as any);
  return { task: created, reused: false };
}

function reconcileState(
  blueprint: ExecutionBlueprintModel,
  state: ExecutionActivationState,
  tasks: Task[],
  trackId: number,
): ExecutionActivationState {
  const blueprintIds = new Set(blueprint.tasks.map((task) => task.id));
  const mapped = liveTaskMap(trackId, tasks);
  const records = state.records
    .filter((record) => blueprintIds.has(record.blueprintTaskId))
    .map((record) => {
      const live = mapped.get(record.blueprintTaskId);
      if (live?.done || live?.status === "done") {
        return { ...record, status: "completed" as const, liveTaskId: live.id, updatedAt: Date.now() };
      }
      if (live && !live.done) {
        return { ...record, status: "materialized" as const, liveTaskId: live.id, updatedAt: record.updatedAt };
      }
      if (record.status === "materialized") {
        return { ...record, status: "prepared" as const, liveTaskId: null, updatedAt: Date.now() };
      }
      return record;
    });
  return { ...state, records, generatedAt: Date.now() };
}

export async function activateExecutionSlice(
  trackId: number,
  blueprint: ExecutionBlueprintModel,
  priorityModel: ExecutionPriorityModel,
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  developmentPlan: DevelopmentPlanModel,
  previousState: ExecutionActivationState | null | undefined,
): Promise<ExecutionActivationResult> {
  let tasks = await storage.getTasks();
  let state = reconcileState(
    blueprint,
    currentState(blueprint.sourceFingerprint, previousState),
    tasks,
    trackId,
  );
  const blueprintById = new Map(blueprint.tasks.map((task) => [task.id, task]));
  const materialized = liveTaskMap(trackId, tasks);
  const openBlueprintTasks = [...materialized.values()].filter((task) => !task.done && task.status !== "done");
  let userCapacity = Math.max(0, MAX_ACTIVE_USER_TASKS - openBlueprintTasks.length);
  let todayAssigned = openBlueprintTasks.some((task) => task.list === "today");
  let anchorAutomations = 0;

  const records: MaterializedExecutionTask[] = [];
  const createdTaskIds: number[] = [];
  const reusedTaskIds: number[] = [];
  const completedByAnchorTaskIds: string[] = [];
  const failedBlueprintTaskIds: string[] = [];

  for (const selected of [...priorityModel.activeSlice].sort((left, right) => left.rank - right.rank)) {
    const blueprintTask = blueprintById.get(selected.blueprintTaskId);
    if (!blueprintTask) continue;
    const existing = liveTaskMap(trackId, tasks).get(blueprintTask.id);
    if (existing && !existing.done && existing.status !== "done") {
      state = upsertRecord(state, {
        blueprintTaskId: blueprintTask.id,
        blueprintFingerprint: blueprint.sourceFingerprint,
        status: "materialized",
        liveTaskId: existing.id,
        preparation: state.records.find((record) => record.blueprintTaskId === blueprintTask.id)?.preparation || null,
        error: "",
        updatedAt: Date.now(),
      });
      records.push({ blueprintTaskId: blueprintTask.id, liveTaskId: existing.id, reused: true, status: "materialized", preparationId: "" });
      reusedTaskIds.push(existing.id);
      continue;
    }

    let preparation: AnchorPreparationArtifact | null = null;
    let preparationStatus: "completed" | "prepared" | "needs_user_input" | "failed" = "prepared";
    let preparationError = "";
    if (blueprintTask.owner === "anchor" || blueprintTask.owner === "shared") {
      if (blueprintTask.owner === "anchor" && anchorAutomations >= priorityModel.policy.maxAnchorAutomationsPerActivation) continue;
      const prepared = await prepareSelectedBlueprintTask(
        blueprintTask,
        blueprint,
        requirementModel,
        coverageModel,
        developmentPlan,
      );
      preparation = prepared.artifact;
      preparationStatus = prepared.status;
      preparationError = prepared.error;
      if (blueprintTask.owner === "anchor") anchorAutomations += 1;
    }

    if (blueprintTask.owner === "anchor" && preparationStatus === "completed") {
      state = upsertRecord(state, {
        blueprintTaskId: blueprintTask.id,
        blueprintFingerprint: blueprint.sourceFingerprint,
        status: "completed_by_anchor",
        liveTaskId: null,
        preparation,
        error: "",
        updatedAt: Date.now(),
      });
      completedByAnchorTaskIds.push(blueprintTask.id);
      records.push({ blueprintTaskId: blueprintTask.id, liveTaskId: null, reused: false, status: "completed_by_anchor", preparationId: preparation?.id || "" });
      continue;
    }

    if (preparationStatus === "failed" && blueprintTask.owner === "anchor") {
      state = upsertRecord(state, {
        blueprintTaskId: blueprintTask.id,
        blueprintFingerprint: blueprint.sourceFingerprint,
        status: "failed",
        liveTaskId: null,
        preparation: null,
        error: preparationError,
        updatedAt: Date.now(),
      });
      failedBlueprintTaskIds.push(blueprintTask.id);
      records.push({ blueprintTaskId: blueprintTask.id, liveTaskId: null, reused: false, status: "failed", preparationId: "" });
      continue;
    }

    const userSteps = focusedQuestionSteps(blueprintTask, preparation);
    if (!userSteps.length && blueprintTask.owner === "anchor") {
      state = upsertRecord(state, {
        blueprintTaskId: blueprintTask.id,
        blueprintFingerprint: blueprint.sourceFingerprint,
        status: preparationStatus === "needs_user_input" ? "needs_user_input" : "prepared",
        liveTaskId: null,
        preparation,
        error: preparationError,
        updatedAt: Date.now(),
      });
      records.push({ blueprintTaskId: blueprintTask.id, liveTaskId: null, reused: false, status: preparationStatus === "needs_user_input" ? "needs_user_input" : "prepared", preparationId: preparation?.id || "" });
      continue;
    }

    if (userCapacity <= 0) continue;
    const list: "today" | "inbox" = !todayAssigned && selected.slot === "now" ? "today" : "inbox";
    const created = await createOrReuseLiveTask(
      trackId,
      selected,
      blueprintTask,
      preparation,
      tasks,
      list,
    );
    tasks = await storage.getTasks();
    if (!created.reused) {
      userCapacity -= 1;
      createdTaskIds.push(created.task.id);
      if (list === "today") todayAssigned = true;
    } else {
      reusedTaskIds.push(created.task.id);
    }
    const status: ExecutionActivationRecord["status"] = preparationStatus === "needs_user_input" ? "needs_user_input" : "materialized";
    state = upsertRecord(state, {
      blueprintTaskId: blueprintTask.id,
      blueprintFingerprint: blueprint.sourceFingerprint,
      status,
      liveTaskId: created.task.id,
      preparation,
      error: preparationError,
      updatedAt: Date.now(),
    });
    records.push({ blueprintTaskId: blueprintTask.id, liveTaskId: created.task.id, reused: created.reused, status, preparationId: preparation?.id || "" });
  }

  state = reconcileState(blueprint, state, await storage.getTasks(), trackId);
  return {
    state,
    records,
    createdTaskIds,
    reusedTaskIds: [...new Set(reusedTaskIds)],
    completedByAnchorTaskIds,
    failedBlueprintTaskIds,
  };
}
