// The planner prompt. Asks the model for a flat, rolling 10-item horizon across
// the user's active tracks — NO weeks, modules, capstone, or fixed durations.
// The confidence-language table and technique taxonomy are carried over verbatim
// from PR #144 (they were good and are not curriculum-specific).
import type { UpskillIntake } from "./intake";
import { HORIZON_SIZE } from "./types";

// Analytic-technique taxonomy (carried from PR #144). Each non-trivial item's
// afternoon may invoke one technique to produce one artifact.
export const TECHNIQUES: { key: string; description: string }[] = [
  { key: "bluf", description: "State the single most important judgment first, then support it." },
  { key: "issue_map", description: "Decompose a question into its sub-issues, stakeholders, and drivers." },
  { key: "comparison_table", description: "Score options/actors against shared criteria in a structured matrix." },
  { key: "watchlist", description: "Define observable indicators whose movement would change your assessment." },
  { key: "regional_profile", description: "Build a structured profile of a region or actor: interests, capabilities, intent." },
  { key: "synthesis_memo", description: "Integrate multiple sources into one coherent argued memo with a thesis." },
  { key: "scenario_tree", description: "Branch plausible futures from key uncertainties and trace their consequences." },
  { key: "policy_instrument", description: "Design a concrete policy/regulatory instrument and its enforcement mechanics." },
  { key: "ach", description: "Test hypotheses against evidence in an ACH matrix to find the least-disconfirmed." },
  { key: "intelligence_brief", description: "Produce a decision-maker brief: key judgments, confidence, gaps, implications." },
  { key: "calibrated_forecast", description: "Make a probabilistic forecast with explicit base rates and confidence intervals." },
  { key: "osint", description: "Collect, source-grade, and triangulate open-source evidence into a finding." },
];

export const TECHNIQUE_KEYS = TECHNIQUES.map((t) => t.key);

function allocationLine(intake: UpskillIntake): string {
  if (!intake.tracks.length) return "No active tracks.";
  const ratio = intake.tracks.map((t) => `${t.name} (id ${t.id})=${t.weight}`).join(", ");
  return `Allocate the next ${HORIZON_SIZE} items across active tracks roughly in this ratio: ${ratio}. Items may be cross-track if synthesis genuinely serves both — set trackId to the primary track.`;
}

