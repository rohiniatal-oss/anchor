import { createHash } from "node:crypto";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { CoverageModel } from "./trackResearchCoverageModel";
import type {
  DevelopmentPlanModel,
  RequirementDevelopmentDecision,
} from "./trackResearchDevelopmentPlan";
import type {
  BlueprintEffort,
  BlueprintOwner,
  ExecutionBlueprintModel,
  TaskBlueprint,
  TaskBlueprintKind,
} from "./trackResearchExecutionBlueprint";

export const EXECUTION_PRIORITY_VERSION = 1;
export const EXECUTION_PRIORITY_POLICY_VERSION = 1;
export const EXECUTION_BLUEPRINT_TASK_SOURCE_PREFIX = "execution_blueprint_task:";
export const DEFAULT_ACTIVE_SLICE_SIZE = 4;
export const MAX_ACTIVE_SLICE_SIZE = 5;

export type PrioritySlot = "now" | "active" | "next" | "parallel" | "later" | "blocked" | "conditional" | "completed";
export type PriorityDependencyState = "satisfied" | "active_prerequisite" | "selected_prerequisite" | "unmet" | "conditional";
export type PriorityLiveState = "not_materialized" | "open" | "completed" | "stale";
export type PriorityDeadlineKind = "job_deadline" | "learning_deadline" | "contact_follow_up";

export type PriorityLiveTaskSnapshot = {
  liveTaskId: number;
  blueprintTaskId: string | null;
  title: string;
  done: boolean;
  status: string;
  list: string;
  readiness: string;
  skipped: number;
  size: string;
  relatedTrackId: number | null;
  sourceStepType: string;
  createdAt: number;
};

export type PriorityDeadlineSignal = {
  kind: PriorityDeadlineKind;
  sourceType: "job" | "learn" | "contact";
  sourceId: number;
  label: string;
  dueDate: string;
  daysUntil: number;
  urgency: "high" | "medium" | "low";
};

export type ExecutionPriorityCapacity = {
  maxSelectedTasks: number;
  maxNewTasks: number;
  maxDeepOrProjectTasks: number;
  maxUserOwnedTasks: number;
  maxPerWorkstream: number;
};

export type ExecutionPriorityContext = {
  trackId: number;
  dayKey: string;
  trackPriority: number;
  trackStatus: string;
  liveTasks: PriorityLiveTaskSnapshot[];
  deadlineSignals: PriorityDeadlineSignal[];
  activeLoad: {
    globalOpen: number;
    globalToday: number;
    sameTrackOpen: number;
    currentBlueprintOpen: number;
    currentBlueprintCompleted: number;
    deepOrProjectOpen: number;
  };
  capacity: ExecutionPriorityCapacity;
  fingerprint: string;
  generatedAt: number;
};

export type PriorityScoreBreakdown = {
  strategicValue: number;
  evidenceValue: number;
  readinessValue: number;
  unlockValue: number;
  urgencyValue: number;
  continuityValue: number;
  effortFit: number;
  automationFit: number;
  loadPenalty: number;
  total: number;
};

export type PrioritizedBlueprintTask = {
  taskId: string;
  title: string;
  workstreamId: string;
  moduleId: string;
  requirementIds: string[];
  milestoneIds: string[];
  owner: BlueprintOwner;
  kind: TaskBlueprintKind;
  effort: BlueprintEffort;
  selected: boolean;
  rank: number;
  slot: PrioritySlot;
  dependencyState: PriorityDependencyState;
  dependencyTaskIds: string[];
  unmetDependencyTaskIds: string[];
  liveState: PriorityLiveState;
  liveTaskId: number | null;
  score: PriorityScoreBreakdown;
  whyNow: string;
  notNowReason: string;
  expectedEvidence: string;
  minimumOutcome: string;
  doneWhen: string;
};

