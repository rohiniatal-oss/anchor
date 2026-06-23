import type { Express } from "express";
import { storage } from "./storage";
import { runStructuredTrackResearch } from "./trackResearchMethod";
import { materializeTrackResearch } from "./trackResearchAgent";
import { buildCareerArchitecture } from "./trackResearchArchitecture";
import { applyGapDrivenActivationFilter } from "./trackResearchActivation";
import { architectureWorkspaceView } from "./trackResearchArchitectureWorkspace";

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

function deriveCareerArchitecture(track: any, intelligence: Record<string, any> | null) {
  if (!hasStoredResearch(intelligence)) return null;
  if (intelligence.careerArchitecture?.mode === "chosen_target_development" && intelligence.careerArchitecture?.stages?.length) {
    return intelligence.careerArchitecture;
  }
  const brief = buildBriefFromIntelligence(track, intelligence);
  return buildCareerArchitecture(track, brief, intelligence.organizedWorkspace);
}

async function handleTrackResearch(req: any, res: any) {
  const domain = readDomain(req.body);
  if (!domain) return res.status(400).json({ error: "No domain provided" });

  // Research creates the career intelligence model first: evidence, path
  // hypotheses, career capital, gaps, interventions, and development plans.
  // Execution objects remain opt-in and are now filtered by automatic architecture.
  const result = await runStructuredTrackResearch(domain, { materialize: false });
  if (!result) return res.status(500).json({ error: "Could not generate track research" });

  const architecture = buildCareerArchitecture(result.track, result.brief, result.organizedWorkspace);
  const organizedWorkspace = architectureWorkspaceView(result.organizedWorkspace, architecture);
  const currentIntelligence = parseJsonObject(result.track.trackIntelligence || "") || {};
  const nextIntelligence = {
    ...currentIntelligence,
    organizedWorkspace,
    careerArchitecture: architecture,
    automaticSelection: architecture.automaticSelection,
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(result.track.id, { trackIntelligence: JSON.stringify(nextIntelligence) } as any);

  res.json({
    track: updatedTrack || result.track,
    brief: result.brief,
    plan: result.brief.plan,
    searchPlan: result.brief.searchPlan,
    evidencePack: result.brief.evidencePack,
    researchEvidence: result.brief.researchEvidence,
    careerHypothesis: result.brief.careerHypothesis,
    pathHypotheses: result.brief.pathHypotheses,
    trackHypotheses: result.brief.trackHypotheses,
    requirementGraph: result.brief.requirementGraph,
    careerCapitalPortfolio: result.brief.careerCapitalPortfolio,
    gapPortfolio: result.brief.gapPortfolio,
    interventionRecommendations: result.brief.interventionRecommendations,
    developmentPlans: result.brief.developmentPlans,
    evidenceLoops: result.brief.evidenceLoops,
    fitGapMatrix: result.brief.fitGapMatrix,
    organizedWorkspace,
    careerArchitecture: architecture,
    automaticSelection: architecture.automaticSelection,
    materialized: null,
  });
}

export function registerTrackResearchRoutes(app: Express) {
  app.post("/api/track-research", handleTrackResearch);

  // Backward-compatible focus-area entry point. This route is registered before
  // capture.ts, so broad exploration now uses the structured track plan agent.
  app.post("/api/explore", handleTrackResearch);

  app.get("/api/career-tracks/:id/research-plan", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const track = await storage.getCareerTrack(id);
    if (!track) return res.status(404).json({ error: "Track not found" });
    const intelligence = parseJsonObject(track.trackIntelligence || "");
    const careerArchitecture = deriveCareerArchitecture(track, intelligence);
    const organizedWorkspace = architectureWorkspaceView(intelligence?.organizedWorkspace || null, careerArchitecture);
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
      organizedWorkspace,
      careerArchitecture,
      automaticSelection: careerArchitecture?.automaticSelection || intelligence?.automaticSelection || null,
      activationPlan: intelligence?.activationPlan || null,
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
    const careerArchitecture = deriveCareerArchitecture(track, intelligence) || buildCareerArchitecture(track, brief, intelligence.organizedWorkspace);
    const organizedWorkspace = architectureWorkspaceView(intelligence.organizedWorkspace || null, careerArchitecture);
    const activationBrief = applyGapDrivenActivationFilter(brief, careerArchitecture);
    const materialized = await materializeTrackResearch(track, activationBrief as any);
    const nextIntelligence = {
      ...intelligence,
      organizedWorkspace,
      careerArchitecture,
      automaticSelection: careerArchitecture.automaticSelection,
      activationPlan: activationBrief.activationPlan,
      activationInventory: materialized,
      activatedAt: Date.now(),
      lastUpdated: Date.now(),
    };
    const updatedTrack = await storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(nextIntelligence) } as any);
    res.json({ track: updatedTrack || track, materialized, organizedWorkspace, careerArchitecture, activationPlan: activationBrief.activationPlan });
  });
}
