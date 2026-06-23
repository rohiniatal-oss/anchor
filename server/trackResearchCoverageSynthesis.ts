import { llmJSON, MODEL_PRIMARY } from "./llm";
import type { RequirementModel } from "./trackResearchRequirementModel";
import type { UserEvidenceCorpus } from "./trackResearchCoverageEvidence";
import { buildCoverageModel, type CoverageModel, type CoverageSynthesis } from "./trackResearchCoverageModel";

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export async function assessRequirementCoverageWithLlm(
  requirementModel: RequirementModel,
  corpus: UserEvidenceCorpus,
): Promise<CoverageModel> {
  const deterministic = buildCoverageModel(requirementModel, corpus);
  if (!requirementModel.requirements.length || !corpus.items.length) return deterministic;

  const roleTitles = new Map(requirementModel.roleFamilies.map((role) => [role.id, role.title]));
  const requirements = requirementModel.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    aliases: requirement.aliases,
    category: requirement.category,
    importance: requirement.importance,
    definition: requirement.definition,
    successBar: requirement.successBar,
    roleFamilies: requirement.roleFamilyIds.map((id) => roleTitles.get(id)).filter(Boolean),
    context: requirement.context,
  }));
  const evidenceItems = corpus.items.map((item) => ({
    id: item.id,
    sourceType: item.sourceType,
    label: item.label,
    detail: compact(item.detail).slice(0, 1100),
    sourceUrl: item.sourceUrl,
    strength: item.strength,
    state: item.state,
    usableForCoverage: item.usableForCoverage,
    sameTargetTrack: item.trackIds.includes(corpus.targetTrackId),
  }));

  const prompt = `You are Anchor's evidence assessor. The user has already chosen the target. Your only job is to determine what the available user evidence proves against each target requirement.

Do not judge whether the target is a good fit.
Do not recommend learning, development, tasks, or prioritization.
Do not infer inability from missing evidence.
Use only the supplied requirement IDs and evidence item IDs.

TARGET
${JSON.stringify({ label: requirementModel.target.label, definition: requirementModel.target.definition }, null, 2)}

TARGET REQUIREMENTS
${JSON.stringify(requirements, null, 2)}

USER EVIDENCE CORPUS
${JSON.stringify({ sourceInventory: corpus.sourceCounts, caveats: corpus.caveats, evidenceItems }, null, 2)}

Return ONLY valid JSON with this exact shape:
{
  "assessments": [
    {
      "requirementId": "an exact supplied requirement ID",
      "status": "proven|partially_proven|unproven|unknown|below_bar",
      "confidence": "high|medium|low",
      "evidenceItemIds": ["exact supplied evidence IDs"],
      "reason": "specific explanation of what the evidence does or does not establish",
      "successBarAssessment": "comparison between the cited evidence and the requirement success bar",
      "evidenceStillNeeded": ["specific evidence needed to verify or complete coverage"]
    }
  ],
  "qualityNotes": ["important limitations of this assessment"]
}

Coverage rules:
- Return one assessment for every supplied requirement.
- PROVEN requires evidence that meets the observable success bar, not merely a related job title or a plausible inference.
- PARTIALLY_PROVEN means relevant evidence exists but is incomplete in scope, recency, context, observability, or quality.
- UNPROVEN means the relevant user sources were available and inspected, but no credible evidence matched. It means not yet evidenced, not unable.
- UNKNOWN means the necessary source type is missing or the evidence is too ambiguous to assess.
- BELOW_BAR requires explicit negative performance evidence or feedback. Never infer it from absence.
- Planned or in-progress items with usableForCoverage=false cannot support proven or partially_proven.
- A CV is a declared primary record. It can directly evidence experience, credentials, and eligibility when explicit, but should not by itself prove performance quality.
- Knowledge and skill are strongest when supported by outputs, applied examples, or multiple independent signals.
- Proof-and-output requirements require an inspectable or clearly completed output; intention to create one is insufficient.
- Network requirements require an active relevant relationship or interaction.
- Access requirements require evidence of an entry route, introduction, referral, or relevant active relationship; a list of cold targets is insufficient.
- Narrative requirements need evidence of an articulated story or positioning asset; a background that could form a story is only partial.
- Cite the smallest relevant set of evidence items. Do not cite irrelevant items to inflate confidence.
- If the evidence is mixed, choose the more conservative state and explain why.`;

  const synthesis = await llmJSON<CoverageSynthesis>(prompt, { model: MODEL_PRIMARY });
  if (!synthesis) return deterministic;
  return buildCoverageModel(requirementModel, corpus, synthesis);
}
