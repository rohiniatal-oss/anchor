import type { InsertTask, Task } from "@shared/schema";
import { storage } from "./storage";
import type { ExecutionBlueprintModel, SubtaskBlueprint, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import type { ExecutionPriorityContext, ExecutionPriorityModel, PrioritizedBlueprintTask } from "./trackResearchExecutionPriority";
import { blueprintTaskIdFromSourceStepType, sourceStepTypeForBlueprintTask } from "./trackResearchExecutionPriority";

export type ExecutionMaterializationResult = {
  status: "materialized" | "partially_materialized" | "already_active" | "nothing_to_materialize";
  created: Array<{ blueprintTaskId: string; liveTaskId: number }>;
  reused: Array<{ blueprintTaskId: string; liveTaskId: number }>;
  completed: Array<{ blueprintTaskId: string; liveTaskId: number }>;
  skipped: Array<{ blueprintTaskId: string; reason: string }>;
  activeLiveTaskIds: number[];
  todayLiveTaskId: number | null;
  materializedAt: number;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))];
}

function numberArray(value: unknown): number[] {
  if (Array.isArray(value)) return uniqueNumbers(value.map(Number));
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? uniqueNumbers(parsed.map(Number)) : [];
  } catch {
    return [];
  }
}

function activeTask(task: Task): boolean {
  return !task.done && task.status !== "done";
}

function effortMinutes(task: TaskBlueprint): number {
  if (task.effort === "quick") return 15;
  if (task.effort === "medium") return 45;
  if (task.effort === "deep") return 90;
  return 180;
}

function serializedSteps(task: TaskBlueprint): string {
  return JSON.stringify(task.subtasks.map((subtask: SubtaskBlueprint) => ({
    text: `${subtask.condition === "if_needed" ? "If needed — " : ""}${subtask.title}`,
    done: false,
    blueprintSubtaskId: subtask.id,
    executor: subtask.executor,
    condition: subtask.condition,
    outputSpec: subtask.outputSpec,
    doneWhen: subtask.doneWhen,
  })));
}

function liveTaskMap(tasks: Task[]): Map<string, Task> {
  const result = new Map<string, Task>();
  for (const task of tasks) {
    const blueprintTaskId = blueprintTaskIdFromSourceStepType(task.sourceStepType);
    if (!blueprintTaskId) continue;
    const existing = result.get(blueprintTaskId);
    if (!existing) {
      result.set(blueprintTaskId, task);
      continue;
    }
    const taskOpen = activeTask(task) ? 1 : 0;
    const existingOpen = activeTask(existing) ? 1 : 0;
    if (taskOpen > existingOpen || (taskOpen === existingOpen && task.createdAt > existing.createdAt)) {
      result.set(blueprintTaskId, task);
    }
  }
  return result;
}

export function buildMaterializedTaskInput(input: {
  trackId: number;
  blueprintTask: TaskBlueprint;
  priority: PrioritizedBlueprintTask;
  workstreamTitle: string;
  list: "today" | "inbox";
  sort: number;
  dependencyLiveTaskIds?: number[];
}): InsertTask {
  const dependencyIds = uniqueNumbers(input.dependencyLiveTaskIds || []);
  const waiting = dependencyIds.length > 0;
  return {
    title: input.blueprintTask.title,
    list: waiting ? "inbox" : input.list,
    block: null,
    done: false,
    pinned: false,
    steps: serializedSteps(input.blueprintTask),
    sort: input.sort,
    category: input.blueprintTask.materialization.taskDraft.category,
    deadline: "",
    size: input.blueprintTask.materialization.taskDraft.size,
    status: "not_started",
    skipped: 0,
    doneWhen: input.blueprintTask.doneWhen,
    source: "anchor",
    sourceType: "career_track",
    sourceId: input.trackId,
    sourceStepType: sourceStepTypeForBlueprintTask(input.blueprintTask.id),
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: compact(`Workstream: ${input.workstreamTitle}. Why now: ${input.priority.whyNow} Expected evidence: ${input.blueprintTask.expectedEvidence}`),
    sourceStatus: "active_slice",
    planItemId: null,
    relatedTrackId: input.trackId,
    relatedOpportunityId: null,
    parentTaskId: null,
    dependsOn: JSON.stringify(dependencyIds),
    blocks: "[]",
    blockedBy: waiting ? dependencyIds.join(",") : "",
    blockerReason: "",
    readiness: waiting ? "waiting" : "ready",
    minimumOutcome: input.blueprintTask.minimumOutcome,
    stretchOutcome: input.blueprintTask.expectedEvidence,
    estimateMinutes: effortMinutes(input.blueprintTask),
    estimateConfidence: "high",
    estimateReason: "Derived from the execution blueprint effort band and bounded subtask structure.",
    actualMinutes: null,
  };
}

