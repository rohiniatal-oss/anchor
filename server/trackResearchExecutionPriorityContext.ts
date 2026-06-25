import type { CareerTrack, Contact, Job, Learn, Task } from "@shared/schema";
import { storage } from "./storage";
import type { ExecutionBlueprintModel } from "./trackResearchExecutionBlueprint";
import {
  blueprintTaskIdFromSourceStepType,
  DEFAULT_ACTIVE_SLICE_SIZE,
  MAX_ACTIVE_SLICE_SIZE,
  type ExecutionPriorityContext,
  type PriorityDeadlineSignal,
  type PriorityLiveTaskSnapshot,
} from "./trackResearchExecutionPriority";

const DAY_MS = 24 * 60 * 60 * 1000;

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function startOfUtcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function parseDate(value: unknown): number | null {
  const text = compact(value);
  if (!text) return null;
  const simple = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text;
  const timestamp = new Date(simple).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function daysUntil(value: unknown, now: Date): number | null {
  const timestamp = parseDate(value);
  if (timestamp == null) return null;
  return Math.ceil((startOfUtcDay(new Date(timestamp)) - startOfUtcDay(now)) / DAY_MS);
}

function urgencyFor(days: number): PriorityDeadlineSignal["urgency"] {
  if (days <= 3) return "high";
  if (days <= 10) return "medium";
  return "low";
}

function activeTask(task: Task): boolean {
  return !task.done && task.status !== "done" && ["today", "this_week", "later", "inbox"].includes(task.list);
}

function belongsToTrack(task: Task, trackId: number): boolean {
  return task.relatedTrackId === trackId
    || (task.sourceType === "career_track" && task.sourceId === trackId);
}

function taskSnapshot(task: Task): PriorityLiveTaskSnapshot {
  return {
    liveTaskId: task.id,
    blueprintTaskId: blueprintTaskIdFromSourceStepType(task.sourceStepType),
    title: task.title,
    done: task.done,
    status: task.status,
    list: task.list,
    readiness: task.readiness,
    skipped: task.skipped || 0,
    size: task.size,
    relatedTrackId: task.relatedTrackId ?? (task.sourceType === "career_track" ? task.sourceId ?? null : null),
    sourceStepType: task.sourceStepType,
    createdAt: task.createdAt,
  };
}

function jobSignals(trackId: number, jobs: Job[], now: Date): PriorityDeadlineSignal[] {
  const ignored = new Set(["closed", "archived", "rejected", "withdrawn", "offer_declined"]);
  return jobs.flatMap((job) => {
    if (job.relatedTrackId !== trackId || ignored.has(String(job.status || "").toLowerCase())) return [];
    const days = daysUntil(job.deadline, now);
    if (days == null || days < -2 || days > 30) return [];
    return [{
      kind: "job_deadline" as const,
      sourceType: "job" as const,
      sourceId: job.id,
      label: `${job.title}${job.company ? ` at ${job.company}` : ""}`,
      dueDate: compact(job.deadline),
      daysUntil: days,
      urgency: urgencyFor(days),
    }];
  });
}

function learningSignals(trackId: number, learns: Learn[], now: Date): PriorityDeadlineSignal[] {
  const ignored = new Set(["done", "closed", "archived"]);
  return learns.flatMap((item) => {
    if (item.relatedTrackId !== trackId || ignored.has(String(item.learnStatus || "").toLowerCase())) return [];
    const days = daysUntil(item.applicationDeadline, now);
    if (days == null || days < -2 || days > 30) return [];
    return [{
      kind: "learning_deadline" as const,
      sourceType: "learn" as const,
      sourceId: item.id,
      label: item.title,
      dueDate: compact(item.applicationDeadline),
      daysUntil: days,
      urgency: urgencyFor(days),
    }];
  });
}

function contactSignals(trackId: number, contacts: Contact[], now: Date): PriorityDeadlineSignal[] {
  return contacts.flatMap((contact) => {
    if (contact.relatedTrackId !== trackId || String(contact.status || "").toLowerCase() === "archived") return [];
    const days = daysUntil(contact.nextFollowUpDate, now);
    if (days == null || days < -30 || days > 14) return [];
    return [{
      kind: "contact_follow_up" as const,
      sourceType: "contact" as const,
      sourceId: contact.id,
      label: contact.name || contact.who || "Professional follow-up",
      dueDate: compact(contact.nextFollowUpDate),
      daysUntil: days,
      urgency: urgencyFor(days),
    }];
  });
}

function contextFingerprint(value: Omit<ExecutionPriorityContext, "fingerprint" | "generatedAt">): string {
  const live = value.liveTasks.map((task) => ({
    liveTaskId: task.liveTaskId,
    blueprintTaskId: task.blueprintTaskId,
    done: task.done,
    status: task.status,
    list: task.list,
    readiness: task.readiness,
    skipped: task.skipped,
    size: task.size,
    relatedTrackId: task.relatedTrackId,
    sourceStepType: task.sourceStepType,
  })).sort((left, right) => left.liveTaskId - right.liveTaskId);
  const deadlines = [...value.deadlineSignals]
    .map((signal) => ({ ...signal }))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.sourceId - right.sourceId);
  return stableHash(JSON.stringify({
    trackId: value.trackId,
    dayKey: value.dayKey,
    trackPriority: value.trackPriority,
    trackStatus: value.trackStatus,
    live,
    deadlines,
    activeLoad: value.activeLoad,
    capacity: value.capacity,
  }));
}

