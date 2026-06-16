// RECOMMENDATION INVENTORY — persistent suggestion objects that can be ranked,
// accepted, rejected, revisited, deduped, and turned into durable execution
// items. This is deliberately separate from tasks: a suggestion is a candidate,
// not yet committed work.

export const RECOMMENDATION_COLLECTIONS = [
  "learning-corpus",
  "network-targets",
  "role-examples",
  "organization-targets",
  "project-ideas",
] as const;

export const RECOMMENDATION_KINDS = [
  "learning-resource",
  "learning-theme",
  "contact-person-type",
  "contact-actual-person",
  "organization-target",
  "role-example",
  "project-idea",
  "next-step-idea",
] as const;

export const RECOMMENDATION_STATUSES = [
  "new",
  "ranked",
  "saved",
  "accepted",
  "rejected",
  "stale",
  "duplicate",
  "archived",
] as const;

export const RECOMMENDATION_SOURCES = [
  "llm",
  "retrieval",
  "manual",
  "deterministic",
  "imported",
] as const;

// Execution shape answers: if the user accepts this suggestion, what kind of
// durable object should it become? This prevents flattening a multi-day course
// or theme into a single disconnected task.
export const EXECUTION_SHAPES = [
  "single-step",
  "sequenced-item",
  "ongoing-program",
] as const;

export const ACCEPTED_ENTITY_TYPES = [
  "task",
  "learn",
  "contact",
  "job",
  "hustle",
] as const;

export type RecommendationCollection = (typeof RECOMMENDATION_COLLECTIONS)[number];
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number];
export type ExecutionShape = (typeof EXECUTION_SHAPES)[number];
export type AcceptedEntityType = (typeof ACCEPTED_ENTITY_TYPES)[number];

// A subdivision is the missing middle layer between a broad theme and tiny
// tasks. Example: "AI governance prep" -> "frontier model governance",
// "EU AI Act", "implementation case studies".
export type RecommendationSubdivision = {
  key: string;
  label: string;
  whyItMatters?: string;
  suggestedMaterials?: string[];
};

// Suggested milestone progression for accepted multi-step items. Each milestone
// is durable and can later map to one or more concrete tasks.
export type RecommendationMilestone = {
  key: string;
  label: string;
  doneWhen: string;
  sequence: number;
  suggestedTaskTitle?: string;
  subdivisionKey?: string;
};

export type RecommendationAcceptanceTarget = {
  entityType: AcceptedEntityType;
  // Draft fields for the eventual accepted object (learn/contact/job/etc.).
  draft: Record<string, unknown>;
};

export type RecommendationRecord = {
  id: string;
  collection: RecommendationCollection;
  kind: RecommendationKind;
  status: RecommendationStatus;
  source: RecommendationSource;
  title: string;
  whySuggested: string;
  linkedTrackId?: number | null;
  linkedGapKey?: string | null;
  linkedCombination?: string | null;
  confidence?: number | null;
  freshnessLabel?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  rankScore?: number | null;
  rankReason?: string | null;
  executionShape: ExecutionShape;
  acceptanceTarget?: RecommendationAcceptanceTarget | null;
  subdivisions?: RecommendationSubdivision[];
  milestones?: RecommendationMilestone[];
  duplicateOfId?: string | null;
  createdAt?: number;
  reviewedAt?: number | null;
  acceptedAt?: number | null;
  rejectedAt?: number | null;
};

// Lightweight helper rules so planners/UIs can stay consistent before the full
// persistence layer exists.
export function recommendationNeedsParentContainer(shape: ExecutionShape): boolean {
  return shape === "sequenced-item" || shape === "ongoing-program";
}

export function recommendationIsTerminal(status: RecommendationStatus): boolean {
  return status === "accepted" || status === "rejected" || status === "archived" || status === "duplicate";
}

export function recommendationPreviewLabel(rec: Pick<RecommendationRecord, "executionShape" | "kind">): string {
  if (rec.executionShape === "ongoing-program") return "multi-session program";
  if (rec.executionShape === "sequenced-item") return "multi-step item";
  if (rec.kind === "learning-theme") return "theme with subtopics";
  return "single next move";
}
