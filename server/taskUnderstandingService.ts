import type { Task } from "@shared/schema";
import { collectTaskBreakdownContext, formatContextBlocksForPrompt } from "./contextProviders";
import { buildSourceContext } from "./taskBreakdownRoutes";
import { storage } from "./storage";
import {
  buildDeterministicTaskBrief,
  refineTaskBriefWithLlm,
  shouldUnderstandTask,
  taskPatchFromBrief,
  type TaskBrief,
} from "./taskUnderstanding";
import { buildUserContext, formatContextForPrompt, type UserContext } from "./userContext";

export type TaskUnderstandingOptions = {
  refine?: boolean;
  force?: boolean;
  suppliedContext?: string;
  mockMode?: "success" | "empty" | "rate_limited" | "unavailable" | "error";
  userContext?: UserContext;
};

export type TaskUnderstandingResult = {
  task: Task | null;
  brief: TaskBrief | null;
  changed: boolean;
};

function findTask(tasks: Task[], id: number) {
  return tasks.find((task) => task.id === id) || null;
}

function combinedContext(input: {
  userContext: UserContext;
  sourceContext?: string;
  parentContext?: string;
  crossEngineContext?: string;
  suppliedContext?: string;
  providerContext?: string;
}) {
  return [
    formatContextForPrompt(input.userContext),
    input.sourceContext ? `Source context:\n${input.sourceContext}` : "",
    input.parentContext ? `Parent workflow:\n${input.parentContext}` : "",
    input.crossEngineContext ? `Connected context:\n${input.crossEngineContext}` : "",
    input.suppliedContext ? `User clarification:\n${input.suppliedContext}` : "",
    input.providerContext || "",
  ].filter(Boolean).join("\n\n");
}

function patchChanged(task: Task, patch: Record<string, unknown>) {
  return Object.entries(patch).some(([key, value]) => (task as any)[key] !== value);
}

export async function understandTask(taskId: number, options: TaskUnderstandingOptions = {}): Promise<TaskUnderstandingResult> {
  const task = findTask(await storage.getTasks(), taskId);
  if (!task) return { task: null, brief: null, changed: false };
  if (!options.force && !shouldUnderstandTask(task)) return { task, brief: null, changed: false };

  const userContext = options.userContext || await buildUserContext();
  const bundle = await buildSourceContext(task, userContext);
  let providerContext = "";
  if (options.refine) {
    const collected = await collectTaskBreakdownContext({
      task,
      sourceBundle: bundle,
      userAuthoredContext: options.suppliedContext || "",
      mockMode: options.mockMode,
    });
    providerContext = formatContextBlocksForPrompt(collected.blocks);
  }

  const context = combinedContext({
    userContext,
    sourceContext: bundle.sourceContext,
    parentContext: bundle.parentContext,
    crossEngineContext: bundle.crossEngineContext,
    suppliedContext: options.suppliedContext,
    providerContext,
  });
  const fallback = buildDeterministicTaskBrief(task, context);
  if (!fallback) return { task, brief: null, changed: false };
  const brief = options.refine ? await refineTaskBriefWithLlm({ task, fallback, context }) : fallback;
  const patch = taskPatchFromBrief(task, brief);
  if (!patchChanged(task, patch)) return { task, brief, changed: false };

  const updated = await storage.updateTask(task.id, patch as any) || task;
  await storage.logActivity({
    eventType: "task_understood",
    sourceType: task.sourceType || "task",
    sourceId: task.sourceId ?? undefined,
    taskId: task.id,
    metadata: JSON.stringify({ version: brief.version, kind: brief.kind, confidence: brief.confidence, needsClarification: brief.needsClarification }),
  } as any);
  return { task: updated, brief, changed: true };
}

export async function understandOpenTasksForPlanning() {
  const [tasks, userContext] = await Promise.all([storage.getTasks(), buildUserContext()]);
  for (const task of tasks) {
    if (task.done || !shouldUnderstandTask(task)) continue;
    await understandTask(task.id, { refine: false, userContext });
  }
}

export async function understandTaskInput(raw: Record<string, any>) {
  if (!shouldUnderstandTask(raw)) return raw;
  const userContext = await buildUserContext();
  const brief = buildDeterministicTaskBrief(raw, formatContextForPrompt(userContext));
  return brief ? { ...raw, ...taskPatchFromBrief(raw, brief) } : raw;
}