export function buildExecutionPriorityContextFromData(input: {
  track: CareerTrack;
  blueprint: ExecutionBlueprintModel;
  tasks: Task[];
  jobs?: Job[];
  learns?: Learn[];
  contacts?: Contact[];
  now?: Date;
}): ExecutionPriorityContext {
  const now = input.now || new Date();
  const currentBlueprintIds = new Set(input.blueprint.tasks.map((task) => task.id));
  const trackTasks = input.tasks.filter((task) => belongsToTrack(task, input.track.id));
  const liveTasks = trackTasks.map(taskSnapshot);
  const openTasks = input.tasks.filter(activeTask);
  const sameTrackOpen = trackTasks.filter(activeTask);
  const currentBlueprintOpen = liveTasks.filter((task) => task.blueprintTaskId && currentBlueprintIds.has(task.blueprintTaskId) && !task.done && task.status !== "done");
  const currentBlueprintCompleted = liveTasks.filter((task) => task.blueprintTaskId && currentBlueprintIds.has(task.blueprintTaskId) && (task.done || task.status === "done"));
  const deepOrProjectOpen = sameTrackOpen.filter((task) => task.size === "deep" || Number(task.estimateMinutes || 0) >= 90);
  const preferredMax = Math.min(MAX_ACTIVE_SLICE_SIZE, openTasks.length >= 20 ? 3 : DEFAULT_ACTIVE_SLICE_SIZE);
  const trackCapacityRemaining = Math.max(0, preferredMax - sameTrackOpen.length);
  const blueprintCapacityRemaining = Math.max(0, preferredMax - currentBlueprintOpen.length);
  const maxNewTasks = Math.min(trackCapacityRemaining, blueprintCapacityRemaining);
  const maxSelectedTasks = Math.max(currentBlueprintOpen.length, Math.min(preferredMax, currentBlueprintOpen.length + maxNewTasks));
  const deadlineSignals = [
    ...jobSignals(input.track.id, input.jobs || [], now),
    ...learningSignals(input.track.id, input.learns || [], now),
    ...contactSignals(input.track.id, input.contacts || [], now),
  ].sort((left, right) => left.daysUntil - right.daysUntil || left.label.localeCompare(right.label));

  const base: Omit<ExecutionPriorityContext, "fingerprint" | "generatedAt"> = {
    trackId: input.track.id,
    dayKey: dayKey(now),
    trackPriority: input.track.priority || 0,
    trackStatus: input.track.status || "active",
    liveTasks,
    deadlineSignals,
    activeLoad: {
      globalOpen: openTasks.length,
      globalToday: openTasks.filter((task) => task.list === "today").length,
      sameTrackOpen: sameTrackOpen.length,
      currentBlueprintOpen: currentBlueprintOpen.length,
      currentBlueprintCompleted: currentBlueprintCompleted.length,
      deepOrProjectOpen: deepOrProjectOpen.length,
    },
    capacity: {
      maxSelectedTasks,
      maxNewTasks,
      maxDeepOrProjectTasks: 2,
      maxUserOwnedTasks: 2,
      maxPerWorkstream: 2,
    },
  };

  return {
    ...base,
    fingerprint: contextFingerprint(base),
    generatedAt: now.getTime(),
  };
}

export async function collectExecutionPriorityContext(
  trackId: number,
  blueprint: ExecutionBlueprintModel,
): Promise<ExecutionPriorityContext | null> {
  const [track, tasks, jobs, learns, contacts] = await Promise.all([
    storage.getCareerTrack(trackId),
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getContacts(),
  ]);
  if (!track) return null;
  return buildExecutionPriorityContextFromData({ track, blueprint, tasks, jobs, learns, contacts });
}

export const executionPriorityContextInternals = {
  activeTask,
  belongsToTrack,
  daysUntil,
  contextFingerprint,
};