export type ExecutionPriorityModel = {
  mode: "execution_priority_model";
  version: number;
  policyVersion: number;
  targetLabel: string;
  executionBlueprintVersion: number;
  executionBlueprintFingerprint: string;
  contextFingerprint: string;
  sourceFingerprint: string;
  objective: string;
  selectionLogic: string;
  candidates: PrioritizedBlueprintTask[];
  activeSlice: {
    status: "ready" | "at_capacity" | "no_ready_work" | "maintenance_only";
    maxTasks: number;
    selectedTaskIds: string[];
    nowTaskId: string | null;
    activeTaskIds: string[];
    nextTaskIds: string[];
    parallelTaskIds: string[];
    newTaskIds: string[];
    existingActiveTaskIds: string[];
    deferredTaskCount: number;
    estimatedMinutes: number;
    deepOrProjectTaskCount: number;
    userOwnedTaskCount: number;
    workstreamIds: string[];
  };
  materialization: {
    status: "not_materialized" | "partially_materialized" | "active" | "complete";
    mappings: Array<{
      blueprintTaskId: string;
      liveTaskId: number;
      state: "open" | "completed";
    }>;
    activeLiveTaskIds: number[];
    completedLiveTaskIds: number[];
    staleLiveTaskIds: number[];
  };
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    selectedDependencyCoverage: number;
    blockedSelectedTaskIds: string[];
    conditionalSelectedTaskIds: string[];
    duplicateSelectedTaskIds: string[];
    overCapacityBy: number;
    caveats: string[];
  };
  generatedAt: number;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(compact).filter(Boolean)) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function sourceStepTypeForBlueprintTask(blueprintTaskId: string): string {
  return `${EXECUTION_BLUEPRINT_TASK_SOURCE_PREFIX}${compact(blueprintTaskId)}`;
}

export function blueprintTaskIdFromSourceStepType(value: unknown): string | null {
  const text = compact(value);
  if (!text.startsWith(EXECUTION_BLUEPRINT_TASK_SOURCE_PREFIX)) return null;
  const id = text.slice(EXECUTION_BLUEPRINT_TASK_SOURCE_PREFIX.length).trim();
  return id || null;
}

function effortMinutes(effort: BlueprintEffort): number {
  if (effort === "quick") return 15;
  if (effort === "medium") return 45;
  if (effort === "deep") return 90;
  return 180;
}

function importancePoints(requirement: TargetRequirement): number {
  if (requirement.importance === "essential") return 14;
  if (requirement.importance === "important") return 10;
  if (requirement.importance === "differentiator") return 5;
  return 2;
}

function actionPoints(decision: RequirementDevelopmentDecision | undefined): number {
  if (!decision) return 0;
  if (decision.action === "verify") return 10;
  if (decision.action === "build") return 8;
  if (decision.action === "strengthen") return 7;
  if (decision.action === "demonstrate") return 7;
  return 0;
}

function coveragePoints(decision: RequirementDevelopmentDecision | undefined): number {
  if (!decision) return 0;
  if (decision.coverageStatus === "below_bar") return 9;
  if (decision.coverageStatus === "unproven") return 8;
  if (decision.coverageStatus === "unknown") return 7;
  if (decision.coverageStatus === "partially_proven") return 5;
  return 0;
}

function strategicValue(
  task: TaskBlueprint,
  requirementById: Map<string, TargetRequirement>,
  decisionById: Map<string, RequirementDevelopmentDecision>,
): number {
  const requirements = task.requirementIds
    .map((id) => requirementById.get(id))
    .filter(Boolean) as TargetRequirement[];
  const primaryImportance = Math.max(0, ...requirements.map(importancePoints));
  const breadth = Math.min(6, Math.max(0, requirements.length - 1) * 2);
  const action = Math.max(0, ...task.requirementIds.map((id) => actionPoints(decisionById.get(id))));
  const coverage = Math.max(0, ...task.requirementIds.map((id) => coveragePoints(decisionById.get(id))));
  return clamp(primaryImportance + breadth + Math.max(action, coverage), 0, 30);
}

function evidenceValue(task: TaskBlueprint): number {
  const kindPoints: Record<TaskBlueprintKind, number> = {
    validation: 20,
    artifact: 19,
    experience: 18,
    access: 17,
    relationship: 15,
    practice: 15,
    verification: 14,
    credential: 13,
    learning: 11,
    research: 8,
  };
  const milestoneBonus = Math.min(4, task.milestoneIds.length * 2);
  const multiRequirementBonus = Math.min(3, Math.max(0, task.requirementIds.length - 1));
  return clamp(kindPoints[task.kind] + milestoneBonus + multiRequirementBonus, 0, 24);
}

function descendants(taskId: string, taskById: Map<string, TaskBlueprint>): number {
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const task of taskById.values()) {
      if (!task.dependsOnTaskIds.includes(id) || seen.has(task.id)) continue;
      seen.add(task.id);
      visit(task.id);
    }
  };
  visit(taskId);
  return seen.size;
}

