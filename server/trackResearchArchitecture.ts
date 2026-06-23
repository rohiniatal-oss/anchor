type SelectionStatus = "accepted" | "needs_evidence" | "parked" | "rejected";
type GapKind = "information" | "knowledge" | "skill" | "evidence" | "network" | "access" | "credential" | "narrative" | "reputation" | "other";

type ArchitectureItem = {
  id: string;
  label: string;
  detail: string;
  sourceType: string;
  evidence?: string;
  status?: SelectionStatus;
  reason?: string;
  score?: number;
  gapKind?: GapKind;
};

type ArchitectureStage = {
  id: string;
  title: string;
  question: string;
  output: string;
  items: ArchitectureItem[];
};

export type CareerArchitecture = {
  mode: "chosen_target_development";
  principle: string;
  target: {
    label: string;
    assumption: string;
  };
  stages: ArchitectureStage[];
  automaticSelection: {
    accepted: ArchitectureItem[];
    needsEvidence: ArchitectureItem[];
    parked: ArchitectureItem[];
    rejected: ArchitectureItem[];
  };
  userReview: Array<{ title: string; reason: string }>;
  activationLimits: {
    roleExamples: number;
    learningResources: number;
    networkTargets: number;
    proofAssets: number;
  };
  activationLogic: string[];
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

function idFor(prefix: string, label: string, index: number) {
  return `${prefix}-${normalize(label).replace(/\s+/g, "-").slice(0, 80) || index}`;
}

function item(prefix: string, index: number, label: unknown, detail: unknown, sourceType: string, evidence?: unknown): ArchitectureItem | null {
  const cleanLabel = compact(label);
  if (!cleanLabel) return null;
  return {
    id: idFor(prefix, cleanLabel, index),
    label: cleanLabel,
    detail: compact(detail),
    sourceType,
    evidence: compact(evidence),
  };
}

function takeItems(items: Array<ArchitectureItem | null>, max = 12): ArchitectureItem[] {
  const seen = new Set<string>();
  const result: ArchitectureItem[] = [];
  for (const candidate of items) {
    if (!candidate) continue;
    const key = `${candidate.sourceType}:${normalize(candidate.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length >= max) break;
  }
  return result;
}

function inferGapKind(value: unknown): GapKind {
  const normalized = normalize(value);
  if (normalized.includes("information") || normalized.includes("market") || normalized.includes("role landscape")) return "information";
  if (normalized.includes("knowledge") || normalized.includes("domain")) return "knowledge";
  if (normalized.includes("skill") || normalized.includes("capability") || normalized.includes("practice")) return "skill";
  if (normalized.includes("evidence") || normalized.includes("proof") || normalized.includes("publication") || normalized.includes("portfolio")) return "evidence";
  if (normalized.includes("network") || normalized.includes("relationship") || normalized.includes("conversation")) return "network";
  if (normalized.includes("access") || normalized.includes("referral") || normalized.includes("introduction")) return "access";
  if (normalized.includes("credential") || normalized.includes("degree") || normalized.includes("certificate")) return "credential";
  if (normalized.includes("narrative") || normalized.includes("positioning") || normalized.includes("story")) return "narrative";
  if (normalized.includes("reputation")) return "reputation";
  return "other";
}

function requirementItems(type: string, values: unknown[]) {
  return takeItems(asArray(values).map((value, index) => item(`requirement-${type}`, index, value, `Required ${type} signal for the chosen target.`, type)), 10);
}

function severityScore(value: unknown) {
  const severity = normalize(value);
  if (severity === "high") return 40;
  if (severity === "medium") return 25;
  if (severity === "low") return 10;
  return 20;
}

function gapPriorityScore(gap: any, index: number) {
  const kind = inferGapKind(gap.capitalType || gap.gapType || gap.gap);
  const dependencyBoost = kind === "information" || kind === "access" ? 14 : 0;
  const proofBoost = kind === "evidence" || kind === "narrative" ? 10 : 0;
  const leverageBoost = Math.min(16, asArray(gap.linkedPaths).length * 4);
  return severityScore(gap.severity) + dependencyBoost + proofBoost + leverageBoost + Math.max(0, 8 - index);
}

function developmentStatus(candidate: ArchitectureItem, index: number): SelectionStatus {
  if (candidate.gapKind === "information" || candidate.gapKind === "access") return "needs_evidence";
  if ((candidate.score || 0) >= 35 || index < 3) return "accepted";
  if ((candidate.score || 0) < 18) return "parked";
  return "needs_evidence";
}

function activationLimitsFromPriorityGaps(priorityGaps: ArchitectureItem[]) {
  const kinds = new Set(priorityGaps.map((gap) => gap.gapKind));
  return {
    roleExamples: kinds.has("information") || kinds.has("access") ? 4 : 2,
    learningResources: kinds.has("knowledge") || kinds.has("skill") ? 4 : 1,
    networkTargets: kinds.has("network") || kinds.has("access") || kinds.has("information") ? 4 : 1,
    proofAssets: kinds.has("evidence") || kinds.has("narrative") ? 3 : 1,
  };
}

export function buildCareerArchitecture(track: any, brief: any, organizedWorkspace?: any): CareerArchitecture {
  const targetLabel = compact(brief.careerHypothesis?.normalizedTitle) || compact(brief.trackName) || compact(track?.name) || compact(brief.domain) || "Chosen target";
  const marketItems = takeItems([
    ...asArray(brief.sectorMap).map((sector: any, index: number) => item("market", index, sector.sector, sector.description, "market", asArray(sector.exampleOrgs).join(", "))),
    ...asArray(brief.pathHypotheses).map((path: any, index: number) => item("path", index, path.title, path.description || path.whyPromising, "target_path", asArray(path.testSignals).join("; "))),
  ], 12);

  const roleItems = takeItems(asArray(brief.roleShapes).map((role: any, index: number) => item("role", index, role.title, role.what, "role_family", asArray(role.typicalOrgs).join(", "))), 10);

  const requirementMap = brief.requirementMap || {};
  const requirementGraph = asArray(brief.requirementGraph);
  const requirementItemsByGraph = takeItems(requirementGraph.map((node: any, index: number) => item("requirement", index, node.requirement, node.path ? `Required for ${node.path}` : "Requirement for the chosen target.", node.capitalType || "requirement", node.evidence)), 18);
  const requirementFallback = [
    ...requirementItems("knowledge", requirementMap.knowledge),
    ...requirementItems("skill", requirementMap.capabilities),
    ...requirementItems("evidence", requirementMap.evidence),
    ...requirementItems("narrative", requirementMap.narrative),
  ];
  const targetRequirements = requirementItemsByGraph.length ? requirementItemsByGraph : requirementFallback;

  const assetItems = takeItems(asArray(brief.careerCapitalPortfolio).map((asset: any, index: number) => item("asset", index, asset.asset, `Current level: ${compact(asset.currentLevel) || "unknown"}. ${compact(asset.linkedPaths?.join(", "))}`, asset.capitalType || "asset", asset.evidence)), 14);

  const fitGapAssets = brief.fitGapMatrix || {};
  const inferredAssetItems = takeItems(Object.entries(fitGapAssets).flatMap(([dimension, value]: [string, any], index) => asArray(value?.strengths).map((strength: any, offset: number) => item("inferred-asset", index + offset, strength, `Inferred from ${dimension}. Treat as provisional unless backed by evidence.`, "provisional_asset", asArray(value?.evidenceNeeded).join("; ")))), 8);
  const currentAssets = assetItems.length ? assetItems : inferredAssetItems;

  const explicitGaps = asArray(brief.gapPortfolio).map((gap: any, index: number) => {
    const built = item("gap", index, gap.gap, gap.whyItMatters || gap.evidence, gap.capitalType || "gap", gap.evidence);
    if (!built) return null;
    const gapKind = inferGapKind(gap.capitalType || gap.gap);
    const score = gapPriorityScore(gap, index);
    return {
      ...built,
      gapKind,
      score,
      status: developmentStatus({ ...built, gapKind, score }, index),
      reason: "Priority is based on severity, dependency value, leverage across paths, and whether this gap blocks competitiveness for the chosen target.",
    };
  });
  const fallbackGaps = asArray(brief.gapAnalysis?.gaps).map((gap: any, index: number) => {
    const built = item("gap-analysis", index, gap, "Gap inferred from the fit/gap matrix.", inferGapKind(gap));
    if (!built) return null;
    const gapKind = inferGapKind(gap);
    const score = 20 + Math.max(0, 8 - index);
    return { ...built, gapKind, score, status: developmentStatus({ ...built, gapKind, score }, index), reason: "Inferred gap without detailed severity evidence yet." };
  });
  const allGaps = takeItems([...explicitGaps, ...fallbackGaps], 16).sort((a, b) => (b.score || 0) - (a.score || 0));
  const priorityGaps = allGaps.slice(0, 6).map((gap, index) => ({
    ...gap,
    status: developmentStatus(gap, index),
  }));

  const interventionItems = takeItems(asArray(brief.interventionRecommendations).map((intervention: any, index: number) => {
    const gapKind = inferGapKind(intervention.gapType || intervention.interventionType || intervention.gap);
    const built = item("intervention", index, intervention.recommendation, intervention.whyThis || intervention.output, intervention.interventionType || "intervention", intervention.assessmentCriteria);
    if (!built) return null;
    const matchesPriorityGap = priorityGaps.some((gap) => normalize(intervention.gap).includes(normalize(gap.label)) || normalize(gap.label).includes(normalize(intervention.gap)) || gap.gapKind === gapKind);
    const score = (matchesPriorityGap ? 30 : 12) + Math.max(0, 8 - Number(intervention.priority || index + 1));
    const status: SelectionStatus = score >= 30 ? "accepted" : gapKind === "information" || gapKind === "access" ? "needs_evidence" : "parked";
    return {
      ...built,
      gapKind,
      score,
      status,
      reason: status === "accepted" ? "This addresses one of the most blocking gaps for the chosen target." : status === "needs_evidence" ? "This should clarify the route before heavier development." : "Useful, but not first wave for competitiveness.",
    };
  }), 12);

  const developmentItems = takeItems(asArray(brief.developmentPlans).map((plan: any, index: number) => {
    const gapKind = inferGapKind(plan.capitalType || plan.title);
    const built = item("development", index, plan.title, plan.objective, plan.capitalType || "development_plan", [...asArray(plan.supportsPaths), ...asArray(plan.proofOutputs)].join("; "));
    if (!built) return null;
    const score = priorityGaps.some((gap) => gap.gapKind === gapKind) ? 34 : 18;
    return {
      ...built,
      gapKind,
      score,
      status: score >= 30 ? "accepted" as SelectionStatus : "parked" as SelectionStatus,
      reason: score >= 30 ? "This builds career capital against a priority gap." : "Keep as a later development option.",
    };
  }), 10);

  const evidenceItems = takeItems([
    ...asArray(brief.evidenceLoops).map((loop: any, index: number) => item("evidence", index, loop.evidenceToCollect, loop.wouldIncreaseConfidence, "evidence_loop", loop.wouldDecreaseConfidence)),
    ...asArray(brief.trackHypotheses).map((hypothesis: any, index: number) => item("hypothesis", index, hypothesis.howToTest, hypothesis.hypothesis, "hypothesis_test", hypothesis.disconfirmingSignal)),
    ...asArray(organizedWorkspace?.assessmentQueue).map((entry: any, index: number) => item("workspace-evidence", index, entry.title, entry.action, "evidence_update", entry.evidence)),
  ], 10).map((candidate) => ({
    ...candidate,
    status: "needs_evidence" as SelectionStatus,
    reason: "This gathers evidence needed to improve the competitiveness plan without questioning the chosen target.",
  }));

  const stages: ArchitectureStage[] = [
    {
      id: "target_state",
      title: "Target State",
      question: "Given the user has chosen this direction, what does success look like?",
      output: "A clear view of the market, role families, requirements, and success signals for the target.",
      items: [...marketItems, ...roleItems, ...targetRequirements.slice(0, 6)],
    },
    {
      id: "current_state",
      title: "Current State",
      question: "Where is the user today relative to that target?",
      output: "Evidence-backed assets, provisional assets, and unknowns.",
      items: currentAssets,
    },
    {
      id: "gap_analysis",
      title: "Gap Analysis",
      question: "What separates the current state from the target state?",
      output: "Knowledge, skill, evidence, network, access, credential, narrative, and information gaps.",
      items: allGaps,
    },
    {
      id: "gap_prioritization",
      title: "Gap Prioritization",
      question: "Which gaps are most blocking or highest leverage?",
      output: "A ranked set of priority gaps based on severity, dependency value, leverage, and evidence strength.",
      items: priorityGaps,
    },
    {
      id: "development_plan",
      title: "Development Plan",
      question: "What is the best way to close the priority gaps?",
      output: "Targeted interventions and asset-development plans, not a generic syllabus.",
      items: [...interventionItems, ...developmentItems],
    },
    {
      id: "evidence_updates",
      title: "Evidence Updates",
      question: "What evidence should update the plan as the user moves?",
      output: "Evidence loops that update requirements, assets, gap priorities, and development plans.",
      items: evidenceItems,
    },
  ];

  const allItems = stages.flatMap((stage) => stage.items.map((candidate) => ({ ...candidate })));
  const accepted = allItems.filter((candidate) => candidate.status === "accepted").slice(0, 8);
  const needsEvidence = allItems.filter((candidate) => candidate.status === "needs_evidence").slice(0, 8);
  const parked = allItems.filter((candidate) => candidate.status === "parked").slice(0, 8);
  const rejected = allItems.filter((candidate) => candidate.status === "rejected").slice(0, 8);

  const userReview = needsEvidence
    .filter((entry) => entry.gapKind === "information" || entry.gapKind === "access" || entry.sourceType.includes("evidence"))
    .slice(0, 3)
    .map((entry) => ({ title: entry.label, reason: entry.reason || "This evidence would materially improve the plan." }));

  const activationLimits = activationLimitsFromPriorityGaps(priorityGaps);

  return {
    mode: "chosen_target_development",
    principle: "The user has chosen the target; Anchor's job is to understand what success requires, map the user's current position, prioritize blocking gaps, and build the highest-leverage development plan.",
    target: {
      label: targetLabel,
      assumption: "Interest is assumed. Anchor should improve competitiveness for this target, not re-litigate whether the target is valid.",
    },
    stages,
    automaticSelection: { accepted, needsEvidence, parked, rejected },
    userReview,
    activationLimits,
    activationLogic: [
      "Materialize role examples when the target state or route is still under-specified.",
      "Materialize learning only when a priority knowledge or skill gap exists.",
      "Materialize network targets when information, network, or access gaps block progress.",
      "Materialize proof assets when evidence or narrative gaps block competitiveness.",
      "Use caps only as clutter guards; gap priority determines what gets created.",
    ],
    generatedAt: Date.now(),
  };
}

export function applyAutomaticActivationFilter(brief: any, architecture: CareerArchitecture) {
  const limits = architecture.activationLimits;
  return {
    ...brief,
    roleShapes: asArray(brief.roleShapes).slice(0, limits.roleExamples),
    learningPaths: asArray(brief.learningPaths).slice(0, limits.learningResources),
    networkArchetypes: asArray(brief.networkArchetypes).slice(0, limits.networkTargets),
    proofAssetIdeas: asArray(brief.proofAssetIdeas).slice(0, limits.proofAssets),
  };
}
