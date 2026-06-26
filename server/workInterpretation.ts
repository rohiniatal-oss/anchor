import type { CandidateParent, WorkDefinition, WorkScope, WorkType } from "@shared/work";
import { workDefinitionSchema } from "@shared/work";
import { llmJSON, LLM_MODELS } from "./llm";

export type WorkInterpretationInput = {
  title: string;
  sourceType?: string;
  sourceId?: number | null;
  sourceNote?: string;
  doneWhen?: string;
  minimumOutcome?: string;
  relatedTrackId?: number | null;
  context?: string;
  candidateParent?: CandidateParent;
  forceWorkType?: WorkType;
};

type DefinitionTemplateInput = {
  workType: WorkType;
  intent: string;
  target: string;
  resolvedTarget: string;
  purpose: string;
  whyNow: string;
  scope: WorkScope;
  candidateParent?: CandidateParent;
};

const CONNECTOR_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "with"]);
const SEARCH_COMMAND_RE = /^(?:please\s+)?(?:search(?:\s+for)?|find(?:\s+me)?|look\s+(?:up|for|into)|find\s+out\s+about|identify|map(?:\s+out)?|scan|source|shortlist|discover|locate|research|investigate|explore|understand)\b/i;
const SEARCHABLE_OBJECT_RE = /\b(roles?|jobs?|postings?|vacanc(?:y|ies)|companies|organisations|organizations|people|contacts?|alumni|experts?|courses?|programs?|programmes?|fellowships?|resources?|articles?|reports?|datasets?|examples?|events?|grants?|funders?|teams?|workstreams?|requirements?|landscape|market)\b/i;
const GENERIC_SEARCH_TARGET_RE = /^(?:jobs?|roles?|people|contacts?|courses?|resources?|companies|organisations|organizations|programs?|programmes?|fellowships?|things?|options?|ideas?|examples?)$/i;
const BROAD_WORK_RE = /^(?:please\s+)?(?:search(?:\s+for)?|find(?:\s+me)?|look\s+(?:up|for|into)|find\s+out\s+about|identify|map(?:\s+out)?|scan|source|shortlist|discover|locate|research|investigate|explore|understand|prepare|review|work\s+on|improve|fix|sort\s+out|think\s+about|plan|figure\s+out|develop|build|create|draft|write|organize|organise|update|launch|set\s+up)\b/i;
const ATOMIC_RE = /^(?:send|email|reply|forward|pay|book|cancel|confirm|call|text|message|sign|renew|submit|post|share|download|upload|print|return|schedule|open|save|paste|attach)\b/i;
const DECISION_RE = /^(?:decide|choose|compare|evaluate|figure\s+out|think\s+about|whether)\b/i;
const PROJECT_SIGNAL_RE = /\b(career\s+transition|job\s+search|campaign|launch|programme|program|portfolio|pipeline|path|move into|build toward|set up|end to end|from scratch)\b/i;
const BOUNDED_OUTPUT_RE = /\b(one|1|single|short|five[- ]line|one[- ]page|email|message|note|brief|list|outline|draft|answer|checklist|decision|comparison|three|3|shortlist)\b/i;
const WEAK_DONE_RE = /^(?:you(?:'ve| have) done something concrete|something concrete is done|the next visible action is complete|done|finished|made progress|worked on it|one useful note exists)(?:,? even if small)?[.!]?$/i;
const WEAK_STEP_RE = /(?:rough sentence|break the blank page|identify the first visible thing|do some research|explore the landscape|organize your thoughts|think about|first thing you need to understand|something concrete)/i;

function compact(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function commandTitle(value: string) {
  return compact(value).replace(/^please\s+/i, "");
}

function normalized(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^\p{L}\p{N}\s&']+/gu, " ")
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

/** Normalize relationship phrasing before entity and prior-work matching. */
export function normalizeContextForWork(value: string) {
  return String(value || "")
    .replace(/\b(ex|former)-(?=[A-Z])/g, "$1 ")
    .replace(/\b(worked)-(?=(?:at|for)\b)/gi, "$1 ");
}

/** Resolve acronyms only when one unambiguous expansion is present in context. */
export function resolveWorkTarget(target: string, context: string): { value: string; confidence: WorkDefinition["confidence"]; assumption?: string } {
  const raw = compact(target);
  if (!raw) return { value: "", confidence: "low" };
  const abbreviation = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^[A-Z0-9]{2,10}$/.test(abbreviation)) {
    const explicit = context.match(new RegExp(`([^.;:\n]{3,100})\\s*\\(${abbreviation}\\)`, "i"));
    if (explicit?.[1]) {
      return {
        value: compact(explicit[1]).replace(/^.*?\b(?:is|means|called)\s+/i, ""),
        confidence: "high",
        assumption: `${abbreviation} was resolved from explicit context.`,
      };
    }
    const candidates = contextPhrases(context).filter((phrase) => acronym(phrase) === abbreviation);
    if (candidates.length === 1) {
      return { value: candidates[0], confidence: "high", assumption: `${abbreviation} was resolved from existing context.` };
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
    return Array.isArray(parsed) ? parsed.map((step) => compact(step?.text || step)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function isWeakDoneWhen(value: unknown) {
  const text = compact(value);
  return !text || WEAK_DONE_RE.test(text);
}

export function isWeakStep(value: unknown) {
  const text = compact(value);
  return !text || WEAK_STEP_RE.test(text);
}

/** Detect broad work that should be interpreted before it becomes execution. */
export function needsWorkInterpretation(input: Pick<WorkInterpretationInput, "title" | "doneWhen"> & { steps?: unknown }) {
  const title = compact(input.title);
  if (!title || (!BROAD_WORK_RE.test(title) && !DECISION_RE.test(title))) return false;
  const steps = parseStepTexts(input.steps);
  return isWeakDoneWhen(input.doneWhen) || !steps.length || steps.some(isWeakStep);
}

function classifyIntent(title: string) {
  const text = commandTitle(title);
  if (SEARCH_COMMAND_RE.test(text)) return "search";
  if (DECISION_RE.test(text)) return "decision";
  if (/^(?:prepare|prep)\b/i.test(text)) return "preparation";
  if (/^(?:review|audit|check|assess|inspect)\b/i.test(text)) return "review";
  if (/^(?:write|draft|create|build|develop|design|outline|launch)\b/i.test(text)) return "creation";
  if (/^(?:improve|fix|strengthen|refine|revise|update)\b/i.test(text)) return "improvement";
  if (/^(?:organize|organise|sort\s+out|plan|work\s+on|set\s+up)\b/i.test(text)) return "organization";
  return "general";
}

function extractTarget(title: string) {
  return compact(title
    .replace(/^(?:please\s+)?(?:search(?:\s+for)?|find(?:\s+me)?|look\s+(?:up|for|into)|find\s+out\s+about|identify|map(?:\s+out)?|scan|source|shortlist|discover|locate|research|investigate|explore|understand|prepare|prep(?:are)?\s+for|review|audit|check|assess|inspect|work\s+on|improve|fix|sort\s+out|think\s+about|plan|figure\s+out|develop|build|create|draft|write|organize|organise|update|launch|set\s+up)\s+(?:about\s+|for\s+)?/i, "")
    .replace(/\s+(?:so\s+that|so\s+i\s+can|to\s+help\s+me|in\s+order\s+to)\s+.+$/i, "")
    .replace(/[.?!]+$/g, ""));
}

function explicitPurpose(title: string, sourceNote: string) {
  const match = `${title}. ${sourceNote}`.match(/\b(?:so\s+that|so\s+i\s+can|to\s+help\s+me|in\s+order\s+to)\s+([^.;]+)/i);
  return compact(match?.[1]);
}

function relationshipSignal(target: string, resolvedTarget: string, context: string) {
  const haystack = normalized(context);
  for (const label of [target, resolvedTarget]) {
    const needle = normalized(label);
    if (!needle) continue;
    if (haystack.includes(`ex ${needle}`)
      || haystack.includes(`former ${needle}`)
      || haystack.includes(`worked at ${needle}`)
      || haystack.includes(`worked for ${needle}`)) {
      return `Existing context shows prior experience with ${resolvedTarget || target}.`;
    }
  }
  return "";
}

function goalSignal(context: string) {
  return compact(
    context.match(/Explicit goals\/preferences:\s*([^\n]+)/i)?.[1]
      || context.match(/Active tracks?:\s*([^\n]+)/i)?.[1]
      || context.match(/Target role types:\s*([^\n]+)/i)?.[1]
      || "",
  ).slice(0, 320);
}

function goalRelatesToTarget(target: string, resolvedTarget: string, goal: string) {
  const haystack = normalized(goal);
  const tokens = [...words(target), ...words(resolvedTarget)]
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 4 && !CONNECTOR_WORDS.has(word));
  return tokens.some((token) => haystack.includes(token));
}

function hasMultiOutcomeLanguage(title: string) {
  const normalizedTitle = normalized(title);
  const conjunctions = (normalizedTitle.match(/\b(and|then|plus|before|after)\b/g) || []).length;
  return conjunctions >= 2 || /\b(end to end|from scratch|full|complete|whole|across)\b/.test(normalizedTitle);
}

function inferScope(title: string, intent: string): WorkScope {
  if (ATOMIC_RE.test(title)) return "single_action";
  if (intent === "search") {
    if (PROJECT_SIGNAL_RE.test(title) || hasMultiOutcomeLanguage(title)) {
      return /\b(month|quarter|ongoing|transition|campaign|programme|program)\b/i.test(title) ? "multi_week" : "multi_session";
    }
    if (BOUNDED_OUTPUT_RE.test(title) || SEARCHABLE_OBJECT_RE.test(title)) return "single_session";
    return "multi_session";
  }
  if (PROJECT_SIGNAL_RE.test(title) || hasMultiOutcomeLanguage(title)) {
    return /\b(month|quarter|ongoing|transition|campaign|programme|program)\b/i.test(title) ? "multi_week" : "multi_session";
  }
  if (["creation", "improvement", "organization"].includes(intent) && !BOUNDED_OUTPUT_RE.test(title)) return "multi_session";
  return "single_session";
}

function inferWorkType(input: WorkInterpretationInput, scope: WorkScope, intent: string): WorkType {
  if (input.forceWorkType) return input.forceWorkType;
  if (ATOMIC_RE.test(input.title) || scope === "single_action") return "task";
  if (input.candidateParent && input.candidateParent.confidence >= 0.55) {
    return scope === "single_session" ? "task" : "milestone";
  }
  if (intent === "decision" && scope === "single_session") return "decision";
  if (scope === "multi_session" || scope === "multi_week") return "project";
  return "task";
}

function sourcePurpose(sourceType: string) {
  if (sourceType === "job") return "Assess fit or move the opportunity forward.";
  if (sourceType === "contact") return "Prepare a credible relationship move.";
  if (sourceType === "learn") return "Build a capability or reusable learning output.";
  if (sourceType === "hustle") return "Create a credible proof asset.";
  return "";
}

function definitionTemplate(input: DefinitionTemplateInput) {
  const label = input.resolvedTarget || input.target || "the work";
  const purpose = input.purpose;
  const isSearch = input.intent === "search" || input.intent === "research";
  if (input.workType === "project") {
    const objective = purpose || (isSearch
      ? `Decide what ${label} means for the current goal and what action should follow.`
      : `Move ${label} from an ambiguous intention to a completed, usable outcome.`);
    return {
      title: isSearch ? `Decide whether and how to pursue ${label}` : `Complete ${label}`,
      objective,
      desiredOutcome: `A decision-ready result for ${label}, with the relevant evidence, intermediate outcomes, and next commitment visible.`,
      successCriteria: [
        `The intended outcome for ${label} is explicit`,
        "The important intermediate outcomes are complete or deliberately ruled out",
        "The final decision, deliverable, or next commitment is recorded",
      ],
      deliverables: isSearch
        ? [`A sourced discovery map of ${label}`, "A relevance or fit assessment", "A pursue, change, monitor, or stop decision"]
        : [`A usable final outcome for ${label}`, "A record of the decisive evidence or checks"],
    };
  }
  if (input.workType === "milestone") {
    return {
      title: input.target || label,
      objective: purpose || `Produce the next independently useful outcome for ${label}.`,
      desiredOutcome: `A completed milestone that materially advances ${input.candidateParent?.projectTitle || "the parent project"}.`,
      successCriteria: ["The milestone output exists", "Its quality or completeness check is passed", "The parent project can move to its next frontier"],
      deliverables: [`The milestone output for ${label}`],
    };
  }
  if (input.workType === "decision") {
    return {
      title: `Decide ${label}`,
      objective: purpose || `Choose the strongest current position on ${label}.`,
      desiredOutcome: "A decision note with the real options, criteria, evidence, current choice, and next test.",
      successCriteria: ["The real options are visible", "The decisive criteria and evidence are recorded", "A current choice or next test is committed"],
      deliverables: [`A decision note for ${label}`],
    };
  }
  const objective = purpose || (isSearch
    ? `Answer one bounded search question about ${label} and use it to make a decision or next move.`
    : `Produce one independently useful result for ${label}.`);
  return {
    title: input.target || label,
    objective,
    desiredOutcome: isSearch
      ? `A short sourced search result about ${label} that ends in a decision or next action.`
      : `One independently useful output for ${label}.`,
    successCriteria: isSearch
      ? ["The search question is answered", "Material claims have source links", "The implication and next action are explicit"]
      : ["The specified output exists", "The done condition is objectively checkable"],
    deliverables: isSearch ? [`A sourced search result about ${label}`] : [`The completed output for ${label}`],
  };
}

/** Interpret the level and outcome of work without creating execution steps. */
export function interpretWorkDeterministically(input: WorkInterpretationInput): WorkDefinition {
  const title = compact(input.title);
  const context = normalizeContextForWork(input.context || "");
  const intent = classifyIntent(title);
  const target = extractTarget(title);
  const resolution = resolveWorkTarget(target, context);
  const relationship = relationshipSignal(target, resolution.value, context);
  const explicit = explicitPurpose(title, compact(input.sourceNote));
  const source = sourcePurpose(compact(input.sourceType));
  const goal = goalSignal(context);
  const relatedGoal = goal && goalRelatesToTarget(target, resolution.value, goal) ? goal : "";
  const purpose = explicit || source || (relationship
    ? "Assess how current developments connect to that prior experience and the user's present goals."
    : relatedGoal
      ? `Decide how this supports the current goal: ${relatedGoal}`
      : "");
  const whyNow = relationship || (relatedGoal ? `This serves the current goal: ${relatedGoal}` : compact(input.sourceNote));
  const scope = inferScope(title, intent);
  const workType = inferWorkType(input, scope, intent);
  const template = definitionTemplate({
    workType,
    intent,
    target,
    resolvedTarget: resolution.value,
    purpose,
    whyNow,
    scope,
    candidateParent: input.candidateParent,
  });
  const targetMissing = !target || /^(?:it|this|that|stuff|things?|work|task|project)$/i.test(target);
  const genericSearchTarget = intent === "search" && GENERIC_SEARCH_TARGET_RE.test(target);
  const unresolvedSearchTarget = intent === "search" && resolution.confidence === "low" && !purpose;
  const needsClarification = workType === "reference"
    || targetMissing
    || (genericSearchTarget && !purpose)
    || unresolvedSearchTarget
    || (!purpose && ["organization"].includes(intent));
  const clarifyingQuestion = targetMissing
    ? `What specific result should “${title}” produce?`
    : intent === "search"
      ? `What should searching ${resolution.value || target} help you decide, produce, or change?`
      : workType === "project"
        ? `What decision or completed outcome should this project produce for ${resolution.value || target}?`
        : `What should ${title} help you decide, produce, or change?`;
  return workDefinitionSchema.parse({
    version: 1,
    workType,
    title: template.title,
    objective: template.objective,
    whyNow,
    desiredOutcome: template.desiredOutcome,
    successCriteria: template.successCriteria,
    deliverables: template.deliverables,
    constraints: [],
    assumptions: [resolution.assumption, relationship || undefined, purpose ? `Purpose inferred as: ${purpose}` : undefined].filter(Boolean),
    estimatedScope: scope,
    confidence: needsClarification ? "low" : resolution.confidence === "high" || explicit || source ? "high" : "medium",
    parentDirectionId: input.relatedTrackId ?? null,
    candidateParent: input.candidateParent ?? null,
    needsClarification,
    clarifyingQuestion,
    sourceTitle: title,
    sourceType: input.sourceType || "capture",
    sourceId: input.sourceId ?? null,
  });
}

function cleanList(value: unknown, max = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(compact).filter(Boolean))].slice(0, max);
}

/** Refine a deterministic definition while retaining validated provenance fields. */
export async function interpretWork(input: WorkInterpretationInput): Promise<WorkDefinition> {
  const fallback = interpretWorkDeterministically(input);
  const prompt = `You are Anchor's work-interpretation engine. Identify the correct level of work before planning it.\n\nINPUT\n${JSON.stringify({ title: input.title, sourceType: input.sourceType, sourceNote: input.sourceNote, relatedTrackId: input.relatedTrackId, candidateParent: input.candidateParent })}\n\nAVAILABLE CONTEXT\n${String(input.context || "").slice(0, 9000)}\n\nDETERMINISTIC DRAFT\n${JSON.stringify(fallback)}\n\nReturn only JSON matching this shape: workType, title, objective, whyNow, desiredOutcome, successCriteria, deliverables, constraints, assumptions, estimatedScope, confidence, parentDirectionId, candidateParent, needsClarification, clarifyingQuestion.\n\nRules:\n- Classify as project when several independently useful outcomes or multiple sessions are required.\n- Classify as milestone only when it clearly belongs under the proposed existing project.\n- Classify as task when one independently useful output can be completed in one session.\n- Treat search, discovery, lookup, role scans, people searches, course searches, company searches, and research as the same family: define the search goal before creating objects.\n- Do not create execution steps.\n- Use source, relationship, track, profile, and prior-work context.\n- Resolve entities only from supplied context or public evidence.\n- Ask exactly one clarification only when the desired overall outcome would otherwise be materially wrong.\n- Preserve uncertainty in assumptions.\n- A project outcome is not 'do research' or 'search around'; it is the decision, capability, artifact, or changed state the discovery work enables.`;
  const result = await llmJSON<Record<string, unknown>>(prompt, { model: LLM_MODELS.breakdown, retries: 1 });
  if (!result) return fallback;
  const candidate = {
    ...fallback,
    ...result,
    version: 1,
    sourceTitle: fallback.sourceTitle,
    sourceType: fallback.sourceType,
    sourceId: fallback.sourceId,
    successCriteria: cleanList(result.successCriteria).length ? cleanList(result.successCriteria) : fallback.successCriteria,
    deliverables: cleanList(result.deliverables).length ? cleanList(result.deliverables) : fallback.deliverables,
    constraints: cleanList(result.constraints),
    assumptions: cleanList(result.assumptions).length ? cleanList(result.assumptions) : fallback.assumptions,
  };
  const parsed = workDefinitionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : fallback;
}

/** Convert a proposed project or milestone into a user-selected one-session task. */
export function forceDefinitionAsTask(definition: WorkDefinition): WorkDefinition {
  return workDefinitionSchema.parse({
    ...definition,
    workType: "task",
    estimatedScope: definition.estimatedScope === "single_action" ? "single_action" : "single_session",
    candidateParent: definition.candidateParent || null,
    title: definition.sourceTitle || definition.title,
    desiredOutcome: definition.deliverables[0] || definition.desiredOutcome,
    successCriteria: definition.successCriteria.slice(0, 4),
    needsClarification: false,
    clarifyingQuestion: "",
    assumptions: [...definition.assumptions, "The user chose to treat this as one independently useful task."],
  });
}
