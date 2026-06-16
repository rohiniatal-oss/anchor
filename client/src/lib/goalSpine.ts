import type { Event, Task } from "@shared/schema";
import { parseSteps } from "@/lib/homeTypes";
import { GOAL_WORKSTREAM, goalWorkstreamLabel } from "@shared/goalWorkstreams";

export type MilestoneCheckpoint = { id: number; label: string; doneWhen: string; scaffolding: string; milestoneType: "content" | "synthesis" | "artifact"; sequence: number; totalMilestones: number; doneCount: number; completionNotes: string[] };
export type PlanItemExplanationT = { summary: string; whyNow: string; whyThis: string; supportingReasons: string[]; firstStep: string; stopRule: string; nextCheckpoint?: MilestoneCheckpoint };
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
  prepSupported?: string[];
  learningSupported: string[];
  exampleProjectSupported: string[];
  missingNetworkSupport: string[];
  missingPrepSupport?: string[];
  missingLearningSupport: string[];
  fullySupported: string[];
  capabilitySupported?: string[];
  missingCapabilitySupport?: string[];
  laneStates?: Array<{
    combination: string;
    roleCount: number;
    contactCount: number;
    prepSupportCount?: number;
    learningItemCount: number;
    exampleProjectItemCount: number;
    hasRole: boolean;
    hasNetworkSupport: boolean;
    hasPrepSupport?: boolean;
    hasLearningSupport: boolean;
    hasExampleProjectSupport: boolean;
  }>;
};
export type BroadPursuitGapLineT = {
  key: "roles" | "contacts" | "prep" | "covered";
  label: string;
  tone: string;
  text: string;
};
export type GoalModeInfoT = {
  key: "explore" | "options" | "strengthen" | "convert" | "interview";
  label: string;
  detail: string;
  tone: string;
};
export type GoalFocusComparisonLineT = {
  workstream: string;
  title: string;
  detail: string;
  emphasis: "lead" | "secondary";
};
export type GoalMorningBriefT = {
  eyebrow: string;
  intro: string;
  stateLabel: string;
  blockerLabel: string;
  summary: string;
  bestUseLabel: string;
  bestUseText: string;
};
export type GoalMorningExecutionInputT = {
  isLoadingPlan?: boolean;
  hasPinnedFocus?: boolean;
  pinnedTitle?: string | null;
  pinnedAvoided?: boolean;
  enoughForToday?: boolean;
  hasPlannedFocus?: boolean;
  queuedCount?: number;
  doneTodayCount?: number;
  visibleTaskLoad?: number;
  overload?: boolean;
  avoidedTaskCount?: number;
  calendarBusy?: boolean;
};
export type TodayExecutionStateT = {
  activeItems: PlanItemT[];
  hasPrimaryFocus: boolean;
  leadPlanItem: PlanItemT | null;
  queuedPlanItems: PlanItemT[];
  avoidedTaskCount: number;
  calendarMinutes: number;
  calendarBusy: boolean;
  totalVisibleTaskLoad: number;
  overload: boolean;
  defaultPlanQueueOpen: boolean;
  defaultSecondaryOpen: boolean;
  defaultDoneListOpen: boolean;
  briefInput: GoalMorningExecutionInputT;
};
export type GoalWorkstreamT = {
  name: string;
  status: "active" | "underdeveloped" | "premature" | "blocked" | "stale" | "sufficient_for_now";
  progress: "not_started" | "early" | "developing" | "ready";
  bottleneck: string;
  nextMoveType: "research" | "learning" | "relationship" | "preparation" | "execution" | "maintenance" | "wait";
  evidence: string[];
  nextMoves: string[];
};
export type OpportunityStateT = {
  state: "empty" | "researching" | "converting" | "interviewing";
  dominantBlocker: "targeting" | "clarify" | "access" | "application" | "capability" | "assessment" | "none";
  summary: string;
  pipeline?: {
    savedRoles: number;
    viableRoles: number;
    liveProcesses: number;
    interviews: number;
    activeConversations: number;
    dueFollowUps: number;
    apply: number;
    warm: number;
    clarify: number;
    followUp: number;
    prepare: number;
  };
};
export type CareerGoalT = {
  goal: string;
  objective: string;
  phase: "fit-discovery" | "lane-narrowing" | "role-targeting" | "interview-prep";
  dayType: string;
  recommendedFocus: string;
  focusReasonCode?: string;
  reason: string;
  decisionQuestion: string;
  decisionMode: "single-track" | "forced-comparison" | "parallel-exploration" | "broad-parallel-pursuit";
  landingPriority: string;
  selectionRule: string;
  opportunityState?: OpportunityStateT;
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
  if (coverage.missing.length > 0) return "One real role per role type is enough to start seeing what is viable.";
  if (coverage.missingNetworkSupport.length > 0 || (coverage.missingPrepSupport || coverage.missingLearningSupport).length > 0) {
    return "Keep the live role types moving while you add the missing contact or prep starter.";
  }
  return "Keep the strongest live role moving without dropping the other active paths.";
}

