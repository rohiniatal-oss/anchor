import type { Task } from "@shared/schema";
import { parseSteps } from "@/lib/homeTypes";

export type PlanItemExplanationT = { summary: string; whyNow: string; whyThis: string; supportingReasons: string[]; firstStep: string; stopRule: string };
export type PlanItemT = { id: number; slot: string; title: string; whySelected: string; doneWhen: string; status: string; sourceType: string; sourceId: number | null; taskId: number | null; explanation?: PlanItemExplanationT };
export type DayPlanT = { id: number; mode: string; note: string; status: string; minimumViableItemId: number | null; enoughForToday: boolean };
export type GoalTrajectoryT = { key: string; title: string; status: "complete" | "current" | "pending"; description: string };
export type GoalTodayPlanT = { mustDo: string; next: string; optional: string; stopRule: string };
export type GoalPortfolioItemT = { combination: string; whyPlausible: string; nextMove: string };
export type BroadPursuitCoverageT = {
  combinations: string[];
  covered: string[];
  missing: string[];
  networkSupported: string[];
  capabilitySupported: string[];
  missingNetworkSupport: string[];
  missingCapabilitySupport: string[];
  fullySupported: string[];
};
export type GoalWorkstreamT = {
  name: string;
  status: "active" | "underdeveloped" | "premature" | "blocked" | "stale" | "sufficient_for_now";
  progress: "not_started" | "early" | "developing" | "ready";
  bottleneck: string;
  nextMoveType: "learning" | "relationship" | "preparation" | "execution" | "maintenance" | "wait";
  evidence: string[];
  nextMoves: string[];
};
export type CareerGoalT = {
  goal: string;
  objective: string;
  phase: "fit-discovery" | "lane-narrowing" | "role-targeting" | "interview-prep";
  dayType: string;
  recommendedFocus: string;
  reason: string;
  decisionQuestion: string;
  decisionMode: "single-track" | "forced-comparison" | "parallel-exploration" | "broad-parallel-pursuit";
  landingPriority: string;
  selectionRule: string;
  pursuitPortfolio?: GoalPortfolioItemT[];
  trajectory: GoalTrajectoryT[];
  workstreams: GoalWorkstreamT[];
  todayPlan: GoalTodayPlanT;
  broadPursuitCoverage?: BroadPursuitCoverageT;
};
export type GoalsStateResponseT = { goals: CareerGoalT[] };

export const SLOT_LABEL: Record<string, string> = { now: "Now", next: "Next", later: "Later", bonus: "Bonus" };
export const PHASE_LABEL: Record<CareerGoalT["phase"], string> = {
  "fit-discovery": "Discover fit",
  "lane-narrowing": "Narrow focus",
  "role-targeting": "Target roles",
  "interview-prep": "Interview prep",
};
export const DECISION_MODE_LABEL: Record<CareerGoalT["decisionMode"], string> = {
  "single-track": "One path",
  "forced-comparison": "Comparing options",
  "parallel-exploration": "Exploring options",
  "broad-parallel-pursuit": "Multiple targets",
};
export const DAY_TYPE_LABEL: Record<string, string> = {
  "signal-building": "Signal building",
  "network-building": "Network building",
  "conversion": "Conversion",
  "capability-building": "Capability building",
  "interview-prep": "Interview prep",
  "stabilising": "Stabilising",
};

const PRE_SHRUNK_RE = /pre-shrunk|made smaller|pre-split|easier execution steps|easier start/i;

export function isPreShrunkPlanItem(item: PlanItemT) {
  const text = `${item.explanation?.summary || ""} ${item.explanation?.whyNow || ""}`;
  return PRE_SHRUNK_RE.test(text);
}

export function nextVisibleStep(task?: Task | null) {
  if (!task) return null;
  const steps = parseSteps(task.steps || "[]");
  return steps.find((step) => !step.done) || steps[0] || null;
}

