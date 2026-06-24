import { createHash } from "node:crypto";
import type { Contact, DayPlan, Job, Learn, Task } from "@shared/schema";
import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import type { DevelopmentAction, DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import type { ExecutionBlueprintModel, TaskBlueprint } from "./trackResearchExecutionBlueprint";
import type { RequirementImportance, RequirementModel } from "./trackResearchRequirementModel";

export const EXECUTION_PRIORITY_MODEL_VERSION = 1;
export const EXECUTION_ACTIVATION_STATE_VERSION = 1;
export const MAX_ACTIVE_USER_TASKS = 3;
export const MAX_SELECTED_BLUEPRINT_TASKS = 5;
export const MAX_ANCHOR_AUTOMATIONS_PER_ACTIVATION = 2;

export type PriorityTaskState = "completed" | "materialized" | "eligible" | "blocked" | "conditional" | "parked";
export type PrioritySlot = "now" | "next" | "support";
export type ActiveSliceAction = "continue_live_task" | "prepare_by_anchor" | "prepare_then_materialize" | "materialize_user_task";
export type ActivationRecordStatus = "completed_by_anchor" | "prepared" | "materialized" | "completed" | "needs_user_input" | "failed";

export type AnchorPreparationArtifact = {
  id: string;
  blueprintTaskId: string;
  title: string;
  summary: string;
  outputMarkdown: string;
  sources: Array<{ title: string; url: string }>;
  completedSubtaskIds: string[];
  needsUserInput: boolean;
  focusedQuestion: string;
  confidence: "high" | "medium" | "low";
  generatedAt: number;
};

export type ExecutionActivationRecord = {
  blueprintTaskId: string;
  blueprintFingerprint: string;
  status: ActivationRecordStatus;
  liveTaskId: number | null;
  preparation: AnchorPreparationArtifact | null;
  error: string;
  updatedAt: number;
};

export type ExecutionActivationState = {
  mode: "execution_activation_state";
  version: number;
  blueprintFingerprint: string;
  records: ExecutionActivationRecord[];
  generatedAt: number;
};

export type PriorityDimensionScores = {
  requirementValue: number;
  evidenceValue: number;
  unlockValue: number;
  urgency: number;
  executionFit: number;
  continuity: number;
  riskPenalty: number;
};

export type BlueprintTaskScorecard = {
  blueprintTaskId: string;
  state: PriorityTaskState;
  score: number;
  dimensions: PriorityDimensionScores;
  reasons: string[];
  liveTaskId: number | null;
  incompleteDependencyIds: string[];
  downstreamTaskIds: string[];
};

export type ActiveExecutionSliceItem = {
  rank: number;
  slot: PrioritySlot;
  blueprintTaskId: string;
  liveTaskId: number | null;
  action: ActiveSliceAction;
  score: number;
  reason: string;
  title: string;
  owner: TaskBlueprint["owner"];
  effort: TaskBlueprint["effort"];
  expectedEvidence: string;
  workstreamId: string;
  moduleId: string;
};

export type ExecutionPriorityModel = {
  mode: "execution_priority_model";
  version: number;
  trackId: number;
  targetLabel: string;
  executionBlueprintVersion: number;
  executionBlueprintFingerprint: string;
  contextFingerprint: string;
  sourceFingerprint: string;
  objective: string;
  policy: {
    maxSelectedTasks: number;
    maxUserVisibleTasks: number;
    maxAnchorAutomationsPerActivation: number;
    conditionalTasksActivateAutomatically: false;
    prioritiesCreated: true;
    scheduleCreated: false;
  };
  activeSlice: ActiveExecutionSliceItem[];
  scorecards: BlueprintTaskScorecard[];
  completedBlueprintTaskIds: string[];
  materializedBlueprintTaskIds: string[];
  parkedBlueprintTaskIds: string[];
  conditionalBlueprintTaskIds: string[];
  summary: {
    totalBlueprintTasks: number;
    completedTasks: number;
    activeLiveTasks: number;
    eligibleTasks: number;
    blockedTasks: number;
    conditionalTasks: number;
    selectedTasks: number;
    selectedUserVisibleTasks: number;
    selectedAnchorTasks: number;
  };
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    selectedBlockedTaskIds: string[];
    selectedConditionalTaskIds: string[];
    duplicateSelectedTaskIds: string[];
    userTaskLimitExceeded: boolean;
    caveats: string[];
  };
  generatedAt: number;
};

