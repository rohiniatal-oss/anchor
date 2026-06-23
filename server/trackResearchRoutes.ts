import type { Express } from "express";
import { storage } from "./storage";
import { runStructuredTrackResearch } from "./trackResearchMethod";
import {
  buildRequirementModel,
  REQUIREMENT_MODEL_VERSION,
  type RequirementModel,
} from "./trackResearchRequirementModel";
import { enhanceRequirementModelWithLlm } from "./trackResearchRequirementSynthesis";
import {
  buildCoverageModel,
  collectCoverageEvidenceSources,
  coverageEvidenceFingerprint,
  COVERAGE_MODEL_VERSION,
  type CoverageModel,
} from "./trackResearchCoverageModel";

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
    intelligence.requirementMap?.capabilities,
    intelligence.requirementMap?.knowledge,
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
      why: compact(plan.objective) || "Conversation needed to validate the target requirements",
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
      why: compact(plan.objective) || "Create evidence for this target",
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

function currentRequirementModel(intelligence: Record<string, any>, sourceResearchAt: number): RequirementModel | null {
  const stored = intelligence.requirementModel;
  if (
    stored?.mode === "requirement_model"
    && stored?.version === REQUIREMENT_MODEL_VERSION
    && asArray(stored.requirements).length > 0
    && Number(stored.sourceResearchAt || 0) === sourceResearchAt
  ) return stored as RequirementModel;
  return null;
}

async function ensureRequirementModel(track: any, intelligence: Record<string, any>): Promise<{ model: RequirementModel; changed: boolean }> {
  const sourceResearchAt = Number(intelligence.researchedAt || 0);
  const stored = currentRequirementModel(intelligence, sourceResearchAt);
  if (stored) return { model: stored, changed: false };
  const brief = buildBriefFromIntelligence(track, intelligence);
  const draft = buildRequirementModel(track, brief, sourceResearchAt);
  const model = await enhanceRequirementModelWithLlm(track, brief, draft);
  return { model, changed: true };
}

function currentCoverageModel(intelligence: Record<string, any>, requirementModel: RequirementModel, evidenceFingerprint: string): CoverageModel | null {
  const stored = intelligence.coverageModel;
  if (
    stored?.mode === "coverage_model"
    && stored?.version === COVERAGE_MODEL_VERSION
    && stored?.requirementModelVersion === requirementModel.version
    && stored?.requirementFingerprint === requirementModel.sourceFingerprint
    && stored?.evidenceFingerprint === evidenceFingerprint
    && asArray(stored.coverage).length === requirementModel.requirements.length
  ) return stored as CoverageModel;
  return null;
}

async function ensureCoverageModel(track: any, intelligence: Record<string, any>, requirementModel: RequirementModel): Promise<{ model: CoverageModel; changed: boolean }> {
  const sources = await collectCoverageEvidenceSources(track.id);
  const evidenceFingerprint = coverageEvidenceFingerprint(requirementModel, sources);
  const stored = currentCoverageModel(intelligence, requirementModel, evidenceFingerprint);
  if (stored) return { model: stored, changed: false };
  const model = await buildCoverageModel(track.id, requirementModel, sources);
  return { model, changed: true };
}

async function persistModels(track: any, intelligence: Record<string, any>, requirementModel: RequirementModel, coverageModel: CoverageModel) {
  const nextIntelligence = {
    ...intelligence,
    requirementModel,
    coverageModel,
    lastUpdated: Date.now(),
  };
  return storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(nextIntelligence) } as any);
}

async function handleTrackResearch(req: any, res: any) {
  const domain = readDomain(req.body);
  if (!domain) return res.status(400).json({ error: "No target provided" });

  // Market and role-family research determine the requirements. Coverage then
  // maps existing user evidence to those requirements. Planning comes later.
  const result = await runStructuredTrackResearch(domain, { materialize: false });
  if (!result) return res.status(500).json({ error: "Could not generate target research" });

  const intelligence = parseJsonObject(result.track.trackIntelligence || "") || {};
  const requirementDraft = buildRequirementModel(result.track, result.brief, Number(intelligence.researchedAt || Date.now()));
  const requirementModel = await enhanceRequirementModelWithLlm(result.track, result.brief, requirementDraft);
  const coverageModel = await buildCoverageModel(result.track.id, requirementModel);
  const updatedTrack = await persistModels(result.track, intelligence, requirementModel, coverageModel);

  res.json({
    track: updatedTrack || result.track,
    brief: result.brief,
    plan: result.brief.plan,
    searchPlan: result.brief.searchPlan,
    evidencePack: result.brief.evidencePack,
    researchEvidence: result.brief.researchEvidence,
    sectorMap: result.brief.sectorMap,
    roleShapes: result.brief.roleShapes,
    requirementModel,
    coverageModel,
    materialized: null,
  });
}

export function registerTrackResearchRoutes(app: Express) {
  app.post("/api/track-research", handleTrackResearch);

  // Backward-compatible focus-area entry point. A user-entered direction is
  // treated as a chosen target, not as a request for fit scoring.
  app.post("/api/explore", handleTrackResearch);

  app.get("/api/career-tracks/:id/research-plan", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const track = await storage.getCareerTrack(id);
    if (!track) return res.status(404).json({ error: "Track not found" });
    const intelligence = parseJsonObject(track.trackIntelligence || "");
    if (!hasStoredResearch(intelligence)) {
      return res.json({ track, intelligence, requirementModel: null, coverageModel: null });
    }

    const requirementResult = await ensureRequirementModel(track, intelligence);
    const coverageResult = await ensureCoverageModel(track, intelligence, requirementResult.model);
    let responseTrack = track;
    if (requirementResult.changed || coverageResult.changed) {
      responseTrack = await persistModels(track, intelligence, requirementResult.model, coverageResult.model) || track;
    }

    res.json({
      track: responseTrack,
      intelligence,
      plan: intelligence.trackPlan || null,
      searchPlan: intelligence.searchPlan || null,
      evidencePack: intelligence.evidencePack || [],
      researchEvidence: intelligence.researchEvidence || [],
      sectorMap: intelligence.sectorMap || [],
      roleShapes: intelligence.roleShapes || [],
      requirementModel: requirementResult.model,
      coverageModel: coverageResult.model,
      // Legacy fields remain readable while the new flow is introduced, but
      // they are no longer recomputed or used to create work at this stage.
      careerArchitecture: intelligence.careerArchitecture || null,
      bottleneckDiagnosis: intelligence.bottleneckDiagnosis || null,
      organizedWorkspace: intelligence.organizedWorkspace || null,
      activationInventory: intelligence.activationInventory || null,
    });
  });

  app.post("/api/career-tracks/:id/research-plan/materialize", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const track = await storage.getCareerTrack(id);
    if (!track) return res.status(404).json({ error: "Track not found" });
    const intelligence = parseJsonObject(track.trackIntelligence || "");
    if (!hasStoredResearch(intelligence)) {
      return res.status(400).json({ error: "No requirement model is stored for this target" });
    }

    const requirementResult = await ensureRequirementModel(track, intelligence);
    const coverageResult = await ensureCoverageModel(track, intelligence, requirementResult.model);
    if (requirementResult.changed || coverageResult.changed) {
      await persistModels(track, intelligence, requirementResult.model, coverageResult.model);
    }

    return res.status(409).json({
      error: "Anchor has determined the requirements and assessed current evidence, but it has not built the development plan yet. Execution objects are created only after that plan exists.",
      nextStage: "development_plan",
      requirementModel: requirementResult.model,
      coverageModel: coverageResult.model,
    });
  });
}
