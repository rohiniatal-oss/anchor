import { and, asc, desc, eq } from "drizzle-orm";
import {
  activityLog,
  contacts,
  dayPlanItems,
  dayPlans,
  jobs,
  recommendationMilestones,
  tasks,
  wins,
  type Task,
  type Win,
} from "@shared/schema";
import { completionContractForTask, type CompletionContract } from "@shared/completionContracts";
import { db } from "./storage";

export type TaskLifecycleAction = "start" | "complete" | "reopen" | "skip" | "park" | "block" | "move_later";

export type TaskCompletionRating = "weak" | "adequate" | "strong";

export type TaskLifecycleInput = {
  taskId: number;
  day?: string;
  planItemId?: number | null;
  block?: string | null;
  reason?: string;
  idempotencyKey?: string;
  patch?: Record<string, unknown>;
  completionOutcome?: string;
  completionRating?: TaskCompletionRating | string;
  completionNote?: string;
};

export type TaskLifecycleResult = {
  ok: true;
  action: TaskLifecycleAction;
  task: Task;
  win: Win | null;
  winId: number | null;
  winCategory: string | null;
  completedMilestoneId: number | null;
  nextMilestoneHint: string | null;
  idempotent: boolean;
  completionContract?: CompletionContract | null;
  completionOutcome?: string;
  completionRating?: string;
  completionNote?: string;
};

export class TaskLifecycleError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TaskLifecycleError";
    this.status = status;
  }
}

const ACTIVITY_EVENT: Record<TaskLifecycleAction, string> = {
  start: "started",
  complete: "completed",
  reopen: "reopened",
  skip: "skipped",
  park: "parked",
  block: "blocked",
  move_later: "moved",
};

function parseMetadata(raw: string | null | undefined): Record<string, any> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeKey(value: unknown): string {
  return String(value || "").trim().slice(0, 160);
}

function normalizeCompletionValue(value: unknown, max = 120): string {
  return String(value || "").trim().replace(/\s+/g, "_").toLowerCase().slice(0, max);
}

function normalizeCompletionNote(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 1000);
}

function completionInfo(task: Task, input: TaskLifecycleInput) {
  const contract = completionContractForTask(task);
  const rating = normalizeCompletionValue(input.completionRating);
  const outcome = normalizeCompletionValue(input.completionOutcome);
  const note = normalizeCompletionNote(input.completionNote);
  return { contract, rating, outcome, note };
}

function winCategoryForTask(task: Pick<Task, "category" | "sourceType" | "title">): string {
  if (task.category === "job" || task.category === "interview" || task.sourceType === "job") return "job_progress";
  if (task.category === "learning" || task.sourceType === "learn") return "learning";
  if (["substack", "hustle", "afterline"].includes(task.category) || task.sourceType === "hustle") return "proof_asset";
  if (task.sourceType === "contact") return "network";
  const text = task.title.toLowerCase();
  if (/interview|application|apply|resume|cv|cover letter|job posting/.test(text)) return "job_progress";
  if (/portfolio|project|publish|post|article|blog|build|write|draft/.test(text)) return "proof_asset";
  if (/read|learn|study|course|tutorial|practice/.test(text)) return "learning";
  if (/message|outreach|follow.?up|network|connect|intro|referral/.test(text)) return "network";
  return "admin";
}

function findTaskWin(tx: any, taskId: number): Win | null {
  return tx.select().from(wins)
    .where(and(eq(wins.sourceEntityType, "task"), eq(wins.sourceEntityId, taskId)))
    .orderBy(desc(wins.id))
    .get() || null;
}

function activityEvent(action: TaskLifecycleAction): string {
  return ACTIVITY_EVENT[action];
}

function idempotencyAlreadyApplied(tx: any, taskId: number, action: TaskLifecycleAction, key: string): boolean {
  if (!key) return false;
  const rows = tx.select().from(activityLog)
    .where(and(eq(activityLog.taskId, taskId), eq(activityLog.eventType, activityEvent(action))))
    .orderBy(desc(activityLog.id))
    .all();
  return rows.some((row: any) => parseMetadata(row.metadata).idempotencyKey === key);
}

