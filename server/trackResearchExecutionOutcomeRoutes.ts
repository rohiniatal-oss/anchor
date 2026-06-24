import type { Express } from "express";
import { z } from "zod";
import {
  confirmExecutionOutcome,
  ensureExecutionOutcomeSnapshot,
  forceRefreshExecutionOutcomes,
} from "./trackResearchExecutionOutcomeService";

const confirmationSchema = z.object({
  decision: z.enum(["direct", "supporting", "none", "mistaken"]),
  answer: z.string().trim().max(4_000).optional().default(""),
  sourceUrl: z.string().trim().max(2_000).optional().default(""),
});

function validTrackId(value: string): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function registerTrackResearchExecutionOutcomeRoutes(app: Express) {
  app.get("/api/career-tracks/:id/execution-outcomes", async (req, res) => {
    const id = validTrackId(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionOutcomeSnapshot(id);
    if (!result) return res.status(404).json({ error: "Track or execution blueprint not found" });
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/execution-outcomes/refresh", async (req, res) => {
    const id = validTrackId(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const result = await forceRefreshExecutionOutcomes(id);
    if (!result) return res.status(404).json({ error: "Track or execution blueprint not found" });
    return res.json({ ...result, refreshed: true });
  });

  app.post("/api/career-tracks/:id/execution-outcomes/:outcomeId/confirm", async (req, res) => {
    const id = validTrackId(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const parsed = confirmationSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (
      (parsed.data.decision === "direct" || parsed.data.decision === "supporting")
      && !parsed.data.answer
      && !parsed.data.sourceUrl
    ) {
      return res.status(400).json({
        error: "Add the concrete output, result, signal, or evidence link before accepting this outcome.",
      });
    }
    const result = await confirmExecutionOutcome({
      trackId: id,
      outcomeId: String(req.params.outcomeId || "").trim(),
      confirmation: parsed.data,
    });
    if (!result) return res.status(404).json({ error: "Outcome not found" });
    return res.json({ ...result, confirmed: true });
  });
}
