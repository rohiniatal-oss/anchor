import { createHash } from "node:crypto";
import type { Task } from "@shared/schema";
import type { CoverageStatus } from "./trackResearchCoverageModel";
import type {
  BlueprintOwner,
  ExecutionBlueprintModel,
  TaskBlueprint,
  TaskBlueprintKind,
} from "./trackResearchExecutionBlueprint";
import type { UserEvidenceStrength } from "./trackResearchCoverageEvidence";

export const EXECUTION_OUTCOME_MODEL_VERSION = 1;

export type ExecutionOutcomeStatus =
  | "accepted"
  | "pending_confirmation"
  | "operational_only"
  | "insufficient"
  | "reopened";

export type ExecutionOutcomeConfirmationKind = "text" | "url_or_text" | "signal";

export type ExecutionOutcomeConfirmation = {
  required: boolean;
  kind: ExecutionOutcomeConfirmationKind;
  question: string;
  options: string[];
  answer: string;
  answeredAt: number | null;
};

export type ExecutionOutcomeRecord = {
  id: string;
  trackId: number;
  blueprintFingerprint: string;
  blueprintTaskId: string;
  liveTaskId: number;
  workstreamId: string;
  moduleId: string;
  requirementIds: string[];
  milestoneIds: string[];
  taskKind: TaskBlueprintKind;
  taskOwner: BlueprintOwner;
  status: ExecutionOutcomeStatus;
  usableForCoverage: boolean;
  strength: UserEvidenceStrength;
  label: string;
  detail: string;
  sourceUrl: string;
  expectedEvidence: string;
  completionStandard: string;
  completedSubtaskIds: string[];
  inference: {
    confidence: "high" | "medium" | "low";
    basis: "task_state" | "inspectable_output" | "user_confirmation";
    reason: string;
  };
  confirmation: ExecutionOutcomeConfirmation;
  createdAt: number;
  updatedAt: number;
};

export type ExecutionCoverageDelta = {
  requirementId: string;
  label: string;
  beforeStatus: CoverageStatus;
  afterStatus: CoverageStatus;
  beforeConfidence: "high" | "medium" | "low";
  afterConfidence: "high" | "medium" | "low";
  changed: boolean;
  explanation: string;
};

export type ExecutionMilestoneProgress = {
  milestoneId: string;
  workstreamId: string;
  label: string;
  requirementIds: string[];
  status: "not_started" | "in_progress" | "pending_confirmation" | "achieved";
  provenRequirementCount: number;
  totalRequirementCount: number;
  outcomeIds: string[];
  doneWhen: string;
  reason: string;
  updatedAt: number;
};

