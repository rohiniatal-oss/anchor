import type { Express } from "express";
import {
  ensureExecutionBlueprint,
  executionBlueprintResultError,
} from "./trackResearchExecutionService";

export { ensureExecutionBlueprint };

export function registerTrackResearchExecutionRoutes(app: Express) {
  app.get("/api/career-tracks/:id/execution-blueprint", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionBlueprint(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionBlueprintModel" in result)) {
      return res.status(409).json({ error: executionBlueprintResultError(result) });
    }
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/execution-blueprint/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionBlueprint(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionBlueprintModel" in result)) {
      return res.status(409).json({ error: executionBlueprintResultError(result) });
    }
    return res.json({ ...result, refreshed: true });
  });

  // Backward-compatible alias. The prioritization stage now selects a limited
  // active slice before any blueprint task can enter the live task system.
  app.post("/api/career-tracks/:id/execution-blueprint/materialize", (req, res) => {
    return res.redirect(307, `/api/career-tracks/${req.params.id}/execution-priority/materialize`);
  });
}
