// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import {
  Trophy, Lightbulb, ArrowUpRight, Briefcase, Users,
  GraduationCap, Target, ChevronRight, Link2, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { CareerCompassCard } from "@/components/home/CareerCompassCard";
import { GroupLabel } from "@/components/home/GroupLabel";
import { Loading } from "@/components/home/Loading";
import type { Tab } from "@/lib/homeTypes";
import type { CareerGoalT, GoalsStateResponseT } from "@/lib/goalSpine";
import { WIN_CATEGORY_LABEL } from "@/lib/homeTypes";

type TrackDiagnostic = {
  id: number; slug: string; name: string; status: string; priority: number; whyItFits: string;
  counts: { jobs: number; learn: number; contacts: number; hustles: number; tasks: number };
  signals: { directionGap: number; readinessGap: number; proofGap: number; warmthGap: number; executionGap: number; learningGap?: number; learnProofGap?: number; evidenceGap?: number };
  evidence?: {
    count: number; topCategory: string | null;
    producingVsPlanning: "producing" | "balanced" | "planning" | "idle";
    executionRatio: number | null; lastEvidenceAt: number | null;
  };
  learningGap?: {
    requiredCount: number; evidencedCount: number; gapCount: number;
    topGapLabel: string | null; topGapHasResource: boolean; recommendedMove: string | null;
  } | null;
  bottleneck: string; bottleneckLabel: string; recommendedMove: string;
};
type UnlinkedItem = { entity: "jobs" | "learn" | "contacts" | "hustles"; id: number; title: string; status: string };
type StrategyInsight = { kind: string; text: string };
type LearningGapSignal = {
  trackId: number; trackName: string; gapDomains: string[];
  topGap: { domain: string; label: string };
  recommendedMove: string; hasResource: boolean;
};
type FrontDoor = {
  tracks: TrackDiagnostic[];
  topThree: TrackDiagnostic[];
  insights: StrategyInsight[];
  unlinked: { items: UnlinkedItem[]; counts: Record<string, number> };
  evidence?: unknown;
  learningGap?: LearningGapSignal | null;
};

const PVP_META: Record<"producing" | "balanced" | "planning" | "idle", { label: string; cls: string }> = {
  producing: { label: "Producing", cls: "bg-primary/10 text-primary" },
  balanced: { label: "Balanced", cls: "bg-slate-100 text-slate-600" },
  planning: { label: "Planning, not producing", cls: "bg-slate-200 text-slate-700" },
  idle: { label: "Idle", cls: "bg-muted text-muted-foreground" },
};
function EvidenceChips({ ev }: { ev: NonNullable<TrackDiagnostic["evidence"]> }) {
  const pvp = PVP_META[ev.producingVsPlanning];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="evidence-chips">
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-medium px-1.5 py-0.5" data-testid="evidence-count">
        <Trophy className="w-3 h-3" /> {ev.count} {ev.count === 1 ? "win" : "wins"} · 28d
      </span>
      {ev.topCategory && (
        <span className="inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid="evidence-top-category">
          {WIN_CATEGORY_LABEL[ev.topCategory as keyof typeof WIN_CATEGORY_LABEL] || ev.topCategory}
        </span>
      )}
      <span className={`inline-flex shrink-0 text-[10px] rounded-full px-1.5 py-0.5 ${pvp.cls}`} data-testid="evidence-pvp">{pvp.label}</span>
    </div>
  );
}
function CapabilityChips({ lg }: { lg: NonNullable<TrackDiagnostic["learningGap"]> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="capability-chips">
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium px-1.5 py-0.5" data-testid="capability-evidenced">
        {lg.evidencedCount}/{lg.requiredCount} capabilities
      </span>
      {lg.gapCount > 0 && (
        <span className="inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid="capability-gap">
          {lg.gapCount} gap{lg.gapCount === 1 ? "" : "s"}{lg.topGapLabel ? ` · ${lg.topGapLabel}` : ""}
        </span>
      )}
      {lg.gapCount > 0 && lg.topGapLabel && (
        <span className={`inline-flex shrink-0 text-[10px] rounded-full px-1.5 py-0.5 ${lg.topGapHasResource ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-700"}`} data-testid="capability-resource">
          {lg.topGapHasResource ? "resource ready" : "no resource yet"}
        </span>
      )}
    </div>
  );
}