export function isRepeatedCapabilityGapFocus(goal?: CareerGoalT | null) {
  return !!goal
    && goal.phase === "role-targeting"
    && goal.recommendedFocus === GOAL_WORKSTREAM.PREP_UPSKILLING
    && goal.focusReasonCode === "repeated_capability_gap";
}

export function goalCompassSummary(goal?: CareerGoalT | null) {
  if (!goal) return "";
  const coverage = getBroadPursuitCoverage(goal);
  if (goal.decisionMode === "broad-parallel-pursuit" && coverage.combinations.length > 0) {
    return "You are testing several role types in parallel. Get one real role into each before narrowing.";
  }
  if (isRepeatedCapabilityGapFocus(goal)) {
    return "You have strong enough roles to learn from, and several point to the same weak area. Strengthen that repeated weak spot before pushing harder.";
  }
  return goal.reason;
}

export function goalFocusSupportLine(goal?: CareerGoalT | null) {
  if (!goal) return "";
  if (isRepeatedCapabilityGapFocus(goal)) {
    return "This comes first because several strong roles point to the same weak area, so one strengthening move should help more than one path.";
  }
  return goal.selectionRule;
}

export function goalModeInfo(goal?: CareerGoalT | null): GoalModeInfoT {
  if (!goal) {
    return {
      key: "explore",
      label: "Explore options",
      detail: "Collect enough evidence to understand what fits before pushing harder.",
      tone: "bg-muted text-muted-foreground border-card-border",
    };
  }
  if (goal.phase === "interview-prep") {
    return {
      key: "interview",
      label: "Prepare interviews",
      detail: "A live process exists, so examples, stories, and role knowledge matter most.",
      tone: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900",
    };
  }
  if (isRepeatedCapabilityGapFocus(goal)) {
    return {
      key: "strengthen",
      label: "Strengthen weak spots",
      detail: "Several serious roles point to the same weak area, so one strengthening step should improve more than one path.",
      tone: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
    };
  }
  if (goal.focusReasonCode === "live_apply" || goal.focusReasonCode === "live_follow_up") {
    return {
      key: "convert",
      label: "Move real roles forward",
      detail: "At least one opportunity is already moving, so the goal is to advance real roles, conversations, and follow-through.",
      tone: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900",
    };
  }
  if (goal.phase === "role-targeting") {
    return {
      key: "options",
      label: "Build real options",
      detail: "Turn plausible paths into real roles, early conversations, and a few selective applications.",
      tone: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
    };
  }
  return {
    key: "explore",
    label: "Explore options",
    detail: "Use real role examples and outside feedback to learn what fits before narrowing too early.",
    tone: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900",
  };
}

