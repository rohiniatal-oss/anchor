import type { CareerTrack } from "@shared/schema";
import { llmJSON, MODEL_PRIMARY } from "./llm";
import { storage } from "./storage";
import { buildUserContext, formatContextForPrompt } from "./userContext";
import { materializeTrackResearch } from "./trackResearchAgent";

type ResearchUse = "market_map" | "role_map" | "requirements" | "learning" | "network" | "proof";
type SourceType = "job_posting" | "employer" | "institution" | "course" | "article" | "report" | "profile" | "other";
type CapitalType = "knowledge" | "skill" | "evidence" | "network" | "access" | "credential" | "narrative" | "reputation" | "information";
type InterventionType = "learning" | "practice" | "proof_asset" | "networking" | "positioning" | "research" | "application" | "credential";

type TrackResearchSearchPlan = {
  marketQueries: string[];
  roleQueries: string[];
  organizationQueries: string[];
  requirementQueries: string[];
  learningQueries: string[];
  networkQueries: string[];
  sourcePriorities: string[];
  ambiguityNotes: string[];
};

type EvidencePackItem = {
  sourceTitle: string;
  sourceUrl: string;
  sourceType: SourceType;
  claimSupported: string;
  usedFor: ResearchUse;
  confidence: "high" | "medium" | "low";
  whyReliable: string;
};

type FitGapDimension = {
  strengths: string[];
  gaps: string[];
  evidenceNeeded: string[];
};

type CareerHypothesis = {
  input: string;
  normalizedTitle: string;
  confidence: number;
  whyAttractive: string;
  coreUncertainties: string[];
};

type PathHypothesis = {
  title: string;
  description: string;
  confidence: number;
  capabilityFit: number;
  preferenceFit: number;
  accessFit: number;
  valuesFit: number;
  lifestyleFit: number;
  whyPromising: string;
  risks: string[];
  testSignals: string[];
};

type RequirementNode = {
  path: string;
  capitalType: CapitalType;
  requirement: string;
  evidence: string;
  priority: number;
};

type CareerCapitalItem = {
  capitalType: CapitalType;
  asset: string;
  currentLevel: "strong" | "partial" | "weak" | "unknown";
  evidence: string;
  linkedPaths: string[];
};

type GapItem = {
  gap: string;
  capitalType: CapitalType;
  severity: "high" | "medium" | "low";
  evidence: string;
  linkedPaths: string[];
  whyItMatters: string;
};

type InterventionRecommendation = {
  gap: string;
  gapType: CapitalType;
  interventionType: InterventionType;
  recommendation: string;
  whyThis: string;
  output: string;
  assessmentCriteria: string;
  priority: number;
};

type DevelopmentPlan = {
  title: string;
  capitalType: CapitalType;
  objective: string;
  supportsPaths: string[];
  resources: Array<{ title: string; type: string; why: string; url?: string }>;
  practice: string[];
  proofOutputs: string[];
  networkInputs: string[];
  milestones: Array<{ label: string; doneWhen: string }>;
  assessmentCriteria: string[];
  updateTriggers: string[];
};

type EvidenceLoop = {
  evidenceToCollect: string;
  wouldIncreaseConfidence: string;
  wouldDecreaseConfidence: string;
};

type StructuredTrackBrief = {
  domain: string;
  trackName: string;
  trackThesis: string;
  targetRoleArchetype: string;
  summary: string;
  careerHypothesis: CareerHypothesis;
  searchPlan: TrackResearchSearchPlan;
  evidencePack: EvidencePackItem[];
  researchEvidence: Array<{
    claim: string;
    sourceTitle: string;
    sourceUrl: string;
    usedFor: ResearchUse;
    confidence: "high" | "medium" | "low";
  }>;
  pathHypotheses: PathHypothesis[];
  trackHypotheses: Array<{
    hypothesis: string;
    whyItMightBeTrue: string;
    howToTest: string;
    disconfirmingSignal: string;
    priority: number;
  }>;
  sectorMap: Array<{ sector: string; description: string; exampleOrgs: string[] }>;
  roleShapes: Array<{ title: string; what: string; typicalOrgs: string[]; seniority: string }>;
  requirementMap: {
    capabilities: string[];
    knowledge: string[];
    evidence: string[];
    narrative: string[];
  };
  requirementGraph: RequirementNode[];
  careerCapitalPortfolio: CareerCapitalItem[];
  gapPortfolio: GapItem[];
  interventionRecommendations: InterventionRecommendation[];
  developmentPlans: DevelopmentPlan[];
  evidenceLoops: EvidenceLoop[];
  fitGapMatrix: {
    technicalOrDomainKnowledge: FitGapDimension;
    roleSpecificSkills: FitGapDimension;
    sectorCredibility: FitGapDimension;
    networkAccess: FitGapDimension;
    narrativeFit: FitGapDimension;
  };
  gapAnalysis: { strengths: string[]; gaps: string[]; biggestGap: string };
  learningPaths: Array<{
    topic: string;
    why: string;
    resourceType: string;
    suggestedResource: string;
    output: string;
  }>;
  networkArchetypes: Array<{ who: string; why: string; searchTip: string }>;
  proofAssetIdeas: Array<{ title: string; why: string; format: string; firstStep: string }>;
  plan: {
    horizon: string;
    logic: string;
    lanes: Array<{
      lane: "market_map" | "role_map" | "fit_map" | "capability_build" | "proof_build" | "network_map" | "experiments" | "positioning";
      objective: string;
      whyNow: string;
      workstreams: Array<{
        title: string;
        action: string;
        doneWhen: string;
        evidence: string;
        priority: number;
      }>;
    }>;
  };
};

type ResearchWorkspaceLane = "Hypotheses" | "Paths" | "Requirements" | "Career capital" | "Gaps" | "Interventions" | "Development plans" | "Evidence loops";

