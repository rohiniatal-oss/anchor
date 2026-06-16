export const LANE_NAME = {
  DIRECTION: "Direction",
  APPLICATIONS: "Applications",
  NETWORK: "Network",
  PROOF_ASSETS: "Proof assets",
  LEARNING_DEVELOPMENT: "Learning and development",
  STABILITY: "Stability",
} as const;

export const CANONICAL_LANES = [
  LANE_NAME.DIRECTION,
  LANE_NAME.APPLICATIONS,
  LANE_NAME.NETWORK,
  LANE_NAME.PROOF_ASSETS,
  LANE_NAME.LEARNING_DEVELOPMENT,
  LANE_NAME.STABILITY,
] as const;

export type CanonicalLaneName = typeof CANONICAL_LANES[number];

export function normalizeLaneName(name: string): CanonicalLaneName {
  if (name === "Learning" || name === "Development") return LANE_NAME.LEARNING_DEVELOPMENT;
  if (name === LANE_NAME.LEARNING_DEVELOPMENT) return LANE_NAME.LEARNING_DEVELOPMENT;
  if (CANONICAL_LANES.includes(name as CanonicalLaneName)) return name as CanonicalLaneName;
  return LANE_NAME.STABILITY;
}

export function laneFocusAreaLabel(
  lane: CanonicalLaneName,
  options?: { proofLabel?: string },
): string {
  if (lane === LANE_NAME.APPLICATIONS) return "applications";
  if (lane === LANE_NAME.NETWORK) return "networking";
  if (lane === LANE_NAME.LEARNING_DEVELOPMENT) return "learning and prep";
  if (lane === LANE_NAME.PROOF_ASSETS) return options?.proofLabel || "projects and public work";
  if (lane === LANE_NAME.DIRECTION) return "direction";
  return "stability";
}

export function taskCategoryForPlannerLane(lane: string): "job" | "learning" | "hustle" | "admin" {
  if (lane === LANE_NAME.APPLICATIONS || lane === LANE_NAME.DIRECTION) return "job";
  if (lane === LANE_NAME.NETWORK || lane === LANE_NAME.STABILITY) return "admin";
  if (lane === LANE_NAME.PROOF_ASSETS) return "hustle";
  if (lane === "Learning" || lane === "Development" || lane === LANE_NAME.LEARNING_DEVELOPMENT) return "learning";
  return "admin";
}

export const LANE_PURPOSE: Record<CanonicalLaneName, string> = {
  [LANE_NAME.DIRECTION]: "Work out which role types are worth testing and what good options look like.",
  [LANE_NAME.APPLICATIONS]: "Move live roles, applications, interviews, and opportunity-specific materials forward.",
  [LANE_NAME.NETWORK]: "Use people for access, referrals, and honest reality-checks.",
  [LANE_NAME.PROOF_ASSETS]: "Build reusable examples, stories, posts, or assets that strengthen your profile over time.",
  [LANE_NAME.LEARNING_DEVELOPMENT]: "Build capabilities through output-linked learning and practice.",
  [LANE_NAME.STABILITY]: "Reduce drag, blockers, overload, and execution friction.",
};