function dependencyOrder(
  selectedIds: string[],
  blueprintById: Map<string, TaskBlueprint>,
  existingByBlueprintId: Map<string, Task>,
): { ordered: TaskBlueprint[]; skipped: ExecutionMaterializationResult["skipped"] } {
  const selected = new Set(selectedIds);
  const processed = new Set<string>();
  const failed = new Set<string>();
  const ordered: TaskBlueprint[] = [];
  const skipped: ExecutionMaterializationResult["skipped"] = [];
  let progressed = true;

  while (processed.size < selected.size && progressed) {
    progressed = false;
    for (const id of selectedIds) {
      if (processed.has(id)) continue;
      const task = blueprintById.get(id);
      if (!task) {
        skipped.push({ blueprintTaskId: id, reason: "The selected blueprint task no longer exists." });
        processed.add(id);
        failed.add(id);
        progressed = true;
        continue;
      }
      const failedDependencies = task.dependsOnTaskIds.filter((dependencyId) => selected.has(dependencyId) && failed.has(dependencyId));
      if (failedDependencies.length) {
        skipped.push({ blueprintTaskId: id, reason: `A selected prerequisite could not be materialized: ${failedDependencies.join(", ")}.` });
        processed.add(id);
        failed.add(id);
        progressed = true;
        continue;
      }
      const unavailable = task.dependsOnTaskIds.filter((dependencyId) => {
        if (selected.has(dependencyId)) return false;
        return !existingByBlueprintId.has(dependencyId);
      });
      if (unavailable.length) {
        skipped.push({ blueprintTaskId: id, reason: `Missing prerequisite blueprint task: ${unavailable.join(", ")}.` });
        processed.add(id);
        failed.add(id);
        progressed = true;
        continue;
      }
      const selectedDependenciesReady = task.dependsOnTaskIds
        .filter((dependencyId) => selected.has(dependencyId))
        .every((dependencyId) => processed.has(dependencyId));
      if (!selectedDependenciesReady) continue;
      ordered.push(task);
      processed.add(id);
      progressed = true;
    }
  }

  for (const id of selectedIds) {
    if (!processed.has(id)) skipped.push({ blueprintTaskId: id, reason: "The selected dependency graph could not be ordered safely." });
  }
  return { ordered, skipped };
}