export type ExecutionPriorityContext = {
  trackId: number;
  tasks: Task[];
  jobs: Job[];
  learn: Learn[];
  contacts: Contact[];
  dayPlan: DayPlan | null;
  activationState: ExecutionActivationState | null;
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

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function blueprintTaskSourceStepType(blueprintTaskId: string): string {
  return `execution_blueprint_task:${blueprintTaskId}`;
}

export function blueprintTaskIdFromLiveTask(task: Pick<Task, "sourceType" | "sourceId" | "sourceStepType" | "sourceNote">): string | null {
  if (task.sourceType !== "career_track") return null;
  const prefix = "execution_blueprint_task:";
  if (String(task.sourceStepType || "").startsWith(prefix)) {
    return String(task.sourceStepType).slice(prefix.length) || null;
  }
  const metadata = parseJsonObject(task.sourceNote);
  return compact(metadata.blueprintTaskId) || null;
}

function daysUntil(value: unknown): number | null {
  const text = compact(value);
  if (!text) return null;
  const timestamp = new Date(text.length === 10 ? `${text}T23:59:59` : text).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.ceil((timestamp - Date.now()) / 86_400_000);
}

function requirementWeight(value: RequirementImportance): number {
  if (value === "essential") return 14;
  if (value === "important") return 10;
  if (value === "differentiator") return 5;
  return 2;
}

function coverageWeight(value: CoverageStatus): number {
  if (value === "below_bar") return 13;
  if (value === "unproven") return 12;
  if (value === "unknown") return 10;
  if (value === "partially_proven") return 8;
  return 0;
}

function actionWeight(value: DevelopmentAction): number {
  if (value === "build") return 7;
  if (value === "demonstrate") return 7;
  if (value === "strengthen") return 6;
  if (value === "verify") return 5;
  return 0;
}

function evidenceWeight(task: TaskBlueprint): number {
  const weights: Record<TaskBlueprint["kind"], number> = {
    artifact: 14,
    validation: 14,
    experience: 13,
    practice: 12,
    relationship: 11,
    access: 11,
    learning: 10,
    credential: 9,
    verification: 8,
    research: 7,
  };
  return Math.min(18, weights[task.kind] + Math.min(4, task.milestoneIds.length * 2));
}

function effortFit(task: TaskBlueprint, dayPlan: DayPlan | null): number {
  const base: Record<TaskBlueprint["effort"], number> = { quick: 8, medium: 6, deep: 2, project: -2 };
  const energy = normalize(dayPlan?.energy);
  if (energy === "low" && (task.effort === "deep" || task.effort === "project")) return base[task.effort] - 7;
  if (energy === "high" && (task.effort === "deep" || task.effort === "project")) return base[task.effort] + 3;
  return base[task.effort];
}

function urgencyForTask(
  task: TaskBlueprint,
  context: ExecutionPriorityContext,
  liveTask: Task | undefined,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const directDays = daysUntil(liveTask?.deadline);
  if (directDays != null && directDays >= 0) {
    const value = directDays <= 1 ? 22 : directDays <= 5 ? 16 : directDays <= 14 ? 9 : 0;
    if (value) {
      score = Math.max(score, value);
      reasons.push(directDays <= 1 ? "has an immediate deadline" : `has a deadline in ${directDays} days`);
    }
  }

  const actionableJobs = context.jobs.filter((job) => job.relatedTrackId === context.trackId
    && !["closed", "archived", "rejected", "withdrawn"].includes(normalize(job.status))
    && normalize(job.applicationWindowStatus) !== "closed");
  const nearestJob = actionableJobs
    .map((job) => ({ job, days: daysUntil(job.deadline) }))
    .filter((item): item is { job: Job; days: number } => item.days != null && item.days >= 0)
    .sort((left, right) => left.days - right.days)[0];
  if (nearestJob && ["artifact", "validation", "relationship", "access", "research"].includes(task.kind)) {
    const value = nearestJob.days <= 2 ? 18 : nearestJob.days <= 7 ? 12 : nearestJob.days <= 14 ? 7 : 0;
    if (value > score) score = value;
    if (value) reasons.push(`supports a live opportunity closing in ${nearestJob.days} days`);
  }

  const nearestLearningDeadline = context.learn
    .filter((item) => item.relatedTrackId === context.trackId && !["done", "closed"].includes(normalize(item.learnStatus)))
    .map((item) => ({ item, days: daysUntil(item.applicationDeadline) }))
    .filter((entry): entry is { item: Learn; days: number } => entry.days != null && entry.days >= 0)
    .sort((left, right) => left.days - right.days)[0];
  if (nearestLearningDeadline && ["learning", "credential", "research"].includes(task.kind)) {
    const value = nearestLearningDeadline.days <= 2 ? 16 : nearestLearningDeadline.days <= 7 ? 10 : 5;
    if (value > score) score = value;
    reasons.push(`supports a learning or qualification window in ${nearestLearningDeadline.days} days`);
  }

  if (["relationship", "access"].includes(task.kind)) {
    const overdue = context.contacts.filter((contact) => {
      if (contact.relatedTrackId !== context.trackId) return false;
      const days = daysUntil(contact.nextFollowUpDate);
      return days != null && days < 0 && !["archived", "cold"].includes(normalize(contact.status));
    }).length;
    if (overdue) {
      score = Math.max(score, Math.min(12, 6 + overdue * 2));
      reasons.push(`${overdue} relevant follow-up${overdue === 1 ? " is" : "s are"} overdue`);
    }
  }

  return { score: Math.min(24, score), reasons: uniqueStrings(reasons) };
}

function descendants(taskId: string, tasks: TaskBlueprint[]): string[] {
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependencyId of task.dependsOnTaskIds) {
      children.set(dependencyId, [...(children.get(dependencyId) || []), task.id]);
    }
  }
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const child of children.get(id) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      visit(child);
    }
  };
  visit(taskId);
  return [...seen];
}