export function StrategyView({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const { data, isLoading } = useQuery<FrontDoor>({ queryKey: ["/api/strategy/front-door"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: careerTracks = [] } = useCareerTracks();
  if (isLoading) return <Loading />;
  const activeGoal = goalState?.goals?.[0] || null;
  const tracks = data?.tracks || [];
  const insights = (data?.insights || []).map((i) => i.text);
  const unlinkedItems = data?.unlinked?.items || [];
  const active = tracks.filter((t) => t.status === "active");
  const watching = tracks.filter((t) => t.status !== "active");

  const TrackCard = ({ t }: { t: TrackDiagnostic }) => {
    const stalled = t.bottleneck !== "none";
    return (
      <div className="rounded-xl border border-card-border bg-card p-4" data-testid={`track-${t.slug}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug">{t.name}</h3>
            {t.whyItFits && <p className="text-xs text-muted-foreground mt-0.5">{t.whyItFits}</p>}
          </div>
          <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{t.counts.jobs} role{t.counts.jobs !== 1 ? "s" : ""}</span>
        </div>
        {stalled ? (
          <div className="rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 px-3 py-2 mt-2.5" data-testid={`track-health-${t.slug}`}>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-snug">{t.bottleneckLabel}</p>
            <p className="text-xs text-primary mt-1.5 flex items-start gap-1"><ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-px" />{t.recommendedMove}</p>
          </div>
        ) : (
          <p className="text-xs text-primary mt-2.5 flex items-start gap-1" data-testid={`track-health-${t.slug}`}><ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-px" />{t.recommendedMove}</p>
        )}
      </div>
    );
  };

  const ENTITY_TAB: Record<UnlinkedItem["entity"], Tab> = { jobs: "jobs", learn: "learn", contacts: "network", hustles: "strategy" };
  const ENTITY_LABEL: Record<UnlinkedItem["entity"], string> = { jobs: "Job", learn: "Learn", contacts: "Contact", hustles: "Proof" };
  async function linkUnlinked(it: UnlinkedItem, trackId: number) {
    await mutateAndInvalidate("PATCH", `/api/${it.entity}/${it.id}/link-track`, { trackId }, [`/api/${it.entity}`, "/api/strategy", "/api/strategy/diagnostics", "/api/strategy/unlinked", "/api/strategy/front-door", ...GOAL_SPINE_QUERY_KEYS]);
  }

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Strategy</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-5">Active role types and what each needs.</p>
      {activeGoal && (
        <CareerCompassCard goal={activeGoal} onOpenTab={onOpenTab} variant="compact" showOpenStrategy={false} />
      )}

      {insights.length > 0 && (
        <div className="mb-6 space-y-2">
          {insights.map((ins, i) => (
            <div key={i} className="rounded-xl border border-accent-foreground/15 bg-accent/40 p-4 flex items-start gap-2.5" data-testid={`insight-${i}`}>
              <Lightbulb className="w-4 h-4 text-accent-foreground shrink-0 mt-0.5" />
              <p className="text-sm leading-snug">{ins}</p>
            </div>
          ))}
        </div>
      )}

      {active.length > 0 ? (
        <>
          <GroupLabel>Active role types</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {active.map((t) => <TrackCard key={t.id} t={t} />)}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground mb-6">No active role types yet — add roles in the Jobs tab to get started.</p>
      )}

      {watching.length > 0 && (
        <>
          <GroupLabel>Watching</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {watching.map((t) => <TrackCard key={t.id} t={t} />)}
          </div>
        </>
      )}

      {unlinkedItems.length > 0 && (
        <div className="mb-6">
          <GroupLabel count={unlinkedItems.length}><AlertTriangle className="w-4 h-4 text-destructive" /> Not linked to a role type</GroupLabel>
          <p className="text-xs text-muted-foreground mb-2">These items aren't tied to any role type yet — link them so they count toward the right target.</p>
          <div className="space-y-2">
            {unlinkedItems.map((it) => (
              <div key={`${it.entity}-${it.id}`} className="flex items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2" data-testid={`unlinked-${it.entity}-${it.id}`}>
                <span className="text-[10px] rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 shrink-0">{ENTITY_LABEL[it.entity]}</span>
                <span className="flex-1 text-sm truncate">{it.title}</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 shrink-0" data-testid={`button-link-unlinked-${it.entity}-${it.id}`}><Link2 className="w-3.5 h-3.5" /> Link</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-1.5" align="end">
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a role type</p>
                    <div className="space-y-0.5">
                      {careerTracks.map((t) => (
                        <button key={t.id} onClick={() => linkUnlinked(it, t.id)} className="w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate">{t.name}</button>
                      ))}
                      {careerTracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No role types yet.</p>}
                    </div>
                  </PopoverContent>
                </Popover>
                <button onClick={() => onOpenTab(ENTITY_TAB[it.entity])} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open"><ChevronRight className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-8">
        <Button size="sm" variant="outline" onClick={() => onOpenTab("jobs")}><Briefcase className="w-4 h-4 mr-1" /> Jobs</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("network")}><Users className="w-4 h-4 mr-1" /> Network</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("learn")}><GraduationCap className="w-4 h-4 mr-1" /> Learn</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("today")}><Target className="w-4 h-4 mr-1" /> Back to Today</Button>
      </div>
    </div>
  );
}
