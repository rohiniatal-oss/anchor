// ─────────────────────────────────────────────────────────────────────────
// CANONICAL DOMAIN STATE — the single source of truth for entity status.
// Server serializers and client badges import from here so status strings are
// never re-derived ad-hoc. Derived fields (tasks.done, learn.done/active) are
// NOT canonical — canonical = status / learnStatus / stage.
// ─────────────────────────────────────────────────────────────────────────
import type { Task, Job, Learn, Contact, Hustle } from "./schema";

// ── Canonical state vocabularies (match shared/schema.ts exactly) ──────────
export const TASK_STATUSES = ["not_started", "in_progress", "stuck", "done"] as const;
export const TASK_READINESS = ["ready", "needs_info", "blocked", "waiting"] as const;
export const TASK_CATEGORIES = ["job", "substack", "interview", "health", "learning", "hustle", "afterline", "admin"] as const;

export const JOB_STATUSES = ["wishlist", "applied", "interviewing", "closed"] as const;
export const JOB_READINESS = ["none", "cv", "cover", "questions", "sample", "referral", "submitted", "follow_up"] as const;
export const JOB_WINDOW_STATUSES = ["open", "rolling", "closing", "closed"] as const;

export const LEARN_STATUSES = ["open", "watch", "active", "applied", "enrolled", "done", "closed"] as const;

export const CONTACT_STATUSES = ["to_contact", "messaged", "replied"] as const;
export const CONTACT_STRENGTHS = ["cold", "warm", "strong"] as const;

export const PROOF_STAGES = ["idea", "testing", "earning"] as const;

export const WIN_CATEGORIES = ["job_progress", "learning", "network", "proof_asset", "mindset", "admin"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskReadiness = (typeof TASK_READINESS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobReadiness = (typeof JOB_READINESS)[number];
export type JobWindowStatus = (typeof JOB_WINDOW_STATUSES)[number];
export type LearnStatus = (typeof LEARN_STATUSES)[number];
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export type ContactStrength = (typeof CONTACT_STRENGTHS)[number];
export type ProofStage = (typeof PROOF_STAGES)[number];
export type WinCategory = (typeof WIN_CATEGORIES)[number];

// ── TASKS — canonical = status; done is derived ────────────────────────────
export function getTaskStatus(t: Pick<Task, "status">): TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(t.status) ? (t.status as TaskStatus) : "not_started";
}
export function isTaskDone(t: Pick<Task, "status">): boolean {
  return getTaskStatus(t) === "done";
}
export function getTaskReadiness(t: Pick<Task, "readiness">): TaskReadiness {
  return (TASK_READINESS as readonly string[]).includes(t.readiness) ? (t.readiness as TaskReadiness) : "ready";
}
export function isTaskBlocked(t: Pick<Task, "readiness" | "blockerReason">): boolean {
  return getTaskReadiness(t) === "blocked" || !!(t.blockerReason && t.blockerReason.trim());
}

// ── JOBS ───────────────────────────────────────────────────────────────────
export function getJobStatus(j: Pick<Job, "status">): JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(j.status) ? (j.status as JobStatus) : "wishlist";
}
export function getJobReadiness(j: Pick<Job, "applicationReadiness">): JobReadiness {
  return (JOB_READINESS as readonly string[]).includes(j.applicationReadiness) ? (j.applicationReadiness as JobReadiness) : "none";
}
export function getJobWindow(j: Pick<Job, "applicationWindowStatus">): JobWindowStatus {
  return (JOB_WINDOW_STATUSES as readonly string[]).includes(j.applicationWindowStatus) ? (j.applicationWindowStatus as JobWindowStatus) : "open";
}
export function isJobLive(j: Pick<Job, "status">): boolean {
  const s = getJobStatus(j);
  return s === "wishlist" || s === "applied" || s === "interviewing";
}

// A fellowship is an opportunity YOU APPLY TO (opportunityKind/roleArchetype
// "fellowship"). Reuse a tolerant check here so domain consumers don't import
// the normalizer for the common case.
export function isFellowship(j: Pick<Job, "opportunityKind" | "roleArchetype">): boolean {
  const kind = (j.opportunityKind || "").trim().toLowerCase();
  if (kind === "fellowship") return true;
  return (j.roleArchetype || "").trim().toLowerCase() === "fellowship";
}

// ACTIONABLE-NOW gate for the brain/strategy. A closed application window means
// the opportunity is monitored, not live — so a watch/closed fellowship (or any
// job whose window is closed) must NOT inflate readiness or be surfaced as a
// live application. status-live AND window-open. This is stricter than isJobLive
// (which is status-only) and is the gate to use when "can she act on it today?"
// matters. Paid roles default applicationWindowStatus="open", so their behaviour
// is unchanged.
export function isOpportunityActionable(
  j: Pick<Job, "status" | "applicationWindowStatus">,
): boolean {
  return isJobLive(j) && getJobWindow(j) !== "closed";
}

