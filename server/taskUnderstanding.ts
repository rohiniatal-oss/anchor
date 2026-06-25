import type { Task } from "@shared/schema";
import { llmJSON, LLM_MODELS } from "./llm";

export const TASK_BRIEF_VERSION = 1;
export const TASK_BRIEF_MARKER = "Anchor task brief v1:";

export type TaskUnderstandingKind =
  | "research"
  | "decision"
  | "communication"
  | "preparation"
  | "review"
  | "creation"
  | "improvement"
  | "organization"
  | "unknown";

export type TaskBrief = {
  version: 1;
  kind: TaskUnderstandingKind;
  target: string;
  resolvedTarget: string;
  objective: string;
  whyNow: string;
  desiredOutput: string;
  doneWhen: string;
  evidenceNeeded: string[];
  assumptions: string[];
  steps: string[];
  confidence: "high" | "medium" | "low";
  needsClarification: boolean;
  clarifyingQuestion: string;
};

type TaskLike = Partial<Pick<Task,
  | "title"
  | "category"
  | "sourceType"
  | "sourceNote"
  | "sourceUrl"
  | "doneWhen"
  | "minimumOutcome"
  | "steps"
  | "readiness"
  | "blockerReason"
  | "size"
  | "estimateMinutes"
  | "estimateConfidence"
  | "estimateReason"
>>;

const CONNECTOR_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "with"]);
const BROAD_TITLE_RE = /^(?:please\s+)?(?:research|investigate|look\s+into|find\s+out\s+about|explore|understand|prepare|review|work\s+on|improve|fix|sort\s+out|think\s+about|plan|figure\s+out|develop|build|create|draft|write|organize|organise|update)\b/i;
const WEAK_DONE_RE = /^(?:you(?:'ve| have) done something concrete|something concrete is done|the next visible action is complete|done|finished|made progress|worked on it|one useful note exists)(?:,? even if small)?[.!]?$/i;
const WEAK_STEP_RE = /(?:rough sentence|break the blank page|identify the first visible thing|do some research|explore the landscape|organize your thoughts|think about|first thing you need to understand|something concrete)/i;

function compact(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s&'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return compact(value).split(/\s+/).map((word) => word.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
}

function acronym(value: string): string {
  return words(value)
    .filter((word) => !CONNECTOR_WORDS.has(word.toLowerCase()))
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

function contextPhrases(context: string): string[] {
  const matches = context.match(/\b[A-Z][A-Za-z0-9&'-]*(?:\s+(?:(?:of|for|and|the|in)\s+)?[A-Z][A-Za-z0-9&'-]*){1,6}\b/g) || [];
  return [...new Set(matches.map(compact).filter((phrase) => phrase.length >= 5))];
}

export function resolveTaskTarget(target: string, context: string): { value: string; confidence: TaskBrief["confidence"]; assumption?: string } {
  const raw = compact(target);
  if (!raw) return { value: "", confidence: "low" };
  const abbreviation = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^[A-Z0-9]{2,10}$/.test(abbreviation)) {
    const explicit = context.match(new RegExp(`([^.;:\n]{3,100})\\s*\\(${abbreviation}\\)`, "i"));
    if (explicit?.[1]) {
      const value = compact(explicit[1]).replace(/^.*?\b(?:is|means|called)\s+/i, "");
      return { value, confidence: "high", assumption: `${abbreviation} was resolved from explicit context.` };
    }
    const candidates = contextPhrases(context).filter((phrase) => acronym(phrase) === abbreviation);
    if (candidates.length === 1) {
      return { value: candidates[0], confidence: "high", assumption: `${abbreviation} was resolved from the user's existing context.` };
    }
    if (candidates.length > 1) {
      return { value: raw, confidence: "low", assumption: `${abbreviation} has more than one plausible expansion in context.` };
    }
  }
  return { value: raw, confidence: raw.length > 2 ? "medium" : "low" };
}

function parseStepTexts(raw: unknown): string[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((step) => compact(step?.text || step)).filter(Boolean);
  } catch {
    return [];
  }
}

export function isWeakDoneWhen(value: unknown): boolean {
  const text = compact(value);
  return !text || WEAK_DONE_RE.test(text);
}

export function isWeakTaskStep(value: unknown): boolean {
  const text = compact(value);
  return !text || WEAK_STEP_RE.test(text);
}

