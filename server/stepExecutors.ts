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
  sourceContext?: string;
  crossEngineContext?: string;
};

function clean(v: unknown, max = 300) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function buildAvailableContext(ctx: ExecutionContext, priorOutputs: string[]): string {
  const parts: string[] = [];
  const research = ctx.researchBlocks?.map((b) =>
    `${b.sourceTitle || ""}: ${b.text} ${b.sourceUrl ? `(${b.sourceUrl})` : ""}`
  ).join("\n") || "";
  if (research) parts.push(research);
  if (ctx.sourceContext) parts.push(ctx.sourceContext);
  if (ctx.crossEngineContext) parts.push(ctx.crossEngineContext);
  if (priorOutputs.length) parts.push(`Prior outputs:\n${priorOutputs.join("\n")}`);
  return parts.join("\n\n");
}

function buildUserActionFallback(step: { text: string; outputSpec?: string }, ctx: ExecutionContext): ExecutedStep {
  const spec = step.outputSpec || step.text;
  const t = spec.toLowerCase();
  let action = step.text;
  if (/role|job|posting|position/.test(t)) {
    action = `Search for "${ctx.taskTitle.slice(0, 50)}" on LinkedIn or a job board and note what you find`;
  } else if (/company|org/.test(t)) {
    action = `Look up the company online and note what they do and why it matters`;
  } else if (/contact|person|network|reach out/.test(t)) {
    action = `Think of one person who could help with "${ctx.taskTitle.slice(0, 40)}" and add them`;
  } else if (/require|skill|gap|qualification/.test(t)) {
    action = `Open a real posting for this role type and list the top 3 requirements`;
  } else if (/write|draft|memo|brief/.test(t)) {
    action = `Open a blank doc and write the first paragraph — even rough is fine`;
  } else if (/read|review|article|paper/.test(t)) {
    action = `Find the source and read just the first section — write one takeaway`;
  } else if (/schedule|book|calendar/.test(t)) {
    action = `Open your calendar and block time for this now`;
  }
  return {
    text: action,
    done: false,
    executor: "user_action",
    outputSpec: step.outputSpec,
    ready: true,
  };
}

async function executeSystemStep(
  step: { text: string; outputSpec?: string },
  priorOutputs: string[],
  ctx: ExecutionContext,
): Promise<ExecutedStep> {
  const spec = step.outputSpec || step.text;
  const available = buildAvailableContext(ctx, priorOutputs);

  if (!available.trim()) {
    return buildUserActionFallback(step, ctx);
  }

  try {
    const raw = await llm(
      `${COACH_PREAMBLE}Format the available context into the step output. Return ONLY what the spec requires, populated with real data from the context. No instructions, no "you should". If context is thin, report it in "gaps" — never invent.\n\n` +
      `OUTPUT_SPEC: ${spec}\n` +
      `AVAILABLE_CONTEXT:\n${available}\n` +
      `${ctx.userContext ? `USER_CONTEXT: ${ctx.userContext}\n` : ""}` +
      `TASK: ${ctx.taskTitle}\n` +
      `${ctx.doneWhen ? `DONE_WHEN: ${ctx.doneWhen}\n` : ""}` +
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
    return buildUserActionFallback(step, ctx);
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
