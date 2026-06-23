import assert from "node:assert/strict";
import test from "node:test";
import type { CoverageModel } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import { buildDevelopmentPlanDraft } from "./trackResearchDevelopmentPlan";
import { applyDevelopmentPlanPolicy, DEVELOPMENT_POLICY_VERSION } from "./trackResearchDevelopmentPolicy";

function requirement(overrides: Partial<TargetRequirement> & Pick<TargetRequirement, "id" | "category">): TargetRequirement {
  return {
    id: overrides.id,
    key: `${overrides.category}:${overrides.id}`,
    label: overrides.id.replace(/-/g, " "),
    aliases: [],
    definition: overrides.id,
    group: overrides.category === "knowledge" || overrides.category === "skill" ? "perform_work" : overrides.category === "network" || overrides.category === "access" || overrides.category === "eligibility" ? "access_opportunity" : "demonstrate_credibility",
    category: overrides.category,
    importance: "important",
    importanceReason: "Test",
    scope: "shared",
    roleFamilyIds: [],
    successBar: `Success bar for ${overrides.id}`,
    evidenceClaimIds: [],
    confidence: "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    ...overrides,
  };
}

function requirementModel(requirements: TargetRequirement[], status: RequirementModel["researchQuality"]["status"] = "usable"): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements",
    sourceResearchAt: 1,
    target: { label: "Target", definition: "Target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: { status, sourceCount: 4, directSourceCount: 1, sourceTypeCount: 2, requirementEvidenceCoverage: 75, directRequirementCoverage: 25, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function coverage(requirements: TargetRequirement[], states: Record<string, CoverageModel["coverage"][number]["state"]>): CoverageModel {
  const items = requirements.map((item) => ({
    requirementId: item.id,
    state: states[item.id] || "unknown",
    confidence: "medium" as const,
    reason: "Assessment",
    evidenceClaimIds: [],
    missingEvidence: item.successBar,
    assessedAt: 1,
  }));
  return {
    mode: "coverage_model",
    version: 1,
    requirementModelVersion: 2,
    requirementFingerprint: "requirements",
    evidenceFingerprint: "evidence",
    targetLabel: "Target",
    evidenceClaims: [],
    coverage: items,
    summary: {
      counts: {
        proven: items.filter((item) => item.state === "proven").length,
        partially_proven: items.filter((item) => item.state === "partially_proven").length,
        unproven: items.filter((item) => item.state === "unproven").length,
        unknown: items.filter((item) => item.state === "unknown").length,
        below_bar: items.filter((item) => item.state === "below_bar").length,
      },
      coreRequirementCount: requirements.length,
      coreCoverageRate: 0,
      provenRequirementIds: [],
      needsEvidenceRequirementIds: [],
      unknownRequirementIds: [],
    },
    evidenceQuality: { status: "usable", sourceCount: 1, directClaimCount: 0, sourceTypeCount: 1, caveats: [] },
    assessmentMethod: "llm_with_deterministic_guards",
    generatedAt: 1,
  };
}

test("low-confidence requirements are verified before development", () => {
  const requirements = [requirement({ id: "specialist-method", category: "skill", confidence: "low" })];
  const reqModel = requirementModel(requirements);
  const coverageModel = coverage(requirements, { "specialist-method": "unproven" });
  const draft = buildDevelopmentPlanDraft(reqModel, coverageModel);
  const result = applyDevelopmentPlanPolicy(reqModel, coverageModel, draft);

  assert.equal(result.policyVersion, DEVELOPMENT_POLICY_VERSION);
  assert.equal(result.decisions[0].action, "verify");
  assert.deepEqual(result.decisions[0].methods, ["research"]);
  assert.equal(result.workstreams[0].kind, "verification");
});

test("unresolved eligibility gates are verified rather than treated as qualifications", () => {
  const requirements = [requirement({ id: "security-clearance", category: "eligibility", confidence: "high" })];
  const reqModel = requirementModel(requirements);
  const coverageModel = coverage(requirements, { "security-clearance": "unproven" });
  const draft = buildDevelopmentPlanDraft(reqModel, coverageModel);
  const result = applyDevelopmentPlanPolicy(reqModel, coverageModel, draft);

  assert.equal(result.decisions[0].action, "verify");
  assert.deepEqual(result.decisions[0].methods, ["research"]);
  assert.match(result.decisions[0].rationale, /formal gate/i);
});

test("medium-confidence credentials are verified before recommending costly study", () => {
  const requirements = [requirement({ id: "specialist-certificate", category: "credential", confidence: "medium" })];
  const reqModel = requirementModel(requirements);
  const coverageModel = coverage(requirements, { "specialist-certificate": "unproven" });
  const draft = buildDevelopmentPlanDraft(reqModel, coverageModel);
  const result = applyDevelopmentPlanPolicy(reqModel, coverageModel, draft);

  assert.equal(result.decisions[0].action, "verify");
  assert.equal(result.workstreams[0].kind, "verification");
});

test("proven formal requirements are preserved rather than re-verified", () => {
  const requirements = [requirement({ id: "work-authorization", category: "eligibility", confidence: "low" })];
  const reqModel = requirementModel(requirements);
  const coverageModel = coverage(requirements, { "work-authorization": "proven" });
  const draft = buildDevelopmentPlanDraft(reqModel, coverageModel);
  const result = applyDevelopmentPlanPolicy(reqModel, coverageModel, draft);

  assert.equal(result.decisions[0].action, "maintain");
  assert.ok(result.maintenanceRequirementIds.includes("work-authorization"));
});
