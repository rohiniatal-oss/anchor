import { llmJSON, MODEL_PRIMARY } from "./llm";
import type { RequirementConfidence, RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import {
  recomputeCoverageSummary,
  type CoverageModel,
  type CoverageState,
  type RequirementCoverageAssessment,
  type UserEvidenceBundle,
  type UserEvidenceItem,
  type UserEvidenceSourceType,
} from "./trackResearchCoverageModel";

type CoveragePatch = {
  requirementId?: string;
  state?: CoverageState;
  confidence?: RequirementConfidence;
  evidenceItemIds?: string[];
  rationale?: string;
  successBarAssessment?: string;
  missingEvidence?: string;
  verificationPrompt?: string;
};

type CoverageSynthesis = {
  assessments?: CoveragePatch[];
  qualityNotes?: string[];
};

const COVERAGE_STATES: CoverageState[] = ["proven", "partially_proven", "unproven", "unknown", "below_bar"];
const CONFIDENCE_LEVELS: RequirementConfidence[] = ["high", "medium", "low"];

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(compact).filter(Boolean)) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function negativeSignal(value: unknown): boolean {
  const text = normalize(value);
  return [
    "failed", "rejected because", "not enough", "insufficient", "weakness", "weak at", "struggled", "needs improvement",
    "could not", "unable to", "below bar", "negative feedback", "gap in",
  ].some((signal) => text.includes(signal));
}

function compatibleSources(requirement: TargetRequirement): UserEvidenceSourceType[] {
  if (requirement.category === "network") return ["network_relationship", "contact_interaction"];
  if (requirement.category === "access") return ["network_relationship", "contact_interaction", "application_signal"];
  if (requirement.category === "credential" || requirement.category === "eligibility") return ["cv", "profile_summary", "application_signal"];
  if (requirement.category === "experience") return ["cv", "win"];
  if (requirement.category === "evidence") return ["proof_asset", "learning_output", "win"];
  if (requirement.category === "narrative") return ["cv", "profile_summary", "win", "proof_asset"];
  return ["cv", "win", "proof_asset", "learning_output", "learning_activity", "task_completion"];
}

function sourceInspected(requirement: TargetRequirement, bundle: UserEvidenceBundle): boolean {
  return compatibleSources(requirement).some((sourceType) => bundle.sourceCounts[sourceType] > 0);
}

function canDirectlySupport(requirement: TargetRequirement, item: UserEvidenceItem): boolean {
  if (item.strength === "weak") return false;
  if (requirement.category === "experience") return item.sourceType === "cv" || item.sourceType === "win";
  if (requirement.category === "credential" || requirement.category === "eligibility") return item.sourceType === "cv";
  if (requirement.category === "evidence") return item.sourceType === "proof_asset" || item.sourceType === "learning_output";
  if (requirement.category === "network") return item.sourceType === "network_relationship" || item.sourceType === "contact_interaction";
  if (requirement.category === "access") return item.sourceType === "contact_interaction" || item.sourceType === "application_signal";
  if (requirement.category === "knowledge" || requirement.category === "skill") {
    return item.sourceType === "proof_asset" || item.sourceType === "learning_output" || item.sourceType === "win";
  }
  return item.sourceType === "proof_asset" && item.strength === "direct";
}

function safeState(
  requested: unknown,
  fallback: CoverageState,
  requirement: TargetRequirement,
  evidence: UserEvidenceItem[],
  bundle: UserEvidenceBundle,
): CoverageState {
  const state = COVERAGE_STATES.includes(requested as CoverageState) ? requested as CoverageState : fallback;
  if (state === "proven") {
    return evidence.some((item) => canDirectlySupport(requirement, item)) ? "proven" : evidence.length ? "partially_proven" : sourceInspected(requirement, bundle) ? "unproven" : "unknown";
  }
  if (state === "below_bar") {
    return evidence.some((item) => negativeSignal(`${item.title} ${item.detail}`)) ? "below_bar" : evidence.length ? "partially_proven" : fallback;
  }
  if (state === "partially_proven" && evidence.length === 0) {
    return sourceInspected(requirement, bundle) ? "unproven" : "unknown";
  }
  if (state === "unproven" && !sourceInspected(requirement, bundle)) return "unknown";
  return state;
}

function parseConfidence(value: unknown, fallback: RequirementConfidence): RequirementConfidence {
  return CONFIDENCE_LEVELS.includes(value as RequirementConfidence) ? value as RequirementConfidence : fallback;
}

