import type { CareerTrack } from "@shared/schema";
import type { CoverageModel } from "./trackResearchCoverageModel";
import type { RequirementModel } from "./trackResearchRequirementModel";
import {
  buildDevelopmentPlanDraft,
  developmentPlanFingerprint,
  DEVELOPMENT_PLAN_VERSION,
  type DevelopmentPlanModel,
} from "./trackResearchDevelopmentPlan";
import { enhanceDevelopmentPlanWithLlm, enrichDevelopmentPlanResources } from "./trackResearchDevelopmentSynthesis";

export type DevelopmentPlanResult = {
  model: DevelopmentPlanModel;
  changed: boolean;
};

export function currentDevelopmentPlan(
  intelligence: Record<string, any>,
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
): DevelopmentPlanModel | null {
  const stored = intelligence.developmentPlanModel;
  const sourceFingerprint = developmentPlanFingerprint(requirementModel, coverageModel);
  if (
    stored?.mode === "development_plan_model"
    && stored?.version === DEVELOPMENT_PLAN_VERSION
    && stored?.requirementModelVersion === requirementModel.version
    && stored?.requirementFingerprint === requirementModel.sourceFingerprint
    && stored?.coverageModelVersion === coverageModel.version
    && stored?.coverageFingerprint === coverageModel.evidenceFingerprint
    && stored?.sourceFingerprint === sourceFingerprint
    && Array.isArray(stored.workstreams)
  ) return stored as DevelopmentPlanModel;
  return null;
}

export async function buildDevelopmentPlan(
  track: CareerTrack,
  intelligence: Record<string, any>,
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
): Promise<DevelopmentPlanModel> {
  const draft = buildDevelopmentPlanDraft(requirementModel, coverageModel);
  const structured = await enhanceDevelopmentPlanWithLlm(requirementModel, coverageModel, draft);
  return enrichDevelopmentPlanResources(requirementModel, structured, intelligence);
}

export async function ensureDevelopmentPlan(
  track: CareerTrack,
  intelligence: Record<string, any>,
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
): Promise<DevelopmentPlanResult> {
  const stored = currentDevelopmentPlan(intelligence, requirementModel, coverageModel);
  if (stored) return { model: stored, changed: false };
  const model = await buildDevelopmentPlan(track, intelligence, requirementModel, coverageModel);
  return { model, changed: true };
}