type TrackWorkspaceItem = {
  id: string;
  lane: ResearchWorkspaceLane;
  title: string;
  action: string;
  doneWhen: string;
  why: string;
  evidence: string;
  priority: number;
  sourceType: "career_hypothesis" | "path_hypothesis" | "requirement" | "capital" | "gap" | "intervention" | "development_plan" | "evidence_loop";
  savedIn: string;
  activationTarget: string;
};

export type TrackResearchWorkspace = {
  savedTo: Array<{
    label: string;
    storage: string;
    status: "stored_now" | "created_on_activation" | "derived_view";
    contains: string[];
  }>;
  sortingLogic: Array<{ rule: string; reason: string }>;
  lanes: Array<{
    lane: ResearchWorkspaceLane;
    purpose: string;
    savedIn: string;
    activationTarget: string;
    items: TrackWorkspaceItem[];
  }>;
  assessmentQueue: Array<TrackWorkspaceItem & { rank: number }>;
  priorityQueue: Array<TrackWorkspaceItem & { rank: number }>;
  organizedAt: number;
};

export type StructuredTrackResearchResult = {
  track: CareerTrack;
  brief: StructuredTrackBrief;
  organizedWorkspace: TrackResearchWorkspace;
  materialized: { trackId: number; jobIds: number[]; learnIds: number[]; contactIds: number[]; hustleIds: number[] } | null;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return normalize(value).replace(/\s+/g, "-").slice(0, 80) || "track";
}

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items.map(compact).filter(Boolean)) {
    const key = normalize(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function jsonObject(raw: string): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function evidenceItem(text: string) {
  return {
    text,
    source: "inferred" as const,
    confidence: "medium" as const,
    frequency: 1,
    sourceRoles: [] as string[],
  };
}

function boundedScore(value: unknown, fallback = 50) {
  const score = Number(value);
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeCapitalType(value: unknown): CapitalType {
  const normalized = normalize(value);
  if (normalized === "knowledge") return "knowledge";
  if (normalized === "skill" || normalized === "skills") return "skill";
  if (normalized === "evidence" || normalized === "proof") return "evidence";
  if (normalized === "network" || normalized === "relationships") return "network";
  if (normalized === "access" || normalized === "referral") return "access";
  if (normalized === "credential" || normalized === "credentials") return "credential";
  if (normalized === "narrative" || normalized === "positioning") return "narrative";
  if (normalized === "reputation") return "reputation";
  return "information";
}

function normalizeInterventionType(value: unknown): InterventionType {
  const normalized = normalize(value);
  if (normalized.includes("practice")) return "practice";
  if (normalized.includes("proof") || normalized.includes("project") || normalized.includes("publication")) return "proof_asset";
  if (normalized.includes("network") || normalized.includes("conversation") || normalized.includes("outreach")) return "networking";
  if (normalized.includes("position") || normalized.includes("narrative")) return "positioning";
  if (normalized.includes("research")) return "research";
  if (normalized.includes("application")) return "application";
  if (normalized.includes("credential") || normalized.includes("certificate")) return "credential";
  return "learning";
}

function severityScore(severity: string) {
  if (severity === "high") return 95;
  if (severity === "medium") return 75;
  return 55;
}

function fitGap(raw: FitGapDimension | undefined | null): FitGapDimension {
  return {
    strengths: uniqueStrings(asArray(raw?.strengths)),
    gaps: uniqueStrings(asArray(raw?.gaps)),
    evidenceNeeded: uniqueStrings(asArray(raw?.evidenceNeeded)),
  };
}

function normalizeSearchPlan(raw: TrackResearchSearchPlan | null | undefined): TrackResearchSearchPlan {
  return {
    marketQueries: uniqueStrings(asArray(raw?.marketQueries)).slice(0, 5),
    roleQueries: uniqueStrings(asArray(raw?.roleQueries)).slice(0, 5),
    organizationQueries: uniqueStrings(asArray(raw?.organizationQueries)).slice(0, 5),
    requirementQueries: uniqueStrings(asArray(raw?.requirementQueries)).slice(0, 5),
    learningQueries: uniqueStrings(asArray(raw?.learningQueries)).slice(0, 4),
    networkQueries: uniqueStrings(asArray(raw?.networkQueries)).slice(0, 4),
    sourcePriorities: uniqueStrings(asArray(raw?.sourcePriorities)).slice(0, 8),
    ambiguityNotes: uniqueStrings(asArray(raw?.ambiguityNotes)).slice(0, 6),
  };
}

function normalizeEvidence(raw: EvidencePackItem[] | null | undefined): EvidencePackItem[] {
  return asArray(raw).map((item) => ({
    sourceTitle: compact(item.sourceTitle),
    sourceUrl: compact(item.sourceUrl),
    sourceType: item.sourceType || "other",
    claimSupported: compact(item.claimSupported),
    usedFor: item.usedFor || "market_map",
    confidence: item.confidence || "medium",
    whyReliable: compact(item.whyReliable),
  })).filter((item) => item.sourceTitle && item.claimSupported).slice(0, 18);
}

function normalizeBrief(domain: string, raw: StructuredTrackBrief | null, searchPlan: TrackResearchSearchPlan, evidencePack: EvidencePackItem[]): StructuredTrackBrief | null {
  if (!raw || !compact(raw.summary)) return null;
  const trackName = compact(raw.trackName) || compact(raw.domain) || domain;
  const pathHypotheses = asArray(raw.pathHypotheses).map((path) => ({
    title: compact(path.title),
    description: compact(path.description),
    confidence: boundedScore(path.confidence, 50),
    capabilityFit: boundedScore(path.capabilityFit, 50),
    preferenceFit: boundedScore(path.preferenceFit, 50),
    accessFit: boundedScore(path.accessFit, 50),
    valuesFit: boundedScore(path.valuesFit, 50),
    lifestyleFit: boundedScore(path.lifestyleFit, 50),
    whyPromising: compact(path.whyPromising),
    risks: uniqueStrings(asArray(path.risks)),
    testSignals: uniqueStrings(asArray(path.testSignals)),
  })).filter((path) => path.title);
  const researchEvidence = asArray(raw.researchEvidence).map((e) => ({
    claim: compact(e.claim),
    sourceTitle: compact(e.sourceTitle),
    sourceUrl: compact(e.sourceUrl),
    usedFor: e.usedFor || "market_map",
    confidence: e.confidence || "medium",
  })).filter((e) => e.claim && e.sourceTitle);

  const requirementGraph = asArray(raw.requirementGraph).map((node) => ({
    path: compact(node.path),
    capitalType: normalizeCapitalType(node.capitalType),
    requirement: compact(node.requirement),
    evidence: compact(node.evidence),
    priority: Number.isFinite(Number(node.priority)) ? Number(node.priority) : 3,
  })).filter((node) => node.requirement);

  const careerCapitalPortfolio = asArray(raw.careerCapitalPortfolio).map((item) => ({
    capitalType: normalizeCapitalType(item.capitalType),
    asset: compact(item.asset),
    currentLevel: ["strong", "partial", "weak", "unknown"].includes(item.currentLevel) ? item.currentLevel : "unknown",
    evidence: compact(item.evidence),
    linkedPaths: uniqueStrings(asArray(item.linkedPaths)),
  })).filter((item) => item.asset);

  const gapPortfolio = asArray(raw.gapPortfolio).map((gap) => ({
    gap: compact(gap.gap),
    capitalType: normalizeCapitalType(gap.capitalType),
    severity: (gap.severity === "high" || gap.severity === "low"
      ? gap.severity
      : "medium") as GapItem["severity"],
    evidence: compact(gap.evidence),
    linkedPaths: uniqueStrings(asArray(gap.linkedPaths)),
    whyItMatters: compact(gap.whyItMatters),
  })).filter((gap) => gap.gap);

  const interventionRecommendations = asArray(raw.interventionRecommendations).map((intervention) => ({
    gap: compact(intervention.gap),
    gapType: normalizeCapitalType(intervention.gapType),
    interventionType: normalizeInterventionType(intervention.interventionType),
    recommendation: compact(intervention.recommendation),
    whyThis: compact(intervention.whyThis),
    output: compact(intervention.output),
    assessmentCriteria: compact(intervention.assessmentCriteria),
    priority: Number.isFinite(Number(intervention.priority)) ? Number(intervention.priority) : 3,
  })).filter((intervention) => intervention.recommendation);

  const developmentPlans = asArray(raw.developmentPlans).map((plan) => ({
    title: compact(plan.title),
    capitalType: normalizeCapitalType(plan.capitalType),
    objective: compact(plan.objective),
    supportsPaths: uniqueStrings(asArray(plan.supportsPaths)),
    resources: asArray(plan.resources).map((resource) => ({
      title: compact(resource.title),
      type: compact(resource.type) || "resource",
      why: compact(resource.why),
      url: compact(resource.url),
    })).filter((resource) => resource.title),
    practice: uniqueStrings(asArray(plan.practice)),
    proofOutputs: uniqueStrings(asArray(plan.proofOutputs)),
    networkInputs: uniqueStrings(asArray(plan.networkInputs)),
    milestones: asArray(plan.milestones).map((milestone) => ({
      label: compact(milestone.label),
      doneWhen: compact(milestone.doneWhen),
    })).filter((milestone) => milestone.label),
    assessmentCriteria: uniqueStrings(asArray(plan.assessmentCriteria)),
    updateTriggers: uniqueStrings(asArray(plan.updateTriggers)),
  })).filter((plan) => plan.title);

  const learningPaths = asArray(raw.learningPaths).map((p) => ({
    topic: compact(p.topic),
    why: compact(p.why),
    resourceType: compact(p.resourceType) || "resource",
    suggestedResource: compact(p.suggestedResource),
    output: compact(p.output),
  })).filter((p) => p.topic);
  const derivedLearningPaths = learningPaths.length ? learningPaths : developmentPlans
    .filter((plan) => plan.capitalType === "knowledge" || plan.resources.length)
    .map((plan) => ({
      topic: plan.title,
      why: plan.objective,
      resourceType: plan.resources[0]?.type || "resource",
      suggestedResource: plan.resources[0]?.title || "",
      output: plan.proofOutputs[0] || plan.milestones[0]?.doneWhen || `Reusable evidence for ${plan.title}`,
    }));

  return {
    domain: compact(raw.domain) || domain,
    trackName,
    trackThesis: compact(raw.trackThesis) || compact(raw.summary),
    targetRoleArchetype: compact(raw.targetRoleArchetype) || trackName,
    summary: compact(raw.summary),
    careerHypothesis: {
      input: compact(raw.careerHypothesis?.input) || domain,
      normalizedTitle: compact(raw.careerHypothesis?.normalizedTitle) || trackName,
      confidence: boundedScore(raw.careerHypothesis?.confidence, 50),
      whyAttractive: compact(raw.careerHypothesis?.whyAttractive) || compact(raw.trackThesis),
      coreUncertainties: uniqueStrings(asArray(raw.careerHypothesis?.coreUncertainties)),
    },
    searchPlan,
    evidencePack,
    researchEvidence: researchEvidence.length ? researchEvidence : evidencePack.map((e) => ({
      claim: e.claimSupported,
      sourceTitle: e.sourceTitle,
      sourceUrl: e.sourceUrl,
      usedFor: e.usedFor,
      confidence: e.confidence,
    })),
    pathHypotheses,
    trackHypotheses: asArray(raw.trackHypotheses).map((h) => ({
      hypothesis: compact(h.hypothesis),
      whyItMightBeTrue: compact(h.whyItMightBeTrue),
      howToTest: compact(h.howToTest),
      disconfirmingSignal: compact(h.disconfirmingSignal),
      priority: Number.isFinite(Number(h.priority)) ? Number(h.priority) : 3,
    })).filter((h) => h.hypothesis && h.howToTest),
    sectorMap: asArray(raw.sectorMap).map((s) => ({
      sector: compact(s.sector),
      description: compact(s.description),
      exampleOrgs: uniqueStrings(asArray(s.exampleOrgs)),
    })).filter((s) => s.sector),
    roleShapes: asArray(raw.roleShapes).map((r) => ({
      title: compact(r.title),
      what: compact(r.what),
      typicalOrgs: uniqueStrings(asArray(r.typicalOrgs)),
      seniority: compact(r.seniority) || "mixed",
    })).filter((r) => r.title),
    requirementMap: {
      capabilities: uniqueStrings(asArray(raw.requirementMap?.capabilities)),
      knowledge: uniqueStrings(asArray(raw.requirementMap?.knowledge)),
      evidence: uniqueStrings(asArray(raw.requirementMap?.evidence)),
      narrative: uniqueStrings(asArray(raw.requirementMap?.narrative)),
    },
    requirementGraph,
    careerCapitalPortfolio,
    gapPortfolio,
    interventionRecommendations,
    developmentPlans,
    evidenceLoops: asArray(raw.evidenceLoops).map((loop) => ({
      evidenceToCollect: compact(loop.evidenceToCollect),
      wouldIncreaseConfidence: compact(loop.wouldIncreaseConfidence),
      wouldDecreaseConfidence: compact(loop.wouldDecreaseConfidence),
    })).filter((loop) => loop.evidenceToCollect),
    fitGapMatrix: {
      technicalOrDomainKnowledge: fitGap(raw.fitGapMatrix?.technicalOrDomainKnowledge),
      roleSpecificSkills: fitGap(raw.fitGapMatrix?.roleSpecificSkills),
      sectorCredibility: fitGap(raw.fitGapMatrix?.sectorCredibility),
      networkAccess: fitGap(raw.fitGapMatrix?.networkAccess),
      narrativeFit: fitGap(raw.fitGapMatrix?.narrativeFit),
    },
    gapAnalysis: {
      strengths: uniqueStrings(asArray(raw.gapAnalysis?.strengths)),
      gaps: uniqueStrings(asArray(raw.gapAnalysis?.gaps)),
      biggestGap: compact(raw.gapAnalysis?.biggestGap),
    },
    learningPaths: derivedLearningPaths,
    networkArchetypes: asArray(raw.networkArchetypes).map((n) => ({
      who: compact(n.who),
      why: compact(n.why),
      searchTip: compact(n.searchTip),
    })).filter((n) => n.who),
    proofAssetIdeas: asArray(raw.proofAssetIdeas).map((p) => ({
      title: compact(p.title),
      why: compact(p.why),
      format: compact(p.format),
      firstStep: compact(p.firstStep),
    })).filter((p) => p.title),
    plan: {
      horizon: compact(raw.plan?.horizon) || "2-4 weeks",
      logic: compact(raw.plan?.logic) || "Build a career intelligence model before deciding which interventions to activate.",
      lanes: asArray(raw.plan?.lanes).map((lane) => ({
        lane: lane.lane,
        objective: compact(lane.objective),
        whyNow: compact(lane.whyNow),
        workstreams: asArray(lane.workstreams).map((w) => ({
          title: compact(w.title),
          action: compact(w.action),
          doneWhen: compact(w.doneWhen),
          evidence: compact(w.evidence),
          priority: Number.isFinite(Number(w.priority)) ? Number(w.priority) : 3,
        })).filter((w) => w.title && w.action),
      })).filter((lane) => lane.lane && lane.objective),
    },
  };
}

const workspaceLaneOrder: ResearchWorkspaceLane[] = ["Hypotheses", "Paths", "Requirements", "Career capital", "Gaps", "Interventions", "Development plans", "Evidence loops"];

const lanePurpose: Record<ResearchWorkspaceLane, string> = {
  Hypotheses: "Store the uncertain career direction and the beliefs Anchor needs to test.",
  Paths: "Compare possible futures inside the broad direction by capability, preference, access, values, and lifestyle fit.",
  Requirements: "Translate path evidence into what success requires across career capital types.",
  "Career capital": "Inventory what the user already has across knowledge, skill, evidence, network, access, credentials, narrative, and reputation.",
  Gaps: "Show the missing capital that limits attractive options.",
  Interventions: "Choose the best way to close each gap instead of assuming every gap needs learning.",
  "Development plans": "Create living plans that combine resources, practice, proof, network inputs, milestones, and assessment.",
  "Evidence loops": "Define what new evidence would update path confidence and plan priority.",
};

function priorityBoost(rawPriority: number | undefined) {
  const priority = Number.isFinite(Number(rawPriority)) ? Number(rawPriority) : 3;
  return Math.max(0, 6 - Math.max(1, Math.min(5, priority)));
}

function sortWorkspaceItems(items: TrackWorkspaceItem[]) {
  return [...items].sort((a, b) => {
    const priorityDiff = b.priority - a.priority;
    if (priorityDiff !== 0) return priorityDiff;
    return workspaceLaneOrder.indexOf(a.lane) - workspaceLaneOrder.indexOf(b.lane);
  });
}

function buildOrganizedTrackWorkspace(brief: StructuredTrackBrief): TrackResearchWorkspace {
  const laneBuckets: Record<ResearchWorkspaceLane, TrackWorkspaceItem[]> = {
    Hypotheses: [],
    Paths: [],
    Requirements: [],
    "Career capital": [],
    Gaps: [],
    Interventions: [],
    "Development plans": [],
    "Evidence loops": [],
  };

  const addItem = (item: Omit<TrackWorkspaceItem, "id">) => {
    const id = `${normalize(item.sourceType)}-${normalize(item.lane)}-${normalize(item.title)}`.replace(/\s+/g, "-").slice(0, 120);
    laneBuckets[item.lane].push({ id, ...item });
  };

  addItem({
    lane: "Hypotheses",
    title: brief.careerHypothesis.normalizedTitle,
    action: "Treat this as a career hypothesis to test, not a settled track or immediate execution plan.",
    doneWhen: "The hypothesis has enough market, fit, access, and preference evidence to be continued, narrowed, or deprioritized.",
    why: brief.careerHypothesis.whyAttractive,
    evidence: brief.careerHypothesis.coreUncertainties.join("; "),
    priority: 96,
    sourceType: "career_hypothesis",
    savedIn: "career_tracks.trackIntelligence.careerHypothesis",
    activationTarget: "track intelligence",
  });

  brief.pathHypotheses.slice(0, 8).forEach((path) => addItem({
    lane: "Paths",
    title: path.title,
    action: `Assess this path across capability, preference, access, values, and lifestyle fit before committing to interventions.`,
    doneWhen: "The path has been kept, narrowed, or deprioritized with explicit evidence.",
    why: path.whyPromising || path.description,
    evidence: [...path.testSignals, ...path.risks].join("; "),
    priority: 84 + Math.round(path.confidence / 10),
    sourceType: "path_hypothesis",
    savedIn: "career_tracks.trackIntelligence.pathHypotheses",
    activationTarget: "path assessment",
  }));

  brief.requirementGraph.slice(0, 12).forEach((node) => addItem({
    lane: "Requirements",
    title: node.requirement,
    action: `Map this ${node.capitalType} requirement to current capital and gaps.`,
    doneWhen: "The requirement is matched to an existing asset, gap, or unknown.",
    why: node.path ? `Required for ${node.path}` : "Repeated requirement in researched paths.",
    evidence: node.evidence,
    priority: 76 + priorityBoost(node.priority),
    sourceType: "requirement",
    savedIn: "career_tracks.trackIntelligence.requirementGraph",
    activationTarget: "requirement graph",
  }));

  brief.careerCapitalPortfolio.slice(0, 12).forEach((capital) => addItem({
    lane: "Career capital",
    title: capital.asset,
    action: `Use this as ${capital.capitalType} capital when assessing path fit and option value.`,
    doneWhen: "The asset has evidence and is linked to the paths it strengthens.",
    why: `Current level: ${capital.currentLevel}`,
    evidence: capital.evidence,
    priority: capital.currentLevel === "strong" ? 74 : capital.currentLevel === "partial" ? 70 : 60,
    sourceType: "capital",
    savedIn: "career_tracks.trackIntelligence.careerCapitalPortfolio",
    activationTarget: "career capital portfolio",
  }));

  brief.gapPortfolio.slice(0, 12).forEach((gap) => addItem({
    lane: "Gaps",
    title: gap.gap,
    action: `Classify this as a ${gap.capitalType} gap and select the best intervention.`,
    doneWhen: "The gap has an intervention, output, and assessment standard.",
    why: gap.whyItMatters,
    evidence: gap.evidence,
    priority: severityScore(gap.severity),
    sourceType: "gap",
    savedIn: "career_tracks.trackIntelligence.gapPortfolio",
    activationTarget: "intervention selection",
  }));

  brief.interventionRecommendations.slice(0, 12).forEach((intervention) => addItem({
    lane: "Interventions",
    title: intervention.recommendation,
    action: `Use ${intervention.interventionType} to address: ${intervention.gap}.`,
    doneWhen: intervention.assessmentCriteria,
    why: intervention.whyThis,
    evidence: intervention.output,
    priority: 80 + priorityBoost(intervention.priority),
    sourceType: "intervention",
    savedIn: "career_tracks.trackIntelligence.interventionRecommendations",
    activationTarget: intervention.interventionType,
  }));

  brief.developmentPlans.slice(0, 8).forEach((plan) => addItem({
    lane: "Development plans",
    title: plan.title,
    action: "Use this living development plan to combine resources, practice, proof, network inputs, and assessment.",
    doneWhen: plan.assessmentCriteria.join("; ") || "The capital has improved and reusable evidence exists.",
    why: plan.objective,
    evidence: [...plan.supportsPaths, ...plan.proofOutputs].join("; "),
    priority: 78,
    sourceType: "development_plan",
    savedIn: "career_tracks.trackIntelligence.developmentPlans",
    activationTarget: "development plan",
  }));

  brief.evidenceLoops.slice(0, 8).forEach((loop) => addItem({
    lane: "Evidence loops",
    title: loop.evidenceToCollect,
    action: "Collect this evidence before updating confidence or committing more resources.",
    doneWhen: "The evidence has updated at least one path, gap, intervention, or development plan.",
    why: loop.wouldIncreaseConfidence,
    evidence: loop.wouldDecreaseConfidence,
    priority: 72,
    sourceType: "evidence_loop",
    savedIn: "career_tracks.trackIntelligence.evidenceLoops",
    activationTarget: "evidence update",
  }));

  const lanes = workspaceLaneOrder.map((lane) => ({
    lane,
    purpose: lanePurpose[lane],
    savedIn: `career_tracks.trackIntelligence.${lane.replace(/\s+/g, "_").toLowerCase()}`,
    activationTarget: lane === "Interventions" ? "Selected execution objects later" : "Assessment layer",
    items: sortWorkspaceItems(laneBuckets[lane]),
  })).filter((lane) => lane.items.length > 0);

  const assessmentQueue = sortWorkspaceItems([
    ...laneBuckets.Paths,
    ...laneBuckets.Gaps,
    ...laneBuckets.Interventions,
    ...laneBuckets["Development plans"],
    ...laneBuckets["Evidence loops"],
  ]).slice(0, 12).map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    savedTo: [
      {
        label: "Career hypothesis dossier",
        storage: "career_tracks.trackIntelligence",
        status: "stored_now",
        contains: ["market evidence", "path hypotheses", "requirements", "fit and gaps", "career capital", "interventions", "development plans"],
      },
      {
        label: "Career capital portfolio",
        storage: "career_tracks.trackIntelligence.careerCapitalPortfolio",
        status: "stored_now",
        contains: ["knowledge", "skills", "evidence", "network", "access", "credentials", "narrative", "reputation"],
      },
      {
        label: "Gap portfolio",
        storage: "career_tracks.trackIntelligence.gapPortfolio",
        status: "stored_now",
        contains: ["gap type", "severity", "evidence", "linked paths", "why it matters"],
      },
      {
        label: "Intervention recommendations",
        storage: "career_tracks.trackIntelligence.interventionRecommendations",
        status: "stored_now",
        contains: ["learning", "practice", "proof", "network", "positioning", "research", "credential", "application"],
      },
      {
        label: "Development plans",
        storage: "career_tracks.trackIntelligence.developmentPlans",
        status: "stored_now",
        contains: ["resources", "practice", "proof outputs", "network inputs", "milestones", "assessment", "update triggers"],
      },
      {
        label: "Execution objects",
        storage: "jobs/learn/contacts/hustles only after activation",
        status: "created_on_activation",
        contains: ["selected roles", "knowledge resources", "network targets", "proof assets"],
      },
    ],
    sortingLogic: [
      { rule: "Research organizes the system", reason: "This stage creates the career intelligence model; it does not decide today's action." },
      { rule: "Paths stay hypotheses", reason: "Each path can rise or fall as evidence arrives." },
      { rule: "Gaps map to best interventions", reason: "Knowledge gaps may need learning, but evidence, network, access, and narrative gaps need different responses." },
      { rule: "Development plans are living career-capital plans", reason: "A plan can include resources, practice, proof outputs, network inputs, and assessment across multiple paths." },
    ],
    lanes,
    assessmentQueue,
    priorityQueue: assessmentQueue,
    organizedAt: Date.now(),
  };
}

async function buildResearchInputs() {
  const userContext = await buildUserContext();
  const contextText = formatContextForPrompt(userContext);
  const cv = userContext.cv?.trim() || "";
  const tracks = await storage.getCareerTracks();
  const activeTrackNames = tracks.filter((t) => t.status === "active").map((t) => t.name).slice(0, 6);
  const jobs = await storage.getJobs();
  const existingCompanies = uniqueStrings(jobs.map((j) => j.company).filter(Boolean)).slice(0, 12);
  const contacts = await storage.getContacts();
  const networks = uniqueStrings(contacts.map((c) => c.sourceNetwork).filter(Boolean)).slice(0, 12);
  return { contextText, cv, activeTrackNames, existingCompanies, networks };
}

async function generateSearchPlan(domain: string, inputs: Awaited<ReturnType<typeof buildResearchInputs>>): Promise<TrackResearchSearchPlan> {
  const prompt = `You are designing a search plan for Anchor's career intelligence agent.

AREA OF FOCUS: ${domain}
${inputs.activeTrackNames.length ? `EXISTING TRACKS: ${inputs.activeTrackNames.join(", ")}` : ""}
${inputs.existingCompanies.length ? `COMPANIES ALREADY SAVED: ${inputs.existingCompanies.join(", ")}` : ""}
${inputs.networks.length ? `KNOWN NETWORKS: ${inputs.networks.join(", ")}` : ""}

Create a MECE search plan. Do not answer the research question yet. Return ONLY JSON:
{
  "marketQueries": ["queries that define the market, sub-sectors, and adjacent paths"],
  "roleQueries": ["queries that find real role titles and role families"],
  "organizationQueries": ["queries that find employers and institutions"],
  "requirementQueries": ["queries that find job requirements from postings or careers pages"],
  "learningQueries": ["queries that find canonical resources, books, courses, reports, frameworks, or proof-building references"],
  "networkQueries": ["queries for finding people archetypes on LinkedIn or alumni networks"],
  "sourcePriorities": ["types of sources to prefer, in priority order"],
  "ambiguityNotes": ["different meanings this focus area could have and how the search should disambiguate"]
}

Rules:
- Include 3-5 queries per major bucket.
- Prefer queries likely to surface job postings, employer pages, credible institutions, current market language, and canonical learning sources.
- For broad terms, include adjacent terms and synonyms.`;

  const raw = await llmJSON<TrackResearchSearchPlan>(prompt, { model: MODEL_PRIMARY });
  return normalizeSearchPlan(raw);
}

async function gatherEvidencePack(domain: string, inputs: Awaited<ReturnType<typeof buildResearchInputs>>, searchPlan: TrackResearchSearchPlan): Promise<EvidencePackItem[]> {
  const prompt = `You are Anchor's evidence collection agent. Use web search to execute this search plan and build a compact evidence pack. Do not create the strategy plan yet.

AREA OF FOCUS: ${domain}

SEARCH PLAN:
${JSON.stringify(searchPlan, null, 2)}

USER CONTEXT SUMMARY:
${inputs.contextText}
${inputs.cv ? `CV EXCERPT:\n${inputs.cv.slice(0, 2200)}` : "NO CV PROVIDED."}

Return ONLY JSON array items with this shape:
[
  {
    "sourceTitle": "source title",
    "sourceUrl": "source URL if available",
    "sourceType": "job_posting|employer|institution|course|article|report|profile|other",
    "claimSupported": "specific claim this source supports",
    "usedFor": "market_map|role_map|requirements|learning|network|proof",
    "confidence": "high|medium|low",
    "whyReliable": "why this source should be trusted or how to interpret it"
  }
]

Evidence requirements:
- 10-15 total evidence items.
- At least 3 job posting or employer/careers-page items if available.
- At least 2 role/requirement evidence items.
- At least 2 market/sector/path evidence items.
- At least 1 canonical learning/proof-building evidence item.
- Prioritize current, primary, and employer/institutional sources over generic blogs.
- Do not invent URLs. If a URL is unavailable, leave sourceUrl empty and set confidence lower.`;

  const raw = await llmJSON<EvidencePackItem[]>(prompt, {
    model: MODEL_PRIMARY,
    tools: [{ type: "web_search_preview" }],
  });
  return normalizeEvidence(raw);
}

async function synthesizeBrief(domain: string, inputs: Awaited<ReturnType<typeof buildResearchInputs>>, searchPlan: TrackResearchSearchPlan, evidencePack: EvidencePackItem[]): Promise<StructuredTrackBrief | null> {
  const prompt = `You are Anchor's career intelligence synthesis agent. Build a career-capital model using ONLY the evidence pack, the search plan, and the user context below. Do not collapse this into a learning plan or a task list.

${inputs.contextText}

AREA OF FOCUS: ${domain}
${inputs.activeTrackNames.length ? `EXISTING TRACKS: ${inputs.activeTrackNames.join(", ")}` : ""}
${inputs.existingCompanies.length ? `COMPANIES ALREADY SAVED: ${inputs.existingCompanies.join(", ")}` : ""}
${inputs.networks.length ? `KNOWN NETWORKS: ${inputs.networks.join(", ")}` : ""}
${inputs.cv ? `CV EXCERPT:\n${inputs.cv.slice(0, 2600)}` : "NO CV PROVIDED - be explicit where fit/gap confidence is lower."}

SEARCH PLAN:
${JSON.stringify(searchPlan, null, 2)}

EVIDENCE PACK:
${JSON.stringify(evidencePack, null, 2)}

Return ONLY valid JSON with this exact shape:
{
  "domain": "${domain}",
  "trackName": "short label for this career hypothesis",
  "trackThesis": "why this direction could be attractive, with caveats",
  "targetRoleArchetype": "broad role family",
  "summary": "2-3 sentences on what this area means across the market now",
  "careerHypothesis": { "input": "${domain}", "normalizedTitle": "clean hypothesis title", "confidence": 45, "whyAttractive": "why it may increase attractive options", "coreUncertainties": ["unknowns to resolve"] },
  "researchEvidence": [{ "claim": "claim from evidence pack", "sourceTitle": "source title", "sourceUrl": "source URL", "usedFor": "market_map|role_map|requirements|learning|network|proof", "confidence": "high|medium|low" }],
  "pathHypotheses": [{ "title": "path name", "description": "what this path is", "confidence": 55, "capabilityFit": 60, "preferenceFit": 50, "accessFit": 45, "valuesFit": 60, "lifestyleFit": 50, "whyPromising": "why this path may fit", "risks": ["risks"], "testSignals": ["signals to collect"] }],
  "trackHypotheses": [{ "hypothesis": "testable belief", "whyItMightBeTrue": "why it may fit", "howToTest": "evidence to collect", "disconfirmingSignal": "what would deprioritize it", "priority": 1 }],
  "sectorMap": [{ "sector": "sector name", "description": "what work looks like here", "exampleOrgs": ["real org 1", "real org 2"] }],
  "roleShapes": [{ "title": "realistic job title", "what": "what this person does", "typicalOrgs": ["real org 1", "real org 2"], "seniority": "junior|mid|senior|mixed" }],
  "requirementMap": { "capabilities": [], "knowledge": [], "evidence": [], "narrative": [] },
  "requirementGraph": [{ "path": "path name", "capitalType": "knowledge|skill|evidence|network|access|credential|narrative|reputation|information", "requirement": "what success requires", "evidence": "source-backed reason", "priority": 1 }],
  "careerCapitalPortfolio": [{ "capitalType": "knowledge|skill|evidence|network|access|credential|narrative|reputation|information", "asset": "asset the user has or may have", "currentLevel": "strong|partial|weak|unknown", "evidence": "CV or context evidence", "linkedPaths": ["paths this supports"] }],
  "gapPortfolio": [{ "gap": "specific gap", "capitalType": "knowledge|skill|evidence|network|access|credential|narrative|reputation|information", "severity": "high|medium|low", "evidence": "why this is a gap", "linkedPaths": ["paths this limits"], "whyItMatters": "effect on option value" }],
  "interventionRecommendations": [{ "gap": "gap being addressed", "gapType": "knowledge|skill|evidence|network|access|credential|narrative|reputation|information", "interventionType": "learning|practice|proof_asset|networking|positioning|research|application|credential", "recommendation": "recommended intervention", "whyThis": "why this is the best intervention", "output": "what should exist afterward", "assessmentCriteria": "how to assess if it worked", "priority": 1 }],
  "developmentPlans": [{ "title": "living development plan title", "capitalType": "knowledge|skill|evidence|network|access|credential|narrative|reputation|information", "objective": "what capital this builds", "supportsPaths": ["paths supported"], "resources": [{ "title": "book/course/report/framework/search query", "type": "book|course|report|framework|article|search", "why": "why this source belongs", "url": "URL if known" }], "practice": ["drills or exercises"], "proofOutputs": ["memos, briefs, projects, publications, artifacts"], "networkInputs": ["people or conversations needed"], "milestones": [{ "label": "milestone", "doneWhen": "completion standard" }], "assessmentCriteria": ["how Anchor knows capital improved"], "updateTriggers": ["events that should update this plan"] }],
  "evidenceLoops": [{ "evidenceToCollect": "specific evidence", "wouldIncreaseConfidence": "what positive signal means", "wouldDecreaseConfidence": "what negative signal means" }],
  "fitGapMatrix": { "technicalOrDomainKnowledge": { "strengths": [], "gaps": [], "evidenceNeeded": [] }, "roleSpecificSkills": { "strengths": [], "gaps": [], "evidenceNeeded": [] }, "sectorCredibility": { "strengths": [], "gaps": [], "evidenceNeeded": [] }, "networkAccess": { "strengths": [], "gaps": [], "evidenceNeeded": [] }, "narrativeFit": { "strengths": [], "gaps": [], "evidenceNeeded": [] } },
  "gapAnalysis": { "strengths": [], "gaps": [], "biggestGap": "" },
  "learningPaths": [{ "topic": "only where learning is the right intervention", "why": "why it matters", "resourceType": "course|book|article|practice|certification", "suggestedResource": "real resource or precise search query", "output": "artifact or note this learning should produce" }],
  "networkArchetypes": [{ "who": "specific person type", "why": "what they uniquely provide", "searchTip": "exact search" }],
  "proofAssetIdeas": [{ "title": "specific artifact", "why": "why it proves credibility", "format": "memo|deck|analysis|blog post|portfolio", "firstStep": "first concrete creation step" }],
  "plan": { "horizon": "2-4 weeks or 4-6 weeks", "logic": "how to assess and develop this option", "lanes": [{ "lane": "market_map|role_map|fit_map|capability_build|proof_build|network_map|experiments|positioning", "objective": "what this lane must assess or build", "whyNow": "why this belongs in the review", "workstreams": [{ "title": "workstream", "action": "assessment or development action", "doneWhen": "completion bar", "evidence": "what it creates or reveals", "priority": 1 }] }] }
}

Rules:
- Do not create a daily task plan.
- Do not assume every gap requires learning.
- Learning is only one intervention inside broader career capital development.
- Development plans must include resources, practice, proof, network inputs, milestones, assessment, and update triggers where relevant.
- Path hypotheses are uncertain and should include disconfirming evidence.
- Do not invent organisations, resources, role titles, or source URLs beyond the evidence pack.`;

  const raw = await llmJSON<StructuredTrackBrief>(prompt, { model: MODEL_PRIMARY });
  return normalizeBrief(domain, raw, searchPlan, evidencePack);
}

async function ensureTrackForBrief(brief: StructuredTrackBrief): Promise<CareerTrack> {
  const tracks = await storage.getCareerTracks();
  const domainKey = normalize(brief.domain);
  const nameKey = normalize(brief.trackName);
  const existing = tracks.find((track) => {
    const trackName = normalize(track.name);
    const trackSlug = normalize(track.slug);
    return trackName === nameKey || trackName === domainKey || trackName.includes(domainKey) || domainKey.includes(trackName) || trackSlug === slugify(brief.trackName);
  });

  if (existing) {
    const updated = await storage.updateCareerTrack(existing.id, {
      name: existing.name || brief.trackName,
      description: brief.summary || existing.description,
      targetRoleArchetype: brief.targetRoleArchetype || existing.targetRoleArchetype,
      whyItFits: brief.trackThesis || existing.whyItFits,
      status: existing.status || "active",
      priority: Math.max(existing.priority || 0, 70),
    } as any);
    return updated || existing;
  }

  return storage.createCareerTrack({
    slug: slugify(brief.trackName || brief.domain),
    name: brief.trackName || brief.domain,
    description: brief.summary,
    targetRoleArchetype: brief.targetRoleArchetype,
    priority: 70,
    status: "active",
    whyItFits: brief.trackThesis,
    trackIntelligence: "",
  } as any);
}

async function persistStructuredTrackPlan(track: CareerTrack, brief: StructuredTrackBrief, organizedWorkspace: TrackResearchWorkspace): Promise<CareerTrack> {
  const previous = jsonObject(track.trackIntelligence || "");
  const targetOrganizations = uniqueStrings([
    ...brief.sectorMap.flatMap((s) => s.exampleOrgs || []),
    ...brief.roleShapes.flatMap((r) => r.typicalOrgs || []),
  ]);
  const roleFamilies = uniqueStrings(brief.roleShapes.map((r) => r.title));
  const next = {
    ...previous,
    thesis: brief.trackThesis || brief.summary,
    roleFamilies,
    targetOrganizations,
    recurringCapabilities: brief.requirementMap.capabilities.map((text) => evidenceItem(text)),
    recurringKnowledgeNeeds: brief.requirementMap.knowledge.map((text) => evidenceItem(text)),
    recurringEvidenceBar: brief.requirementMap.evidence.map((text) => evidenceItem(text)),
    recurringNarrativeChallenges: brief.requirementMap.narrative.map((text) => evidenceItem(text)),
    requirementBriefs: Array.isArray(previous.requirementBriefs) ? previous.requirementBriefs : [],
    learningPriorities: uniqueStrings(brief.learningPaths.map((p) => p.topic)),
    proofAssetsToBuild: uniqueStrings(brief.proofAssetIdeas.map((p) => p.title)),
    networkingTargets: uniqueStrings(brief.networkArchetypes.map((n) => n.who)),
    activeOpportunityCount: Number(previous.activeOpportunityCount || 0),
    roleModelsAnalyzed: Number(previous.roleModelsAnalyzed || 0),
    sourceDomain: brief.domain,
    researchSummary: brief.summary,
    careerHypothesis: brief.careerHypothesis,
    searchPlan: brief.searchPlan,
    evidencePack: brief.evidencePack,
    researchEvidence: brief.researchEvidence,
    pathHypotheses: brief.pathHypotheses,
    trackHypotheses: brief.trackHypotheses,
    sectorMap: brief.sectorMap,
    roleShapes: brief.roleShapes,
    requirementMap: brief.requirementMap,
    requirementGraph: brief.requirementGraph,
    careerCapitalPortfolio: brief.careerCapitalPortfolio,
    gapPortfolio: brief.gapPortfolio,
    interventionRecommendations: brief.interventionRecommendations,
    developmentPlans: brief.developmentPlans,
    evidenceLoops: brief.evidenceLoops,
    fitGapMatrix: brief.fitGapMatrix,
    gapAnalysis: brief.gapAnalysis,
    learningPaths: brief.learningPaths,
    networkArchetypes: brief.networkArchetypes,
    proofAssetIdeas: brief.proofAssetIdeas,
    trackPlan: brief.plan,
    organizedWorkspace,
    researchedAt: Date.now(),
    lastUpdated: Date.now(),
  };

  const updated = await storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(next) } as any);
  return updated || track;
}

export async function runStructuredTrackResearch(domain: string, options: { materialize?: boolean } = {}): Promise<StructuredTrackResearchResult | null> {
  const cleaned = compact(domain);
  if (!cleaned) return null;
  const inputs = await buildResearchInputs();
  const searchPlan = await generateSearchPlan(cleaned, inputs);
  const evidencePack = await gatherEvidencePack(cleaned, inputs, searchPlan);
  const brief = await synthesizeBrief(cleaned, inputs, searchPlan, evidencePack);
  if (!brief) return null;
  const organizedWorkspace = buildOrganizedTrackWorkspace(brief);
  const initialTrack = await ensureTrackForBrief(brief);
  const track = await persistStructuredTrackPlan(initialTrack, brief, organizedWorkspace);
  const materialized = options.materialize === true ? await materializeTrackResearch(track, brief as any) : null;
  return { track, brief, organizedWorkspace, materialized };
}
