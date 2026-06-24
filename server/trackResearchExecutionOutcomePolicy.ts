import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import type { RequirementModel } from "./trackResearchRequirementModel";
import type {
  ExecutionCoverageDelta,
  ExecutionMilestoneProgress,
  ExecutionOutcomeRecord,
} from "./trackResearchExecutionOutcome";

export type ExecutionOutcomeResolution = "confirmed" | "supporting" | "no_evidence" | "mistaken";

export type ExecutionOutcomeConfirmationInput = {
  resolution: ExecutionOutcomeResolution;
  answer?: string;
  sourceUrl?: string;
};

function compact(value: unknown, max = 2_000): string {
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
  const raw = compact(value, 1_000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function negativeSignal(value: string): boolean {
  const text = normalize(value);
  return [
    "no external interaction yet",
    "no market signal yet",
    "no useful evidence",
    "nothing useful",
    "not completed",
    "did not happen",
    "no result",
  ].some((phrase) => text.includes(phrase));
}

function confirmationStrength(
  record: ExecutionOutcomeRecord,
  resolution: ExecutionOutcomeResolution,
  sourceUrl: string,
): ExecutionOutcomeRecord["strength"] {
  if (sourceUrl) return "verified";
  if (resolution === "supporting") return "supporting";
  if (["experience", "relationship", "access", "learning", "practice"].includes(record.taskKind)) return "direct";
  return "supporting";
}

export function applyExecutionOutcomeConfirmation(
  record: ExecutionOutcomeRecord,
  input: ExecutionOutcomeConfirmationInput,
): ExecutionOutcomeRecord {
  const now = Date.now();
  const resolution = input.resolution;
  const answer = compact(input.answer, 1_500);
  const sourceUrl = safeExternalUrl(input.sourceUrl);

  if (resolution === "mistaken") {
    return {
      ...record,
      status: "reopened",
      usableForCoverage: false,
      strength: "planned",
      sourceUrl: "",
      inference: {
        confidence: "high",
        basis: "user_confirmation",
        reason: "The user confirmed that the task was marked complete by mistake, so its evidence has been withdrawn.",
      },
      confirmation: {
        ...record.confirmation,
        required: false,
        answer: answer || "Marked complete by mistake",
        answeredAt: now,
      },
      updatedAt: now,
    };
  }

  if (resolution === "no_evidence" || negativeSignal(answer)) {
    return {
      ...record,
      status: "insufficient",
      usableForCoverage: false,
      strength: "supporting",
      sourceUrl,
      detail: compact([record.detail, answer ? `Confirmed outcome: ${answer}.` : "No usable evidence resulted from the completed task."].join(" "), 4_000),
      inference: {
        confidence: "high",
        basis: "user_confirmation",
        reason: "The user confirmed that the completed task did not yet produce evidence that can support requirement coverage.",
      },
      confirmation: {
        ...record.confirmation,
        required: false,
        answer: answer || "No usable evidence",
        answeredAt: now,
      },
      updatedAt: now,
    };
  }

  if (!answer && !sourceUrl) {
    throw new Error("Add the concrete result or an evidence link before confirming this outcome.");
  }

  if (record.taskKind === "research" || record.taskKind === "verification") {
    return {
      ...record,
      status: "operational_only",
      usableForCoverage: false,
      strength: "supporting",
      sourceUrl,
      detail: compact([record.detail, answer ? `Confirmed result: ${answer}.` : "", sourceUrl ? `Evidence location: ${sourceUrl}.` : ""].filter(Boolean).join(" "), 4_000),
      inference: {
        confidence: sourceUrl ? "high" : "medium",
        basis: "user_confirmation",
        reason: "The task resolved or prepared the plan, but it does not by itself demonstrate user capability.",
      },
      confirmation: {
        ...record.confirmation,
        required: false,
        answer: answer || sourceUrl,
        answeredAt: now,
      },
      updatedAt: now,
    };
  }

  const strength = confirmationStrength(record, resolution, sourceUrl);
  return {
    ...record,
    status: "accepted",
    usableForCoverage: true,
    strength,
    sourceUrl,
    detail: compact([
      record.detail,
      answer ? `User-confirmed outcome: ${answer}.` : "",
      sourceUrl ? `Inspectable evidence: ${sourceUrl}.` : "",
    ].filter(Boolean).join(" "), 4_000),
    inference: {
      confidence: sourceUrl || strength === "direct" ? "high" : "medium",
      basis: "user_confirmation",
      reason: sourceUrl
        ? "The user supplied an inspectable HTTP or HTTPS evidence location."
        : strength === "direct"
          ? "The user confirmed a concrete real-world result or applied performance signal."
          : "The user confirmed a useful result, but the available evidence remains supporting rather than independently verified.",
    },
    confirmation: {
      ...record.confirmation,
      required: false,
      answer: answer || sourceUrl,
      answeredAt: now,
    },
    updatedAt: now,
  };
}

function coverageMap(model: CoverageModel | null | undefined) {
  return new Map((model?.coverage || []).map((coverage) => [coverage.requirementId, coverage]));
}

export function buildExecutionCoverageDelta(
  requirementModel: RequirementModel,
  before: CoverageModel | null | undefined,
  after: CoverageModel,
  affectedRequirementIds: string[],
): ExecutionCoverageDelta[] {
  const beforeById = coverageMap(before);
  const afterById = coverageMap(after);
  const affected = new Set(affectedRequirementIds);
  return requirementModel.requirements
    .filter((requirement) => affected.has(requirement.id))
    .map((requirement) => {
      const previous = beforeById.get(requirement.id);
      const current = afterById.get(requirement.id);
      const beforeStatus: CoverageStatus = previous?.status || "unknown";
      const afterStatus: CoverageStatus = current?.status || "unknown";
      const beforeConfidence = previous?.confidence || "low";
      const afterConfidence = current?.confidence || "low";
      const changed = beforeStatus !== afterStatus || beforeConfidence !== afterConfidence;
      return {
        requirementId: requirement.id,
        label: requirement.label,
        beforeStatus,
        afterStatus,
        beforeConfidence,
        afterConfidence,
        changed,
        explanation: changed
          ? `${requirement.label} moved from ${beforeStatus.replace(/_/g, " ")} to ${afterStatus.replace(/_/g, " ")} after the new execution evidence was assessed.`
          : `${requirement.label} remains ${afterStatus.replace(/_/g, " ")}; the outcome has been recorded, but more or stronger evidence is still required to change coverage.`,
      };
    });
}

function linkedOutcomes(
  milestone: { id: string; requirementIds: string[] },
  records: ExecutionOutcomeRecord[],
): ExecutionOutcomeRecord[] {
  const requirementIds = new Set(milestone.requirementIds);
  return records.filter((record) => record.milestoneIds.includes(milestone.id)
    || record.requirementIds.some((id) => requirementIds.has(id)));
}

export function buildExecutionMilestoneProgress(
  developmentPlan: DevelopmentPlanModel,
  coverageModel: CoverageModel,
  records: ExecutionOutcomeRecord[],
): ExecutionMilestoneProgress[] {
  const coverageById = coverageMap(coverageModel);
  const now = Date.now();
  return developmentPlan.workstreams.flatMap((workstream) => workstream.milestones.map((milestone) => {
    const outcomes = linkedOutcomes(milestone, records);
    const provenRequirementCount = milestone.requirementIds.filter((id) => coverageById.get(id)?.status === "proven").length;
    const pending = outcomes.some((outcome) => outcome.status === "pending_confirmation");
    const accepted = outcomes.some((outcome) => outcome.status === "accepted");
    const partialCoverage = milestone.requirementIds.some((id) => {
      const status = coverageById.get(id)?.status;
      return status === "proven" || status === "partially_proven";
    });
    const achieved = milestone.requirementIds.length > 0
      && provenRequirementCount === milestone.requirementIds.length;
    const status: ExecutionMilestoneProgress["status"] = achieved
      ? "achieved"
      : pending
        ? "pending_confirmation"
        : accepted || partialCoverage
          ? "in_progress"
          : "not_started";
    return {
      milestoneId: milestone.id,
      workstreamId: workstream.id,
      label: milestone.label,
      requirementIds: [...milestone.requirementIds],
      status,
      provenRequirementCount,
      totalRequirementCount: milestone.requirementIds.length,
      outcomeIds: outcomes
        .filter((outcome) => outcome.status === "accepted" || outcome.status === "pending_confirmation")
        .map((outcome) => outcome.id),
      doneWhen: milestone.doneWhen,
      reason: achieved
        ? "Every linked requirement is proven against its success bar."
        : pending
          ? "A completed task still needs one focused factual confirmation before milestone progress can be assessed."
          : accepted || partialCoverage
            ? `${provenRequirementCount} of ${milestone.requirementIds.length} linked requirements are proven; supporting evidence is recorded for the remainder.`
            : "No accepted evidence currently advances this milestone.",
      updatedAt: now,
    };
  }));
}

export const executionOutcomePolicyInternals = {
  negativeSignal,
  safeExternalUrl,
};
