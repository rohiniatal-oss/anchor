import type { Task } from "@shared/schema";
import type { UserEvidenceItem, UserEvidenceSourceType } from "./trackResearchCoverageEvidence";
import type {
  ExecutionBlueprintModel,
  TaskBlueprint,
  TaskBlueprintKind,
} from "./trackResearchExecutionBlueprint";

export const EXECUTION_OUTCOME_MODEL_VERSION = 1;

export type ExecutionOutcomeState =
  | "pending_confirmation"
  | "accepted"
  | "no_evidence"
  | "reopened";

export type ExecutionOutcomeStrength = "verified" | "direct" | "supporting" | "none";
export type ExecutionOutcomeProcessingState = "not_ready" | "queued" | "processing" | "complete" | "failed";
export type ExecutionMilestoneState = "not_started" | "progressing" | "achieved";

export type ExecutionOutcomeOption = {
  id: "evidence_created" | "partial_signal" | "no_evidence" | "not_completed";
  label: string;
  description: string;
  strength: ExecutionOutcomeStrength;
  usableForCoverage: boolean;
  reopensTask: boolean;
};

export type ExecutionCoverageChange = {
  requirementId: string;
  requirementLabel: string;
  beforeStatus: string;
  afterStatus: string;
  improved: boolean;
  regressed: boolean;
};

export type ExecutionMilestoneChange = {
  milestoneId: string;
  milestoneLabel: string;
  requirementIds: string[];
  beforeState: ExecutionMilestoneState;
  afterState: ExecutionMilestoneState;
  achieved: boolean;
  regressed: boolean;
};

export type ExecutionOutcomeCoverageImpact = {
  changes: ExecutionCoverageChange[];
  milestoneChanges: ExecutionMilestoneChange[];
  improvedRequirementIds: string[];
  newlyProvenRequirementIds: string[];
  regressedRequirementIds: string[];
  unchangedRequirementIds: string[];
  newlyAchievedMilestoneIds: string[];
  developmentPlanChanged: boolean;
  executionBlueprintChanged: boolean;
  nextMaterializedTaskIds: number[];
  processedAt: number;
};

export type ExecutionOutcome = {
  id: string;
  trackId: number;
  liveTaskId: number;
  blueprintTaskId: string;
  blueprintFingerprint: string;
  completionSequence: number;
  taskTitle: string;
  taskKind: TaskBlueprintKind;
  owner: TaskBlueprint["owner"];
  requirementIds: string[];
  milestoneIds: string[];
  expectedEvidence: string;
  doneWhen: string;
  minimumOutcome: string;
  evidenceSummary: string;
  evidenceUrl: string;
  strength: ExecutionOutcomeStrength;
  usableForCoverage: boolean;
  state: ExecutionOutcomeState;
  confirmationRequired: boolean;
  confirmationQuestion: string;
  confirmationOptions: ExecutionOutcomeOption[];
  selectedOptionId: ExecutionOutcomeOption["id"] | "";
  confirmationNote: string;
  completedAt: number;
  confirmedAt: number | null;
  reopenedAt: number | null;
  processingState: ExecutionOutcomeProcessingState;
  processingError: string;
  coverageImpact: ExecutionOutcomeCoverageImpact | null;
  createdAt: number;
  updatedAt: number;
};

export type ExecutionOutcomeModel = {
  mode: "execution_outcome_model";
  version: number;
  trackId: number;
  currentBlueprintFingerprint: string;
  outcomes: ExecutionOutcome[];
  pendingOutcomeIds: string[];
  queuedOutcomeIds: string[];
  generatedAt: number;
};

export type ConfirmExecutionOutcomeInput = {
  optionId: ExecutionOutcomeOption["id"];
  note?: string;
  evidenceUrl?: string;
};

type ParsedTaskStep = {
  text: string;
  done: boolean;
  condition: string;
  executor: string;
};

function compact(value: unknown, max = 2_000): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function safeUrl(value: unknown): string {
  const text = compact(value, 1_000);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = compact(raw, 500);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseSteps(value: unknown): ParsedTaskStep[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((step) => step && typeof step === "object" && compact(step.text))
      .map((step) => ({
        text: compact(step.text, 500),
        done: Boolean(step.done),
        condition: compact(step.condition, 80),
        executor: compact(step.executor, 80),
      }));
  } catch {
    return [];
  }
}