function recordActivity(tx: any, task: Task, action: TaskLifecycleAction, now: number, input: TaskLifecycleInput) {
  const completion = action === "complete" ? completionInfo(task, input) : null;
  tx.insert(activityLog).values({
    eventType: activityEvent(action),
    sourceType: task.sourceType || "task",
    sourceId: task.sourceId ?? null,
    taskId: task.id,
    planItemId: input.planItemId ?? task.planItemId ?? null,
    metadata: JSON.stringify({
      lifecycleAction: action,
      idempotencyKey: normalizeKey(input.idempotencyKey),
      reason: String(input.reason || "").slice(0, 300),
      ...(completion ? {
        completionContract: completion.contract.contract,
        completionResidueLevel: completion.contract.residueLevel,
        completionAssessmentMode: completion.contract.assessmentMode,
        completionRequiresArtifact: completion.contract.requiresArtifact,
        completionOutcome: completion.outcome,
        completionRating: completion.rating,
        completionNote: completion.note,
      } : {}),
    }),
    timestamp: now,
  }).run();
}

function planItemForTask(tx: any, task: Task, input: TaskLifecycleInput) {
  const explicitId = input.planItemId ?? task.planItemId;
  if (explicitId != null) {
    const direct = tx.select().from(dayPlanItems).where(eq(dayPlanItems.id, explicitId)).get();
    if (direct) return direct;
  }
  if (!input.day) return null;
  const plan = tx.select().from(dayPlans).where(eq(dayPlans.date, input.day)).get();
  if (!plan) return null;
  const items = tx.select().from(dayPlanItems)
    .where(eq(dayPlanItems.planId, plan.id))
    .orderBy(asc(dayPlanItems.sequence))
    .all();
  return items.find((item: any) => item.taskId === task.id)
    || items.find((item: any) => item.sourceType === "task" && item.sourceId === task.id)
    || items.find((item: any) => task.sourceType && item.sourceType === task.sourceType && item.sourceId === task.sourceId)
    || null;
}

function setPlanItemState(tx: any, task: Task, input: TaskLifecycleInput, patch: Record<string, unknown>) {
  const item = planItemForTask(tx, task, input);
  if (!item) return null;
  tx.update(dayPlanItems).set({ ...patch, taskId: task.id }).where(eq(dayPlanItems.id, item.id)).run();
  return { ...item, ...patch, taskId: task.id };
}

function setDoneEnough(tx: any, planItem: any, enough: boolean, now: number) {
  if (!planItem) return;
  const plan = tx.select().from(dayPlans).where(eq(dayPlans.id, planItem.planId)).get();
  if (!plan || plan.minimumViableItemId !== planItem.id) return;
  tx.update(dayPlans).set({
    enoughForToday: enough,
    status: enough ? "done_enough" : "active",
    updatedAt: now,
  }).where(eq(dayPlans.id, plan.id)).run();
}

function completeLinkedMilestone(tx: any, task: Task, now: number) {
  if (task.sourceStepType !== "recommendation_milestone" || task.sourceStepId == null) {
    return { completedMilestoneId: null, nextMilestoneHint: null };
  }
  const milestone = tx.select().from(recommendationMilestones)
    .where(eq(recommendationMilestones.id, task.sourceStepId))
    .get();
  if (!milestone) return { completedMilestoneId: null, nextMilestoneHint: null };

  tx.update(recommendationMilestones).set({ status: "done", completedAt: now })
    .where(eq(recommendationMilestones.id, milestone.id)).run();
  const siblings = tx.select().from(recommendationMilestones)
    .where(eq(recommendationMilestones.recommendationId, milestone.recommendationId))
    .orderBy(asc(recommendationMilestones.sequence), asc(recommendationMilestones.id))
    .all();
  const hasCurrent = siblings.some((item: any) => item.id !== milestone.id && (item.status === "active" || item.status === "blocked"));
  const next = siblings.find((item: any) => item.id !== milestone.id && item.status === "todo") || null;
  if (!hasCurrent && next) {
    tx.update(recommendationMilestones).set({ status: "active", completedAt: null })
      .where(eq(recommendationMilestones.id, next.id)).run();
  }
  return {
    completedMilestoneId: milestone.id,
    nextMilestoneHint: next ? next.suggestedTaskTitle || next.label : null,
  };
}

