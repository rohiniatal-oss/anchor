import { useState } from "react";
import { Briefcase, GraduationCap, Users, ListChecks, Rocket, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mutateAndInvalidate } from "@/lib/api";
import { todayKey } from "@/lib/utils";
import { buildPrepStarterDraft } from "@/lib/learnStarter";
import {
  buildPrefillHash,
  PENDING_CONTACT_DRAFT_KEY,
  PENDING_LEARN_DRAFT_KEY,
  queueIntakeDraft,
  type Tab,
} from "@/lib/homeTypes";
import type { Recommendation } from "@shared/schema";

type TrackDiagnostic = {
  id: number;
  name: string;
  status: string;
  bottleneck: string;
  bottleneckLabel: string;
  recommendedMove: string;
  learningGap: { topGapDomain: string | null; topGapLabel: string | null } | null;
  counts: { jobs: number; contacts: number; tasks?: number };
};

type NextStep = {
  icon: typeof Briefcase;
  title: string;
  detail: string;
  action: string;
  mode: "setup" | "do-now";
  onClick: () => void;
};

function ShapeTodayButton({ className = "" }: { className?: string }) {
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState(false);

  async function shapeToday() {
    if (building) return;
    setBuilding(true);
    setFailed(false);
    try {
      await mutateAndInvalidate(
        "POST",
        "/api/plan/prepare",
        { day: todayKey(), energy: "medium" },
        ["/api/plan/current", "/api/tasks", "/api/stats"],
      );
      // Today keeps its plan in local component state. Reloading after this
      // explicit command lets the pure GET hydrate the newly persisted plan.
      window.location.reload();
    } catch {
      setFailed(true);
      setBuilding(false);
    }
  }

  return (
    <div className={className}>
      <Button size="sm" onClick={shapeToday} disabled={building} data-testid="button-prepare-today-plan">
        {building ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ListChecks className="mr-1 h-3.5 w-3.5" />}
        {building ? "Shaping today" : "Shape today's plan"}
      </Button>
      {failed && <p className="mt-1.5 text-[11px] text-destructive">The plan could not be prepared. Your existing work was not changed.</p>}
    </div>
  );
}

function nextStepsFooterText(steps: NextStep[]) {
  const setupCount = steps.filter((step) => step.mode === "setup").length;
  const doNowCount = steps.filter((step) => step.mode === "do-now").length;
  if (doNowCount > 0 && setupCount === 0) {
    return "Start with the first one. The rest can wait until that move is done.";
  }
  if (doNowCount > 0) {
    return "Do the first one if it is already live. If not, set up the smallest missing piece, then shape today's plan.";
  }
  return "Add one or two of these, then choose when Anchor should shape the day.";
}

function visibleLearningRecommendationForTrack(
  recs: Recommendation[],
  trackId: number,
  gapKey: string | null,
) {
  return (
    recs.find((rec) =>
      rec.linkedTrackId === trackId &&
      rec.collection === "learning-corpus" &&
      !["accepted", "rejected", "archived", "duplicate", "stale"].includes(rec.status) &&
      (!gapKey || rec.linkedGapKey === gapKey)
    ) || null
  );
}

