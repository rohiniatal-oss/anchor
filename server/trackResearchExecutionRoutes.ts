import type { Express } from "express";
import {
  ensureExecutionBlueprint,
  executionBlueprintResultError,
} from "./trackResearchExecutionService";
import { registerTrackResearchExecutionPriorityRoutes } from "./trackResearchExecutionPriorityRoutes";

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

  app.post("/api/career-tracks/:id/execution-blueprint/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionBlueprint(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionBlueprintModel" in result)) {
      return res.status(409).json({ error: executionBlueprintResultError(result) });
    }
    return res.status(409).json({
      error: "The complete work hierarchy exists, but only the prioritized active slice can become live tasks.",
      nextStage: "execution_prioritization",
      priorityEndpoint: `/api/career-tracks/${id}/execution-priority`,
      materializationEndpoint: `/api/career-tracks/${id}/execution-priority/materialize`,
      executionBlueprintModel: result.executionBlueprintModel,
    });
  });

  // Installment 5 is registered here so the application entrypoint stays stable
  // and downstream prioritization reuses the blueprint service without a cycle.
  registerTrackResearchExecutionPriorityRoutes(app);
}
