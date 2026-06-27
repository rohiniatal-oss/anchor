/**
 * LLM-first curriculum composer.
 *
 * Given a career track + shape parameters, asks the model to compose a complete,
 * multi-week study/development curriculum at the depth of a hand-built plan, then
 * validates the response with zod before anything downstream touches it.
 *
 * Design notes:
 * - The LLM call is injectable (module-level override + per-call argument) so tests
 *   can feed a canned ComposedCurriculum without a network call.
 * - With no OPENAI_API_KEY the real llmJSON returns null (it swallows the auth
 *   error); we surface that as a clear CurriculumComposeError rather than a vague
 *   null, so the route can return an actionable message.
 */
import { llmJSON as defaultLlmJSON, MODEL_PRIMARY } from "../llm";
import type { CareerTrack } from "@shared/schema";
import { composedCurriculumSchema, type ComposedCurriculum, type ComposeInput } from "./types";

export class CurriculumComposeError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = "curriculum_compose_failed", status = 502) {
    super(message);
    this.name = "CurriculumComposeError";
    this.code = code;
    this.status = status;
  }
}

type LlmJSONFn = <T = any>(input: string, opts?: any) => Promise<T | null>;

// Module-level override so the compose route (which constructs the prompt itself)
// can be exercised end-to-end in tests. composeCurriculum also accepts a direct
// override argument for focused unit tests.
let activeLlmJSON: LlmJSONFn = defaultLlmJSON;

export function __setCurriculumLlmForTest(fn: LlmJSONFn | null): void {
  activeLlmJSON = fn || defaultLlmJSON;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function buildComposePrompt(track: CareerTrack, input: ComposeInput): string {
  const weeks = clamp(input.weeks, 1, 104);
  const hours = clamp(input.hoursPerDay, 0, 24);
  return [
    `You are composing a rigorous, multi-week living curriculum for a strategy professional.`,
    `The output must reach the depth of an expert hand-built study plan: specific sources,`,
    `concrete daily activities, and a clear capstone — not generic learning advice.`,
    ``,
    `CAREER DIRECTION`,
    `- Name: ${track.name}`,
    track.description ? `- Description: ${track.description}` : ``,
    track.targetRoleArchetype ? `- Target role archetype: ${track.targetRoleArchetype}` : ``,
    track.whyItFits ? `- Why it fits: ${track.whyItFits}` : ``,
    ``,
    `SHAPE`,
    `- Duration: ${weeks} weeks`,
    `- Effort: ${hours} hours/day`,
    `- Capstone shape: ${input.capstoneShape}`,
    ``,
    `RULES`,
    `- Produce exactly ${weeks} weekly modules (weekNumber 1..${weeks}).`,
    `- Each module has a focus, an objective, sources, and daily plan items.`,
    `- Each day must be physically doable: a concrete activity + a doneWhen test.`,
    `- Sources are two-tier: "spine" sources are load-bearing (the curriculum depends`,
    `  on them); "secondary" sources support. Prefer real, namable sources; if unsure`,
    `  of an exact title, give a precise search query instead of inventing one.`,
    `- The capstone must match the requested shape and be genuinely demonstrable.`,
    ``,
    `Return ONLY valid JSON matching this shape:`,
    `{`,
    `  "theme": "...", "summary": "...", "weeks": ${weeks}, "hoursPerDay": ${hours},`,
    `  "capstone": {"shape": "${input.capstoneShape}", "title": "...", "description": "...", "doneWhen": "..."},`,
    `  "modules": [`,
    `    {"weekNumber": 1, "title": "...", "focus": "...", "objective": "...",`,
    `     "sources": [{"tier": "spine|secondary", "title": "...", "author": "...", "url": "...", "why": "..."}],`,
    `     "days": [{"title": "...", "focus": "...", "activity": "...", "doneWhen": "...", "hours": ${hours}}]}`,
    `  ]`,
    `}`,
  ].filter(Boolean).join("\n");
}

/**
 * Compose + validate. Throws CurriculumComposeError on null/invalid model output
 * (which is also what a missing OPENAI_API_KEY produces). Returns a validated
 * ComposedCurriculum on success.
 */
export async function composeCurriculum(
  track: CareerTrack,
  input: ComposeInput,
  llmFn: LlmJSONFn = activeLlmJSON,
): Promise<ComposedCurriculum> {
  if (!process.env.OPENAI_API_KEY && llmFn === defaultLlmJSON) {
    throw new CurriculumComposeError(
      "Curriculum composition requires an OPENAI_API_KEY. Set the key and retry.",
      "missing_openai_key",
      503,
    );
  }

  const prompt = buildComposePrompt(track, input);
  let raw: unknown;
  try {
    raw = await llmFn(prompt, { model: MODEL_PRIMARY });
  } catch (err) {
    throw new CurriculumComposeError(
      `The model call failed while composing the curriculum: ${(err as Error)?.message || err}`,
    );
  }

  if (raw == null) {
    throw new CurriculumComposeError(
      "The model returned no usable curriculum (empty or non-JSON response). This is expected when no OPENAI_API_KEY is configured.",
      "empty_model_output",
    );
  }

  const parsed = composedCurriculumSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CurriculumComposeError(
      `The composed curriculum did not match the required schema: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      "invalid_model_output",
      422,
    );
  }
  return parsed.data;
}
