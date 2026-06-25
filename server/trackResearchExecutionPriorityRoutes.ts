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
    if (String(req.header("X-Anchor-User-Intent") || "").toLowerCase() === "background") {
      return res.status(409).json({
        error: "Review the displayed work and activate it explicitly.",
        code: "explicit_user_intent_required",
      });
    }
    const expectedSourceFingerprint = typeof req.body?.sourceFingerprint === "string"
      ? req.body.sourceFingerprint.trim()
      : "";
    if (!expectedSourceFingerprint) {
      return res.status(428).json({
        error: "Refresh and review the active slice before activating it.",
        code: "displayed_slice_fingerprint_required",
      });
    }
    const result = await materializePrioritizedExecutionSlice(id, expectedSourceFingerprint);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("materialization" in result)) {
      return res.status(409).json({
        error: "error" in result
          ? String(result.error || "Execution prioritization is not available yet")
          : "Execution prioritization is not available yet",
        code: "code" in result ? result.code : undefined,
        currentSourceFingerprint: "currentSourceFingerprint" in result ? result.currentSourceFingerprint : undefined,
      });
    }
    return res.json({
      ...result.priorityResult,
      materializationResult: result.materialization,
    });
  });
}