export function firstStepPreview(item: PlanItemT, task?: Task | null) {
  const taskStep = nextVisibleStep(task);
  if (taskStep?.text) return taskStep.text;
  const text = item.explanation?.firstStep?.trim();
  return text || null;
}

export function isBroadPursuitGoalItem(item: PlanItemT, goal?: CareerGoalT | null) {
  return goal?.decisionMode === "broad-parallel-pursuit" && item.sourceType === "goal";
}

export function broadPursuitPlanTitle(goal?: CareerGoalT | null) {
  if (!goal) return null;
  const coverage = getBroadPursuitCoverage(goal);
  if (coverage.missing.length === 0) return "Keep your active targets moving";
  if (coverage.missing.length === 1) return "Add a role for the last target";
  return `Add roles for ${coverage.missing.length} targets`;
}

export function getBroadPursuitCoverage(goal: CareerGoalT): BroadPursuitCoverageT {
  const fallbackCombinations = goal.pursuitPortfolio?.map((item) => item.combination) || [];
  const raw = goal.broadPursuitCoverage;
  if (!raw) {
    return {
      combinations: fallbackCombinations,
      covered: [],
      missing: fallbackCombinations,
      networkSupported: [],
      capabilitySupported: [],
      missingNetworkSupport: [],
      missingCapabilitySupport: [],
      fullySupported: [],
    };
  }
  const combinations = raw.combinations?.length ? raw.combinations : fallbackCombinations;
  const covered = raw.covered || [];
  const missing = raw.missing?.length
    ? raw.missing
    : combinations.filter((combination) => !covered.includes(combination));
  const networkSupported = raw.networkSupported || [];
  const capabilitySupported = raw.capabilitySupported || [];
  const missingNetworkSupport = raw.missingNetworkSupport?.length
    ? raw.missingNetworkSupport
    : covered.filter((combination) => !networkSupported.includes(combination));
  const missingCapabilitySupport = raw.missingCapabilitySupport?.length
    ? raw.missingCapabilitySupport
    : covered.filter((combination) => !capabilitySupported.includes(combination));
  const fullySupported = raw.fullySupported?.length
    ? raw.fullySupported
    : covered.filter((combination) => networkSupported.includes(combination) && capabilitySupported.includes(combination));
  return {
    combinations,
    covered,
    missing,
    networkSupported,
    capabilitySupported,
    missingNetworkSupport,
    missingCapabilitySupport,
    fullySupported,
  };
}

export function combinationCoverageState(goal: CareerGoalT, combination: string): "covered" | "missing" | "unknown" {
  const coverage = getBroadPursuitCoverage(goal);
  if (coverage.covered.includes(combination)) return "covered";
  if (coverage.missing.includes(combination)) return "missing";
  return "unknown";
}

export function combinationSupportState(goal: CareerGoalT, combination: string) {
  const coverage = getBroadPursuitCoverage(goal);
  return {
    hasRole: coverage.covered.includes(combination),
    hasNetworkSupport: coverage.networkSupported.includes(combination),
    hasCapabilitySupport: coverage.capabilitySupported.includes(combination),
    fullySupported: coverage.fullySupported.includes(combination),
  };
}

export function nextLaneGap(goal: CareerGoalT, combination: string) {
  const support = combinationSupportState(goal, combination);
  if (!support.hasRole) {
    return {
      label: "Needs first real role",
      detail: "Save one real role for this target.",
      tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }
  if (!support.hasNetworkSupport) {
    return {
      label: "Needs first contact",
      detail: "Add one contact who could help here.",
      tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    };
  }
  if (!support.hasCapabilitySupport) {
    return {
      label: "Needs learning support",
      detail: "Add one learning item for this target.",
      tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    };
  }
  return {
    label: "Well supported",
    detail: "This target has a role, a contact, and learning support.",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
}

export function compactLanePreview(items: string[], fallback: string, limit = 2) {
  if (items.length === 0) return fallback;
  const shown = items.slice(0, limit);
  const remainder = items.length - shown.length;
  return `${shown.join("; ")}${remainder > 0 ? ` +${remainder} more` : ""}`;
}
