import { z } from "zod";

export const workTypeSchema = z.enum(["project", "milestone", "task", "decision", "reference"]);
export const workScopeSchema = z.enum(["single_action", "single_session", "multi_session", "multi_week"]);
export const workConfidenceSchema = z.enum(["high", "medium", "low"]);

export const candidateParentSchema = z.object({
  projectId: z.number().int().positive(),
  projectTitle: z.string().min(1),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).nullable().optional();

export const workDefinitionSchema = z.object({
  version: z.literal(1),
  workType: workTypeSchema,
  title: z.string().min(1).max(180),
  objective: z.string().min(1).max(1000),
  whyNow: z.string().max(1000).default(""),
  desiredOutcome: z.string().min(1).max(1000),
  successCriteria: z.array(z.string().min(1).max(400)).max(8).default([]),
  deliverables: z.array(z.string().min(1).max(400)).max(8).default([]),
  constraints: z.array(z.string().min(1).max(400)).max(8).default([]),
  assumptions: z.array(z.string().min(1).max(500)).max(8).default([]),
  estimatedScope: workScopeSchema,
  confidence: workConfidenceSchema,
  parentDirectionId: z.number().int().positive().nullable().optional(),
  candidateParent: candidateParentSchema,
  needsClarification: z.boolean().default(false),
  clarifyingQuestion: z.string().max(500).default(""),
  sourceTitle: z.string().max(300).default(""),
  sourceType: z.string().max(80).default("capture"),
  sourceId: z.number().int().positive().nullable().optional(),
});

export const actionStepSchema = z.object({
  text: z.string().min(1).max(500),
  done: z.boolean().default(false),
  outputSpec: z.string().max(500).default(""),
  executor: z.enum(["system", "user_action", "user_learning"]).default("user_action"),
});

export const taskProposalSchema = z.object({
  title: z.string().min(1).max(180),
  objective: z.string().min(1).max(800),
  doneWhen: z.string().min(1).max(800),
  output: z.string().min(1).max(800),
  whyNow: z.string().max(800).default(""),
  estimateMinutes: z.number().int().min(5).max(480).default(30),
  category: z.string().max(80).default("admin"),
});

export const milestoneProposalSchema = z.object({
  key: z.string().min(1).max(100),
  title: z.string().min(1).max(180),
  outcome: z.string().min(1).max(800),
  doneWhen: z.string().min(1).max(800),
  sequence: z.number().int().min(0),
});

export const projectDecompositionSchema = z.object({
  version: z.literal(1),
  projectTitle: z.string().min(1).max(180),
  milestones: z.array(milestoneProposalSchema).min(2).max(7),
  currentMilestoneKey: z.string().min(1).max(100),
  currentTasks: z.array(taskProposalSchema).min(1).max(3),
  activeTaskIndex: z.number().int().min(0).max(2).default(0),
  activeTaskSteps: z.array(actionStepSchema).min(1).max(6),
  rollingPlan: z.literal(true),
  stopCondition: z.string().min(1).max(800),
});

export const taskDecompositionSchema = z.object({
  version: z.literal(1),
  task: taskProposalSchema,
  steps: z.array(actionStepSchema).min(1).max(6),
  rollingPlan: z.literal(false),
});

export const workDecompositionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), project: projectDecompositionSchema }),
  z.object({ kind: z.literal("task"), task: taskDecompositionSchema }),
]);

export type WorkType = z.infer<typeof workTypeSchema>;
export type WorkScope = z.infer<typeof workScopeSchema>;
export type WorkConfidence = z.infer<typeof workConfidenceSchema>;
export type CandidateParent = z.infer<typeof candidateParentSchema>;
export type WorkDefinition = z.infer<typeof workDefinitionSchema>;
export type ActionStep = z.infer<typeof actionStepSchema>;
export type TaskProposal = z.infer<typeof taskProposalSchema>;
export type MilestoneProposal = z.infer<typeof milestoneProposalSchema>;
export type ProjectDecomposition = z.infer<typeof projectDecompositionSchema>;
export type TaskDecomposition = z.infer<typeof taskDecompositionSchema>;
export type WorkDecomposition = z.infer<typeof workDecompositionSchema>;