function applySynthesis(
  requirementModel: RequirementModel,
  bundle: UserEvidenceBundle,
  draft: CoverageModel,
  synthesis: CoverageSynthesis,
): CoverageModel {
  const patchByRequirement = new Map(asArray(synthesis.assessments)
    .filter((patch) => compact(patch.requirementId))
    .map((patch) => [compact(patch.requirementId), patch]));
  const evidenceById = new Map(draft.evidenceItems.map((item) => [item.id, item]));
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));

  const assessments = draft.assessments.map((base) => {
    const patch = patchByRequirement.get(base.requirementId);
    const requirement = requirementById.get(base.requirementId);
    if (!patch || !requirement) return base;
    const evidenceItemIds = uniqueStrings(asArray(patch.evidenceItemIds).filter((id) => evidenceById.has(id)));
    const evidence = evidenceItemIds.map((id) => evidenceById.get(id)).filter(Boolean) as UserEvidenceItem[];
    const state = safeState(patch.state, base.state, requirement, evidence, bundle);
    const assessedSourceTypes = uniqueStrings([
      ...base.assessedSourceTypes,
      ...evidence.map((item) => item.sourceType),
    ]) as UserEvidenceSourceType[];
    return {
      ...base,
      state,
      confidence: parseConfidence(patch.confidence, base.confidence),
      evidenceItemIds: state === "unknown" || state === "unproven" ? [] : evidenceItemIds,
      assessedSourceTypes,
      rationale: compact(patch.rationale) || base.rationale,
      successBarAssessment: compact(patch.successBarAssessment) || base.successBarAssessment,
      missingEvidence: state === "proven" ? "" : compact(patch.missingEvidence) || base.missingEvidence,
      verificationPrompt: state === "unknown" || state === "unproven" ? compact(patch.verificationPrompt) || base.verificationPrompt : "",
      source: "llm_enhanced",
      updatedAt: Date.now(),
    } satisfies RequirementCoverageAssessment;
  });

  const summary = recomputeCoverageSummary(requirementModel, bundle, assessments);
  summary.quality.caveats = uniqueStrings([...summary.quality.caveats, ...asArray(synthesis.qualityNotes)]);
  return { ...draft, assessments, summary, generatedAt: Date.now() };
}

export async function enhanceCoverageModelWithLlm(
  requirementModel: RequirementModel,
  bundle: UserEvidenceBundle,
  draft: CoverageModel,
): Promise<CoverageModel> {
  if (!requirementModel.requirements.length || !bundle.items.length) return draft;
  const roleTitles = new Map(requirementModel.roleFamilies.map((role) => [role.id, role.title]));
  const prompt = `You are Anchor's evidence auditor. Assess what the user can currently demonstrate against a researched target requirement model.

TARGET:
${requirementModel.target.label}

REQUIREMENTS:
${JSON.stringify(requirementModel.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    category: requirement.category,
    importance: requirement.importance,
    definition: requirement.definition,
    successBar: requirement.successBar,
    roleFamilies: requirement.roleFamilyIds.map((id) => roleTitles.get(id)).filter(Boolean),
  })), null, 2)}

USER EVIDENCE:
${JSON.stringify(bundle.items.map((item) => ({
    id: item.id,
    sourceType: item.sourceType,
    title: item.title,
    detail: item.detail,
    sourceUrl: item.sourceUrl,
    targetSpecific: item.targetSpecific,
    strength: item.strength,
  })), null, 2)}

DETERMINISTIC FIRST PASS:
${JSON.stringify(draft.assessments.map((assessment) => ({
    requirementId: assessment.requirementId,
    state: assessment.state,
    confidence: assessment.confidence,
    evidenceItemIds: assessment.evidenceItemIds,
    rationale: assessment.rationale,
  })), null, 2)}

Return ONLY JSON:
{
  "assessments": [
    {
      "requirementId": "existing requirement id",
      "state": "proven|partially_proven|unproven|unknown|below_bar",
      "confidence": "high|medium|low",
      "evidenceItemIds": ["existing user evidence ids only"],
      "rationale": "specific explanation grounded in the evidence",
      "successBarAssessment": "whether and how the evidence meets the stated success bar",
      "missingEvidence": "what evidence is still required, empty only when proven",
      "verificationPrompt": "a low-friction clarification only when essential evidence is genuinely unavailable"
    }
  ],
  "qualityNotes": ["material limitations in the user evidence base"]
}

Rules:
- Use only the supplied requirement IDs and user evidence IDs.
- Judge evidence against the requirement's success bar, not against vague similarity.
- A job title or profile summary alone can support experience, but cannot prove a skill or knowledge requirement.
- Completing a course can partially support knowledge; it does not prove skill or evidence without an output.
- A planned, active, or idea-stage item is not proof of capability.
- Proven requires direct evidence that substantially meets the success bar.
- Partially proven means relevant evidence exists but is adjacent, incomplete, or below the required level.
- Unproven means Anchor checked relevant stored sources and found no adequate proof. It does not mean the user lacks the capability.
- Unknown means the necessary user data is not available.
- Below bar requires explicit negative feedback or outcome evidence; never infer it from silence.
- Network and access coverage require named relationships, interactions, referrals, recruiter engagement, or interviews.
- Do not infer preferences, motivation, enjoyment, or lifestyle fit.
- Avoid unnecessary questions. Only propose a verification prompt when one answer would materially change an essential or important assessment.
- Be conservative and factual. Never invent experience, outputs, credentials, relationships, or outcomes.`;

  const synthesis = await llmJSON<CoverageSynthesis>(prompt, { model: MODEL_PRIMARY });
  return synthesis ? applySynthesis(requirementModel, bundle, draft, synthesis) : draft;
}