export function shouldUnderstandTask(task: TaskLike): boolean {
  const title = compact(task.title);
  if (!title) return false;
  if (compact(task.sourceNote).includes(TASK_BRIEF_MARKER)) {
    const existing = parseStepTexts(task.steps);
    if (!isWeakDoneWhen(task.doneWhen) && existing.length > 0 && !existing.some(isWeakTaskStep)) return false;
  }
  const existing = parseStepTexts(task.steps);
  const broad = BROAD_TITLE_RE.test(title);
  const weakContract = isWeakDoneWhen(task.doneWhen) || existing.length === 0 || existing.some(isWeakTaskStep);
  return broad && weakContract;
}

function classifyKind(title: string): TaskUnderstandingKind {
  if (/^(?:research|investigate|look\s+into|find\s+out\s+about|explore|understand)\b/i.test(title)) return "research";
  if (/^(?:decide|choose|compare|evaluate|figure\s+out|think\s+about)\b/i.test(title)) return "decision";
  if (/^(?:email|message|reply|contact|reach\s+out|follow\s+up|draft\s+(?:a\s+)?message)\b/i.test(title)) return "communication";
  if (/^(?:prepare|prep)\b/i.test(title)) return "preparation";
  if (/^(?:review|audit|check|assess|inspect)\b/i.test(title)) return "review";
  if (/^(?:write|draft|create|build|develop|design|outline)\b/i.test(title)) return "creation";
  if (/^(?:improve|fix|strengthen|refine|revise|update)\b/i.test(title)) return "improvement";
  if (/^(?:organize|organise|sort\s+out|plan|work\s+on)\b/i.test(title)) return "organization";
  return "unknown";
}

function extractTarget(title: string, kind: TaskUnderstandingKind): string {
  const patterns: Record<TaskUnderstandingKind, RegExp> = {
    research: /^(?:please\s+)?(?:research|investigate|look\s+into|find\s+out\s+about|explore|understand)\s+(?:about\s+)?/i,
    decision: /^(?:please\s+)?(?:decide|choose|compare|evaluate|figure\s+out|think\s+about)\s+/i,
    communication: /^(?:please\s+)?(?:email|message|reply\s+to|contact|reach\s+out\s+to|follow\s+up\s+with|draft\s+(?:a\s+)?message\s+to)\s+/i,
    preparation: /^(?:please\s+)?(?:prepare|prep)(?:\s+for)?\s+/i,
    review: /^(?:please\s+)?(?:review|audit|check|assess|inspect)\s+/i,
    creation: /^(?:please\s+)?(?:write|draft|create|build|develop|design|outline)\s+/i,
    improvement: /^(?:please\s+)?(?:improve|fix|strengthen|refine|revise|update)\s+/i,
    organization: /^(?:please\s+)?(?:organize|organise|sort\s+out|plan|work\s+on)\s+/i,
    unknown: /^$/,
  };
  return compact(title.replace(patterns[kind], ""))
    .replace(/\s+(?:so\s+that|so\s+i\s+can|to\s+help\s+me|in\s+order\s+to)\s+.+$/i, "")
    .replace(/[.?!]+$/g, "");
}

function explicitPurpose(title: string, sourceNote: string): string {
  const text = `${title}. ${sourceNote}`;
  const match = text.match(/\b(?:so\s+that|so\s+i\s+can|to\s+help\s+me|in\s+order\s+to)\s+([^.;]+)/i);
  return compact(match?.[1]);
}

function relationshipSignal(target: string, resolvedTarget: string, context: string): string {
  const haystack = normalized(context);
  for (const label of [target, resolvedTarget]) {
    const needle = normalized(label);
    if (!needle) continue;
    if (haystack.includes(`ex ${needle}`) || haystack.includes(`former ${needle}`) || haystack.includes(`worked at ${needle}`) || haystack.includes(`worked for ${needle}`)) {
      return `The user's existing context shows prior experience with ${resolvedTarget || target}.`;
    }
  }
  return "";
}

function goalSignal(context: string): string {
  const explicit = context.match(/Explicit goals\/preferences:\s*([^\n]+)/i)?.[1]
    || context.match(/Active tracks?:\s*([^\n]+)/i)?.[1]
    || context.match(/Target role types:\s*([^\n]+)/i)?.[1];
  return compact(explicit).slice(0, 240);
}

function goalRelatesToTarget(target: string, resolvedTarget: string, goal: string): boolean {
  const haystack = normalized(goal);
  const tokens = [...words(target), ...words(resolvedTarget)]
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 4 && !CONNECTOR_WORDS.has(word));
  return tokens.some((token) => haystack.includes(token));
}