export type ExecutionOutcomeModel = {
  mode: "execution_outcome_model";
  version: number;
  trackId: number;
  records: ExecutionOutcomeRecord[];
  milestoneProgress: ExecutionMilestoneProgress[];
  latestCoverageDelta: ExecutionCoverageDelta[];
  latestOutcomeId: string | null;
  pendingConfirmationIds: string[];
  generatedAt: number;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function safeExternalUrl(value: unknown): string {
  const raw = compact(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function parsedSteps(task: Task): Array<Record<string, any>> {
  try {
    const value = JSON.parse(task.steps || "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function completedSubtaskIds(task: Task, blueprintTask: TaskBlueprint): string[] {
  const completed = new Set(
    parsedSteps(task)
      .filter((step) => Boolean(step.done))
      .map((step) => compact(step.blueprintSubtaskId))
      .filter(Boolean),
  );
  return blueprintTask.subtasks
    .filter((subtask) => completed.has(subtask.id))
    .map((subtask) => subtask.id);
}

function allAlwaysSubtasksComplete(task: Task, blueprintTask: TaskBlueprint): boolean {
  const required = blueprintTask.subtasks
    .filter((subtask) => subtask.condition === "always")
    .map((subtask) => subtask.id);
  if (!required.length) return Boolean(task.done || task.status === "done");
  const completed = new Set(completedSubtaskIds(task, blueprintTask));
  return required.every((id) => completed.has(id));
}

function confirmationFor(kind: TaskBlueprintKind, title: string): ExecutionOutcomeConfirmation {
  if (kind === "artifact" || kind === "validation") {
    return {
      required: true,
      kind: "url_or_text",
      question: `Where is the finished output for “${title}”, or what concrete output was completed?`,
      options: [],
      answer: "",
      answeredAt: null,
    };
  }
  if (kind === "experience") {
    return {
      required: true,
      kind: "text",
      question: `What responsibility, deliverable or observable result did you complete for “${title}”?`,
      options: [],
      answer: "",
      answeredAt: null,
    };
  }
  if (kind === "relationship") {
    return {
      required: true,
      kind: "signal",
      question: `What real interaction resulted from “${title}”?`,
      options: ["Substantive conversation", "Reply or useful exchange", "Introduction or referral", "No external interaction yet"],
      answer: "",
      answeredAt: null,
    };
  }
  if (kind === "access") {
    return {
      required: true,
      kind: "signal",
      question: `What access signal resulted from “${title}”?`,
      options: ["Application or process entered", "Warm introduction", "Referral or interview", "No market signal yet"],
      answer: "",
      answeredAt: null,
    };
  }
  if (kind === "credential") {
    return {
      required: true,
      kind: "url_or_text",
      question: `What verified credential, eligibility decision or formal evidence resulted from “${title}”?`,
      options: [],
      answer: "",
      answeredAt: null,
    };
  }
  return {
    required: false,
    kind: "text",
    question: "",
    options: [],
    answer: "",
    answeredAt: null,
  };
}

function automaticOutcomePolicy(
  task: Task,
  blueprintTask: TaskBlueprint,
): Pick<ExecutionOutcomeRecord, "status" | "usableForCoverage" | "strength" | "label" | "detail" | "sourceUrl" | "inference" | "confirmation"> {
  const sourceUrl = safeExternalUrl(task.sourceUrl);
  const complete = allAlwaysSubtasksComplete(task, blueprintTask);
  const expectedEvidence = compact(blueprintTask.expectedEvidence || task.stretchOutcome);
  const baseDetail = compact([
    `Completed execution task: ${task.title}.`,
    expectedEvidence ? `Expected evidence: ${expectedEvidence}.` : "",
    blueprintTask.doneWhen ? `Completion standard: ${blueprintTask.doneWhen}.` : "",
  ].filter(Boolean).join(" "));

  if (blueprintTask.kind === "research" || blueprintTask.kind === "verification") {
    return {
      status: "operational_only",
      usableForCoverage: false,
      strength: "supporting",
      label: task.title,
      detail: baseDetail,
      sourceUrl,
      inference: {
        confidence: "high",
        basis: "task_state",
        reason: "This task advances the plan or resolves uncertainty but does not by itself prove user capability.",
      },
      confirmation: confirmationFor(blueprintTask.kind, task.title),
    };
  }

  if ((blueprintTask.kind === "learning" || blueprintTask.kind === "practice") && complete) {
    return {
      status: "accepted",
      usableForCoverage: true,
      strength: sourceUrl ? "verified" : "supporting",
      label: expectedEvidence || task.title,
      detail: baseDetail,
      sourceUrl,
      inference: {
        confidence: sourceUrl ? "high" : "medium",
        basis: sourceUrl ? "inspectable_output" : "task_state",
        reason: sourceUrl
          ? "The completed task links to inspectable evidence."
          : "Completion supports applied learning or practice, but does not automatically prove the full target success bar.",
      },
      confirmation: confirmationFor(blueprintTask.kind, task.title),
    };
  }

  if (sourceUrl && ["artifact", "validation", "experience", "credential"].includes(blueprintTask.kind)) {
    return {
      status: "accepted",
      usableForCoverage: true,
      strength: "verified",
      label: expectedEvidence || task.title,
      detail: baseDetail,
      sourceUrl,
      inference: {
        confidence: "high",
        basis: "inspectable_output",
        reason: "The completed task includes a retrievable evidence URL.",
      },
      confirmation: confirmationFor(blueprintTask.kind, task.title),
    };
  }

  return {
    status: "pending_confirmation",
    usableForCoverage: false,
    strength: "planned",
    label: expectedEvidence || task.title,
    detail: baseDetail,
    sourceUrl,
    inference: {
      confidence: "low",
      basis: "task_state",
      reason: "Task completion alone does not establish the real-world output or signal required by this evidence type.",
    },
    confirmation: confirmationFor(blueprintTask.kind, task.title),
  };
}

export function executionOutcomeId(trackId: number, blueprintTaskId: string, liveTaskId: number): string {
  return `execution-outcome-${hash({ trackId, blueprintTaskId, liveTaskId }).slice(0, 18)}`;
}

export function buildExecutionOutcomeRecord(input: {
  trackId: number;
  task: Task;
  blueprint: ExecutionBlueprintModel;
  blueprintTask: TaskBlueprint;
  existing?: ExecutionOutcomeRecord | null;
}): ExecutionOutcomeRecord {
  const now = Date.now();
  const policy = automaticOutcomePolicy(input.task, input.blueprintTask);
  return {
    id: input.existing?.id || executionOutcomeId(input.trackId, input.blueprintTask.id, input.task.id),
    trackId: input.trackId,
    blueprintFingerprint: input.blueprint.sourceFingerprint,
    blueprintTaskId: input.blueprintTask.id,
    liveTaskId: input.task.id,
    workstreamId: input.blueprintTask.workstreamId,
    moduleId: input.blueprintTask.moduleId,
    requirementIds: [...input.blueprintTask.requirementIds],
    milestoneIds: [...input.blueprintTask.milestoneIds],
    taskKind: input.blueprintTask.kind,
    taskOwner: input.blueprintTask.owner,
    ...policy,
    expectedEvidence: compact(input.blueprintTask.expectedEvidence),
    completionStandard: compact(input.blueprintTask.doneWhen),
    completedSubtaskIds: completedSubtaskIds(input.task, input.blueprintTask),
    createdAt: input.existing?.createdAt || now,
    updatedAt: now,
  };
}

export function emptyExecutionOutcomeModel(trackId: number): ExecutionOutcomeModel {
  return {
    mode: "execution_outcome_model",
    version: EXECUTION_OUTCOME_MODEL_VERSION,
    trackId,
    records: [],
    milestoneProgress: [],
    latestCoverageDelta: [],
    latestOutcomeId: null,
    pendingConfirmationIds: [],
    generatedAt: Date.now(),
  };
}

export function normalizeExecutionOutcomeModel(trackId: number, value: unknown): ExecutionOutcomeModel {
  const model = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ExecutionOutcomeModel>
    : {};
  const records = Array.isArray(model.records)
    ? model.records.filter((record): record is ExecutionOutcomeRecord => Boolean(record?.id && record.trackId === trackId))
    : [];
  return {
    ...emptyExecutionOutcomeModel(trackId),
    ...model,
    mode: "execution_outcome_model",
    version: EXECUTION_OUTCOME_MODEL_VERSION,
    trackId,
    records,
    milestoneProgress: Array.isArray(model.milestoneProgress) ? model.milestoneProgress : [],
    latestCoverageDelta: Array.isArray(model.latestCoverageDelta) ? model.latestCoverageDelta : [],
    latestOutcomeId: compact(model.latestOutcomeId) || null,
    pendingConfirmationIds: records.filter((record) => record.status === "pending_confirmation").map((record) => record.id),
    generatedAt: Number(model.generatedAt || Date.now()),
  };
}

export function upsertExecutionOutcome(
  model: ExecutionOutcomeModel,
  record: ExecutionOutcomeRecord,
): ExecutionOutcomeModel {
  const records = model.records.filter((item) => item.id !== record.id && item.liveTaskId !== record.liveTaskId);
  records.push(record);
  records.sort((left, right) => right.updatedAt - left.updatedAt);
  return {
    ...model,
    records: records.slice(0, 120),
    latestOutcomeId: record.id,
    pendingConfirmationIds: records.filter((item) => item.status === "pending_confirmation").map((item) => item.id),
    generatedAt: Date.now(),
  };
}

export function reopenExecutionOutcome(
  model: ExecutionOutcomeModel,
  liveTaskId: number,
): ExecutionOutcomeModel {
  const now = Date.now();
  const records = model.records.map((record) => record.liveTaskId === liveTaskId
    ? {
      ...record,
      status: "reopened" as const,
      usableForCoverage: false,
      strength: "planned" as const,
      inference: {
        confidence: "high" as const,
        basis: "task_state" as const,
        reason: "The live task was reopened, so its prior completion evidence has been withdrawn from current coverage.",
      },
      updatedAt: now,
    }
    : record);
  return {
    ...model,
    records,
    pendingConfirmationIds: records.filter((record) => record.status === "pending_confirmation").map((record) => record.id),
    generatedAt: now,
  };
}

export const executionOutcomeInternals = {
  allAlwaysSubtasksComplete,
  automaticOutcomePolicy,
  completedSubtaskIds,
  safeExternalUrl,
};
