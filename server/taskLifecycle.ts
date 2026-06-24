import type { Task } from "@shared/schema";

export type TaskLifecycleTransition = "completed" | "reopened";

export type TaskLifecycleEvent = {
  transition: TaskLifecycleTransition;
  before: Task;
  after: Task;
  occurredAt: number;
};

function completed(task: Pick<Task, "done" | "status">): boolean {
  return Boolean(task.done) || task.status === "done";
}

export function classifyTaskLifecycleTransition(
  before: Pick<Task, "done" | "status">,
  after: Pick<Task, "done" | "status">,
): TaskLifecycleTransition | null {
  const wasCompleted = completed(before);
  const isCompleted = completed(after);
  if (!wasCompleted && isCompleted) return "completed";
  if (wasCompleted && !isCompleted) return "reopened";
  return null;
}

export function buildTaskLifecycleEvent(before: Task, after: Task): TaskLifecycleEvent | null {
  const transition = classifyTaskLifecycleTransition(before, after);
  if (!transition) return null;
  return {
    transition,
    before,
    after,
    occurredAt: Date.now(),
  };
}

export const taskLifecycleInternals = {
  completed,
};