function setLinkedMilestoneStatus(tx: any, task: Task, status: "active" | "blocked") {
  if (task.sourceStepType !== "recommendation_milestone" || task.sourceStepId == null) return;
  tx.update(recommendationMilestones).set({ status, completedAt: null })
    .where(eq(recommendationMilestones.id, task.sourceStepId)).run();
}

function updateSourceOnComplete(tx: any, task: Task) {
  if (task.sourceType === "job" && task.sourceId != null) {
    const job = tx.select().from(jobs).where(eq(jobs.id, task.sourceId)).get();
    if (!job) return;
    if (/submit|apply|send.*application/i.test(task.title) && job.status === "wishlist") {
      tx.update(jobs).set({ status: "applied", applicationReadiness: "submitted" })
        .where(eq(jobs.id, job.id)).run();
    } else if (/interview|prep.*interview|mock.*interview/i.test(task.title) && ["wishlist", "applied"].includes(job.status)) {
      tx.update(jobs).set({ status: "interviewing" }).where(eq(jobs.id, job.id)).run();
    }
  }
  if (task.sourceType === "contact" && task.sourceId != null && /message|draft|send|outreach|email|reach out|follow.?up/i.test(task.title)) {
    tx.update(contacts).set({ status: "messaged" }).where(eq(contacts.id, task.sourceId)).run();
  }
}

function lifecycleResult(
  action: TaskLifecycleAction,
  task: Task,
  win: Win | null,
  milestone: { completedMilestoneId: number | null; nextMilestoneHint: string | null },
  idempotent: boolean,
  input?: TaskLifecycleInput,
): TaskLifecycleResult {
  const completion = action === "complete" ? completionInfo(task, input || { taskId: task.id }) : null;
  return {
    ok: true,
    action,
    task,
    win,
    winId: win?.id ?? null,
    winCategory: win?.winCategory ?? null,
    completedMilestoneId: milestone.completedMilestoneId,
    nextMilestoneHint: milestone.nextMilestoneHint,
    idempotent,
    ...(completion ? {
      completionContract: completion.contract,
      completionOutcome: completion.outcome,
      completionRating: completion.rating,
      completionNote: completion.note,
    } : {}),
  };
}

function currentTask(tx: any, taskId: number): Task {
  const task = tx.select().from(tasks).where(eq(tasks.id, taskId)).get() as Task | undefined;
  if (!task) throw new TaskLifecycleError("Task not found", 404);
  return task;
}

export function startTask(input: TaskLifecycleInput): TaskLifecycleResult {
  return db.transaction((tx) => {
    const before = currentTask(tx, input.taskId);
    const key = normalizeKey(input.idempotencyKey);
    if (idempotencyAlreadyApplied(tx, before.id, "start", key) || (before.pinned && before.status === "in_progress" && (input.planItemId == null || before.planItemId === input.planItemId))) {
      return lifecycleResult("start", before, findTaskWin(tx, before.id), { completedMilestoneId: null, nextMilestoneHint: null }, true);
    }

    const now = Date.now();
    tx.update(tasks).set({ pinned: false }).where(eq(tasks.pinned, true)).run();
    const updated = tx.update(tasks).set({
      ...(input.patch || {}),
      list: "today",
      pinned: true,
      status: "in_progress",
      block: input.block ?? before.block,
      planItemId: input.planItemId ?? before.planItemId,
    } as any).where(eq(tasks.id, before.id)).returning().get() as Task;
    setPlanItemState(tx, updated, input, { status: "started", startedAt: now });
    recordActivity(tx, updated, "start", now, input);
    return lifecycleResult("start", updated, findTaskWin(tx, updated.id), { completedMilestoneId: null, nextMilestoneHint: null }, false);
  });
}