function unlockValue(task: TaskBlueprint, taskById: Map<string, TaskBlueprint>): number {
  // Being a blocker is useful only insofar as it unlocks meaningful downstream
  // work. It is deliberately capped below strategic and evidence value.
  return clamp(descendants(task.id, taskById) * 3, 0, 12);
}

function signalMatchesTask(signal: PriorityDeadlineSignal, task: TaskBlueprint): boolean {
  if (signal.kind === "job_deadline") {
    return ["artifact", "validation", "access", "relationship", "experience"].includes(task.kind);
  }
  if (signal.kind === "learning_deadline") {
    return ["credential", "learning", "practice", "research", "verification"].includes(task.kind);
  }
  return task.kind === "relationship" || task.kind === "access";
}

function urgencyValue(task: TaskBlueprint, signals: PriorityDeadlineSignal[]): number {
  let score = 0;
  for (const signal of signals) {
    const base = signal.urgency === "high" ? 12 : signal.urgency === "medium" ? 7 : 3;
    const value = signalMatchesTask(signal, task) ? base : Math.floor(base / 3);
    score = Math.max(score, value);
  }
  return clamp(score, 0, 12);
}

function effortFit(effort: BlueprintEffort): number {
  if (effort === "quick") return 8;
  if (effort === "medium") return 7;
  if (effort === "deep") return 5;
  return 3;
}

function automationFit(owner: BlueprintOwner): number {
  if (owner === "anchor") return 4;
  if (owner === "shared") return 3;
  return 1;
}

function liveSnapshotForTask(
  taskId: string,
  context: ExecutionPriorityContext,
): PriorityLiveTaskSnapshot | null {
  const candidates = context.liveTasks.filter((task) => task.blueprintTaskId === taskId);
  return candidates.sort((left, right) => {
    const leftOpen = !left.done && left.status !== "done" ? 1 : 0;
    const rightOpen = !right.done && right.status !== "done" ? 1 : 0;
    return rightOpen - leftOpen || right.createdAt - left.createdAt;
  })[0] || null;
}

function liveStateFor(taskId: string, context: ExecutionPriorityContext): PriorityLiveState {
  const snapshot = liveSnapshotForTask(taskId, context);
  if (!snapshot) return "not_materialized";
  return snapshot.done || snapshot.status === "done" ? "completed" : "open";
}

function continuityValue(snapshot: PriorityLiveTaskSnapshot | null): number {
  if (!snapshot || snapshot.done || snapshot.status === "done") return 0;
  let score = 7;
  if (snapshot.status === "in_progress") score += 4;
  if (snapshot.list === "today") score += 2;
  if (snapshot.skipped >= 2) score -= 4;
  return clamp(score, -4, 13);
}

function loadPenalty(
  task: TaskBlueprint,
  context: ExecutionPriorityContext,
  liveState: PriorityLiveState,
): number {
  if (liveState === "open") return 0;
  let penalty = 0;
  if (context.activeLoad.sameTrackOpen >= context.capacity.maxSelectedTasks) penalty -= 18;
  else if (context.activeLoad.sameTrackOpen >= context.capacity.maxSelectedTasks - 1) penalty -= 8;
  if (context.activeLoad.globalOpen >= 20) penalty -= 5;
  if (task.owner === "user" && context.activeLoad.deepOrProjectOpen >= context.capacity.maxDeepOrProjectTasks) penalty -= 4;
  return penalty;
}

function dependencyState(
  task: TaskBlueprint,
  completedIds: Set<string>,
  openIds: Set<string>,
  selectedIds: Set<string>,
): { state: PriorityDependencyState; unmet: string[] } {
  if (task.readiness === "conditional") return { state: "conditional", unmet: [...task.dependsOnTaskIds] };
  const unmet = task.dependsOnTaskIds.filter((id) => !completedIds.has(id) && !openIds.has(id) && !selectedIds.has(id));
  if (unmet.length) return { state: "unmet", unmet };
  if (task.dependsOnTaskIds.some((id) => selectedIds.has(id))) return { state: "selected_prerequisite", unmet: [] };
  if (task.dependsOnTaskIds.some((id) => openIds.has(id))) return { state: "active_prerequisite", unmet: [] };
  return { state: "satisfied", unmet: [] };
}

function readinessValue(state: PriorityDependencyState): number {
  if (state === "satisfied") return 16;
  if (state === "active_prerequisite") return 11;
  if (state === "selected_prerequisite") return 8;
  if (state === "conditional") return -20;
  return 0;
}

