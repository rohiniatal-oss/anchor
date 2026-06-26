import type { Express } from "express";
import { storage } from "./storage";
import { researchCareerDirection } from "./structuredTrackResearchService";
import { materializeTrackResearch } from "./trackResearchAgent";
import { applyAutomaticActivationFilter, buildCareerArchitecture } from "./trackResearchArchitecture";
import { buildBottleneckDiagnosis } from "./trackResearchBottlenecks";
import { architectureWorkspaceView } from "./trackResearchArchitectureWorkspace";
import { buildRequirementModel, REQUIREMENT_MODEL_VERSION } from "./trackResearchRequirementModel";

function parseJsonObject(value: string): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readDomain(body: any): string {
  return String(body?.domain || body?.focus || body?.area || body?.query || "").trim();
}

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function hasStoredResearch(intelligence: Record<string, any> | null): intelligence is Record<string, any> {
  if (!intelligence) return false;
  if (intelligence.requirementModel?.mode === "requirement_model" && asArray(intelligence.requirementModel.requirements).length > 0) return true;
  return [
    intelligence.roleShapes,
    intelligence.pathHypotheses,
    intelligence.requirementGraph,
    intelligence.interventionRecommendations,
    intelligence.developmentPlans,
  ].some((value) => Array.isArray(value) && value.length > 0);
}

function legacyLearningPaths(intelligence: Record<string, any>) {
  const explicit = asArray(intelligence.learningPaths || intelligence.learningPriorities).map((item: any) => typeof item === "string"
    ? { topic: item, why: "Priority from the research plan", resourceType: "resource", suggestedResource: "", output: `A reusable note or artifact on ${item}` }
    : item);
  if (explicit.length) return explicit;

  return asArray(intelligence.developmentPlans)
    .filter((plan: any) => asArray(plan.resources).length > 0 || plan.capitalType === "knowledge" || plan.capitalType === "skill")
    .map((plan: any) => {
      const firstResource = asArray(plan.resources)[0] || {};
      return {
        topic: compact(plan.title),
        why: compact(plan.objective) || "Build reusable career capital from the research model",
        resourceType: compact(firstResource.type) || (plan.capitalType === "skill" ? "practice" : "resource"),
        suggestedResource: compact(firstResource.title),
        output: compact(asArray(plan.proofOutputs)[0] || asArray(plan.milestones)[0]?.doneWhen) || `Reusable evidence for ${compact(plan.title)}`,
      };
    })
    .filter((item: any) => item.topic);
}

function legacyNetworkArchetypes(intelligence: Record<string, any>) {
  const explicit = asArray(intelligence.networkArchetypes || intelligence.networkingTargets).map((item: any) => typeof item === "string"
    ? { who: item, why: "Target from the research plan", searchTip: item }
    : item);
  if (explicit.length) return explicit;

  return asArray(intelligence.developmentPlans)
    .flatMap((plan: any) => asArray(plan.networkInputs).map((input: any) => ({
      who: compact(input),
      why: compact(plan.objective) || "Conversation needed to validate this career hypothesis",
      searchTip: compact(input),
    })))
    .filter((item: any) => item.who);
}

function legacyProofAssets(intelligence: Record<string, any>) {
  const explicit = asArray(intelligence.proofAssetIdeas || intelligence.proofAssetsToBuild).map((item: any) => typeof item === "string"
    ? { title: item, why: "Proof asset from the research plan", format: "analysis", firstStep: "Draft the outline" }
    : item);
  if (explicit.length) return explicit;

  return asArray(intelligence.developmentPlans)
    .flatMap((plan: any) => asArray(plan.proofOutputs).map((output: any) => ({
      title: compact(output),
      why: compact(plan.objective) || "Create evidence capital for this direction",
      format: "analysis",
      firstStep: "Draft the smallest useful version of the artifact",
    })))
    .filter((item: any) => item.title);
}

