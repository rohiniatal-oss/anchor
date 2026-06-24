import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Loader2,
  LockKeyhole,
  PlayCircle,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { mutateAndInvalidate } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type BlueprintOwner = "anchor" | "user" | "shared";
type BlueprintEffort = "quick" | "medium" | "deep" | "project";
type ExecutionSliceDecision = "active" | "queued" | "blocked" | "conditional" | "deferred";

type ExecutionSliceTask = {
  taskId: string;
  decision: ExecutionSliceDecision;
  reason: string;
  rank: number | null;
  title: string;
  owner: BlueprintOwner;
  effort: BlueprintEffort;
  minimumOutcome: string;
  doneWhen: string;
  expectedEvidence: string;
  requirementIds: string[];
  milestoneIds: string[];
};

type ActiveExecutionSliceModel = {
  mode: "active_execution_slice_model";
  targetLabel: string;
  objective: string;
  maxActiveTasks: number;
  maxUserOwnedTasks: number;
  activeTaskIds: string[];
  queuedTaskIds: string[];
  blockedTaskIds: string[];
  conditionalTaskIds: string[];
  deferredTaskIds: string[];
  tasks: ExecutionSliceTask[];
  summary: {
    activeTaskCount: number;
    queuedTaskCount: number;
    blockedTaskCount: number;
    conditionalTaskCount: number;
    deferredTaskCount: number;
    activeAnchorOwnedCount: number;
    activeSharedCount: number;
    activeUserOwnedCount: number;
    totalSelectedSubtasks: number;
  };
  quality: {
    status: "ready" | "usable_with_caveats" | "blocked";
    caveats: string[];
  };
  materializationStatus: "slice_only" | "materialized";
  materializedTaskIds: number[];
};

type ActiveExecutionSliceResponse = {
  activeExecutionSliceModel?: ActiveExecutionSliceModel | null;
  materializedTasks?: Array<{ id: number; title: string }>;
};

const OWNER_META: Record<BlueprintOwner, { label: string; icon: typeof Bot; tone: string }> = {
  anchor: { label: "Anchor-led", icon: Bot, tone: "bg-primary/10 text-primary" },
  shared: { label: "Shared", icon: UsersRound, tone: "bg-sky-50 text-sky-700" },
  user: { label: "User-led", icon: UserRound, tone: "bg-violet-50 text-violet-700" },
};

const EFFORT_LABEL: Record<BlueprintEffort, string> = {
  quick: "Quick",
  medium: "Focused",
  deep: "Deep work",
  project: "Project",
};

function list(values?: string[]) {
  return (values || []).map((value) => String(value || "").trim()).filter(Boolean);
}

