import { llmJSON, MODEL_PRIMARY } from "./llm";
import type { RequirementModel } from "./trackResearchRequirementModel";
import type { CoverageModel } from "./trackResearchCoverageModel";
import type { UserEvidenceItem } from "./trackResearchCoverageEvidence";
import {
  buildDevelopmentPlanModel,
  type DevelopmentPlanModel,
  type DevelopmentPlanSynthesis,
} from "./trackResearchDevelopmentPlan";

export type DevelopmentPlanContext = {
  sourceContextFingerprint: string;
  candidateLearning: Array<{ title: string; type: string; why: string; url: string; output: string }>;
  candidateProof: Array<{ title: string; why: string; format: string }>;
  candidateNetwork: Array<{ label: string; why: string; searchTip: string }>;
  existingAssets: UserEvidenceItem[];
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

/**
 * JSON can be syntactically valid while violating the requested array shapes.
 * Coerce every LLM-owned collection at the trust boundary so downstream
 * deterministic fallback logic never receives strings or objects where arrays
 * are expected.
 */
export function sanitizeDevelopmentPlanSynthesis(value: unknown): DevelopmentPlanSynthesis | null {
  const raw = record(value);
  if (!raw) return null;
  const workstreams = safeArray(raw.workstreams).map((entry) => {
    const workstream = record(entry);
    if (!workstream) return null;
    const modules = safeArray(workstream.modules).map((moduleValue) => {
      const module = record(moduleValue);
      if (!module) return null;
      const resources = safeArray(module.resources).map((resourceValue) => {
        const resource = record(resourceValue);
        if (!resource) return null;
        return {
          title: compact(resource.title),
          type: compact(resource.type),
          url: compact(resource.url),
          why: compact(resource.why),
          provenance: compact(resource.provenance),
        };
      }).filter(Boolean);
      return {
        title: compact(module.title),
        type: compact(module.type),
        scope: compact(module.scope),
        objective: compact(module.objective),
        requirementIds: safeArray(module.requirementIds),
        resources,
        activities: safeArray(module.activities),
        output: compact(module.output),
        assessmentCriteria: safeArray(module.assessmentCriteria),
      };
    }).filter(Boolean);
    const milestones = safeArray(workstream.milestones).map((milestoneValue) => {
      const milestone = record(milestoneValue);
      if (!milestone) return null;
      return {
        label: compact(milestone.label),
        sequence: milestone.sequence,
        requirementIds: safeArray(milestone.requirementIds),
        doneWhen: compact(milestone.doneWhen),
        evidenceCreated: compact(milestone.evidenceCreated),
      };
    }).filter(Boolean);
    return {
      title: compact(workstream.title),
      objective: compact(workstream.objective),
      rationale: compact(workstream.rationale),
      requirementIds: safeArray(workstream.requirementIds),
      methods: safeArray(workstream.methods),
      modules,
      milestones,
      dependencyNotes: safeArray(workstream.dependencyNotes),
      completionStandard: compact(workstream.completionStandard),
    };
  }).filter(Boolean) as NonNullable<DevelopmentPlanSynthesis["workstreams"]>;

  return {
    planSummary: compact(raw.planSummary),
    workstreams,
    qualityNotes: safeArray(raw.qualityNotes).map(compact).filter(Boolean),
  };
}

function fallbackWithCaveat(draft: DevelopmentPlanModel, caveat: string): DevelopmentPlanModel {
  return {
    ...draft,
    quality: {
      ...draft.quality,
      status: draft.quality.status === "strong" ? "usable" : draft.quality.status,
      caveats: [...new Set([...draft.quality.caveats, caveat])],
    },
  };
}

function candidateContext(context: DevelopmentPlanContext) {
  return {
    candidateLearning: context.candidateLearning.slice(0, 18),
    candidateProof: context.candidateProof.slice(0, 12),
    candidateNetwork: context.candidateNetwork.slice(0, 12),
    existingAssets: context.existingAssets.slice(0, 24).map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      label: item.label,
      detail: compact(item.detail).slice(0, 900),
      sourceUrl: item.sourceUrl,
      strength: item.strength,
      state: item.state,
      usableForCoverage: item.usableForCoverage,
    })),
  };
}

