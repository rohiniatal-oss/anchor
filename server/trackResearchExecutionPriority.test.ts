import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@shared/schema";
import type { CoverageModel, CoverageStatus } from "./trackResearchCoverageModel";
import type { DevelopmentModule, DevelopmentPlanModel, DevelopmentWorkstream } from "./trackResearchDevelopmentPlan";
import { buildExecutionBlueprintDraft } from "./trackResearchExecutionBlueprint";
import {
  blueprintTaskIdFromLiveTask,
  blueprintTaskSourceStepType,
  buildExecutionPriorityModel,
  executionPriorityContextFingerprint,
  MAX_ACTIVE_USER_TASKS,
  type ExecutionActivationState,
  type ExecutionPriorityContext,
} from "./trackResearchExecutionPriority";
import type { RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";

function requirement(id: string, importance: TargetRequirement["importance"] = "important"): TargetRequirement {
  return {
    id,
    key: `skill:${id}`,
    label: id.replace(/-/g, " "),
    aliases: [],
    definition: `${id} for the target role`,
    group: "perform_work",
    category: "skill",
    importance,
    importanceReason: "Repeated target requirement",
    scope: "shared",
    roleFamilyIds: [],
    successBar: `Can demonstrate ${id} at the target standard.`,
    evidenceClaimIds: [],
    confidence: "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
  };
}

function requirementModel(requirements: TargetRequirement[]): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "market-source-fingerprint",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Chosen target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: [],
    groups: [
      { id: "perform_work", label: "Perform", description: "", requirementIds: requirements.map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate", description: "", requirementIds: [] },
      { id: "access_opportunity", label: "Access", description: "", requirementIds: [] },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: {
      status: "strong",
      sourceCount: 8,
      directSourceCount: 4,
      sourceTypeCount: 3,
      requirementEvidenceCoverage: 100,
      directRequirementCoverage: 80,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function coverageModel(requirements: TargetRequirement[], status: CoverageStatus = "unproven"): CoverageModel {
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Geopolitical strategy",
    requirementModelVersion: 2,
    requirementModelFingerprint: "exact-requirement-fingerprint",
    userEvidenceFingerprint: "evidence-fingerprint",
    coverage: requirements.map((item) => ({
      requirementId: item.id,
      status,
      confidence: status === "unknown" ? "low" : "medium",
      evidenceItemIds: [],
      reason: `Coverage is ${status}`,
      successBarAssessment: "Compared with the success bar",
      evidenceStillNeeded: status === "proven" ? [] : [`Evidence for ${item.id}`],
      sourceBasis: "llm",
    })),
    evidenceItems: [],
    sourceInventory: { cv: 1, profile_summary: 0, win: 0, learning_output: 0, completed_learning: 0, proof_asset: 0, relationship: 0, interaction: 0 },
    groups: [],
    quality: { status: "usable", assessedRequirementCount: requirements.length, unknownRequirementCount: 0, citedEvidenceCount: 0, directEvidenceCount: 0, assessmentCoverage: 100, caveats: [] },
    generatedAt: 1,
  };
}

function module(id: string, type: DevelopmentModule["type"], requirementIds: string[], scope: DevelopmentModule["scope"] = "core"): DevelopmentModule {
  return {
    id,
    title: id.replace(/-/g, " "),
    type,
    scope,
    objective: `Develop ${id}`,
    requirementIds,
    resources: [],
    activities: [`Apply ${id}`],
    output: `Output for ${id}`,
    assessmentCriteria: requirementIds.map((requirementId) => `Success bar for ${requirementId}`),
  };
}

function workstream(id: string, modules: DevelopmentModule[]): DevelopmentWorkstream {
  const requirementIds = [...new Set(modules.flatMap((item) => item.requirementIds))];
  return {
    id,
    title: id.replace(/-/g, " "),
    objective: `Objective for ${id}`,
    rationale: "Related work",
    scopeMix: [...new Set(modules.map((item) => item.scope))],
    requirementIds,
    methods: [],
    modules,
    milestones: [{
      id: `${id}-milestone`,
      label: `${id} complete`,
      sequence: 1,
      requirementIds,
      doneWhen: "The linked success bars are met.",
      evidenceCreated: "Reusable evidence",
    }],
    dependencyNotes: [],
    completionStandard: "Requirements evidenced",
  };
}

function developmentPlan(workstreams: DevelopmentWorkstream[]): DevelopmentPlanModel {
  const requirementIds = [...new Set(workstreams.flatMap((item) => item.requirementIds))];
  return {
    mode: "development_plan_model",
    version: 1,
    targetLabel: "Geopolitical strategy",
    requirementModelFingerprint: "exact-requirement-fingerprint",
    coverageFingerprint: "coverage-fingerprint",
    sourceContextFingerprint: "context-fingerprint",
    planSummary: "Build the remaining requirements.",
    decisions: requirementIds.map((requirementId) => ({
      requirementId,
      coverageStatus: "unproven",
      action: "build",
      scope: "core",
      reason: "Not yet evidenced",
      desiredEvidence: `Evidence for ${requirementId}`,
      evidenceStillNeeded: [`Evidence for ${requirementId}`],
    })),
    workstreams,
    maintenanceRequirementIds: [],
    quality: {
      status: "strong",
      coreRequirementCount: requirementIds.length,
      coveredCoreRequirementCount: requirementIds.length,
      plannedRequirementCount: requirementIds.length,
      maintenanceRequirementCount: 0,
      conditionalRequirementCount: 0,
      enhancementRequirementCount: 0,
      unassignedRequirementIds: [],
      caveats: [],
    },
    generatedAt: 1,
  };
}

function context(overrides: Partial<ExecutionPriorityContext> = {}): ExecutionPriorityContext {
  return {
    trackId: 7,
    tasks: [],
    jobs: [],
    learn: [],
    contacts: [],
    dayPlan: null,
    activationState: null,
    ...overrides,
  };
}

function liveTask(blueprintTaskId: string, overrides: Partial<Task> = {}): Task {
  return {
    id: 101,
    title: "Existing blueprint task",
    list: "today",
    block: null,
    done: false,
    pinned: true,
    steps: "[]",
    sort: 0,
    category: "learning",
    deadline: "",
    size: "medium",
    status: "in_progress",
    skipped: 0,
    doneWhen: "Done",
    source: "coach",
    sourceType: "career_track",
    sourceId: 7,
    sourceStepType: blueprintTaskSourceStepType(blueprintTaskId),
    sourceStepId: null,
    sourceUrl: "",
    sourceNote: "",
    sourceStatus: "execution_active_slice",
    planItemId: null,
    relatedTrackId: 7,
    relatedOpportunityId: null,
    parentTaskId: null,
    dependsOn: "[]",
    blocks: "[]",
    blockedBy: "",
    blockerReason: "",
    readiness: "ready",
    minimumOutcome: "Minimum",
    stretchOutcome: "Evidence",
    estimateMinutes: 45,
    estimateConfidence: "med",
    estimateReason: "Blueprint",
    actualMinutes: null,
    createdAt: 1,
    ...overrides,
  };
}

test("the active slice never exceeds three user-visible tasks", () => {
  const requirements = [1, 2, 3, 4, 5].map((id) => requirement(`req-${id}`));
  const plan = developmentPlan(requirements.map((item, index) => workstream(`workstream-${index}`, [module(`module-${index}`, "experience", [item.id])])));
  const blueprint = buildExecutionBlueprintDraft(plan);
  const model = buildExecutionPriorityModel(blueprint, requirementModel(requirements), coverageModel(requirements), plan, context());

  assert.ok(model.activeSlice.filter((item) => item.owner !== "anchor").length <= MAX_ACTIVE_USER_TASKS);
  assert.equal(model.quality.userTaskLimitExceeded, false);
  assert.deepEqual(model.quality.selectedBlockedTaskIds, []);
  assert.deepEqual(model.quality.selectedConditionalTaskIds, []);
  assert.equal(model.policy.scheduleCreated, false);
});

test("an existing in-progress task is continued rather than duplicated", () => {
  const req = requirement("req-writing", "essential");
  const plan = developmentPlan([workstream("workstream-writing", [module("module-writing", "practice", [req.id])])]);
  const blueprint = buildExecutionBlueprintDraft(plan);
  const mapped = liveTask(blueprint.tasks[0].id);
  const model = buildExecutionPriorityModel(blueprint, requirementModel([req]), coverageModel([req]), plan, context({ tasks: [mapped] }));
  const selected = model.activeSlice.find((item) => item.blueprintTaskId === blueprint.tasks[0].id);

  assert.ok(selected);
  assert.equal(selected?.action, "continue_live_task");
  assert.equal(selected?.liveTaskId, mapped.id);
  assert.equal(selected?.slot, "now");
  assert.equal(model.summary.activeLiveTasks, 1);
});

test("conditional role-specific tasks are excluded from automatic activation", () => {
  const req = requirement("req-route");
  const plan = developmentPlan([workstream("workstream-route", [module("module-route", "practice", [req.id], "conditional")])]);
  const blueprint = buildExecutionBlueprintDraft(plan);
  const model = buildExecutionPriorityModel(blueprint, requirementModel([req]), coverageModel([req]), plan, context());

  assert.equal(model.summary.conditionalTasks, blueprint.tasks.length);
  assert.equal(model.activeSlice.length, 0);
});

test("an Anchor-completed preparation unlocks the next user task", () => {
  const req = requirement("req-knowledge", "essential");
  const plan = developmentPlan([workstream("workstream-learning", [module("module-learning", "syllabus", [req.id])])]);
  const blueprint = buildExecutionBlueprintDraft(plan);
  const first = blueprint.tasks[0];
  const next = blueprint.tasks.find((task) => task.dependsOnTaskIds.includes(first.id));
  assert.ok(next);
  const activationState: ExecutionActivationState = {
    mode: "execution_activation_state",
    version: 1,
    blueprintFingerprint: blueprint.sourceFingerprint,
    records: [{
      blueprintTaskId: first.id,
      blueprintFingerprint: blueprint.sourceFingerprint,
      status: "completed_by_anchor",
      liveTaskId: null,
      preparation: null,
      error: "",
      updatedAt: 2,
    }],
    generatedAt: 2,
  };
  const model = buildExecutionPriorityModel(blueprint, requirementModel([req]), coverageModel([req]), plan, context({ activationState }));

  assert.ok(model.completedBlueprintTaskIds.includes(first.id));
  assert.ok(model.activeSlice.some((item) => item.blueprintTaskId === next?.id));
});

test("deadline pressure raises relevant access work", () => {
  const access = requirement("req-access", "essential");
  access.category = "access";
  access.group = "access_opportunity";
  const skill = requirement("req-skill", "important");
  const plan = developmentPlan([
    workstream("workstream-access", [module("module-access", "access", [access.id])]),
    workstream("workstream-skill", [module("module-skill", "practice", [skill.id])]),
  ]);
  const blueprint = buildExecutionBlueprintDraft(plan);
  const deadline = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const model = buildExecutionPriorityModel(
    blueprint,
    requirementModel([access, skill]),
    coverageModel([access, skill]),
    plan,
    context({ jobs: [{ id: 1, relatedTrackId: 7, status: "wishlist", deadline, applicationWindowStatus: "open" } as any] }),
  );
  const accessTaskIds = new Set(blueprint.tasks.filter((task) => task.kind === "access").map((task) => task.id));

  assert.ok(model.activeSlice.some((item) => accessTaskIds.has(item.blueprintTaskId)));
});

test("task source mapping is stable and context fingerprints change with completion", () => {
  const req = requirement("req-writing");
  const plan = developmentPlan([workstream("workstream-writing", [module("module-writing", "practice", [req.id])])]);
  const blueprint = buildExecutionBlueprintDraft(plan);
  const taskId = blueprint.tasks[0].id;
  const open = liveTask(taskId, { done: false, status: "in_progress" });
  const done = liveTask(taskId, { done: true, status: "done" });

  assert.equal(blueprintTaskIdFromLiveTask(open), taskId);
  const first = executionPriorityContextFingerprint(blueprint, context({ tasks: [open] }));
  const second = executionPriorityContextFingerprint(blueprint, context({ tasks: [done] }));
  assert.notEqual(first, second);
});
