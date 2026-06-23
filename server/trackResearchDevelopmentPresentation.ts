import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type {
  DevelopmentMethod,
  DevelopmentPlanModel,
  DevelopmentWorkstream,
  RequirementDevelopmentDecision,
} from "./trackResearchDevelopmentPlan";

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase();
}

function titleFor(requirements: TargetRequirement[], verificationOnly: boolean): string {
  if (verificationOnly) return "Verify current evidence before development";
  const categories = new Set(requirements.map((requirement) => requirement.category));
  if ([...categories].every((category) => category === "knowledge" || category === "skill")) return "Develop and evidence role-ready capability";
  if ([...categories].every((category) => category === "experience")) return "Build relevant applied experience";
  if ([...categories].every((category) => category === "evidence" || category === "narrative")) return "Create credible proof and positioning";
  if ([...categories].every((category) => category === "network" || category === "access")) return "Build relationships and hiring access";
  if ([...categories].every((category) => category === "credential" || category === "eligibility")) return "Resolve verified formal requirements";
  return "Build and evidence target readiness";
}

const METHOD_COPY: Record<DevelopmentMethod, RegExp> = {
  learn: /\b(learn|course|study|training|syllabus)\b/i,
  practice: /\b(practi[cs]e|exercise|rehearsal)\b/i,
  gain_experience: /\b(experience|project|assignment|responsibility)\b/i,
  create_proof: /\b(proof|portfolio|artifact|output|publish)\b/i,
  position: /\b(position|positioning|narrative|story|cv|profile)\b/i,
  build_relationships: /\b(relationship|network|practitioner|conversation)\b/i,
  build_access: /\b(access|referral|introduction|hiring route|entry route)\b/i,
  resolve_credential: /\b(credential|certificate|certification|qualification|degree)\b/i,
  resolve_eligibility: /\b(eligibility|visa|clearance|authorization|authorisation)\b/i,
  verify: /\b(verify|verification|confirm|assess|evidence review)\b/i,
  maintain: /\b(maintain|preserve|retain|reuse)\b/i,
};

function hasIncompatibleInterventionCopy(workstream: DevelopmentWorkstream): boolean {
  const text = normalize(`${workstream.title} ${workstream.objective} ${workstream.rationale} ${workstream.completionStandard}`);
  const allowed = new Set(workstream.methods);
  return (Object.entries(METHOD_COPY) as Array<[DevelopmentMethod, RegExp]>)
    .some(([method, pattern]) => !allowed.has(method) && pattern.test(text));
}

function canonicalWorkstreamCopy(
  workstream: DevelopmentWorkstream,
  requirements: TargetRequirement[],
  decisions: RequirementDevelopmentDecision[],
): Pick<DevelopmentWorkstream, "title" | "objective" | "rationale" | "completionStandard"> {
  const verificationOnly = decisions.length > 0 && decisions.every((decision) => decision.action === "verify");
  const labels = requirements.map((requirement) => requirement.label).join(", ");
  if (verificationOnly) {
    return {
      title: titleFor(requirements, true),
      objective: `Verify current evidence and requirement applicability before prescribing development for ${labels}.`,
      rationale: "Coverage certainty is insufficient, so verification must precede learning, credentials, projects, networking, or other investment.",
      completionStandard: "Every linked requirement has enough evidence for a defensible build, strengthen, demonstrate, maintain, or defer decision.",
    };
  }

  return {
    title: titleFor(requirements, false),
    objective: `Create sufficient capability and evidence against the documented success bars for ${labels}.`,
    rationale: "The deterministic requirement actions define the admissible intervention. This workstream groups requirements that can be improved through a coherent method or shared output.",
    completionStandard: "Every linked requirement meets its success bar or has a documented, evidence-based reason it remains conditional.",
  };
}

/**
 * Guardrails may legitimately replace an LLM-proposed intervention while
 * preserving the surrounding workstream object. This final pass ensures the
 * user-facing title and explanation describe the hardened intervention rather
 * than the rejected proposal.
 */
export function alignDevelopmentPlanPresentation(
  plan: DevelopmentPlanModel,
  requirementModel: RequirementModel,
): DevelopmentPlanModel {
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const decisionById = new Map(plan.decisions.map((decision) => [decision.requirementId, decision]));
  const workstreams = plan.workstreams.map((workstream) => {
    const requirements = workstream.requirementIds
      .map((id) => requirementById.get(id))
      .filter(Boolean) as TargetRequirement[];
    const decisions = workstream.requirementIds
      .map((id) => decisionById.get(id))
      .filter(Boolean) as RequirementDevelopmentDecision[];
    const verificationOnly = decisions.length > 0 && decisions.every((decision) => decision.action === "verify");
    const needsRebuild = verificationOnly || hasIncompatibleInterventionCopy(workstream);
    return needsRebuild
      ? { ...workstream, ...canonicalWorkstreamCopy(workstream, requirements, decisions) }
      : workstream;
  });
  return { ...plan, workstreams };
}

export const developmentPresentationInternals = {
  hasIncompatibleInterventionCopy,
};