function scoreTask(
  task: TaskBlueprint,
  requirementById: Map<string, TargetRequirement>,
  decisionById: Map<string, RequirementDevelopmentDecision>,
  taskById: Map<string, TaskBlueprint>,
  context: ExecutionPriorityContext,
  completedIds: Set<string>,
  openIds: Set<string>,
  selectedIds = new Set<string>(),
): { breakdown: PriorityScoreBreakdown; dependency: ReturnType<typeof dependencyState>; liveState: PriorityLiveState; liveTask: PriorityLiveTaskSnapshot | null } {
  const liveTask = liveSnapshotForTask(task.id, context);
  const liveState = liveStateFor(task.id, context);
  const dependency = dependencyState(task, completedIds, openIds, selectedIds);
  const breakdown: PriorityScoreBreakdown = {
    strategicValue: strategicValue(task, requirementById, decisionById),
    evidenceValue: evidenceValue(task),
    readinessValue: readinessValue(dependency.state),
    unlockValue: unlockValue(task, taskById),
    urgencyValue: urgencyValue(task, context.deadlineSignals),
    continuityValue: continuityValue(liveTask),
    effortFit: effortFit(task.effort),
    automationFit: automationFit(task.owner),
    loadPenalty: loadPenalty(task, context, liveState),
    total: 0,
  };
  breakdown.total = Object.entries(breakdown)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
  return { breakdown, dependency, liveState, liveTask };
}

function dimensionReason(score: PriorityScoreBreakdown): string[] {
  const dimensions: Array<[string, number, string]> = [
    ["strategicValue", score.strategicValue, "serves a material target requirement"],
    ["evidenceValue", score.evidenceValue, "creates strong reusable evidence"],
    ["readinessValue", score.readinessValue, "is structurally ready"],
    ["urgencyValue", score.urgencyValue, "responds to a current deadline signal"],
    ["unlockValue", score.unlockValue, "unlocks useful downstream work"],
    ["continuityValue", score.continuityValue, "preserves work already in motion"],
    ["effortFit", score.effortFit, "has a manageable starting outcome"],
    ["automationFit", score.automationFit, "lets Anchor reduce the user's execution load"],
  ];
  return dimensions
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([, , reason]) => reason);
}

function whySelected(task: TaskBlueprint, score: PriorityScoreBreakdown, liveState: PriorityLiveState): string {
  if (liveState === "open") return "This blueprint task is already active, so Anchor preserves continuity instead of creating a competing replacement.";
  const reasons = dimensionReason(score);
  if (!reasons.length) return "This is the strongest eligible next step after dependencies and capacity are applied.";
  return `Selected because it ${reasons.join(", ")}.`;
}

function whyDeferred(
  task: TaskBlueprint,
  dependency: ReturnType<typeof dependencyState>,
  liveState: PriorityLiveState,
  selectedCount: number,
  capacity: ExecutionPriorityCapacity,
): string {
  if (liveState === "completed") return "Already completed; no new task should be created.";
  if (task.readiness === "conditional") return "Held outside the active slice until the relevant role-specific route is active.";
  if (dependency.state === "unmet") return "A logical prerequisite must be completed or selected first.";
  if (selectedCount >= capacity.maxSelectedTasks) return "Deferred to keep the active slice small enough to execute.";
  return "Useful later, but lower-value than the selected slice after strategic value, evidence, readiness, urgency, effort and load are considered together.";
}

function deepTask(task: TaskBlueprint): boolean {
  return task.effort === "deep" || task.effort === "project";
}

function activeTaskOrder(snapshot: PriorityLiveTaskSnapshot | null): number {
  if (!snapshot) return 0;
  if (snapshot.status === "in_progress") return 4;
  if (snapshot.list === "today") return 3;
  if (snapshot.readiness === "ready") return 2;
  return 1;
}

function canSelectWithCapacity(
  task: TaskBlueprint,
  selectedTasks: TaskBlueprint[],
  context: ExecutionPriorityContext,
): boolean {
  if (selectedTasks.length >= context.capacity.maxSelectedTasks) return false;
  const deepCount = selectedTasks.filter(deepTask).length;
  if (deepTask(task) && deepCount >= context.capacity.maxDeepOrProjectTasks) return false;
  const userOwnedCount = selectedTasks.filter((candidate) => candidate.owner === "user").length;
  if (task.owner === "user" && userOwnedCount >= context.capacity.maxUserOwnedTasks) return false;
  const sameWorkstream = selectedTasks.filter((candidate) => candidate.workstreamId === task.workstreamId).length;
  if (sameWorkstream >= context.capacity.maxPerWorkstream) return false;
  return true;
}

