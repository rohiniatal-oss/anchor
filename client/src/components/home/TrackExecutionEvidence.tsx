import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type OutcomeOptionId = "evidence_created" | "partial_signal" | "no_evidence" | "not_completed";

type ExecutionOutcomeOption = {
  id: OutcomeOptionId;
  label: string;
  description: string;
  strength: "verified" | "direct" | "supporting" | "none";
  usableForCoverage: boolean;
  reopensTask: boolean;
};

type CoverageChange = {
  requirementId: string;
  beforeStatus: string;
  afterStatus: string;
  improved: boolean;
};

type ExecutionOutcome = {
  id: string;
  liveTaskId: number;
  blueprintTaskId: string;
  taskTitle: string;
  taskKind: string;
  expectedEvidence: string;
  evidenceSummary: string;
  evidenceUrl: string;
  state: "pending_confirmation" | "accepted" | "no_evidence" | "reopened";
  confirmationQuestion: string;
  confirmationOptions: ExecutionOutcomeOption[];
  selectedOptionId: OutcomeOptionId | "";
  confirmationNote: string;
  processingState: "not_ready" | "queued" | "processing" | "complete" | "failed";
  processingError: string;
  coverageImpact: {
    changes: CoverageChange[];
    improvedRequirementIds: string[];
    newlyProvenRequirementIds: string[];
    nextMaterializedTaskIds: number[];
  } | null;
  updatedAt: number;
};

type ExecutionOutcomeResponse = {
  pendingOutcomes: ExecutionOutcome[];
  recentOutcomes: ExecutionOutcome[];
  processing: boolean;
  message?: string;
  confirmedOutcome?: ExecutionOutcome;
};

function statusLabel(value: string) {
  return value.replace(/_/g, " ");
}

