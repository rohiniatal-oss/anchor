// @ts-nocheck - parallel pursuit components
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GOAL_WORKSTREAM, goalWorkstreamLabel } from "@shared/goalWorkstreams";
import type { CareerTrack } from "@shared/schema";
import type { JobFormT } from "@/lib/jobsViewTypes";
import type { LearnFormT } from "@/lib/learnShared";
import { buildPrepStarterDraft } from "@/lib/learnStarter";
import {
  type CareerGoalT,
  displayCombinationLabel,
  type GoalPortfolioItemT,
  type GoalWorkstreamT,
  combinationCoverageState,
  combinationSupportState,
  getBroadPursuitCoverage,
  nextLaneGap,
} from "@/lib/goalSpine";

export type ContactFormT = {
  name: string;
  who: string;
  sector: string;
  why: string;
  sourceNetwork: string;
  targetOrg: string;
  targetRole: string;
  askType: string;
  relationshipStrength: string;
  nextFollowUpDate: string;
  relatedTrackId: number | null;
  status: string;
  messageDraft: string;
};

export const JOB_ARCHETYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "advisory", label: "Advisory" },
  { value: "chief_of_staff", label: "Chief of staff" },
  { value: "ops", label: "Operations" },
  { value: "policy", label: "Policy" },
  { value: "research", label: "Research" },
];

export type LaneGuideT = {
  roleArchetype: string;
  fitHint: string;
  searchHint: string;
  nextStep: string;
  titlePlaceholder: string;
  notePrefix: string;
  trackKeywords: string[];
};

function workstreamLabel(name: string) {
  return goalWorkstreamLabel(name);
}

function coverageLabel(state: "covered" | "missing" | "unknown") {
  if (state === "covered") return "covered";
  if (state === "missing") return "missing";
  return "saved for later";
}

function workstreamTone(name: string, goal: CareerGoalT) {
  return goal.recommendedFocus === name
    ? "bg-primary/10 text-primary border-primary/20"
    : "bg-muted text-muted-foreground border-card-border";
}

function viewRelevantWorkstreams(view: "jobs" | "network" | "learn", goal: CareerGoalT) {
  if (view === "jobs" && goal.decisionMode === "broad-parallel-pursuit") {
    return [GOAL_WORKSTREAM.DIRECTION, GOAL_WORKSTREAM.MARKET_MAP, GOAL_WORKSTREAM.APPLICATIONS, GOAL_WORKSTREAM.POSITIONING]
      .map((name) => goal.workstreams.find((w) => w.name === name))
      .filter(Boolean) as GoalWorkstreamT[];
  }
  const map: Record<typeof view, string[]> = {
    jobs: [GOAL_WORKSTREAM.APPLICATIONS, GOAL_WORKSTREAM.POSITIONING, GOAL_WORKSTREAM.INTERVIEW_READINESS, GOAL_WORKSTREAM.PROJECTS_PUBLIC_WORK],
    network: [GOAL_WORKSTREAM.NETWORK, GOAL_WORKSTREAM.APPLICATIONS, GOAL_WORKSTREAM.INTERVIEW_READINESS, GOAL_WORKSTREAM.DIRECTION],
    learn: [GOAL_WORKSTREAM.PREP_UPSKILLING, GOAL_WORKSTREAM.PROJECTS_PUBLIC_WORK, GOAL_WORKSTREAM.POSITIONING, GOAL_WORKSTREAM.DIRECTION],
  };
  return map[view]
    .map((name) => goal.workstreams.find((w) => w.name === name))
    .filter(Boolean) as GoalWorkstreamT[];
}

function leadWorkstreamForView(view: "jobs" | "network" | "learn", goal: CareerGoalT, relevant: GoalWorkstreamT[]) {
  if (view === "jobs" && goal.decisionMode === "broad-parallel-pursuit") {
    const direction = goal.workstreams.find((w) => w.name === GOAL_WORKSTREAM.DIRECTION);
    const marketMap = goal.workstreams.find((w) => w.name === GOAL_WORKSTREAM.MARKET_MAP);
    const applications = goal.workstreams.find((w) => w.name === GOAL_WORKSTREAM.APPLICATIONS);
    return direction || marketMap || applications || relevant[0];
  }
  return relevant[0];
}