function briefTemplate(kind: TaskUnderstandingKind, target: string, resolvedTarget: string, purpose: string, whyNow: string): Pick<TaskBrief, "objective" | "desiredOutput" | "doneWhen" | "evidenceNeeded" | "steps"> {
  const label = resolvedTarget || target || "the task";
  if (kind === "research") {
    const objective = purpose || `Determine what ${label} is, why it matters here, and what action or decision follows.`;
    const desiredOutput = `a short sourced brief on ${label} that answers the objective and ends with a next action`;
    return {
      objective,
      desiredOutput,
      doneWhen: `A short sourced brief identifies ${label}, answers “${objective}”, records the decisive facts with source links, and states the next action or no-action decision.`,
      evidenceNeeded: ["one primary or authoritative source", "the facts that directly answer the objective", "a source link for each material claim"],
      steps: [
        `Open one primary or authoritative source for ${label} and save its link`,
        `Extract only the facts needed to answer: ${objective}`,
        `Write what those facts mean for ${whyNow || "the current goal"}, including the main uncertainty`,
        "Save the brief with one decision or next action, then stop researching",
      ],
    };
  }
  if (kind === "decision") {
    const objective = purpose || `Choose the best next position on ${label}.`;
    return { objective, desiredOutput: `a decision note for ${label}`, doneWhen: `The real options, three decision criteria, current choice, and next test or action for ${label} are recorded.`, evidenceNeeded: ["the real options", "the criteria that matter", "the evidence that could change the choice"], steps: [`Write the exact decision about ${label} in one line`, `List the real options and the three criteria that matter to ${whyNow || "the goal"}`, "Mark the evidence for and against each option", "Record the current choice and next test or action"] };
  }
  if (kind === "communication") {
    const objective = purpose || `Move the relationship or request involving ${label} forward.`;
    return { objective, desiredOutput: `a sendable message to ${label}`, doneWhen: `A concise message to ${label} has a clear why-now, specific ask, and is sent or deliberately scheduled.`, evidenceNeeded: ["recipient", "why now", "smallest credible ask"], steps: [`Open the current thread or a blank message to ${label}`, "Write the why-now using the available context", "Add one specific, low-friction ask", "Trim, send, or schedule the message"] };
  }
  if (kind === "preparation") {
    const objective = purpose || `Be ready for ${label} with the highest-risk questions and evidence covered.`;
    return { objective, desiredOutput: `a usable preparation brief for ${label}`, doneWhen: `A preparation brief for ${label} contains the format, likely asks, strongest evidence, highest-risk gap, and first response or talking point.`, evidenceNeeded: ["format or expected ask", "relevant evidence", "highest-risk gap"], steps: [`Open the source, invitation, brief, or notes for ${label}`, "Extract the format, expected asks, and highest-risk point", "Match the strongest available evidence to the most important ask", "Save one usable answer, talking point, or checklist"] };
  }
  if (kind === "review") {
    const objective = purpose || `Evaluate ${label} against the current goal and decide the next change.`;
    return { objective, desiredOutput: `a review note with the next change to ${label}`, doneWhen: `${label} has been checked against explicit criteria, the most important issue is marked, and one change or decision is recorded.`, evidenceNeeded: ["the object being reviewed", "review criteria", "the most material issue"], steps: [`Open ${label} and write the criteria it must meet`, "Mark the strongest part and the most material issue", `Check the issue against ${whyNow || "the current goal"}`, "Make or record the highest-value change"] };
  }
  if (kind === "creation") {
    const objective = purpose || `Create the smallest usable version of ${label}.`;
    return { objective, desiredOutput: `a usable first version of ${label}`, doneWhen: `A saved first version of ${label} has a clear audience or user, purpose, core content, and next edit.`, evidenceNeeded: ["audience or user", "purpose", "core claim or required content"], steps: [`Write who ${label} is for and what it must achieve`, "List the minimum content needed for a usable first version", "Create the smallest complete version", "Save it and mark the next edit or test"] };
  }
  if (kind === "improvement") {
    const objective = purpose || `Improve the most consequential weakness in ${label}.`;
    return { objective, desiredOutput: `a visibly improved version of ${label}`, doneWhen: `The baseline problem in ${label} is named, one material change is made, and the result is checked against a clear success criterion.`, evidenceNeeded: ["current baseline", "success criterion", "evidence the change helped"], steps: [`Open ${label} and name the single most important weakness`, "Write the success criterion for the change", "Make one material change", "Compare before and after, then save the result"] };
  }
  if (kind === "organization") {
    const objective = purpose || `Turn ${label} into a clear, usable set of priorities and next actions.`;
    return { objective, desiredOutput: `an organized view of ${label} with a clear next action`, doneWhen: `${label} is grouped into keep, act, wait, or remove; the top item has a next action; and anything deferred has a date or condition.`, evidenceNeeded: ["the items involved", "priority criteria", "next-action ownership"], steps: [`Open or list the items inside ${label}`, "Group them into act, wait, keep, or remove", "Choose the highest-value item and write its next action", "Save the organized view and date anything deferred"] };
  }
  return { objective: purpose, desiredOutput: "", doneWhen: "", evidenceNeeded: [], steps: [] };
}

