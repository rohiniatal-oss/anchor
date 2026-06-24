import assert from "node:assert/strict";
import test from "node:test";
import type { DevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import { buildExecutionBlueprintDraft } from "./trackResearchExecutionBlueprint";
import {
  applyExecutionBlueprintSynthesis,
  sanitizeExecutionBlueprintSynthesis,
} from "./trackResearchExecutionSynthesis";

function developmentPlan(): DevelopmentPlanModel {
  return {
    mode: "development_plan_model",
    version: 1,
    targetLabel: "AI governance",
    requirementModelFingerprint: "requirements",
    coverageFingerprint: "coverage",
    sourceContextFingerprint: "context",
    planSummary: "Build and demonstrate AI governance capability.",
    decisions: [{
      requirementId: "req-writing",
      coverageStatus: "partially_proven",
      action: "strengthen",
      scope: "core",
      reason: "Relevant evidence exists but does not meet the bar.",
      desiredEvidence: "A decision-ready AI governance memo.",
      evidenceStillNeeded: ["An inspectable memo"],
    }],
    workstreams: [{
      id: "workstream-proof",
      title: "Create credible proof",
      objective: "Produce an inspectable AI governance memo.",
      rationale: "One output can demonstrate several capabilities.",
      scopeMix: ["core"],
      requirementIds: ["req-writing"],
      methods: ["create_proof"],
      modules: [{
        id: "module-proof",
        title: "AI governance memo",
        type: "proof",
        scope: "core",
        objective: "Produce a decision-ready AI governance memo.",
        requirementIds: ["req-writing"],
        resources: [],
        activities: ["Define the claim", "Draft the memo", "Review it"],
        output: "A decision-ready AI governance memo.",
        assessmentCriteria: ["The memo is concise, sourced and decision-relevant."],
      }],
      milestones: [{
        id: "milestone-proof",
        label: "Memo completed",
        sequence: 1,
        requirementIds: ["req-writing"],
        doneWhen: "The memo meets the assessment criteria.",
        evidenceCreated: "An inspectable memo.",
      }],
      dependencyNotes: [],
      completionStandard: "The memo is complete and reusable.",
    }],
    maintenanceRequirementIds: [],
    quality: {
      status: "strong",
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

test("refinement can improve wording without changing the blueprint structure", () => {
  const draft = buildExecutionBlueprintDraft(developmentPlan());
  const task = draft.tasks[0];
  const subtask = task.subtasks[0];
  const refined = applyExecutionBlueprintSynthesis(draft, {
    blueprintLogic: "Turn the proof module into a sequence of finite evidence-producing tasks.",
    taskRefinements: [{
      taskId: task.id,
      title: "Define the decision question and evidence standard for the AI governance memo",
      doneWhen: "The decision question, audience and acceptance rubric are explicit.",
      minimumOutcome: "The decision question and audience are agreed.",
      expectedEvidence: "A concise evidence-backed memo brief.",
      subtasks: [{
        subtaskId: subtask.id,
        title: "Specify the policy decision the memo must inform",
        outputSpec: "One decision question and the decision-maker it serves.",
        doneWhen: "The memo has a concrete decision purpose.",
      }],
    }],
  });

  assert.equal(refined.tasks.length, draft.tasks.length);
  assert.equal(refined.tasks[0].id, task.id);
  assert.equal(refined.tasks[0].kind, task.kind);
  assert.equal(refined.tasks[0].owner, task.owner);
  assert.deepEqual(refined.tasks[0].dependsOnTaskIds, task.dependsOnTaskIds);
  assert.equal(refined.tasks[0].subtasks[0].executor, subtask.executor);
  assert.equal(refined.tasks[0].subtasks[0].condition, subtask.condition);
  assert.match(refined.tasks[0].title, /decision question/i);
});

test("invented task and subtask IDs are ignored", () => {
  const draft = buildExecutionBlueprintDraft(developmentPlan());
  const firstTask = draft.tasks[0];
  const refined = applyExecutionBlueprintSynthesis(draft, {
    taskRefinements: [
      {
        taskId: "invented-task",
        title: "Invented task",
        subtasks: [],
      },
      {
        taskId: firstTask.id,
        subtasks: [{
          subtaskId: "invented-subtask",
          title: "Invented subtask",
          outputSpec: "Invented output",
          doneWhen: "Invented condition",
        }],
      },
    ],
  });

  assert.equal(refined.tasks.length, draft.tasks.length);
  assert.equal(refined.tasks[0].title, firstTask.title);
  assert.deepEqual(refined.tasks[0].subtasks, firstTask.subtasks);
});

test("malformed collection shapes are sanitized at the trust boundary", () => {
  const sanitized = sanitizeExecutionBlueprintSynthesis({
    blueprintLogic: "Valid logic",
    taskRefinements: "not-an-array",
    qualityNotes: { value: "not-an-array" },
  });

  assert.ok(sanitized);
  assert.deepEqual(sanitized?.taskRefinements, []);
  assert.deepEqual(sanitized?.qualityNotes, []);
});

test("refinement cannot change materialization state or create priorities", () => {
  const draft = buildExecutionBlueprintDraft(developmentPlan());
  const task = draft.tasks[0];
  const raw: any = {
    taskRefinements: [{
      taskId: task.id,
      title: "Refined title",
      priority: 100,
      scheduledFor: "tomorrow",
      materialization: { state: "materialized" },
      subtasks: [],
    }],
  };
  const refined = applyExecutionBlueprintSynthesis(draft, sanitizeExecutionBlueprintSynthesis(raw));

  assert.equal(refined.materializationStatus, "blueprint_only");
  assert.equal(refined.tasks[0].materialization.state, "blueprint_only");
  assert.equal((refined.tasks[0] as any).priority, undefined);
  assert.equal((refined.tasks[0] as any).scheduledFor, undefined);
});