export async function materializeExecutionPrioritySlice(input: {
  trackId: number;
  blueprint: ExecutionBlueprintModel;
  priorityModel: ExecutionPriorityModel;
  context: ExecutionPriorityContext;
}): Promise<ExecutionMaterializationResult> {
  const initialTasks = await storage.getTasks();
  const existingByBlueprintId = liveTaskMap(initialTasks);
  const blueprintById = new Map(input.blueprint.tasks.map((task) => [task.id, task]));
  const priorityById = new Map(input.priorityModel.candidates.map((candidate) => [candidate.taskId, candidate]));
  const workstreamTitles = new Map(input.blueprint.workstreams.map((workstream) => [workstream.workstreamId, workstream.title]));
  const selectedIds = [...new Set(input.priorityModel.activeSlice.selectedTaskIds)];
  const skipped: ExecutionMaterializationResult["skipped"] = [];

  if (
    input.priorityModel.executionBlueprintFingerprint !== input.blueprint.sourceFingerprint
    || input.priorityModel.contextFingerprint !== input.context.fingerprint
  ) {
    return {
      status: "partially_materialized",
      created: [],
      reused: [],
      completed: [],
      skipped: selectedIds.map((blueprintTaskId) => ({
        blueprintTaskId,
        reason: "The priority selection is stale because the blueprint or execution context changed.",
      })),
      activeLiveTaskIds: [],
      todayLiveTaskId: null,
      materializedAt: Date.now(),
    };
  }

  const eligibleIds = selectedIds.filter((taskId) => {
    const blueprintTask = blueprintById.get(taskId);
    const priority = priorityById.get(taskId);
    if (!blueprintTask || !priority?.selected) {
      skipped.push({ blueprintTaskId: taskId, reason: "The task is not a valid selected blueprint candidate." });
      return false;
    }
    if (blueprintTask.readiness === "conditional" || priority.slot === "conditional") {
      skipped.push({ blueprintTaskId: taskId, reason: "Role-specific work cannot enter the shared active slice until its route is active." });
      return false;
    }
    if (priority.slot === "blocked" || input.priorityModel.quality.blockedSelectedTaskIds.includes(taskId)) {
      skipped.push({ blueprintTaskId: taskId, reason: "The task has an unresolved prerequisite and cannot be materialized yet." });
      return false;
    }
    return true;
  });
  const orderedResult = dependencyOrder(eligibleIds, blueprintById, existingByBlueprintId);
  skipped.push(...orderedResult.skipped);
  const created: ExecutionMaterializationResult["created"] = [];
  const reused: ExecutionMaterializationResult["reused"] = [];
  const completed: ExecutionMaterializationResult["completed"] = [];
  const liveIdByBlueprintId = new Map<string, number>();
  let todayAvailable = initialTasks.filter((task) => activeTask(task) && task.list === "today").length < 3;
  let nextSort = Math.max(0, ...initialTasks.map((task) => task.sort || 0)) + 10;

  for (const blueprintTask of orderedResult.ordered) {
    const priority = priorityById.get(blueprintTask.id);
    if (!priority?.selected) continue;
    const existing = existingByBlueprintId.get(blueprintTask.id);
    if (existing) {
      let retained = existing;
      if (
        activeTask(existing)
        && priority.slot === "now"
        && todayAvailable
        && existing.list !== "today"
        && existing.readiness !== "blocked"
        && existing.readiness !== "waiting"
      ) {
        retained = await storage.updateTask(existing.id, { list: "today" } as any) || existing;
        existingByBlueprintId.set(blueprintTask.id, retained);
        todayAvailable = false;
      }
      liveIdByBlueprintId.set(blueprintTask.id, retained.id);
      if (activeTask(retained)) reused.push({ blueprintTaskId: blueprintTask.id, liveTaskId: retained.id });
      else completed.push({ blueprintTaskId: blueprintTask.id, liveTaskId: retained.id });
      continue;
    }

    if (created.length >= input.context.capacity.maxNewTasks) {
      skipped.push({ blueprintTaskId: blueprintTask.id, reason: "Current task load leaves no safe capacity for another new live task." });
      continue;
    }
    const dependencyLiveTaskIds = blueprintTask.dependsOnTaskIds
      .map((id) => liveIdByBlueprintId.get(id) || existingByBlueprintId.get(id)?.id)
      .filter((id): id is number => typeof id === "number");
    const requestedList: "today" | "inbox" = priority.slot === "now" && todayAvailable ? "today" : "inbox";
    const liveTask = await storage.createTask(buildMaterializedTaskInput({
      trackId: input.trackId,
      blueprintTask,
      priority,
      workstreamTitle: workstreamTitles.get(blueprintTask.workstreamId) || "",
      list: requestedList,
      sort: nextSort,
      dependencyLiveTaskIds,
    }));
    nextSort += 10;
    if (liveTask.list === "today") todayAvailable = false;
    liveIdByBlueprintId.set(blueprintTask.id, liveTask.id);
    existingByBlueprintId.set(blueprintTask.id, liveTask);
    created.push({ blueprintTaskId: blueprintTask.id, liveTaskId: liveTask.id });
    await storage.logActivity({
      eventType: "blueprint_materialized",
      sourceType: "career_track",
      sourceId: input.trackId,
      taskId: liveTask.id,
      metadata: JSON.stringify({ blueprintTaskId: blueprintTask.id, slot: priority.slot, expectedEvidence: blueprintTask.expectedEvidence }),
    } as any);
  }

  const currentTasks = await storage.getTasks();
  const currentById = new Map(currentTasks.map((task) => [task.id, task]));
  const selectedLive = eligibleIds.map((blueprintTaskId) => {
    const liveTaskId = liveIdByBlueprintId.get(blueprintTaskId) || existingByBlueprintId.get(blueprintTaskId)?.id;
    const blueprintTask = blueprintById.get(blueprintTaskId);
    return liveTaskId && blueprintTask ? { blueprintTaskId, liveTaskId, blueprintTask } : null;
  }).filter(Boolean) as Array<{ blueprintTaskId: string; liveTaskId: number; blueprintTask: TaskBlueprint }>;
  const blocksById = new Map<number, number[]>();

  for (const entry of selectedLive) {
    const dependencyIds = entry.blueprintTask.dependsOnTaskIds
      .map((id) => liveIdByBlueprintId.get(id) || existingByBlueprintId.get(id)?.id)
      .filter((id): id is number => typeof id === "number");
    for (const dependencyId of dependencyIds) {
      blocksById.set(dependencyId, uniqueNumbers([...(blocksById.get(dependencyId) || []), entry.liveTaskId]));
    }
  }

  for (const entry of selectedLive) {
    const current = currentById.get(entry.liveTaskId);
    if (!current || !activeTask(current)) continue;
    const openDependencyIds = entry.blueprintTask.dependsOnTaskIds
      .map((id) => liveIdByBlueprintId.get(id) || existingByBlueprintId.get(id)?.id)
      .filter((id): id is number => typeof id === "number")
      .filter((id) => {
        const task = currentById.get(id);
        return !task || activeTask(task);
      });
    await storage.updateTask(entry.liveTaskId, {
      dependsOn: JSON.stringify(uniqueNumbers(openDependencyIds)),
      blocks: JSON.stringify(uniqueNumbers([...(numberArray(current.blocks)), ...(blocksById.get(entry.liveTaskId) || [])])),
      blockedBy: openDependencyIds.length ? openDependencyIds.join(",") : "",
      readiness: openDependencyIds.length ? "waiting" : "ready",
      sourceStatus: "active_slice",
    } as any);
  }

  for (const [dependencyId, blockedIds] of blocksById) {
    if (selectedLive.some((entry) => entry.liveTaskId === dependencyId)) continue;
    const dependencyTask = currentById.get(dependencyId);
    if (!dependencyTask || !activeTask(dependencyTask)) continue;
    await storage.updateTask(dependencyId, {
      blocks: JSON.stringify(uniqueNumbers([...numberArray(dependencyTask.blocks), ...blockedIds])),
    } as any);
  }

  const refreshedTasks = await storage.getTasks();
  const activeLiveTaskIds = uniqueNumbers([...created, ...reused].map((item) => item.liveTaskId));
  const todayLiveTaskId = refreshedTasks.find((task) => activeLiveTaskIds.includes(task.id) && task.list === "today" && activeTask(task))?.id || null;
  const status: ExecutionMaterializationResult["status"] = created.length
    ? skipped.length ? "partially_materialized" : "materialized"
    : reused.length
      ? "already_active"
      : skipped.length
        ? "partially_materialized"
        : "nothing_to_materialize";

  return {
    status,
    created,
    reused,
    completed,
    skipped,
    activeLiveTaskIds,
    todayLiveTaskId,
    materializedAt: Date.now(),
  };
}

export const executionMaterializationInternals = {
  activeTask,
  dependencyOrder,
  effortMinutes,
  liveTaskMap,
  serializedSteps,
};
