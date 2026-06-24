import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Gauge,
  Layers3,
  ListTodo,
  LockKeyhole,
  RefreshCw,
  Route,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

type BlueprintOwner = "anchor" | "user" | "shared";
type PrioritySlot = "now" | "active" | "next" | "parallel" | "later" | "blocked" | "conditional" | "completed";
type PriorityLiveState = "not_materialized" | "open" | "completed" | "stale";

type PriorityCandidate = {
  taskId: string;
  title: string;
  workstreamId: string;
  selected: boolean;
  rank: number;
  slot: PrioritySlot;
  owner: BlueprintOwner;
  effort: "quick" | "medium" | "deep" | "project";
  liveState: PriorityLiveState;
  liveTaskId: number | null;
  whyNow: string;
  notNowReason: string;
  expectedEvidence: string;
  minimumOutcome: string;
};

type ExecutionPriorityModel = {
  mode: "execution_priority_model";
  targetLabel: string;
  selectionLogic: string;
  candidates: PriorityCandidate[];
  activeSlice: {
    status: "ready" | "at_capacity" | "no_ready_work" | "maintenance_only";
    maxTasks: number;
    newTaskIds: string[];
    existingActiveTaskIds: string[];
    deferredTaskCount: number;
    estimatedMinutes: number;
  };
  materialization: {
    status: "not_materialized" | "partially_materialized" | "active" | "complete";
  };
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    caveats: string[];
  };
};

type ExecutionPriorityResponse = {
  executionPriorityModel?: ExecutionPriorityModel | null;
  executionBlueprintModel?: {
    workstreams: Array<{ workstreamId: string; title: string }>;
  } | null;
  priorityContext?: {
    deadlineSignals: Array<{
      label: string;
      dueDate: string;
      daysUntil: number;
    }>;
  };
};

type MaterializationResponse = ExecutionPriorityResponse & {
  materializationResult?: {
    created?: Array<{ blueprintTaskId: string; liveTaskId: number }>;
    reused?: Array<{ blueprintTaskId: string; liveTaskId: number }>;
    skipped?: Array<{ blueprintTaskId: string; reason: string }>;
  };
};

const OWNER_META: Record<BlueprintOwner, { label: string; icon: typeof Bot; tone: string }> = {
  anchor: { label: "Anchor-led", icon: Bot, tone: "bg-primary/10 text-primary" },
  shared: { label: "Shared", icon: UsersRound, tone: "bg-sky-50 text-sky-700" },
  user: { label: "User-led", icon: UserRound, tone: "bg-violet-50 text-violet-700" },
};

const SLOT_META: Record<PrioritySlot, { label: string; tone: string }> = {
  now: { label: "Best next move", tone: "bg-primary text-primary-foreground" },
  active: { label: "Already active", tone: "bg-emerald-50 text-emerald-700" },
  next: { label: "Next after prerequisite", tone: "bg-amber-50 text-amber-800" },
  parallel: { label: "Can run in parallel", tone: "bg-sky-50 text-sky-700" },
  later: { label: "Later", tone: "bg-muted text-muted-foreground" },
  blocked: { label: "Needs prerequisite", tone: "bg-amber-50 text-amber-800" },
  conditional: { label: "Role-specific", tone: "bg-muted text-muted-foreground" },
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-700" },
};

const EFFORT_LABEL = {
  quick: "Quick",
  medium: "Focused",
  deep: "Deep work",
  project: "Project",
} as const;

const QUALITY_META = {
  complete: { label: "Selection checks complete", tone: "bg-emerald-50 text-emerald-700" },
  usable_with_caveats: { label: "Selection usable", tone: "bg-sky-50 text-sky-700" },
  provisional: { label: "Selection provisional", tone: "bg-amber-50 text-amber-800" },
} as const;

function list(values?: string[]) {
  return (values || []).map((value) => String(value || "").trim()).filter(Boolean);
}