export function completeTask(input: TaskLifecycleInput): TaskLifecycleResult {
  return db.transaction((tx) => {
    const before = currentTask(tx, input.taskId);
    const key = normalizeKey(input.idempotencyKey);
    const existingWin = findTaskWin(tx, before.id);
    if (idempotencyAlreadyApplied(tx, before.id, "complete", key) || before.done || before.status === "done") {
      return lifecycleResult("complete", before, existingWin, { completedMilestoneId: before.sourceStepType === "recommendation_milestone" ? before.sourceStepId : null, nextMilestoneHint: null }, true, input);
    }

    const now = Date.now();
    const updated = tx.update(tasks).set({
      ...(input.patch || {}),
      done: true,
      status: "done",
      pinned: false,
    } as any).where(eq(tasks.id, before.id)).returning().get() as Task;
    const planItem = setPlanItemState(tx, updated, input, { status: "completed", completedAt: now });
    setDoneEnough(tx, planItem, true, now);
    updateSourceOnComplete(tx, updated);
    const milestone = completeLinkedMilestone(tx, updated, now);
    const winCategory = winCategoryForTask(updated);
    const completion = completionInfo(updated, input);
    const completionLabel = completion.rating || completion.outcome;
    const completionTakeaway = [
      completion.contract.contract ? `Contract: ${completion.contract.contract}` : "",
      completionLabel ? `Result: ${completionLabel}` : "",
      completion.note,
    ].filter(Boolean).join(". ");
    const win = existingWin || tx.insert(wins).values({
      text: updated.title,
      kind: "planned",
      winCategory,
      trackId: updated.relatedTrackId ?? null,
      sourceEntityType: "task",
      sourceEntityId: updated.id,
      takeaway: completionTakeaway,
      createdAt: now,
    }).returning().get() as Win;
    if (existingWin && completionTakeaway) {
      tx.update(wins).set({ takeaway: completionTakeaway }).where(eq(wins.id, existingWin.id)).run();
    }
    recordActivity(tx, updated, "complete", now, input);
    return lifecycleResult("complete", updated, win, milestone, false, input);
  });
}

export function reopenTask(input: TaskLifecycleInput): TaskLifecycleResult {
  return db.transaction((tx) => {
    const before = currentTask(tx, input.taskId);
    const key = normalizeKey(input.idempotencyKey);
    if (idempotencyAlreadyApplied(tx, before.id, "reopen", key) || (!before.done && before.status !== "done")) {
      return lifecycleResult("reopen", before, findTaskWin(tx, before.id), { completedMilestoneId: null, nextMilestoneHint: null }, true);
    }

    const now = Date.now();
    const updated = tx.update(tasks).set({
      ...(input.patch || {}),
      done: false,
      status: "not_started",
      pinned: false,
    } as any).where(eq(tasks.id, before.id)).returning().get() as Task;
    const planItem = setPlanItemState(tx, updated, input, { status: "planned", completedAt: null });
    setDoneEnough(tx, planItem, false, now);
    tx.delete(wins).where(and(eq(wins.sourceEntityType, "task"), eq(wins.sourceEntityId, updated.id))).run();
    if (updated.sourceStepType === "recommendation_milestone" && updated.sourceStepId != null) {
      setLinkedMilestoneStatus(tx, updated, "active");
    }
    recordActivity(tx, updated, "reopen", now, input);
    return lifecycleResult("reopen", updated, null, { completedMilestoneId: null, nextMilestoneHint: null }, false);
  });
}

