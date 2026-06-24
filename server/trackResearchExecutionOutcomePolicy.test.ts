import assert from "node:assert/strict";
import test from "node:test";
import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import type { RequirementModel } from "./trackResearchRequirementModel";
import type { ExecutionOutcomeRecord } from "./trackResearchExecutionOutcome";
import {
  applyExecutionOutcomeConfirmation,
  buildExecutionCoverageDelta,
  buildExecutionMilestoneProgress,
} from "./trackResearchExecutionOutcomePolicy";

function outcome(kind: ExecutionOutcomeRecord["taskKind"], overrides: Partial<ExecutionOutcomeRecord> = {}): ExecutionOutcomeRecord {
  return {
    id: "outcome-1",
    trackId: 1,
    blueprintFingerprint: "blueprint",
    blueprintTaskId: "task-1",
    liveTaskId: 7,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    requirementIds: ["requirement-1"],
    milestoneIds: ["milestone-1"],
    taskKind: kind,
    taskOwner: "shared",
    status: "pending_confirmation",
    usableForCoverage: false,
    strength: "planned",
    label: "Completed work",
    detail: "The live task was completed.",
    sourceUrl: "",
    expectedEvidence: "A useful output",
    completionStandard: "The output meets the target standard.",
    completedSubtaskIds: [],
    inference: { confidence: "low", basis: "task_state", reason: "Needs confirmation." },
    confirmation: {
      required: true,
      kind: "text",
      question: "What resulted?",
      options: [],
      answer: "",
      answeredAt: null,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function requirementModel(): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "requirements",
    sourceResearchAt: 1,
    target: { label: "Target", definition: "Target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [],
    requirements: [{
      id: "requirement-1",
      key: "skill:requirement",
      label: "Target skill",
      aliases: [],
      definition: "Target skill definition",
      group: "perform_work",
      category: "skill",
      importance: "important",
      importanceReason: "Market evidence",
      scope: "shared",
      roleFamilyIds: [],
      successBar: "Can perform the target skill to the documented standard.",
      evidenceClaimIds: [],
      confidence: "high",
      context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
    }],
    evidenceClaims: [],
    researchQuality: { status: "strong", sourceCount: 4, directSourceCount: 2, sourceTypeCount: 2, requirementEvidenceCoverage: 100, directRequirementCoverage: 50, caveats: [] },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function coverage(status: CoverageStatus): CoverageModel {
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Target",
    requirementModelVersion: 2,
    requirementModelFingerprint: "requirements",
    userEvidenceFingerprint: `evidence-${status}`,
    coverage: [{
      requirementId: "requirement-1",
      status,
      confidence: status === "proven" ? "high" : status === "unknown" ? "low" : "medium",
      evidenceItemIds: [],
      reason: `Coverage is ${status}`,
      successBarAssessment: "Assessment",
      evidenceStillNeeded: status === "proven" ? [] : ["Direct evidence"],
      sourceBasis: "deterministic",
    }],
    evidenceItems: [],
    sourceInventory: { cv: 0, profile_summary: 0, win: 0, learning_output: 0, completed_learning: 0, proof_asset: 0, relationship: 0, interaction: 0 },
    groups: [],
    quality: { status: "usable", assessedRequirementCount: 1, unknownRequirementCount: status === "unknown" ? 1 : 0, citedEvidenceCount: 0, directEvidenceCount: 0, assessmentCoverage: status === "unknown" ? 0 : 100, caveats: [] },
    generatedAt: 1,
  };
}

function developmentPlan(): DevelopmentPlanModel {
  return {
    mode: "development_plan_model",
    version: 1,
    targetLabel: "Target",
    requirementModelFingerprint: "requirements",
    coverageFingerprint: "coverage",
    sourceContextFingerprint: "context",
    planSummary: "Plan",
    decisions: [],
    workstreams: [{
      id: "workstream-1",
      title: "Build capability",
      objective: "Objective",
      rationale: "Rationale",
      scopeMix: ["core"],
      requirementIds: ["requirement-1"],
      methods: ["practice"],
      modules: [],
      milestones: [{
        id: "milestone-1",
        label: "Target skill demonstrated",
        sequence: 1,
        requirementIds: ["requirement-1"],
        doneWhen: "The requirement is proven.",
        evidenceCreated: "A work sample",
      }],
      dependencyNotes: [],
      completionStandard: "Complete",
    }],
    maintenanceRequirementIds: [],
    quality: { status: "strong", coreRequirementCount: 1, coveredCoreRequirementCount: 1, plannedRequirementCount: 1, maintenanceRequirementCount: 0, conditionalRequirementCount: 0, enhancementRequirementCount: 0, unassignedRequirementIds: [], caveats: [] },
    generatedAt: 1,
  };
}

test("inspectable artifact confirmation becomes verified evidence", () => {
  const confirmed = applyExecutionOutcomeConfirmation(outcome("artifact"), {
    resolution: "confirmed",
    answer: "A board-ready policy memo was completed.",
    sourceUrl: "https://example.com/memo",
  });

  assert.equal(confirmed.status, "accepted");
  assert.equal(confirmed.usableForCoverage, true);
  assert.equal(confirmed.strength, "verified");
  assert.equal(confirmed.sourceUrl, "https://example.com/memo");
});

test("artifact text without an inspectable location remains supporting evidence", () => {
  const confirmed = applyExecutionOutcomeConfirmation(outcome("artifact"), {
    resolution: "confirmed",
    answer: "A complete memo was produced but is confidential.",
  });

  assert.equal(confirmed.status, "accepted");
  assert.equal(confirmed.strength, "supporting");
});

test("concrete experience and relationship results become direct evidence", () => {
  const experience = applyExecutionOutcomeConfirmation(outcome("experience"), {
    resolution: "confirmed",
    answer: "Led the scenario analysis and presented the recommendation to the programme director.",
  });
  const relationship = applyExecutionOutcomeConfirmation(outcome("relationship"), {
    resolution: "confirmed",
    answer: "Substantive conversation",
  });

  assert.equal(experience.strength, "direct");
  assert.equal(relationship.strength, "direct");
});

test("no external signal remains outside coverage", () => {
  const confirmed = applyExecutionOutcomeConfirmation(outcome("access"), {
    resolution: "confirmed",
    answer: "No market signal yet",
  });

  assert.equal(confirmed.status, "insufficient");
  assert.equal(confirmed.usableForCoverage, false);
});

test("mistaken completion withdraws prior evidence", () => {
  const accepted = outcome("practice", { status: "accepted", usableForCoverage: true, strength: "direct" });
  const reopened = applyExecutionOutcomeConfirmation(accepted, {
    resolution: "mistaken",
    answer: "Marked complete by mistake",
  });

  assert.equal(reopened.status, "reopened");
  assert.equal(reopened.usableForCoverage, false);
  assert.equal(reopened.strength, "planned");
});

test("coverage delta reports changed and unchanged requirements accurately", () => {
  const changed = buildExecutionCoverageDelta(requirementModel(), coverage("unproven"), coverage("partially_proven"), ["requirement-1"]);
  const unchanged = buildExecutionCoverageDelta(requirementModel(), coverage("partially_proven"), coverage("partially_proven"), ["requirement-1"]);

  assert.equal(changed[0]?.changed, true);
  assert.equal(changed[0]?.afterStatus, "partially_proven");
  assert.equal(unchanged[0]?.changed, false);
});

test("milestones are achieved only when all linked requirements are proven", () => {
  const accepted = outcome("practice", { status: "accepted", usableForCoverage: true, strength: "direct" });
  const partial = buildExecutionMilestoneProgress(developmentPlan(), coverage("partially_proven"), [accepted]);
  const achieved = buildExecutionMilestoneProgress(developmentPlan(), coverage("proven"), [accepted]);

  assert.equal(partial[0]?.status, "in_progress");
  assert.equal(achieved[0]?.status, "achieved");
});

test("pending confirmation cannot manufacture milestone achievement", () => {
  const pending = buildExecutionMilestoneProgress(developmentPlan(), coverage("unproven"), [outcome("experience")]);
  assert.equal(pending[0]?.status, "pending_confirmation");
  assert.equal(pending[0]?.provenRequirementCount, 0);
});
