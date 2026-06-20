import { ArrowUpRight, Briefcase, Compass, GraduationCap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPrepStarterDraft } from "@/lib/learnStarter";
import {
  buildPrefillHash,
  PENDING_CONTACT_DRAFT_KEY,
  PENDING_LEARN_DRAFT_KEY,
  Tab,
  queueIntakeDraft,
} from "@/lib/homeTypes";
import {
  broadPursuitGapLines,
  CareerGoalT,
  compactLanePreview,
  displayCombinationLabel,
  goalCompassSummary,
  goalFocusComparisonLines,
  goalFocusSupportLine,
  goalModeInfo,
  goalOpportunityStateInfo,
  goalSearchPictureLabel,
  LaneT,
  PHASE_LABEL,
  PipelineStateT,
} from "@shared/goalState";
import type { Job, Contact, LearnItem } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

type CareerCompassCardProps = {
  goal: CareerGoalT;
  onOpenTab: (tab: Tab) => void;
  isCompact?: boolean;
  showOpenStrategy?: boolean;
};

function OpportunityIcon({ className }: { className?: string }) {
  return <Briefcase className={className} />;
}

function laneIcon(lane: LaneT) {
  if (lane === "jobs") return Briefcase;
  if (lane === "learn") return GraduationCap;
  if (lane === "network") return Users;
  return Briefcase;
}

