import { createHash } from "node:crypto";
import { storage } from "./storage";
import { buildCanonicalUserEvidenceCorpus } from "./trackResearchCoverageCorpus";
import type {
  UserEvidenceCorpus,
  UserEvidenceItem,
  UserEvidenceSourceType,
} from "./trackResearchCoverageEvidence";
import {
  EXECUTION_OUTCOME_MODEL_VERSION,
  type ExecutionOutcome,
  type ExecutionOutcomeModel,
} from "./trackResearchExecutionOutcome";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

function validOutcomeModel(value: any): value is ExecutionOutcomeModel {
  return value?.mode === "execution_outcome_model"
    && value?.version === EXECUTION_OUTCOME_MODEL_VERSION
    && Array.isArray(value.outcomes)
    && typeof value.acceptedEvidenceFingerprint === "string";
}

function sourceTypeFor(outcome: ExecutionOutcome): UserEvidenceSourceType {
  if (outcome.outcomeType === "learning_application") {
    return outcome.evidenceUrl ? "learning_output" : "completed_learning";
  }
  if (outcome.outcomeType === "applied_experience") return "win";
  if (outcome.outcomeType === "relationship_signal" || outcome.outcomeType === "access_signal") return "interaction";
  return "proof_asset";
}

function outcomeEvidenceItem(outcome: ExecutionOutcome): UserEvidenceItem {
  const sourceType = sourceTypeFor(outcome);
  return {
    id: `user-evidence-${outcome.id}`,
    sourceType,
    label: outcome.title,
    detail: outcome.evidenceDetail || outcome.summary || outcome.expectedEvidence,
    sourceUrl: outcome.evidenceUrl,
    strength: outcome.evidenceStrength,
    state: outcome.evidenceUrl ? "published" : "completed",
    usableForCoverage: outcome.status === "accepted",
    sourceEntityType: "execution_outcome" as any,
    sourceEntityId: outcome.liveTaskId,
    trackIds: [outcome.trackId],
    observedAt: outcome.acceptedAt || outcome.updatedAt,
  };
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

/**
 * Build the canonical user evidence corpus and append only accepted execution
 * outcomes. A checked task can therefore create supporting evidence, but cannot
 * bypass category-specific coverage policy or directly mark a requirement as
 * proven.
 */
export async function buildAdaptiveUserEvidenceCorpus(targetTrackId: number): Promise<UserEvidenceCorpus> {
  const [base, track] = await Promise.all([
    buildCanonicalUserEvidenceCorpus(targetTrackId),
    storage.getCareerTrack(targetTrackId),
  ]);
  if (!track) return base;

  const intelligence = parseJsonObject(track.trackIntelligence);
  const outcomeModel = intelligence.executionOutcomeModel;
  if (!validOutcomeModel(outcomeModel)) return base;

  const outcomeItems = outcomeModel.outcomes
    .filter((outcome) => outcome.status === "accepted" && outcome.trackId === targetTrackId)
    .map(outcomeEvidenceItem);
  if (!outcomeItems.length) return base;

  const byId = new Map<string, UserEvidenceItem>();
  for (const item of [...base.items, ...outcomeItems]) byId.set(item.id, item);
  const items = [...byId.values()]
    .sort((left, right) => Number(right.observedAt || 0) - Number(left.observedAt || 0))
    .slice(0, 96);
  const caveats = [...new Set([
    ...base.caveats,
    "Completed execution tasks contribute evidence conservatively; coverage still depends on topical relevance and the category-specific success bar.",
  ])];

  return {
    ...base,
    fingerprint: hash({
      base: base.fingerprint,
      acceptedExecutionOutcomes: outcomeModel.acceptedEvidenceFingerprint,
      targetTrackId,
    }),
    items,
    sourceCounts: sourceCounts(items),
    caveats,
    generatedAt: Date.now(),
  };
}

export const adaptiveEvidenceCorpusInternals = {
  outcomeEvidenceItem,
  sourceTypeFor,
  validOutcomeModel,
};