export async function enhanceDevelopmentPlanWithLlm(
  requirementModel: RequirementModel,
  coverageModel: CoverageModel,
  context: DevelopmentPlanContext,
): Promise<DevelopmentPlanModel> {
  const draft = buildDevelopmentPlanModel(requirementModel, coverageModel, context.sourceContextFingerprint);
  if (!draft.decisions.some((decision) => decision.action !== "maintain")) return draft;

  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const coverageById = new Map(coverageModel.coverage.map((coverage) => [coverage.requirementId, coverage]));
  const decisionInput = draft.decisions.map((decision) => {
    const requirement = requirementById.get(decision.requirementId);
    const coverage = coverageById.get(decision.requirementId);
    return {
      requirementId: decision.requirementId,
      label: requirement?.label,
      category: requirement?.category,
      importance: requirement?.importance,
      scope: decision.scope,
      roleFamilyIds: requirement?.roleFamilyIds,
      successBar: requirement?.successBar,
      coverageStatus: coverage?.status,
      coverageReason: coverage?.reason,
      coverageConfidence: coverage?.confidence,
      developmentAction: decision.action,
      desiredEvidence: decision.desiredEvidence,
      evidenceStillNeeded: decision.evidenceStillNeeded,
    };
  });

  const prompt = `You are Anchor's development-plan architect. The user has already chosen the target. Market research has defined the requirements, and Anchor has assessed what is already evidenced.

Your job is to answer one question: HOW SHOULD ANCHOR BUILD THE REST?

Do not decide whether the target is a good fit.
Do not re-score requirements or coverage.
Do not create tasks, subtasks, daily actions, priorities, schedules, or a Today plan.
Do not create one workstream per requirement.

TARGET
${JSON.stringify({ label: requirementModel.target.label, definition: requirementModel.target.definition }, null, 2)}

ROLE FAMILIES
${JSON.stringify(requirementModel.roleFamilies, null, 2)}

REQUIREMENT DEVELOPMENT DECISIONS
${JSON.stringify(decisionInput, null, 2)}

DETERMINISTIC FALLBACK WORKSTREAMS
${JSON.stringify(draft.workstreams, null, 2)}

EXISTING RESEARCH AND USER ASSETS THAT MAY BE REUSED
${JSON.stringify(candidateContext(context), null, 2)}

Return ONLY valid JSON with this exact shape:
{
  "planSummary": "one concise explanation of the coherent development architecture",
  "workstreams": [
    {
      "title": "outcome-led workstream title",
      "objective": "what capability, credibility, or access this workstream creates",
      "rationale": "why these requirements belong together",
      "requirementIds": ["exact supplied requirement IDs only"],
      "methods": ["learn|practice|gain_experience|create_proof|position|build_relationships|build_access|resolve_credential|resolve_eligibility|verify"],
      "modules": [
        {
          "title": "module title",
          "type": "syllabus|practice|experience|proof|narrative|relationships|access|credential|eligibility|verification",
          "scope": "core|enhancement|conditional",
          "objective": "what this module develops or verifies",
          "requirementIds": ["exact supplied requirement IDs only"],
          "resources": [
            {
              "title": "real resource title or precise search query",
              "type": "book|course|report|framework|article|tool|search_query|existing_asset|other",
              "url": "verified URL or empty string",
              "why": "why this resource is appropriate for these requirements",
              "provenance": "existing_research|existing_asset|web_research|search_query"
            }
          ],
          "activities": ["high-level development activity, not a task or subtask"],
          "output": "observable output or evidence created by the module",
          "assessmentCriteria": ["criteria tied to the supplied requirement success bars"]
        }
      ],
      "milestones": [
        {
          "label": "durable checkpoint",
          "sequence": 1,
          "requirementIds": ["exact supplied requirement IDs only"],
          "doneWhen": "observable milestone completion condition",
          "evidenceCreated": "what reusable evidence exists afterward"
        }
      ],
      "dependencyNotes": ["logical dependency only; do not rank or schedule workstreams"],
      "completionStandard": "when this whole workstream has achieved its purpose"
    }
  ],
  "qualityNotes": ["important limitations or assumptions in the plan"]
}

Planning rules:
- Create 3-6 coherent workstreams where the underlying requirements allow it. Fewer is better than fragmentation.
- Cover every non-maintenance CORE requirement in at least one workstream.
- Include enhancement requirements where they materially strengthen the same workstream; do not create a separate workstream for a minor differentiator.
- Keep role-specific or contextual requirements as CONDITIONAL modules unless the target has only one role family.
- Requirements may appear together in one workstream when the same intervention or output improves several of them.
- A single module may support several requirement IDs. Prefer multi-purpose development that builds capability, proof, and credibility together.
- UNKNOWN coverage must lead to a verification module, not assumed learning or deficiency repair.
- UNPROVEN means not yet evidenced, not necessarily absent. Build only when the requirement needs actual acquisition; demonstrate when the core issue is proof or narrative.
- PROVEN requirements are maintenance only and should not create development modules.
- Knowledge modules must be syllabi, not reading lists. Include concepts, application, synthesis output, and assessment.
- Skill modules require deliberate practice and observable feedback, not passive consumption.
- Experience modules require applied responsibility in a realistic context.
- Proof modules must create inspectable outputs.
- Relationship and access modules must create substantive relationships or entry routes, not lists of names.
- Credential and eligibility modules must first verify that the formal condition is genuinely required and where it applies.
- Use candidate resources and existing assets when appropriate instead of duplicating them.
- You may use web search only to identify current, credible resources for syllabus, credential, or eligibility modules. Prefer primary institutions, official courses, recognized books, and authoritative reports.
- Never invent a URL. If a reliable URL is unavailable, return a precise search_query resource with an empty URL.
- Milestones are durable outputs or state changes above task level. Do not write tiny actions.
- Sequence milestones within a workstream by logical dependency. Do not prioritize workstreams against each other.
- Do not introduce any requirement, organization, credential, or factual claim unsupported by the supplied model or verified web research.`;

  try {
    const raw = await llmJSON<unknown>(prompt, {
      model: MODEL_PRIMARY,
      tools: [{ type: "web_search_preview" }],
      retries: 1,
    });
    const synthesis = sanitizeDevelopmentPlanSynthesis(raw);
    if (!synthesis?.workstreams?.length) {
      return fallbackWithCaveat(draft, "Anchor used the deterministic development plan because the synthesized structure was malformed or empty.");
    }
    return buildDevelopmentPlanModel(requirementModel, coverageModel, context.sourceContextFingerprint, synthesis);
  } catch {
    return fallbackWithCaveat(draft, "Anchor used the deterministic development plan because synthesis was unavailable.");
  }
}

