import type { Express } from "express";
import type { Task } from "@shared/schema";
import { storage } from "./storage";

export type TaskLifecycleEvent = {
  type: "completed" | "reopened";
  before: Task;
  after: Task;
  occurredAt: number;
};

export type TaskLifecycleListener = (event: TaskLifecycleEvent) => void | Promise<void>;

const listeners = new Set<TaskLifecycleListener>();

function completed(task: Task): boolean {
  return Boolean(task.done) || task.status === "done";
}

function taskIdFromRequest(method: string, path: string): number | null {
  const normalizedMethod = method.toUpperCase();
  const patchMatch = normalizedMethod === "PATCH" ? /^\/api\/tasks\/(\d+)$/.exec(path) : null;
  const completionMatch = normalizedMethod === "POST" ? /^\/api\/tasks\/(\d+)\/complete$/.exec(path) : null;
  const match = patchMatch || completionMatch;
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function registerTaskLifecycleListener(listener: TaskLifecycleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function emitTaskLifecycleTransition(before: Task, after: Task): Promise<void> {
  const wasCompleted = completed(before);
  const isCompleted = completed(after);
  const type = !wasCompleted && isCompleted
    ? "completed"
    : wasCompleted && !isCompleted
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

/**
 * Observe the existing task APIs without changing their response contracts.
 * The middleware must be registered before task routes. It snapshots the task
 * before a completion-capable request and emits only after a successful response.
 */
export function registerTaskLifecycleMiddleware(app: Express): void {
  app.use(async (req, res, next) => {
    const taskId = taskIdFromRequest(req.method, req.path);
    if (!taskId) return next();
    try {
      const before = (await storage.getTasks()).find((task) => task.id === taskId);
      if (!before) return next();
      res.once("finish", () => {
        if (res.statusCode < 200 || res.statusCode >= 400) return;
        void storage.getTasks()
          .then((tasks) => tasks.find((task) => task.id === taskId))
          .then((after) => after ? emitTaskLifecycleTransition(before, after) : undefined)
          .catch((error) => console.error("Task lifecycle observation failed:", error));
      });
      return next();
    } catch (error) {
      console.error("Task lifecycle observation setup failed:", error);
      return next();
    }
  });
}

export const taskLifecycleInternals = {
  completed,
  taskIdFromRequest,
};