export function CareerCompassCard({
  goal,
  onOpenTab,
  isCompact = false,
  showOpenStrategy = true,
}: CareerCompassCardProps) {
  const mode = goalModeInfo(goal);
  const compassSummary = goalCompassSummary(goal);
  const focusSupportLine = goalFocusSupportLine(goal);
  const opportunity = goalOpportunityStateInfo(goal);
  const leadComparison = goalFocusComparisonLines(goal);
  const gapLines = broadPursuitGapLines(goal);
  const lanePreview = compactLanePreview(goal);

  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: learn = [] } = useQuery<LearnItem[]>({ queryKey: ["/api/learn"] });

  const [combinationExpanded, setCombinationExpanded] = useState(false);

  function openContactDraftForCombination(combination: string) {
    const draft = {
      sector: combination,
      targetOrg: "",
      targetRole: combination,
      why: `Exploring ${combination} opportunities`,
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    onOpenTab("network");
  }

  function openLearnDraftForCombination(combination: string) {
    const draft = buildPrepStarterDraft(combination, goal);
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    onOpenTab("learn");
  }

  function openJobDraftForCombination(combination: string) {
    window.location.hash = buildPrefillHash("/jobs", "jobDraft", {
      title: combination,
      company: "",
      url: "",
    });
    onOpenTab("jobs");
  }

  const opportunityBlockerMeta = goal.opportunityState
    ? goalOpportunityStateInfo(goal).blockerMeta
    : null;
  const OpportunityBlockerIcon = opportunityBlockerMeta?.Icon;

  function openContactDraftForCombinationSearch(combination: string) {
    const draft = {
      sector: combination,
      targetOrg: "",
      targetRole: combination,
      why: `Exploring ${combination} opportunities`,
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    onOpenTab("network");
  }

  function openJobDraftFromSearchPicture(combination: string) {
    window.location.hash = buildPrefillHash("/jobs", "jobDraft", {
      title: combination,
      company: "",
      url: "",
    });
    onOpenTab("jobs");
  }

  function openLearnDraftFromOpportunity(combination: string) {
    const draft = buildPrepStarterDraft(combination, goal);
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    onOpenTab("learn");
  }

  const pipelineState: PipelineStateT | undefined = goal.opportunityState?.pipeline;

  return (
    <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5" data-testid="career-compass">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{goal.todayPlan.mustDo}</p>
          <p className="text-xs text-muted-foreground mt-1">{focusSupportLine}</p>
        </div>
        {showOpenStrategy && (
          <button onClick={() => onOpenTab("strategy")} className="shrink-0 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1" data-testid="button-open-strategy-from-compass">
            Open strategy <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <details className="mt-2">
        <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
          <Compass className="w-3 h-3 inline mr-1" />{compassSummary}
        </summary>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-semibold">
            {PHASE_LABEL[goal.phase]}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${mode.tone}`}>
            {mode.label}
          </span>
          {goal.landingPriority === "credible-role-quickly" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-card text-muted-foreground px-2 py-0.5 text-[11px] font-medium border border-card-border">
              land something credible soon
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{mode.detail}</p>
      </details>

      {goal.opportunityState && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-search-snapshot">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">How your search is going</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Compass className="w-3 h-3" /> {opportunity.stateLabel}
            </span>
            {OpportunityBlockerIcon && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${opportunity.blockerMeta.tone}`}>
                <OpportunityBlockerIcon className="w-3 h-3" /> {opportunity.blockerMeta.label}
              </span>
            )}
          </div>
          <p className="text-sm font-medium mt-2">{opportunity.summary}</p>
          <p className="text-xs text-muted-foreground mt-1">{opportunity.blockerMeta.detail}</p>
          {pipelineState && (
            <div className="mt-2 flex flex-wrap gap-2">
              {pipelineState.viableRoles > 0 && (
                <button
                  className="text-[10px] text-primary hover:underline"
                  onClick={() => openJobDraftFromSearchPicture("role")}
                >
                  {pipelineState.viableRoles} viable role{pipelineState.viableRoles !== 1 ? "s" : ""}
                </button>
              )}
              {pipelineState.liveProcesses > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {pipelineState.liveProcesses} live process{pipelineState.liveProcesses !== 1 ? "es" : ""}
                </span>
              )}
              {pipelineState.dueFollowUps > 0 && (
                <button
                  className="text-[10px] text-primary hover:underline"
                  onClick={() => openContactDraftForCombinationSearch("follow-up")}
                >
                  {pipelineState.dueFollowUps} follow-up{pipelineState.dueFollowUps !== 1 ? "s" : ""} due
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!isCompact && (
        <div className="mt-3">
          <div className="rounded-xl border border-card-border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {goal.opportunityState ? "Still missing" : "Question to answer"}
            </p>
            {goal.opportunityState ? (
              <>
                {gapLines.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {gapLines.map((line, i) => (
                      <li key={i} className="text-sm font-medium">{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm font-medium mt-1">No critical gaps — keep executing.</p>
                )}
              </>
            ) : (
              <p className="text-sm font-medium mt-1">{goal.decisionQuestion}</p>
            )}
          </div>
        </div>
      )}

      {leadComparison && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-why-first">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why this first</p>
          <ul className="mt-1 space-y-1">
            {leadComparison.map((line, i) => (
              <li key={i} className="text-xs text-muted-foreground">{line}</li>
            ))}
          </ul>
        </div>
      )}

      {goal.focusCombinations && goal.focusCombinations.length > 0 && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-combinations">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your focus combinations</p>
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() => setCombinationExpanded((v) => !v)}
            >
              {combinationExpanded ? "Less" : "More"}
            </button>
          </div>
          <ul className="mt-1 space-y-1">
            {(combinationExpanded ? goal.focusCombinations : goal.focusCombinations.slice(0, 3)).map((combo, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{displayCombinationLabel(combo)}</span>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="Add job" onClick={() => openJobDraftForCombination(displayCombinationLabel(combo))}>
                    <Briefcase className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="Add contact" onClick={() => openContactDraftForCombination(displayCombinationLabel(combo))}>
                    <Users className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="Add learning" onClick={() => openLearnDraftForCombination(displayCombinationLabel(combo))}>
                    <GraduationCap className="w-3 h-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lanePreview && lanePreview.length > 0 && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-lane-preview">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Where you're active</p>
          <ul className="mt-2 space-y-1.5">
            {lanePreview.map((lane, i) => {
              const Icon = laneIcon(lane.lane);
              return (
                <li key={i} className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">{goalSearchPictureLabel(lane)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {goal.todayPlan.stopRule && (
        <p className="mt-3 text-xs text-muted-foreground border-t border-card-border pt-2">
          {goal.todayPlan.stopRule}
        </p>
      )}
    </div>
  );
}
