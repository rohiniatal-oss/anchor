// @ts-nocheck
import { Briefcase, GraduationCap, Users, ListChecks, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildLearnStarterDraft } from "@/lib/learnStarter";
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
  counts: { jobs: number; contacts: number };
};

type NextStep = {
  icon: typeof Briefcase;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
};

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
      steps.push({
        icon: Briefcase,
        title: `Add a job or role for "${track.name}"`,
        detail: "Even a wishlist role gives this track direction - the search cannot move without one.",
        action: "Add a job",
        onClick: () => onOpenTab("jobs"),
      });
    } else if (b === "learning" || b === "readiness") {
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
            ? `Use the saved ${domainLabel} starter for "${track.name}"`
            : `Use the saved learning starter for "${track.name}"`
          : domainLabel
            ? `Start studying ${domainLabel} for "${track.name}"`
            : `Add a learning item for "${track.name}"`,
        detail: savedLearningRec
          ? `${savedLearningRec.title} is already waiting in Learn, so you can begin from that instead of setting one up from scratch.`
          : domainLabel
            ? `${domainLabel} is a real weak area for this role type, so Anchor should give you one clear way to begin.`
            : "This track needs its first learning item before you can be ready to apply.",
        action: savedLearningRec ? "Open starter" : "Use starter",
        onClick: savedLearningRec
          ? () => onOpenTab("learn")
          : () => {
              const draft = buildLearnStarterDraft({
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
    } else if (b === "warmth") {
      steps.push({
        icon: Users,
        title: `Add a contact for "${track.name}"`,
        detail: `You have live jobs for this track but no one to reach out to yet. One advice conversation could open doors.`,
        action: "Add a contact",
        onClick: () => {
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
      steps.push({
        icon: ListChecks,
        title: "Pick one task and finish it today",
        detail: track.bottleneckLabel || "You have tasks ready to go - none have been started yet.",
        action: "See tasks",
        onClick: () => onOpenTab("braindump"),
      });
    } else if (b === "proof") {
      steps.push({
        icon: Rocket,
        title: `Move a stalled project forward for "${track.name}"`,
        detail: "A project you started has stalled. One concrete step today keeps it moving.",
        action: "Open projects",
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
}: {
  tracks: TrackDiagnostic[];
  recommendations: Recommendation[];
  onOpenTab: (t: Tab) => void;
  compact?: boolean;
}) {
  const steps = buildSteps(tracks, recommendations, onOpenTab);

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
        <Button size="sm" variant="outline" onClick={top.onClick} className="shrink-0 text-xs">
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
        Add one or two of these - I will shape a day plan from there.
      </p>
    </div>
  );
}
