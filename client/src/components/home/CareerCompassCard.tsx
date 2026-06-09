import { ArrowUpRight, Compass } from "lucide-react";
import { Tab } from "@/lib/homeTypes";
import {
  CareerGoalT,
  compactLanePreview,
  DECISION_MODE_LABEL,
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
  const compassSummary = hasCoverage
    ? "Keep multiple plausible lanes live and turn them into real roles before narrowing anything."
    : goal.reason;
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
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{hasCoverage ? "Missing next" : "Decision note"}</p>
          {hasCoverage ? (
            <>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {coverage.covered.length} covered
                </span>
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {coverage.missing.length} empty
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {coverage.missing.length > 0
                  ? `Role gaps: ${compactLanePreview(coverage.missing, "Every target has a real role.")}`
                  : "Every target has a real role."}
              </p>
              {(coverage.missingNetworkSupport.length > 0 || coverage.missingCapabilitySupport.length > 0) && (
                <p className="text-xs text-muted-foreground mt-1">
                  {coverage.missingNetworkSupport.length > 0
                    ? `${coverage.missingNetworkSupport.length} contact gap${coverage.missingNetworkSupport.length > 1 ? "s" : ""}`
                    : "No contact gaps"}
                  {" · "}
                  {coverage.missingCapabilitySupport.length > 0
                    ? `${coverage.missingCapabilitySupport.length} capability gap${coverage.missingCapabilitySupport.length > 1 ? "s" : ""}`
                    : "No capability gaps"}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-medium mt-1">{goal.decisionQuestion}</p>
          )}
        </div>}
      </div>

      {hasCoverage && !isCompact && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3" data-testid="broad-pursuit-coverage-summary">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Still empty</p>
          {coverage.missing.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {coverage.missing.map((combination) => (
                <span key={combination} className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {combination}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Every active combination already has a real role.</p>
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
              {coverage.missing.length} empty
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {coverage.missing.length > 0
              ? `Still empty: ${compactLanePreview(coverage.missing, "Every target has a real role.")}`
              : "Every target has a real role."}
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {goal.todayPlan.stopRule}
      </p>
    </div>
  );
}
