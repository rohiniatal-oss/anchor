import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  FileCheck2,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
type OutcomeStatus = "accepted" | "pending_confirmation" | "operational_only" | "insufficient" | "reopened";

type ExecutionOutcomeRecord = {
  id: string;
  blueprintTaskId: string;
  liveTaskId: number;
  requirementIds: string[];
  taskKind: string;
  status: OutcomeStatus;
  usableForCoverage: boolean;
  strength: "verified" | "direct" | "declared" | "supporting" | "planned";
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
  changed: boolean;
  explanation: string;
};

type MilestoneProgress = {
  milestoneId: string;
  label: string;
  status: "not_started" | "in_progress" | "pending_confirmation" | "achieved";
  provenRequirementCount: number;
  totalRequirementCount: number;
  doneWhen: string;
  reason: string;
};

type ExecutionProgressResponse = {
  executionOutcomeModel?: {
    records: ExecutionOutcomeRecord[];
    latestCoverageDelta: CoverageDelta[];
    milestoneProgress: MilestoneProgress[];
    pendingConfirmationIds: string[];
  };
  pendingConfirmations?: ExecutionOutcomeRecord[];
  acceptedOutcomes?: ExecutionOutcomeRecord[];
  latestCoverageDelta?: CoverageDelta[];
  milestoneProgress?: MilestoneProgress[];
  replan?: {
    status: "not_required" | "refreshed" | "failed";
    coverageChangedRequirementIds: string[];
    nextSelectedTaskIds: string[];
    message: string;
  };
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  proven: "Proven",
  partially_proven: "Partly evidenced",
  unproven: "Not yet evidenced",
  unknown: "Unknown",
  below_bar: "Below the target bar",
};

const MILESTONE_META = {
  achieved: { label: "Achieved", tone: "bg-emerald-50 text-emerald-700" },
  in_progress: { label: "In progress", tone: "bg-sky-50 text-sky-700" },
  pending_confirmation: { label: "Needs one confirmation", tone: "bg-amber-50 text-amber-800" },
  not_started: { label: "Not started", tone: "bg-muted text-muted-foreground" },
} as const;

function positiveSignal(option: string): boolean {
  return !/no external interaction|no market signal|no useful|nothing useful|not completed/i.test(option);
}

