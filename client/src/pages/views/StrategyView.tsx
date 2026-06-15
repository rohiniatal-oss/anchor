import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  ChevronRight,
  Lightbulb,
  Link2,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CareerCompassCard } from "@/components/home/CareerCompassCard";
import { GroupLabel } from "@/components/home/GroupLabel";
import { Loading } from "@/components/home/Loading";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { mutateAndInvalidate } from "@/lib/api";
import {
  CareerGoalT,
  GoalsStateResponseT,
  combinationCoverageState,
  getBroadPursuitCoverage,
  nextLaneGap,
} from "@/lib/goalSpine";
import { GOAL_SPINE_QUERY_KEYS, type Tab, WIN_CATEGORY_LABEL } from "@/lib/homeTypes";
import type { WinCategory } from "@shared/domainState";

type TrackDiagnostic = {
  id: number; slug: string; name: string; status: string; priority: number; whyItFits: string;
  counts: { jobs: number; learn: number; contacts: number; hustles: number; tasks: number };
  signals: { directionGap: number; readinessGap: number; proofGap: number; warmthGap: number; executionGap: number; learningGap?: number; learnProofGap?: number; evidenceGap?: number };
  evidence?: {
    count: number; topCategory: WinCategory | null;
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

const BOTTLENECK_LABEL: Record<string, string> = {
  direction: "Direction", readiness: "Readiness", proof: "Proof support", warmth: "Warmth", execution: "Execution", learning: "Capability", none: "Healthy",
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
          {WIN_CATEGORY_LABEL[ev.topCategory]}
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

function WorkstreamGrid({ goal }: { goal: CareerGoalT }) {
  const top = goal.workstreams.filter((w) => w.nextMoveType !== "wait").slice(0, 4);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <GroupLabel>What needs attention</GroupLabel>
        <span className="text-xs text-muted-foreground">Focus: {goal.recommendedFocus}</span>
      </div>
      <div className="space-y-2">
        {top.map((w) => (
          <div
            key={w.name}
            className={`rounded-xl border p-3 ${goal.recommendedFocus === w.name ? "border-primary/25 bg-primary/5" : "border-card-border bg-card"}`}
            data-testid={`workstream-${w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{w.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{w.nextMoves[0] || w.bottleneck}</p>
              </div>
              {goal.recommendedFocus === w.name && (
                <span className="inline-flex rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">focus</span>
              )}
            </div>
            {w.evidence.length > 0 && <p className="text-[11px] text-muted-foreground/80 mt-2">{w.evidence[0]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PursuitPortfolioGrid({ goal }: { goal: CareerGoalT }) {
  const portfolio = goal.pursuitPortfolio || [];
  if (goal.decisionMode !== "broad-parallel-pursuit" || portfolio.length === 0) return null;
  const coverage = getBroadPursuitCoverage(goal);

  return (
    <div className="mb-6" data-testid="pursuit-portfolio">
      <div className="flex items-center justify-between gap-3 mb-2">
        <GroupLabel>Live lanes</GroupLabel>
        <span className="text-xs text-muted-foreground">
          {coverage.missing.length > 0
            ? `${coverage.missing.length} still empty`
            : "Every active lane has a real role"}
        </span>
      </div>
      <div className="space-y-2">
        {portfolio.map((item) => {
          const state = combinationCoverageState(goal, item.combination);
          const gap = nextLaneGap(goal, item.combination);
          const tone = state === "covered"
            ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/10"
            : state === "missing"
            ? "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/10"
            : "border-card-border bg-card";
          const badge = state === "covered"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : state === "missing"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            : "bg-muted text-muted-foreground";
          const badgeLabel = state === "covered" ? "covered" : state === "missing" ? "still empty" : "watch";
          return (
            <div
              key={item.combination}
              className={`rounded-xl border p-3 ${tone}`}
              data-testid={`pursuit-lane-${item.combination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{item.combination}</p>
                  <p className="text-xs text-muted-foreground mt-1">{gap.detail}</p>
                </div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge}`}>{badgeLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StrategyView({
  onOpenTab,
  proofAssetsSlot,
}: {
  onOpenTab: (t: Tab) => void;
  proofAssetsSlot?: ReactNode;
}) {
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

  const Stat = ({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) => (
    <div className="flex flex-col">
      <span className={`text-sm font-semibold tabular-nums ${dim ? "text-muted-foreground" : "text-foreground"}`}>{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );

  const Card = ({ t }: { t: TrackDiagnostic }) => {
    const health = t.bottleneck ?? "none";
    return (
      <div className="rounded-xl border border-card-border bg-card p-4" data-testid={`track-${t.slug}`}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug">{t.name}</h3>
            {t.whyItFits && <p className="text-xs text-muted-foreground mt-0.5">{t.whyItFits}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full text-[11px] font-semibold px-2 py-0.5 ${health === "none" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`} data-testid={`track-health-${t.slug}`}>{BOTTLENECK_LABEL[health] || health}</span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <Stat label="Roles" value={t.counts.jobs} dim={t.counts.jobs === 0} />
          <Stat label="Learning" value={t.counts.learn} dim={t.counts.learn === 0} />
          <Stat label="Contacts" value={t.counts.contacts} dim={t.counts.contacts === 0} />
          <Stat label="Proof" value={t.counts.hustles} dim={t.counts.hustles === 0} />
        </div>
        <div className="rounded-lg bg-muted/60 px-3 py-2">
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Bottleneck:</span> {t.bottleneckLabel}</p>
          <p className="text-xs text-primary mt-1 inline-flex items-center gap-1"><ArrowUpRight className="w-3.5 h-3.5" /> {t.recommendedMove}</p>
        </div>
        {t.evidence && <EvidenceChips ev={t.evidence} />}
        {t.learningGap && <CapabilityChips lg={t.learningGap} />}
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
      <p className="text-sm text-muted-foreground mt-1 mb-5">Which lanes are live, and what each needs next.</p>
      {activeGoal && (
        <>
          <CareerCompassCard goal={activeGoal} onOpenTab={onOpenTab} variant="compact" showOpenStrategy={false} />
          <PursuitPortfolioGrid goal={activeGoal} />
          <WorkstreamGrid goal={activeGoal} />
        </>
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

      <GroupLabel>Active paths</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
        {active.map((t) => <Card key={t.id} t={t} />)}
      </div>

      {watching.length > 0 && (
        <>
          <GroupLabel>Watching</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {watching.map((t) => <Card key={t.id} t={t} />)}
          </div>
        </>
      )}

      {unlinkedItems.length > 0 && (
        <div className="mb-6">
          <GroupLabel count={unlinkedItems.length}><AlertTriangle className="w-4 h-4 text-destructive" /> Unlinked — no track yet</GroupLabel>
          <p className="text-xs text-muted-foreground mb-2">These live items aren't tied to a path, so they don't count toward any track's health. Link each one.</p>
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
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a track</p>
                    <div className="space-y-0.5">
                      {careerTracks.map((t) => (
                        <button key={t.id} onClick={() => linkUnlinked(it, t.id)} className="w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate">{t.name}</button>
                      ))}
                      {careerTracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tracks yet.</p>}
                    </div>
                  </PopoverContent>
                </Popover>
                <button onClick={() => onOpenTab(ENTITY_TAB[it.entity])} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open"><ChevronRight className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {proofAssetsSlot && (
        <div className="mt-8 pt-6 border-t border-card-border">
          {proofAssetsSlot}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-8">
        <Button size="sm" variant="outline" onClick={() => onOpenTab("jobs")}><Briefcase className="w-4 h-4 mr-1" /> Jobs</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("network")}><Users className="w-4 h-4 mr-1" /> Network</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("today")}><Target className="w-4 h-4 mr-1" /> Back to Today</Button>
      </div>
    </div>
  );
}
