import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementModel } from "./trackResearchRequirementModel";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import { alignDevelopmentPlanPresentation } from "./trackResearchDevelopmentPresentation";

function requirementModel(): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform", description: "", requirementIds: ["requirement-knowledge"] },
      { id: "demonstrate_credibility", label: "Demonstrate", description: "", requirementIds: [] },
      { id: "access_opportunity", label: "Access", description: "", requirementIds: [] },
    ],
    requirements: [{
      id: "requirement-knowledge",
      key: "knowledge:political economy",
      label: "Political economy knowledge",
      aliases: [],
      definition: "Apply political economy to geopolitical decisions.",
      group: "perform_work",
      category: "knowledge",
      importance: "important",
      importanceReason: "Market evidence",
      scope: "shared",
      roleFamilyIds: [],
      successBar: "Can apply political economy to a realistic decision problem.",
      evidenceClaimIds: [],
      confidence: "high",
      context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    }],
    evidenceClaims: [],
    researchQuality: {
      status: "usable",
      sourceCount: 3,
      directSourceCount: 1,
      sourceTypeCount: 2,
      requirementEvidenceCoverage: 100,
      directRequirementCoverage: 50,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function plan(): DevelopmentPlanModel {
  return {
    mode: "development_plan_model",
    version: 1,
    targetLabel: "Geopolitical strategy",
    requirementModelFingerprint: "requirements",
    coverageFingerprint: "coverage",
    sourceContextFingerprint: "context",
    planSummary: "Plan",
    decisions: [{
      requirementId: "requirement-knowledge",
      coverageStatus: "unknown",
      action: "verify",
      scope: "core",
      reason: "Verify first",
      desiredEvidence: "Applied evidence",
      evidenceStillNeeded: ["A relevant output"],
    }],
    workstreams: [{
      id: "workstream-1",
      title: "Learn political economy through a course",
      objective: "Complete training and study the subject.",
      rationale: "A course will address the gap.",
      scopeMix: ["core"],
      requirementIds: ["requirement-knowledge"],
      methods: ["verify"],
      modules: [],
      milestones: [],
      dependencyNotes: [],
      completionStandard: "The course is complete.",
    }],
    maintenanceRequirementIds: [],
    quality: {
      status: "usable",
      coreRequirementCount: 1,
      coveredCoreRequirementCount: 1,
      plannedRequirementCount: 1,
      maintenanceRequirementCount: 0,
      conditionalRequirementCount: 0,
      enhancementRequirementCount: 0,
      unassignedRequirementIds: [],
      caveats: [],
    },
    generatedAt: 1,
  };
}

test("verification guardrails replace stale learning copy", () => {
  const result = alignDevelopmentPlanPresentation(plan(), requirementModel());
  const workstream = result.workstreams[0];

  assert.equal(workstream.title, "Verify current evidence before development");
  assert.match(workstream.objective, /verify current evidence/i);
  assert.doesNotMatch(workstream.rationale, /course/i);
  assert.doesNotMatch(workstream.completionStandard, /course/i);
});

test("valid non-conflicting workstream copy is preserved", () => {
  const value = plan();
  value.decisions[0].coverageStatus = "unproven";
  value.decisions[0].action = "build";
  value.workstreams[0] = {
    ...value.workstreams[0],
    title: "Develop political economy capability",
    objective: "Build applied political economy understanding.",
    rationale: "The requirement needs substantive development.",
    methods: ["learn"],
    completionStandard: "The success bar is met through an applied output.",
  };

  const result = alignDevelopmentPlanPresentation(value, requirementModel());
  assert.equal(result.workstreams[0].title, "Develop political economy capability");
});
