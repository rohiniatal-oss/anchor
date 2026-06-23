import assert from "node:assert/strict";
import test from "node:test";
import type { CoverageModel, CoverageState } from "./trackResearchCoverageModel";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import { buildDevelopmentPlanDraft } from "./trackResearchDevelopmentPlan";

function requirement(overrides: Partial<TargetRequirement> & Pick<TargetRequirement, "id" | "category">): TargetRequirement {
  return {
    id: overrides.id,
    key: `${overrides.category}:${overrides.id}`,
    label: overrides.id.replace(/-/g, " "),
    aliases: [],
    definition: `Definition for ${overrides.id}`,
    group: overrides.category === "knowledge" || overrides.category === "skill" ? "perform_work" : overrides.category === "network" || overrides.category === "access" || overrides.category === "eligibility" ? "access_opportunity" : "demonstrate_credibility",
    category: overrides.category,
    importance: "important",
    importanceReason: "Repeated target requirement",
    scope: "shared",
    roleFamilyIds: [],
    successBar: `Can demonstrate ${overrides.id}`,
    evidenceClaimIds: [],
    confidence: "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    ...overrides,
  };
}

function requirementModel(requirements: TargetRequirement[]): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Target", assumption: "Chosen target" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: { status: "usable", sourceCount: 8, directSourceCount: 4, sourceTypeCount: 3, requirementEvidenceCoverage: 100, directRequirementCoverage: 60, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function coverage(requirements: TargetRequirement[], states: Record<string, CoverageState>): CoverageModel {
  const items = requirements.map((item) => ({
    requirementId: item.id,
    state: states[item.id] || "unknown" as CoverageState,
    confidence: "high" as const,
    reason: "Assessment",
    evidenceClaimIds: [],
    missingEvidence: item.successBar,
    assessedAt: 1,
  }));
  const counts: Record<CoverageState, number> = { proven: 0, partially_proven: 0, unproven: 0, unknown: 0, below_bar: 0 };
  for (const item of items) counts[item.state] += 1;
  return {
    mode: "coverage_model",
    version: 1,
    requirementModelVersion: 2,
    requirementFingerprint: "requirements",
    evidenceFingerprint: "evidence",
    targetLabel: "Geopolitical strategy",
    evidenceClaims: [],
    coverage: items,
    summary: {
      counts,
      coreRequirementCount: requirements.length,
      coreCoverageRate: 0,
      provenRequirementIds: items.filter((item) => item.state === "proven").map((item) => item.requirementId),
      needsEvidenceRequirementIds: items.filter((item) => ["partially_proven", "unproven", "below_bar"].includes(item.state)).map((item) => item.requirementId),
      unknownRequirementIds: items.filter((item) => item.state === "unknown").map((item) => item.requirementId),
    },
    evidenceQuality: { status: "usable", sourceCount: 1, directClaimCount: 0, sourceTypeCount: 1, caveats: [] },
    assessmentMethod: "llm_with_deterministic_guards",
    generatedAt: 1,
  };
}

test("all essential and important requirements are represented or maintained", () => {
  const requirements = [
    requirement({ id: "political-economy", category: "knowledge", importance: "essential" }),
    requirement({ id: "strategic-writing", category: "skill" }),
    requirement({ id: "published-analysis", category: "evidence" }),
    requirement({ id: "practitioner-access", category: "network" }),
    requirement({ id: "transition-story", category: "narrative" }),
  ];
  const model = buildDevelopmentPlanDraft(requirementModel(requirements), coverage(requirements, {
    "political-economy": "partially_proven",
    "strategic-writing": "proven",
    "published-analysis": "unproven",
    "practitioner-access": "unproven",
    "transition-story": "unknown",
  }));

  assert.equal(model.quality.materialCoverageRate, 100);
  assert.equal(model.quality.orphanRequirementIds.length, 0);
  assert.ok(model.maintenanceRequirementIds.includes("strategic-writing"));
  assert.ok(model.workstreams.some((workstream) => workstream.key === "knowledge-foundation"));
  assert.ok(model.workstreams.some((workstream) => workstream.key === "proof-portfolio"));
  assert.ok(model.workstreams.some((workstream) => workstream.key === "access-and-relationships"));
  assert.ok(model.workstreams.some((workstream) => workstream.key === "verification"));
});

test("unknown coverage becomes verification rather than assumed development", () => {
  const requirements = [requirement({ id: "forecasting", category: "skill" })];
  const model = buildDevelopmentPlanDraft(requirementModel(requirements), coverage(requirements, { forecasting: "unknown" }));
  assert.equal(model.decisions[0].action, "verify");
  assert.deepEqual(model.decisions[0].methods, ["research"]);
  assert.equal(model.workstreams[0].kind, "verification");
});

test("proven requirements are maintained without creating redundant development", () => {
  const requirements = [requirement({ id: "strategic-writing", category: "skill" })];
  const model = buildDevelopmentPlanDraft(requirementModel(requirements), coverage(requirements, { "strategic-writing": "proven" }));
  assert.equal(model.decisions[0].action, "maintain");
  assert.ok(model.maintenanceRequirementIds.includes("strategic-writing"));
  const nonMaintenance = model.workstreams.filter((workstream) => workstream.kind !== "maintenance");
  assert.equal(nonMaintenance.length, 0);
});

test("related requirements are clustered into one coherent workstream", () => {
  const requirements = [
    requirement({ id: "political-economy", category: "knowledge" }),
    requirement({ id: "country-risk", category: "knowledge" }),
    requirement({ id: "regional-context", category: "knowledge" }),
  ];
  const model = buildDevelopmentPlanDraft(requirementModel(requirements), coverage(requirements, {
    "political-economy": "partially_proven",
    "country-risk": "unproven",
    "regional-context": "below_bar",
  }));
  const knowledge = model.workstreams.find((workstream) => workstream.key === "knowledge-foundation");
  assert.ok(knowledge);
  assert.equal(knowledge.requirementIds.length, 3);
  assert.equal(knowledge.modules.length, 3);
});

test("role-specific requirements remain modular", () => {
  const requirements = [
    requirement({ id: "client-advisory", category: "skill", scope: "role_specific", roleFamilyIds: ["political-risk-consulting"] }),
    requirement({ id: "research-publication", category: "evidence", scope: "role_specific", roleFamilyIds: ["think-tank-research"] }),
  ];
  const model = buildDevelopmentPlanDraft(requirementModel(requirements), coverage(requirements, {
    "client-advisory": "partially_proven",
    "research-publication": "unproven",
  }));
  const routeModules = model.workstreams.filter((workstream) => workstream.kind === "route_specific");
  assert.equal(routeModules.length, 2);
  assert.deepEqual(routeModules.map((workstream) => workstream.roleFamilyIds[0]).sort(), ["political-risk-consulting", "think-tank-research"]);
});
