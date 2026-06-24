import { createHash } from "node:crypto";
import type {
  BlueprintEffort,
  BlueprintOwner,
  ExecutionBlueprintModel,
  TaskBlueprint,
  TaskBlueprintKind,
} from "./trackResearchExecutionBlueprint";

export const ACTIVE_EXECUTION_SLICE_VERSION = 1;

export type ExecutionSliceDecision = "active" | "queued" | "blocked" | "conditional" | "deferred";

export type ExecutionSliceScore = {
  readiness: number;
  leverage: number;
  evidenceValue: number;
  effortFit: number;
  ownershipFit: number;
  dependencyPenalty: number;
  clutterPenalty: number;
  total: number;
};

export type ExecutionSliceTask = {
  taskId: string;
  decision: ExecutionSliceDecision;
  score: ExecutionSliceScore;
  reason: string;
  rank: number | null;
  title: string;
  workstreamId: string;
  moduleId: string;
  kind: TaskBlueprintKind;
  owner: BlueprintOwner;
  effort: BlueprintEffort;
  readiness: TaskBlueprint["readiness"];
  dependsOnTaskIds: string[];
  requirementIds: string[];
  milestoneIds: string[];
  minimumOutcome: string;
  doneWhen: string;
  expectedEvidence: string;
  taskDraft: TaskBlueprint["materialization"]["taskDraft"];
};

export type ActiveExecutionSliceModel = {
  mode: "active_execution_slice_model";
  version: number;
  targetLabel: string;
  executionBlueprintVersion: number;
  executionBlueprintFingerprint: string;
  sourceFingerprint: string;
  objective: string;
  maxActiveTasks: number;
  maxUserOwnedTasks: number;
  activeTaskIds: string[];
  queuedTaskIds: string[];
  blockedTaskIds: string[];
  conditionalTaskIds: string[];
  deferredTaskIds: string[];
  tasks: ExecutionSliceTask[];
  summary: {
    activeTaskCount: number;
    queuedTaskCount: number;
    blockedTaskCount: number;
    conditionalTaskCount: number;
    deferredTaskCount: number;
    activeAnchorOwnedCount: number;
    activeSharedCount: number;
    activeUserOwnedCount: number;
    totalSelectedSubtasks: number;
  };
  quality: {
    status: "ready" | "usable_with_caveats" | "blocked";
    selectedReadyTaskCount: number;
    selectedUserOwnedTaskCount: number;
    activeDependencyViolations: string[];
    duplicateMaterializationKeys: string[];
    caveats: string[];
  };
  materializationStatus: "slice_only" | "materialized";
  materializedTaskIds: number[];
  generatedAt: number;
};

type SelectionOptions = {
  maxActiveTasks?: number;
  maxUserOwnedTasks?: number;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => String(item || "").trim()).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function activeExecutionSliceSourceFingerprint(blueprint: ExecutionBlueprintModel): string {
  return hash({
    version: blueprint.version,
    developmentPlanFingerprint: blueprint.developmentPlanFingerprint,
    sourceFingerprint: blueprint.sourceFingerprint,
    materializationStatus: blueprint.materializationStatus,
    tasks: blueprint.tasks.map((task) => ({
      id: task.id,
      key: task.key,
      title: task.title,
      workstreamId: task.workstreamId,
      moduleId: task.moduleId,
      kind: task.kind,
      owner: task.owner,
      effort: task.effort,
      readiness: task.readiness,
      dependsOnTaskIds: task.dependsOnTaskIds,
      requirementIds: task.requirementIds,
      milestoneIds: task.milestoneIds,
      minimumOutcome: task.minimumOutcome,
      doneWhen: task.doneWhen,
      expectedEvidence: task.expectedEvidence,
      taskDraft: task.materialization.taskDraft,
      subtasks: task.subtasks.map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        executor: subtask.executor,
        condition: subtask.condition,
        outputSpec: subtask.outputSpec,
        doneWhen: subtask.doneWhen,
      })),
    })),
  });
}

function effortScore(effort: BlueprintEffort): number {
  if (effort === "quick") return 18;
  if (effort === "medium") return 14;
  if (effort === "deep") return 6;
  return 1;
}

function ownerScore(owner: BlueprintOwner): number {
  if (owner === "anchor") return 14;
  if (owner === "shared") return 10;
  return 3;
}

function kindEvidenceScore(kind: TaskBlueprintKind): number {
  const scores: Record<TaskBlueprintKind, number> = {
    verification: 18,
    research: 15,
    artifact: 14,
    validation: 13,
    practice: 11,
    relationship: 10,
    access: 10,
    learning: 8,
    experience: 7,
    credential: 4,
  };
  return scores[kind];
}