export function developmentPlanContextFromIntelligence(
  intelligence: Record<string, any>,
  existingAssets: UserEvidenceItem[],
): DevelopmentPlanContext {
  const candidateLearning = [
    ...asArray(intelligence.learningPaths).map((item: any) => ({
      title: compact(item.suggestedResource || item.topic),
      type: compact(item.resourceType || "resource"),
      why: compact(item.why),
      url: compact(item.url || item.sourceUrl),
      output: compact(item.output),
    })),
    ...asArray(intelligence.developmentPlans).flatMap((plan: any) => asArray(plan.resources).map((resource: any) => ({
      title: compact(resource.title),
      type: compact(resource.type || "resource"),
      why: compact(resource.why || plan.objective),
      url: compact(resource.url),
      output: compact(asArray(plan.proofOutputs)[0] || asArray(plan.milestones)[0]?.doneWhen),
    }))),
  ].filter((item) => item.title);
  const candidateProof = [
    ...asArray(intelligence.proofAssetIdeas).map((item: any) => ({
      title: compact(item.title),
      why: compact(item.why),
      format: compact(item.format || "artifact"),
    })),
    ...asArray(intelligence.developmentPlans).flatMap((plan: any) => asArray(plan.proofOutputs).map((output: any) => ({
      title: compact(output),
      why: compact(plan.objective),
      format: "artifact",
    }))),
  ].filter((item) => item.title);
  const candidateNetwork = [
    ...asArray(intelligence.networkArchetypes).map((item: any) => ({
      label: compact(item.who),
      why: compact(item.why),
      searchTip: compact(item.searchTip),
    })),
    ...asArray(intelligence.developmentPlans).flatMap((plan: any) => asArray(plan.networkInputs).map((input: any) => ({
      label: compact(input),
      why: compact(plan.objective),
      searchTip: compact(input),
    }))),
  ].filter((item) => item.label);
  const sourceContext = JSON.stringify({ candidateLearning, candidateProof, candidateNetwork });
  let hash = 2166136261;
  for (let index = 0; index < sourceContext.length; index += 1) {
    hash ^= sourceContext.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return {
    sourceContextFingerprint: (hash >>> 0).toString(36),
    candidateLearning,
    candidateProof,
    candidateNetwork,
    existingAssets,
  };
}

export const developmentSynthesisInternals = {
  sanitizeDevelopmentPlanSynthesis,
};
