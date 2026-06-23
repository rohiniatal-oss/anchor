import type { CareerArchitecture } from "./trackResearchArchitecture";

type ArchitectureItem = CareerArchitecture["stages"][number]["items"][number];
type GapKind = NonNullable<ArchitectureItem["gapKind"]>;
type ActivationCategory = "roleExamples" | "learningResources" | "networkTargets" | "proofAssets";

type ActivationCandidate = {
  category: ActivationCategory;
  label: string;
  detail: string;
  item: any;
  score: number;
  included: boolean;
  matchedGapIds: string[];
  reason: string;
};

export type GapDrivenActivationPlan = {
  principle: string;
  limits: CareerArchitecture["activationLimits"];
  priorityGaps: Array<{
    id: string;
    label: string;
    gapKind: GapKind | undefined;
    score: number;
  }>;
  selected: Record<ActivationCategory, ActivationCandidate[]>;
  parked: Record<ActivationCategory, ActivationCandidate[]>;
  generatedAt: number;
};

const CATEGORY_GAPS: Record<ActivationCategory, GapKind[]> = {
  roleExamples: ["information", "access", "network"],
  learningResources: ["knowledge", "skill", "credential"],
  networkTargets: ["information", "network", "access"],
  proofAssets: ["evidence", "narrative", "reputation", "skill"],
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function words(value: unknown) {
  return normalize(value).split(" ").filter((word) => word.length > 3);
}

function overlapScore(candidateText: string, gap: ArchitectureItem) {
  const candidateWords = new Set(words(candidateText));
  if (!candidateWords.size) return 0;
  const gapWords = words(`${gap.label} ${gap.detail} ${gap.evidence}`);
  const matches = gapWords.filter((word) => candidateWords.has(word)).length;
  return Math.min(18, matches * 3);
}

function priorityGaps(architecture: CareerArchitecture): ArchitectureItem[] {
  const prioritizedStage = architecture.stages.find((stage) => stage.id === "gap_prioritization");
  const stageGaps = asArray(prioritizedStage?.items).filter((gap) => gap.gapKind);
  if (stageGaps.length) return stageGaps;
  return [
    ...asArray(architecture.automaticSelection.accepted),
    ...asArray(architecture.automaticSelection.needsEvidence),
  ].filter((gap) => gap.gapKind);
}

function roleText(role: any) {
  return [role.title, role.what, role.seniority, ...asArray(role.typicalOrgs)].join(" ");
}

function learningText(path: any) {
  return [path.topic, path.why, path.resourceType, path.suggestedResource, path.output].join(" ");
}

function networkText(archetype: any) {
  return [archetype.who, archetype.why, archetype.searchTip].join(" ");
}

function proofText(idea: any) {
  return [idea.title, idea.why, idea.format, idea.firstStep].join(" ");
}

function candidateLabel(category: ActivationCategory, item: any) {
  if (category === "roleExamples") return compact(item.title);
  if (category === "learningResources") return compact(item.topic);
  if (category === "networkTargets") return compact(item.who);
  return compact(item.title);
}

function candidateText(category: ActivationCategory, item: any) {
  if (category === "roleExamples") return roleText(item);
  if (category === "learningResources") return learningText(item);
  if (category === "networkTargets") return networkText(item);
  return proofText(item);
}

function scoreCandidate(category: ActivationCategory, item: any, index: number, gaps: ArchitectureItem[]) {
  const text = candidateText(category, item);
  let bestScore = Math.max(0, 8 - index);
  const matchedGapIds: string[] = [];

  for (const gap of gaps) {
    const kindMatch = gap.gapKind && CATEGORY_GAPS[category].includes(gap.gapKind) ? 30 : 0;
    const textMatch = overlapScore(text, gap);
    const score = kindMatch + textMatch + Math.round((gap.score || 0) / 4) + Math.max(0, 8 - index);
    if (kindMatch > 0 || textMatch >= 6) {
      matchedGapIds.push(gap.id);
      bestScore = Math.max(bestScore, score);
    }
  }

  return { score: bestScore, matchedGapIds };
}

function reasonFor(category: ActivationCategory, candidate: ActivationCandidate) {
  if (!candidate.matchedGapIds.length) {
    return "Stored as context because it does not map cleanly to a current priority gap.";
  }
  if (category === "roleExamples") return "Creates target-state or access evidence for a priority information/access gap.";
  if (category === "learningResources") return "Builds knowledge, skill, or credential capital tied to a priority gap.";
  if (category === "networkTargets") return "Collects information, access, or relationship capital for a priority gap.";
  return "Creates evidence, narrative, reputation, or skill proof for a priority gap.";
}

function selectCategory(category: ActivationCategory, items: any[], limit: number, gaps: ArchitectureItem[]) {
  const relevantGaps = gaps.filter((gap) => gap.gapKind && CATEGORY_GAPS[category].includes(gap.gapKind));
  const candidates = asArray(items).map((raw, index) => {
    const scored = scoreCandidate(category, raw, index, gaps);
    const candidate: ActivationCandidate = {
      category,
      label: candidateLabel(category, raw),
      detail: compact(candidateText(category, raw)),
      item: raw,
      score: scored.score,
      included: false,
      matchedGapIds: scored.matchedGapIds,
      reason: "",
    };
    candidate.reason = reasonFor(category, candidate);
    return candidate;
  }).filter((candidate) => candidate.label);

  const selected = candidates
    .filter((candidate) => candidate.matchedGapIds.length > 0 && candidate.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (!selected.length && relevantGaps.length && candidates.length && limit > 0) {
    selected.push(candidates.sort((a, b) => b.score - a.score)[0]);
  }

  const selectedKeys = new Set(selected.map((candidate) => normalize(candidate.label)));
  return {
    selected: selected.map((candidate) => ({ ...candidate, included: true })),
    parked: candidates
      .filter((candidate) => !selectedKeys.has(normalize(candidate.label)))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
  };
}

export function buildGapDrivenActivationPlan(brief: any, architecture: CareerArchitecture): GapDrivenActivationPlan {
  const gaps = priorityGaps(architecture);
  const roles = selectCategory("roleExamples", brief.roleShapes, architecture.activationLimits.roleExamples, gaps);
  const learning = selectCategory("learningResources", brief.learningPaths, architecture.activationLimits.learningResources, gaps);
  const network = selectCategory("networkTargets", brief.networkArchetypes, architecture.activationLimits.networkTargets, gaps);
  const proof = selectCategory("proofAssets", brief.proofAssetIdeas, architecture.activationLimits.proofAssets, gaps);

  return {
    principle: "Activate only the objects that map to priority gaps; caps limit clutter but do not decide relevance.",
    limits: architecture.activationLimits,
    priorityGaps: gaps.map((gap) => ({
      id: gap.id,
      label: gap.label,
      gapKind: gap.gapKind,
      score: Math.round(gap.score || 0),
    })),
    selected: {
      roleExamples: roles.selected,
      learningResources: learning.selected,
      networkTargets: network.selected,
      proofAssets: proof.selected,
    },
    parked: {
      roleExamples: roles.parked,
      learningResources: learning.parked,
      networkTargets: network.parked,
      proofAssets: proof.parked,
    },
    generatedAt: Date.now(),
  };
}

export function applyGapDrivenActivationFilter(brief: any, architecture: CareerArchitecture) {
  const activationPlan = buildGapDrivenActivationPlan(brief, architecture);
  return {
    ...brief,
    roleShapes: activationPlan.selected.roleExamples.map((candidate) => candidate.item),
    learningPaths: activationPlan.selected.learningResources.map((candidate) => candidate.item),
    networkArchetypes: activationPlan.selected.networkTargets.map((candidate) => candidate.item),
    proofAssetIdeas: activationPlan.selected.proofAssets.map((candidate) => candidate.item),
    activationPlan,
  };
}
