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
  learningSupported: string[];
  exampleProjectSupported: string[];
  missingNetworkSupport: string[];
  missingLearningSupport: string[];
  fullySupported: string[];
  capabilitySupported?: string[];
  missingCapabilitySupport?: string[];
};
export type BroadPursuitGapLineT = {
  key: "roles" | "contacts" | "prep" | "covered";
  label: string;
  tone: string;
  text: string;
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
  "lane-narrowing": "Narrow role types",
  "role-targeting": "Target roles",
  "interview-prep": "Interview prep",
};
export const DECISION_MODE_LABEL: Record<CareerGoalT["decisionMode"], string> = {
  "single-track": "One role type",
  "forced-comparison": "Comparing role types",
  "parallel-exploration": "Exploring role types",
  "broad-parallel-pursuit": "Several role types",
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
  if (coverage.missing.length === 0) return "Keep your active role types moving";
  if (coverage.missing.length === 1) return "Add a role for the last role type";
  return `Add roles for ${coverage.missing.length} role types`;
}

export function broadPursuitPrimarySummary(goal?: CareerGoalT | null) {
  if (!goal) return "";
  const coverage = getBroadPursuitCoverage(goal);
  if (coverage.missing.length > 0) return "One real role per role type is enough to start learning what is viable.";
  if (coverage.missingNetworkSupport.length > 0 || coverage.missingLearningSupport.length > 0) {
    return "Keep the live role types moving while you add the missing contact or prep support.";
  }
  return "Keep the strongest live role moving without dropping the other active paths.";
}

function displayTopicLabel(topic: string) {
  if (/^AI \/ technology strategy$/i.test(topic)) return "AI strategy";
  if (/^Geopolitics \/ geopolitical advisory$/i.test(topic)) return "Geopolitics";
  return topic;
}

function displayShapeLabel(shape: string) {
  if (/^Strategy \/ advisory$/i.test(shape)) return "Strategy / advisory";
  if (/^Ops \/ chief of staff$/i.test(shape)) return "Ops / chief of staff";
  return shape;
}

export function displayCombinationLabel(combination: string) {
  const parts = combination.split(/\s+x\s+/i);
  if (parts.length !== 2) return combination;
  return `${displayTopicLabel(parts[0] || "")} + ${displayShapeLabel(parts[1] || "")}`;
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
      learningSupported: [],
      exampleProjectSupported: [],
      missingNetworkSupport: [],
      missingLearningSupport: [],
      fullySupported: [],
    };
  }
  const combinations = raw.combinations?.length ? raw.combinations : fallbackCombinations;
  const covered = raw.covered || [];
  const missing = raw.missing?.length
    ? raw.missing
    : combinations.filter((combination) => !covered.includes(combination));
  const networkSupported = raw.networkSupported || [];
  const learningSupported = raw.learningSupported || raw.capabilitySupported || [];
  const exampleProjectSupported = raw.exampleProjectSupported || [];
  const missingNetworkSupport = raw.missingNetworkSupport?.length
    ? raw.missingNetworkSupport
    : covered.filter((combination) => !networkSupported.includes(combination));
  const missingLearningSupport = raw.missingLearningSupport?.length
    ? raw.missingLearningSupport
    : raw.missingCapabilitySupport?.length
    ? raw.missingCapabilitySupport
    : covered.filter((combination) => !learningSupported.includes(combination));
  const fullySupported = raw.fullySupported?.length
    ? raw.fullySupported
    : covered.filter((combination) => networkSupported.includes(combination) && learningSupported.includes(combination));
  return {
    combinations,
    covered,
    missing,
    networkSupported,
    learningSupported,
    exampleProjectSupported,
    missingNetworkSupport,
    missingLearningSupport,
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
    hasLearningSupport: coverage.learningSupported.includes(combination),
    hasExampleProjectSupport: coverage.exampleProjectSupported.includes(combination),
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
  if (!support.hasLearningSupport) {
    return {
      label: "Needs prep item",
      detail: "Use one prep starter for this target.",
      tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    };
  }
  return {
    label: "Well supported",
    detail: support.hasExampleProjectSupport
      ? "This target has a role, a contact, a prep item, and an optional writing/project idea."
      : "This target has a role, a contact, and a prep item. Optional writing or project ideas can compound later.",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
}

export function compactLanePreview(items: string[], fallback: string, limit = 2) {
  if (items.length === 0) return fallback;
  const shown = items.slice(0, limit).map(displayCombinationLabel);
  const remainder = items.length - shown.length;
  return `${shown.join("; ")}${remainder > 0 ? ` +${remainder} more` : ""}`;
}

export function broadPursuitGapLines(coverage: BroadPursuitCoverageT): BroadPursuitGapLineT[] {
  const lines: BroadPursuitGapLineT[] = [];
  if (coverage.missing.length > 0) {
    lines.push({
      key: "roles",
      label: "Need roles",
      tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
      text: compactLanePreview(coverage.missing, "Every active role type has a real role."),
    });
  }
  if (coverage.missingNetworkSupport.length > 0) {
    lines.push({
      key: "contacts",
      label: "Need contacts",
      tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
      text: compactLanePreview(coverage.missingNetworkSupport, "Every active role type has someone useful to reach out to."),
    });
  }
  if (coverage.missingLearningSupport.length > 0) {
    lines.push({
      key: "prep",
      label: "Need prep",
      tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
      text: compactLanePreview(coverage.missingLearningSupport, "Every active role type has a prep item."),
    });
  }
  if (lines.length === 0) {
    lines.push({
      key: "covered",
      label: "Covered",
      tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
      text: "Each active role type has a real role, someone useful to reach out to, and prep support.",
    });
  }
  return lines;
}