export function TrackExecutionEvidence({ trackId }: { trackId?: number }) {
  const endpoint = `/api/career-tracks/${trackId}/execution-outcomes`;
  const [selectedOption, setSelectedOption] = useState<OutcomeOptionId | "">("");
  const [note, setNote] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [message, setMessage] = useState("");
  const { data, isLoading, isError } = useQuery<ExecutionOutcomeResponse>({
    queryKey: [endpoint],
    enabled: Boolean(trackId),
    staleTime: 5_000,
    refetchInterval: 8_000,
    retry: false,
  });

  const pending = data?.pendingOutcomes?.[0];
  const latest = useMemo(
    () => [...(data?.recentOutcomes || [])].sort((left, right) => right.updatedAt - left.updatedAt)[0],
    [data?.recentOutcomes],
  );
  useEffect(() => {
    setSelectedOption("");
    setNote("");
    setEvidenceUrl("");
  }, [pending?.id]);

  const confirm = useMutation({
    mutationFn: async (optionId: OutcomeOptionId) => {
      const response = await apiRequest(
        "POST",
        `${endpoint}/${pending?.id}/confirm`,
        { optionId, note, evidenceUrl },
      );
      return await response.json() as ExecutionOutcomeResponse;
    },
    onSuccess: async (result) => {
      setMessage(result.message || "Outcome saved.");
      setSelectedOption("");
      setNote("");
      setEvidenceUrl("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [endpoint] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/anchor/today"] }),
      ]);
    },
    onError: (error: any) => setMessage(error?.message || "Could not save this outcome."),
  });

  if (!trackId || isLoading || isError) return null;
  if (!pending && !latest && !data?.processing) return null;

  const selected = pending?.confirmationOptions.find((option) => option.id === selectedOption);
  const improved = latest?.coverageImpact?.changes.filter((change) => change.improved) || [];
  const unchanged = latest?.coverageImpact?.changes.filter((change) => !change.improved) || [];

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-execution-evidence">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><FileCheck2 className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">What changed because the work was completed</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Anchor only strengthens requirement coverage when the completed work produced a defensible output or real-world signal.</p>
        </div>
        {data?.processing && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary"><Loader2 className="h-3 w-3 animate-spin" /> Updating plan</span>}
      </div>

      {pending && (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">One focused confirmation</p>
          <p className="mt-1 text-xs font-semibold leading-snug text-foreground">{pending.taskTitle}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{pending.confirmationQuestion}</p>
          {pending.expectedEvidence && <p className="mt-2 rounded-lg bg-background/70 p-2 text-[10px] leading-snug text-foreground"><span className="font-medium">Expected evidence</span> {pending.expectedEvidence}</p>}

          <div className="mt-3 grid gap-1.5">
            {pending.confirmationOptions.filter((option) => option.id !== "not_completed").map((option) => (
              <button
                type="button"
                key={option.id}
                onClick={() => {
                  setMessage("");
                  if (option.id === "no_evidence") confirm.mutate(option.id);
                  else setSelectedOption(option.id);
                }}
                disabled={confirm.isPending}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${selectedOption === option.id ? "border-primary bg-primary/5" : "border-card-border bg-card hover:border-primary/30"}`}
                data-testid={`button-outcome-${option.id}`}
              >
                <p className="text-[11px] font-medium leading-snug text-foreground">{option.label}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{option.description}</p>
              </button>
            ))}
          </div>

          {selected && selected.id !== "no_evidence" && (
            <div className="mt-3 rounded-lg border border-card-border bg-card p-2.5">
              <p className="text-[10px] font-medium text-foreground">Add one concrete sentence or an evidence link</p>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What output or signal was actually created?"
                className="mt-2 h-9 text-xs"
                data-testid="input-outcome-note"
              />
              <Input
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
                placeholder="Optional evidence link"
                className="mt-2 h-9 text-xs"
                data-testid="input-outcome-url"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={() => confirm.mutate(selected.id)} disabled={confirm.isPending} data-testid="button-save-outcome">
                  {confirm.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  Save outcome
                </Button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => confirm.mutate("not_completed")}
            disabled={confirm.isPending}
            className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            data-testid="button-outcome-not-completed"
          >
            <RotateCcw className="h-3 w-3" /> Marked complete by mistake
          </button>
        </div>
      )}

      {!pending && latest && (
        <div className="mt-3 rounded-xl border border-card-border bg-card p-3">
          <div className="flex items-start gap-2">
            {latest.state === "accepted" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" /> : <CircleAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{latest.state === "accepted" ? "Outcome captured as evidence" : latest.state === "reopened" ? "Task reopened" : "Completion recorded without new evidence"}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{latest.confirmationNote || latest.evidenceSummary}</p>
              {latest.evidenceUrl && <a href={latest.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary">Open evidence <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </div>

          {latest.processingState === "failed" && (
            <p className="mt-2 rounded-lg bg-destructive/5 p-2 text-[10px] text-destructive">The outcome is saved, but the coverage refresh failed. It will be retried without losing the evidence.</p>
          )}
          {latest.coverageImpact && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-emerald-50/60 p-2">
                <p className="text-[10px] font-medium text-emerald-800">Coverage strengthened</p>
                <p className="mt-0.5 text-[10px] leading-snug text-emerald-800">{improved.length ? improved.map((change) => `${statusLabel(change.beforeStatus)} → ${statusLabel(change.afterStatus)}`).join("; ") : "No linked requirement crossed a coverage threshold yet."}</p>
              </div>
              <div className="rounded-lg bg-muted/25 p-2">
                <p className="text-[10px] font-medium text-foreground">Next frontier</p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{latest.coverageImpact.nextMaterializedTaskIds.length ? `${latest.coverageImpact.nextMaterializedTaskIds.length} next task was activated automatically.` : unchanged.length ? "The plan was refreshed; remaining requirements still need stronger evidence." : "The active slice is current."}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {message && <p className="mt-2 text-[11px] leading-snug text-primary" role="status">{message}</p>}
      {(data?.pendingOutcomes?.length || 0) > 1 && <p className="mt-2 text-[10px] text-muted-foreground">{(data?.pendingOutcomes?.length || 0) - 1} additional completed outcome remains queued. Anchor will show one at a time.</p>}
    </section>
  );
}