export function goalTodayIntroLine(goal?: CareerGoalT | null) {
  if (!goal) return "Here's your day. Start at the top - you don't have to decide.";
  if (isRepeatedCapabilityGapFocus(goal)) {
    return "Several strong roles point to the same weak area, so start with the first strengthening step. It should help more than one path.";
  }
  if (goal.phase === "interview-prep") {
    return "Start with the top card. It is picked to help you prepare for a live process.";
  }
  if (goal.decisionMode === "broad-parallel-pursuit") {
    return "Start with the top card. It is picked to keep your parallel role types moving without extra decisions.";
  }
  if (goal.focusReasonCode === "live_apply" || goal.focusReasonCode === "live_follow_up") {
    return "Start with the top card. It is picked to move a live role or conversation forward.";
  }
  if (goal.phase === "role-targeting") {
    return "Start with the top card. It is picked to turn likely paths into real roles or conversations.";
  }
  return "Here's your day. Start at the top - you don't have to decide.";
}

export function goalMorningBrief(goal?: CareerGoalT | null): GoalMorningBriefT {
  if (!goal) {
    return {
      eyebrow: "Morning brief",
      intro: "Here's your day. Start at the top - you don't have to decide.",
      stateLabel: "No live opportunity yet",
      blockerLabel: "You still need stronger role targets",
      summary: "",
      bestUseLabel: "Best use of today",
      bestUseText: "",
    };
  }

  const state = goal.opportunityState?.state || "empty";
  const blocker = goal.opportunityState?.dominantBlocker || "none";
  const stateLabel = state === "interviewing"
    ? "Live interview"
    : state === "converting"
      ? "Live process moving"
      : state === "researching"
        ? "Real roles in view"
        : "No live opportunity yet";

  const blockerLabel = blocker === "access"
    ? "Access is slowing things down"
    : blocker === "clarify"
      ? "Role facts are still thin"
      : blocker === "application"
        ? "A real application step is ready"
        : blocker === "capability"
          ? "One repeated weak area is showing up"
          : blocker === "assessment"
            ? "Interview or assessment prep matters most"
            : blocker === "targeting"
              ? "You still need stronger role targets"
              : "The search picture is mixed";

  const intro = blocker === "access"
    ? "A useful person move is probably worth more than extra solo prep right now."
    : blocker === "clarify"
      ? "Confirm the role facts before you spend more effort. That should cut wasted motion."
      : blocker === "application"
        ? "A real opportunity is ready to move, so today should help you follow through."
        : blocker === "capability"
          ? "One strengthening step should help more than one serious role, so that is the highest-leverage move."
          : blocker === "assessment"
            ? "A live process exists, so today should help you prepare, not widen the search."
            : blocker === "targeting"
              ? "You need a clearer set of real roles before more prep or networking will pay off."
              : goalTodayIntroLine(goal);

  const bestUseText = blocker === "access"
    ? "Move one useful person thread forward."
    : blocker === "clarify"
      ? "Check the strongest role before pushing harder."
      : blocker === "application"
        ? "Advance the strongest real role."
        : blocker === "capability"
          ? "Strengthen the one weak area that keeps showing up."
          : blocker === "assessment"
            ? "Prepare for the live process in front of you."
            : blocker === "targeting"
              ? "Turn a plausible path into a real option."
              : goal.todayPlan.mustDo;

  return {
    eyebrow: "Morning brief",
    intro,
    stateLabel,
    blockerLabel,
    summary: goal.opportunityState?.summary || "",
    bestUseLabel: "Best use of today",
    bestUseText,
  };
}

