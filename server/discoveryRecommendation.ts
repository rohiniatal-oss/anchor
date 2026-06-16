export type CareerDiscoveryRouteKey =
  | "broad-role-pursuit"
  | "fit-clarification"
  | "warm-path-build"
  | "capability-ramp";

export type CareerDiscoveryRoutePreview = {
  tinyNextAction?: {
    size?: "quick" | "medium" | "deep";
  };
};

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function actionSizePenalty(size?: "quick" | "medium" | "deep") {
  if (size === "deep") return 2;
  if (size === "medium") return 1;
  return 0;
}

export function recommendCareerDiscoveryRoute(
  concern: string,
  routePreviews: Partial<Record<CareerDiscoveryRouteKey, CareerDiscoveryRoutePreview>>,
): { key: CareerDiscoveryRouteKey; reason: string } {
  const text = concern.toLowerCase();
  const urgentJob = containsAny(text, [/\b(job|need work|need a role|income|employment)\b/]);
  const networking = containsAny(text, [/\b(network|networking|referral|reach out|contact|linkedin|intro)\b/]);
  const capability = containsAny(text, [/\b(interview|cv|resume|skill|skills|upskill|prepare)\b/]);
  const uncertainty = containsAny(text, [/\b(don'?t know|do not know|figure out|sort out|stuck|unclear|what kind)\b/]);
  const overwhelm = containsAny(text, [/\b(overwhelmed|overwhelm|chaos|chaotic|too much|too many|stuck|scattered|spinning)\b/]);
  const splitOptions = containsAny(text, [/\b(torn between|split between|between)\b/]);

  const routeKeys: CareerDiscoveryRouteKey[] = [
    "broad-role-pursuit",
    "fit-clarification",
    "warm-path-build",
    "capability-ramp",
  ];
  const scores = new Map<CareerDiscoveryRouteKey, number>(routeKeys.map((key) => [key, 0]));

  if (urgentJob) scores.set("broad-role-pursuit", (scores.get("broad-role-pursuit") || 0) + 4);
  if (networking) scores.set("warm-path-build", (scores.get("warm-path-build") || 0) + 5);
  if (capability) scores.set("capability-ramp", (scores.get("capability-ramp") || 0) + 4);
  if (uncertainty) scores.set("fit-clarification", (scores.get("fit-clarification") || 0) + 2);
  if (splitOptions) scores.set("fit-clarification", (scores.get("fit-clarification") || 0) + 2);
  if (urgentJob && uncertainty) scores.set("broad-role-pursuit", (scores.get("broad-role-pursuit") || 0) + 2);
  if (urgentJob && networking) scores.set("warm-path-build", (scores.get("warm-path-build") || 0) + 1);
  if (capability && !urgentJob) scores.set("capability-ramp", (scores.get("capability-ramp") || 0) + 1);

  if (overwhelm) {
    scores.set("fit-clarification", (scores.get("fit-clarification") || 0) + 3);
    if (capability) scores.set("capability-ramp", (scores.get("capability-ramp") || 0) + 2);
    scores.set("broad-role-pursuit", (scores.get("broad-role-pursuit") || 0) - 2);
    if (!networking) scores.set("warm-path-build", (scores.get("warm-path-build") || 0) - 1);
  }

  for (const key of routeKeys) {
    const preview = routePreviews[key];
    const penalty = actionSizePenalty(preview?.tinyNextAction?.size);
    const weight = overwhelm ? 2 : 1;
    scores.set(key, (scores.get(key) || 0) - (penalty * weight));
  }

  const ordered = [...routeKeys].sort((left, right) => {
    const scoreDiff = (scores.get(right) || 0) - (scores.get(left) || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const penaltyDiff = actionSizePenalty(routePreviews[left]?.tinyNextAction?.size) - actionSizePenalty(routePreviews[right]?.tinyNextAction?.size);
    if (penaltyDiff !== 0) return penaltyDiff;
    return routeKeys.indexOf(left) - routeKeys.indexOf(right);
  });
  const chosen = ordered[0] || "broad-role-pursuit";

  if (chosen === "warm-path-build") {
    return {
      key: chosen,
      reason: "You are already thinking about people and access, so the fastest next move is to talk to someone who can reality-check the role type or open a door.",
    };
  }
  if (chosen === "capability-ramp") {
    return {
      key: chosen,
      reason: overwhelm && capability
        ? "The same weak spot keeps showing up, and the lowest-overwhelm first move is to strengthen one requirement before opening more fronts."
        : "Your concern is mainly about readiness, so the cleanest first move is to pick one requirement from a real role that still feels weak today and work on that.",
    };
  }
  if (chosen === "fit-clarification") {
    return {
      key: chosen,
      reason: overwhelm
        ? "You have several plausible options, and the least overwhelming first move is to inspect one role type closely before opening more fronts."
        : "The target is still fuzzy enough that comparing role types directly will teach you more than applying widely right away.",
    };
  }
  return {
    key: "broad-role-pursuit",
    reason: urgentJob
      ? "You need a credible role soon, so the best next move is to put real roles into each option you are considering before narrowing too early."
      : "A few live roles will teach you more than another round of abstract comparison.",
  };
}
