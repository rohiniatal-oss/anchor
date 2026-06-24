import { storage } from "./storage";
import {
  USER_EVIDENCE_CORPUS_VERSION,
  buildUserEvidenceCorpus,
  type UserEvidenceCorpus,
  type UserEvidenceItem,
  type UserEvidenceSourceType,
} from "./trackResearchCoverageEvidence";
import {
  parseExecutionFeedbackModel,
  type ExecutionOutcomeRecord,
} from "./trackResearchExecutionOutcome";

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

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, ...parts: unknown[]): string {
  const normalized = parts.map(normalize).filter(Boolean).join("|");
  return `${prefix}-${stableHash(normalized || prefix)}`;
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))].sort((left, right) => left - right);
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

function sourceCounts(items: UserEvidenceItem[]): Record<UserEvidenceSourceType, number> {
  const counts: Record<UserEvidenceSourceType, number> = {
    cv: 0,
    profile_summary: 0,
    win: 0,
    learning_output: 0,
    completed_learning: 0,
    proof_asset: 0,
    relationship: 0,
    interaction: 0,
  };
  for (const item of items) counts[item.sourceType] += 1;
  return counts;
}

function canonicalLearnStatus(item: any): "published" | "completed" | "active" | null {
  const outputStatus = normalize(item.outputStatus);
  if (safeExternalUrl(item.outputEvidenceUrl) || outputStatus === "published") return "published";
  const status = normalize(item.learnStatus);
  if (["done", "complete", "completed"].includes(status) || Boolean(item.done)) return "completed";
  if (["active", "in progress", "started"].includes(status) || Boolean(item.active)) return "active";
  return null;
}

function canonicalLearnEvidence(item: any): UserEvidenceItem | null {
  const status = canonicalLearnStatus(item);
  if (!status) return null;
  const verified = status === "published";
  const completed = status === "completed";
  const label = compact(item.outputTitle || item.title) || "Learning evidence";
  const detail = compact([
    item.title,
    item.capabilityBuilt ? `Capability: ${item.capabilityBuilt}` : "",
    item.requiredOutput ? `Required output: ${item.requiredOutput}` : "",
    verified && item.outputTitle ? `Produced output: ${item.outputTitle}` : "",
    item.note,
  ].filter(Boolean).join(". "));
  return {
    id: stableId("user-evidence-learn", item.id, item.title, item.outputTitle),
    sourceType: verified ? "learning_output" : "completed_learning",
    label,
    detail,
    sourceUrl: verified ? safeExternalUrl(item.outputEvidenceUrl) : safeExternalUrl(item.url),
    strength: verified ? "verified" : completed ? "supporting" : "planned",
    state: verified ? "published" : completed ? "completed" : "active",
    usableForCoverage: verified || completed,
    sourceEntityType: "learn",
    sourceEntityId: Number.isFinite(Number(item.id)) ? Number(item.id) : null,
    trackIds: uniqueNumbers([item.relatedTrackId]),
    observedAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : null,
  };
}

function executionOutcomeSourceType(outcome: ExecutionOutcomeRecord): UserEvidenceSourceType {
  if (outcome.evidenceType === "proof" || outcome.evidenceType === "narrative") return "proof_asset";
  if (outcome.evidenceType === "knowledge" || outcome.evidenceType === "skill") {
    return outcome.sourceUrl ? "learning_output" : "completed_learning";
  }
  if (outcome.evidenceType === "relationship" || outcome.evidenceType === "access") return "interaction";
  return "win";
}

function canonicalExecutionOutcome(outcome: ExecutionOutcomeRecord): UserEvidenceItem | null {
  if (!["accepted", "pending_confirmation"].includes(outcome.status)) return null;
  const accepted = outcome.status === "accepted" && outcome.usableForCoverage;
  const sourceType = executionOutcomeSourceType(outcome);
  const sourceUrl = safeExternalUrl(outcome.sourceUrl);
  return {
    id: stableId("user-evidence-execution-outcome", outcome.id, outcome.updatedAt),
    sourceType,
    label: compact(outcome.summary || outcome.taskTitle) || "Execution outcome",
    detail: compact([
      outcome.detail,
      outcome.expectedEvidence ? `Expected evidence: ${outcome.expectedEvidence}` : "",
      outcome.confirmationAnswer ? `Confirmed outcome: ${outcome.confirmationAnswer}` : "",
      outcome.requirementIds.length ? `Linked requirements: ${outcome.requirementIds.join(", ")}` : "",
    ].filter(Boolean).join(". ")),
    sourceUrl,
    strength: accepted ? outcome.strength : "planned",
    state: accepted ? (sourceUrl && outcome.strength === "verified" ? "published" : "completed") : "planned",
    usableForCoverage: accepted,
    sourceEntityType: "execution_outcome",
    sourceEntityId: outcome.liveTaskId,
    trackIds: [outcome.trackId],
    observedAt: outcome.acceptedAt || outcome.updatedAt || outcome.createdAt,
  };
}