export function skipTask(input: TaskLifecycleInput): TaskLifecycleResult {
  return db.transaction((tx) => {
    const before = currentTask(tx, input.taskId);
    const key = normalizeKey(input.idempotencyKey);
    if (idempotencyAlreadyApplied(tx, before.id, "skip", key)) {
      return lifecycleResult("skip", before, findTaskWin(tx, before.id), { completedMilestoneId: null, nextMilestoneHint: null }, true);
    }
    const now = Date.now();
    const updated = tx.update(tasks).set({
      skipped: (before.skipped || 0) + 1,
      pinned: false,
      status: "not_started",
    }).where(eq(tasks.id, before.id)).returning().get() as Task;
    setPlanItemState(tx, updated, input, { status: "skipped", skippedAt: now });
    recordActivity(tx, updated, "skip", now, input);
    return lifecycleResult("skip", updated, findTaskWin(tx, updated.id), { completedMilestoneId: null, nextMilestoneHint: null }, false);
  });
}

export function parkTask(input: TaskLifecycleInput): TaskLifecycleResult {
  return db.transaction((tx) => {
    const before = currentTask(tx, input.taskId);
    const key = normalizeKey(input.idempotencyKey);
    if (idempotencyAlreadyApplied(tx, before.id, "park", key)) {
      return lifecycleResult("park", before, findTaskWin(tx, before.id), { completedMilestoneId: null, nextMilestoneHint: null }, true);
    }
    const now = Date.now();
    const updated = tx.update(tasks).set({
      list: "inbox",
      block: null,
      pinned: false,
      status: "not_started",
      skipped: (before.skipped || 0) + 1,
    }).where(eq(tasks.id, before.id)).returning().get() as Task;
    setPlanItemState(tx, updated, input, { status: "parked", parkedAt: now });
    setLinkedMilestoneStatus(tx, updated, "active");
    recordActivity(tx, updated, "park", now, input);
    return lifecycleResult("park", updated, findTaskWin(tx, updated.id), { completedMilestoneId: null, nextMilestoneHint: null }, false);
  });
}

export function blockTask(input: TaskLifecycleInput): TaskLifecycleResult {
  return db.transaction((tx) => {
    const before = currentTask(tx, input.taskId);
    const key = normalizeKey(input.idempotencyKey);
    const reason = String(input.reason || "Blocked").trim().slice(0, 160) || "Blocked";
    if (idempotencyAlreadyApplied(tx, before.id, "block", key) || (before.readiness === "blocked" && before.blockerReason === reason)) {
      return lifecycleResult("block", before, findTaskWin(tx, before.id), { completedMilestoneId: null, nextMilestoneHint: null }, true);
    }
    const now = Date.now();
    const updated = tx.update(tasks).set({
      readiness: "blocked",
      blockerReason: reason,
      status: "stuck",
      pinned: false,
    }).where(eq(tasks.id, before.id)).returning().get() as Task;
    setLinkedMilestoneStatus(tx, updated, "blocked");
    recordActivity(tx, updated, "block", now, { ...input, reason });
    return lifecycleResult("block", updated, findTaskWin(tx, updated.id), { completedMilestoneId: null, nextMilestoneHint: null }, false);
  });
}

export function moveTaskLater(input: TaskLifecycleInput): TaskLifecycleResult {
  return db.transaction((tx) => {
    const before = currentTask(tx, input.taskId);
    const key = normalizeKey(input.idempotencyKey);
    if (idempotencyAlreadyApplied(tx, before.id, "move_later", key)) {
      return lifecycleResult("move_later", before, findTaskWin(tx, before.id), { completedMilestoneId: null, nextMilestoneHint: null }, true);
    }
    const order = ["morning", "afternoon", "evening"];
    const currentIndex = order.indexOf(before.block || "morning");
    const block = order[Math.min(Math.max(0, currentIndex) + 1, order.length - 1)];
    const now = Date.now();
    const updated = tx.update(tasks).set({ block, pinned: false }).where(eq(tasks.id, before.id)).returning().get() as Task;
    setPlanItemState(tx, updated, input, { status: "moved", movedAt: now });
    recordActivity(tx, updated, "move_later", now, input);
    return lifecycleResult("move_later", updated, findTaskWin(tx, updated.id), { completedMilestoneId: null, nextMilestoneHint: null }, false);
  });
}

export const taskLifecycleInternals = {
  activityEvent,
  parseMetadata,
  winCategoryForTask,
};
