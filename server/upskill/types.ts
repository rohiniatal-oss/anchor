// Zod contracts for the ongoing upskill subsystem. The planner returns a horizon
// of plan items; these schemas validate the model output before anything is
// persisted. Unlike PR #144 there are no weeks/modules/capstone shapes here —
// the horizon is a flat, rolling list of items tagged with an emergent phase.
import { z } from "zod";

export const blockSchema = z.object({
  hours: z.number().min(0).max(24).optional().default(0),
  focus: z.string().default(""),
  items: z.array(z.string()).default([]),
});

export const sourceSchema = z.object({
  title: z.string().default(""),
  author: z.string().default(""),
  url: z.string().default(""),
  why: z.string().default(""),
});

export const artifactSchema = z.object({
  techniqueKey: z.string().optional(),
  title: z.string().optional(),
  prompt: z.string().optional(),
  wordTarget: z.number().optional(),
  saveAs: z.string().optional(),
});

// One item as the planner emits it. trackId references one of the active tracks
// passed into the prompt. Persistence/ids/status are added by the repository.
export const horizonItemSchema = z.object({
  trackId: z.coerce.number().int(),
  phaseLabel: z.string().default(""),
  title: z.string().min(1),
  activity: z.string().min(1),
  doneWhen: z.string().min(1),
  morning: blockSchema.optional().default({ hours: 0, focus: "", items: [] }),
  afternoon: blockSchema.optional().default({ hours: 0, focus: "", items: [] }),
  sources: z.array(sourceSchema).default([]),
  artifact: artifactSchema.optional().default({}),
  rationale: z.string().default(""),
});

export const upskillHorizonSchema = z.object({
  items: z.array(horizonItemSchema).min(1).max(20),
});

export type Block = z.infer<typeof blockSchema>;
export type HorizonSource = z.infer<typeof sourceSchema>;
export type HorizonArtifact = z.infer<typeof artifactSchema>;
export type HorizonItem = z.infer<typeof horizonItemSchema>;
export type UpskillHorizon = z.infer<typeof upskillHorizonSchema>;

export const checkinInputSchema = z.object({
  trackId: z.coerce.number().int().positive().optional(),
  whatsWorking: z.string().default(""),
  whatsNot: z.string().default(""),
  wantToDrop: z.string().default(""),
  wantToAdd: z.string().default(""),
  energy: z.enum(["low", "normal", "high"]).default("normal"),
  rawNote: z.string().default(""),
});

export type CheckinInput = z.infer<typeof checkinInputSchema>;

// Auto-recompose thresholds (see planner.ts / materializer.ts).
export const RECOMPOSE_AFTER_COMPLETED = 5;
export const RECOMPOSE_AFTER_SKIPPED = 3;
export const HORIZON_SIZE = 10;
