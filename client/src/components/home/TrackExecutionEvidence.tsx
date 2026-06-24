import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Target,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
type OutcomeStatus = "accepted" | "pending_confirmation" | "operational_only" | "insufficient" | "reopened";
type ConfirmationDecision = "direct" | "supporting" | "none" | "mistaken";

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
  inference: {
    confidence: "high" | "medium" | "low";
    reason: string;
  };
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

type ExecutionCoverageDelta = {
  requirementId: string;
  label: string;
  beforeStatus: CoverageStatus;
  afterStatus: CoverageStatus;
  beforeConfidence: "high" | "medium" | "low";
  afterConfidence: "high" | "medium" | "low";
  changed: boolean;
  explanation: string;
};

type ExecutionMilestoneProgress = {
  milestoneId: string;
  label: string;
  status: "not_started" | "in_progress" | "pending_confirmation" | "achieved";
  provenRequirementCount: number;
  totalRequirementCount: number;
  reason: string;
};

type ExecutionOutcomeModel = {
  mode: "execution_outcome_model";
  records: ExecutionOutcomeRecord[];
  milestoneProgress: ExecutionMilestoneProgress[];
  latestCoverageDelta: ExecutionCoverageDelta[];
  latestOutcomeId: string | null;
  pendingConfirmationIds: string[];
};

type ExecutionOutcomeResponse = {
  targetLabel: string;
  executionOutcomeModel: ExecutionOutcomeModel;
  replanning: boolean;
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  proven: "Proven",
  partially_proven: "Partly evidenced",
  unproven: "Not yet evidenced",
  unknown: "Unknown",
  below_bar: "Below target bar",
};

const MILESTONE_META = {
  achieved: { label: "Achieved", tone: "bg-emerald-50 text-emerald-700" },
  in_progress: { label: "In progress", tone: "bg-sky-50 text-sky-700" },
  pending_confirmation: { label: "Awaiting confirmation", tone: "bg-amber-50 text-amber-800" },
  not_started: { label: "Not started", tone: "bg-muted text-muted-foreground" },
} as const;

function decisionForSignal(option: string): ConfirmationDecision {
  const normalized = option.toLowerCase();
  if (normalized.startsWith("no ")) return "none";
  if (normalized.includes("reply") || normalized.includes("useful exchange")) return "supporting";
  return "direct";
}

