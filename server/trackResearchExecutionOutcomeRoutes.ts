import type { Express } from "express";
import { registerTaskLifecycleMiddleware } from "./taskLifecycle";
import {
  confirmOutcomeForTrack,
  getExecutionOutcomeState,
  registerExecutionOutcomeLifecycle,
  retryExecutionOutcomeProcessing,
} from "./trackResearchExecutionOutcomeService";
import type {
  ConfirmExecutionOutcomeInput,
  ExecutionOutcome,
  ExecutionOutcomeOption,
} from "./trackResearchExecutionOutcome";

const VALID_OPTIONS = new Set<ExecutionOutcomeOption["id"]>([
  "evidence_created",
  "partial_signal",
  "no_evidence",
  "not_completed",
]);

function compact(value: unknown, max = 2_000): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function safeUrl(value: unknown): string {
  const raw = compact(value, 1_000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function requiresConcreteDetail(
  outcome: ExecutionOutcome,
  optionId: ExecutionOutcomeOption["id"],
): "note" | "note_or_url" | null {
  if (optionId === "partial_signal") return "note";
  if (optionId !== "evidence_created") return null;
  if (["relationship", "access", "experience"].includes(outcome.taskKind)) return "note";
  return "note_or_url";
}

let lifecycleMiddlewareRegistered = false;

export function registerTrackResearchExecutionOutcomeRoutes(app: Express) {
  registerExecutionOutcomeLifecycle();
  if (!lifecycleMiddlewareRegistered) {
    lifecycleMiddlewareRegistered = true;
    registerTaskLifecycleMiddleware(app);
  }

  app.get("/api/career-tracks/:id/execution-outcomes", async (req, res) => {
    const trackId = Number(req.params.id);
    if (!Number.isFinite(trackId)) return res.status(400).json({ error: "Bad id" });
    const state = await getExecutionOutcomeState(trackId);
    if (!state) return res.status(404).json({ error: "Track not found" });
    return res.json(state);
  });

  app.post("/api/career-tracks/:id/execution-outcomes/:outcomeId/confirm", async (req, res) => {
    const trackId = Number(req.params.id);
    if (!Number.isFinite(trackId)) return res.status(400).json({ error: "Bad id" });
    const outcomeId = compact(req.params.outcomeId, 220);
    const optionId = compact(req.body?.optionId, 80) as ExecutionOutcomeOption["id"];
    if (!outcomeId || !VALID_OPTIONS.has(optionId)) {
      return res.status(400).json({ error: "Choose a valid execution outcome" });
    }

    const current = await getExecutionOutcomeState(trackId);
    if (!current) return res.status(404).json({ error: "Track not found" });
    const outcome = current.executionOutcomeModel.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) return res.status(404).json({ error: "Execution outcome not found" });
    if (outcome.state !== "pending_confirmation") {
      return res.status(409).json({ error: "This execution outcome has already been resolved", outcome });
    }

    const note = compact(req.body?.note, 2_000);
    const evidenceUrl = safeUrl(req.body?.evidenceUrl);
    if (req.body?.evidenceUrl && !evidenceUrl) {
      return res.status(400).json({ error: "Evidence link must use http or https" });
    }
    const detailRule = requiresConcreteDetail(outcome, optionId);
    if (detailRule === "note" && !note) {
      return res.status(400).json({
        error: "Add one concrete sentence describing the observed result so Anchor does not infer an outcome that was not seen.",
      });
    }
    if (detailRule === "note_or_url" && !note && !evidenceUrl && !outcome.evidenceUrl) {
      return res.status(400).json({
        error: "Add one concrete sentence or an evidence link so Anchor does not infer an output that was not observed.",
      });
    }

    const input: ConfirmExecutionOutcomeInput = { optionId, note, evidenceUrl };
    try {
      const confirmed = await confirmOutcomeForTrack(trackId, outcomeId, input);
      if (!confirmed) return res.status(404).json({ error: "Execution outcome not found" });
      const state = await getExecutionOutcomeState(trackId);
      return res.status(202).json({
        ...state,
        confirmedOutcome: confirmed.outcome,
        message: confirmed.outcome.state === "reopened"
          ? "The task was reopened. Any evidence from this completion will be removed from coverage."
          : confirmed.outcome.usableForCoverage
            ? "Outcome saved. Anchor is reassessing the linked requirements, milestones and next active work."
            : "Completion saved without strengthening requirement coverage. Anchor is advancing the execution frontier where appropriate.",
      });
    } catch (error: any) {
      return res.status(400).json({ error: compact(error?.message || "Could not confirm this outcome", 700) });
    }
  });

  app.post("/api/career-tracks/:id/execution-outcomes/retry", async (req, res) => {
    const trackId = Number(req.params.id);
    if (!Number.isFinite(trackId)) return res.status(400).json({ error: "Bad id" });
    const model = await retryExecutionOutcomeProcessing(trackId);
    if (!model) return res.status(404).json({ error: "Track not found" });
    const state = await getExecutionOutcomeState(trackId);
    return res.status(202).json({
      ...state,
      processing: true,
      message: "Anchor is retrying the evidence, coverage and planning refresh.",
    });
  });
}

export const executionOutcomeRouteInternals = {
  requiresConcreteDetail,
  safeUrl,
};
