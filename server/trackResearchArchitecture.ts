type SelectionStatus = "accepted" | "needs_evidence" | "parked" | "rejected";

type ArchitectureItem = {
  id: string;
  label: string;
  detail: string;
  sourceType: string;
  evidence?: string;
  status?: SelectionStatus;
  reason?: string;
};

type ArchitectureStage = {
  id: string;
  title: string;
  question: string;
  output: string;
  items: ArchitectureItem[];
};

export type CareerArchitecture = {
  principle: string;
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

function requirementItems(brief: any, type: string, values: unknown[]) {
  return takeItems(asArray(values).map((value, index) => item(`requirement-${type}`, index, value, `Required ${type} signal for this opportunity area.`, type)), 10);
}

function gapStatus(gap: any): SelectionStatus {
  const gapType = normalize(gap.capitalType || gap.gapType);
  const severity = normalize(gap.severity);
  if (gapType === "information" || gapType === "access") return "needs_evidence";
  if (severity === "low") return "parked";
  return "accepted";
}

function interventionStatus(intervention: any): SelectionStatus {
  const type = normalize(intervention.interventionType);
  if (type === "research" || type === "networking") return "needs_evidence";
  const priority = Number(intervention.priority || 3);
  return priority <= 3 ? "accepted" : "parked";
}

export function buildCareerArchitecture(track: any, brief: any, organizedWorkspace?: any): CareerArchitecture {
  const marketItems = takeItems([
    ...asArray(brief.sectorMap).map((sector: any, index: number) => item("market", index, sector.sector, sector.description, "market", asArray(sector.exampleOrgs).join(", "))),
    ...asArray(brief.pathHypotheses).map((path: any, index: number) => item("path", index, path.title, path.description || path.whyPromising, "path", asArray(path.testSignals).join("; "))),
  ], 12);

  const roleItems = takeItems(asArray(brief.roleShapes).map((role: any, index: number) => item("role", index, role.title, role.what, "role_family", asArray(role.typicalOrgs).join(", "))), 10);

  const requirementMap = brief.requirementMap || {};
  const requirementGraph = asArray(brief.requirementGraph);
  const requirementItemsByGraph = takeItems(requirementGraph.map((node: any, index: number) => item("requirement", index, node.requirement, node.path ? `Required for ${node.path}` : "Role-family requirement", node.capitalType || "requirement", node.evidence)), 18);
  const requirementFallback = [
    ...requirementItems(brief, "knowledge", requirementMap.knowledge),
    ...requirementItems(brief, "skill", requirementMap.capabilities),
    ...requirementItems(brief, "evidence", requirementMap.evidence),
    ...requirementItems(brief, "narrative", requirementMap.narrative),
  ];

  const assetItems = takeItems(asArray(brief.careerCapitalPortfolio).map((asset: any, index: number) => item("asset", index, asset.asset, `Current level: ${compact(asset.currentLevel) || "unknown"}. ${compact(asset.linkedPaths?.join(", "))}`, asset.capitalType || "asset", asset.evidence)), 14);

  const fitGapAssets = brief.fitGapMatrix || {};
  const inferredAssetItems = takeItems(Object.entries(fitGapAssets).flatMap(([dimension, value]: [string, any], index) => asArray(value?.strengths).map((strength: any, offset: number) => item("inferred-asset", index + offset, strength, `Inferred from ${dimension}. Treat as provisional unless backed by evidence.`, "provisional_asset", asArray(value?.evidenceNeeded).join("; ")))), 8);

  const gapItems = takeItems([
    ...asArray(brief.gapPortfolio).map((gap: any, index: number) => {
      const built = item("gap", index, gap.gap, gap.whyItMatters || gap.evidence, gap.capitalType || "gap", gap.evidence);
      if (!built) return null;
      const status = gapStatus(gap);
      return { ...built, status, reason: status === "needs_evidence" ? "Clarify this before committing heavy development effort." : status === "parked" ? "Low severity or low leverage for now." : "Important enough to feed the next plan." };
    }),
    ...asArray(brief.gapAnalysis?.gaps).map((gap: any, index: number) => item("gap-analysis", index, gap, "Gap inferred from the fit/gap matrix.", "gap")),
  ], 14);

  const interventionItems = takeItems(asArray(brief.interventionRecommendations).map((intervention: any, index: number) => {
    const built = item("intervention", index, intervention.recommendation, intervention.whyThis || intervention.output, intervention.interventionType || "intervention", intervention.assessmentCriteria);
    if (!built) return null;
    const status = interventionStatus(intervention);
    return { ...built, status, reason: status === "needs_evidence" ? "Use this to learn more before committing." : status === "parked" ? "Useful, but not first wave." : "High enough priority for the next plan." };
  }), 12);

  const developmentItems = takeItems(asArray(brief.developmentPlans).map((plan: any, index: number) => item("development", index, plan.title, plan.objective, plan.capitalType || "development_plan", [...asArray(plan.supportsPaths), ...asArray(plan.proofOutputs)].join("; "))), 10);

  const evidenceItems = takeItems([
    ...asArray(brief.evidenceLoops).map((loop: any, index: number) => item("evidence", index, loop.evidenceToCollect, loop.wouldIncreaseConfidence, "evidence_loop", loop.wouldDecreaseConfidence)),
    ...asArray(brief.trackHypotheses).map((hypothesis: any, index: number) => item("hypothesis", index, hypothesis.howToTest, hypothesis.hypothesis, "hypothesis_test", hypothesis.disconfirmingSignal)),
  ], 10).map((candidate) => ({ ...candidate, status: "needs_evidence" as SelectionStatus, reason: "This updates Anchor's belief without requiring a full commitment." }));

  const stages: ArchitectureStage[] = [
    {
      id: "opportunity_landscape",
      title: "Opportunity Landscape",
      question: "What does this area of interest actually contain?",
      output: "Pathways, submarkets, role families, and opportunity characteristics.",
      items: [...marketItems, ...roleItems],
    },
    {
      id: "requirements",
      title: "Requirements",
      question: "What does success require in each pathway?",
      output: "Knowledge, skill, evidence, network, credential, and narrative requirements.",
      items: requirementItemsByGraph.length ? requirementItemsByGraph : requirementFallback,
    },
    {
      id: "assets",
      title: "User Assets",
      question: "What assets already exist, and what evidence supports them?",
      output: "Experience, knowledge, skill, evidence, network, credential, and narrative assets.",
      items: assetItems.length ? assetItems : inferredAssetItems,
    },
    {
      id: "gaps",
      title: "Gap Analysis",
      question: "What is missing or still unknown?",
      output: "Information, knowledge, skill, evidence, network, credential, narrative, and access gaps.",
      items: gapItems,
    },
    {
      id: "interventions",
      title: "Best Interventions",
      question: "What is the best way to close each gap?",
      output: "Research, learning, practice, proof, conversations, qualifications, positioning, or access work.",
      items: interventionItems,
    },
    {
      id: "development_plans",
      title: "Development Plans",
      question: "How do we systematically build missing career capital?",
      output: "Asset development plans, not generic learning plans.",
      items: developmentItems,
    },
    {
      id: "evidence_updates",
      title: "Evidence And Updating",
      question: "What have we learned, and what should Anchor now believe?",
      output: "Evidence loops that update the landscape, requirements, assets, gaps, and plans.",
      items: evidenceItems,
    },
  ];

  const allItems = stages.flatMap((stage) => stage.items.map((candidate) => ({ ...candidate })));
  const accepted = allItems.filter((candidate) => candidate.status === "accepted").slice(0, 6);
  const needsEvidence = allItems.filter((candidate) => candidate.status === "needs_evidence").slice(0, 6);
  const parked = allItems.filter((candidate) => candidate.status === "parked").slice(0, 6);
  const rejected = allItems.filter((candidate) => candidate.status === "rejected").slice(0, 6);

  const reviewFromWorkspace = asArray(organizedWorkspace?.assessmentQueue).slice(0, 2).map((entry: any) => ({
    title: compact(entry.title),
    reason: compact(entry.action) || "Anchor thinks this could materially change the next plan.",
  })).filter((entry: any) => entry.title);

  const userReview = [
    ...reviewFromWorkspace,
    ...needsEvidence.slice(0, 3).map((entry) => ({ title: entry.label, reason: entry.reason || "This is still uncertain." })),
  ].slice(0, 3);

  return {
    principle: "Anchor should understand the landscape before building development plans, and should select interventions automatically unless a high-impact assumption needs review.",
    stages,
    automaticSelection: { accepted, needsEvidence, parked, rejected },
    userReview,
    activationLimits: {
      roleExamples: 3,
      learningResources: 3,
      networkTargets: 2,
      proofAssets: 2,
    },
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