function buildSteps(
  tracks: TrackDiagnostic[],
  recs: Recommendation[],
  onOpenTab: (t: Tab) => void,
): NextStep[] {
  const steps: NextStep[] = [];
  const seen = new Set<string>();

  for (const track of tracks) {
    if (track.status !== "active") continue;
    const b = track.bottleneck;
    if (b === "none") continue;
    const key = `${track.id}:${b}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (b === "direction") {
      const hasSavedRole = track.counts.jobs > 0;
      steps.push({
        icon: Briefcase,
        title: hasSavedRole
          ? `Review the strongest role for "${track.name}"`
          : `Add a job or role for "${track.name}"`,
        detail: hasSavedRole
          ? track.recommendedMove || track.bottleneckLabel || "You already have roles here, so the next move is to sharpen which one is worth pursuing."
          : "Even a wishlist role gives this track direction - the search cannot move without one.",
        action: hasSavedRole ? "Open jobs" : "Add a job",
        mode: hasSavedRole ? "do-now" : "setup",
        onClick: () => onOpenTab("jobs"),
      });
    } else if (b === "learning") {
      const domainLabel = track.learningGap?.topGapLabel || null;
      const domain = domainLabel || track.name;
      const savedLearningRec = visibleLearningRecommendationForTrack(
        recs,
        track.id,
        track.learningGap?.topGapDomain || null,
      );
      steps.push({
        icon: GraduationCap,
        title: savedLearningRec
          ? domainLabel
            ? `Use the saved ${domainLabel} learning item for "${track.name}"`
            : `Use the saved learning item for "${track.name}"`
          : domainLabel
            ? `Set up a ${domainLabel} learning focus for "${track.name}"`
            : `Set up a learning focus for "${track.name}"`,
        detail: savedLearningRec
          ? `${savedLearningRec.title} is already waiting in Learn, so you can begin from that instead of setting one up from scratch.`
          : domainLabel
            ? `${domainLabel} is a real weak area for this role type, so Anchor should give you one clear way to begin.`
            : "This track needs its first learning focus before you can be ready to apply.",
        action: savedLearningRec ? "Open learning item" : "Start learning about",
        mode: savedLearningRec ? "do-now" : "setup",
        onClick: savedLearningRec
          ? () => onOpenTab("learn")
          : () => {
              const draft = buildPrepStarterDraft({
                subjectText: domain,
                relatedTrackId: track.id,
                noteIntro: `Needed for ${track.name}.`,
                fallbackTitle: `Intro to ${domain}`,
              });
              queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
              window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
              onOpenTab("learn");
            },
      });
    } else if (b === "readiness") {
      const hasTaskTrail = (track.counts.tasks || 0) > 0;
      steps.push({
        icon: hasTaskTrail ? ListChecks : Briefcase,
        title: hasTaskTrail
          ? `Review the strongest role for "${track.name}"`
          : `Work the strongest role for "${track.name}"`,
        detail: track.recommendedMove || track.bottleneckLabel || "A real role is close enough to work on now, so the next move should make it more ready rather than add more learning.",
        action: "Open jobs",
        mode: "do-now",
        onClick: () => onOpenTab("jobs"),
      });
    } else if (b === "warmth") {
      const hasContacts = track.counts.contacts > 0;
      steps.push({
        icon: Users,
        title: hasContacts
          ? `Follow up or sharpen the ask for "${track.name}"`
          : `Add a contact for "${track.name}"`,
        detail: hasContacts
          ? track.recommendedMove || track.bottleneckLabel || `You already have people linked here, so the next move is to use that access better.`
          : `You have live jobs for this track but no one to reach out to yet. One advice conversation could open doors.`,
        action: hasContacts ? "Open network" : "Add a contact",
        mode: hasContacts ? "do-now" : "setup",
        onClick: () => {
          if (hasContacts) {
            onOpenTab("network");
            return;
          }
          const draft = {
            relatedTrackId: track.id,
            askType: "advice",
            relationshipStrength: "cold",
            status: "to_contact",
            who: `Someone working in ${track.name.toLowerCase()}`,
            why: `Could help you reality-check or open doors for ${track.name}.`,
          };
          queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
          window.location.hash = buildPrefillHash("/network", "contactDraft", draft);
          onOpenTab("network");
        },
      });
    } else if (b === "execution") {
      continue;
    } else if (b === "proof") {
      steps.push({
        icon: Rocket,
        title: `Move a stalled project forward for "${track.name}"`,
        detail: "A project you started has stalled. One concrete step today keeps it moving.",
        action: "Open projects",
        mode: "do-now",
        onClick: () => onOpenTab("learn"),
      });
    }

    if (steps.length >= 3) break;
  }

  return steps;
}

export function StrategicNextSteps({
  tracks,
  recommendations,
  onOpenTab,
  compact = false,
  modeFilter = "all",
}: {
  tracks: TrackDiagnostic[];
  recommendations: Recommendation[];
  onOpenTab: (t: Tab) => void;
  compact?: boolean;
  modeFilter?: "all" | "setup-only";
}) {
  const allSteps = buildSteps(tracks, recommendations, onOpenTab);
  const steps = modeFilter === "setup-only"
    ? allSteps.filter((step) => step.mode === "setup")
    : allSteps;

  if (steps.length === 0) {
    if (compact) return null;
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center" data-testid="strategic-next-steps-empty">
        <p className="text-sm text-muted-foreground mb-3">
          Add a thought, a job, or something to learn. Anchor will not create a plan until you ask it to.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <ShapeTodayButton />
          <Button size="sm" variant="outline" onClick={() => onOpenTab("braindump")}>
            Brain dump
          </Button>
        </div>
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
        <Button size="sm" variant="outline" onClick={top.onClick} className="shrink-0 text-xs">
          {top.action}{" ->"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5" data-testid="strategic-next-steps">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
          Your job search needs these first
        </p>
        <ShapeTodayButton />
      </div>
      <div className="space-y-2.5">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={i} className="flex items-start gap-3 rounded-xl bg-card border border-card-border p-3.5">
              <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={step.onClick}
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