function chooseNowTask(
  selectedTasks: TaskBlueprint[],
  context: ExecutionPriorityContext,
  completedIds: Set<string>,
  openIds: Set<string>,
): string | null {
  const active = selectedTasks
    .map((task) => ({ task, snapshot: liveSnapshotForTask(task.id, context) }))
    .filter(({ snapshot }) => snapshot && !snapshot.done && snapshot.status !== "done")
    .sort((left, right) => activeTaskOrder(right.snapshot) - activeTaskOrder(left.snapshot));
  if (active[0]) return active[0].task.id;
  const ready = selectedTasks.find((task) => dependencyState(task, completedIds, openIds, new Set()).state === "satisfied");
  return ready?.id || selectedTasks[0]?.id || null;
}

function materializationStatus(
  selectedIds: string[],
  context: ExecutionPriorityContext,
): ExecutionPriorityModel["materialization"]["status"] {
  if (!selectedIds.length) return "complete";
  const states = selectedIds.map((id) => liveStateFor(id, context));
  if (states.every((state) => state === "completed")) return "complete";
  if (states.every((state) => state === "open" || state === "completed")) return "active";
  if (states.some((state) => state === "open" || state === "completed")) return "partially_materialized";
  return "not_materialized";
}

export function executionPrioritySourceFingerprint(
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
): string {
  return hash({
    policyVersion: EXECUTION_PRIORITY_POLICY_VERSION,
    blueprintVersion: blueprint.version,
    blueprintFingerprint: blueprint.sourceFingerprint,
    contextFingerprint: context.fingerprint,
  });
}

