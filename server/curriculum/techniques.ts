// Canonical analytic-technique taxonomy for living curricula. Techniques are the
// repeatable thinking moves a day's afternoon invokes to produce one artifact.
// They are ordered by difficulty; `introduceAfterDayFraction` is the fraction of
// the curriculum's total days that must pass before a technique may first appear,
// so the model ramps difficulty rather than front-loading advanced methods.

export type Technique = {
  key: string;
  name: string;
  difficulty: number; // 1 (foundational) .. 5 (advanced)
  introduceAfterDayFraction: number; // 0.0 .. 1.0
  description: string; // one line, used inline in the composer prompt
};

export const CANONICAL_TECHNIQUES: Technique[] = [
  { key: "bluf", name: "BLUF (Bottom Line Up Front)", difficulty: 1, introduceAfterDayFraction: 0.0,
    description: "State the single most important judgment first, then support it." },
  { key: "issue_map", name: "Issue Map", difficulty: 1, introduceAfterDayFraction: 0.04,
    description: "Decompose a question into its sub-issues, stakeholders, and drivers." },
  { key: "comparison_table", name: "Comparison Table", difficulty: 2, introduceAfterDayFraction: 0.08,
    description: "Score options/actors against shared criteria in a structured matrix." },
  { key: "watchlist", name: "Indicators Watchlist", difficulty: 2, introduceAfterDayFraction: 0.15,
    description: "Define observable indicators whose movement would change your assessment." },
  { key: "regional_profile", name: "Regional / Actor Profile", difficulty: 2, introduceAfterDayFraction: 0.2,
    description: "Build a structured profile of a region or actor: interests, capabilities, intent." },
  { key: "synthesis_memo", name: "Synthesis Memo", difficulty: 3, introduceAfterDayFraction: 0.3,
    description: "Integrate multiple sources into one coherent argued memo with a thesis." },
  { key: "scenario_tree", name: "Scenario Tree", difficulty: 3, introduceAfterDayFraction: 0.4,
    description: "Branch plausible futures from key uncertainties and trace their consequences." },
  { key: "policy_instrument", name: "Policy Instrument Design", difficulty: 4, introduceAfterDayFraction: 0.5,
    description: "Design a concrete policy/regulatory instrument and its enforcement mechanics." },
  { key: "ach", name: "Analysis of Competing Hypotheses", difficulty: 4, introduceAfterDayFraction: 0.6,
    description: "Test hypotheses against evidence in an ACH matrix to find the least-disconfirmed." },
  { key: "intelligence_brief", name: "Intelligence Brief", difficulty: 4, introduceAfterDayFraction: 0.7,
    description: "Produce a decision-maker brief: key judgments, confidence, gaps, implications." },
  { key: "calibrated_forecast", name: "Calibrated Forecast", difficulty: 5, introduceAfterDayFraction: 0.78,
    description: "Make a probabilistic forecast with explicit base rates and confidence intervals." },
  { key: "osint", name: "OSINT Collection & Validation", difficulty: 5, introduceAfterDayFraction: 0.85,
    description: "Collect, source-grade, and triangulate open-source evidence into a finding." },
];

export const CANONICAL_TECHNIQUE_KEYS: string[] = CANONICAL_TECHNIQUES.map((t) => t.key);

export function isCanonicalTechnique(key: string): boolean {
  return CANONICAL_TECHNIQUE_KEYS.includes(key);
}