function ActiveTaskCard({ candidate, workstreamTitle }: { candidate: PriorityCandidate; workstreamTitle: string }) {
  const owner = OWNER_META[candidate.owner];
  const OwnerIcon = owner.icon;
  const slot = SLOT_META[candidate.slot];
  return (
    <article className={`rounded-xl border p-3 ${candidate.slot === "now" ? "border-primary/40 bg-primary/[0.04]" : "border-card-border bg-card"}`} data-testid={`priority-task-${candidate.taskId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${slot.tone}`}>{slot.label}</span>
            {candidate.liveState === "open" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700">In active work</span>}
          </div>
          <p className="mt-1.5 text-xs font-semibold leading-snug text-foreground">{candidate.title}</p>
          {workstreamTitle && <p className="mt-0.5 text-[10px] text-muted-foreground">{workstreamTitle}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${owner.tone}`}><OwnerIcon className="h-3 w-3" /> {owner.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">{EFFORT_LABEL[candidate.effort]}</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{candidate.whyNow}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-background/70 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Minimum useful result</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{candidate.minimumOutcome}</p>
        </div>
        <div className="rounded-lg bg-background/70 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Evidence this creates</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{candidate.expectedEvidence}</p>
        </div>
      </div>
    </article>
  );
}

export function TrackExecutionPriority({ trackId }: { trackId?: number }) {
  const queryKey = `/api/career-tracks/${trackId}/execution-priority`;
  const { data, isLoading, isError, refetch } = useQuery<ExecutionPriorityResponse>({
    queryKey: [queryKey],
    enabled: Boolean(trackId),
    staleTime: 30_000,
    retry: false,
  });
  const materialize = useMutation<MaterializationResponse>({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/career-tracks/${trackId}/execution-priority/materialize`, {});
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [queryKey] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/anchor/today"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/plan/current"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] }),
      ]);
    },
  });

  const model = data?.executionPriorityModel;
  const workstreamTitleById = useMemo(
    () => new Map((data?.executionBlueprintModel?.workstreams || []).map((workstream) => [workstream.workstreamId, workstream.title])),
    [data?.executionBlueprintModel?.workstreams],
  );

  if (!trackId) return null;
  if (isLoading) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Selecting the smallest useful active slice</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is balancing evidence value, readiness, urgency, effort and your current task load.</p>
      </section>
    );
  }
  if (isError || !model) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground">Active slice not available yet</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">The full execution blueprint remains available while Anchor refreshes the current work context.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>
        </div>
      </section>
    );
  }

  const selected = model.candidates.filter((candidate) => candidate.selected).sort((left, right) => left.rank - right.rank);
  const deferred = model.candidates.filter((candidate) => !candidate.selected && candidate.slot !== "completed");
  const quality = QUALITY_META[model.quality.status];
  const newTaskCount = model.activeSlice.newTaskIds.length;
  const alreadyActive = model.materialization.status === "active" || model.materialization.status === "complete" || newTaskCount === 0;
  const deadlineSignals = data?.priorityContext?.deadlineSignals || [];
  const materialization = materialize.data?.materializationResult;
  const createdCount = materialization?.created?.length || 0;
  const reusedCount = materialization?.reused?.length || 0;
  const skippedCount = materialization?.skipped?.length || 0;

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-execution-priority">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><Gauge className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">What Anchor is moving into active work</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.selectionLogic}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">The complete blueprint remains intact. Today separately decides what fits your actual time and energy.</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${quality.tone}`}>{quality.label}</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-card-border bg-card p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active slice</p><p className="mt-1 text-lg font-semibold text-foreground">{selected.length}</p><p className="text-[10px] text-muted-foreground">maximum {model.activeSlice.maxTasks}</p></div>
        <div className="rounded-lg border border-card-border bg-card p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimated work</p><p className="mt-1 text-lg font-semibold text-foreground">{model.activeSlice.estimatedMinutes}</p><p className="text-[10px] text-muted-foreground">minutes across the slice</p></div>
        <div className="rounded-lg border border-card-border bg-card p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Already active</p><p className="mt-1 text-lg font-semibold text-foreground">{model.activeSlice.existingActiveTaskIds.length}</p><p className="text-[10px] text-muted-foreground">preserved rather than replaced</p></div>
        <div className="rounded-lg border border-card-border bg-card p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Held for later</p><p className="mt-1 text-lg font-semibold text-foreground">{model.activeSlice.deferredTaskCount}</p><p className="text-[10px] text-muted-foreground">not added to active work</p></div>
      </div>

      {deadlineSignals.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
          <div className="flex items-start gap-2"><Clock3 className="mt-0.5 h-3.5 w-3.5 text-amber-800" /><div><p className="text-[11px] font-medium text-amber-900">Current deadline signals considered</p><div className="mt-1 flex flex-wrap gap-1">{deadlineSignals.slice(0, 4).map((signal) => <span key={`${signal.label}-${signal.dueDate}`} className="rounded-full bg-background px-2 py-0.5 text-[9px] text-amber-900">{signal.label} · {signal.daysUntil <= 0 ? "due now" : `${signal.daysUntil}d`}</span>)}</div></div></div>
        </div>
      )}

      {selected.length === 0 ? (
        <div className="mt-3 rounded-xl bg-muted/30 p-3"><p className="text-xs font-semibold text-foreground">No new work should be activated</p><p className="mt-1 text-[11px] leading-snug text-muted-foreground">{model.activeSlice.status === "at_capacity" ? "Your current task load already fills the safe active slice." : "No blueprint task is both ready and valuable enough to add right now."}</p></div>
      ) : (
        <div className="mt-4 space-y-2">{selected.map((candidate) => <ActiveTaskCard key={candidate.taskId} candidate={candidate} workstreamTitle={workstreamTitleById.get(candidate.workstreamId) || ""} />)}</div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-card-border bg-card p-3">
        <div className="flex items-start gap-2">
          {alreadyActive ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" /> : <ListTodo className="mt-0.5 h-4 w-4 text-primary" />}
          <div>
            <p className="text-xs font-semibold text-foreground">{alreadyActive ? "The selected slice is active" : `${newTaskCount} selected task${newTaskCount === 1 ? " is" : "s are"} ready to activate`}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{alreadyActive ? "Anchor will re-evaluate the slice as work is completed or your context changes." : "Anchor will add the selected work to Inbox. The daily planner remains the only authority for Today."}</p>
          </div>
        </div>
        {!alreadyActive && <Button size="sm" onClick={() => materialize.mutate()} disabled={materialize.isPending} data-testid="button-materialize-execution-slice">{materialize.isPending ? <Sparkles className="mr-1 h-3.5 w-3.5 animate-pulse" /> : <ListTodo className="mr-1 h-3.5 w-3.5" />}{materialize.isPending ? "Activating" : "Activate selected work"}</Button>}
      </div>

      {materialize.isSuccess && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-emerald-800" data-testid="materialization-success"><CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />{createdCount ? `${createdCount} task${createdCount === 1 ? " was" : "s were"} added to active-work Inbox.` : reusedCount ? `${reusedCount} active task${reusedCount === 1 ? " was" : "s were"} retained.` : "No additional live task was needed."}{skippedCount ? ` ${skippedCount} item${skippedCount === 1 ? " was" : "s were"} held back by safeguards.` : ""}</p>
      )}
      {materialize.isError && <p className="mt-2 text-[11px] leading-snug text-destructive">The selection remains saved, but Anchor could not add the tasks. Retry without rebuilding the plan.</p>}

      {deferred.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-muted/20 p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-foreground"><span className="flex items-center gap-1.5"><Layers3 className="h-3.5 w-3.5 text-primary" /> Why {deferred.length} blueprint task{deferred.length === 1 ? " is" : "s are"} not active</span><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></summary>
          <div className="mt-2 space-y-1.5">{deferred.slice(0, 12).map((candidate) => { const slot = SLOT_META[candidate.slot]; return <div key={candidate.taskId} className="rounded-lg bg-background/70 p-2"><div className="flex flex-wrap items-center gap-1.5"><p className="text-[11px] font-medium text-foreground">{candidate.title}</p><span className={`rounded-full px-1.5 py-0.5 text-[9px] ${slot.tone}`}>{slot.label}</span>{candidate.slot === "conditional" && <Route className="h-3 w-3 text-muted-foreground" />}</div><p className="mt-1 text-[10px] leading-snug text-muted-foreground">{candidate.notNowReason}</p></div>; })}</div>
        </details>
      )}

      {list(model.quality.caveats).length > 0 && <details className="mt-3 rounded-xl border border-card-border bg-muted/20 p-3"><summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground"><CircleHelp className="h-3.5 w-3.5 text-primary" /> Selection caveats</summary><div className="mt-2 space-y-1">{list(model.quality.caveats).map((caveat) => <p key={caveat} className="text-[11px] leading-snug text-muted-foreground">• {caveat}</p>)}</div></details>}

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-muted/20 p-2.5"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" /><p className="text-[10px] leading-snug text-muted-foreground">Anchor selects automatically, but materialization only declares the active strategic slice. The Today planner separately selects what is realistic for the current day.</p></div>
    </section>
  );
}
