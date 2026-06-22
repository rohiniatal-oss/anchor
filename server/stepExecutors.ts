import { llm, LLM_MODELS } from "./llm";
import { COACH_PREAMBLE } from "./userPromptProfile";
import type { ContextBlock } from "./contextProviders/types";

type StepExecutor = "system" | "user_action" | "user_learning";

export type StepDisposition = "applied" | "saved" | "dismissed";

export type ExecutedStep = {
  text: string;
  done: boolean;
  executor?: StepExecutor;
  outputSpec?: string;
  output?: string;
  gaps?: string;
  ready?: boolean;
  blocker?: string;
  disposition?: StepDisposition;
  completedAt?: string;
};

type ExecutionContext = {
  taskTitle: string;
  sourceType?: string | null;
  sourceNote?: string | null;
  doneWhen?: string | null;
  userContext?: string;
  researchBlocks?: ContextBlock[];
  priorCompletedOutputs?: string[];
};

function clean(v: unknown, max = 300) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function executeSystemStep(
  step: { text: string; outputSpec?: string },
  priorOutputs: string[],
  ctx: ExecutionContext,
): Promise<ExecutedStep> {
  const spec = step.outputSpec || step.text;
  const existingResearch = ctx.researchBlocks?.map((b) =>
    `${b.sourceTitle || ""}: ${b.text} ${b.sourceUrl ? `(${b.sourceUrl})` : ""}`
  ).join("\n") || "";

  if (!existingResearch) {
    return { text: step.text, done: false, executor: "system", outputSpec: step.outputSpec, gaps: "No research available to populate this step" };
  }

  try {
    const raw = await llm(
      `${COACH_PREAMBLE}Format these research results into the step output. Return ONLY what the spec requires, populated with real data. No instructions, no "you should". If results are thin, report it in "gaps" — never invent.\n\n` +
      `OUTPUT_SPEC: ${spec}\n` +
      `RAW_RESULTS:\n${existingResearch}\n` +
      `${ctx.userContext ? `USER_CONTEXT: ${ctx.userContext}\n` : ""}` +
      `${priorOutputs.length ? `PRIOR_OUTPUTS:\n${priorOutputs.join("\n")}\n` : ""}` +
      `\nReturn JSON: { "output": "<matches spec, real data>", "gaps": null | "what's missing" }`,
      { model: LLM_MODELS.breakdown },
    );
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(text);
    return {
      text: step.text,
      done: true,
      executor: "system",
      outputSpec: step.outputSpec,
      output: typeof parsed.output === "string" ? parsed.output : JSON.stringify(parsed.output),
      gaps: parsed.gaps || undefined,
    };
  } catch {
    return { text: step.text, done: false, executor: "system", outputSpec: step.outputSpec, gaps: "Could not generate output" };
  }
}

function resolveUserAction(
  step: { text: string; outputSpec?: string },
  priorOutputs: string[],
): ExecutedStep {
  let resolved = step.text;
  const hasRef = /\b(the role|the posting|the result|step \d|above)\b/i.test(resolved);
  if (hasRef && priorOutputs.length > 0) {
    const lastOutput = priorOutputs[priorOutputs.length - 1];
    if (lastOutput && lastOutput.length > 10) {
      const firstLine = lastOutput.split("\n")[0]?.slice(0, 100) || "";
      if (firstLine) {
        resolved = `${step.text} — specifically: ${firstLine}`;
      }
    }
  }
  const ready = !hasRef || priorOutputs.length > 0;
  return {
    text: resolved,
    done: false,
    executor: "user_action",
    outputSpec: step.outputSpec,
    ready,
    blocker: ready ? undefined : "Waiting on prior step output",
  };
}

function frameLearning(
  step: { text: string; outputSpec?: string },
): ExecutedStep {
  return {
    text: step.text,
    done: false,
    executor: "user_learning",
    outputSpec: step.outputSpec,
  };
}

export async function executeSteps(
  steps: Array<{ text: string; done: boolean; executor?: StepExecutor; outputSpec?: string; substeps?: string[]; output?: string; disposition?: StepDisposition; completedAt?: string }>,
  ctx: ExecutionContext,
): Promise<ExecutedStep[]> {
  const outputs: string[] = [...(ctx.priorCompletedOutputs || [])];
  const executed: ExecutedStep[] = [];

  for (const step of steps) {
    if (step.done && step.output) {
      outputs.push(step.output);
      executed.push({
        text: step.text,
        done: true,
        executor: step.executor,
        outputSpec: step.outputSpec,
        output: step.output,
        disposition: step.disposition,
        completedAt: step.completedAt,
      });
      continue;
    }

    const executor = step.executor || inferExecutor(step.text);
    let result: ExecutedStep;

    if (executor === "system") {
      result = await executeSystemStep(step, outputs, ctx);
    } else if (executor === "user_action") {
      result = resolveUserAction(step, outputs);
    } else {
      result = frameLearning(step);
    }

    if (result.output) outputs.push(result.output);
    executed.push(result);
  }

  return executed;
}

function inferExecutor(text: string): StepExecutor {
  const t = text.toLowerCase();
  if (/\b(save|submit|send|apply|schedule|book|post|publish|forward|sign up)\b/.test(t)) return "user_action";
  if (/\b(read|study|practise|practice|learn|absorb|reflect|take the course|watch|listen|do the exercise)\b/.test(t)) return "user_learning";
  return "system";
}
