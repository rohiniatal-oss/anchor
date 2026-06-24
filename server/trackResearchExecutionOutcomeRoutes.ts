import type { Express } from "express";
import {
  registerTaskLifecycleMiddleware,
} from "./taskLifecycle";
import {
  confirmOutcomeForTrack,
  getExecutionOutcomeState,
  queueExecutionOutcomeProcessing,
  registerExecutionOutcomeLifecycle,
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
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
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
): boolean {
  if (optionId === "partial_signal") return true;
  return optionId === "evidence_created"
    && ["relationship", "access", "experience", "credential"].includes(outcome.taskKind);
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
    if (requiresConcreteDetail(outcome, optionId) && !note && !evidenceUrl) {
      return res.status(400).json({
        error: "Add one concrete sentence or an evidence link so Anchor does not infer an outcome that was not observed.",
      });
    }

    const input: ConfirmExecutionOutcomeInput = { optionId, note, evidenceUrl };
    try {
      const confirmed = await confirmOutcomeForTrack(trackId, outcomeId, input);
      if (!confirmed) return res.status(404).json({ error: "Execution outcome not found" });
      const state = await getExecutionOutcomeState(trackId);
      return res.json({
        ...state,
        confirmedOutcome: confirmed.outcome,
        message: confirmed.outcome.state === "reopened"
          ? "The task was reopened and no evidence was recorded."
          : confirmed.outcome.usableForCoverage
            ? "Outcome saved. Anchor is reassessing the linked requirements and next active work."
            : "Completion saved without strengthening requirement coverage.",
      });
    } catch (error: any) {
      return res.status(400).json({ error: compact(error?.message || "Could not confirm this outcome", 700) });
    }
  });

  app.post("/api/career-tracks/:id/execution-outcomes/retry", async (req, res) => {
    const trackId = Number(req.params.id);
    if (!Number.isFinite(trackId)) return res.status(400).json({ error: "Bad id" });
    const state = await getExecutionOutcomeState(trackId);
    if (!state) return res.status(404).json({ error: "Track not found" });
    queueExecutionOutcomeProcessing(trackId);
    return res.status(202).json({
      ...state,
      processing: true,
      message: "Anchor is retrying the evidence and planning refresh.",
    });
  });
}

export const executionOutcomeRouteInternals = {
  requiresConcreteDetail,
  safeUrl,
};