export function buildExecutionPriorityModel(input: {
  requirementModel: RequirementModel;
  coverageModel: CoverageModel;
  developmentPlanModel: DevelopmentPlanModel;
  executionBlueprintModel: ExecutionBlueprintModel;
  context: ExecutionPriorityContext;
}): ExecutionPriorityModel {
  const { requirementModel, developmentPlanModel, executionBlueprintModel: blueprint, context } = input;
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const decisionById = new Map(developmentPlanModel.decisions.map((decision) => [decision.requirementId, decision]));
  const taskById = new Map(blueprint.tasks.map((task) => [task.id, task]));
  const currentTaskIds = new Set(blueprint.tasks.map((task) => task.id));
  const completedIds = new Set(blueprint.tasks.filter((task) => liveStateFor(task.id, context) === "completed").map((task) => task.id));
  const openIds = new Set(blueprint.tasks.filter((task) => liveStateFor(task.id, context) === "open").map((task) => task.id));

  const staticScores = new Map<string, ReturnType<typeof scoreTask>>();
  for (const task of blueprint.tasks) {
    staticScores.set(task.id, scoreTask(task, requirementById, decisionById, taskById, context, completedIds, openIds));
  }

  const existingOpenTasks = blueprint.tasks
    .filter((task) => openIds.has(task.id))
    .sort((left, right) => {
      const leftSnapshot = liveSnapshotForTask(left.id, context);
      const rightSnapshot = liveSnapshotForTask(right.id, context);
      return activeTaskOrder(rightSnapshot) - activeTaskOrder(leftSnapshot)
        || (staticScores.get(right.id)?.breakdown.total || 0) - (staticScores.get(left.id)?.breakdown.total || 0);
    });

  const selected: TaskBlueprint[] = [...existingOpenTasks];
  const selectedIds = new Set(selected.map((task) => task.id));
  const selectionLimit = Math.max(context.capacity.maxSelectedTasks, selected.length);

  while (selected.length < selectionLimit) {
    const available = blueprint.tasks
      .filter((task) => !selectedIds.has(task.id) && !completedIds.has(task.id) && task.readiness !== "conditional")
      .map((task) => ({
        task,
        scored: scoreTask(task, requirementById, decisionById, taskById, context, completedIds, openIds, selectedIds),
      }))
      .filter(({ scored }) => scored.dependency.state !== "unmet")
      .filter(({ task }) => canSelectWithCapacity(task, selected, context))
      .map(({ task, scored }) => {
        const workstreamDiversity = selected.some((candidate) => candidate.workstreamId === task.workstreamId) ? 0 : 5;
        const ownerDiversity = selected.some((candidate) => candidate.owner === task.owner) ? 0 : 2;
        const dependencyContinuation = scored.dependency.state === "selected_prerequisite" ? 2 : 0;
        return { task, scored, adjusted: scored.breakdown.total + workstreamDiversity + ownerDiversity + dependencyContinuation };
      })
      .sort((left, right) => right.adjusted - left.adjusted || left.task.sequence - right.task.sequence);

    const next = available[0]?.task;
    if (!next) break;
    selected.push(next);
    selectedIds.add(next.id);
  }

  const nowTaskId = chooseNowTask(selected, context, completedIds, openIds);
  const selectedOrder = new Map(selected.map((task, index) => [task.id, index + 1]));
  const candidates = blueprint.tasks.map((task) => {
    const scored = scoreTask(task, requirementById, decisionById, taskById, context, completedIds, openIds, selectedIds);
    const selectedTask = selectedIds.has(task.id);
    const liveState = scored.liveState;
    let slot: PrioritySlot;
    if (liveState === "completed") slot = "completed";
    else if (task.id === nowTaskId) slot = "now";
    else if (selectedTask && liveState === "open") slot = "active";
    else if (selectedTask && scored.dependency.state === "selected_prerequisite") slot = "next";
    else if (selectedTask) slot = "parallel";
    else if (task.readiness === "conditional") slot = "conditional";
    else if (scored.dependency.state === "unmet") slot = "blocked";
    else slot = "later";

    return {
      taskId: task.id,
      title: task.title,
      workstreamId: task.workstreamId,
      moduleId: task.moduleId,
      requirementIds: task.requirementIds,
      milestoneIds: task.milestoneIds,
      owner: task.owner,
      kind: task.kind,
      effort: task.effort,
      selected: selectedTask,
      rank: selectedOrder.get(task.id) || 0,
      slot,
      dependencyState: scored.dependency.state,
      dependencyTaskIds: task.dependsOnTaskIds,
      unmetDependencyTaskIds: scored.dependency.unmet,
      liveState,
      liveTaskId: scored.liveTask?.liveTaskId || null,
      score: scored.breakdown,
      whyNow: selectedTask ? whySelected(task, scored.breakdown, liveState) : "",
      notNowReason: selectedTask ? "" : whyDeferred(task, scored.dependency, liveState, selected.length, context.capacity),
      expectedEvidence: task.expectedEvidence,
      minimumOutcome: task.minimumOutcome,
      doneWhen: task.doneWhen,
    } satisfies PrioritizedBlueprintTask;
  }).sort((left, right) => {
    if (left.selected !== right.selected) return left.selected ? -1 : 1;
    if (left.selected && right.selected) return left.rank - right.rank;
    return right.score.total - left.score.total || left.title.localeCompare(right.title);
  });

  const activeTaskIds = selected.filter((task) => openIds.has(task.id)).map((task) => task.id);
  const newTaskIds = selected.filter((task) => !openIds.has(task.id) && !completedIds.has(task.id)).map((task) => task.id);
  const nextTaskIds = candidates.filter((candidate) => candidate.slot === "next").map((candidate) => candidate.taskId);
  const parallelTaskIds = candidates.filter((candidate) => candidate.slot === "parallel").map((candidate) => candidate.taskId);
  const staleLiveTasks = context.liveTasks.filter((task) => task.relatedTrackId === context.trackId && task.blueprintTaskId && !currentTaskIds.has(task.blueprintTaskId));
  const mappings = context.liveTasks
    .filter((task) => task.blueprintTaskId && currentTaskIds.has(task.blueprintTaskId))
    .map((task) => ({
      blueprintTaskId: task.blueprintTaskId!,
      liveTaskId: task.liveTaskId,
      state: task.done || task.status === "done" ? "completed" as const : "open" as const,
    }));
  const selectedDependencyCoverage = selected.length
    ? Math.round((selected.filter((task) => dependencyState(task, completedIds, openIds, selectedIds).state !== "unmet").length / selected.length) * 100)
    : 100;
  const blockedSelectedTaskIds = selected.filter((task) => dependencyState(task, completedIds, openIds, selectedIds).state === "unmet").map((task) => task.id);
  const conditionalSelectedTaskIds = selected.filter((task) => task.readiness === "conditional").map((task) => task.id);
  const duplicateSelectedTaskIds = selected.filter((task, index, all) => all.findIndex((candidate) => candidate.id === task.id) !== index).map((task) => task.id);
  const overCapacityBy = Math.max(0, selected.length - context.capacity.maxSelectedTasks);
  const caveats: string[] = [];
  if (overCapacityBy > 0) caveats.push(`${overCapacityBy} existing active blueprint task${overCapacityBy === 1 ? " exceeds" : "s exceed"} the preferred active-slice capacity; Anchor preserved them rather than silently parking user work.`);
  if (context.activeLoad.globalOpen >= 20) caveats.push("The wider task system is heavily loaded, so the selection favors smaller, higher-evidence work and creates fewer new tasks.");
  if (staleLiveTasks.length) caveats.push(`${staleLiveTasks.length} open task${staleLiveTasks.length === 1 ? " comes" : "s come"} from an older blueprint and were left untouched for user safety.`);
  if (blockedSelectedTaskIds.length) caveats.push("A selected task has an unmet prerequisite and should not be materialized yet.");
  if (conditionalSelectedTaskIds.length) caveats.push("A role-specific task entered the shared active slice unexpectedly.");
  if (duplicateSelectedTaskIds.length) caveats.push("The selected slice contains a duplicate blueprint task.");
  const qualityStatus = !blockedSelectedTaskIds.length && !conditionalSelectedTaskIds.length && !duplicateSelectedTaskIds.length
    ? overCapacityBy > 0 || staleLiveTasks.length ? "usable_with_caveats" : "complete"
    : selectedDependencyCoverage >= 80 ? "usable_with_caveats" : "provisional";
  const status: ExecutionPriorityModel["activeSlice"]["status"] = !blueprint.tasks.length
    ? "maintenance_only"
    : selected.length === 0
      ? "no_ready_work"
      : existingOpenTasks.length >= context.capacity.maxSelectedTasks
        ? "at_capacity"
        : "ready";
  const sourceFingerprint = executionPrioritySourceFingerprint(blueprint, context);

  return {
    mode: "execution_priority_model",
    version: EXECUTION_PRIORITY_VERSION,
    policyVersion: EXECUTION_PRIORITY_POLICY_VERSION,
    targetLabel: blueprint.targetLabel,
    executionBlueprintVersion: blueprint.version,
    executionBlueprintFingerprint: blueprint.sourceFingerprint,
    contextFingerprint: context.fingerprint,
    sourceFingerprint,
    objective: `Select the smallest high-value execution slice for ${blueprint.targetLabel} without losing the complete blueprint or flooding the live task system.`,
    selectionLogic: "Anchor evaluates strategic requirement value, evidence created, readiness, urgency, continuity, effort and downstream leverage together. Blocking alone cannot make a low-value task important.",
    candidates,
    activeSlice: {
      status,
      maxTasks: context.capacity.maxSelectedTasks,
      selectedTaskIds: selected.map((task) => task.id),
      nowTaskId,
      activeTaskIds,
      nextTaskIds,
      parallelTaskIds,
      newTaskIds,
      existingActiveTaskIds: [...openIds].filter((id) => selectedIds.has(id)),
      deferredTaskCount: candidates.filter((candidate) => !candidate.selected && candidate.slot !== "completed").length,
      estimatedMinutes: selected.reduce((sum, task) => sum + effortMinutes(task.effort), 0),
      deepOrProjectTaskCount: selected.filter(deepTask).length,
      userOwnedTaskCount: selected.filter((task) => task.owner === "user").length,
      workstreamIds: uniqueStrings(selected.map((task) => task.workstreamId)),
    },
    materialization: {
      status: materializationStatus(selected.map((task) => task.id), context),
      mappings,
      activeLiveTaskIds: mappings.filter((mapping) => mapping.state === "open").map((mapping) => mapping.liveTaskId),
      completedLiveTaskIds: mappings.filter((mapping) => mapping.state === "completed").map((mapping) => mapping.liveTaskId),
      staleLiveTaskIds: staleLiveTasks.map((task) => task.liveTaskId),
    },
    quality: {
      status: qualityStatus,
      selectedDependencyCoverage,
      blockedSelectedTaskIds,
      conditionalSelectedTaskIds,
      duplicateSelectedTaskIds,
      overCapacityBy,
      caveats,
    },
    generatedAt: Date.now(),
  };
}
