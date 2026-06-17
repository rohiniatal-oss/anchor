export const GOAL_WORKSTREAM = {
  DIRECTION: "Direction",
  MARKET_MAP: "Market map",
  NETWORK: "Network",
  POSITIONING: "Positioning",
  PROJECTS_PUBLIC_WORK: "Projects and public work",
  APPLICATIONS: "Applications",
  INTERVIEW_READINESS: "Interview readiness",
  PREP_UPSKILLING: "Learning and upskilling",
  ENERGY_STABILITY: "Energy and stability",
} as const;

export type GoalWorkstreamName = typeof GOAL_WORKSTREAM[keyof typeof GOAL_WORKSTREAM];

export function goalWorkstreamLabel(name: string) {
  if (name === GOAL_WORKSTREAM.INTERVIEW_READINESS) return "Interview prep";
  if (name === GOAL_WORKSTREAM.MARKET_MAP) return "Role map";
  return name;
}
