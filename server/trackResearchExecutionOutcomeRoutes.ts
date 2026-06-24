import type { Express } from "express";
import { z } from "zod";
import { storage } from "./storage";
import {
  emitTaskLifecycleEvent,
  registerTaskLifecycleListener,
} from "./taskLifecycle";
import {
  confirmExecutionOutcome,
  processTaskLifecycleTransition,
  scanExecutionOutcomes,
} from "./trackResearchExecutionOutcomeService";

const confirmationSchema = z.object({
  resolution: z.enum(["confirmed", "supporting", "no_evidence", "mistaken"]),
  answer: z.string().trim().max(1_500).optional().default(""),
  sourceUrl: z.string().trim().max(1_000).optional().default(""),
});

let lifecycleListenerRegistered = false;

function taskMutationId(path: string, method: string): number | null {
  if (!["PATCH", "PUT", "POST"].includes(method.toUpperCase())) return null;
  const match = path.match(/^\/api\/tasks\/(\d+)(?:\/complete)?$/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

async function taskById(id: number) {
  return (await storage.getTasks()).find((task) => task.id === id);
}

/**
 * Observe the existing task APIs rather than replacing them. This keeps the
 * evidence loop compatible with both the generic task editor and Today’s
 * dedicated completion endpoint.
 */
export function registerExecutionOutcomeLifecycleObserver(app: Express) {
  if (!lifecycleListenerRegistered) {
    registerTaskLifecycleListener((event) => processTaskLifecycleTransition(event));
    lifecycleListenerRegistered = true;
  }

  app.use(async (req, res, next) => {
    const id = taskMutationId(req.path, req.method);
    if (!id) return next();
    const before = await taskById(id).catch(() => undefined);
    if (!before) return next();

    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      void taskById(id)
        .then((after) => after ? emitTaskLifecycleEvent(before, after) : undefined)
        .catch((error) => console.error("Could not observe task lifecycle transition:", error));
    });
    return next();
  });
}

export function registerTrackResearchExecutionOutcomeRoutes(app: Express) {
  app.get("/api/career-tracks/:id/execution-outcomes", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await scanExecutionOutcomes(id);
    if (!result) return res.status(409).json({ error: "A current execution blueprint is required before outcomes can be assessed." });
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/execution-outcomes/scan", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await scanExecutionOutcomes(id);
    if (!result) return res.status(409).json({ error: "A current execution blueprint is required before outcomes can be assessed." });
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/execution-outcomes/:outcomeId/confirm", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const parsed = confirmationSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await confirmExecutionOutcome({
        trackId: id,
        outcomeId: String(req.params.outcomeId || "").trim(),
        confirmation: parsed.data,
      });
      if (!result) return res.status(404).json({ error: "Track not found" });
      return res.json(result);
    } catch (error: any) {
      const message = String(error?.message || "Could not confirm this execution outcome");
      const status = /not found/i.test(message) ? 404 : 409;
      return res.status(status).json({ error: message });
    }
  });
}

export const executionOutcomeRouteInternals = {
  taskMutationId,
};
