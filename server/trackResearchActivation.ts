import type { CareerArchitecture } from "./trackResearchArchitecture";
import type { BottleneckDiagnosis } from "./trackResearchBottlenecks";

type ActivationCategory = "roleExamples" | "learningResources" | "networkTargets" | "proofAssets";
type BottleneckKind = BottleneckDiagnosis["crossRouteBottlenecks"][number]["kind"];
type Bottleneck = BottleneckDiagnosis["crossRouteBottlenecks"][number];

type ActivationCandidate = {
  category: ActivationCategory;
  label: string;
  detail: string;
  item: any;
  score: number;
  included: boolean;
  matchedBottleneckIds: string[];
  reason: string;
};

export type BottleneckActivationPlan = {
  mode: "bottleneck_driven_activation";
  principle: string;
  limits: CareerArchitecture["activationLimits"];
  bottlenecks: Array<{
    id: string;
    label: string;
    kind: BottleneckKind;
    route: string;
    score: number;
    recommendedBet: string;
  }>;
  selected: Record<ActivationCategory, ActivationCandidate[]>;
  parked: Record<ActivationCategory, ActivationCandidate[]>;
  generatedAt: number;
};

const CATEGORY_BOTTLENECKS: Record<ActivationCategory, BottleneckKind[]> = {
  roleExamples: ["route_clarity", "information", "market_signal", "access"],
  learningResources: ["capability_depth", "credential"],
  networkTargets: ["access", "network", "information", "route_clarity"],
  proofAssets: ["proof", "narrative", "capability_depth", "market_signal"],
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

function overlapScore(candidateText: string, bottleneck: Bottleneck) {
  const candidateWords = new Set(words(candidateText));
  if (!candidateWords.size) return 0;
  const bottleneckWords = words(`${bottleneck.label} ${bottleneck.route} ${bottleneck.whyItMightBeTheBottleneck} ${bottleneck.evidenceToResolve} ${bottleneck.recommendedBet}`);
  const matches = bottleneckWords.filter((word) => candidateWords.has(word)).length;
  return Math.min(20, matches * 4);
}

function severityBoost(bottleneck: Bottleneck) {
  if (bottleneck.severity === "high") return 14;
  if (bottleneck.severity === "medium") return 8;
  return 3;
}

function confidenceBoost(bottleneck: Bottleneck) {
  if (bottleneck.confidence === "high") return 8;
  if (bottleneck.confidence === "medium") return 4;
  return 0;
}

function bottlenecksFromDiagnosis(diagnosis: BottleneckDiagnosis | null) {
  if (!diagnosis) return [];
  const routeBottlenecks = diagnosis.routes.flatMap((route) => route.bottleneckHypotheses || []);
  const combined = [...diagnosis.crossRouteBottlenecks, ...routeBottlenecks];
  const seen = new Set<string>();
  const result: Bottleneck[] = [];
  for (const bottleneck of combined.sort((a, b) => (b.score || 0) - (a.score || 0))) {
    const key = bottleneck.id || `${bottleneck.route}:${bottleneck.kind}:${bottleneck.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(bottleneck);
  }
  return result.slice(0, 12);
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

function reasonFor(category: ActivationCategory, candidate: ActivationCandidate) {
  if (!candidate.matchedBottleneckIds.length) {
    return "Parked because it does not map cleanly to the current bottleneck diagnosis.";
  }
  if (category === "roleExamples") return "Activated to clarify route, market, information, or access bottlenecks.";
  if (category === "learningResources") return "Activated to build capability depth or credential capital tied to a diagnosed bottleneck.";
  if (category === "networkTargets") return "Activated to resolve access, network, information, or route-clarity bottlenecks.";
  return "Activated to create proof, narrative, market signal, or applied capability evidence.";
}

function scoreCandidate(category: ActivationCategory, item: any, index: number, bottlenecks: Bottleneck[]) {
  const text = candidateText(category, item);
  const matchedBottleneckIds: string[] = [];
  let bestScore = Math.max(0, 8 - index);

  for (const bottleneck of bottlenecks) {
    const kindMatch = CATEGORY_BOTTLENECKS[category].includes(bottleneck.kind) ? 34 : 0;
    const textMatch = overlapScore(text, bottleneck);
    const score = kindMatch + textMatch + severityBoost(bottleneck) + confidenceBoost(bottleneck) + Math.max(0, 8 - index);
    if (kindMatch > 0 || textMatch >= 8) {
      matchedBottleneckIds.push(bottleneck.id);
      bestScore = Math.max(bestScore, score);
    }
  }

  return { score: bestScore, matchedBottleneckIds };
}

function selectCategory(category: ActivationCategory, items: any[], limit: number, bottlenecks: Bottleneck[]) {
  const relevantBottlenecks = bottlenecks.filter((bottleneck) => CATEGORY_BOTTLENECKS[category].includes(bottleneck.kind));
  const candidates = asArray(items).map((raw, index) => {
    const scored = scoreCandidate(category, raw, index, bottlenecks);
    const candidate: ActivationCandidate = {
      category,
      label: candidateLabel(category, raw),
      detail: compact(candidateText(category, raw)),
      item: raw,
      score: scored.score,
      included: false,
      matchedBottleneckIds: scored.matchedBottleneckIds,
      reason: "",
    };
    candidate.reason = reasonFor(category, candidate);
    return candidate;
  }).filter((candidate) => candidate.label);

  const selected = candidates
    .filter((candidate) => candidate.matchedBottleneckIds.length > 0 && candidate.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (!selected.length && relevantBottlenecks.length && candidates.length && limit > 0) {
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

function limitsFromBottlenecks(architecture: CareerArchitecture, bottlenecks: Bottleneck[]) {
  const kinds = new Set(bottlenecks.map((bottleneck) => bottleneck.kind));
  return {
    roleExamples: kinds.has("information") || kinds.has("route_clarity") || kinds.has("market_signal") ? Math.max(architecture.activationLimits.roleExamples, 3) : Math.min(architecture.activationLimits.roleExamples, 2),
    learningResources: kinds.has("capability_depth") || kinds.has("credential") ? Math.max(architecture.activationLimits.learningResources, 3) : Math.min(architecture.activationLimits.learningResources, 1),
    networkTargets: kinds.has("access") || kinds.has("network") || kinds.has("information") ? Math.max(architecture.activationLimits.networkTargets, 3) : Math.min(architecture.activationLimits.networkTargets, 1),
    proofAssets: kinds.has("proof") || kinds.has("narrative") || kinds.has("market_signal") ? Math.max(architecture.activationLimits.proofAssets, 2) : Math.min(architecture.activationLimits.proofAssets, 1),
  };
}

export function buildBottleneckActivationPlan(brief: any, architecture: CareerArchitecture, diagnosis: BottleneckDiagnosis | null): BottleneckActivationPlan {
  const bottlenecks = bottlenecksFromDiagnosis(diagnosis);
  const limits = limitsFromBottlenecks(architecture, bottlenecks);
  const roles = selectCategory("roleExamples", brief.roleShapes, limits.roleExamples, bottlenecks);
  const learning = selectCategory("learningResources", brief.learningPaths, limits.learningResources, bottlenecks);
  const network = selectCategory("networkTargets", brief.networkArchetypes, limits.networkTargets, bottlenecks);
  const proof = selectCategory("proofAssets", brief.proofAssetIdeas, limits.proofAssets, bottlenecks);

  return {
    mode: "bottleneck_driven_activation",
    principle: "Activate execution objects only when they resolve a diagnosed bottleneck hypothesis. Limits are clutter guards, not the decision rule.",
    limits,
    bottlenecks: bottlenecks.map((bottleneck) => ({
      id: bottleneck.id,
      label: bottleneck.label,
      kind: bottleneck.kind,
      route: bottleneck.route,
      score: Math.round(bottleneck.score || 0),
      recommendedBet: bottleneck.recommendedBet,
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

export function applyBottleneckActivationFilter(brief: any, architecture: CareerArchitecture, diagnosis: BottleneckDiagnosis | null) {
  const activationPlan = buildBottleneckActivationPlan(brief, architecture, diagnosis);
  return {
    ...brief,
    roleShapes: activationPlan.selected.roleExamples.map((candidate) => candidate.item),
    learningPaths: activationPlan.selected.learningResources.map((candidate) => candidate.item),
    networkArchetypes: activationPlan.selected.networkTargets.map((candidate) => candidate.item),
    proofAssetIdeas: activationPlan.selected.proofAssets.map((candidate) => candidate.item),
    activationPlan,
  };
}
