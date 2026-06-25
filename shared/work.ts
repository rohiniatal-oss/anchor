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

export type WorkType = z.infer<typeof workTypeSchema>;
export type WorkScope = z.infer<typeof workScopeSchema>;
export type WorkConfidence = z.infer<typeof workConfidenceSchema>;
export type CandidateParent = z.infer<typeof candidateParentSchema>;
