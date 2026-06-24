import type { Express } from "express";
import { z } from "zod";
import { storage } from "./storage";
import {
  emitTaskLifecycleTransition,
  registerTaskLifecycleListener,
} from "./taskLifecycle";
import {
  confirmExecutionOutcome,
  handleExecutionTaskLifecycle,
  reconcileExecutionOutcomes,
} from "./trackResearchExecutionOutcomeService";

const confirmationSchema = z.object({
  resolution: z.enum(["accept", "supporting", "no_evidence", "reopen"]),
  answer: z.string().trim().max(4000).optional().default(""),
  sourceUrl: z.string().trim().max(1200).optional().default(""),
});

let lifecycleRegistered = false;

function registerExecutionOutcomeLifecycleListener() {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  registerTaskLifecycleListener((event) => {
    // Keep task mutations responsive. Reconciliation is idempotent and the GET
    // endpoint also repairs any lifecycle event missed during a restart.
    void handleExecutionTaskLifecycle(event.after, event.type).catch((error) => {
      console.error("Execution outcome lifecycle processing failed:", error);
    });
  });
}

function outcomeResponse(result: NonNullable<Awaited<ReturnType<typeof reconcileExecutionOutcomes>>>) {
  const pendingOutcome = result.executionOutcomeModel.records.find((record) =>
    result.executionOutcomeModel.pendingConfirmationIds.includes(record.id),
  ) || null;
  return {
    ...result,
    pendingOutcome,
  };
}

export function registerTrackResearchExecutionOutcomeRoutes(app: Express) {
  registerExecutionOutcomeLifecycleListener();

  // Observe the existing task PATCH route without replacing its validation or
  // response contract. This route calls next(), then inspects the persisted
  // before/after state once the canonical task mutation has completed.
  app.patch("/api/tasks/:id", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return next();
    try {
      const before = (await storage.getTasks()).find((task) => task.id === id);
      if (before) {
        res.on("finish", () => {
          if (res.statusCode < 200 || res.statusCode >= 400) return;
          void (async () => {
            const after = (await storage.getTasks()).find((task) => task.id === id);
            if (after) await emitTaskLifecycleTransition(before, after);
          })().catch((error) => console.error("Task lifecycle observation failed:", error));
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/career-tracks/:id/execution-outcomes", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await reconcileExecutionOutcomes(id, { advance: false });
    if (!result) return res.status(404).json({ error: "Track not found" });
    return res.json(outcomeResponse(result));
  });

  app.post("/api/career-tracks/:id/execution-outcomes/reconcile", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await reconcileExecutionOutcomes(id, { advance: Boolean(req.body?.advance) });
    if (!result) return res.status(404).json({ error: "Track not found" });
    return res.json(outcomeResponse(result));
  });

  app.post("/api/career-tracks/:id/execution-outcomes/:outcomeId/confirm", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const parsed = confirmationSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await confirmExecutionOutcome(id, String(req.params.outcomeId || ""), parsed.data);
      if (!result) return res.status(404).json({ error: "Track not found" });
      return res.json(outcomeResponse(result));
    } catch (error: any) {
      return res.status(Number(error?.status || 500)).json({ error: error?.message || "Could not confirm the execution outcome" });
    }
  });
}
