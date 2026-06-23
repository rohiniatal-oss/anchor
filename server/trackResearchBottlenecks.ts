import type { CareerArchitecture } from "./trackResearchArchitecture";

type RequirementLevel = "awareness" | "working" | "independent" | "advisory" | "expert" | "unknown";
type CoverageStatus = "covered" | "likely_covered" | "partial" | "unproven" | "insufficient" | "unknown_requirement";
type BottleneckKind = "route_clarity" | "information" | "capability_depth" | "proof" | "access" | "network" | "narrative" | "credential" | "market_signal";
type Confidence = "high" | "medium" | "low";

type RequirementClaim = {
  id: string;
  requirement: string;
  route: string;
  capitalType: string;
  likelyRequiredLevel: RequirementLevel;
  importance: "high" | "medium" | "low";
  evidence: string;
  confidence: Confidence;
};

type CoverageClaim = {
  requirementId: string;
  requirement: string;
  capitalType: string;
  likelyRequiredLevel: RequirementLevel;
  status: CoverageStatus;
  evidenceFound: string[];
  missingEvidence: string;
  confidence: Confidence;
  reasoning: string;
};

type BottleneckHypothesis = {
  id: string;
  route: string;
  kind: BottleneckKind;
  label: string;
  whyItMightBeTheBottleneck: string;
  confidence: Confidence;
  severity: "high" | "medium" | "low";
  evidenceToResolve: string;
  recommendedBet: string;
  score: number;
};

type RouteDiagnosis = {
  id: string;
  route: string;
  routeEvidence: string;
  requirementClaims: RequirementClaim[];
  coverageClaims: CoverageClaim[];
  bottleneckHypotheses: BottleneckHypothesis[];
  summary: string;
};

