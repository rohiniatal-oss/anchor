import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import type { ExecutionBlueprintModel } from "./trackResearchExecutionBlueprint";
import type { RequirementModel } from "./trackResearchRequirementModel";
import type {
  ExecutionCoverageDelta,
  ExecutionMilestoneProgress,
  ExecutionOutcomeModel,
  ExecutionOutcomeRecord,
} from "./trackResearchExecutionOutcome";

export type ExecutionOutcomeConfirmationDecision = "accept" | "insufficient" | "reopen";

export type ExecutionOutcomeConfirmationInput = {
  decision: ExecutionOutcomeConfirmationDecision;
  answer?: string;
  sourceUrl?: string;
};

function compact(value: unknown, max = 2_400): string {
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

function safeExternalUrl(value: unknown): string {
  const raw = compact(value, 900);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function answerLooksNegative(value: string): boolean {
  const text = normalize(value);
  if (!text) return false;
  return [
    "no external interaction yet",
    "no market signal yet",
    "no useful evidence",
    "nothing completed",
    "not completed",
    "no result yet",
    "none yet",
  ].some((phrase) => text.includes(phrase));
}

function strengthForConfirmation(
  record: ExecutionOutcomeRecord,
  answer: string,
  sourceUrl: string,
): ExecutionOutcomeRecord["strength"] {
  if (sourceUrl) return "verified";
  const text = normalize(answer);
  if (record.taskKind === "relationship") {
    return /substantive conversation|introduction|referral|meeting/.test(text) ? "direct" : "supporting";
  }
  if (record.taskKind === "access") {
    return /application|process entered|warm introduction|referral|interview/.test(text) ? "direct" : "supporting";
  }
  if (record.taskKind === "credential") {
    return /verified|eligible|approved|certified|completed|awarded|granted/.test(text) ? "direct" : "supporting";
  }
  if (record.taskKind === "experience") {
    return answer.length >= 24 ? "direct" : "supporting";
  }
  if (record.taskKind === "artifact" || record.taskKind === "validation") return "supporting";
  return record.strength === "planned" ? "supporting" : record.strength;
}

function confirmationDetail(record: ExecutionOutcomeRecord, answer: string): string {
  return compact([
    record.detail,
    answer ? `User-confirmed outcome: ${answer}.` : "",
  ].filter(Boolean).join(" "), 5_000);
}

export function applyExecutionOutcomeConfirmation(
  record: ExecutionOutcomeRecord,
  input: ExecutionOutcomeConfirmationInput,
): ExecutionOutcomeRecord {
  const now = Date.now();
  const answer = compact(input.answer);
  const sourceUrl = safeExternalUrl(input.sourceUrl || (answer.startsWith("http") ? answer : ""));
  const confirmation = {
    ...record.confirmation,
    answer,
    answeredAt: now,
  };

  if (input.decision === "reopen") {
    return {
      ...record,
      status: "reopened",
      usableForCoverage: false,
      strength: "planned",
      sourceUrl: "",
      inference: {
        confidence: "high",
        basis: "user_confirmation",
        reason: "The user confirmed that the task was marked complete by mistake, so its evidence was withdrawn.",
      },
      confirmation,
      updatedAt: now,
    };
  }

  if (input.decision === "insufficient" || answerLooksNegative(answer)) {
    return {
      ...record,
      status: "insufficient",
      usableForCoverage: false,
      strength: "planned",
      sourceUrl,
      detail: confirmationDetail(record, answer),
      inference: {
        confidence: "high",
        basis: "user_confirmation",
        reason: "The user confirmed that the completed task did not yet create the real-world output or signal required for coverage.",
      },
      confirmation,
      updatedAt: now,
    };
  }

  if (record.confirmation.required && !answer && !sourceUrl) {
    return {
      ...record,
      status: "pending_confirmation",
      usableForCoverage: false,
      strength: "planned",
      inference: {
        confidence: "low",
        basis: "task_state",
        reason: "A specific outcome or evidence location is still required before the task can affect coverage.",
      },
      confirmation: {
        ...confirmation,
        answeredAt: null,
      },
      updatedAt: now,
    };
  }

  const strength = strengthForConfirmation(record, answer, sourceUrl);
  return {
    ...record,
    status: "accepted",
    usableForCoverage: true,
    strength,
    sourceUrl: sourceUrl || record.sourceUrl,
    detail: confirmationDetail(record, answer),
    inference: {
      confidence: sourceUrl || strength === "direct" ? "high" : "medium",
      basis: "user_confirmation",
      reason: sourceUrl
        ? "The user supplied a retrievable evidence location."
        : "The user supplied a task-specific outcome that can be treated as direct or supporting evidence without assuming the full success bar is met.",
    },
    confirmation,
    updatedAt: now,
  };
}

function coverageStatusLabel(value: CoverageStatus): string {
  if (value === "partially_proven") return "partly evidenced";
  if (value === "below_bar") return "below the target bar";
  if (value === "unproven") return "not yet evidenced";
  return value;
}

export function buildExecutionCoverageDelta(input: {
  requirementModel: RequirementModel;
  before: CoverageModel | null | undefined;
  after: CoverageModel;
  affectedRequirementIds: string[];
}): ExecutionCoverageDelta[] {
  const beforeById = new Map((input.before?.coverage || []).map((item) => [item.requirementId, item]));
  const afterById = new Map(input.after.coverage.map((item) => [item.requirementId, item]));
  const requirementById = new Map(input.requirementModel.requirements.map((item) => [item.id, item]));
  return [...new Set(input.affectedRequirementIds)]
    .map((requirementId) => {
      const requirement = requirementById.get(requirementId);
      const before = beforeById.get(requirementId);
      const after = afterById.get(requirementId);
      if (!requirement || !after) return null;
      const beforeStatus = before?.status || "unknown";
      const beforeConfidence = before?.confidence || "low";
      const changed = beforeStatus !== after.status
        || beforeConfidence !== after.confidence
        || JSON.stringify([...(before?.evidenceItemIds || [])].sort()) !== JSON.stringify([...after.evidenceItemIds].sort());
      const explanation = beforeStatus !== after.status
        ? `${requirement.label} moved from ${coverageStatusLabel(beforeStatus)} to ${coverageStatusLabel(after.status)} after the new execution evidence was assessed.`
        : changed
          ? `${requirement.label} retained its ${coverageStatusLabel(after.status)} status, but the evidence basis or confidence changed.`
          : `${requirement.label} did not change because the new outcome does not yet meet the documented success bar.`;
      return {
        requirementId,
        label: requirement.label,
        beforeStatus,
        afterStatus: after.status,
        beforeConfidence,
        afterConfidence: after.confidence,
        changed,
        explanation,
      } satisfies ExecutionCoverageDelta;
    })
    .filter(Boolean) as ExecutionCoverageDelta[];
}

export function buildExecutionMilestoneProgress(input: {
  blueprint: ExecutionBlueprintModel;
  coverageModel: CoverageModel;
  outcomeModel: ExecutionOutcomeModel;
}): ExecutionMilestoneProgress[] {
  const coverageById = new Map(input.coverageModel.coverage.map((item) => [item.requirementId, item]));
  const activeRecords = input.outcomeModel.records.filter((record) => record.status !== "reopened");
  const milestones = input.blueprint.workstreams.flatMap((workstream) => workstream.milestoneIds.map((milestoneId) => ({
    milestoneId,
    workstreamId: workstream.workstreamId,
    workstreamTitle: workstream.title,
  })));
  const uniqueMilestones = new Map(milestones.map((item) => [item.milestoneId, item]));

  return [...uniqueMilestones.values()].map((milestone) => {
    const blueprintTasks = input.blueprint.tasks.filter((task) => task.milestoneIds.includes(milestone.milestoneId));
    const requirementIds = [...new Set(blueprintTasks.flatMap((task) => task.requirementIds))];
    const linkedRecords = activeRecords.filter((record) => record.milestoneIds.includes(milestone.milestoneId)
      || record.requirementIds.some((id) => requirementIds.includes(id)));
    const accepted = linkedRecords.filter((record) => record.status === "accepted" && record.usableForCoverage);
    const pending = linkedRecords.filter((record) => record.status === "pending_confirmation");
    const provenRequirementCount = requirementIds.filter((id) => coverageById.get(id)?.status === "proven").length;
    const allRequirementsProven = requirementIds.length > 0 && provenRequirementCount === requirementIds.length;
    const status: ExecutionMilestoneProgress["status"] = allRequirementsProven && accepted.length > 0
      ? "achieved"
      : pending.length > 0
        ? "pending_confirmation"
        : linkedRecords.length > 0
          ? "in_progress"
          : "not_started";
    const reason = status === "achieved"
      ? "All linked requirements are proven and the milestone has accepted execution evidence."
      : status === "pending_confirmation"
        ? "A completed task may support this milestone, but one focused outcome confirmation is still required."
        : status === "in_progress"
          ? `${provenRequirementCount} of ${requirementIds.length} linked requirements are proven; accepted or operational execution outcomes show progress, but the milestone standard is not yet met.`
          : "No completed execution outcome is linked to this milestone yet.";
    return {
      milestoneId: milestone.milestoneId,
      workstreamId: milestone.workstreamId,
      label: milestone.workstreamTitle,
      requirementIds,
      status,
      provenRequirementCount,
      totalRequirementCount: requirementIds.length,
      outcomeIds: linkedRecords.map((record) => record.id),
      doneWhen: blueprintTasks.map((task) => task.doneWhen).filter(Boolean).join("; "),
      reason,
      updatedAt: Date.now(),
    } satisfies ExecutionMilestoneProgress;
  });
}

export const executionOutcomePolicyInternals = {
  answerLooksNegative,
  safeExternalUrl,
  strengthForConfirmation,
};