function currentActivationState(
  blueprintFingerprint: string,
  value: ExecutionActivationState | null,
): ExecutionActivationState {
  if (value?.mode === "execution_activation_state"
    && value.version === EXECUTION_ACTIVATION_STATE_VERSION
    && value.blueprintFingerprint === blueprintFingerprint
    && Array.isArray(value.records)) return value;
  return {
    mode: "execution_activation_state",
    version: EXECUTION_ACTIVATION_STATE_VERSION,
    blueprintFingerprint,
    records: [],
    generatedAt: Date.now(),
  };
}

function mappedLiveTasks(context: ExecutionPriorityContext): Map<string, Task> {
  const mapped = new Map<string, Task>();
  for (const task of context.tasks) {
    if (task.sourceId !== context.trackId) continue;
    const blueprintTaskId = blueprintTaskIdFromLiveTask(task);
    if (!blueprintTaskId) continue;
    const existing = mapped.get(blueprintTaskId);
    if (!existing || Number(task.createdAt || 0) > Number(existing.createdAt || 0)) mapped.set(blueprintTaskId, task);
  }
  return mapped;
}

function completedIds(
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
): Set<string> {
  const mapped = mappedLiveTasks(context);
  const activation = currentActivationState(blueprint.sourceFingerprint, context.activationState);
  const completed = new Set<string>();
  for (const task of blueprint.tasks) {
    const live = mapped.get(task.id);
    if (live?.done || live?.status === "done") completed.add(task.id);
    const record = activation.records.find((item) => item.blueprintTaskId === task.id);
    if (record?.status === "completed_by_anchor" || record?.status === "completed") completed.add(task.id);
  }
  return completed;
}