export function goalMorningBriefWithExecution(
  goal?: CareerGoalT | null,
  execution?: GoalMorningExecutionInputT,
): GoalMorningBriefT {
  const base = goalMorningBrief(goal);
  if (!execution) return base;

  if (execution.enoughForToday) {
    return {
      ...base,
      eyebrow: "Today already counts",
      intro: "You already did the one thing that mattered. You can stop here unless you genuinely want to keep going.",
      bestUseLabel: "If you keep going",
      bestUseText: "Only do something small and optional.",
    };
  }

  if (execution.hasPinnedFocus) {
    return {
      ...base,
      eyebrow: "You already have a focus",
      intro: execution.pinnedAvoided
        ? "Do not rethink the whole day. Just do the next tiny step on the thing already in front of you."
        : "Do not rethink the whole day. Stay with the thing already in motion.",
      bestUseLabel: "Best use of right now",
      bestUseText: execution.pinnedAvoided
        ? "Do the next tiny step on your current focus."
        : execution.pinnedTitle
          ? `Stay with ${execution.pinnedTitle}.`
          : "Stay with your current focus.",
    };
  }

  if (execution.isLoadingPlan) {
    return {
      ...base,
      eyebrow: "Shaping today",
      intro: "You do not need to decide yet. The app is shaping the day for you now.",
      bestUseLabel: "Best use of right now",
      bestUseText: "Wait for the first suggested move.",
    };
  }

  if (execution.hasPlannedFocus) {
    return {
      ...base,
      eyebrow: "Your day is already queued",
      intro: execution.queuedCount && execution.queuedCount > 0
        ? "Start with the first card and ignore the rest for now. The other steps can wait until you finish that one."
        : "Start with the first card. You do not need to make another decision yet.",
      bestUseLabel: "Best use of right now",
      bestUseText: "Do the first card only.",
    };
  }

  if (execution.overload) {
    return {
      ...base,
      eyebrow: "Keep today small",
      intro: execution.avoidedTaskCount && execution.avoidedTaskCount > 0
        ? "A few things have already been resisting. Ignore the rest and only do the easiest useful move."
        : execution.calendarBusy
          ? "The day already has a lot in it. Protect one small useful move and let the rest stay hidden."
          : "There is already enough on the page. Ignore anything extra and only do the first useful move.",
      bestUseLabel: "Best use of right now",
      bestUseText: execution.avoidedTaskCount && execution.avoidedTaskCount > 0
        ? "Do one very small step on the least-resistant useful task."
        : execution.calendarBusy
          ? "Fit in one small useful move between commitments."
          : "Do one small thing, then reassess.",
    };
  }

  if ((execution.doneTodayCount || 0) > 0) {
    return {
      ...base,
      intro: `${base.intro} You have already moved something today, so keep the next step small.`,
    };
  }

  return base;
}

