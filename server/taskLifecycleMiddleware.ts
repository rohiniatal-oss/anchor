import type { Express } from "express";
import { storage } from "./storage";
import { emitTaskLifecycleTransition } from "./taskLifecycle";

function watchedRequest(method: string, originalUrl: string): boolean {
  if (method === "PATCH") return true;
  return method === "POST" && /\/complete(?:\?|$)/.test(originalUrl);
}

export function registerTaskLifecycleMiddleware(app: Express): void {
  app.use("/api/tasks/:id", async (req, res, next) => {
    if (!watchedRequest(req.method, req.originalUrl)) return next();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return next();
    const before = (await storage.getTasks()).find((task) => task.id === id);
    if (!before) return next();

    res.once("finish", () => {
      if (res.statusCode >= 400) return;
      void storage.getTasks()
        .then((tasks) => tasks.find((task) => task.id === id))
        .then((after) => after ? emitTaskLifecycleTransition(before, after) : undefined)
        .catch((error) => console.error("Task lifecycle observation failed:", error));
    });
    return next();
  });
}

export const taskLifecycleMiddlewareInternals = {
  watchedRequest,
};
