export const CANONICAL_LANES = [
  "Direction",
  "Applications",
  "Network",
  "Proof assets",
  "Learning and development",
  "Stability",
] as const;

export type CanonicalLaneName = typeof CANONICAL_LANES[number];

export function normalizeLaneName(name: string): CanonicalLaneName {
  if (name === "Learning") return "Learning and development";
  if (name === "Learning and development") return "Learning and development";
  if (CANONICAL_LANES.includes(name as CanonicalLaneName)) return name as CanonicalLaneName;
  return "Stability";
}

export const LANE_PURPOSE: Record<CanonicalLaneName, string> = {
  Direction: "Clarify target tracks and role-market signal.",
  Applications: "Move live roles, applications, interviews, and opportunity-specific materials forward.",
  Network: "Create market signal, access, referrals, and reality checks through people.",
  "Proof assets": "Build reusable evidence, positioning, stories, and credibility over time.",
  "Learning and development": "Build capabilities through output-linked learning and practice.",
  Stability: "Reduce drag, blockers, overload, and execution friction.",
};