export function buildDeterministicTaskBrief(task: TaskLike, context = ""): TaskBrief | null {
  const title = compact(task.title);
  if (!title || !BROAD_TITLE_RE.test(title)) return null;
  const kind = classifyKind(title);
  const target = extractTarget(title, kind);
  const resolution = resolveTaskTarget(target, context);
  const relationship = relationshipSignal(target, resolution.value, context);
  const explicit = explicitPurpose(title, compact(task.sourceNote));
  const goal = goalSignal(context);
  const relatedGoal = goal && goalRelatesToTarget(target, resolution.value, goal) ? goal : "";
  const sourcePurpose = task.sourceType === "job" ? "Assess fit or move the opportunity forward."
    : task.sourceType === "contact" ? "Prepare a credible relationship move."
    : task.sourceType === "learn" ? "Build a capability or reusable learning output."
    : task.sourceType === "hustle" ? "Create a credible proof asset."
    : "";
  const purpose = explicit || sourcePurpose || (relationship ? "Assess how current developments connect to that prior experience and the user's present goals." : relatedGoal ? `Decide how this supports the user's current goals: ${relatedGoal}` : "");
  const whyNow = relationship || (relatedGoal ? `It supports the current goal: ${relatedGoal}` : compact(task.sourceNote));
  const targetMissing = !target || /^(?:it|this|that|stuff|things?|work|task|project)$/i.test(target);
  const needsClarification = kind === "unknown" || targetMissing || (!purpose && ["research", "organization"].includes(kind));
  const clarifyingQuestion = targetMissing
    ? `What specific object or outcome should “${title}” produce?`
    : kind === "research"
      ? `What should researching ${resolution.value || target} help you decide or do?`
      : `What outcome should ${title} produce, and what will it be used for?`;
  const template = briefTemplate(kind, target, resolution.value, purpose, whyNow);
  return {
    version: TASK_BRIEF_VERSION,
    kind,
    target,
    resolvedTarget: resolution.value,
    objective: template.objective,
    whyNow,
    desiredOutput: template.desiredOutput,
    doneWhen: template.doneWhen,
    evidenceNeeded: template.evidenceNeeded,
    assumptions: [resolution.assumption, relationship || undefined, purpose ? `Purpose inferred as: ${purpose}` : undefined].filter(Boolean) as string[],
    steps: needsClarification ? [] : template.steps,
    confidence: needsClarification ? "low" : resolution.confidence === "high" || explicit || sourcePurpose ? "high" : "medium",
    needsClarification,
    clarifyingQuestion,
  };
}

function cleanStringList(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(compact).filter(Boolean))].slice(0, max);
}

function validLlmBrief(value: any, fallback: TaskBrief): TaskBrief {
  if (!value || typeof value !== "object") return fallback;
  const needsClarification = value.needsClarification === true;
  const steps = cleanStringList(value.steps, 5).filter((step) => !isWeakTaskStep(step));
  const doneWhen = compact(value.doneWhen);
  if (!needsClarification && (!doneWhen || !steps.length)) return fallback;
  return {
    ...fallback,
    kind: ["research", "decision", "communication", "preparation", "review", "creation", "improvement", "organization", "unknown"].includes(value.kind) ? value.kind : fallback.kind,
    target: compact(value.target) || fallback.target,
    resolvedTarget: compact(value.resolvedTarget) || fallback.resolvedTarget,
    objective: compact(value.objective) || fallback.objective,
    whyNow: compact(value.whyNow) || fallback.whyNow,
    desiredOutput: compact(value.desiredOutput) || fallback.desiredOutput,
    doneWhen: doneWhen || fallback.doneWhen,
    evidenceNeeded: cleanStringList(value.evidenceNeeded, 6).length ? cleanStringList(value.evidenceNeeded, 6) : fallback.evidenceNeeded,
    assumptions: cleanStringList(value.assumptions, 6),
    steps: needsClarification ? [] : steps,
    confidence: ["high", "medium", "low"].includes(value.confidence) ? value.confidence : fallback.confidence,
    needsClarification,
    clarifyingQuestion: compact(value.clarifyingQuestion) || fallback.clarifyingQuestion,
  };
}

