import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  FileCheck2,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
type ExecutionOutcome = {
  id: string;
  title: string;
  summary: string;
  status: "needs_confirmation" | "accepted" | "rejected" | "superseded";
  requirementIds: string[];
  milestoneIds: string[];
  evidenceStrength: "supporting" | "direct" | "verified";
  evidenceUrl: string;
  evidenceDetail: string;
  focusedQuestion: string;
  updatedAt: number;
};

type ProgressResponse = {
  trackId: number;
  targetLabel: string;
  outcomeModel: {
    summary: {
      totalOutcomes: number;
      acceptedOutcomes: number;
      pendingConfirmations: number;
    };
  };
  milestoneProgressModel?: {
    summary: {
      total: number;
      achieved: number;
      inProgress: number;
      needsEvidence: number;
      notStarted: number;
    };
  } | null;
  latestCoverageDelta?: {
    affectedRequirementIds: string[];
    improvedRequirementIds: string[];
    weakenedRequirementIds: string[];
    unchangedRequirementIds: string[];
    deltas: Array<{
      requirementId: string;
      before: CoverageStatus;
      after: CoverageStatus;
      direction: "improved" | "unchanged" | "weakened";
    }>;
  } | null;
  pendingOutcome?: ExecutionOutcome | null;
  recentAcceptedOutcomes: ExecutionOutcome[];
  requirementLabels: Record<string, string>;
  refreshedModels: boolean;
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  proven: "Evidenced",
  partially_proven: "Partly evidenced",
  below_bar: "Below target bar",
  unproven: "Not evidenced yet",
  unknown: "Not assessed yet",
};

const STRENGTH_META = {
  supporting: { label: "Supporting evidence", tone: "bg-sky-50 text-sky-700" },
  direct: { label: "Direct evidence", tone: "bg-violet-50 text-violet-700" },
  verified: { label: "Verified evidence", tone: "bg-emerald-50 text-emerald-700" },
} as const;

function labelFor(id: string, labels: Record<string, string>) {
  return labels[id] || id.replace(/^requirement-/, "").replace(/[-_]+/g, " ");
}

