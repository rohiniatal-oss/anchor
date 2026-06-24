import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Flag,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
type OutcomeStatus = "accepted" | "pending_confirmation" | "operational_only" | "insufficient" | "reopened";

type ExecutionOutcomeRecord = {
  id: string;
  liveTaskId: number;
  blueprintTaskId: string;
  requirementIds: string[];
  milestoneIds: string[];
  taskKind: string;
  status: OutcomeStatus;
  usableForCoverage: boolean;
  strength: "verified" | "direct" | "supporting" | "declared" | "planned";
  label: string;
  detail: string;
  sourceUrl: string;
  expectedEvidence: string;
  confirmation: {
    required: boolean;
    kind: "text" | "url_or_text" | "signal";
    question: string;
    options: string[];
    answer: string;
    answeredAt: number | null;
  };
  updatedAt: number;
};

type CoverageDelta = {
  requirementId: string;
  label: string;
  beforeStatus: CoverageStatus;
  afterStatus: CoverageStatus;
  beforeConfidence: "high" | "medium" | "low";
  afterConfidence: "high" | "medium" | "low";
  changed: boolean;
  explanation: string;
};

type MilestoneProgress = {
  milestoneId: string;
  workstreamId: string;
  label: string;
  status: "not_started" | "in_progress" | "pending_confirmation" | "achieved";
  provenRequirementCount: number;
  totalRequirementCount: number;
  outcomeIds: string[];
  doneWhen: string;
  reason: string;
};

type OutcomeResponse = {
  executionOutcomeModel?: {
    records: ExecutionOutcomeRecord[];
    milestoneProgress: MilestoneProgress[];
    latestCoverageDelta: CoverageDelta[];
    pendingConfirmationIds: string[];
  } | null;
  pendingOutcome?: ExecutionOutcomeRecord | null;
  advancedTaskIds?: number[];
};

type ConfirmationResolution = "accept" | "supporting" | "no_evidence" | "reopen";

const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  proven: "Evidenced",
  partially_proven: "Partly evidenced",
  unproven: "Not yet evidenced",
  unknown: "Not yet assessed",
  below_bar: "Below target bar",
};

const MILESTONE_META = {
  achieved: { label: "Achieved", tone: "bg-emerald-50 text-emerald-700" },
  pending_confirmation: { label: "Needs one confirmation", tone: "bg-amber-50 text-amber-800" },
  in_progress: { label: "In progress", tone: "bg-sky-50 text-sky-700" },
  not_started: { label: "Not started", tone: "bg-muted text-muted-foreground" },
} as const;

function optionResolution(option: string): ConfirmationResolution {
  const normalized = option.toLocaleLowerCase();
  if (normalized.includes("no external") || normalized.includes("no market") || normalized.includes("no useful")) return "no_evidence";
  if (normalized.includes("reply") || normalized.includes("useful exchange")) return "supporting";
  return "accept";
}

function latestAccepted(records: ExecutionOutcomeRecord[]): ExecutionOutcomeRecord[] {
  return records
    .filter((record) => record.status === "accepted" && record.usableForCoverage)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 3);
}