export function buildHorizonPrompt(intake: UpskillIntake): string {
  const trackBlocks = intake.tracks.map((t) =>
    [
      `- Track id ${t.id}: ${t.name} (priority ${t.priority}, share ${t.weight})`,
      t.aspiration ? `  Aspiration (what they are reaching for): ${t.aspiration}` : `  Aspiration: (not set — infer from why-it-fits + target role)`,
      t.targetRoleArchetype ? `  Target role archetype: ${t.targetRoleArchetype}` : ``,
      t.whyItFits ? `  Why it fits: ${t.whyItFits}` : ``,
      t.description ? `  Description: ${t.description}` : ``,
    ].filter(Boolean).join("\n"),
  );

  const completed = intake.recentCompleted.length
    ? intake.recentCompleted.map((c, i) => `  ${i + 1}. ${c.title}${c.phaseLabel ? ` [${c.phaseLabel}]` : ""}`).join("\n")
    : "  (none yet — this is the first horizon)";

  const techniqueLines = TECHNIQUES.map((t) => `  - ${t.key}: ${t.description}`);

  return [
    `You are composing the next rolling horizon of an ONGOING, no-end-date upskilling plan`,
    `for a strategy professional. This is NOT a fixed course: do not produce weeks, modules,`,
    `a capstone, or a fixed duration. Produce exactly ${HORIZON_SIZE} concrete, sequenced plan items`,
    `that advance the user across their active career tracks starting from where they left off.`,
    ``,
    `ACTIVE TRACKS (with what the user is reaching for):`,
    ...trackBlocks,
    ``,
    `MULTI-TRACK BALANCE`,
    `- ${allocationLine(intake)}`,
    ``,
    `USER PROFILE`,
    `- Target roles: ${intake.profile.targetRoles || "(unset)"}`,
    `- Location preferences: ${intake.profile.locationPreferences || "(unset)"}`,
    `- Search phase: ${intake.profile.searchPhase || "(unset)"}`,
    ``,
    `RECENT SIGNALS (behaviour + check-ins — adapt to these)`,
    ...(intake.signals.length ? intake.signals.map((s) => `- ${s}`) : ["- (no recent signals)"]),
    ``,
    `WHERE THEY LEFT OFF (last completed items, most recent last)`,
    completed,
    ``,
    `CURRENT PHASE LABEL: ${intake.currentPhaseLabel || "(none — you may open a new phase)"}`,
    `- Phases are emergent. Continue the current phase if work remains, or transition to a new`,
    `  phaseLabel when the user has built enough foundation. Label each item with its phase.`,
    ``,
    `ITEM SHAPE (each item is one focused working session)`,
    `- title: short imperative name.`,
    `- activity: one-sentence summary of what to do.`,
    `- doneWhen: a concrete completion test.`,
    `- morning: { hours, focus, items[] } — reading with SPECIFIC sources (book chapter ranges, report titles, URLs).`,
    `- afternoon: { hours, focus, items[] } — writing / technique invocation that produces the artifact.`,
    `- sources: [{title, author, url, why}]. For uncertain sources put a "search: ..." query in url; never invent ISBNs/page ranges/editions.`,
    `- artifact: {techniqueKey, title, prompt, wordTarget, saveAs} when the item produces a written artifact (most items). Omit fields if not applicable.`,
    `- rationale: <=300 chars — why this item, why now.`,
    `- trackId: the id of the track this item advances (one of the ids above).`,
    ``,
    `CONFIDENCE LANGUAGE (use ONLY these phrases in any artifact requiring calibration)`,
    `  - "Almost certainly"   — >95%`,
    `  - "Highly likely"      — 80–95%`,
    `  - "Likely / probably"  — 60–80%`,
    `  - "Roughly even odds"  — 45–55%`,
    `  - "Unlikely"           — 20–40%`,
    `  - "Highly unlikely"    — 5–20%`,
    `  - "Remote"             — <5%`,
    `Do NOT invent new confidence phrasings — discipline matters more than novelty.`,
    ``,
    `TECHNIQUE TAXONOMY (an item's afternoon invokes ONE technique → ONE artifact)`,
    ...techniqueLines,
    `- Ramp difficulty: foundational techniques (bluf, issue_map) before advanced (ach, calibrated_forecast, osint).`,
    `- artifact.techniqueKey MUST be one of: ${TECHNIQUE_KEYS.join(", ")}.`,
    ``,
    `Return ONLY valid JSON of this exact shape (no prose, no code fences):`,
    `{`,
    `  "items": [`,
    `    {`,
    `      "trackId": <one of the ids above>,`,
    `      "phaseLabel": "Foundations: regulatory surface",`,
    `      "title": "...",`,
    `      "activity": "one sentence",`,
    `      "doneWhen": "concrete test",`,
    `      "morning": {"hours": 2, "focus": "...", "items": ["EU AI Act, Titles I–III"]},`,
    `      "afternoon": {"hours": 2, "focus": "...", "items": ["Draft the BLUF (300 words)"]},`,
    `      "sources": [{"title": "...", "author": "...", "url": "search: ...", "why": "..."}],`,
    `      "artifact": {"techniqueKey": "bluf", "title": "Artifact: ...", "prompt": "...", "wordTarget": 300, "saveAs": "ai-gov-bluf-01.md"},`,
    `      "rationale": "why this, why now"`,
    `    }`,
    `    // ... exactly ${HORIZON_SIZE} items total`,
    `  ]`,
    `}`,
  ].filter(Boolean).join("\n");
}
