import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementCategory, RequirementImportance, RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { CoverageModel, CoverageStatus, RequirementCoverage } from "./trackResearchCoverageModel";
import { buildDevelopmentPlanModel } from "./trackResearchDevelopmentPlan";

function requirement(
  id: string,
  category: RequirementCategory,
  label: string,
  importance: RequirementImportance = "important",
  scope: "shared" | "role_specific" = "shared",
): TargetRequirement {
  return {
    id,
    key: `${category}:${label.toLowerCase()}`,
    label,
    aliases: [],
    definition: `${label} for the selected target.`,
    group: category === "knowledge" || category === "skill"
      ? "perform_work"
      : category === "network" || category === "access" || category === "eligibility"
        ? "access_opportunity"
        : "demonstrate_credibility",
    category,
    importance,
    importanceReason: "Supported by the requirement model.",
    scope,
    roleFamilyIds: scope === "role_specific" ? ["role-a"] : [],
    successBar: `Can demonstrate ${label} to the target-role standard.`,
    evidenceClaimIds: [],
    confidence: "medium",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
  };
}

function requirementModel(requirements: TargetRequirement[], roleFamilyCount = 2): RequirementModel {
  const roleFamilies = Array.from({ length: roleFamilyCount }, (_, index) => ({
    id: index === 0 ? "role-a" : `role-${index + 1}`,
    title: `Role family ${index + 1}`,
    description: "",
    typicalOrganizations: [],
    seniority: "mixed",
    marketSegmentIds: [],
    evidenceClaimIds: [],
  }));
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirement-fingerprint",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Selected target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies,
    groups: [
      { id: "perform_work", label: "Perform the work", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate credibility", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access the opportunity", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: { status: "usable", sourceCount: 8, directSourceCount: 3, sourceTypeCount: 3, requirementEvidenceCoverage: 80, directRequirementCoverage: 40, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function coverage(requirementId: string, status: CoverageStatus): RequirementCoverage {
  return {
    requirementId,
    status,
    confidence: status === "unknown" ? "low" : "medium",
    evidenceItemIds: status === "proven" || status === "partially_proven" ? [`evidence-${requirementId}`] : [],
    reason: `Coverage is ${status}.`,
    successBarAssessment: "Compared to the success bar.",
    evidenceStillNeeded: status === "proven" ? [] : ["Direct evidence against the success bar"],
    sourceBasis: "llm",
  };
}

function coverageModel(requirements: TargetRequirement[], statuses: Record<string, CoverageStatus>): CoverageModel {
  const rows = requirements.map((item) => coverage(item.id, statuses[item.id] || "unknown"));
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Geopolitical strategy",
    requirementModelVersion: 2,
    requirementModelFingerprint: "requirement-fingerprint",
    userEvidenceFingerprint: "user-evidence-fingerprint",
    coverage: rows,
    evidenceItems: [],
    sourceInventory: { cv: 1, profile_summary: 0, win: 1, learning_output: 0, completed_learning: 0, proof_asset: 0, relationship: 0, interaction: 0 },
    groups: [],
    quality: { status: "usable", assessedRequirementCount: rows.filter((row) => row.status !== "unknown").length, unknownRequirementCount: rows.filter((row) => row.status === "unknown").length, citedEvidenceCount: 2, directEvidenceCount: 0, assessmentCoverage: 70, caveats: [] },
    generatedAt: 1,
  };
}

test("proven requirements become maintenance and do not create workstreams", () => {
  const req = requirement("knowledge", "knowledge", "Political economy knowledge");
  const model = buildDevelopmentPlanModel(requirementModel([req]), coverageModel([req], { knowledge: "proven" }), "context");

  assert.equal(model.decisions[0]?.action, "maintain");
  assert.deepEqual(model.maintenanceRequirementIds, [req.id]);
  assert.equal(model.workstreams.length, 0);
});

test("unknown requirements create verification modules rather than assumed development", () => {
  const req = requirement("knowledge", "knowledge", "Political economy knowledge");
  const model = buildDevelopmentPlanModel(requirementModel([req]), coverageModel([req], { knowledge: "unknown" }), "context");

  assert.equal(model.decisions[0]?.action, "verify");
  assert.equal(model.workstreams[0]?.modules[0]?.type, "verification");
  assert.equal(model.workstreams[0]?.modules[0]?.requirementIds[0], req.id);
});

test("partly proven proof requirements become demonstration work", () => {
  const req = requirement("proof", "evidence", "Published geopolitical analysis");
  const model = buildDevelopmentPlanModel(requirementModel([req]), coverageModel([req], { proof: "partially_proven" }), "context");

  assert.equal(model.decisions[0]?.action, "demonstrate");
  assert.equal(model.workstreams[0]?.modules[0]?.type, "proof");
});

test("knowledge and skill requirements are consolidated into one capability workstream", () => {
  const knowledge = requirement("knowledge", "knowledge", "Political economy knowledge", "essential");
  const skill = requirement("skill", "skill", "Client-ready geopolitical writing", "important");
  const model = buildDevelopmentPlanModel(
    requirementModel([knowledge, skill]),
    coverageModel([knowledge, skill], { knowledge: "unproven", skill: "partially_proven" }),
    "context",
  );

  assert.equal(model.workstreams.length, 1);
  assert.deepEqual(new Set(model.workstreams[0]?.requirementIds), new Set([knowledge.id, skill.id]));
  assert.equal(model.workstreams[0]?.modules.length, 2);
});

test("role-specific requirements remain conditional when the target has multiple role families", () => {
  const req = requirement("forecasting", "skill", "Political forecasting", "important", "role_specific");
  const model = buildDevelopmentPlanModel(requirementModel([req], 3), coverageModel([req], { forecasting: "unproven" }), "context");

  assert.equal(model.decisions[0]?.scope, "conditional");
  assert.equal(model.workstreams[0]?.modules[0]?.scope, "conditional");
});

test("differentiators are retained as enhancement rather than discarded", () => {
  const req = requirement("public-profile", "evidence", "Recognized public analysis", "differentiator");
  const model = buildDevelopmentPlanModel(requirementModel([req]), coverageModel([req], { "public-profile": "unproven" }), "context");

  assert.equal(model.decisions[0]?.scope, "enhancement");
  assert.equal(model.quality.enhancementRequirementCount, 1);
  assert.equal(model.workstreams[0]?.modules[0]?.scope, "enhancement");
});

test("invented LLM requirement IDs are discarded and missing core requirements are backfilled", () => {
  const req = requirement("skill", "skill", "Client-ready geopolitical writing", "essential");
  const model = buildDevelopmentPlanModel(
    requirementModel([req]),
    coverageModel([req], { skill: "unproven" }),
    "context",
    {
      planSummary: "Custom plan",
      workstreams: [{
        title: "Invented workstream",
        objective: "Unsupported",
        rationale: "Unsupported",
        requirementIds: ["not-a-real-requirement"],
        methods: ["learn"],
        modules: [],
        milestones: [],
        dependencyNotes: [],
        completionStandard: "Unsupported",
      }],
    },
  );

  assert.equal(model.workstreams.length, 1);
  assert.ok(model.workstreams[0]?.requirementIds.includes(req.id));
  assert.deepEqual(model.quality.unassignedRequirementIds, []);
});

test("one synthesized workstream can support several requirements", () => {
  const knowledge = requirement("knowledge", "knowledge", "Political economy knowledge", "essential");
  const proof = requirement("proof", "evidence", "Published geopolitical analysis", "important");
  const model = buildDevelopmentPlanModel(
    requirementModel([knowledge, proof]),
    coverageModel([knowledge, proof], { knowledge: "partially_proven", proof: "unproven" }),
    "context",
    {
      workstreams: [{
        title: "Build and demonstrate geopolitical judgement",
        objective: "Combine knowledge development with an inspectable output.",
        rationale: "The same analysis builds and demonstrates both requirements.",
        requirementIds: [knowledge.id, proof.id],
        methods: ["learn", "create_proof"],
        modules: [{
          title: "Applied geopolitical analysis",
          type: "proof",
          scope: "core",
          objective: "Apply political economy knowledge in a public analysis.",
          requirementIds: [knowledge.id, proof.id],
          resources: [],
          activities: ["Develop the analysis architecture", "Apply it to a realistic case"],
          output: "An inspectable geopolitical analysis.",
          assessmentCriteria: [knowledge.successBar, proof.successBar],
        }],
        milestones: [{
          label: "Applied analysis completed",
          sequence: 1,
          requirementIds: [knowledge.id, proof.id],
          doneWhen: "The output meets both success bars.",
          evidenceCreated: "A reusable analysis artifact.",
        }],
        dependencyNotes: [],
        completionStandard: "Both requirements have credible evidence.",
      }],
    },
  );

  assert.equal(model.workstreams.length, 1);
  assert.deepEqual(new Set(model.workstreams[0]?.requirementIds), new Set([knowledge.id, proof.id]));
  assert.equal(model.workstreams[0]?.modules[0]?.requirementIds.length, 2);
});