export type BottleneckDiagnosis = {
  mode: "route_bottleneck_diagnosis";
  principle: string;
  target: {
    label: string;
    assumption: string;
  };
  routes: RouteDiagnosis[];
  crossRouteBottlenecks: BottleneckHypothesis[];
  userReview: Array<{ title: string; reason: string }>;
  generatedAt: number;
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

function idFor(prefix: string, label: string, index: number) {
  return `${prefix}-${normalize(label).replace(/\s+/g, "-").slice(0, 72) || index}`;
}

function overlapScore(left: unknown, right: unknown) {
  const leftWords = new Set(words(left));
  if (!leftWords.size) return 0;
  return words(right).filter((word) => leftWords.has(word)).length;
}

function confidenceFromScore(score: number): Confidence {
  if (score >= 8) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function severityFromScore(score: number): BottleneckHypothesis["severity"] {
  if (score >= 32) return "high";
  if (score >= 22) return "medium";
  return "low";
}

function inferCapitalType(value: unknown) {
  const text = normalize(value);
  if (text.includes("credential") || text.includes("degree") || text.includes("certification") || text.includes("clearance")) return "credential";
  if (text.includes("access") || text.includes("referral") || text.includes("introduction") || text.includes("entry point")) return "access";
  if (text.includes("network") || text.includes("relationship") || text.includes("conversation")) return "network";
  if (text.includes("evidence") || text.includes("proof") || text.includes("publication") || text.includes("portfolio") || text.includes("memo")) return "evidence";
  if (text.includes("narrative") || text.includes("positioning") || text.includes("story")) return "narrative";
  if (text.includes("knowledge") || text.includes("domain") || text.includes("sector") || text.includes("economy")) return "knowledge";
  if (text.includes("skill") || text.includes("analysis") || text.includes("writing") || text.includes("forecast") || text.includes("strategy")) return "skill";
  return "other";
}

function inferLevel(requirement: unknown, route: unknown): RequirementLevel {
  const text = normalize(`${requirement} ${route}`);
  if (text.includes("expert") || text.includes("recognized") || text.includes("specialist")) return "expert";
  if (text.includes("advise") || text.includes("advisory") || text.includes("senior") || text.includes("lead") || text.includes("executive")) return "advisory";
  if (text.includes("own") || text.includes("independent") || text.includes("publish") || text.includes("client") || text.includes("brief")) return "independent";
  if (text.includes("working") || text.includes("apply") || text.includes("use")) return "working";
  return "unknown";
}

function importanceForRequirement(requirement: unknown, route: unknown): "high" | "medium" | "low" {
  const text = normalize(`${requirement} ${route}`);
  if (text.includes("required") || text.includes("core") || text.includes("must") || text.includes("lead") || text.includes("client")) return "high";
  if (text.includes("preferred") || text.includes("helpful") || text.includes("adjacent")) return "low";
  return "medium";
}

function routesFromBrief(brief: any) {
  const fromPaths = asArray(brief.pathHypotheses).map((path: any, index) => ({
    id: idFor("route", path.title || path.path || path.name, index),
    route: compact(path.title || path.path || path.name),
    routeEvidence: compact(path.description || path.whyPromising || asArray(path.testSignals).join("; ")),
  })).filter((route) => route.route);
  if (fromPaths.length) return fromPaths.slice(0, 6);

  const fromRoles = asArray(brief.roleShapes).map((role: any, index) => ({
    id: idFor("route", role.title, index),
    route: compact(role.title),
    routeEvidence: compact(`${role.what} ${asArray(role.typicalOrgs).join(", ")}`),
  })).filter((route) => route.route);
  if (fromRoles.length) return fromRoles.slice(0, 6);

  const label = compact(brief.targetRoleArchetype) || compact(brief.trackName) || compact(brief.domain) || "Chosen target";
  return [{ id: idFor("route", label, 0), route: label, routeEvidence: compact(brief.summary) }];
}

function fallbackRequirements(brief: any, route: string): RequirementClaim[] {
  const requirementMap = brief.requirementMap || {};
  const entries = [
    ...asArray(requirementMap.knowledge).map((requirement) => ({ requirement, capitalType: "knowledge" })),
    ...asArray(requirementMap.capabilities).map((requirement) => ({ requirement, capitalType: "skill" })),
    ...asArray(requirementMap.evidence).map((requirement) => ({ requirement, capitalType: "evidence" })),
    ...asArray(requirementMap.narrative).map((requirement) => ({ requirement, capitalType: "narrative" })),
  ];

  return entries.map((entry, index) => ({
    id: idFor("requirement", `${route}-${entry.requirement}`, index),
    requirement: compact(entry.requirement),
    route,
    capitalType: entry.capitalType,
    likelyRequiredLevel: inferLevel(entry.requirement, route),
    importance: importanceForRequirement(entry.requirement, route),
    evidence: "Requirement inferred from the shared target requirement map, not a route-specific source.",
    confidence: "low" as Confidence,
  })).filter((claim) => claim.requirement).slice(0, 10);
}

function requirementsForRoute(brief: any, route: string): RequirementClaim[] {
  const graph = asArray(brief.requirementGraph);
  const routeSpecific = graph.filter((node: any) => {
    const nodeRoute = compact(node.path || node.route || node.roleFamily || "");
    return !nodeRoute || normalize(nodeRoute).includes(normalize(route)) || normalize(route).includes(normalize(nodeRoute));
  }).map((node: any, index) => {
    const requirement = compact(node.requirement || node.capability || node.knowledge || node.signal);
    const sourceText = compact(`${node.evidence || ""} ${node.sourceTitle || ""}`);
    const sourceScore = sourceText ? 5 : 1;
    return {
      id: idFor("requirement", `${route}-${requirement}`, index),
      requirement,
      route,
      capitalType: compact(node.capitalType) || inferCapitalType(requirement),
      likelyRequiredLevel: inferLevel(requirement, route),
      importance: importanceForRequirement(`${node.importance || ""} ${requirement}`, route),
      evidence: sourceText || "Requirement inferred from the researched requirement graph.",
      confidence: confidenceFromScore(sourceScore + overlapScore(route, node.path || node.route || "")),
    };
  }).filter((claim) => claim.requirement);

  return routeSpecific.length ? routeSpecific.slice(0, 12) : fallbackRequirements(brief, route);
}

function assetEvidence(brief: any) {
  const capital = asArray(brief.careerCapitalPortfolio).map((asset: any) => ({
    label: compact(asset.asset),
    capitalType: compact(asset.capitalType) || inferCapitalType(asset.asset),
    evidence: compact(asset.evidence || asset.currentLevel || asArray(asset.linkedPaths).join(", ")),
  })).filter((asset) => asset.label || asset.evidence);

  const fitGap = brief.fitGapMatrix || {};
  const inferred = Object.entries(fitGap).flatMap(([dimension, value]: [string, any]) => asArray(value?.strengths).map((strength: any) => ({
    label: compact(strength),
    capitalType: inferCapitalType(`${dimension} ${strength}`),
    evidence: `Inferred from ${dimension}; treat as provisional unless backed by a concrete artifact or outcome.`,
  })));

  return [...capital, ...inferred];
}

function explicitGapEvidence(brief: any) {
  return [
    ...asArray(brief.gapPortfolio).map((gap: any) => ({
      label: compact(gap.gap),
      capitalType: compact(gap.capitalType) || inferCapitalType(gap.gap),
      evidence: compact(gap.evidence || gap.whyItMatters),
    })),
    ...asArray(brief.gapAnalysis?.gaps).map((gap: any) => ({
      label: compact(gap),
      capitalType: inferCapitalType(gap),
      evidence: "Inferred from the fit/gap matrix.",
    })),
  ].filter((gap) => gap.label);
}

function coverageForRequirement(requirement: RequirementClaim, brief: any): CoverageClaim {
  const assets = assetEvidence(brief);
  const gaps = explicitGapEvidence(brief);
  const requirementText = `${requirement.requirement} ${requirement.capitalType}`;

  const matchingAssets = assets
    .map((asset) => ({
      ...asset,
      score: overlapScore(requirementText, `${asset.label} ${asset.evidence}`) + (asset.capitalType === requirement.capitalType ? 3 : 0),
    }))
    .filter((asset) => asset.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const matchingGaps = gaps
    .map((gap) => ({
      ...gap,
      score: overlapScore(requirementText, `${gap.label} ${gap.evidence}`) + (gap.capitalType === requirement.capitalType ? 3 : 0),
    }))
    .filter((gap) => gap.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const bestAsset = matchingAssets[0]?.score || 0;
  const bestGap = matchingGaps[0]?.score || 0;
  let status: CoverageStatus = "unproven";

  if (bestGap >= 7 && bestGap >= bestAsset) status = "insufficient";
  else if (bestAsset >= 10 && bestGap < 7) status = "likely_covered";
  else if (bestAsset >= 5) status = "partial";
  else if (bestGap >= 4) status = "insufficient";
  else if (requirement.confidence === "low" && requirement.likelyRequiredLevel === "unknown") status = "unknown_requirement";

  const confidence = confidenceFromScore(bestAsset + bestGap + (requirement.confidence === "high" ? 3 : requirement.confidence === "medium" ? 1 : 0));
  const evidenceFound = matchingAssets.map((asset) => `${asset.label}${asset.evidence ? ` - ${asset.evidence}` : ""}`);

  return {
    requirementId: requirement.id,
    requirement: requirement.requirement,
    capitalType: requirement.capitalType,
    likelyRequiredLevel: requirement.likelyRequiredLevel,
    status,
    evidenceFound,
    missingEvidence: status === "likely_covered" ? "Package existing evidence clearly for this route." : `Need stronger evidence that ${requirement.requirement} is met at ${requirement.likelyRequiredLevel} level for this route.`,
    confidence,
    reasoning: matchingGaps.length
      ? `Research already flags a related gap: ${matchingGaps.map((gap) => gap.label).join("; ")}.`
      : evidenceFound.length
        ? "There is adjacent evidence, but Anchor should avoid assuming it fully meets the route-specific bar."
        : "Anchor has not found enough evidence to distinguish missing capability from missing proof.",
  };
}

function kindForCoverage(claim: CoverageClaim): BottleneckKind {
  if (claim.status === "unknown_requirement") return "information";
  if (claim.capitalType === "access") return "access";
  if (claim.capitalType === "network") return "network";
  if (claim.capitalType === "credential") return "credential";
  if (claim.capitalType === "narrative") return "narrative";
  if (claim.capitalType === "evidence") return "proof";
  if (claim.status === "unproven") return "proof";
  if (claim.capitalType === "knowledge" || claim.capitalType === "skill") return "capability_depth";
  return "market_signal";
}

function recommendedBet(kind: BottleneckKind, claim: CoverageClaim) {
  if (kind === "information") return `Clarify the real bar for ${claim.requirement} by reviewing target roles or speaking to practitioners.`;
  if (kind === "access") return `Map the warm-introduction, referral, or entry route needed to get access for ${claim.requirement}.`;
  if (kind === "network") return `Find practitioners who can explain how ${claim.requirement} is assessed in practice.`;
  if (kind === "credential") return `Check whether ${claim.requirement} is genuinely required or only a preference before pursuing a credential.`;
  if (kind === "narrative") return `Build positioning that connects existing experience to ${claim.requirement}.`;
  if (kind === "proof") return `Create or package a concrete artifact that proves ${claim.requirement}.`;
  if (kind === "capability_depth") return `Use a small project or practice loop to test whether ${claim.requirement} is at the needed level.`;
  return `Collect market evidence that shows whether ${claim.requirement} matters for this route.`;
}

function bottlenecksForRoute(route: string, coverageClaims: CoverageClaim[]): BottleneckHypothesis[] {
  return coverageClaims
    .filter((claim) => claim.status !== "covered" && claim.status !== "likely_covered")
    .map((claim, index) => {
      const kind = kindForCoverage(claim);
      const statusBoost = claim.status === "insufficient" ? 28 : claim.status === "unproven" ? 22 : claim.status === "unknown_requirement" ? 18 : 14;
      const confidenceBoost = claim.confidence === "high" ? 8 : claim.confidence === "medium" ? 4 : 0;
      const score = statusBoost + confidenceBoost + Math.max(0, 8 - index);
      return {
        id: idFor("bottleneck", `${route}-${kind}-${claim.requirement}`, index),
        route,
        kind,
        label: `${claim.requirement}: ${claim.status.replace(/_/g, " ")}`,
        whyItMightBeTheBottleneck: claim.reasoning,
        confidence: claim.confidence,
        severity: severityFromScore(score),
        evidenceToResolve: claim.missingEvidence,
        recommendedBet: recommendedBet(kind, claim),
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function summarizeRoute(route: string, bottlenecks: BottleneckHypothesis[]) {
  if (!bottlenecks.length) return `${route} has no obvious bottleneck from current evidence, but Anchor should still verify the route-specific bar.`;
  const top = bottlenecks[0];
  return `${route}'s likely bottleneck is ${top.kind.replace(/_/g, " ")}: ${top.label}. Confidence is ${top.confidence}.`;
}

function crossRouteBottlenecks(routes: RouteDiagnosis[]) {
  const grouped = new Map<BottleneckKind, BottleneckHypothesis[]>();
  for (const route of routes) {
    for (const bottleneck of route.bottleneckHypotheses) {
      const existing = grouped.get(bottleneck.kind) || [];
      existing.push(bottleneck);
      grouped.set(bottleneck.kind, existing);
    }
  }

  return Array.from(grouped.entries()).map(([kind, entries], index) => {
    const score = entries.reduce((sum, entry) => sum + entry.score, 0) + entries.length * 8;
    const top = entries.sort((a, b) => b.score - a.score)[0];
    return {
      id: idFor("cross-route-bottleneck", kind, index),
      route: "Multiple routes",
      kind,
      label: `${kind.replace(/_/g, " ")} across ${entries.length} route${entries.length === 1 ? "" : "s"}`,
      whyItMightBeTheBottleneck: `This appears repeatedly across route diagnoses, including: ${entries.slice(0, 3).map((entry) => entry.route).join(", ")}.`,
      confidence: entries.length >= 3 ? "high" as Confidence : entries.length === 2 ? "medium" as Confidence : top.confidence,
      severity: severityFromScore(score),
      evidenceToResolve: top.evidenceToResolve,
      recommendedBet: top.recommendedBet,
      score,
    };
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}

export function buildBottleneckDiagnosis(track: any, brief: any, architecture?: CareerArchitecture | null): BottleneckDiagnosis {
  const targetLabel = compact(architecture?.target?.label) || compact(brief.careerHypothesis?.normalizedTitle) || compact(brief.trackName) || compact(track?.name) || compact(brief.domain) || "Chosen target";
  const routes = routesFromBrief(brief).map((route) => {
    const requirementClaims = requirementsForRoute(brief, route.route);
    const coverageClaims = requirementClaims.map((claim) => coverageForRequirement(claim, brief));
    const bottleneckHypotheses = bottlenecksForRoute(route.route, coverageClaims);
    return {
      ...route,
      requirementClaims,
      coverageClaims,
      bottleneckHypotheses,
      summary: summarizeRoute(route.route, bottleneckHypotheses),
    };
  });
  const crossRoute = crossRouteBottlenecks(routes);
  const userReview = crossRoute.slice(0, 3).map((bottleneck) => ({
    title: bottleneck.label,
    reason: `${bottleneck.whyItMightBeTheBottleneck} Recommended bet: ${bottleneck.recommendedBet}`,
  }));

  return {
    mode: "route_bottleneck_diagnosis",
    principle: "Anchor should not treat gaps as facts. It should form route-specific bottleneck hypotheses from target requirements, evidence-backed user assets, missing proof, and uncertainty about required levels.",
    target: {
      label: targetLabel,
      assumption: "The direction is chosen; diagnosis focuses on what most likely blocks competitiveness, not whether the user should care about the target.",
    },
    routes,
    crossRouteBottlenecks: crossRoute,
    userReview,
    generatedAt: Date.now(),
  };
}