function taskState(
  task: TaskBlueprint,
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
  completed: Set<string>,
  liveTask: Task | undefined,
): { state: PriorityTaskState; incompleteDependencyIds: string[] } {
  if (completed.has(task.id)) return { state: "completed", incompleteDependencyIds: [] };
  if (liveTask && !liveTask.done && liveTask.status !== "done") return { state: "materialized", incompleteDependencyIds: [] };
  if (task.readiness === "conditional") return { state: "conditional", incompleteDependencyIds: [] };
  const taskIds = new Set(blueprint.tasks.map((item) => item.id));
  const incompleteDependencyIds = task.dependsOnTaskIds.filter((id) => !completed.has(id) || !taskIds.has(id));
  if (incompleteDependencyIds.length) return { state: "blocked", incompleteDependencyIds };
  return { state: "eligible", incompleteDependencyIds: [] };
}

function continuityFor(liveTask: Task | undefined): { score: number; reasons: string[] } {
  if (!liveTask || liveTask.done || liveTask.status === "done") return { score: 0, reasons: [] };
  let score = 12;
  const reasons = ["already exists as a live task"];
  if (liveTask.status === "in_progress") {
    score += 10;
    reasons.push("is already in progress");
  }
  if (liveTask.list === "today") {
    score += 8;
    reasons.push("is already in Today");
  }
  if ((liveTask.skipped || 0) > 0) {
    score -= Math.min(8, (liveTask.skipped || 0) * 3);
    reasons.push("has been skipped and should be made easier rather than multiplied");
  }
  return { score, reasons };
}

