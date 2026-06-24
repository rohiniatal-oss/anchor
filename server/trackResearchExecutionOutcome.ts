import type { Task } from "@shared/schema";
import type { CoverageStatus } from "./trackResearchCoverageModel";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import type {
  ExecutionBlueprintModel,
  TaskBlueprint,
  TaskBlueprintKind,
} from "./trackResearchExecutionBlueprint";
import type { RequirementModel } from "./trackResearchRequirementModel";

export const EXECUTION_OUTCOME_MODEL_VERSION = 1;
export const EXECUTION_FEEDBACK_MODEL_VERSION = 1;

export type ExecutionOutcomeStatus =
  | "pending_confirmation"
  | "accepted"
  | "rejected"
  | "superseded"
  | "failed";
export type ExecutionOutcomeStrength = "verified" | "direct" | "supporting" | "planned";
export type ExecutionOutcomeEvidenceType =
  | "knowledge"
  | "skill"
  | "experience"
  | "proof"
  | "relationship"
  | "access"
  | "credential"
  | "eligibility"
  | "narrative"
  | "verification"
  | "other";

export type ExecutionOutcomeRecord = {
  id: string;
  trackId: number;
  blueprintFingerprint: string;
  blueprintTaskId: string;
  liveTaskId: number;
  workstreamId: string;
  moduleId: string;
  milestoneIds: string[];
  requirementIds: string[];
  taskTitle: string;
  taskKind: TaskBlueprintKind;
  expectedEvidence: string;
  status: ExecutionOutcomeStatus;
  evidenceType: ExecutionOutcomeEvidenceType;
  summary: string;
  detail: string;
  sourceUrl: string;
  strength: ExecutionOutcomeStrength;
  usableForCoverage: boolean;
  confirmationRequired: boolean;
  confirmationQuestion: string;
  confirmationAnswer: string;
  createdAt: number;
  updatedAt: number;
  acceptedAt: number | null;
};

export type CoverageDeltaItem = {
  requirementId: string;
  label: string;
  beforeStatus: CoverageStatus;
  afterStatus: CoverageStatus;
  changed: boolean;
  improved: boolean;
  evidenceAddedIds: string[];
};

export type ExecutionFeedbackRun = {
  id: string;
  outcomeId: string;
  affectedRequirementIds: string[];
  coverageChanges: CoverageDeltaItem[];
  changedRequirementCount: number;
  improvedRequirementCount: number;
  developmentPlanChanged: boolean;
  executionBlueprintChanged: boolean;
  executionPriorityChanged: boolean;
  materializedLiveTaskIds: number[];
  warnings: string[];
  generatedAt: number;
};

export type ExecutionMilestoneProgress = {
  milestoneId: string;
  label: string;
  requirementIds: string[];
  status: "achieved" | "progressing" | "not_started" | "needs_confirmation";
  provenRequirementCount: number;
  partiallyProvenRequirementCount: number;
  totalRequirementCount: number;
};

export type ExecutionFeedbackModel = {
  mode: "execution_feedback_model";
  version: number;
  trackId: number;
  blueprintFingerprint: string;
  outcomes: ExecutionOutcomeRecord[];
  runs: ExecutionFeedbackRun[];
  milestones: ExecutionMilestoneProgress[];
  pendingConfirmationCount: number;
  latestOutcomeAt: number | null;
  generatedAt: number;
};

