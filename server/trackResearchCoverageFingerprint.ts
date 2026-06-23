import type { RequirementModel } from "./trackResearchRequirementModel";

function normalizeList(values: string[] | undefined): string[] {
  return [...(values || [])].map((value) => String(value || "").trim()).filter(Boolean).sort();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Fingerprints the exact assessment contract, not only the underlying market
 * sources. Coverage must be rebuilt whenever an LLM refinement changes a
 * requirement label, category, importance, context, or observable success bar.
 */
export function coverageRequirementFingerprint(model: RequirementModel): string {
  const requirements = [...model.requirements]
    .map((requirement) => ({
      id: requirement.id,
      key: requirement.key,
      label: requirement.label,
      definition: requirement.definition,
      group: requirement.group,
      category: requirement.category,
      importance: requirement.importance,
      scope: requirement.scope,
      roleFamilyIds: normalizeList(requirement.roleFamilyIds),
      successBar: requirement.successBar,
      confidence: requirement.confidence,
      context: {
        seniority: normalizeList(requirement.context?.seniority),
        geographies: normalizeList(requirement.context?.geographies),
        employerTypes: normalizeList(requirement.context?.employerTypes),
        notes: normalizeList(requirement.context?.notes),
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return `coverage-requirements-v${model.version}-${stableHash(JSON.stringify(requirements))}`;
}