function safeHref(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function ConfirmationCard({
  trackId,
  outcome,
  onStatus,
}: {
  trackId: number;
  outcome: ExecutionOutcomeRecord;
  onStatus: (message: string, error?: boolean) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const endpoint = `/api/career-tracks/${trackId}/execution-outcomes/${outcome.id}/confirm`;
  const confirm = useMutation({
    mutationFn: async (input: { resolution: "confirmed" | "supporting" | "no_evidence" | "mistaken"; answer?: string; sourceUrl?: string }) => {
      const response = await apiRequest("POST", endpoint, input);
      return await response.json() as ExecutionProgressResponse;
    },
    onSuccess: async (result) => {
      onStatus(result.replan?.message || "The outcome was recorded and the target plan was refreshed.");
      setAnswer("");
      setSourceUrl("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-outcomes`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
      ]);
    },
    onError: (error: any) => onStatus(error?.message || "Could not record the outcome.", true),
  });

  const submit = (resolution: "confirmed" | "supporting" | "no_evidence" | "mistaken", option = "") => {
    confirm.mutate({
      resolution,
      answer: option || answer,
      sourceUrl,
    });
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid={`execution-outcome-confirmation-${outcome.id}`}>
      <div className="flex items-start gap-2">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-950">One factual confirmation</p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-950">{outcome.confirmation.question}</p>
          <p className="mt-1 text-[10px] leading-snug text-amber-800">Task completed: {outcome.label}</p>
        </div>
      </div>

      {outcome.confirmation.options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {outcome.confirmation.options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={positiveSignal(option) ? "outline" : "ghost"}
              disabled={confirm.isPending}
              onClick={() => submit(positiveSignal(option) ? "confirmed" : "no_evidence", option)}
              className="h-auto min-h-8 whitespace-normal text-left text-[10px]"
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Add the concrete result in one or two sentences"
            className="min-h-[72px] text-xs"
            disabled={confirm.isPending}
            data-testid="input-execution-outcome-answer"
          />
          {outcome.confirmation.kind === "url_or_text" && (
            <Input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Optional evidence link"
              className="h-9 text-xs"
              disabled={confirm.isPending}
              data-testid="input-execution-outcome-url"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={confirm.isPending || (!answer.trim() && !sourceUrl.trim())}
              onClick={() => submit("confirmed")}
              data-testid="button-confirm-execution-outcome"
            >
              {confirm.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="mr-1 h-3.5 w-3.5" />}
              Use this evidence
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={confirm.isPending || !answer.trim()} onClick={() => submit("supporting")}>Supporting only</Button>
          </div>
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-amber-900">The task did not create usable evidence</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="ghost" disabled={confirm.isPending} onClick={() => submit("no_evidence", "No useful evidence resulted yet")}>Record no useful evidence</Button>
          <Button type="button" size="sm" variant="ghost" disabled={confirm.isPending} onClick={() => submit("mistaken", "Marked complete by mistake")}>Reopen the task</Button>
        </div>
      </details>
    </div>
  );
}

export function TrackExecutionProgress({ trackId }: { trackId?: number }) {
  const [statusMessage, setStatusMessage] = useState<{ text: string; error: boolean }>({ text: "", error: false });
  const endpoint = `/api/career-tracks/${trackId}/execution-outcomes`;
  const { data, isLoading, isError, refetch, isFetching } = useQuery<ExecutionProgressResponse>({
    queryKey: [endpoint],
    enabled: Boolean(trackId),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const pending = data?.pendingConfirmations || data?.executionOutcomeModel?.records.filter((record) => record.status === "pending_confirmation") || [];
  const accepted = data?.acceptedOutcomes || data?.executionOutcomeModel?.records.filter((record) => record.status === "accepted") || [];
  const deltas = data?.latestCoverageDelta || data?.executionOutcomeModel?.latestCoverageDelta || [];
  const milestones = data?.milestoneProgress || data?.executionOutcomeModel?.milestoneProgress || [];
  const changedDeltas = useMemo(() => deltas.filter((delta) => delta.changed), [deltas]);
  const activeMilestones = useMemo(() => milestones.filter((milestone) => milestone.status !== "not_started"), [milestones]);

  if (!trackId) return null;
  if (isLoading) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Checking completed work for new evidence</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is separating task completion from requirement proof and will ask only when one factual result is missing.</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground">Progress evidence could not be checked</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Your tasks and plan are unchanged. Retry the evidence scan when convenient.</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>
        </div>
      </section>
    );
  }

  if (!pending.length && !accepted.length && !activeMilestones.length && !changedDeltas.length) return null;

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-execution-progress">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><TrendingUp className="h-4 w-4" /></div>
          <div>
            <p className="text-sm font-semibold text-foreground">What your completed work changed</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Anchor records the actual result, updates requirement coverage, and refreshes the plan only when the evidence supports it.</p>
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Check progress
        </Button>
      </div>

      {statusMessage.text && (
        <div className={`mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[11px] leading-snug ${statusMessage.error ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`} role="status">
          {statusMessage.error ? <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Needs confirmation · {pending.length}</p>
          <ConfirmationCard
            trackId={trackId}
            outcome={pending[0]}
            onStatus={(text, error = false) => setStatusMessage({ text, error })}
          />
          {pending.length > 1 && <p className="text-[10px] text-muted-foreground">{pending.length - 1} more completed outcome{pending.length - 1 === 1 ? "" : "s"} will appear one at a time.</p>}
        </div>
      )}

      {changedDeltas.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Coverage changes</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {changedDeltas.map((delta) => (
              <div key={delta.requirementId} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5">
                <p className="text-[11px] font-semibold text-emerald-950">{delta.label}</p>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-800">
                  <span>{STATUS_LABEL[delta.beforeStatus]}</span><span>→</span><span className="font-medium">{STATUS_LABEL[delta.afterStatus]}</span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-emerald-900">{delta.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeMilestones.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-card p-3" open={activeMilestones.some((milestone) => milestone.status === "achieved")}>
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">Milestone progress</summary>
          <div className="mt-2 space-y-1.5">
            {activeMilestones.map((milestone) => {
              const meta = MILESTONE_META[milestone.status];
              return (
                <div key={milestone.milestoneId} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <p className="text-[11px] font-medium text-foreground">{milestone.label}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{milestone.provenRequirementCount} of {milestone.totalRequirementCount} linked requirements proven · {milestone.reason}</p>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {accepted.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-card p-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">Accepted execution evidence · {accepted.length}</summary>
          <div className="mt-2 space-y-1.5">
            {accepted.slice(0, 8).map((outcome) => {
              const href = safeHref(outcome.sourceUrl);
              return (
                <div key={outcome.id} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <p className="text-[11px] font-medium text-foreground">{outcome.label}</p>
                    <span className="rounded-full bg-background px-2 py-0.5 text-[9px] text-muted-foreground">{outcome.strength}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">Supports {outcome.requirementIds.length} requirement{outcome.requirementIds.length === 1 ? "" : "s"}</p>
                  {href && <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">Open evidence <ExternalLink className="h-3 w-3" /></a>}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {data?.replan?.status === "failed" && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 text-[10px] leading-snug text-amber-900">
          The outcome was saved, but downstream replanning needs another attempt. Checking progress again is safe and idempotent.
        </div>
      )}
    </section>
  );
}
