import { ArrowUpRight, Briefcase, Compass, GraduationCap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildLearnStarterDraft } from "@/lib/learnStarter";
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
  getBroadPursuitCoverage,
  PHASE_LABEL,
} from "@/lib/goalSpine";

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
  const firstMissingPrep = coverage.missingLearningSupport[0] || null;
  const compassSummary = hasCoverage
    ? "You are testing several role types in parallel. Get one real role into each before narrowing."
    : goal.reason;

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
    const draft = buildLearnStarterDraft({
      subjectText: combination,
      relatedTrackId: null,
      noteIntro: `Make ${combination} easier to understand, explain, and prepare for.`,
      fallbackTitle: `Prep for ${combination}`,
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
            {goal.landingPriority === "credible-role-quickly" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-card text-muted-foreground px-2 py-0.5 text-[11px] font-medium border border-card-border">
                land something credible soon
              </span>
            )}
          </div>
          <h2 className="text-sm font-semibold leading-snug">Career compass</h2>
          <p className="text-xs text-muted-foreground mt-1">{compassSummary}</p>
        </div>
        {showOpenStrategy && (
          <button onClick={() => onOpenTab("strategy")} className="shrink-0 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1" data-testid="button-open-strategy-from-compass">
            Open strategy <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className={`mt-3 grid gap-3 ${isCompact ? "sm:grid-cols-1" : "sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]"}`}>
        <div className="rounded-xl border border-card-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">What matters now</p>
          <p className="text-sm font-medium mt-1">{goal.todayPlan.mustDo}</p>
          <p className="text-xs text-muted-foreground mt-1">{goal.selectionRule}</p>
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
                  ? `Still missing real role examples: ${compactLanePreview(coverage.missing, "Every target has a real role.")}`
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

      {hasCoverage && (firstMissingRole || firstMissingNetwork || firstMissingPrep) && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="career-compass-next-moves">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Make the next gap easier</p>
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
                <GraduationCap className="w-4 h-4 mr-1" /> Add starter
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
                <span className="font-medium text-foreground">{displayCombinationLabel(firstMissingPrep)}</span> still needs one prep item if you want clearer interview or application support.
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