export function TrackExecutionProgress({ trackId }: { trackId?: number }) {
  const [answer, setAnswer] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const endpoint = `/api/career-tracks/${trackId}/execution-outcomes`;
  const { data, isLoading, isError, refetch } = useQuery<OutcomeResponse>({
    queryKey: [endpoint],
    enabled: Boolean(trackId),
    staleTime: 15_000,
    refetchInterval: 20_000,
    retry: false,
  });
  const model = data?.executionOutcomeModel;
  const pending = data?.pendingOutcome || null;
  const accepted = useMemo(() => latestAccepted(model?.records || []), [model?.records]);
  const changedDeltas = useMemo(() => (model?.latestCoverageDelta || []).filter((delta) => delta.changed), [model?.latestCoverageDelta]);
  const milestones = useMemo(() => (model?.milestoneProgress || []).filter((milestone) => milestone.status !== "not_started"), [model?.milestoneProgress]);

  const confirm = useMutation({
    mutationFn: async (payload: { resolution: ConfirmationResolution; answer?: string; sourceUrl?: string }) => {
      if (!pending) throw new Error("No outcome is awaiting confirmation.");
      const response = await apiRequest(
        "POST",
        `${endpoint}/${pending.id}/confirm`,
        payload,
      );
      return await response.json() as OutcomeResponse;
    },
    onSuccess: async (result, payload) => {
      setAnswer("");
      setSourceUrl("");
      const deltaCount = result.executionOutcomeModel?.latestCoverageDelta.filter((delta) => delta.changed).length || 0;
      setStatusMessage(payload.resolution === "reopen" || payload.resolution === "no_evidence"
        ? "The task was reopened because the evidence objective is not complete yet."
        : deltaCount
          ? `${deltaCount} requirement${deltaCount === 1 ? " was" : "s were"} updated and the next execution slice was recalculated.`
          : "The outcome was saved as evidence. Coverage remains conservative until it meets the full success bar.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [endpoint] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/anchor/today"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/plan/current"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] }),
      ]);
    },
    onError: (error: any) => setStatusMessage(error?.message || "Could not save the execution outcome."),
  });

  if (!trackId) return null;
  if (isLoading) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Checking completed work for usable evidence</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground">Progress evidence could not be refreshed</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Completed tasks remain saved. Retry without rebuilding the target plan.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>
        </div>
      </section>
    );
  }
  if (!pending && !accepted.length && !changedDeltas.length && !milestones.length) return null;

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-execution-progress">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><TrendingUp className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">What your completed work changed</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Anchor separates finishing an activity from proving a requirement. It uses what is observable and asks one short question only when a real-world result cannot be inferred safely.</p>
        </div>
      </div>

      {pending && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid="pending-execution-outcome">
          <div className="flex items-start gap-2">
            <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-900">One detail is needed before this can count as evidence</p>
              <p className="mt-1 text-[11px] leading-snug text-amber-900">{pending.confirmation.question}</p>
              <p className="mt-1 text-[10px] leading-snug text-amber-800">Expected evidence: {pending.expectedEvidence}</p>
            </div>
          </div>

          {pending.confirmation.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {pending.confirmation.options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate({ resolution: optionResolution(option), answer: option })}
                  className="h-auto whitespace-normal py-1.5 text-left text-[10px]"
                >
                  {option}
                </Button>
              ))}
            </div>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="What concrete output, responsibility, result or signal occurred?"
              className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
              aria-label="Execution outcome confirmation"
            />
            <Input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Evidence link, when available"
              aria-label="Execution evidence URL"
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={confirm.isPending || (!answer.trim() && !sourceUrl.trim())}
              onClick={() => confirm.mutate({ resolution: "accept", answer, sourceUrl })}
              data-testid="button-confirm-execution-evidence"
            >
              {confirm.isPending ? <Sparkles className="mr-1 h-3.5 w-3.5 animate-pulse" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              Save as evidence
            </Button>
            <Button size="sm" variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate({ resolution: "no_evidence", answer: answer || "No usable evidence yet" })}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Evidence not complete yet
            </Button>
            <Button size="sm" variant="ghost" disabled={confirm.isPending} onClick={() => confirm.mutate({ resolution: "reopen", answer: "Marked complete by mistake" })}>
              Marked complete by mistake
            </Button>
          </div>
        </div>
      )}

      {changedDeltas.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Coverage changes</p>
          {changedDeltas.map((delta) => (
            <div key={delta.requirementId} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[11px] font-semibold text-foreground">{delta.label}</p>
                <span className="rounded-full bg-background px-2 py-0.5 text-[9px] text-muted-foreground">{COVERAGE_LABEL[delta.beforeStatus]}</span>
                <span className="text-[10px] text-muted-foreground">→</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-medium text-emerald-800">{COVERAGE_LABEL[delta.afterStatus]}</span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{delta.explanation}</p>
            </div>
          ))}
        </div>
      )}

      {milestones.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-card p-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground"><Flag className="h-3.5 w-3.5 text-primary" /> Milestone progress</summary>
          <div className="mt-2 space-y-1.5">
            {milestones.slice(0, 8).map((milestone) => {
              const meta = MILESTONE_META[milestone.status];
              return (
                <div key={milestone.milestoneId} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <p className="text-[11px] font-medium text-foreground">{milestone.label}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{milestone.reason}</p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">{milestone.provenRequirementCount}/{milestone.totalRequirementCount} linked requirements evidenced</p>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {accepted.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-card p-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> Recent accepted evidence</summary>
          <div className="mt-2 space-y-1.5">
            {accepted.map((record) => (
              <div key={record.id} className="rounded-lg bg-muted/25 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[11px] font-medium text-foreground">{record.label}</p>
                  <span className="rounded-full bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">{record.strength}</span>
                  {record.sourceUrl && <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[9px] text-primary">View evidence <ExternalLink className="h-2.5 w-2.5" /></a>}
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{record.detail}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {statusMessage && (
        <p className={`mt-2 flex items-start gap-1.5 text-[11px] leading-snug ${confirm.isError ? "text-destructive" : "text-primary"}`} role="status">
          {confirm.isError ? <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />} {statusMessage}
        </p>
      )}
    </section>
  );
}
