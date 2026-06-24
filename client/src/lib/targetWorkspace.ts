import type { CareerTrack } from "@shared/schema";

export const ACTIVE_TARGET_STORAGE_KEY = "anchor.active-target-track-id";

export type TargetWorkspaceSummary = {
  id: number;
  name: string;
  summary: string;
  evidenceCount: number | null;
  status: string;
  priority: number;
  updatedAt: number;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function parseTrackIntelligence(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function targetWorkspaceSummary(track: CareerTrack): TargetWorkspaceSummary | null {
  const intelligence = parseTrackIntelligence(track.trackIntelligence);
  const hasResearch = intelligence.requirementModel?.mode === "requirement_model"
    || (Array.isArray(intelligence.requirementGraph) && intelligence.requirementGraph.length > 0)
    || finiteNumber(intelligence.researchedAt) > 0;
  if (!hasResearch) return null;

  const evidenceCount = Array.isArray(intelligence.evidencePack)
    ? intelligence.evidencePack.length
    : Number.isFinite(Number(intelligence.requirementModel?.researchQuality?.sourceCount))
      ? Number(intelligence.requirementModel.researchQuality.sourceCount)
      : null;
  const updatedAt = Math.max(
    finiteNumber(track.createdAt),
    finiteNumber(intelligence.lastUpdated),
    finiteNumber(intelligence.researchedAt),
    finiteNumber(intelligence.requirementModel?.generatedAt),
    finiteNumber(intelligence.coverageModel?.generatedAt),
    finiteNumber(intelligence.developmentPlanModel?.generatedAt),
    finiteNumber(intelligence.executionBlueprintModel?.generatedAt),
    finiteNumber(intelligence.executionPriorityModel?.generatedAt),
  );

  return {
    id: track.id,
    name: compact(track.name || intelligence.requirementModel?.target?.label) || "Researched target",
    summary: compact(intelligence.researchSummary || intelligence.requirementModel?.target?.definition || track.description)
      || "Anchor has researched the requirements and development path for this target.",
    evidenceCount,
    status: compact(track.status) || "active",
    priority: finiteNumber(track.priority),
    updatedAt,
  };
}

function statusRank(status: string): number {
  if (status === "active") return 3;
  if (status === "watch") return 2;
  if (status === "paused") return 1;
  return 0;
}

export function researchedTargetWorkspaces(tracks: CareerTrack[]): TargetWorkspaceSummary[] {
  return tracks
    .map(targetWorkspaceSummary)
    .filter((value): value is TargetWorkspaceSummary => Boolean(value))
    .sort((left, right) => statusRank(right.status) - statusRank(left.status)
      || right.priority - left.priority
      || right.updatedAt - left.updatedAt
      || right.id - left.id);
}

export function chooseActiveTargetWorkspace(
  tracks: CareerTrack[],
  preferredTrackId: number | null | undefined,
): TargetWorkspaceSummary | null {
  const candidates = researchedTargetWorkspaces(tracks);
  if (!candidates.length) return null;
  return candidates.find((candidate) => candidate.id === preferredTrackId) || candidates[0];
}