function requiredStepsCompleted(task: Task): boolean {
  const required = parseSteps(task.steps).filter((step) => step.condition !== "if_needed");
  return required.length > 0 && required.every((step) => step.done);
}

function evidenceSummary(task: Task, blueprintTask: TaskBlueprint): string {
  const steps = parseSteps(task.steps);
  const completedSteps = steps.filter((step) => step.done).map((step) => step.text).slice(0, 5);
  return compact([
    `Completed execution task: ${task.title}.`,
    completedSteps.length ? `Completed steps: ${completedSteps.join("; ")}.` : "",
    Number(task.actualMinutes || 0) > 0 ? `Recorded execution time: ${task.actualMinutes} minutes.` : "",
    `Expected evidence: ${blueprintTask.expectedEvidence}.`,
    safeUrl(task.sourceUrl) ? `Evidence link: ${safeUrl(task.sourceUrl)}.` : "",
  ].filter(Boolean).join(" "), 4_000);
}

function questionForKind(kind: TaskBlueprintKind, expectedEvidence: string): string {
  if (kind === "relationship") return "What concrete insight, introduction, referral or relationship change came from this action?";
  if (kind === "access") return "What application, introduction, interview or other access signal did this action create?";
  if (kind === "experience") return "What responsibility, decision or observable outcome did this applied work produce?";
  if (kind === "credential") return "Was the formal evidence completed, or did this only move it forward?";
  if (kind === "artifact") return `Does the completed artifact now exist in an inspectable form${expectedEvidence ? ` as ${expectedEvidence}` : ""}?`;
  if (kind === "practice") return "What work sample or assessed result did this practice produce?";
  if (kind === "learning") return "What applied output or explanation shows what you can now do?";
  return "What concrete output or signal did completing this task create?";
}

function optionsForKind(kind: TaskBlueprintKind): ExecutionOutcomeOption[] {
  const evidenceLabel = kind === "relationship"
    ? "A useful insight, introduction, referral or stronger relationship was created"
    : kind === "access"
      ? "An application, introduction, interview or other access signal was created"
      : kind === "credential"
        ? "The credential or accepted formal evidence was completed"
        : kind === "artifact"
          ? "The artifact exists and is ready to inspect"
          : kind === "experience"
            ? "The work produced a responsibility or outcome I can describe"
            : "The work produced a concrete output I can describe";
  const partialLabel = kind === "credential"
    ? "I made progress, but the formal evidence is not complete"
    : kind === "artifact"
      ? "A draft exists, but it is not yet ready to use as evidence"
      : "The task was completed and produced a limited signal";
  return [
    {
      id: "evidence_created",
      label: evidenceLabel,
      description: "Anchor will use the confirmed outcome as direct evidence and reassess the linked requirements.",
      strength: kind === "credential" ? "verified" : "direct",
      usableForCoverage: true,
      reopensTask: false,
    },
    {
      id: "partial_signal",
      label: partialLabel,
      description: "Anchor will retain this as supporting evidence without treating the requirement as fully proven.",
      strength: "supporting",
      usableForCoverage: true,
      reopensTask: false,
    },
    {
      id: "no_evidence",
      label: "The task was completed, but it did not create useful evidence",
      description: "The completion remains recorded, but it will not strengthen requirement coverage.",
      strength: "none",
      usableForCoverage: false,
      reopensTask: false,
    },
    {
      id: "not_completed",
      label: "This was marked complete by mistake",
      description: "Anchor will reopen the task and remove this outcome from coverage.",
      strength: "none",
      usableForCoverage: false,
      reopensTask: true,
    },
  ];
}

function needsConfirmation(task: Task, blueprintTask: TaskBlueprint): boolean {
  if (["relationship", "access", "experience", "credential"].includes(blueprintTask.kind)) return true;
  if (blueprintTask.kind === "artifact" && !safeUrl(task.sourceUrl)) return true;
  if (safeUrl(task.sourceUrl)) return false;
  return !requiredStepsCompleted(task);
}

