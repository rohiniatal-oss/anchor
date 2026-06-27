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
import { CANONICAL_TECHNIQUES } from "./techniques";

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
  const totalDays = weeks * 5; // weekday-only scheduling, 5 study days/week
  const techniqueLines = CANONICAL_TECHNIQUES.map(
    (t) => `  - ${t.key}: ${t.description} (introduce no earlier than ${Math.round(t.introduceAfterDayFraction * totalDays)} of ${totalDays} days in)`,
  );
  return [
    `You are composing a rigorous, multi-week living curriculum for a strategy professional.`,
    `The output must reach the depth of an expert hand-built study plan: specific sources,`,
    `concrete daily activities, named artifacts, and a clear capstone — not generic advice.`,
    ``,
    `CAREER DIRECTION`,
    `- Name: ${track.name}`,
    track.description ? `- Description: ${track.description}` : ``,
    track.targetRoleArchetype ? `- Target role archetype: ${track.targetRoleArchetype}` : ``,
    track.whyItFits ? `- Why it fits: ${track.whyItFits}` : ``,
    ``,
    `SHAPE`,
    `- Duration: ${weeks} weeks (~${totalDays} weekday study days)`,
    `- Effort: ${hours} hours/day`,
    `- Capstone shape: ${input.capstoneShape}`,
    ``,
    `PHASE STRUCTURE`,
    `- Break the curriculum into 3–4 phases: Foundations → Deep-dive(s) → Mastery → Capstone.`,
    `- Modules nest under phases. Module count is NOT tied to week count — a module may span`,
    `  3 to 10 days as the topic requires. Each module carries a "phaseTitle" naming its phase.`,
    `- Sequence so difficulty ramps: foundations first, advanced synthesis later.`,
    ``,
    `DAY STRUCTURE (each study day has a morning + afternoon block)`,
    `- Morning (typically ${Math.max(1, Math.round(hours * 0.6))}h): reading. List specific`,
    `  source citations — book chapter ranges, report titles, article URLs.`,
    `- Afternoon (typically ${Math.max(1, hours - Math.round(hours * 0.6))}h): writing /`,
    `  technique invocation. This is when the day's artifact is produced.`,
    `- Express both as block objects, NOT prose: { hours, focus, items: [...] }.`,
    `  Items are short imperative strings (e.g. "Marshall, Prisoners of Geography, ch. 1–5").`,
    `- Keep the "activity" field as a one-sentence summary of the whole day for compact UI.`,
    ``,
    `CONFIDENCE LANGUAGE (use ONLY these phrases in any artifact requiring calibration —`,
    `Intelligence Brief, Calibrated Forecast, ACH, or any forecast claim in any artifact)`,
    `  - "Almost certainly"   — >95%   (strong evidence, no plausible alternative)`,
    `  - "Highly likely"      — 80–95% (strong evidence, minor alternative)`,
    `  - "Likely / probably"  — 60–80% (more evidence for than against)`,
    `  - "Roughly even odds"  — 45–55% (genuinely uncertain)`,
    `  - "Unlikely"           — 20–40% (more evidence against)`,
    `  - "Highly unlikely"    — 5–20%  (strong evidence against)`,
    `  - "Remote"             — <5%    (almost no evidence for)`,
    `Reference this table inside artifact prompts that require calibration. Do NOT invent`,
    `new confidence phrasings — discipline matters more than novelty here.`,
    ``,
    `STANDING OBLIGATIONS (light recurring scaffolding, NOT extra daily work)`,
    `- Propose 1–3 recurring habits with cadence weekly_friday | weekly_monday | monthly_first_monday.`,
    `- Each: short title + a doneWhen test. Example for AI gov: "Every Friday — read one new`,
    `  Lawfare AI piece + write two sentences connecting it to the current module".`,
    `- Pick obligations that produce reusable notes, not consumption-only reading.`,
    ``,
    `MILESTONE CHECKPOINTS (skill-attainment markers, not artifact deadlines)`,
    `- Define 3–6 milestones across the curriculum at meaningful pivot points (phase`,
    `  boundaries, after a technique is first attempted, after the capstone draft).`,
    `- Each: { atDayIndex (1..${totalDays}), label (e.g. "Day 20 — Phase 1 capstone"),`,
    `  whatGoodLooksLike (1–2 sentences describing the achieved skill, NOT the artifact),`,
    `  e.g. "Can write a six-element intelligence brief in 90 minutes on any new question". }`,
    ``,
    `TECHNIQUE TAXONOMY (each non-trivial day's afternoon invokes ONE technique → ONE artifact)`,
    ...techniqueLines,
    `- Introduce techniques in difficulty order. Place each technique no earlier than its`,
    `  stated day threshold above (fraction of total days).`,
    ``,
    `ARTIFACTS`,
    `- Each day's "artifacts" array holds 0 or 1 artifact (rarely 2). Most days have exactly 1.`,
    `- An artifact = {techniqueKey, title ("Artifact N: …"), prompt (1–3 sentence assignment),`,
    `  wordTarget (typically 250–1200), saveAs (filename from theme+technique+sequence,`,
    `  e.g. "ai-gov-bluf-01.md")}. Number artifacts globally across the curriculum (1, 2, … 80+).`,
    ``,
    `RATIONALE`,
    `- Add a short "rationale" (≤300 chars) at the curriculum level and on each module,`,
    `  briefly justifying "why this sequence" and "why this technique here".`,
    ``,
    `SOURCING (hallucination guardrail — follow all three)`,
    `- (a) Every spine source must have a real author and a verifiable URL, OR be a`,
    `  publicly-known book whose title and author are stable.`,
    `- (b) For any uncertain source, put a search query in the "url" field starting with`,
    `  "search:" instead of inventing a URL.`,
    `- (c) Never invent edition numbers, page ranges, or ISBNs.`,
    ``,
    `WORKED EXAMPLE (one day from a hypothetical AI-governance curriculum — match this depth)`,
    `{`,
    `  "weekNumber": 1, "phaseTitle": "Foundations", "title": "What AI governance actually regulates",`,
    `  "focus": "Map the regulatory surface", "objective": "Distinguish model-, data-, and use-level rules",`,
    `  "rationale": "Start by framing the problem space before evaluating instruments.",`,
    `  "sources": [{"tier": "spine", "title": "The EU AI Act", "author": "European Parliament",`,
    `    "url": "search: EU AI Act consolidated text", "why": "The reference regulatory framework"}],`,
    `  "days": [{`,
    `    "title": "Day 1 — The shape of AI regulation", "focus": "Regulatory surface",`,
    `    "activity": "Read the EU AI Act risk tiers; list what each tier regulates.",`,
    `    "doneWhen": "You can name the four risk tiers and one obligation each.",`,
    `    "hours": ${hours},`,
    `    "morning": {"hours": ${Math.max(1, Math.round(hours * 0.6))}, "focus": "Read the EU AI Act risk tiers",`,
    `      "items": ["EU AI Act consolidated text, Titles I–III", "Bradford 2024 commentary — Brussels Effect ch.2"]},`,
    `    "afternoon": {"hours": ${Math.max(1, hours - Math.round(hours * 0.6))}, "focus": "Write the BLUF",`,
    `      "items": ["List the four risk tiers and one obligation each", "Draft Artifact 1 (BLUF, 300 words)"]},`,
    `    "artifacts": [{"techniqueKey": "bluf", "title": "Artifact 1: BLUF on AI Act risk tiers",`,
    `      "prompt": "Write a BLUF memo stating the single most consequential obligation of the EU AI Act and why.",`,
    `      "wordTarget": 300, "saveAs": "ai-gov-bluf-01.md"}]`,
    `  }]`,
    `}`,
    ``,
    `RULES`,
    `- Each day must be physically doable: a concrete activity + a doneWhen test.`,
    `- "spine" sources are load-bearing; "secondary" sources support.`,
    `- The capstone must match the requested shape and be genuinely demonstrable.`,
    ``,
    `Return ONLY valid JSON matching this shape (modules are flat, each tagged with its phase):`,
    `{`,
    `  "theme": "...", "summary": "...", "weeks": ${weeks}, "hoursPerDay": ${hours},`,
    `  "rationale": "why this overall sequence",`,
    `  "capstone": {"shape": "${input.capstoneShape}", "title": "...", "description": "...", "doneWhen": "..."},`,
    `  "standingObligations": [`,
    `    {"cadence": "weekly_friday", "title": "...", "doneWhen": "..."}`,
    `  ],`,
    `  "milestones": [`,
    `    {"atDayIndex": 20, "label": "Day 20 — Phase 1 capstone", "whatGoodLooksLike": "..."}`,
    `  ],`,
    `  "modules": [`,
    `    {"weekNumber": 1, "phaseTitle": "Foundations", "title": "...", "focus": "...", "objective": "...",`,
    `     "rationale": "why this module here",`,
    `     "sources": [{"tier": "spine|secondary", "title": "...", "author": "...", "url": "...", "why": "..."}],`,
    `     "days": [{"title": "...", "focus": "...", "activity": "one-sentence summary", "doneWhen": "...", "hours": ${hours},`,
    `       "morning": {"hours": ${Math.max(1, Math.round(hours * 0.6))}, "focus": "...", "items": ["..."]},`,
    `       "afternoon": {"hours": ${Math.max(1, hours - Math.round(hours * 0.6))}, "focus": "...", "items": ["..."]},`,
    `       "artifacts": [{"techniqueKey": "bluf", "title": "Artifact 1: ...", "prompt": "...", "wordTarget": 300, "saveAs": "...-01.md"}]}]}`,
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