function scoreTask(task: TaskBlueprint): ExecutionSliceScore {
  const readiness = task.readiness === "ready" ? 25 : task.readiness === "depends_on_blueprint" ? 5 : -25;
  const leverage = Math.min(22, task.requirementIds.length * 6 + task.milestoneIds.length * 4);
  const evidenceValue = kindEvidenceScore(task.kind) + (task.expectedEvidence ? 4 : 0);
  const effortFit = effortScore(task.effort);
  const ownershipFit = ownerScore(task.owner);
  const dependencyPenalty = task.dependsOnTaskIds.length * 18;
  const clutterPenalty = task.effort === "project" ? 8 : task.owner === "user" && task.effort === "deep" ? 6 : 0;
  const total = readiness + leverage + evidenceValue + effortFit + ownershipFit - dependencyPenalty - clutterPenalty;
  return { readiness, leverage, evidenceValue, effortFit, ownershipFit, dependencyPenalty, clutterPenalty, total };
}

function taskReason(task: TaskBlueprint, decision: ExecutionSliceDecision, score: ExecutionSliceScore) {
  if (decision === "active") {
    const owner = task.owner === "anchor" ? "Anchor can carry much of the work" : task.owner === "shared" ? "Anchor can prepare it and the user supplies judgement or action" : "it needs user learning or real-world action";
    return `Selected because it is ready, ${owner}, and creates evidence for ${task.requirementIds.length} requirement${task.requirementIds.length === 1 ? "" : "s"}.`;
  }
  if (decision === "conditional") return "Held back because this is role-specific or contextual work that should activate only when that route is active.";
  if (decision === "blocked") return "Held back because a logical blueprint prerequisite needs to happen first.";
  if (decision === "deferred") return "Deferred because it is too large or user-heavy for the first active slice.";
  return `Queued because it is structurally ready but scored below the selected active slice (${Math.round(score.total)}).`;
}

function materializationKey(task: TaskBlueprint) {
  return `${task.materialization.taskDraft.sourceType}:${task.id}`;
}