export async function refineTaskBriefWithLlm(input: { task: TaskLike; fallback: TaskBrief; context: string }): Promise<TaskBrief> {
  const prompt = `You are Anchor's task-understanding layer. Understand the ask before producing any steps.\n\nTASK\n${compact(input.task.title)}\n\nAVAILABLE CONTEXT\n${input.context.slice(0, 9000)}\n\nDETERMINISTIC DRAFT\n${JSON.stringify(input.fallback)}\n\nReturn one JSON object with: kind, target, resolvedTarget, objective, whyNow, desiredOutput, doneWhen, evidenceNeeded, assumptions, steps, confidence, needsClarification, clarifyingQuestion.\nRules:\n- Use the user's goals, source object, relationships, prior work, and supplied evidence.\n- Resolve acronyms or entities only when the context or cited evidence supports the resolution.\n- Infer the purpose when evidence is strong. Otherwise ask exactly one high-value clarification.\n- Never use filler such as 'make progress', 'do something concrete', 'write a rough sentence', or 'research the topic'.\n- Every step must name the object, action, and visible output.\n- Research must end in a sourced answer, decision, artifact, or next action.\n- Preserve uncertainty in assumptions. Do not invent current facts.\n- Maximum five steps.`;
  const result = await llmJSON<Record<string, unknown>>(prompt, { model: LLM_MODELS.breakdown, retries: 1 });
  return validLlmBrief(result, input.fallback);
}

function categoryForBrief(brief: TaskBrief, current: string): string {
  if (current && current !== "admin") return current;
  if (brief.kind === "communication" || brief.kind === "organization") return "admin";
  if (brief.kind === "creation") return "substack";
  if (brief.kind === "preparation") return "job";
  if (brief.kind === "research" || brief.kind === "decision" || brief.kind === "review" || brief.kind === "improvement") return "thinking";
  return current || "admin";
}

function briefNote(brief: TaskBrief): string {
  return `${TASK_BRIEF_MARKER} ${JSON.stringify({ version: brief.version, kind: brief.kind, target: brief.target, resolvedTarget: brief.resolvedTarget, objective: brief.objective, whyNow: brief.whyNow, desiredOutput: brief.desiredOutput, evidenceNeeded: brief.evidenceNeeded, assumptions: brief.assumptions, confidence: brief.confidence })}`;
}

export function taskPatchFromBrief(task: TaskLike, brief: TaskBrief): Record<string, unknown> {
  const existingSteps = parseStepTexts(task.steps);
  const replaceSteps = existingSteps.length === 0 || existingSteps.some(isWeakTaskStep);
  const replaceDone = isWeakDoneWhen(task.doneWhen);
  const existingNote = compact(task.sourceNote);
  const note = briefNote(brief);
  const patch: Record<string, unknown> = {
    category: categoryForBrief(brief, compact(task.category)),
    sourceNote: existingNote.includes(TASK_BRIEF_MARKER) ? existingNote.replace(new RegExp(`${TASK_BRIEF_MARKER}.*$`), note) : [existingNote, note].filter(Boolean).join("\n"),
    estimateMinutes: task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : brief.kind === "research" ? 35 : 30,
    estimateConfidence: compact(task.estimateConfidence) || "medium",
    estimateReason: compact(task.estimateReason) || "task_brief_v1",
  };
  if (replaceDone) patch.doneWhen = brief.needsClarification ? `The intended outcome for “${brief.target || compact(task.title)}” is clear enough to plan.` : brief.doneWhen;
  if (isWeakDoneWhen(task.minimumOutcome)) patch.minimumOutcome = brief.needsClarification ? "The intended outcome is clarified." : brief.desiredOutput;
  if (replaceSteps) {
    patch.steps = brief.needsClarification ? "[]" : JSON.stringify(brief.steps.map((text, index) => ({ text, done: false, ...(index === brief.steps.length - 1 ? { workflowState: { workObject: brief.kind === "research" ? "Knowledge" : brief.kind === "decision" ? "Decision" : "Artifact", workflow: ["Understand", "Execute", "Verify"], workflowKind: "finite", currentStage: "Understand", stageOutput: brief.desiredOutput, completionCriteria: [brief.doneWhen], advanceCondition: brief.doneWhen, confidence: brief.confidence, taskBrief: brief } } : {}) })));
  }
  if (brief.needsClarification) {
    patch.readiness = "needs_info";
    patch.blockerReason = brief.clarifyingQuestion;
  } else if (task.readiness === "needs_info" && compact(task.blockerReason).endsWith("?")) {
    patch.readiness = "ready";
    patch.blockerReason = "";
  }
  return patch;
}
