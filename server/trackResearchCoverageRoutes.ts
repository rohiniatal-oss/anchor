import type { Express } from "express";
import { storage } from "./storage";
import {
  buildRequirementModel,
  REQUIREMENT_MODEL_VERSION,
  type RequirementModel,
} from "./trackResearchRequirementModel";
import { enhanceRequirementModelWithLlm } from "./trackResearchRequirementSynthesis";
import { buildUserEvidenceCorpus } from "./trackResearchCoverageEvidence";
import { COVERAGE_MODEL_VERSION, type CoverageModel } from "./trackResearchCoverageModel";
import { assessRequirementCoverageWithLlm } from "./trackResearchCoverageSynthesis";

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function briefFromIntelligence(track: any, intelligence: Record<string, any>) {
  return {
    domain: intelligence.sourceDomain || track.name,
    trackName: track.name,
    trackThesis: intelligence.thesis || track.whyItFits || "",
    targetRoleArchetype: track.targetRoleArchetype || track.name,
    summary: intelligence.researchSummary || track.description || "",
    careerHypothesis: intelligence.careerHypothesis || null,
    evidencePack: intelligence.evidencePack || [],
    researchEvidence: intelligence.researchEvidence || [],
    pathHypotheses: intelligence.pathHypotheses || [],
    sectorMap: intelligence.sectorMap || [],
    roleShapes: intelligence.roleShapes || [],
    requirementMap: intelligence.requirementMap || { capabilities: [], knowledge: [], evidence: [], narrative: [] },
    requirementGraph: intelligence.requirementGraph || [],
    trackHypotheses: intelligence.trackHypotheses || [],
    evidenceLoops: intelligence.evidenceLoops || [],
    searchPlan: intelligence.searchPlan || { ambiguityNotes: [] },
  };
}

function validRequirementModel(value: any, sourceResearchAt: number): value is RequirementModel {
  return value?.mode === "requirement_model"
    && value?.version === REQUIREMENT_MODEL_VERSION
    && asArray(value.requirements).length > 0
    && Number(value.sourceResearchAt || 0) === sourceResearchAt;
}

function validCoverageModel(value: any, requirementModel: RequirementModel, userEvidenceFingerprint: string): value is CoverageModel {
  return value?.mode === "coverage_model"
    && value?.version === COVERAGE_MODEL_VERSION
    && value?.requirementModelVersion === requirementModel.version
    && value?.requirementModelFingerprint === requirementModel.sourceFingerprint
    && value?.userEvidenceFingerprint === userEvidenceFingerprint
    && asArray(value.coverage).length === requirementModel.requirements.length;
}

export async function ensureRequirementCoverage(trackId: number, force = false) {
  const track = await storage.getCareerTrack(trackId);
  if (!track) return null;
  const intelligence = parseJsonObject(track.trackIntelligence);
  const sourceResearchAt = Number(intelligence.researchedAt || 0);
  if (!sourceResearchAt && !asArray(intelligence.requirementGraph).length && !intelligence.requirementModel) {
    return { track, error: "No target requirement research is stored for this track" } as const;
  }

  let requirementModel: RequirementModel;
  if (validRequirementModel(intelligence.requirementModel, sourceResearchAt)) {
    requirementModel = intelligence.requirementModel;
  } else {
    const draft = buildRequirementModel(track, briefFromIntelligence(track, intelligence), sourceResearchAt);
    requirementModel = await enhanceRequirementModelWithLlm(track, briefFromIntelligence(track, intelligence), draft);
  }

  const corpus = await buildUserEvidenceCorpus(track.id);
  if (!force && validCoverageModel(intelligence.coverageModel, requirementModel, corpus.fingerprint)) {
    return { track, requirementModel, coverageModel: intelligence.coverageModel as CoverageModel, refreshed: false } as const;
  }

  const coverageModel = await assessRequirementCoverageWithLlm(requirementModel, corpus);
  const nextIntelligence = {
    ...intelligence,
    requirementModel,
    coverageModel,
    coverageAssessedAt: coverageModel.generatedAt,
    lastUpdated: Date.now(),
  };
  const updatedTrack = await storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(nextIntelligence) } as any);
  return { track: updatedTrack || track, requirementModel, coverageModel, refreshed: true } as const;
}

export function registerTrackResearchCoverageRoutes(app: Express) {
  app.get("/api/career-tracks/:id/coverage", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureRequirementCoverage(id, false);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if ("error" in result) return res.status(409).json({ error: result.error });
    return res.json({
      track: result.track,
      requirementModel: result.requirementModel,
      coverageModel: result.coverageModel,
      refreshed: result.refreshed,
    });
  });

  app.post("/api/career-tracks/:id/coverage/refresh", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await ensureRequirementCoverage(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if ("error" in result) return res.status(409).json({ error: result.error });
    return res.json({
      track: result.track,
      requirementModel: result.requirementModel,
      coverageModel: result.coverageModel,
      refreshed: true,
    });
  });
}
