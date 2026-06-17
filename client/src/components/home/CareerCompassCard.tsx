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
  DECISION_MODE_LABEL,
  displayCombinationLabel,
  goalCompassSummary,
  goalFocusComparisonLines,
  goalFocusSupportLine,
  goalModeInfo,
  getBroadPursuitCoverage,
  PHASE_LABEL,
} from "@/lib/goalSpine";

function opportunityStateMeta(goal: CareerGoalT) {
  const state = goal.opportunityState?.state || "empty";
  const blocker = goal.opportunityState?.dominantBlocker || "none";

  const stateLabel = state === "interviewing"
    ? "Live interview"
    : state === "converting"
      ? "Live process moving"
      : state === "researching"
        ? "Real roles in view"
        : "No live opportunity yet";

  const blockerMeta = blocker === "access"
    ? {
        label: "What is slowing this down: access",
        detail: "The best next move is probably a person move: outreach, referral, or follow-up.",
        tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
        Icon: Users,
      }
    : blocker === "clarify"
      ? {
          label: "What is slowing this down: role facts",
          detail: "The best next move is probably to confirm what the role really asks for before pushing harder.",
          tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
          Icon: Briefcase,
        }
      : blocker === "application"
        ? {
            label: "What is slowing this down: application follow-through",
            detail: "The best next move is probably a concrete application or materials step.",
            tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
            Icon: Briefcase,
          }
        : blocker === "capability"
          ? {
              label: "What is slowing this down: repeated weak area",
              detail: "The best next move is probably one learning or practice step that helps more than one role.",
              tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
              Icon: GraduationCap,
            }
          : blocker === "assessment"
            ? {
                label: "What is slowing this down: interview or assessment prep",
                detail: "The best next move is probably to prepare examples, stories, or role-specific material.",
                tone: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
                Icon: Briefcase,
              }
            : blocker === "targeting"
              ? {
                  label: "What is slowing this down: targeting",
                  detail: "The best next move is probably to add or compare real roles before doing more learning.",
                  tone: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
                  Icon: Compass,
                }
              : {
                  label: "What is slowing this down: mixed",
                  detail: "The next move should either reduce uncertainty or move the strongest live role forward.",
                  tone: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
                  Icon: Compass,
                };

  return {
    stateLabel,
    blockerMeta,
    summary: goal.opportunityState?.summary || "",
  };
}

