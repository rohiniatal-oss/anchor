import type { Express } from "express";
import { storage } from "./storage";
import { emitTaskLifecycleTransition } from "./taskLifecycle";

/**
 * Observe task lifecycle transitions without coupling every task mutation route
 * to the execution evidence loop. This middleware is registered before the
 * task routes, captures the pre-mutation task, and compares it with persisted
 * state after a successful response.
 */
export function registerTaskLifecycleRoutes(app: Express): void {
  app.use("/api/tasks/:id", async (req, res, next) => {
    if (!['PATCH', 'POST'].includes(req.method.toUpperCase())) return next();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return next();
    const before = (await storage.getTasks()).find((task) => task.id === id);
    if (!before) return next();

    res.once("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      void (async () => {
        const after = (await storage.getTasks()).find((task) => task.id === id);
        if (!after) return;
        await emitTaskLifecycleTransition(before, after);
      })().catch((error) => {
        console.error("Task lifecycle observation failed:", error);
      });
    });
    return next();
  });
}
