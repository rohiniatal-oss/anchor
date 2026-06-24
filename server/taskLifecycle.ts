import type { Task } from "@shared/schema";

export type TaskLifecycleTransition = "completed" | "reopened";

export type TaskLifecycleEvent = {
  type: TaskLifecycleTransition;
  before: Task;
  after: Task;
  occurredAt: number;
};

export type TaskLifecycleListener = (event: TaskLifecycleEvent) => void | Promise<void>;

const listeners = new Set<TaskLifecycleListener>();

function isCompleted(task: Pick<Task, "done" | "status">): boolean {
  return Boolean(task.done) || task.status === "done";
}

export function registerTaskLifecycleListener(listener: TaskLifecycleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function emitTaskLifecycleTransition(before: Task, after: Task): Promise<void> {
  const wasCompleted = isCompleted(before);
  const nowCompleted = isCompleted(after);
  const type: TaskLifecycleTransition | null = !wasCompleted && nowCompleted
    ? "completed"
    : wasCompleted && !nowCompleted
      ? "reopened"
      : null;
  if (!type) return;

  const event: TaskLifecycleEvent = {
    type,
    before,
    after,
    occurredAt: Date.now(),
  };
  const settled = await Promise.allSettled(
    [...listeners].map((listener) => Promise.resolve(listener(event))),
  );
  for (const result of settled) {
    if (result.status === "rejected") {
      console.error("Task lifecycle listener failed:", result.reason);
    }
  }
}

export const taskLifecycleInternals = {
  isCompleted,
};