function buildBriefFromIntelligence(track: any, intelligence: Record<string, any>) {
  return {
    domain: intelligence.sourceDomain || track.name,
    trackName: track.name,
    trackThesis: intelligence.thesis || track.whyItFits || "",
    targetRoleArchetype: track.targetRoleArchetype || track.name,
    summary: intelligence.researchSummary || track.description || "",
    careerHypothesis: intelligence.careerHypothesis || null,
    searchPlan: intelligence.searchPlan || null,
    evidencePack: intelligence.evidencePack || [],
    researchEvidence: intelligence.researchEvidence || [],
    pathHypotheses: intelligence.pathHypotheses || [],
    trackHypotheses: intelligence.trackHypotheses || [],
    sectorMap: intelligence.sectorMap || [],
    roleShapes: intelligence.roleShapes || [],
    requirementMap: intelligence.requirementMap || { capabilities: [], knowledge: [], evidence: [], narrative: [] },
    requirementGraph: intelligence.requirementGraph || [],
    careerCapitalPortfolio: intelligence.careerCapitalPortfolio || [],
    gapPortfolio: intelligence.gapPortfolio || [],
    interventionRecommendations: intelligence.interventionRecommendations || [],
    developmentPlans: intelligence.developmentPlans || [],
    evidenceLoops: intelligence.evidenceLoops || [],
    fitGapMatrix: intelligence.fitGapMatrix || null,
    gapAnalysis: intelligence.gapAnalysis || { strengths: [], gaps: [], biggestGap: "" },
    learningPaths: legacyLearningPaths(intelligence),
    networkArchetypes: legacyNetworkArchetypes(intelligence),
    proofAssetIdeas: legacyProofAssets(intelligence),
    plan: intelligence.trackPlan || { horizon: "", logic: "", lanes: [] },
  };
}

function deriveRequirementModel(track: any, intelligence: Record<string, any> | null) {
  if (!hasStoredResearch(intelligence)) return null;
  const stored = intelligence.requirementModel;
  const sourceResearchAt = Number(intelligence.researchedAt || 0);
  if (
    stored?.mode === "requirement_model"
    && stored?.version === REQUIREMENT_MODEL_VERSION
    && asArray(stored.requirements).length > 0
    && Number(stored.sourceResearchAt || 0) === sourceResearchAt
  ) {
    return stored;
  }
  return buildRequirementModel(track, buildBriefFromIntelligence(track, intelligence), sourceResearchAt);
}

function deriveCareerArchitecture(track: any, intelligence: Record<string, any> | null) {
  if (!hasStoredResearch(intelligence)) return null;
  if (intelligence.careerArchitecture?.mode === "chosen_target_development" && intelligence.careerArchitecture?.stages?.length) {
    return intelligence.careerArchitecture;
  }
  const brief = buildBriefFromIntelligence(track, intelligence);
  return buildCareerArchitecture(track, brief, intelligence.organizedWorkspace);
}

function deriveBottleneckDiagnosis(track: any, intelligence: Record<string, any> | null, careerArchitecture: any) {
  if (!hasStoredResearch(intelligence)) return null;
  if (intelligence.bottleneckDiagnosis?.mode === "route_bottleneck_diagnosis" && intelligence.bottleneckDiagnosis?.routes?.length) {
    return intelligence.bottleneckDiagnosis;
  }
  const brief = buildBriefFromIntelligence(track, intelligence);
  return buildBottleneckDiagnosis(track, brief, careerArchitecture);
}

async function handleTrackResearch(req: any, res: any) {
  const domain = readDomain(req.body);
  if (!domain) return res.status(400).json({ error: "No domain provided" });

  try {
    const result = await researchCareerDirection(domain);
    if (!result) return res.status(500).json({ error: "Could not generate track research" });
    return res.json(result);
  } catch (error) {
    console.error("Structured track research failed:", error);
    return res.status(500).json({ error: "Could not generate track research" });
  }
}

