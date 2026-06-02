// ─────────────────────────────────────────────────────────────────────────
// FELLOWSHIP LANE — the MECE fix. A fellowship is an OPPORTUNITY YOU APPLY TO
// (deadline + eligibility gate + application steps), NOT a resource you consume.
// Fellowships live in the jobs/opportunity engine, marked with
// jobs.opportunityKind="fellowship" + roleArchetype="fellowship". This module is
// the tolerant-normalizer (same pattern as networkLanes/capabilityDomains): it
// (a) groups jobs into the "Fellowships" lane vs the paid-roles lane, and (b)
// CONSERVATIVELY identifies which legacy `learn` rows are really fellowships so
// the migration can move them — without ever misclassifying a course.
// ─────────────────────────────────────────────────────────────────────────

export const FELLOWSHIP_KIND = "fellowship" as const;
export const JOB_KIND = "job" as const;

// A job-row is in the Fellowships lane when explicitly marked. opportunityKind is
// authoritative; roleArchetype is a tolerant fallback for rows written before the
// column existed.
export function isFellowshipOpportunity(
  j: { opportunityKind?: string | null; roleArchetype?: string | null },
): boolean {
  if ((j.opportunityKind || "").trim().toLowerCase() === FELLOWSHIP_KIND) return true;
  return (j.roleArchetype || "").trim().toLowerCase() === FELLOWSHIP_KIND;
}

// Known 2026 programs. Used ONLY as a SECONDARY tolerant signal to catch learn
// rows that are really fellowships but were mis-typed (e.g. category
// "Fellowship · WATCH" with no type set). Every token here is a fellowship/
// programme name — none is a course.
const KNOWN_FELLOWSHIP_TOKENS = [
  "horizon", "iaps", "mats", "talos", "govai seasonal", "era:ai", "era fellowship",
  "pivotal", "astra", "impact accelerator", "policy leaders programme",
];

// Phrases that POSITIVELY mark a learn row as a consume-item even if the word
// "fellowship" appears nearby (e.g. "BlueDot AI Governance course"). These guard
// against false positives — a course is LEARN, never a fellowship.
const CONSUME_GUARD = /\bcourse\b|\bbook\b|\bpodcast\b|\bpractice\b|\bread\b/i;

// Decide whether a legacy learn row is REALLY a fellowship that should migrate to
// the opportunity pipeline. PRIMARY, authoritative signal: type === "fellowship".
// SECONDARY tolerant signal (for mis-typed rows): a "fellowship" word in the
// category/title OR a known programme name — but ONLY when the row is not clearly
// a consume-item (course/book/podcast/practice). Conservative by design: when in
// doubt, it stays in Learn.
export function isFellowshipLearnRow(
  l: { type?: string | null; title?: string | null; category?: string | null },
): boolean {
  const type = (l.type || "").trim().toLowerCase();
  // PRIMARY: authoritative trigger.
  if (type === FELLOWSHIP_KIND) return true;
  // A row explicitly typed as a CONSUME kind is NEVER a fellowship. Note: the
  // catch-all default "resource" is NOT in this list — legacy WATCH fellowships
  // were seeded with no type and fall through to "resource", so they must still
  // be reachable by the tolerant signal below.
  if (["course", "book", "podcast", "practice"].includes(type)) return false;

  // SECONDARY (tolerant): mis-typed rows. Require a fellowship signal AND no
  // consume-guard hit, so "BlueDot AI Governance course" is never caught.
  const hay = `${l.title || ""} ${l.category || ""}`.toLowerCase();
  if (CONSUME_GUARD.test(hay)) return false;
  if (/\bfellowship\b|\bfellow\b/.test(hay)) return true;
  if (KNOWN_FELLOWSHIP_TOKENS.some((tok) => hay.includes(tok))) return true;
  return false;
}