function canonicalKey(item: UserEvidenceItem): string {
  if (item.sourceEntityId != null) return `${item.sourceEntityType}:${item.sourceEntityId}`;
  return item.id;
}

function corpusFingerprint(items: UserEvidenceItem[], targetTrackId: number): string {
  const usable = items.filter((item) => item.usableForCoverage && item.strength !== "planned");
  const fingerprintInput = usable
    .map((item) => [
      item.id,
      item.sourceEntityType,
      item.sourceEntityId ?? "",
      item.strength,
      item.state,
      item.detail,
      safeExternalUrl(item.sourceUrl),
      uniqueNumbers(item.trackIds).join(","),
    ].join("|"))
    .sort()
    .join("||");
  return stableHash(fingerprintInput || `empty:${targetTrackId}`);
}

/**
 * Wrap the original evidence collector with current schema semantics.
 *
 * Planned or pending items remain visible to the assessor but cannot prove
 * coverage. Accepted execution outcomes enter through the same canonical corpus
 * as CV, learning, proof and relationship evidence, so downstream cache
 * invalidation is automatic and evidence-led.
 */
export async function buildCanonicalUserEvidenceCorpus(targetTrackId: number): Promise<UserEvidenceCorpus> {
  const [base, learns, track] = await Promise.all([
    buildUserEvidenceCorpus(targetTrackId),
    storage.getLearn(),
    storage.getCareerTrack(targetTrackId),
  ]);

  const intelligence = (() => {
    try {
      const parsed = JSON.parse(String(track?.trackIntelligence || "{}"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  })();
  const feedbackModel = parseExecutionFeedbackModel(
    intelligence.executionFeedbackModel,
    targetTrackId,
    intelligence.executionBlueprintModel?.sourceFingerprint || "",
  );

  const byKey = new Map<string, UserEvidenceItem>();
  for (const item of base.items) {
    byKey.set(canonicalKey(item), {
      ...item,
      sourceUrl: safeExternalUrl(item.sourceUrl),
      trackIds: uniqueNumbers(item.trackIds),
    });
  }
  for (const learn of learns) {
    const canonical = canonicalLearnEvidence(learn);
    if (!canonical) continue;
    byKey.set(canonicalKey(canonical), canonical);
  }
  for (const outcome of feedbackModel.outcomes) {
    const canonical = canonicalExecutionOutcome(outcome);
    if (!canonical) continue;
    byKey.set(canonicalKey(canonical), canonical);
  }

  const items = [...byKey.values()]
    .sort((left, right) => {
      const rightTrack = right.trackIds.includes(targetTrackId) ? 1 : 0;
      const leftTrack = left.trackIds.includes(targetTrackId) ? 1 : 0;
      const strength = { verified: 5, direct: 4, declared: 3, supporting: 2, planned: 1 } as const;
      return rightTrack - leftTrack
        || strength[right.strength] - strength[left.strength]
        || Number(right.observedAt || 0) - Number(left.observedAt || 0);
    })
    .slice(0, 72);

  const caveats = [...base.caveats];
  if (items.some((item) => !item.usableForCoverage) && !caveats.some((item) => item.includes("In-progress and planned"))) {
    caveats.push("In-progress and planned items are visible to the assessor but are not treated as proven capability.");
  }
  if (feedbackModel.pendingConfirmationCount > 0) {
    caveats.push(`${feedbackModel.pendingConfirmationCount} completed execution outcome${feedbackModel.pendingConfirmationCount === 1 ? " needs" : "s need"} one focused confirmation before it can affect coverage.`);
  }

  return {
    mode: "user_evidence_corpus",
    version: USER_EVIDENCE_CORPUS_VERSION,
    targetTrackId,
    fingerprint: corpusFingerprint(items, targetTrackId),
    items,
    sourceCounts: sourceCounts(items),
    caveats: [...new Set(caveats)],
    generatedAt: Date.now(),
  };
}

export const coverageCorpusInternals = {
  canonicalLearnStatus,
  canonicalLearnEvidence,
  canonicalExecutionOutcome,
  executionOutcomeSourceType,
  corpusFingerprint,
  safeExternalUrl,
};