function OutcomeConfirmationCard({
  record,
  onConfirm,
  pending,
}: {
  record: ExecutionOutcomeRecord;
  onConfirm: (decision: ConfirmationDecision, answer: string, sourceUrl: string) => void;
  pending: boolean;
}) {
  const [answer, setAnswer] = useState(record.confirmation.answer || "");
  const [sourceUrl, setSourceUrl] = useState(record.sourceUrl || "");
  const canAccept = Boolean(answer.trim() || sourceUrl.trim());

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid={`execution-outcome-confirmation-${record.id}`}>
      <div className="flex items-start gap-2">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-950">One detail is needed before this can update your evidence</p>
          <p className="mt-1 text-[11px] leading-snug text-amber-950">{record.confirmation.question}</p>
          <p className="mt-1 text-[10px] text-amber-800">Completed task: {record.label}</p>
        </div>
      </div>

      {record.confirmation.options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {record.confirmation.options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onConfirm(decisionForSignal(option), option, "")}
              className="h-auto min-h-8 whitespace-normal text-left text-[10px]"
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Add the concrete output, result, responsibility, or signal"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            disabled={pending}
            data-testid={`input-outcome-answer-${record.id}`}
          />
          {record.confirmation.kind === "url_or_text" && (
            <Input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Evidence link, where available"
              disabled={pending}
              data-testid={`input-outcome-url-${record.id}`}
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" disabled={pending || !canAccept} onClick={() => onConfirm("direct", answer, sourceUrl)}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Use as evidence
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending || !canAccept} onClick={() => onConfirm("supporting", answer, sourceUrl)}>
              Save as supporting
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onConfirm("none", answer || "No useful evidence yet", sourceUrl)}>
              No useful evidence yet
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onConfirm("mistaken", "Marked complete by mistake", "")}>
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Reopen task
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TrackExecutionEvidence({ trackId }: { trackId?: number }) {
  const endpoint = `/api/career-tracks/${trackId}/execution-outcomes`;
  const [statusMessage, setStatusMessage] = useState("");
  const { data, isLoading, isError, refetch } = useQuery<ExecutionOutcomeResponse>({
    queryKey: [endpoint],
    enabled: Boolean(trackId),
    staleTime: 5_000,
    refetchInterval: (query) => {
      const value = query.state.data as ExecutionOutcomeResponse | undefined;
      return value?.replanning || value?.executionOutcomeModel?.pendingConfirmationIds?.length ? 5_000 : 15_000;
    },
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: async (input: { outcomeId: string; decision: ConfirmationDecision; answer: string; sourceUrl: string }) => {
      const response = await apiRequest(
        "POST",
        `${endpoint}/${encodeURIComponent(input.outcomeId)}/confirm`,
        { decision: input.decision, answer: input.answer, sourceUrl: input.sourceUrl },
      );
      return await response.json() as ExecutionOutcomeResponse;
    },
    onSuccess: async (result) => {
      const changed = result.executionOutcomeModel.latestCoverageDelta.filter((delta) => delta.changed).length;
      setStatusMessage(changed
        ? `Anchor updated ${changed} requirement${changed === 1 ? "" : "s"} and rebuilt the affected plan layers.`
        : "The outcome was saved. It supports the evidence record but does not yet change a requirement status.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [endpoint] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
      ]);
    },
    onError: (error: any) => setStatusMessage(error?.message || "Could not save the evidence decision."),
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `${endpoint}/refresh`, {});
      return await response.json() as ExecutionOutcomeResponse;
    },
    onSuccess: async () => {
      setStatusMessage("Anchor reconciled completed work and refreshed the affected evidence loop.");
      await queryClient.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (error: any) => setStatusMessage(error?.message || "Could not refresh execution evidence."),
  });

  const model = data?.executionOutcomeModel;
  const pendingRecords = useMemo(() => {
    if (!model) return [];
    const pending = new Set(model.pendingConfirmationIds);
    return model.records.filter((record) => pending.has(record.id));
  }, [model]);
  const acceptedRecords = useMemo(() => (model?.records || []).filter((record) => record.status === "accepted" && record.usableForCoverage), [model]);
  const changedDeltas = useMemo(() => (model?.latestCoverageDelta || []).filter((delta) => delta.changed), [model]);
  const milestones = useMemo(() => (model?.milestoneProgress || []).filter((milestone) => milestone.status !== "not_started"), [model]);

  if (!trackId) return null;
  if (isLoading) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Checking completed work for evidence</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is separating task completion from proof of the target requirements.</p>
      </section>
    );
  }
  if (isError || !model) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground">Execution evidence is not available yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Your tasks remain unchanged. Retry the evidence reconciliation when the target workspace is current.</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>
        </div>
      </section>
    );
  }
  if (!model.records.length && !data?.replanning) return null;

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-execution-evidence">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Activity className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">What your completed work changed</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Anchor captures the outcome, updates only the evidence it can defend, and recalculates the next active slice.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {data?.replanning && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary"><Sparkles className="h-3 w-3 animate-pulse" /> Replanning</span>}
          <Button type="button" size="sm" variant="ghost" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {pendingRecords.length > 0 && (
        <div className="mt-3 space-y-2">
          {pendingRecords.map((record) => (
            <OutcomeConfirmationCard
              key={record.id}
              record={record}
              pending={confirm.isPending}
              onConfirm={(decision, answer, sourceUrl) => confirm.mutate({ outcomeId: record.id, decision, answer, sourceUrl })}
            />
          ))}
        </div>
      )}

      {changedDeltas.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900"><Target className="h-3.5 w-3.5" /> Requirement coverage updated</p>
          <div className="mt-2 space-y-1.5">
            {changedDeltas.map((delta) => (
              <div key={delta.requirementId} className="rounded-lg bg-background/75 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[11px] font-medium text-foreground">{delta.label}</p>
                  <span className="text-[9px] text-muted-foreground">{STATUS_LABEL[delta.beforeStatus]}</span>
                  <span className="text-[9px] text-muted-foreground">→</span>
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] text-emerald-700">{STATUS_LABEL[delta.afterStatus]}</span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{delta.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Accepted outcomes</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{acceptedRecords.length}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Awaiting one detail</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{pendingRecords.length}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Milestones moving</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{milestones.length}</p>
        </div>
      </div>

      {milestones.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-card p-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">Milestone evidence progress</summary>
          <div className="mt-2 space-y-1.5">
            {milestones.map((milestone) => {
              const meta = MILESTONE_META[milestone.status];
              return (
                <div key={milestone.milestoneId} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[11px] font-medium text-foreground">{milestone.label}</p>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${meta.tone}`}>{meta.label}</span>
                    <span className="text-[9px] text-muted-foreground">{milestone.provenRequirementCount}/{milestone.totalRequirementCount} requirements proven</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{milestone.reason}</p>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {acceptedRecords.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-card p-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">Accepted execution evidence</summary>
          <div className="mt-2 space-y-1.5">
            {acceptedRecords.slice(0, 12).map((record) => (
              <div key={record.id} className="rounded-lg bg-muted/25 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[11px] font-medium text-foreground">{record.label}</p>
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] text-emerald-700">{record.strength}</span>
                  {record.sourceUrl && <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[9px] text-primary">Open evidence <ExternalLink className="h-2.5 w-2.5" /></a>}
                </div>
                <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{record.inference.reason}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {statusMessage && <p className={`mt-2 text-[11px] leading-snug ${confirm.isError || refresh.isError ? "text-destructive" : "text-primary"}`} role="status">{statusMessage}</p>}
    </section>
  );
}
