import type { Express } from "express";
import {
  ensureExecutionPriority,
  executionPriorityResultError,
  materializePrioritizedExecutionSlice,
} from "./trackResearchExecutionPriorityService";

export function registerTrackResearchExecutionPriorityRoutes(app: Express) {
  app.get("/api/career-tracks/:id/execution-priority", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionPriority(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionPriorityModel" in result)) {
      return res.status(409).json({ error: executionPriorityResultError(result) });
    }
    return res.json(result);
  });

  app.post("/api/career-tracks/:id/execution-priority/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionPriority(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionPriorityModel" in result)) {
      return res.status(409).json({ error: executionPriorityResultError(result) });
    }
    return res.json({ ...result, refreshedPriority: true });
  });

  app.post("/api/career-tracks/:id/execution-priority/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const expectedSourceFingerprint = String(req.body?.expectedSourceFingerprint || "").trim();
    const requestedMax = Number(req.body?.maxNewTasks);
    const result = await materializePrioritizedExecutionSlice(id, {
      expectedSourceFingerprint: expectedSourceFingerprint || undefined,
      maxNewTasks: Number.isFinite(requestedMax) ? requestedMax : undefined,
    });
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("materialization" in result)) {
      return res.status(409).json({
        error: "error" in result
          ? String(result.error || "Execution prioritization is not available yet")
          : "Execution prioritization is not available yet",
        ...(result && typeof result === "object" && "currentSourceFingerprint" in result
          ? { currentSourceFingerprint: result.currentSourceFingerprint }
          : {}),
      });
    }
    return res.json({
      ...result.priorityResult,
      materializationResult: result.materialization,
    });
  });
}