export function emptyExecutionOutcomeModel(
  trackId: number,
  currentBlueprintFingerprint = "",
): ExecutionOutcomeModel {
  return {
    mode: "execution_outcome_model",
    version: EXECUTION_OUTCOME_MODEL_VERSION,
    trackId,
    currentBlueprintFingerprint,
    outcomes: [],
    pendingOutcomeIds: [],
    queuedOutcomeIds: [],
    generatedAt: Date.now(),
  };
}

function validOutcome(value: any, trackId: number): value is ExecutionOutcome {
  return value
    && typeof value === "object"
    && Number(value.trackId) === trackId
    && Number.isFinite(Number(value.liveTaskId))
    && typeof value.id === "string"
    && typeof value.blueprintTaskId === "string";
}

export function normalizeExecutionOutcomeModel(
  value: unknown,
  trackId: number,
  currentBlueprintFingerprint = "",
): ExecutionOutcomeModel {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
  const outcomes = Array.isArray(raw.outcomes)
    ? raw.outcomes.filter((outcome) => validOutcome(outcome, trackId)).slice(0, 120)
    : [];
  const pendingOutcomeIds = outcomes
    .filter((outcome) => outcome.state === "pending_confirmation")
    .map((outcome) => outcome.id);
  const queuedOutcomeIds = outcomes
    .filter((outcome) => outcome.processingState === "queued" || outcome.processingState === "processing")
    .map((outcome) => outcome.id);
  return {
    mode: "execution_outcome_model",
    version: EXECUTION_OUTCOME_MODEL_VERSION,
    trackId,
    currentBlueprintFingerprint,
    outcomes,
    pendingOutcomeIds,
    queuedOutcomeIds,
    generatedAt: Date.now(),
  };
}

export function buildExecutionOutcome(
  task: Task,
  blueprintTask: TaskBlueprint,
  blueprint: ExecutionBlueprintModel,
  previous?: ExecutionOutcome | null,
  completedAt = Date.now(),
): ExecutionOutcome {
  const confirmationRequired = needsConfirmation(task, blueprintTask);
  const evidenceUrl = safeUrl(task.sourceUrl);
  const completionSequence = Math.max(1, Number(previous?.completionSequence || 0) + 1);
  const state: ExecutionOutcomeState = confirmationRequired ? "pending_confirmation" : "accepted";
  const id = `execution-outcome-${stableHash(`${task.relatedTrackId || task.sourceId}|${task.id}|${blueprintTask.id}|${completionSequence}`)}`;
  return {
    id,
    trackId: Number(task.relatedTrackId || task.sourceId),
    liveTaskId: task.id,
    blueprintTaskId: blueprintTask.id,
    blueprintFingerprint: blueprint.sourceFingerprint,
    completionSequence,
    taskTitle: compact(task.title, 300),
    taskKind: blueprintTask.kind,
    owner: blueprintTask.owner,
    requirementIds: uniqueStrings(blueprintTask.requirementIds),
    milestoneIds: uniqueStrings(blueprintTask.milestoneIds),
    expectedEvidence: compact(blueprintTask.expectedEvidence, 1_500),
    doneWhen: compact(blueprintTask.doneWhen, 1_500),
    minimumOutcome: compact(blueprintTask.minimumOutcome, 1_500),
    evidenceSummary: evidenceSummary(task, blueprintTask),
    evidenceUrl,
    strength: state === "accepted" ? (evidenceUrl ? "verified" : "supporting") : "none",
    usableForCoverage: state === "accepted",
    state,
    confirmationRequired,
    confirmationQuestion: confirmationRequired ? questionForKind(blueprintTask.kind, blueprintTask.expectedEvidence) : "",
    confirmationOptions: confirmationRequired ? optionsForKind(blueprintTask.kind) : [],
    selectedOptionId: "",
    confirmationNote: "",
    completedAt,
    confirmedAt: state === "accepted" ? completedAt : null,
    reopenedAt: null,
    processingState: state === "accepted" ? "queued" : "not_ready",
    processingError: "",
    coverageImpact: null,
    createdAt: completedAt,
    updatedAt: completedAt,
  };
}