export function ViewSpineCallout({
  view,
  goal,
}: {
  view: "jobs" | "network" | "learn";
  goal: CareerGoalT;
}) {
  const relevant = viewRelevantWorkstreams(view, goal);
  if (relevant.length === 0) return null;
  const lead = leadWorkstreamForView(view, goal, relevant);

  return (
    <div className="mb-5 rounded-xl border border-card-border bg-card p-4" data-testid={`${view}-spine-callout`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why this page matters now</p>
          <p className="text-sm font-medium mt-1">{lead.nextMoves[0] || goal.todayPlan.mustDo}</p>
          <p className="text-xs text-muted-foreground mt-1">{lead.bottleneck}</p>
        </div>
        {goal.recommendedFocus === lead.name && (
          <span className="inline-flex shrink-0 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">
            focus
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {relevant.slice(0, 3).map((w) => (
          <span key={w.name} className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${workstreamTone(w.name, goal)}`}>
            {workstreamLabel(w.name)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BroadPursuitJobsKickoff({
  goal,
  onStartLane,
}: {
  goal: CareerGoalT;
  onStartLane: (item: GoalPortfolioItemT) => void;
}) {
  const portfolio = goal.pursuitPortfolio || [];
  if (goal.decisionMode !== "broad-parallel-pursuit" || portfolio.length === 0) return null;
  const coverage = getBroadPursuitCoverage(goal);
  const visiblePortfolio = portfolio.filter((item) => combinationCoverageState(goal, item.combination) === "missing");
  if (visiblePortfolio.length === 0) return null;

  return (
    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="jobs-broad-pursuit-kickoff">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">First roles</p>
        <p className="text-sm font-medium mt-1">Save one real role for each missing role type.</p>
        <p className="text-xs text-muted-foreground mt-1">
          That is enough to start learning what is actually viable.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {coverage.missing.length} role type{coverage.missing.length === 1 ? "" : "s"} still need a first real role.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mt-4">
        {visiblePortfolio.map((item) => {
          const state = combinationCoverageState(goal, item.combination);
          const tone = state === "covered"
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/10"
            : state === "missing"
            ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/10"
            : "border-card-border bg-card";
          const badge = state === "covered"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : state === "missing"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            : "bg-muted text-muted-foreground";
          const buttonLabel = state === "covered" ? "Add another role" : "Add first role";
          return (
          <div
            key={item.combination}
            className={`rounded-xl border p-3 ${tone}`}
            data-testid={`jobs-kickoff-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug">{displayCombinationLabel(item.combination)}</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge}`}>
                {coverageLabel(state)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{laneGuideForCombination(item.combination).fitHint}</p>
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => onStartLane(item)} data-testid={`button-start-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <Plus className="w-4 h-4 mr-1" /> {buttonLabel}
              </Button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

export function BroadPursuitParallelSupportKickoff({
  goal,
  mode,
  onStartLane,
}: {
  goal: CareerGoalT;
  mode: "network" | "learn";
  onStartLane: (item: GoalPortfolioItemT) => void;
}) {
  const portfolio = goal.pursuitPortfolio || [];
  if (goal.decisionMode !== "broad-parallel-pursuit" || portfolio.length === 0) return null;
  const coverage = getBroadPursuitCoverage(goal);
  const missingSupport = mode === "network" ? coverage.missingNetworkSupport : (coverage.missingPrepSupport || coverage.missingLearningSupport);
  const orderedPortfolio = [...portfolio].sort((a, b) => {
    const left = combinationSupportState(goal, a.combination);
    const right = combinationSupportState(goal, b.combination);
    const leftMissing = mode === "network" ? !left.hasNetworkSupport : !left.hasPrepSupport;
    const rightMissing = mode === "network" ? !right.hasNetworkSupport : !right.hasPrepSupport;
    const leftPriority = left.hasRole && leftMissing ? 0 : leftMissing ? 1 : 2;
    const rightPriority = right.hasRole && rightMissing ? 0 : rightMissing ? 1 : 2;
    return leftPriority - rightPriority;
  });
  const visiblePortfolio = orderedPortfolio.filter((item) => {
    const support = combinationSupportState(goal, item.combination);
    return mode === "network" ? !support.hasNetworkSupport : !support.hasPrepSupport;
  });
  const allVisibleWithoutRoles = visiblePortfolio.length > 0 && visiblePortfolio.every((item) => !combinationSupportState(goal, item.combination).hasRole);
  const canStartWithoutRole = allVisibleWithoutRoles;

  return (
    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid={`${mode}-broad-pursuit-kickoff`}>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {mode === "network" ? "Contacts to add" : "Suggested learning"}
          </p>
          <p className="text-sm font-medium mt-1">
            {mode === "network" ? "Add one contact for your weakest role types." : "Start learning about your weakest role types."}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === "network"
              ? `${missingSupport.length} role type${missingSupport.length === 1 ? "" : "s"} still need a contact.`
              : `${missingSupport.length} role type${missingSupport.length === 1 ? "" : "s"} still need a learning focus.`}
          </p>
          {canStartWithoutRole && (
            <p className="text-xs text-muted-foreground mt-1">
              These can start before a saved role exists.
            </p>
          )}
      </div>

      <div className={`mt-4 ${canStartWithoutRole ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}`}>
        {visiblePortfolio.map((item) => {
          const state = combinationCoverageState(goal, item.combination);
          const support = combinationSupportState(goal, item.combination);
          const gap = nextLaneGap(goal, item.combination);
          const supportGap = !support.hasRole
            ? mode === "network"
              ? {
                  label: "Can start now",
                  detail: "You can start this before a role exists.",
                  tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
                }
              : {
                  label: "Can start now",
                  detail: "You can start this before a role exists.",
                  tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
                }
            : gap;
          const supportMissing = mode === "network" ? !support.hasNetworkSupport : !support.hasPrepSupport;
          const tone = state === "covered"
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/10"
            : state === "missing"
            ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/10"
            : "border-card-border bg-card";
          const buttonLabel = mode === "network"
            ? supportMissing
              ? (support.hasRole ? "Add first contact" : "Add contact for this target")
              : "Add another contact"
            : supportMissing
              ? (support.hasRole ? "Start learning about this" : "Start learning about this target")
              : "Add more learning";
          const showRoleStateBadge = !canStartWithoutRole;
          const showSupportDetail = !canStartWithoutRole;
          return (
            <div
              key={`${mode}-${item.combination}`}
              className={`rounded-xl border p-3 ${tone} ${canStartWithoutRole ? "flex items-center justify-between gap-3" : ""}`}
              data-testid={`${mode}-kickoff-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">{displayCombinationLabel(item.combination)}</p>
                  {showRoleStateBadge && (
                    <span className="inline-flex rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {state === "covered" ? "live role exists" : state === "missing" ? "no live role yet" : "saved for later"}
                    </span>
                  )}
                </div>
                <div className={`flex flex-wrap items-center gap-2 ${showSupportDetail ? "mt-3" : "mt-2"}`}>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${supportGap.tone}`}>{supportGap.label}</span>
                  {showSupportDetail && <p className="text-xs text-muted-foreground">{supportGap.detail}</p>}
                </div>
              </div>
              <div className={canStartWithoutRole ? "shrink-0" : "mt-3"}>
                <Button size="sm" variant="outline" onClick={() => onStartLane(item)} data-testid={`button-start-${mode}-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                  <Plus className="w-4 h-4 mr-1" /> {buttonLabel}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function roleArchetypeForLane(combination: string): string {
  if (/ops \/ chief of staff/i.test(combination)) return "chief_of_staff";
  return "advisory";
}

export function laneGuideForCombination(combination: string): LaneGuideT {
  if (/ai \/ technology strategy x ops \/ chief of staff/i.test(combination)) {
    return {
      roleArchetype: "chief_of_staff",
      fitHint: "Look for execution-heavy roles translating AI or technology priorities into cross-functional delivery, founder support, or operating cadence.",
      searchHint: "Try terms like chief of staff, strategy and operations, special projects, or business operations in AI, frontier tech, or policy-adjacent orgs.",
      nextStep: "Save one AI or technology role where you would help turn priorities into execution, then decide if it is credible soon.",
      titlePlaceholder: "Chief of Staff, Strategy & Ops, Special Projects...",
      notePrefix: "Role type focus: AI / technology strategy x Ops / chief of staff.",
      trackKeywords: ["ai", "technology", "ops", "operations", "chief of staff", "special projects", "execution"],
    };
  }
  if (/ai \/ technology strategy x strategy \/ advisory/i.test(combination)) {
    return {
      roleArchetype: "advisory",
      fitHint: "Look for roles shaping AI, technology, risk, governance, policy, or strategic direction rather than owning pure implementation.",
      searchHint: "Try terms like strategy, advisory, policy, governance, public affairs, or market intelligence in AI or frontier technology orgs.",
      nextStep: "Save one AI or technology strategy role with clear strategic scope, then decide if it is a credible near-term target.",
      titlePlaceholder: "Strategy Associate, AI Policy Advisor, Tech Strategy...",
      notePrefix: "Role type focus: AI / technology strategy x Strategy / advisory.",
      trackKeywords: ["ai", "technology", "strategy", "advisory", "governance", "policy", "risk"],
    };
  }
  if (/geopolitics \/ geopolitical advisory x ops \/ chief of staff/i.test(combination)) {
    return {
      roleArchetype: "chief_of_staff",
      fitHint: "Look for execution and coordination roles inside policy, geopolitical, advisory, or international-facing teams.",
      searchHint: "Try terms like chief of staff, strategy and operations, programme operations, special projects, or executive office in geopolitical or policy orgs.",
      nextStep: "Save one geopolitics-adjacent operations role where you would coordinate priorities or delivery, then decide if it is credible soon.",
      titlePlaceholder: "Chief of Staff, Programme Operations, Strategy & Ops...",
      notePrefix: "Role type focus: Geopolitics / geopolitical advisory x Ops / chief of staff.",
      trackKeywords: ["geopolitics", "geopolitical", "policy", "international", "ops", "operations", "chief of staff"],
    };
  }
  return {
    roleArchetype: "advisory",
    fitHint: "Look for roles with substantive regional, geopolitical, public policy, or advisory scope rather than generic admin support.",
    searchHint: "Try terms like geopolitical advisory, policy advisor, research and strategy, public affairs, or international policy in think tanks, consultancies, multilaterals, and governments.",
    nextStep: "Save one geopolitical advisory role with substantive regional or policy scope, then decide if it is a credible near-term target.",
    titlePlaceholder: "Policy Advisor, Geopolitical Analyst, Strategy Associate...",
    notePrefix: "Role type focus: Geopolitics / geopolitical advisory x Strategy / advisory.",
    trackKeywords: ["geopolitics", "geopolitical", "policy", "advisory", "international", "research", "public affairs"],
  };
}

function normalizeLaneText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function bestTrackForLane(combination: string, tracks: CareerTrack[]): number | null {
  const guide = laneGuideForCombination(combination);
  const scored = tracks
    .filter((track) => track.status !== "paused")
    .map((track) => {
      const haystack = normalizeLaneText(`${track.name} ${track.description} ${track.whyItFits} ${track.targetRoleArchetype}`);
      let score = 0;
      for (const keyword of guide.trackKeywords) {
        if (haystack.includes(normalizeLaneText(keyword).trim())) score += 2;
      }
      if (guide.roleArchetype && haystack.includes(normalizeLaneText(guide.roleArchetype).trim())) score += 1;
      score += track.priority || 0;
      return { id: track.id, score };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
  return scored[0]?.score > 0 ? scored[0].id : null;
}

export function lanePresetForJob(item: GoalPortfolioItemT, tracks: CareerTrack[]): Partial<JobFormT> {
  const guide = laneGuideForCombination(item.combination);
  return {
    roleArchetype: guide.roleArchetype || roleArchetypeForLane(item.combination),
    narrativeAngle: item.combination,
    note: `${guide.notePrefix} ${item.whyPlausible}`,
    nextStep: guide.nextStep,
    relatedTrackId: bestTrackForLane(item.combination, tracks),
    sourceType: "posting",
  };
}

export function contactPresetForLane(item: GoalPortfolioItemT, tracks: CareerTrack[]): Partial<ContactFormT> {
  const guide = laneGuideForCombination(item.combination);
  return {
    sector: item.combination,
    why: `Use this contact to learn about or get closer to ${item.combination} while the role pipeline is still filling out. ${item.whyPlausible}`,
    targetRole: guide.titlePlaceholder,
    askType: "advice",
    relationshipStrength: "cold",
    relatedTrackId: bestTrackForLane(item.combination, tracks),
    status: "to_contact",
  };
}

export function learnPresetForLane(item: GoalPortfolioItemT, tracks: CareerTrack[]): Partial<LearnFormT> {
  const guide = laneGuideForCombination(item.combination);
  return buildPrepStarterDraft({
    subjectText: item.combination,
    relatedTrackId: bestTrackForLane(item.combination, tracks),
    noteIntro: `Build familiarity with ${item.combination} while roles are still being added. ${guide.fitHint}`,
    fallbackTitle: `${item.combination} prep`,
  });
}
