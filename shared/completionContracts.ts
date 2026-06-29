import type { Learn, Task } from "./schema";

export type TaskIntent = "learn" | "explore" | "decide" | "practice" | "produce" | "maintain" | "recover" | "connect" | "apply" | "verify" | "assess";
export type CompletionContractKind = "exposure" | "capture" | "comprehension" | "application" | "decision" | "practice" | "deliverable" | "conversation" | "maintenance" | "recovery" | "reflection";
export type ResidueLevel = "none" | "marker" | "one_line" | "question" | "decision" | "note" | "artifact" | "external_signal" | "rubric_score";
export type AssessmentMode = "none" | "binary" | "choice" | "self_rating" | "rubric";

export type CompletionContract = {
  intent: TaskIntent;
  contract: CompletionContractKind;
  residueLevel: ResidueLevel;
  requiresArtifact: boolean;
  assessmentMode: AssessmentMode;
  completionPrompt: string;
  afterActionOptions: string[];
};

export function completionContract(input: CompletionContract): CompletionContract {
  return input;
}

function textOf(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function combinedText(parts: unknown[]) {
  return parts.map((part) => textOf(part)).filter(Boolean).join(" ");
}

function safeJson(value: unknown): Record<string, any> | null {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const COMPLETION_CONTRACTS = {
  exposure: completionContract({
    intent: "learn",
    contract: "exposure",
    residueLevel: "marker",
    requiresArtifact: false,
    assessmentMode: "choice",
    completionPrompt: "Was this worth continuing?",
    afterActionOptions: ["continue", "stop", "save_for_later", "turn_into_application"],
  }),
  comprehension: completionContract({
    intent: "learn",
    contract: "comprehension",
    residueLevel: "one_line",
    requiresArtifact: false,
    assessmentMode: "self_rating",
    completionPrompt: "Can you explain the main idea simply enough to continue?",
    afterActionOptions: ["understood", "still_unclear", "continue", "turn_into_application"],
  }),
  capture: completionContract({
    intent: "decide",
    contract: "capture",
    residueLevel: "decision",
    requiresArtifact: false,
    assessmentMode: "choice",
    completionPrompt: "What did you select, capture, or decide?",
    afterActionOptions: ["captured", "needs_more_input", "stop", "save_for_later"],
  }),
  application: completionContract({
    intent: "apply",
    contract: "application",
    residueLevel: "note",
    requiresArtifact: false,
    assessmentMode: "rubric",
    completionPrompt: "Did you apply the idea to a real or simulated context and make a judgement?",
    afterActionOptions: ["weak", "adequate", "strong", "needs_feedback"],
  }),
  deliverable: completionContract({
    intent: "produce",
    contract: "deliverable",
    residueLevel: "artifact",
    requiresArtifact: true,
    assessmentMode: "rubric",
    completionPrompt: "Does the artifact exist and meet the done condition?",
    afterActionOptions: ["weak", "adequate", "strong", "revise"],
  }),
  conversation: completionContract({
    intent: "connect",
    contract: "conversation",
    residueLevel: "external_signal",
    requiresArtifact: false,
    assessmentMode: "choice",
    completionPrompt: "What signal did the conversation or feedback create?",
    afterActionOptions: ["useful_signal", "needs_follow_up", "not_useful", "revise_ask"],
  }),
  reflection: completionContract({
    intent: "assess",
    contract: "reflection",
    residueLevel: "note",
    requiresArtifact: false,
    assessmentMode: "self_rating",
    completionPrompt: "What changed in your judgement, confidence, or uncertainty?",
    afterActionOptions: ["clearer", "still_unclear", "needs_feedback", "turn_into_output"],
  }),
  maintenance: completionContract({
    intent: "maintain",
    contract: "maintenance",
    residueLevel: "marker",
    requiresArtifact: false,
    assessmentMode: "binary",
    completionPrompt: "Was the maintenance action completed?",
    afterActionOptions: ["completed", "needs_follow_up"],
  }),
  recovery: completionContract({
    intent: "recover",
    contract: "recovery",
    residueLevel: "none",
    requiresArtifact: false,
    assessmentMode: "choice",
    completionPrompt: "Did this protect or improve your state?",
    afterActionOptions: ["helped", "neutral", "did_not_help"],
  }),
  rubricReflection: completionContract({
    intent: "assess",
    contract: "reflection",
    residueLevel: "rubric_score",
    requiresArtifact: false,
    assessmentMode: "rubric",
    completionPrompt: "Was the output weak, adequate, or strong against the relevant standard?",
    afterActionOptions: ["weak", "adequate", "strong", "repeat_narrower"],
  }),
} satisfies Record<string, CompletionContract>;

export function completionContractFromSourceNote(sourceNote: string | null | undefined): CompletionContract | null {
  const parsed = safeJson(sourceNote);
  const contract = parsed?.taskBlueprint?.completionContract;
  if (contract && typeof contract === "object" && typeof contract.contract === "string") {
    return contract as CompletionContract;
  }
  return null;
}

export function completionContractForLearn(item: Pick<Learn, "title" | "type" | "note" | "requiredOutput" | "outputTitle" | "outputStatus" | "outputEvidenceUrl" | "proofIntent" | "capabilityBuilt" | "learnStatus">): CompletionContract {
  const text = combinedText([item.title, item.type, item.note, item.requiredOutput, item.capabilityBuilt]);
  if (item.outputEvidenceUrl || item.outputTitle || item.outputStatus === "published" || item.proofIntent) return COMPLETION_CONTRACTS.deliverable;
  if (item.requiredOutput || /memo|brief|artifact|publish|post|portfolio|case note|write|draft|produce/.test(text)) return COMPLETION_CONTRACTS.deliverable;
  if (item.type === "practice" || /apply|practice|case|exercise|simulate|compare|framework|model/.test(text)) return COMPLETION_CONTRACTS.application;
  if (/understand|explain|concept|primer|foundation|basics|course/.test(text)) return COMPLETION_CONTRACTS.comprehension;
  return COMPLETION_CONTRACTS.exposure;
}

export function completionContractForTask(task: Pick<Task, "title" | "category" | "sourceType" | "sourceStepType" | "sourceNote" | "doneWhen" | "minimumOutcome" | "steps">): CompletionContract {
  const explicit = completionContractFromSourceNote(task.sourceNote);
  if (explicit) return explicit;

  const text = combinedText([task.title, task.category, task.sourceType, task.sourceStepType, task.doneWhen, task.minimumOutcome, task.steps]);
  if (/rest|recover|walk|sleep|break|reset|regulate|health/.test(text)) return COMPLETION_CONTRACTS.recovery;
  if (task.sourceType === "contact" || /message|email|outreach|coffee|conversation|follow.?up|mentor|feedback|review|critique/.test(text)) return COMPLETION_CONTRACTS.conversation;
  if (/decide|choose|select|pick|triage|prioriti[sz]e|capture|save|shortlist/.test(text)) return COMPLETION_CONTRACTS.capture;
  if (task.category === "learning" || task.sourceType === "learn" || /read|learn|study|course|book|podcast|article|watch|listen/.test(text)) {
    if (/apply|case|framework|compare|practice|memo|brief|synthesis|write/.test(text)) return COMPLETION_CONTRACTS.application;
    if (/understand|explain|concept|primer|foundation|basics/.test(text)) return COMPLETION_CONTRACTS.comprehension;
    return COMPLETION_CONTRACTS.exposure;
  }
  if (["substack", "hustle", "afterline"].includes(task.category) || task.sourceType === "hustle" || /publish|artifact|proof|portfolio|memo|brief|draft|write|post|build|create/.test(text)) return COMPLETION_CONTRACTS.deliverable;
  if (/reflect|retro|lesson|takeaway|judgement log|decision log/.test(text)) return COMPLETION_CONTRACTS.reflection;
  if (/apply|practice|simulate|case|presentation|interview|rehearse|exercise/.test(text)) return COMPLETION_CONTRACTS.application;
  return COMPLETION_CONTRACTS.maintenance;
}

export function completionContractForSprintContributor(contributor: string): CompletionContract {
  if (contributor === "knowledge") return COMPLETION_CONTRACTS.comprehension;
  if (contributor === "network" || contributor === "feedback") return COMPLETION_CONTRACTS.conversation;
  if (contributor === "reflection") return COMPLETION_CONTRACTS.reflection;
  if (contributor === "evidence") return COMPLETION_CONTRACTS.deliverable;
  return COMPLETION_CONTRACTS.application;
}