export function CareerCompassCard({
  goal,
  onOpenTab,
  variant = "full",
  showOpenStrategy = true,
}: {
  goal: CareerGoalT;
  onOpenTab: (t: Tab) => void;
  variant?: "full" | "compact";
  showOpenStrategy?: boolean;
}) {
  const coverage = getBroadPursuitCoverage(goal);
  const hasCoverage = goal.decisionMode === "broad-parallel-pursuit" && coverage.combinations.length > 0;
  const isCompact = variant === "compact";
  const gapLines = broadPursuitGapLines(coverage);
  const supportGapLines = gapLines.filter((line) => line.key !== "roles" && line.key !== "covered");
  const firstMissingRole = coverage.missing[0] || null;
  const firstMissingNetwork = coverage.missingNetworkSupport[0] || null;
  const firstMissingPrep = (coverage.missingPrepSupport || coverage.missingLearningSupport)[0] || null;
  const compassSummary = goalCompassSummary(goal);
  const focusSupportLine = goalFocusSupportLine(goal);
  const comparisonLines = goalFocusComparisonLines(goal);
  const leadComparison = comparisonLines[0] || null;
  const secondaryComparisons = comparisonLines.slice(1);
  const mode = goalModeInfo(goal);
  const opportunity = opportunityStateMeta(goal);
  const OpportunityIcon = opportunity.blockerMeta.Icon;

  function openContactDraftForCombination(combination: string) {
    const draft = {
      sector: combination,
      targetOrg: "",
      targetRole: combination,
      why: `Could help you reality-check or open doors for ${combination}.`,
      relatedTrackId: null,
      askType: "advice",
      relationshipStrength: "cold",
      status: "to_contact",
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/network", "contactDraft", draft);
    onOpenTab("network");
  }

  function openLearnDraftForCombination(combination: string) {
    const draft = buildPrepStarterDraft({
      subjectText: combination,
      relatedTrackId: null,
      noteIntro: `Make ${combination} easier to understand, explain, and prepare for.`,
      fallbackTitle: `Learning for ${combination}`,
    });
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
    onOpenTab("learn");
  }

  return (
    <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5" data-testid="career-compass">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-semibold">
              <Compass className="w-3 h-3" /> {PHASE_LABEL[goal.phase]}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-card text-muted-foreground px-2 py-0.5 text-[11px] font-medium border border-card-border">
              {DECISION_MODE_LABEL[goal.decisionMode]}
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
          <h2 className="text-sm font-semibold leading-snug">Career compass</h2>
          <p className="text-xs text-muted-foreground mt-1">{compassSummary}</p>
          <p className="text-xs text-muted-foreground mt-1">{mode.detail}</p>
        </div>
        {showOpenStrategy && (
          <button onClick={() => onOpenTab("strategy")} className="shrink-0 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1" data-testid="button-open-strategy-from-compass">
            Open strategy <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {goal.opportunityState && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-search-snapshot">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">How your search is going</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Compass className="w-3 h-3" /> {opportunity.stateLabel}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${opportunity.blockerMeta.tone}`}>
              <OpportunityIcon className="w-3 h-3" /> {opportunity.blockerMeta.label}
            </span>
          </div>
          <p className="text-sm font-medium mt-2">{opportunity.summary}</p>
          <p className="text-xs text-muted-foreground mt-1">{opportunity.blockerMeta.detail}</p>
        </div>
      )}

      <div className={`mt-3 grid gap-3 ${isCompact ? "sm:grid-cols-1" : "sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]"}`}>
        <div className="rounded-xl border border-card-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your priority right now</p>
          <p className="text-sm font-medium mt-1">{goal.todayPlan.mustDo}</p>
          <p className="text-xs text-muted-foreground mt-1">{focusSupportLine}</p>
        </div>
        {!isCompact && <div className="rounded-xl border border-card-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{hasCoverage ? "Still missing" : "Question to answer"}</p>
          {hasCoverage ? (
            <>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {coverage.covered.length} covered
                </span>
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {coverage.missing.length} missing
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {coverage.missing.length > 0
                  ? `Roles to find: ${compactLanePreview(coverage.missing, "Every target has a real role.")}`
                  : "Every target has a real role."}
              </p>
              {supportGapLines.length > 0 && (
                <div className="mt-1 space-y-1">
                  {supportGapLines.map((line) => (
                    <p key={line.key} className="text-xs text-muted-foreground">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${line.tone}`}>{line.label}</span>
                      <span className="ml-2">{line.text}</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm font-medium mt-1">{goal.decisionQuestion}</p>
          )}
        </div>}
      </div>

      {leadComparison && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-why-first">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why this is your move</p>
          <p className="text-sm font-medium mt-1">{leadComparison.detail}</p>
          {!isCompact && secondaryComparisons.length > 0 && (
            <div className="mt-3 space-y-2">
              {secondaryComparisons.map((line) => (
                <div key={line.workstream}>
                  <p className="text-xs font-medium text-foreground">{line.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{line.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasCoverage && (firstMissingRole || firstMissingNetwork || firstMissingPrep) && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-next-moves">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Close these gaps</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {firstMissingRole && (
              <Button size="sm" variant="outline" onClick={() => onOpenTab("jobs")} data-testid="button-compass-add-role">
                <Briefcase className="w-4 h-4 mr-1" /> Add role
              </Button>
            )}
            {firstMissingNetwork && (
              <Button size="sm" variant="outline" onClick={() => openContactDraftForCombination(firstMissingNetwork)} data-testid="button-compass-add-contact">
                <Users className="w-4 h-4 mr-1" /> Add contact
              </Button>
            )}
            {firstMissingPrep && (
              <Button size="sm" variant="outline" onClick={() => openLearnDraftForCombination(firstMissingPrep)} data-testid="button-compass-add-prep">
                <GraduationCap className="w-4 h-4 mr-1" /> Start learning about
              </Button>
            )}
          </div>
          <div className="mt-2 space-y-1">
            {firstMissingRole && (
              <p className="text-xs text-muted-foreground">
                Still missing a live role for <span className="font-medium text-foreground">{displayCombinationLabel(firstMissingRole)}</span>.
              </p>
            )}
            {firstMissingNetwork && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{displayCombinationLabel(firstMissingNetwork)}</span> still needs someone useful to reach out to.
              </p>
            )}
            {firstMissingPrep && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{displayCombinationLabel(firstMissingPrep)}</span> still needs a learning focus if you want clearer interview or application support.
              </p>
            )}
          </div>
        </div>
      )}

      {hasCoverage && !isCompact && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="broad-pursuit-coverage-summary">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Still missing</p>
          {coverage.missing.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {coverage.missing.map((combination) => (
                <span key={combination} className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {displayCombinationLabel(combination)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Every active role type already has a real role.</p>
          )}
        </div>
      )}

      {hasCoverage && isCompact && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="broad-pursuit-coverage-summary">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              {coverage.covered.length} covered
            </span>
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              {coverage.missing.length} missing
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {coverage.missing.length > 0
              ? `Still missing: ${compactLanePreview(coverage.missing, "Every target has a real role.")}`
              : "Every target has a real role."}
          </p>
          {supportGapLines.length > 0 && (
            <div className="mt-2 space-y-1">
              {supportGapLines.map((line) => (
                <p key={`compact-${line.key}`} className="text-xs text-muted-foreground">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${line.tone}`}>{line.label}</span>
                  <span className="ml-2">{line.text}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {goal.todayPlan.stopRule}
      </p>
    </div>
  );
}

