import { z } from "zod";

// The composer asks the model for a curriculum in this exact shape and validates
// the response with zod before anything is persisted. Two-tier sourcing: "spine"
// sources are load-bearing and flagged for verification; "secondary" sources are
// supporting and marked unverified.
export const SOURCE_TIERS = ["spine", "secondary"] as const;
export const CAPSTONE_SHAPES = ["interview_ready", "published_artifact", "decision_memo", "portfolio_piece"] as const;
export const DAY_STATUSES = ["planned", "completed", "skipped"] as const;
export const MILESTONE_TYPES = ["content", "synthesis", "artifact"] as const;
export const STANDING_OBLIGATION_CADENCES = ["weekly_friday", "weekly_monday", "monthly_first_monday"] as const;
export type StandingObligationCadence = (typeof STANDING_OBLIGATION_CADENCES)[number];

export const composedSourceSchema = z.object({
  tier: z.enum(SOURCE_TIERS).default("secondary"),
  title: z.string().min(1).max(280),
  author: z.string().max(160).optional().default(""),
  url: z.string().max(600).optional().default(""),
  why: z.string().max(400).optional().default(""),
});

// A day-block is either morning (reading) or afternoon (writing/technique). The
// shape is the same; the role is implied by which slot it occupies on the day.
export const composedDayBlockSchema = z.object({
  hours: z.number().min(0).max(24).optional(),
  focus: z.string().max(280).optional().default(""),
  items: z.array(z.string().min(1).max(400)).max(12).optional().default([]),
});

// An artifact is the named, technique-driven output of a day's afternoon work.
export const composedArtifactSchema = z.object({
  techniqueKey: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(1200),
  wordTarget: z.number().int().min(0).max(20000).optional(),
  saveAs: z.string().min(1).max(160),
});

export const composedDaySchema = z.object({
  title: z.string().min(1).max(200),
  focus: z.string().max(280).optional().default(""),
  activity: z.string().max(800).optional().default(""),
  doneWhen: z.string().max(400).optional().default(""),
  hours: z.number().min(0).max(24).optional(),
  // Most days carry exactly one artifact; some have none, rarely two.
  artifacts: composedArtifactSchema.array().max(3).optional().default([]),
  // Optional morning + afternoon blocks. When present, these are the source of
  // truth and `activity` is a one-sentence summary. When absent (legacy canned
  // responses in tests), `activity` remains the source of truth.
  morning: composedDayBlockSchema.optional(),
  afternoon: composedDayBlockSchema.optional(),
});

export const composedModuleSchema = z.object({
  weekNumber: z.number().int().min(1).max(104),
  title: z.string().min(1).max(200),
  // Modules stay flat under the curriculum but carry a back-reference to which
  // phase they belong to (Foundations → Deep-dive → Mastery → Capstone). This is
  // the pragmatic alternative to a nested phases[] array (see composer prompt).
  phaseTitle: z.string().max(120).optional().default(""),
  focus: z.string().max(400).optional().default(""),
  objective: z.string().max(600).optional().default(""),
  rationale: z.string().max(300).optional().default(""),
  sources: z.array(composedSourceSchema).max(20).optional().default([]),
  days: z.array(composedDaySchema).min(1).max(14),
});

export const composedCapstoneSchema = z.object({
  shape: z.enum(CAPSTONE_SHAPES),
  title: z.string().min(1).max(200),
  description: z.string().max(1200).optional().default(""),
  doneWhen: z.string().max(600).optional().default(""),
});

export const composedStandingObligationSchema = z.object({
  cadence: z.enum(STANDING_OBLIGATION_CADENCES),
  title: z.string().min(1).max(200),
  doneWhen: z.string().max(400).optional().default(""),
});

export const composedMilestoneSchema = z.object({
  atDayIndex: z.number().int().min(1).max(2000),
  label: z.string().min(1).max(200),
  whatGoodLooksLike: z.string().min(1).max(600),
});

export const composedCurriculumSchema = z.object({
  theme: z.string().min(1).max(200),
  summary: z.string().max(2000).optional().default(""),
  weeks: z.number().int().min(1).max(104),
  hoursPerDay: z.number().min(0).max(24),
  rationale: z.string().max(300).optional().default(""),
  capstone: composedCapstoneSchema,
  modules: z.array(composedModuleSchema).min(1).max(104),
  standingObligations: z.array(composedStandingObligationSchema).max(8).optional().default([]),
  milestones: z.array(composedMilestoneSchema).max(12).optional().default([]),
});

export type ComposedArtifact = z.infer<typeof composedArtifactSchema>;
export type ComposedSource = z.infer<typeof composedSourceSchema>;
export type ComposedDay = z.infer<typeof composedDaySchema>;
export type ComposedModule = z.infer<typeof composedModuleSchema>;
export type ComposedCapstone = z.infer<typeof composedCapstoneSchema>;
export type ComposedCurriculum = z.infer<typeof composedCurriculumSchema>;
export type ComposedDayBlock = z.infer<typeof composedDayBlockSchema>;
export type ComposedStandingObligation = z.infer<typeof composedStandingObligationSchema>;
export type ComposedMilestone = z.infer<typeof composedMilestoneSchema>;

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

export type PersistedArtifact = {
  id: number;
  curriculumId: number;
  dayId: number;
  artifactNumber: number;
  techniqueKey: string;
  title: string;
  prompt: string;
  wordTarget: number | null;
  saveAs: string;
  status: string;
  draft: string;
  createdAt: number;
  submittedAt: number | null;
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
  dayPlanItemId: number | null;
  morning: ComposedDayBlock | null;
  afternoon: ComposedDayBlock | null;
  artifacts: PersistedArtifact[];
};

export type PersistedModule = {
  id: number;
  weekNumber: number;
  phaseTitle: string;
  title: string;
  focus: string;
  objective: string;
  rationale: string;
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
  standingObligations: ComposedStandingObligation[];
  milestones: ComposedMilestone[];
};

export type CurriculumEvent = {
  id: number;
  curriculumId: number;
  eventType: string;
  dayId: number | null;
  payload: Record<string, unknown>;
  createdAt: number;
};
