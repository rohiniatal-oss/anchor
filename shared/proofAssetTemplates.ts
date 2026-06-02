// ─────────────────────────────────────────────────────────────────────────
// PROOF ASSET TEMPLATES (P4.3) — kind-keyed seed sequences for a proof asset's
// proof-production rail. Steps are SEEDED from here, then individually editable
// per asset (add/delete/reorder/rename) — the SAME SEED-THEN-EDIT pattern as
// shared/jobTemplates.ts. Asset KIND is DERIVED (not a stored column) from the
// hustle's title/contentPillar/coreClaim via classifyProofAsset; "memo" is the
// catch-all default. These are CAREER-PROOF / credibility systems, NOT
// side-income ventures — the labels reflect producing the next public output.
// ─────────────────────────────────────────────────────────────────────────

export type ProofAssetKind = "substack" | "afterline" | "memo";

// Substack is framed as GEOPOLITICS writing (explicitly NOT AI). Afterline is
// an ACTIVE product (NOT parked). Memo is the standalone written-proof default
// (AI-Gov Memo / Forecasting Log).
export const PROOF_ASSET_STEP_TEMPLATES: Record<ProofAssetKind, string[]> = {
  substack: [
    "Pick pillar",
    "Draft post 1",
    "Publish",
    "Grow 50 subs",
    "Pitch guest post",
    "Monetise",
  ],
  afterline: [
    "Ship MVP",
    "Get 5 users",
    "Collect testimonial",
    "Case-study write-up",
    "Conference demo pitch",
  ],
  memo: [
    "Identify claim",
    "Research",
    "Draft",
    "Publish/share",
    "Track citations",
  ],
};

// Kind label shown on the card badge.
export const PROOF_ASSET_KIND_LABEL: Record<ProofAssetKind, string> = {
  substack: "Substack",
  afterline: "Afterline",
  memo: "Memo",
};

// Derive the asset kind from existing fields (title/contentPillar/coreClaim).
// Substack and Afterline win on a name/keyword match; everything else is a
// memo (the catch-all default). Pure function so server seeding and client
// card layout classify identically.
export function classifyProofAsset(
  a: { title?: string | null; contentPillar?: string | null; coreClaim?: string | null },
): ProofAssetKind {
  const hay = `${a.title || ""} ${a.contentPillar || ""} ${a.coreClaim || ""}`.toLowerCase();
  if (/substack|newsletter|geopolit/.test(hay)) return "substack";
  if (/afterline|mvp|product|app|case[\s-]?study/.test(hay)) return "afterline";
  return "memo";
}

// Resolve the seed labels for a proof asset's derived kind.
export function templateForProofAsset(
  a: { title?: string | null; contentPillar?: string | null; coreClaim?: string | null },
): string[] {
  return PROOF_ASSET_STEP_TEMPLATES[classifyProofAsset(a)];
}