function timeStringToMinutes(value?: string | null) {
  const text = (value || "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function calendarLoadMinutes(events: Event[]) {
  return events.reduce((sum, event) => {
    const start = timeStringToMinutes(event.start);
    const end = timeStringToMinutes(event.end);
    if (start == null || end == null || end <= start) return sum;
    return sum + (end - start);
  }, 0);
}

export function deriveTodayExecutionState(args: {
  todayTasks: Task[];
  doneTodayTasks: Task[];
  planItems: PlanItemT[];
  events: Event[];
  pinnedTask?: Task | null;
  plan?: DayPlanT | null;
  isLoadingPlan?: boolean;
}): TodayExecutionStateT {
  const activeItems = args.planItems.filter((it) => it.status === "planned" || it.status === "started");
  const hasPrimaryFocus = !!args.pinnedTask || activeItems.length > 0;
  const leadPlanItem = activeItems[0] || null;
  const queuedPlanItems = activeItems.slice(1);
  const avoidedTaskCount = args.todayTasks.filter((task) => (task.skipped || 0) >= 2).length;
  const calendarMinutes = calendarLoadMinutes(args.events);
  const calendarBusy = args.events.length >= 3 || calendarMinutes >= 180;
  const totalVisibleTaskLoad = args.todayTasks.length + queuedPlanItems.length + args.doneTodayTasks.length;
  const overload = !!args.pinnedTask
    || queuedPlanItems.length >= 2
    || args.todayTasks.length >= 5
    || avoidedTaskCount >= 2
    || calendarBusy
    || totalVisibleTaskLoad >= 7;

  return {
    activeItems,
    hasPrimaryFocus,
    leadPlanItem,
    queuedPlanItems,
    avoidedTaskCount,
    calendarMinutes,
    calendarBusy,
    totalVisibleTaskLoad,
    overload,
    defaultPlanQueueOpen: !overload && queuedPlanItems.length === 1,
    defaultSecondaryOpen: !hasPrimaryFocus && !overload,
    defaultDoneListOpen: !hasPrimaryFocus && !overload && args.doneTodayTasks.length <= 2,
    briefInput: {
      isLoadingPlan: !args.pinnedTask && !!args.isLoadingPlan,
      hasPinnedFocus: !!args.pinnedTask,
      pinnedTitle: args.pinnedTask?.title || null,
      pinnedAvoided: (args.pinnedTask?.skipped || 0) >= 2,
      enoughForToday: !!args.plan?.enoughForToday,
      hasPlannedFocus: !args.pinnedTask && activeItems.length > 0,
      queuedCount: queuedPlanItems.length,
      doneTodayCount: args.doneTodayTasks.length,
      visibleTaskLoad: totalVisibleTaskLoad,
      overload,
      avoidedTaskCount,
      calendarBusy,
    },
  };
}

function workstreamPriority(workstream: GoalWorkstreamT) {
  const statusScore = workstream.status === "active" ? 0
    : workstream.status === "stale" ? 1
    : workstream.status === "underdeveloped" ? 2
    : workstream.status === "sufficient_for_now" ? 3
    : workstream.status === "premature" ? 4
    : 5;
  const progressScore = workstream.progress === "developing" ? 0
    : workstream.progress === "early" ? 1
    : workstream.progress === "not_started" ? 2
    : 3;
  return statusScore * 10 + progressScore;
}

function leadComparisonDetail(goal: CareerGoalT, workstream: GoalWorkstreamT) {
  if (goal.focusReasonCode === "repeated_capability_gap") {
    return "This leads because several serious roles share the same weak area, so one strengthening step should help more than one path.";
  }
  const mode = goalModeInfo(goal);
  if (mode.key === "convert") {
    return "This leads because at least one real opportunity is already moving and needs follow-through.";
  }
  if (mode.key === "options") {
    return "This leads because the search needs more real roles, conversations, or concrete next moves before it can convert.";
  }
  if (mode.key === "interview") {
    return "This leads because a live interview or process now matters more than broader exploration.";
  }
  return "This leads because you still need clearer evidence before committing harder elsewhere.";
}

function secondaryComparisonDetail(goal: CareerGoalT, workstream: GoalWorkstreamT) {
  if (goal.focusReasonCode === "repeated_capability_gap" && workstream.name === GOAL_WORKSTREAM.APPLICATIONS) {
    return "Applications stays secondary because the strongest roles still point to the same weak area.";
  }
  if (goal.focusReasonCode === "repeated_capability_gap" && workstream.name === GOAL_WORKSTREAM.NETWORK) {
    return "Networking stays secondary because access is not the loudest blocker on the strongest roles right now.";
  }
  const mode = goalModeInfo(goal);
  if (mode.key === "convert" && workstream.name === GOAL_WORKSTREAM.PREP_UPSKILLING) {
    return "Prep stays secondary while live roles already need concrete follow-through.";
  }
  if (mode.key === "convert" && workstream.name === GOAL_WORKSTREAM.DIRECTION) {
    return "Further comparison stays secondary because real opportunities are already giving you better evidence.";
  }
  if (mode.key === "options" && workstream.name === GOAL_WORKSTREAM.PREP_UPSKILLING) {
    return "Prep stays secondary until there are more concrete roles or conversations to support.";
  }
  if (mode.key === "explore" && workstream.name === GOAL_WORKSTREAM.APPLICATIONS) {
    return "Applications stays secondary because role direction is not clear enough yet.";
  }
  return workstream.bottleneck;
}

export function goalFocusComparisonLines(goal?: CareerGoalT | null): GoalFocusComparisonLineT[] {
  if (!goal) return [];
  const lead = goal.workstreams.find((w) => w.name === goal.recommendedFocus);
  if (!lead) return [];
  const alternatives = goal.workstreams
    .filter((w) => w.name !== lead.name && w.nextMoveType !== "wait" && w.status !== "premature")
    .sort((a, b) => workstreamPriority(a) - workstreamPriority(b))
    .slice(0, 2);
  return [
    {
      workstream: lead.name,
      title: `Why ${goalWorkstreamLabel(lead.name)} comes first`,
      detail: leadComparisonDetail(goal, lead),
      emphasis: "lead",
    },
    ...alternatives.map((workstream) => ({
      workstream: workstream.name,
      title: `Why ${goalWorkstreamLabel(workstream.name)} is not first yet`,
      detail: secondaryComparisonDetail(goal, workstream),
      emphasis: "secondary" as const,
    })),
  ];
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
      prepSupported: [],
      learningSupported: [],
      exampleProjectSupported: [],
      missingNetworkSupport: [],
      missingPrepSupport: [],
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
  const prepSupported = raw.prepSupported || raw.learningSupported || raw.capabilitySupported || [];
  const learningSupported = raw.learningSupported || prepSupported;
  const exampleProjectSupported = raw.exampleProjectSupported || [];
  const missingNetworkSupport = raw.missingNetworkSupport?.length
    ? raw.missingNetworkSupport
    : covered.filter((combination) => !networkSupported.includes(combination));
  const missingPrepSupport = raw.missingPrepSupport?.length
    ? raw.missingPrepSupport
    : raw.missingLearningSupport?.length
    ? raw.missingLearningSupport
    : raw.missingCapabilitySupport?.length
    ? raw.missingCapabilitySupport
    : covered.filter((combination) => !prepSupported.includes(combination));
  const missingLearningSupport = raw.missingLearningSupport?.length
    ? raw.missingLearningSupport
    : missingPrepSupport;
  const fullySupported = raw.fullySupported?.length
    ? raw.fullySupported
    : covered.filter((combination) => networkSupported.includes(combination) && prepSupported.includes(combination));
  return {
    combinations,
    covered,
    missing,
    networkSupported,
    prepSupported,
    learningSupported,
    exampleProjectSupported,
    missingNetworkSupport,
    missingPrepSupport,
    missingLearningSupport,
    fullySupported,
    laneStates: raw.laneStates,
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
    hasPrepSupport: (coverage.prepSupported || coverage.learningSupported).includes(combination),
    hasLearningSupport: (coverage.prepSupported || coverage.learningSupported).includes(combination),
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
  if (!support.hasPrepSupport) {
    return {
      label: "Needs prep starter",
      detail: "Set up one prep starter for this target.",
      tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    };
  }
  return {
    label: "Well supported",
    detail: support.hasExampleProjectSupport
      ? "This target has a role, a contact, a prep starter, and an optional writing/project idea."
      : "This target has a role, a contact, and a prep starter. Optional writing or project ideas can compound later.",
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
  const missingPrepSupport = coverage.missingPrepSupport || coverage.missingLearningSupport;
  if (missingPrepSupport.length > 0) {
    lines.push({
      key: "prep",
      label: "Need prep",
      tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
      text: compactLanePreview(missingPrepSupport, "Every active role type has a prep starter."),
    });
  }
  if (lines.length === 0) {
    lines.push({
      key: "covered",
      label: "Covered",
      tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
      text: "Each active role type has a real role, someone useful to reach out to, and a prep starter.",
    });
  }
  return lines;
}
