// ─────────────────────────────────────────────────────────────────────────
// FELLOWSHIP MIGRATION — the MECE fix in motion. Legacy `learn` rows that are
// really fellowships (an OPPORTUNITY YOU APPLY TO, not a resource you consume)
// are moved into the jobs/opportunity pipeline as opportunityKind="fellowship".
// Idempotent + conservative: re-running never duplicates (dedupe by title+kind),
// and a course/book/podcast is NEVER misclassified (see isFellowshipLearnRow).
// Reuses the SINGLE db handle from storage — no second connection.
// ─────────────────────────────────────────────────────────────────────────
import { db } from "./storage";
import { jobs, learn } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isFellowshipLearnRow, FELLOWSHIP_KIND } from "@shared/fellowshipLane";

// Derive an eligibility-risk chip from a fellowship's free-text note. Tolerant:
// the seed describes gating in prose ("EU citizenship", "US work authorisation",
// "PhD"), so we map those phrases onto the canonical eligibilityRisk vocabulary.
function deriveEligibilityRisk(hay: string): string {
  const h = hay.toLowerCase();
  if (/\bcitizenship\b|\beu citizen/.test(h)) return "citizenship";
  if (/work auth|work eligib|work auth|visa|\bus\b.*(work|eligib|auth)/.test(h)) return "visa";
  if (/\bphd\b|doctora/.test(h)) return "phd";
  return "";
}

// Is this fellowship's application window CLOSED for the current cycle? The seed
// marks watch items "Fellowship · WATCH" and says "closed" / "reopens" in prose.
// An OPEN one (Impact Accelerator: category "Fellowship · OPEN", live deadline)
// renders normally. Conservative: only treat as closed on a positive signal.
function isClosedWindow(l: { category?: string | null; note?: string | null; learnStatus?: string | null }): boolean {
  const cat = (l.category || "").toLowerCase();
  if (cat.includes("open")) return false;
  if ((l.learnStatus || "").toLowerCase() === "open") return false;
  const hay = `${l.category || ""} ${l.note || ""}`.toLowerCase();
  if (cat.includes("watch") || (l.learnStatus || "").toLowerCase() === "watch") return true;
  return /\bclosed\b|reopens|next window|next cohort|expected ~|set a reminder/.test(hay);
}

// Stable dedupe key: title + kind. A fellowship already present in jobs (by this
// key) is skipped, so the migration is safe to run on every boot.
function normTitle(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export type FellowshipMigrationResult = {
  migrated: number;
  skippedExisting: number;
  movedTitles: string[];
};

// Move every legacy learn row that is REALLY a fellowship into the jobs pipeline,
// then delete the originating learn row so it no longer shows in Learn. Carries
// title/url/note/deadline/relatedTrackId. Sets roleArchetype + opportunityKind to
// "fellowship", and eligibility/window defaults (gated/closed -> wishlist + window
// closed + eligibilityRisk; open ones render normally).
export function migrateFellowshipLearnRows(): FellowshipMigrationResult {
  const learnRows = db.select().from(learn).all();
  const existingJobs = db.select().from(jobs).all();

  // Dedupe set keyed on title+kind so a second run is a no-op.
  const existingFellowshipKeys = new Set(
    existingJobs
      .filter((j) => (j.opportunityKind || "").toLowerCase() === FELLOWSHIP_KIND)
      .map((j) => `${FELLOWSHIP_KIND}:${normTitle(j.title)}`),
  );

  const result: FellowshipMigrationResult = { migrated: 0, skippedExisting: 0, movedTitles: [] };
  const now = Date.now();

  for (const l of learnRows) {
    if (!isFellowshipLearnRow(l)) continue;

    const key = `${FELLOWSHIP_KIND}:${normTitle(l.title)}`;
    if (existingFellowshipKeys.has(key)) {
      // Already migrated in a prior run — just clear the originating learn row.
      result.skippedExisting++;
      db.delete(learn).where(eq(learn.id, l.id)).run();
      continue;
    }

    const closed = isClosedWindow(l);
    const eligibilityRisk = closed ? deriveEligibilityRisk(`${l.category || ""} ${l.note || ""}`) : "";
    const deadline = (l.applicationDeadline || "").trim();

    db.insert(jobs).values({
      title: l.title,
      company: "",
      location: "",
      url: l.url || "",
      note: l.note || "",
      nextStep: "",
      // Closed/gated 2026 fellowships stay "wishlist" (a tracked opportunity) but
      // are marked window-closed so strategy/brain treat them as monitored, not
      // a live application. Open ones render normally with the fellowship rail.
      status: "wishlist",
      deadline,
      flag: closed ? "Watch / closed 2026" : "",
      roleArchetype: FELLOWSHIP_KIND,
      opportunityKind: FELLOWSHIP_KIND,
      eligibilityRisk,
      applicationWindowStatus: closed ? "closed" : "open",
      relatedTrackId: l.relatedTrackId ?? null,
      sourceUrl: l.url || "",
      createdAt: now,
    } as any).run();

    existingFellowshipKeys.add(key);
    db.delete(learn).where(eq(learn.id, l.id)).run();
    result.migrated++;
    result.movedTitles.push(l.title);
  }

  return result;
}
