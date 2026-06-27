import { test } from "node:test";
import assert from "node:assert/strict";
import { composeCurriculum, buildComposePrompt, CurriculumComposeError } from "./composer";
import type { ComposeInput, ComposedCurriculum } from "./types";

const TRACK = {
  id: 1,
  slug: "ai-strategy",
  name: "AI strategy, governance, and policy",
  description: "Advising on AI governance",
  targetRoleArchetype: "AI policy advisor",
  priority: 80,
  status: "active",
  whyItFits: "Builds on strategy background",
  trackIntelligence: "",
  createdAt: Date.now(),
} as any;

const INPUT: ComposeInput = { trackId: 1, weeks: 2, hoursPerDay: 5, capstoneShape: "interview_ready" };

function cannedCurriculum(): ComposedCurriculum {
  return {
    theme: "AI strategy, governance, and policy",
    summary: "A two-week sprint to interview-readiness.",
    weeks: 2,
    hoursPerDay: 5,
    capstone: { shape: "interview_ready", title: "Mock interview pack", description: "", doneWhen: "Can answer 10 questions" },
    modules: [
      {
        weekNumber: 1,
        title: "Foundations",
        focus: "Vocabulary",
        objective: "Speak the language",
        sources: [{ tier: "spine", title: "EU AI Act", author: "EU", url: "", why: "core text" }],
        days: [{ title: "Read the Act", focus: "law", activity: "Read titles I-III", doneWhen: "Can summarise", hours: 5 }],
      },
    ],
  };
}

test("composeCurriculum returns a validated curriculum from a mock LLM", async () => {
  const mock = async () => cannedCurriculum();
  const result = await composeCurriculum(TRACK, INPUT, mock as any);
  assert.equal(result.theme, "AI strategy, governance, and policy");
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0].sources[0].tier, "spine");
});

test("composeCurriculum throws on null model output (no usable JSON)", async () => {
  const mock = async () => null;
  await assert.rejects(
    () => composeCurriculum(TRACK, INPUT, mock as any),
    (err: unknown) => err instanceof CurriculumComposeError && (err as CurriculumComposeError).code === "empty_model_output",
  );
});

test("composeCurriculum throws on schema-invalid model output", async () => {
  const mock = async () => ({ theme: "x", weeks: 2, hoursPerDay: 5 }); // missing capstone + modules
  await assert.rejects(
    () => composeCurriculum(TRACK, INPUT, mock as any),
    (err: unknown) => err instanceof CurriculumComposeError && (err as CurriculumComposeError).code === "invalid_model_output",
  );
});

test("composeCurriculum fails clearly when OPENAI_API_KEY is absent and using the default client", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      () => composeCurriculum(TRACK, INPUT),
      (err: unknown) => err instanceof CurriculumComposeError && (err as CurriculumComposeError).code === "missing_openai_key",
    );
  } finally {
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  }
});

test("buildComposePrompt includes track name and shape parameters", () => {
  const prompt = buildComposePrompt(TRACK, INPUT);
  assert.match(prompt, /AI strategy, governance, and policy/);
  assert.match(prompt, /2 weeks/);
  assert.match(prompt, /interview_ready/);
});
