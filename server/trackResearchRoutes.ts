import type { Express } from "express";
import { storage } from "./storage";
import { runStructuredTrackResearch } from "./trackResearchMethod";
import { materializeTrackResearch } from "./trackResearchAgent";

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
    learningPaths: (intelligence.learningPaths || intelligence.learningPriorities || []).map((item: any) => typeof item === "string"
      ? { topic: item, why: "Priority from the research plan", resourceType: "resource", suggestedResource: "", output: `A reusable note or artifact on ${item}` }
      : item),
    networkArchetypes: (intelligence.networkArchetypes || intelligence.networkingTargets || []).map((item: any) => typeof item === "string"
      ? { who: item, why: "Target from the research plan", searchTip: item }
      : item),
    proofAssetIdeas: (intelligence.proofAssetIdeas || intelligence.proofAssetsToBuild || []).map((item: any) => typeof item === "string"
      ? { title: item, why: "Proof asset from the research plan", format: "analysis", firstStep: "Draft the outline" }
      : item),
    plan: intelligence.trackPlan || { horizon: "", logic: "", lanes: [] },
  };
}

async function handleTrackResearch(req: any, res: any) {
  const domain = readDomain(req.body);
  if (!domain) return res.status(400).json({ error: "No domain provided" });

  // Research creates the career intelligence model first: evidence, path
  // hypotheses, career capital, gaps, interventions, and development plans.
  // Execution objects remain opt-in.
  const result = await runStructuredTrackResearch(domain, { materialize: req.body?.materialize === true });
  if (!result) return res.status(500).json({ error: "Could not generate track research" });

  res.json({
    track: result.track,
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
    organizedWorkspace: result.organizedWorkspace,
    materialized: result.materialized,
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
      organizedWorkspace: intelligence?.organizedWorkspace || null,
      activationInventory: intelligence?.activationInventory || null,
    });
  });

  app.post("/api/career-tracks/:id/research-plan/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const track = await storage.getCareerTrack(id);
    if (!track) return res.status(404).json({ error: "Track not found" });
    const intelligence = parseJsonObject(track.trackIntelligence || "");
    if (!intelligence?.roleShapes || !intelligence?.learningPriorities) {
      return res.status(400).json({ error: "No research plan is stored for this track" });
    }
    const brief = buildBriefFromIntelligence(track, intelligence);
    const materialized = await materializeTrackResearch(track, brief as any);
    const nextIntelligence = {
      ...intelligence,
      activationInventory: materialized,
      activatedAt: Date.now(),
      lastUpdated: Date.now(),
    };
    const updatedTrack = await storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(nextIntelligence) } as any);
    res.json({ track: updatedTrack || track, materialized, organizedWorkspace: intelligence.organizedWorkspace || null });
  });
}