export function registerTrackResearchRoutes(app: Express) {
  app.post("/api/track-research", handleTrackResearch);

  // Backward-compatible focus-area entry point. Both URLs now use the same
  // structured research service and never materialize execution objects.
  app.post("/api/explore", handleTrackResearch);

  app.get("/api/career-tracks/:id/research-plan", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const track = await storage.getCareerTrack(id);
    if (!track) return res.status(404).json({ error: "Track not found" });
    const intelligence = parseJsonObject(track.trackIntelligence || "");
    const requirementModel = deriveRequirementModel(track, intelligence);
    const careerArchitecture = deriveCareerArchitecture(track, intelligence);
    const bottleneckDiagnosis = deriveBottleneckDiagnosis(track, intelligence, careerArchitecture);
    const organizedWorkspace = architectureWorkspaceView(intelligence?.organizedWorkspace || null, careerArchitecture, bottleneckDiagnosis);
    res.json({
      track,
      intelligence,
      plan: intelligence?.trackPlan || null,
      searchPlan: intelligence?.searchPlan || null,
      evidencePack: intelligence?.evidencePack || [],
      researchEvidence: intelligence?.researchEvidence || [],
      careerHypothesis: intelligence?.careerHypothesis || null,
      pathHypotheses: intelligence?.pathHypotheses || [],
      trackHypotheses: intelligence?.trackHypotheses || [],
      requirementGraph: intelligence?.requirementGraph || [],
      careerCapitalPortfolio: intelligence?.careerCapitalPortfolio || [],
      gapPortfolio: intelligence?.gapPortfolio || [],
      interventionRecommendations: intelligence?.interventionRecommendations || [],
      developmentPlans: intelligence?.developmentPlans || [],
      evidenceLoops: intelligence?.evidenceLoops || [],
      fitGapMatrix: intelligence?.fitGapMatrix || null,
      sectorMap: intelligence?.sectorMap || [],
      roleShapes: intelligence?.roleShapes || [],
      gapAnalysis: intelligence?.gapAnalysis || null,
      requirementModel,
      organizedWorkspace,
      careerArchitecture,
      bottleneckDiagnosis,
      automaticSelection: careerArchitecture?.automaticSelection || intelligence?.automaticSelection || null,
      activationInventory: intelligence?.activationInventory || null,
    });
  });

  app.post("/api/career-tracks/:id/research-plan/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const track = await storage.getCareerTrack(id);
    if (!track) return res.status(404).json({ error: "Track not found" });
    const intelligence = parseJsonObject(track.trackIntelligence || "");
    if (!hasStoredResearch(intelligence)) {
      return res.status(400).json({ error: "No career intelligence model is stored for this track" });
    }
    const brief = buildBriefFromIntelligence(track, intelligence);
    const requirementModel = deriveRequirementModel(track, intelligence) || buildRequirementModel(track, brief, Number(intelligence.researchedAt || 0));
    const careerArchitecture = deriveCareerArchitecture(track, intelligence) || buildCareerArchitecture(track, brief, intelligence.organizedWorkspace);
    const bottleneckDiagnosis = deriveBottleneckDiagnosis(track, intelligence, careerArchitecture) || buildBottleneckDiagnosis(track, brief, careerArchitecture);
    const organizedWorkspace = architectureWorkspaceView(intelligence.organizedWorkspace || null, careerArchitecture, bottleneckDiagnosis);
    const activationBrief = applyAutomaticActivationFilter(brief, careerArchitecture);
    const materialized = await materializeTrackResearch(track, activationBrief as any);
    const nextIntelligence = {
      ...intelligence,
      requirementModel,
      organizedWorkspace,
      careerArchitecture,
      bottleneckDiagnosis,
      automaticSelection: careerArchitecture.automaticSelection,
      activationInventory: materialized,
      activatedAt: Date.now(),
      lastUpdated: Date.now(),
    };
    const updatedTrack = await storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(nextIntelligence) } as any);
    res.json({ track: updatedTrack || track, materialized, requirementModel, organizedWorkspace, careerArchitecture, bottleneckDiagnosis });
  });
}