export function TrackAdaptiveProgress({ trackId }: { trackId?: number }) {
  const endpoint = `/api/career-tracks/${trackId}/execution-progress`;
  const [answer, setAnswer] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [message, setMessage] = useState("");
  const { data, isLoading, isError, refetch } = useQuery<ProgressResponse>({
    queryKey: [endpoint],
    enabled: Boolean(trackId),
    staleTime: 20_000,
    refetchInterval: trackId ? 30_000 : false,
    retry: false,
  });

  const pending = data?.pendingOutcome || null;
  const confirm = useMutation({
    mutationFn: async (accepted: boolean) => {
      if (!pending) throw new Error("No pending outcome is available.");
      const response = await apiRequest(
        "POST",
        `/api/career-tracks/${trackId}/execution-outcomes/${pending.id}/confirm`,
        { answer, evidenceUrl, accepted },
      );
      return await response.json() as ProgressResponse;
    },
    onSuccess: async (result, accepted) => {
      setAnswer("");
      setEvidenceUrl("");
      const improved = result.latestCoverageDelta?.improvedRequirementIds.length || 0;
      setMessage(accepted
        ? improved
          ? `Evidence accepted. ${improved} requirement${improved === 1 ? " moved" : "s moved"} forward.`
          : "Evidence accepted. Coverage was reassessed against the target success bars."
        : "This completion was retained as activity, but not used as requirement evidence.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [endpoint] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] }),
      ]);
    },
    onError: (error: any) => setMessage(error?.message || "Could not update the evidence record."),
  });

  const recent = useMemo(() => data?.recentAcceptedOutcomes || [], [data?.recentAcceptedOutcomes]);
  const delta = data?.latestCoverageDelta;
  const milestones = data?.milestoneProgressModel?.summary;
  const hasContent = Boolean(pending || recent.length || delta || milestones?.inProgress || milestones?.achieved);

  if (!trackId) return null;
  if (isLoading) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-primary" />
          <div>
            <p className="text-xs font-semibold text-foreground">Checking completed work for evidence</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is looking for outcomes that can update your requirement coverage without asking you to complete a form.</p>
          </div>
        </div>
      </section>
    );
  }
  if (isError || !data || !hasContent) return null;

  return (
    <section className="mt-4 rounded-2xl border border-emerald-200/70 bg-emerald-50/30 p-3 sm:p-4" data-testid="track-adaptive-progress">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-emerald-100 p-2 text-emerald-800"><Target className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">What your completed work changed</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Task completion creates a candidate signal. Anchor then checks the actual evidence against the linked requirement success bars before updating the plan.</p>
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {pending && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-background p-3" data-testid="pending-execution-outcome">
          <div className="flex items-start gap-2">
            <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">One detail is needed before this can count as evidence</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{pending.focusedQuestion}</p>
              <div className="mt-2 grid gap-2">
                <Input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Add the factual outcome, feedback or result"
                  aria-label="Outcome evidence"
                  data-testid="input-execution-outcome-answer"
                />
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={evidenceUrl}
                    onChange={(event) => setEvidenceUrl(event.target.value)}
                    placeholder="Evidence link where available"
                    aria-label="Evidence link"
                    className="pl-9"
                    data-testid="input-execution-outcome-url"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirm.mutate(true)}
                  disabled={confirm.isPending || (!answer.trim() && !evidenceUrl.trim())}
                  data-testid="button-confirm-execution-outcome"
                >
                  {confirm.isPending ? <Sparkles className="mr-1 h-3.5 w-3.5 animate-pulse" /> : <FileCheck2 className="mr-1 h-3.5 w-3.5" />}
                  Use as evidence
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => confirm.mutate(false)} disabled={confirm.isPending}>Do not use as evidence</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {delta && delta.affectedRequirementIds.length > 0 && (
        <div className="mt-3 rounded-xl border border-card-border bg-background/80 p-3">
          <div className="flex items-center gap-1.5">
            <ArrowUpRight className="h-4 w-4 text-emerald-700" />
            <p className="text-xs font-semibold text-foreground">Latest coverage update</p>
          </div>
          <div className="mt-2 space-y-1.5">
            {delta.deltas.slice(0, 6).map((item) => (
              <div key={item.requirementId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/25 px-2 py-1.5">
                <p className="text-[11px] font-medium text-foreground">{labelFor(item.requirementId, data.requirementLabels)}</p>
                <p className={`text-[10px] ${item.direction === "improved" ? "text-emerald-700" : item.direction === "weakened" ? "text-amber-800" : "text-muted-foreground"}`}>{STATUS_LABEL[item.before]} → {STATUS_LABEL[item.after]}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {milestones && milestones.total > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-card-border bg-background p-2.5"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Milestones achieved</p><p className="mt-1 text-lg font-semibold text-foreground">{milestones.achieved}</p></div>
          <div className="rounded-lg border border-card-border bg-background p-2.5"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">In progress</p><p className="mt-1 text-lg font-semibold text-foreground">{milestones.inProgress}</p></div>
          <div className="rounded-lg border border-card-border bg-background p-2.5"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Needs evidence</p><p className="mt-1 text-lg font-semibold text-foreground">{milestones.needsEvidence}</p></div>
          <div className="rounded-lg border border-card-border bg-background p-2.5"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Not started</p><p className="mt-1 text-lg font-semibold text-foreground">{milestones.notStarted}</p></div>
        </div>
      )}

      {recent.length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-background/70 p-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> Evidence captured from completed work</summary>
          <div className="mt-2 space-y-1.5">
            {recent.map((outcome) => {
              const meta = STRENGTH_META[outcome.evidenceStrength];
              return (
                <div key={outcome.id} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center gap-1.5"><p className="text-[11px] font-medium text-foreground">{outcome.title}</p><span className={`rounded-full px-1.5 py-0.5 text-[9px] ${meta.tone}`}>{meta.label}</span></div>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{outcome.summary}</p>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {message && <p className="mt-2 text-[11px] leading-snug text-primary" role="status">{message}</p>}
    </section>
  );
}
