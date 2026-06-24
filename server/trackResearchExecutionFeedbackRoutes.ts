import type { Express } from "express";
import { z } from "zod";
import {
  confirmExecutionOutcome,
  getExecutionFeedbackModel,
  queueExecutionTaskFeedback,
} from "./trackResearchExecutionFeedbackService";

const confirmationSchema = z.object({
  accepted: z.boolean(),
  answer: z.string().trim().max(3000).optional(),
  sourceUrl: z.string().trim().max(900).optional(),
});

export function registerTrackResearchExecutionFeedbackRoutes(app: Express) {
  app.get("/api/career-tracks/:id/execution-feedback", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const model = await getExecutionFeedbackModel(id);
    if (!model) return res.status(404).json({ error: "Track not found" });
    return res.json({ executionFeedbackModel: model });
  });

  app.post("/api/career-tracks/:id/execution-outcomes/:outcomeId/confirm", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const parsed = confirmationSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await confirmExecutionOutcome(id, String(req.params.outcomeId || ""), parsed.data);
      if (!result) return res.status(404).json({ error: "Execution outcome not found" });
      return res.json(result);
    } catch (error: any) {
      return res.status(409).json({ error: error?.message || "Could not confirm this execution outcome" });
    }
  });

  app.post("/api/tasks/:id/execution-outcome/capture", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await queueExecutionTaskFeedback(id, "completed");
    if (!result) return res.status(409).json({ error: "This task is not a completed execution-blueprint task" });
    return res.json(result);
  });
}