function ActiveTaskCard({ task }: { task: ExecutionSliceTask }) {
  const owner = OWNER_META[task.owner];
  const OwnerIcon = owner.icon;
  return (
    <div className="rounded-xl border border-card-border bg-card p-3" data-testid={`active-execution-task-${task.taskId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{task.rank}</span>
            <p className="text-xs font-semibold leading-snug text-foreground">{task.title}</p>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{task.reason}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${owner.tone}`}><OwnerIcon className="h-3 w-3" /> {owner.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">{EFFORT_LABEL[task.effort]}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Minimum useful result</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{task.minimumOutcome}</p>
        </div>
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Done when</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{task.doneWhen}</p>
        </div>
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Evidence created</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{task.expectedEvidence}</p>
        </div>
      </div>
    </div>
  );
}

export function TrackActiveExecutionSlice({ trackId }: { trackId?: number }) {
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");
  const [activatedCount, setActivatedCount] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery<ActiveExecutionSliceResponse>({
    queryKey: [`/api/career-tracks/${trackId}/active-execution-slice`],
    enabled: Boolean(trackId),
    staleTime: 60_000,
    retry: false,
  });

  const model = data?.activeExecutionSliceModel;
  const activeTasks = useMemo(() => (model?.tasks || [])
    .filter((task) => task.decision === "active")
    .sort((left, right) => (left.rank || 999) - (right.rank || 999)), [model?.tasks]);

  async function activateSlice() {
    if (!trackId || !model || activating) return;
    setActivating(true);
    setActivateError("");
    try {
      const result = await mutateAndInvalidate("POST", `/api/career-tracks/${trackId}/active-execution-slice/materialize`, {}, [
        "/api/tasks",
        "/api/anchor/today",
        `/api/career-tracks/${trackId}/active-execution-slice`,
      ]);
      setActivatedCount(Array.isArray(result?.materializedTasks) ? result.materializedTasks.length : model.summary.activeTaskCount);
      await queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/active-execution-slice`] });
    } catch (e: any) {
      setActivateError(e?.message || "Could not activate this slice.");
    } finally {
      setActivating(false);
    }
  }

  if (!trackId) return null;
  if (isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Selecting the active slice</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is choosing the smallest useful set of ready tasks from the full blueprint.</p>
      </div>
    );
  }
  if (isError || !model) {
    return (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Active execution slice not available yet</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor needs a current execution blueprint before it can select live work.</p>
      </div>
    );
  }

  if (!activeTasks.length) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-amber-50/50 p-3" data-testid="track-active-execution-slice">
        <div className="flex items-start gap-2">
          <LockKeyhole className="mt-0.5 h-4 w-4 text-amber-800" />
          <div>
            <p className="text-xs font-semibold text-amber-900">No safe active slice yet</p>
            <p className="mt-1 text-[11px] leading-snug text-amber-900">The available work is blocked, conditional, or too heavy to activate without more context.</p>
          </div>
        </div>
      </section>
    );
  }

  const alreadyMaterialized = model.materializationStatus === "materialized";
  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-active-execution-slice">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><ClipboardCheck className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Recommended active slice</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.objective}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor selected {model.summary.activeTaskCount} ready task{model.summary.activeTaskCount === 1 ? "" : "s"}; the rest stays queued, blocked, or conditional.</p>
          </div>
        </div>
        <Button size="sm" onClick={activateSlice} disabled={activating || alreadyMaterialized} data-testid="button-activate-execution-slice">
          {activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : alreadyMaterialized ? <CheckCircle2 className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
          {alreadyMaterialized ? "Activated" : "Activate slice"}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.activeTaskCount}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Anchor-led</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.activeAnchorOwnedCount}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Shared/User</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.activeSharedCount + model.summary.activeUserOwnedCount}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Held back</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.queuedTaskCount + model.summary.blockedTaskCount + model.summary.conditionalTaskCount + model.summary.deferredTaskCount}</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {activeTasks.map((task) => <ActiveTaskCard key={task.taskId} task={task} />)}
      </div>

      {activatedCount !== null && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" /> {activatedCount} task{activatedCount === 1 ? "" : "s"} now live in Inbox</p>
        </div>
      )}
      {activateError && <p className="mt-2 text-xs text-destructive">{activateError}</p>}

      <details className="mt-3 rounded-xl border border-card-border bg-muted/20 p-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-foreground">
          <span className="flex items-center gap-1.5"><CircleHelp className="h-3.5 w-3.5 text-primary" /> Why the rest is not active</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        </summary>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-4">
          <p className="text-[11px] text-muted-foreground">Queued: {model.summary.queuedTaskCount}</p>
          <p className="text-[11px] text-muted-foreground">Blocked: {model.summary.blockedTaskCount}</p>
          <p className="text-[11px] text-muted-foreground">Role-specific: {model.summary.conditionalTaskCount}</p>
          <p className="text-[11px] text-muted-foreground">Deferred: {model.summary.deferredTaskCount}</p>
        </div>
        {list(model.quality.caveats).length > 0 && (
          <div className="mt-2 space-y-1">
            {list(model.quality.caveats).map((caveat) => <p key={caveat} className="text-[11px] leading-snug text-muted-foreground">• {caveat}</p>)}
          </div>
        )}
      </details>
    </section>
  );
}
