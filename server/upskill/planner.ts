// Compose a horizon via one large-JSON LLM call, validate it, and (for the
// orchestrator) persist it. The LLM function is injectable so tests run offline.
import { llmJSONLarge, MODEL_PRIMARY, type LlmJSONLargeResult } from "../llm";
import { buildHorizonPrompt, TECHNIQUE_KEYS } from "./prompt";
import { upskillHorizonSchema, HORIZON_SIZE, type HorizonItem } from "./types";
import type { UpskillIntake } from "./intake";

export type ComposeResult =
  | { ok: true; items: HorizonItem[] }
  | { ok: false; reason: string; detail?: string };

type LlmLargeFn = <T = any>(input: string, opts?: any) => Promise<LlmJSONLargeResult<T>>;

let activeLlm: LlmLargeFn = llmJSONLarge;

// Test seam: feed a canned horizon (or a function) without a network call.
export function __setHorizonLlmForTest(fn: LlmLargeFn | null): void {
  activeLlm = fn || llmJSONLarge;
}

function hasUsableKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  // "test-noop" is the placeholder the harness sets; treat it as "no real key"
  // so auto-recompose never makes a live call during tests.
  return !!key && key !== "test-noop";
}

export async function composeHorizon(intake: UpskillIntake): Promise<ComposeResult> {
  if (!intake.tracks.length) {
    return { ok: false, reason: "no_active_tracks" };
  }
  if (activeLlm === llmJSONLarge && !hasUsableKey()) {
    return { ok: false, reason: "missing_openai_key" };
  }

  const prompt = buildHorizonPrompt(intake);
  const result = await activeLlm(prompt, { model: MODEL_PRIMARY, maxOutputTokens: 16000 });
  if (!result.ok) {
    return { ok: false, reason: result.reason, detail: `head=${result.rawHead} tail=${result.rawTail}` };
  }

  const parsed = upskillHorizonSchema.safeParse(result.value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_model_output",
      detail: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const validTrackIds = new Set(intake.tracks.map((t) => t.id));
  const items = parsed.data.items
    .filter((it) => validTrackIds.has(it.trackId))
    .map((it) => ({
      ...it,
      // Drop artifact technique keys that are not in the taxonomy rather than reject.
      artifact: it.artifact?.techniqueKey && !TECHNIQUE_KEYS.includes(it.artifact.techniqueKey)
        ? { ...it.artifact, techniqueKey: undefined }
        : it.artifact,
    }))
    .slice(0, HORIZON_SIZE);

  if (!items.length) return { ok: false, reason: "no_items_for_active_tracks" };
  return { ok: true, items };
}

// Orchestrator: gather intake from storage, compose, persist. Used by the
// recompose route and by the auto-recompose triggers in the materializer. Never
// throws on a failed compose — it logs and returns the result so callers (e.g. a
// completion handler) keep working.
export async function recompose(): Promise<ComposeResult> {
  const { gatherIntakeFromStorage } = await import("./intake");
  const repo = await import("./repository");
  const intake = await gatherIntakeFromStorage();
  const result = await composeHorizon(intake);
  if (result.ok) {
    repo.replaceHorizon(result.items);
  } else {
    console.error(`[upskill] recompose skipped: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
  }
  return result;
}
