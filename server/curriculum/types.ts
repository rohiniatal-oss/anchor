import { z } from "zod";

// The composer asks the model for a curriculum in this exact shape and validates
// the response with zod before anything is persisted. Two-tier sourcing: "spine"
// sources are load-bearing and flagged for verification; "secondary" sources are
// supporting and marked unverified.
export const SOURCE_TIERS = ["spine", "secondary"] as const;
export const CAPSTONE_SHAPES = ["interview_ready", "published_artifact", "decision_memo", "portfolio_piece"] as const;
export const DAY_STATUSES = ["planned", "completed", "skipped"] as const;
export const MILESTONE_TYPES = ["content", "synthesis", "artifact"] as const;

export const composedSourceSchema = z.object({
  tier: z.enum(SOURCE_TIERS).default("secondary"),
  title: z.string().min(1).max(280),
  author: z.string().max(160).optional().default(""),
  url: z.string().max(600).optional().default(""),
  why: z.string().max(400).optional().default(""),
});

export const composedDaySchema = z.object({
  title: z.string().min(1).max(200),
  focus: z.string().max(280).optional().default(""),
  activity: z.string().max(800).optional().default(""),
  doneWhen: z.string().max(400).optional().default(""),
  hours: z.number().min(0).max(24).optional(),
});

export const composedModuleSchema = z.object({
  weekNumber: z.number().int().min(1).max(104),
  title: z.string().min(1).max(200),
  focus: z.string().max(400).optional().default(""),
  objective: z.string().max(600).optional().default(""),
  sources: z.array(composedSourceSchema).max(20).optional().default([]),
  days: z.array(composedDaySchema).min(1).max(14),
});

export const composedCapstoneSchema = z.object({
  shape: z.enum(CAPSTONE_SHAPES),
  title: z.string().min(1).max(200),
  description: z.string().max(1200).optional().default(""),
  doneWhen: z.string().max(600).optional().default(""),
});

export const composedCurriculumSchema = z.object({
  theme: z.string().min(1).max(200),
  summary: z.string().max(2000).optional().default(""),
  weeks: z.number().int().min(1).max(104),
  hoursPerDay: z.number().min(0).max(24),
  capstone: composedCapstoneSchema,
  modules: z.array(composedModuleSchema).min(1).max(104),
});

export type ComposedSource = z.infer<typeof composedSourceSchema>;
export type ComposedDay = z.infer<typeof composedDaySchema>;
export type ComposedModule = z.infer<typeof composedModuleSchema>;
export type ComposedCapstone = z.infer<typeof composedCapstoneSchema>;
export type ComposedCurriculum = z.infer<typeof composedCurriculumSchema>;

export type ComposeInput = {
  trackId: number;
  weeks: number;
  hoursPerDay: number;
  capstoneShape: (typeof CAPSTONE_SHAPES)[number];
  startDate?: string;
};

// Persisted, hydrated shape returned by the repository/routes.
export type PersistedSource = {
  id: number;
  tier: (typeof SOURCE_TIERS)[number];
  title: string;
  author: string;
  url: string;
  why: string;
  verificationStatus: string;
  verified: boolean;
};

export type PersistedDay = {
  id: number;
  moduleId: number;
  dayIndex: number;
  plannedDate: string;
  title: string;
  focus: string;
  activity: string;
  doneWhen: string;
  hours: number;
  status: (typeof DAY_STATUSES)[number];
  sequence: number;
  completedAt: number | null;
  skippedAt: number | null;
};

export type PersistedModule = {
  id: number;
  weekNumber: number;
  title: string;
  focus: string;
  objective: string;
  sequence: number;
  sources: PersistedSource[];
  days: PersistedDay[];
};

export type PersistedCurriculum = {
  id: number;
  trackId: number;
  theme: string;
  summary: string;
  weeks: number;
  hoursPerDay: number;
  capstoneShape: string;
  status: string;
  startDate: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  capstone: { shape: string; title: string; description: string; doneWhen: string } | null;
  modules: PersistedModule[];
};

export type CurriculumEvent = {
  id: number;
  curriculumId: number;
  eventType: string;
  dayId: number | null;
  payload: Record<string, unknown>;
  createdAt: number;
};
