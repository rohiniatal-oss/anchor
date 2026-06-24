import { storage } from "./storage";
import {
  USER_EVIDENCE_CORPUS_VERSION,
  buildUserEvidenceCorpus,
  type UserEvidenceCorpus,
  type UserEvidenceItem,
  type UserEvidenceSourceType,
} from "./trackResearchCoverageEvidence";
import {
  executionOutcomeEvidenceItem,
  normalizeExecutionOutcomeModel,
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

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
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
 * The wrapper keeps planned or active learning visible while excluding it from
 * coverage. It also adds confirmed execution outcomes and includes track
 * associations in the fingerprint because track linkage affects relevance.
 */
export async function buildCanonicalUserEvidenceCorpus(targetTrackId: number): Promise<UserEvidenceCorpus> {
  const [base, learns, track] = await Promise.all([
    buildUserEvidenceCorpus(targetTrackId),
    storage.getLearn(),
    storage.getCareerTrack(targetTrackId),
  ]);

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

  const intelligence = parseJsonObject(track?.trackIntelligence);
  const blueprintFingerprint = String(intelligence.executionBlueprintModel?.sourceFingerprint || "");
  const outcomeModel = normalizeExecutionOutcomeModel(
    intelligence.executionOutcomeModel,
    targetTrackId,
    blueprintFingerprint,
  );
  for (const outcome of outcomeModel.outcomes) {
    const evidence = executionOutcomeEvidenceItem(outcome);
    if (!evidence) continue;
    byKey.set(canonicalKey(evidence), {
      ...evidence,
      sourceUrl: safeExternalUrl(evidence.sourceUrl),
      trackIds: uniqueNumbers(evidence.trackIds),
    });
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
    .slice(0, 64);

  const caveats = [...base.caveats];
  if (items.some((item) => !item.usableForCoverage) && !caveats.some((item) => item.includes("In-progress and planned"))) {
    caveats.push("In-progress and planned items are visible to the assessor but are not treated as proven capability.");
  }
  if (outcomeModel.pendingOutcomeIds.length) {
    caveats.push(`${outcomeModel.pendingOutcomeIds.length} completed execution outcome${outcomeModel.pendingOutcomeIds.length === 1 ? " requires" : "s require"} one focused confirmation before it can affect coverage.`);
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
  corpusFingerprint,
  safeExternalUrl,
};