function scorecards(
  blueprint: ExecutionBlueprintModel,
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  developmentPlan: DevelopmentPlanModel,
  context: ExecutionPriorityContext,
): BlueprintTaskScorecard[] {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const coverageById = new Map(coverageModel.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const decisionById = new Map(developmentPlan.decisions.map((decision) => [decision.requirementId, decision]));
  const mapped = mappedLiveTasks(context);
  const completed = completedIds(blueprint, context);

  return blueprint.tasks.map((task) => {
    const liveTask = mapped.get(task.id);
    const stateResult = taskState(task, blueprint, context, completed, liveTask);
    const downstreamTaskIds = descendants(task.id, blueprint.tasks);
    const requirements = task.requirementIds.map((id) => requirementById.get(id)).filter(Boolean);
    const requirementValue = Math.min(32, requirements.reduce((sum, requirement) => {
      const coverage = coverageById.get(requirement!.id);
      const decision = decisionById.get(requirement!.id);
      return sum + requirementWeight(requirement!.importance)
        + coverageWeight(coverage?.status || "unknown")
        + actionWeight(decision?.action || "verify");
    }, 0));
    const unlockValue = Math.min(22, downstreamTaskIds.length * 3 + task.milestoneIds.length * 4 + (task.kind === "verification" ? 4 : 0));
    const urgency = urgencyForTask(task, context, liveTask);
    const continuity = continuityFor(liveTask);
    const ownerFit = task.owner === "anchor" ? 8 : task.owner === "shared" ? 5 : 1;
    const executionFit = effortFit(task, context.dayPlan) + ownerFit;
    const riskPenalty = stateResult.state === "conditional" ? -100
      : stateResult.state === "blocked" ? -70
        : stateResult.state === "completed" ? -200
          : 0;
    const dimensions: PriorityDimensionScores = {
      requirementValue,
      evidenceValue: evidenceWeight(task),
      unlockValue,
      urgency: urgency.score,
      executionFit,
      continuity: continuity.score,
      riskPenalty,
    };
    const score = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
    const reasons = uniqueStrings([
      ...continuity.reasons,
      ...urgency.reasons,
      requirementValue >= 24 ? `serves ${requirements.length} high-value requirement${requirements.length === 1 ? "" : "s"}` : "",
      unlockValue >= 10 ? `unlocks ${downstreamTaskIds.length} downstream task${downstreamTaskIds.length === 1 ? "" : "s"}` : "",
      task.milestoneIds.length ? `creates evidence for ${task.milestoneIds.length} milestone${task.milestoneIds.length === 1 ? "" : "s"}` : "",
      task.owner === "anchor" ? "Anchor can carry most of the preparation" : task.owner === "shared" ? "Anchor can reduce the user's starting friction" : "",
      stateResult.state === "blocked" ? "a blueprint prerequisite is not complete" : "",
      stateResult.state === "conditional" ? "the role-specific route is not active" : "",
    ]).slice(0, 5);
    return {
      blueprintTaskId: task.id,
      state: stateResult.state,
      score,
      dimensions,
      reasons,
      liveTaskId: liveTask?.id || null,
      incompleteDependencyIds: stateResult.incompleteDependencyIds,
      downstreamTaskIds,
    };
  });
}

function actionFor(task: TaskBlueprint, scorecard: BlueprintTaskScorecard): ActiveSliceAction {
  if (scorecard.state === "materialized") return "continue_live_task";
  if (task.owner === "anchor") return "prepare_by_anchor";
  if (task.owner === "shared") return "prepare_then_materialize";
  return "materialize_user_task";
}

function itemReason(scorecard: BlueprintTaskScorecard, task: TaskBlueprint): string {
  const strongest = [...scorecard.reasons].slice(0, 2);
  if (strongest.length) return `${strongest.join(" and ")}.`;
  if (task.owner === "anchor") return "Anchor can move this forward without adding user workload.";
  return "This is the highest-value ready step in the current blueprint.";
}

function selectActiveSlice(
  blueprint: ExecutionBlueprintModel,
  cards: BlueprintTaskScorecard[],
): ActiveExecutionSliceItem[] {
  const taskById = new Map(blueprint.tasks.map((task) => [task.id, task]));
  const selected: Array<{ task: TaskBlueprint; card: BlueprintTaskScorecard }> = [];
  const materialized = cards
    .filter((card) => card.state === "materialized")
    .sort((left, right) => right.dimensions.continuity - left.dimensions.continuity || right.score - left.score);

  let userVisibleCount = 0;
  let anchorCount = 0;
  let deepUserCount = 0;
  const selectedModules = new Set<string>();

  for (const card of materialized) {
    const task = taskById.get(card.blueprintTaskId);
    if (!task || selected.length >= MAX_SELECTED_BLUEPRINT_TASKS) continue;
    if (task.owner !== "anchor" && userVisibleCount >= MAX_ACTIVE_USER_TASKS) continue;
    selected.push({ task, card });
    selectedModules.add(task.moduleId);
    if (task.owner === "anchor") anchorCount += 1;
    else {
      userVisibleCount += 1;
      if (task.effort === "deep" || task.effort === "project") deepUserCount += 1;
    }
  }

  const eligible = cards
    .filter((card) => card.state === "eligible")
    .sort((left, right) => right.score - left.score || left.blueprintTaskId.localeCompare(right.blueprintTaskId));

  for (const card of eligible) {
    if (selected.length >= MAX_SELECTED_BLUEPRINT_TASKS) break;
    const task = taskById.get(card.blueprintTaskId);
    if (!task || selected.some((item) => item.task.id === task.id)) continue;
    if (task.owner === "anchor") {
      if (anchorCount >= MAX_ANCHOR_AUTOMATIONS_PER_ACTIVATION) continue;
      selected.push({ task, card });
      anchorCount += 1;
      selectedModules.add(task.moduleId);
      continue;
    }
    if (userVisibleCount >= MAX_ACTIVE_USER_TASKS) continue;
    const deep = task.effort === "deep" || task.effort === "project";
    if (deep && deepUserCount >= 1) continue;
    if (selectedModules.has(task.moduleId) && eligible.some((other) => {
      if (selected.some((item) => item.task.id === other.blueprintTaskId)) return false;
      const otherTask = taskById.get(other.blueprintTaskId);
      return otherTask && otherTask.moduleId !== task.moduleId && other.score >= card.score - 5;
    })) continue;
    selected.push({ task, card });
    selectedModules.add(task.moduleId);
    userVisibleCount += 1;
    if (deep) deepUserCount += 1;
  }

  const firstUserIndex = selected.findIndex((item) => item.task.owner !== "anchor");
  return selected.map(({ task, card }, index) => ({
    rank: index + 1,
    slot: task.owner === "anchor"
      ? (firstUserIndex === -1 && index === 0 ? "now" : "support")
      : index === firstUserIndex ? "now" : "next",
    blueprintTaskId: task.id,
    liveTaskId: card.liveTaskId,
    action: actionFor(task, card),
    score: card.score,
    reason: itemReason(card, task),
    title: task.title,
    owner: task.owner,
    effort: task.effort,
    expectedEvidence: task.expectedEvidence,
    workstreamId: task.workstreamId,
    moduleId: task.moduleId,
  }));
}

function buildQuality(
  blueprint: ExecutionBlueprintModel,
  activeSlice: ActiveExecutionSliceItem[],
  cards: BlueprintTaskScorecard[],
): ExecutionPriorityModel["quality"] {
  const selectedIds = activeSlice.map((item) => item.blueprintTaskId);
  const cardById = new Map(cards.map((card) => [card.blueprintTaskId, card]));
  const selectedBlockedTaskIds = selectedIds.filter((id) => cardById.get(id)?.state === "blocked");
  const selectedConditionalTaskIds = selectedIds.filter((id) => cardById.get(id)?.state === "conditional");
  const duplicateSelectedTaskIds = selectedIds.filter((id, index) => selectedIds.indexOf(id) !== index);
  const userVisible = activeSlice.filter((item) => item.owner !== "anchor").length;
  const userTaskLimitExceeded = userVisible > MAX_ACTIVE_USER_TASKS;
  const caveats: string[] = [];
  if (blueprint.quality.status === "provisional") caveats.push("The underlying execution blueprint is provisional, so the active slice should remain conservative.");
  if (selectedBlockedTaskIds.length) caveats.push("A blocked task was selected, which violates the readiness gate.");
  if (selectedConditionalTaskIds.length) caveats.push("A role-specific conditional task was selected without route activation.");
  if (userTaskLimitExceeded) caveats.push("The active slice exceeds the three-task user workload limit.");
  if (cards.filter((card) => card.state === "materialized").length > MAX_ACTIVE_USER_TASKS) caveats.push("More than three blueprint tasks are already live; Anchor will reuse them rather than add more work.");
  const valid = !selectedBlockedTaskIds.length && !selectedConditionalTaskIds.length && !duplicateSelectedTaskIds.length && !userTaskLimitExceeded;
  return {
    status: valid && blueprint.quality.status === "complete" ? "complete" : valid ? "usable_with_caveats" : "provisional",
    selectedBlockedTaskIds,
    selectedConditionalTaskIds,
    duplicateSelectedTaskIds,
    userTaskLimitExceeded,
    caveats,
  };
}

export function executionPriorityContextFingerprint(
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
): string {
  const relevantTasks = context.tasks
    .filter((task) => task.relatedTrackId === context.trackId || (task.sourceType === "career_track" && task.sourceId === context.trackId))
    .map((task) => ({
      id: task.id,
      blueprintTaskId: blueprintTaskIdFromLiveTask(task),
      title: task.title,
      list: task.list,
      status: task.status,
      done: task.done,
      skipped: task.skipped,
      readiness: task.readiness,
      deadline: task.deadline,
      sourceStepType: task.sourceStepType,
      updatedSignal: task.actualMinutes || task.createdAt,
    }))
    .sort((left, right) => left.id - right.id);
  const jobs = context.jobs
    .filter((job) => job.relatedTrackId === context.trackId)
    .map((job) => ({ id: job.id, status: job.status, deadline: job.deadline, window: job.applicationWindowStatus }))
    .sort((left, right) => left.id - right.id);
  const learn = context.learn
    .filter((item) => item.relatedTrackId === context.trackId)
    .map((item) => ({ id: item.id, status: item.learnStatus, deadline: item.applicationDeadline }))
    .sort((left, right) => left.id - right.id);
  const contacts = context.contacts
    .filter((contact) => contact.relatedTrackId === context.trackId)
    .map((contact) => ({ id: contact.id, status: contact.status, strength: contact.relationshipStrength, followUp: contact.nextFollowUpDate }))
    .sort((left, right) => left.id - right.id);
  const activation = currentActivationState(blueprint.sourceFingerprint, context.activationState);
  return hash({
    blueprintFingerprint: blueprint.sourceFingerprint,
    relevantTasks,
    jobs,
    learn,
    contacts,
    dayPlan: context.dayPlan ? { date: context.dayPlan.date, energy: context.dayPlan.energy, mode: context.dayPlan.mode, status: context.dayPlan.status } : null,
    activationRecords: activation.records.map((record) => ({
      blueprintTaskId: record.blueprintTaskId,
      status: record.status,
      liveTaskId: record.liveTaskId,
      preparationId: record.preparation?.id || "",
      updatedAt: record.updatedAt,
    })).sort((left, right) => left.blueprintTaskId.localeCompare(right.blueprintTaskId)),
  });
}

export function buildExecutionPriorityModel(
  blueprint: ExecutionBlueprintModel,
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  developmentPlan: DevelopmentPlanModel,
  context: ExecutionPriorityContext,
): ExecutionPriorityModel {
  const contextFingerprint = executionPriorityContextFingerprint(blueprint, context);
  const cards = scorecards(blueprint, requirementModel, coverageModel, developmentPlan, context);
  const activeSlice = selectActiveSlice(blueprint, cards);
  const completedBlueprintTaskIds = cards.filter((card) => card.state === "completed").map((card) => card.blueprintTaskId);
  const materializedBlueprintTaskIds = cards.filter((card) => card.state === "materialized").map((card) => card.blueprintTaskId);
  const parkedBlueprintTaskIds = cards.filter((card) => card.state === "parked").map((card) => card.blueprintTaskId);
  const conditionalBlueprintTaskIds = cards.filter((card) => card.state === "conditional").map((card) => card.blueprintTaskId);
  const quality = buildQuality(blueprint, activeSlice, cards);
  return {
    mode: "execution_priority_model",
    version: EXECUTION_PRIORITY_MODEL_VERSION,
    trackId: context.trackId,
    targetLabel: blueprint.targetLabel,
    executionBlueprintVersion: blueprint.version,
    executionBlueprintFingerprint: blueprint.sourceFingerprint,
    contextFingerprint,
    sourceFingerprint: hash({ blueprint: blueprint.sourceFingerprint, context: contextFingerprint, policy: EXECUTION_PRIORITY_MODEL_VERSION }),
    objective: activeSlice.length
      ? `Keep the active execution slice for ${blueprint.targetLabel} small, ready and evidence-generating.`
      : completedBlueprintTaskIds.length === blueprint.tasks.length
        ? `The current execution blueprint for ${blueprint.targetLabel} is complete.`
        : `No additional task is ready without completing a prerequisite or activating a role-specific route.`,
    policy: {
      maxSelectedTasks: MAX_SELECTED_BLUEPRINT_TASKS,
      maxUserVisibleTasks: MAX_ACTIVE_USER_TASKS,
      maxAnchorAutomationsPerActivation: MAX_ANCHOR_AUTOMATIONS_PER_ACTIVATION,
      conditionalTasksActivateAutomatically: false,
      prioritiesCreated: true,
      scheduleCreated: false,
    },
    activeSlice,
    scorecards: cards,
    completedBlueprintTaskIds,
    materializedBlueprintTaskIds,
    parkedBlueprintTaskIds,
    conditionalBlueprintTaskIds,
    summary: {
      totalBlueprintTasks: blueprint.tasks.length,
      completedTasks: completedBlueprintTaskIds.length,
      activeLiveTasks: materializedBlueprintTaskIds.length,
      eligibleTasks: cards.filter((card) => card.state === "eligible").length,
      blockedTasks: cards.filter((card) => card.state === "blocked").length,
      conditionalTasks: conditionalBlueprintTaskIds.length,
      selectedTasks: activeSlice.length,
      selectedUserVisibleTasks: activeSlice.filter((item) => item.owner !== "anchor").length,
      selectedAnchorTasks: activeSlice.filter((item) => item.owner === "anchor").length,
    },
    quality,
    generatedAt: Date.now(),
  };
}

export function emptyExecutionActivationState(blueprintFingerprint: string): ExecutionActivationState {
  return currentActivationState(blueprintFingerprint, null);
}