function compact(value: unknown, max = 4000): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalize(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}-${stableHash(parts.map(normalize).filter(Boolean).join("|") || prefix)}`;
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => compact(item, 900)).filter(Boolean)) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function safeUrl(value: unknown): string {
  const raw = compact(value, 900);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function evidenceTypeFor(task: TaskBlueprint): ExecutionOutcomeEvidenceType {
  if (task.kind === "learning") return "knowledge";
  if (task.kind === "practice") return "skill";
  if (task.kind === "experience") return "experience";
  if (task.kind === "artifact" || task.kind === "validation") return "proof";
  if (task.kind === "relationship") return "relationship";
  if (task.kind === "access") return "access";
  if (task.kind === "credential") return "credential";
  if (task.kind === "verification" || task.kind === "research") return "verification";
  return "other";
}

function externalConfirmationRequired(task: TaskBlueprint): boolean {
  if (["experience", "relationship", "access", "credential"].includes(task.kind)) return true;
  return task.subtasks.some((subtask) => subtask.executor === "user_action" && subtask.condition === "always");
}

function confirmationQuestion(task: TaskBlueprint): string {
  if (task.kind === "experience") {
    return "What responsibility did you carry out, what was your contribution, and what result or feedback followed?";
  }
  if (task.kind === "relationship") {
    return "What interaction happened, and did it produce a useful insight, introduction, referral, or agreed follow-up?";
  }
  if (task.kind === "access") {
    return "What external route action happened, and what response or access signal did it produce?";
  }
  if (task.kind === "credential") {
    return "What formal step was completed, and what document, result, or status confirms it?";
  }
  return `What concrete output or result confirms that “${task.title}” was completed?`;
}

function initialStrength(task: TaskBlueprint, sourceUrl: string, requiresConfirmation: boolean): ExecutionOutcomeStrength {
  if (requiresConfirmation) return "planned";
  if (sourceUrl && ["artifact", "validation", "credential"].includes(task.kind)) return "verified";
  return "supporting";
}

function initialSummary(task: TaskBlueprint): string {
  if (task.kind === "verification") return `Completed evidence verification for ${task.moduleTitle}.`;
  if (task.kind === "research") return `Completed a focused research output for ${task.moduleTitle}.`;
  if (task.kind === "learning") return `Completed applied learning for ${task.moduleTitle}.`;
  if (task.kind === "practice") return `Completed a practice cycle for ${task.moduleTitle}.`;
  if (task.kind === "artifact" || task.kind === "validation") return `Completed an evidence-producing output for ${task.moduleTitle}.`;
  if (task.kind === "experience") return `Reported completion of an applied experience for ${task.moduleTitle}.`;
  if (task.kind === "relationship") return `Reported completion of a relationship-building action for ${task.moduleTitle}.`;
  if (task.kind === "access") return `Reported completion of a market-access action for ${task.moduleTitle}.`;
  if (task.kind === "credential") return `Reported completion of a formal requirement step for ${task.moduleTitle}.`;
  return `Completed ${task.title}.`;
}

function initialDetail(
  task: Task,
  blueprintTask: TaskBlueprint,
  requirementModel: RequirementModel,
): string {
  const requirementLabels = blueprintTask.requirementIds
    .map((id) => requirementModel.requirements.find((requirement) => requirement.id === id)?.label)
    .filter(Boolean);
  return compact([
    `Completed task: ${blueprintTask.title}.`,
    blueprintTask.expectedEvidence ? `Expected evidence: ${blueprintTask.expectedEvidence}.` : "",
    blueprintTask.doneWhen ? `Completion standard: ${blueprintTask.doneWhen}.` : "",
    requirementLabels.length ? `Requirements served: ${requirementLabels.join(", ")}.` : "",
    task.sourceNote ? `Execution context: ${task.sourceNote}.` : "",
  ].filter(Boolean).join(" "), 6000);
}

export function buildExecutionOutcomeCandidate(input: {
  trackId: number;
  task: Task;
  blueprintTask: TaskBlueprint;
  blueprint: ExecutionBlueprintModel;
  requirementModel: RequirementModel;
}): ExecutionOutcomeRecord {
  const now = Date.now();
  const sourceUrl = safeUrl(input.task.sourceUrl);
  const confirmationRequired = externalConfirmationRequired(input.blueprintTask) && !sourceUrl;
  const status: ExecutionOutcomeStatus = confirmationRequired ? "pending_confirmation" : "accepted";
  return {
    id: stableId("execution-outcome", input.trackId, input.blueprintTask.id, input.task.id),
    trackId: input.trackId,
    blueprintFingerprint: input.blueprint.sourceFingerprint,
    blueprintTaskId: input.blueprintTask.id,
    liveTaskId: input.task.id,
    workstreamId: input.blueprintTask.workstreamId,
    moduleId: input.blueprintTask.moduleId,
    milestoneIds: uniqueStrings(input.blueprintTask.milestoneIds),
    requirementIds: uniqueStrings(input.blueprintTask.requirementIds),
    taskTitle: input.blueprintTask.title,
    taskKind: input.blueprintTask.kind,
    expectedEvidence: input.blueprintTask.expectedEvidence,
    status,
    evidenceType: evidenceTypeFor(input.blueprintTask),
    summary: initialSummary(input.blueprintTask),
    detail: initialDetail(input.task, input.blueprintTask, input.requirementModel),
    sourceUrl,
    strength: initialStrength(input.blueprintTask, sourceUrl, confirmationRequired),
    usableForCoverage: status === "accepted",
    confirmationRequired,
    confirmationQuestion: confirmationRequired ? confirmationQuestion(input.blueprintTask) : "",
    confirmationAnswer: "",
    createdAt: now,
    updatedAt: now,
    acceptedAt: status === "accepted" ? now : null,
  };
}

export function parseExecutionFeedbackModel(
  value: unknown,
  trackId: number,
  blueprintFingerprint = "",
): ExecutionFeedbackModel {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ExecutionFeedbackModel>
    : null;
  if (
    candidate?.mode === "execution_feedback_model"
    && candidate.version === EXECUTION_FEEDBACK_MODEL_VERSION
    && candidate.trackId === trackId
    && Array.isArray(candidate.outcomes)
    && Array.isArray(candidate.runs)
  ) {
    const outcomes = candidate.outcomes.filter((outcome) => outcome && outcome.trackId === trackId).slice(-80);
    return {
      mode: "execution_feedback_model",
      version: EXECUTION_FEEDBACK_MODEL_VERSION,
      trackId,
      blueprintFingerprint: compact(candidate.blueprintFingerprint || blueprintFingerprint, 300),
      outcomes,
      runs: (candidate.runs || []).slice(-24),
      milestones: Array.isArray(candidate.milestones) ? candidate.milestones : [],
      pendingConfirmationCount: outcomes.filter((outcome) => outcome.status === "pending_confirmation").length,
      latestOutcomeAt: outcomes.length ? Math.max(...outcomes.map((outcome) => Number(outcome.updatedAt || 0))) : null,
      generatedAt: Number(candidate.generatedAt || Date.now()),
    };
  }
  return {
    mode: "execution_feedback_model",
    version: EXECUTION_FEEDBACK_MODEL_VERSION,
    trackId,
    blueprintFingerprint,
    outcomes: [],
    runs: [],
    milestones: [],
    pendingConfirmationCount: 0,
    latestOutcomeAt: null,
    generatedAt: Date.now(),
  };
}

export function upsertExecutionOutcome(
  model: ExecutionFeedbackModel,
  outcome: ExecutionOutcomeRecord,
): ExecutionFeedbackModel {
  const outcomes = model.outcomes.filter((item) => item.id !== outcome.id && item.liveTaskId !== outcome.liveTaskId);
  outcomes.push(outcome);
  outcomes.sort((left, right) => left.createdAt - right.createdAt);
  return {
    ...model,
    blueprintFingerprint: outcome.blueprintFingerprint || model.blueprintFingerprint,
    outcomes: outcomes.slice(-80),
    pendingConfirmationCount: outcomes.filter((item) => item.status === "pending_confirmation").length,
    latestOutcomeAt: outcome.updatedAt,
    generatedAt: Date.now(),
  };
}

export function acceptedOutcomeStrength(
  outcome: ExecutionOutcomeRecord,
  confirmationAnswer: string,
  sourceUrl: string,
): ExecutionOutcomeStrength {
  if (sourceUrl && ["proof", "credential"].includes(outcome.evidenceType)) return "verified";
  if (["experience", "relationship", "access", "credential", "eligibility"].includes(outcome.evidenceType)) return "direct";
  if (confirmationAnswer) return "supporting";
  return outcome.strength === "planned" ? "supporting" : outcome.strength;
}

export function milestoneProgress(
  developmentPlan: DevelopmentPlanModel,
  coverageStatuses: Map<string, CoverageStatus>,
  outcomes: ExecutionOutcomeRecord[],
): ExecutionMilestoneProgress[] {
  const pendingRequirementIds = new Set(
    outcomes
      .filter((outcome) => outcome.status === "pending_confirmation")
      .flatMap((outcome) => outcome.requirementIds),
  );
  return developmentPlan.workstreams.flatMap((workstream) => workstream.milestones.map((milestone) => {
    const statuses = milestone.requirementIds.map((id) => coverageStatuses.get(id) || "unknown");
    const provenRequirementCount = statuses.filter((status) => status === "proven").length;
    const partiallyProvenRequirementCount = statuses.filter((status) => status === "partially_proven").length;
    const hasPending = milestone.requirementIds.some((id) => pendingRequirementIds.has(id));
    const status: ExecutionMilestoneProgress["status"] = milestone.requirementIds.length > 0 && provenRequirementCount === milestone.requirementIds.length
      ? "achieved"
      : hasPending
        ? "needs_confirmation"
        : provenRequirementCount > 0 || partiallyProvenRequirementCount > 0
          ? "progressing"
          : "not_started";
    return {
      milestoneId: milestone.id,
      label: milestone.label,
      requirementIds: milestone.requirementIds,
      status,
      provenRequirementCount,
      partiallyProvenRequirementCount,
      totalRequirementCount: milestone.requirementIds.length,
    };
  }));
}

export const executionOutcomeInternals = {
  compact,
  evidenceTypeFor,
  externalConfirmationRequired,
  confirmationQuestion,
  safeUrl,
  stableId,
};