export function confirmExecutionOutcome(
  outcome: ExecutionOutcome,
  input: ConfirmExecutionOutcomeInput,
  now = Date.now(),
): ExecutionOutcome {
  if (outcome.state !== "pending_confirmation") return outcome;
  const option = outcome.confirmationOptions.find((candidate) => candidate.id === input.optionId);
  if (!option) throw new Error("Invalid execution outcome option");
  const evidenceUrl = safeUrl(input.evidenceUrl) || outcome.evidenceUrl;
  const note = compact(input.note, 2_000);
  if (option.reopensTask) {
    return {
      ...outcome,
      state: "reopened",
      selectedOptionId: option.id,
      confirmationNote: note,
      evidenceUrl,
      strength: "none",
      usableForCoverage: false,
      confirmedAt: now,
      reopenedAt: now,
      processingState: "queued",
      processingError: "",
      coverageImpact: null,
      updatedAt: now,
    };
  }
  const accepted = option.usableForCoverage;
  return {
    ...outcome,
    state: accepted ? "accepted" : "no_evidence",
    selectedOptionId: option.id,
    confirmationNote: note,
    evidenceUrl,
    evidenceSummary: compact(`${outcome.evidenceSummary}${note ? ` Confirmed outcome: ${note}.` : ""}`, 4_000),
    strength: accepted && evidenceUrl ? "verified" : option.strength,
    usableForCoverage: accepted,
    confirmedAt: now,
    processingState: "queued",
    processingError: "",
    coverageImpact: null,
    updatedAt: now,
  };
}

function evidenceSourceType(kind: TaskBlueprintKind): UserEvidenceSourceType {
  if (kind === "artifact" || kind === "validation") return "proof_asset";
  if (kind === "relationship") return "relationship";
  if (kind === "access") return "interaction";
  if (["learning", "practice", "research", "verification", "credential"].includes(kind)) return "learning_output";
  return "win";
}

export function executionOutcomeEvidenceItem(outcome: ExecutionOutcome): UserEvidenceItem | null {
  if (outcome.state !== "accepted" || !outcome.usableForCoverage || outcome.strength === "none") return null;
  const sourceType = evidenceSourceType(outcome.taskKind);
  return {
    id: `user-evidence-${outcome.id}`,
    sourceType,
    label: outcome.taskTitle || "Completed execution outcome",
    detail: compact([
      outcome.evidenceSummary,
      outcome.expectedEvidence ? `Expected evidence standard: ${outcome.expectedEvidence}.` : "",
      outcome.confirmationNote ? `User confirmation: ${outcome.confirmationNote}.` : "",
    ].filter(Boolean).join(" "), 5_000),
    sourceUrl: safeUrl(outcome.evidenceUrl),
    strength: outcome.strength === "verified"
      ? "verified"
      : outcome.strength === "direct"
        ? "direct"
        : "supporting",
    state: outcome.evidenceUrl ? "published" : "completed",
    usableForCoverage: true,
    sourceEntityType: "execution_outcome",
    sourceEntityId: outcome.liveTaskId,
    trackIds: [outcome.trackId],
    observedAt: outcome.confirmedAt || outcome.completedAt,
  };
}

export function executionOutcomeEvidenceItems(model: ExecutionOutcomeModel): UserEvidenceItem[] {
  const latestByTask = new Map<number, ExecutionOutcome>();
  for (const outcome of model.outcomes) {
    const current = latestByTask.get(outcome.liveTaskId);
    if (!current
      || outcome.completionSequence > current.completionSequence
      || (outcome.completionSequence === current.completionSequence && outcome.updatedAt > current.updatedAt)) {
      latestByTask.set(outcome.liveTaskId, outcome);
    }
  }
  return [...latestByTask.values()]
    .map(executionOutcomeEvidenceItem)
    .filter((item): item is UserEvidenceItem => Boolean(item));
}

export function executionOutcomeModelFingerprint(model: ExecutionOutcomeModel): string {
  const value = model.outcomes
    .map((outcome) => [
      outcome.id,
      outcome.blueprintTaskId,
      outcome.completionSequence,
      outcome.state,
      outcome.strength,
      outcome.usableForCoverage ? 1 : 0,
      outcome.evidenceSummary,
      outcome.evidenceUrl,
      outcome.confirmedAt || "",
      outcome.reopenedAt || "",
    ].join("|"))
    .sort()
    .join("||");
  return stableHash(value || `empty:${model.trackId}`);
}

export const executionOutcomeInternals = {
  evidenceSourceType,
  needsConfirmation,
  optionsForKind,
  parseSteps,
  requiredStepsCompleted,
  safeUrl,
};