// ── LEARN — canonical = learnStatus; done/active are derived ────────────────
export function getLearnStatus(l: Pick<Learn, "learnStatus">): LearnStatus {
  return (LEARN_STATUSES as readonly string[]).includes(l.learnStatus) ? (l.learnStatus as LearnStatus) : "open";
}
export function isLearnDone(l: Pick<Learn, "learnStatus">): boolean {
  return getLearnStatus(l) === "done";
}
export function isLearnActive(l: Pick<Learn, "learnStatus">): boolean {
  const s = getLearnStatus(l);
  return s === "active" || s === "enrolled";
}

// ── LEARN OUTPUT STATE (P4.4) — DERIVED, calm, opt-in. NOT a nag. ────────────
// The rule "every learn item requires an output" is INTENT-DRIVEN: the app never
// assumes it. The DEFAULT for any item is "reference" — a fully valid, SILENT
// state for pure consumption (no warning, no chip pressure). An item only enters
// the proof-building lane when the USER opts in, by either (a) linking it to a
// track as proof-building (relatedTrackId set), OR (b) setting a requiredOutput.
// MECE 3-state:
//   reference  : no requiredOutput AND not track-linked-as-proof. The default.
//   producing  : opted in (requiredOutput set OR track-linked) AND no evidence yet.
//   evidenced  : outputEvidenceUrl present (or a proof_for entityLink — passed in).
export const LEARN_OUTPUT_STATES = ["reference", "producing", "evidenced"] as const;
export type LearnOutputState = (typeof LEARN_OUTPUT_STATES)[number];

// A learn item is "opted in" to the proof-building lane when the user has either
// set an intended output OR linked it to a track as proof-building.
export function isLearnProofOptedIn(l: Pick<Learn, "requiredOutput" | "relatedTrackId">): boolean {
  const hasOutput = !!(l.requiredOutput && l.requiredOutput.trim());
  const trackLinked = l.relatedTrackId != null;
  return hasOutput || trackLinked;
}

export function getLearnOutputState(
  l: Pick<Learn, "requiredOutput" | "relatedTrackId" | "outputEvidenceUrl">,
  hasProofLink = false,
): LearnOutputState {
  const evidenced = !!(l.outputEvidenceUrl && l.outputEvidenceUrl.trim()) || hasProofLink;
  if (evidenced) return "evidenced";
  return isLearnProofOptedIn(l) ? "producing" : "reference";
}

// True only for the SOFT, NON-AMBER reminder: the user linked this to a track as
// proof-building but hasn't given it any output yet. Pure-consumption (reference)
// items are NEVER flagged. Items with a requiredOutput already have their lane.
export function learnNeedsOutputNudge(
  l: Pick<Learn, "requiredOutput" | "relatedTrackId" | "outputEvidenceUrl">,
  hasProofLink = false,
): boolean {
  if (getLearnOutputState(l, hasProofLink) !== "producing") return false;
  const hasOutputIntent = !!(l.requiredOutput && l.requiredOutput.trim());
  return l.relatedTrackId != null && !hasOutputIntent;
}

// ── CONTACTS ────────────────────────────────────────────────────────────────
export function getContactStatus(c: Pick<Contact, "status">): ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(c.status) ? (c.status as ContactStatus) : "to_contact";
}
export function getRelationshipStrength(c: Pick<Contact, "relationshipStrength">): ContactStrength {
  return (CONTACT_STRENGTHS as readonly string[]).includes(c.relationshipStrength) ? (c.relationshipStrength as ContactStrength) : "cold";
}
export function isContactWarm(c: Pick<Contact, "status">): boolean {
  const s = getContactStatus(c);
  return s === "messaged" || s === "replied";
}

// ── HUSTLES (proof assets) ──────────────────────────────────────────────────
export function getProofStage(h: Pick<Hustle, "stage">): ProofStage {
  return (PROOF_STAGES as readonly string[]).includes(h.stage) ? (h.stage as ProofStage) : "idea";
}
export function isProofLive(h: Pick<Hustle, "stage">): boolean {
  return getProofStage(h) !== "idea";
}

// ── Track link accessor — hustles use proofAssetForTrack, others relatedTrackId ─
export type TrackedEntity = "jobs" | "learn" | "contacts" | "hustles" | "tasks";
export function getTrackId(entity: TrackedEntity, row: any): number | null {
  const raw = entity === "hustles" ? row.proofAssetForTrack : row.relatedTrackId;
  return raw == null ? null : Number(raw);
}
