// ─────────────────────────────────────────────────────────────────────────
// JOB PIPELINE TEMPLATES (P4.1) — archetype-keyed seed sequences for a job's
// readiness rail. Steps are SEEDED from here, then individually editable per
// job (add/delete/reorder/rename). One shared map so seeding logic isn't
// duplicated between server and client. The fallback covers unknown/empty
// archetypes. These are seed labels only — they carry no workflow semantics.
// ─────────────────────────────────────────────────────────────────────────

export const JOB_STEP_TEMPLATES: Record<string, string[]> = {
  advisory: [
    "Research org",
    "Draft narrative angle",
    "Tailor CV",
    "Write cover",
    "Get warm intro",
    "Submit",
    "Follow up",
  ],
  ops: [
    "Research JD gaps",
    "Tailor CV",
    "Answer screening Qs",
    "Submit",
    "Follow up",
  ],
  research: [
    "Read recent publications",
    "Draft writing sample",
    "Tailor CV",
    "Submit",
    "Follow up",
  ],
  chief_of_staff: [
    "Map principal's priorities",
    "Tailor CV",
    "Write cover",
    "Submit",
    "Follow up",
  ],
  policy: [
    "Draft policy memo",
    "Tailor CV",
    "Attach proof asset",
    "Submit",
    "Follow up",
  ],
  // Fellowships are OPPORTUNITIES YOU APPLY TO — eligibility FIRST because most
  // are US/EU-gated, then the deadline, then materials, then the application.
  fellowship: [
    "Confirm eligibility",
    "Check/confirm deadline",
    "Prepare materials",
    "Submit application",
    "Follow up",
  ],
};

export const FALLBACK_JOB_STEPS: string[] = [
  "Research role",
  "Tailor CV",
  "Submit",
  "Follow up",
];

// Resolve the seed labels for a job's role archetype, falling back when the
// archetype is unknown or empty.
export function templateForArchetype(roleArchetype: string | null | undefined): string[] {
  const key = (roleArchetype || "").trim();
  return JOB_STEP_TEMPLATES[key] ?? FALLBACK_JOB_STEPS;
}

// P4.6a — DERIVE submit semantics from a step's label (there is no type column).
// The "Submit" step in every template carries the application-submission meaning;
// this is the ONLY deterministic signal (besides the explicit button) allowed to
// advance a job wishlist -> applied. "Follow up" and other steps are NOT submit.
// Matches the submit/apply verb but excludes follow-up phrasing.
export function isSubmitStep(stepLabel: string | null | undefined): boolean {
  const s = (stepLabel || "").trim().toLowerCase();
  if (!s) return false;
  if (/follow[\s-]?up/.test(s)) return false;
  return /\bsubmit\b|\bsubmitted\b|submit application|application submitted/.test(s);
}
