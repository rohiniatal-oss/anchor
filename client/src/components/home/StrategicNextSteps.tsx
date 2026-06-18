import { Button } from "@/components/ui/button";
import type { Recommendation } from "@shared/schema";
import type { Tab } from "@/lib/homeTypes";
import {
  deriveTrackNextActions,
  runTrackNextAction,
  type TrackActionDiagnostic,
  type TrackNextAction,
} from "@/lib/trackNextAction";

function nextStepsFooterText(steps: TrackNextAction[]) {
  const setupCount = steps.filter((step) => step.mode === "setup").length;
  const doNowCount = steps.filter((step) => step.mode === "do-now").length;
  if (doNowCount > 0 && setupCount === 0) {
    return "Start with the first one. The rest can wait until that move is done.";
  }
  if (doNowCount > 0) {
    return "Do the first one if it is already live. If not, set up the smallest missing piece and I will shape the day from there.";
  }
  return "Add one or two of these - I will shape a day plan from there.";
}

export function StrategicNextSteps({
  tracks,
  recommendations,
  onOpenTab,
  onAcceptRecommendation,
  compact = false,
  modeFilter = "all",
}: {
  tracks: TrackActionDiagnostic[];
  recommendations: Recommendation[];
  onOpenTab: (t: Tab) => void;
  onAcceptRecommendation?: (rec: Recommendation) => Promise<void>;
  compact?: boolean;
  modeFilter?: "all" | "setup-only";
}) {
  const allSteps = deriveTrackNextActions(tracks, recommendations).slice(0, 3);
  const steps = modeFilter === "setup-only"
    ? allSteps.filter((step) => step.mode === "setup")
    : allSteps;

  async function handleAction(step: TrackNextAction) {
    await runTrackNextAction(
      step,
      onOpenTab,
      async (rec) => {
        if (onAcceptRecommendation) {
          await onAcceptRecommendation(rec as Recommendation);
          return;
        }
        onOpenTab(step.kind === "warmth_saved" ? "network" : step.kind === "learning_saved" ? "learn" : "today");
      },
    );
  }

  if (steps.length === 0) {
    if (compact) return null;
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center" data-testid="strategic-next-steps-empty">
        <p className="text-sm text-muted-foreground mb-3">
          Add a thought, a job, or something to learn - I will shape a day from there.
        </p>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("braindump")}>
          Brain dump
        </Button>
      </div>
    );
  }

  if (compact) {
    const top = steps[0];
    const Icon = top.icon;
    return (
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-card-border bg-card p-3.5" data-testid="strategic-next-steps-compact">
        <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{top.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{top.detail}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void handleAction(top)} className="shrink-0 text-xs">
          {top.action}{" ->"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5" data-testid="strategic-next-steps">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-3">
        Your job search needs these first
      </p>
      <div className="space-y-2.5">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={`${step.trackId}:${step.kind}`} className="flex items-start gap-3 rounded-xl bg-card border border-card-border p-3.5">
              <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleAction(step)}
                className="shrink-0 text-xs"
                data-testid={`button-strategic-step-${i}`}
              >
                {step.action}{" ->"}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {nextStepsFooterText(steps)}
      </p>
    </div>
  );
}