function buildQuality(
  tasks: ExecutionSliceTask[],
  selected: TaskBlueprint[],
  allTasks: TaskBlueprint[],
  maxUserOwnedTasks: number,
): ActiveExecutionSliceModel["quality"] {
  const activeIds = new Set(selected.map((task) => task.id));
  const activeDependencyViolations = selected
    .filter((task) => task.dependsOnTaskIds.some((id) => !activeIds.has(id)))
    .map((task) => task.id);
  const keyCounts = new Map<string, number>();
  for (const task of selected) keyCounts.set(materializationKey(task), (keyCounts.get(materializationKey(task)) || 0) + 1);
  const duplicateMaterializationKeys = [...keyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const selectedReadyTaskCount = selected.filter((task) => task.readiness === "ready").length;
  const selectedUserOwnedTaskCount = selected.filter((task) => task.owner === "user").length;
  const caveats: string[] = [];
  if (!selected.length && allTasks.length) caveats.push("No task was safe to activate; all available work is blocked, conditional, or too large for the first slice.");
  if (activeDependencyViolations.length) caveats.push("One or more selected tasks depends on unselected blueprint work.");
  if (selectedUserOwnedTaskCount > maxUserOwnedTasks) caveats.push("The selected slice exceeds the user-owned task cap.");
  if (duplicateMaterializationKeys.length) caveats.push("The selected slice contains duplicate materialization keys.");
  const status = selected.length && !activeDependencyViolations.length && !duplicateMaterializationKeys.length && selectedUserOwnedTaskCount <= maxUserOwnedTasks
    ? "ready"
    : selected.length ? "usable_with_caveats" : "blocked";
  return {
    status,
    selectedReadyTaskCount,
    selectedUserOwnedTaskCount,
    activeDependencyViolations,
    duplicateMaterializationKeys,
    caveats,
  };
}

export function buildActiveExecutionSlice(
  blueprint: ExecutionBlueprintModel,
  options: SelectionOptions = {},
): ActiveExecutionSliceModel {
  const maxActiveTasks = Math.max(1, Math.min(7, options.maxActiveTasks || 5));
  const maxUserOwnedTasks = Math.max(0, Math.min(maxActiveTasks, options.maxUserOwnedTasks ?? 2));
  const scored = blueprint.tasks.map((task) => ({ task, score: scoreTask(task) }));
  const active: TaskBlueprint[] = [];
  let userOwned = 0;

  const candidates = scored
    .filter(({ task }) => task.readiness === "ready" && task.dependsOnTaskIds.length === 0)
    .sort((left, right) => {
      if (right.score.total !== left.score.total) return right.score.total - left.score.total;
      return left.task.sequence - right.task.sequence;
    });

  for (const { task } of candidates) {
    if (active.length >= maxActiveTasks) break;
    if (task.owner === "user" && userOwned >= maxUserOwnedTasks) continue;
    active.push(task);
    if (task.owner === "user") userOwned += 1;
  }

  const activeIds = new Set(active.map((task) => task.id));
  const rankByTaskId = new Map(active.map((task, index) => [task.id, index + 1]));
  const sourceFingerprint = activeExecutionSliceSourceFingerprint(blueprint);
  const sliceTasks: ExecutionSliceTask[] = scored.map(({ task, score }) => {
    let decision: ExecutionSliceDecision = "queued";
    if (activeIds.has(task.id)) decision = "active";
    else if (task.readiness === "conditional") decision = "conditional";
    else if (task.readiness === "depends_on_blueprint" || task.dependsOnTaskIds.length > 0) decision = "blocked";
    else if ((task.owner === "user" && task.effort === "project") || score.total < 20) decision = "deferred";
    return {
      taskId: task.id,
      decision,
      score,
      reason: taskReason(task, decision, score),
      rank: rankByTaskId.get(task.id) || null,
      title: task.title,
      workstreamId: task.workstreamId,
      moduleId: task.moduleId,
      kind: task.kind,
      owner: task.owner,
      effort: task.effort,
      readiness: task.readiness,
      dependsOnTaskIds: [...task.dependsOnTaskIds],
      requirementIds: [...task.requirementIds],
      milestoneIds: [...task.milestoneIds],
      minimumOutcome: task.minimumOutcome,
      doneWhen: task.doneWhen,
      expectedEvidence: task.expectedEvidence,
      taskDraft: task.materialization.taskDraft,
    };
  });

  const byDecision = (decision: ExecutionSliceDecision) => sliceTasks.filter((task) => task.decision === decision).map((task) => task.taskId);
  const activeSliceTasks = sliceTasks.filter((task) => task.decision === "active");
  return {
    mode: "active_execution_slice_model",
    version: ACTIVE_EXECUTION_SLICE_VERSION,
    targetLabel: blueprint.targetLabel,
    executionBlueprintVersion: blueprint.version,
    executionBlueprintFingerprint: sourceFingerprint,
    sourceFingerprint,
    objective: `Select the smallest active execution slice for ${blueprint.targetLabel} without flooding Today or materializing blocked work.`,
    maxActiveTasks,
    maxUserOwnedTasks,
    activeTaskIds: byDecision("active"),
    queuedTaskIds: byDecision("queued"),
    blockedTaskIds: byDecision("blocked"),
    conditionalTaskIds: byDecision("conditional"),
    deferredTaskIds: byDecision("deferred"),
    tasks: sliceTasks,
    summary: {
      activeTaskCount: activeSliceTasks.length,
      queuedTaskCount: byDecision("queued").length,
      blockedTaskCount: byDecision("blocked").length,
      conditionalTaskCount: byDecision("conditional").length,
      deferredTaskCount: byDecision("deferred").length,
      activeAnchorOwnedCount: activeSliceTasks.filter((task) => task.owner === "anchor").length,
      activeSharedCount: activeSliceTasks.filter((task) => task.owner === "shared").length,
      activeUserOwnedCount: activeSliceTasks.filter((task) => task.owner === "user").length,
      totalSelectedSubtasks: activeSliceTasks.reduce((sum, task) => {
        const sourceTask = blueprint.tasks.find((candidate) => candidate.id === task.taskId);
        return sum + (sourceTask?.subtasks.length || 0);
      }, 0),
    },
    quality: buildQuality(sliceTasks, active, blueprint.tasks, maxUserOwnedTasks),
    materializationStatus: "slice_only",
    materializedTaskIds: [],
    generatedAt: Date.now(),
  };
}

export function activeSliceTaskById(model: ActiveExecutionSliceModel) {
  return new Map(model.tasks.map((task) => [task.taskId, task]));
}

export function selectedActiveTasks(model: ActiveExecutionSliceModel) {
  const selected = model.tasks.filter((task) => task.decision === "active");
  return selected.sort((left, right) => (left.rank || 999) - (right.rank || 999));
}

export function activeSliceCaveatSummary(model: ActiveExecutionSliceModel) {
  return uniqueStrings([
    ...model.quality.caveats,
    model.summary.blockedTaskCount ? `${model.summary.blockedTaskCount} blueprint task${model.summary.blockedTaskCount === 1 ? " is" : "s are"} blocked behind prerequisites.` : "",
    model.summary.conditionalTaskCount ? `${model.summary.conditionalTaskCount} role-specific task${model.summary.conditionalTaskCount === 1 ? " is" : "s are"} held until the route is active.` : "",
  ]);
}
