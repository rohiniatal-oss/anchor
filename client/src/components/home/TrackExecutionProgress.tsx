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
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
type ExecutionOutcomeRecord = {
  id: string;
  liveTaskId: number;
  taskTitle: string;
  expectedEvidence: string;
  status: "pending_confirmation" | "accepted" | "rejected" | "superseded" | "failed";
  summary: string;
  detail: string;
  sourceUrl: string;
  strength: "verified" | "direct" | "supporting" | "planned";
  confirmationRequired: boolean;
  confirmationQuestion: string;
  confirmationAnswer: string;
  updatedAt: number;
};

type CoverageDeltaItem = {
  requirementId: string;
  label: string;
  beforeStatus: CoverageStatus;
  afterStatus: CoverageStatus;
  changed: boolean;
  improved: boolean;
  evidenceAddedIds: string[];
};

type ExecutionFeedbackRun = {
  id: string;
  outcomeId: string;
  coverageChanges: CoverageDeltaItem[];
  changedRequirementCount: number;
  improvedRequirementCount: number;
  developmentPlanChanged: boolean;
  executionBlueprintChanged: boolean;
  executionPriorityChanged: boolean;
  materializedLiveTaskIds: number[];
  warnings: string[];
  generatedAt: number;
};

type MilestoneProgress = {
  milestoneId: string;
  label: string;
  status: "achieved" | "progressing" | "not_started" | "needs_confirmation";
  provenRequirementCount: number;
  partiallyProvenRequirementCount: number;
  totalRequirementCount: number;
};

type FeedbackModel = {
  mode: "execution_feedback_model";
  outcomes: ExecutionOutcomeRecord[];
  runs: ExecutionFeedbackRun[];
  milestones: MilestoneProgress[];
  pendingConfirmationCount: number;
};

type FeedbackResponse = {
  executionFeedbackModel?: FeedbackModel | null;
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  proven: "Evidenced",
  partially_proven: "Partly evidenced",
  unproven: "Not yet evidenced",
  unknown: "Not assessed",
  below_bar: "Below the target bar",
};

const MILESTONE_META: Record<MilestoneProgress["status"], { label: string; tone: string }> = {
  achieved: { label: "Achieved", tone: "bg-emerald-50 text-emerald-700" },
  progressing: { label: "Progressing", tone: "bg-sky-50 text-sky-700" },
  needs_confirmation: { label: "Needs confirmation", tone: "bg-amber-50 text-amber-800" },
  not_started: { label: "Not started", tone: "bg-muted text-muted-foreground" },
};

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

async function invalidateFeedbackChain(trackId: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-feedback`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
    queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/anchor/today"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/plan/current"] }),
  ]);
}

export function TrackExecutionProgress({ trackId }: { trackId?: number }) {
  const [answer, setAnswer] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const endpoint = `/api/career-tracks/${trackId}/execution-feedback`;
  const { data, isLoading, isError, refetch } = useQuery<FeedbackResponse>({
    queryKey: [endpoint],
    enabled: Boolean(trackId),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  });
  const model = data?.executionFeedbackModel;
  const pending = useMemo(
    () => [...(model?.outcomes || [])]
      .filter((outcome) => outcome.status === "pending_confirmation")
      .sort((left, right) => right.updatedAt - left.updatedAt),
    [model?.outcomes],
  );
  const currentPending = pending[0];
  const latestRun = useMemo(
    () => [...(model?.runs || [])].sort((left, right) => right.generatedAt - left.generatedAt)[0],
    [model?.runs],
  );
  const acceptedOutcomes = useMemo(
    () => [...(model?.outcomes || [])]
      .filter((outcome) => outcome.status === "accepted")
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 5),
    [model?.outcomes],
  );

  const confirm = useMutation({
    mutationFn: async (accepted: boolean) => {
      if (!trackId || !currentPending) throw new Error("No execution outcome is waiting for confirmation.");
      const response = await apiRequest(
        "POST",
        `/api/career-tracks/${trackId}/execution-outcomes/${currentPending.id}/confirm`,
        { accepted, answer: answer.trim(), sourceUrl: sourceUrl.trim() },
      );
      return response.json();
    },
    onSuccess: async (_result, accepted) => {
      setStatusMessage(accepted
        ? "Evidence accepted. Anchor refreshed the affected requirements and selected the next safe frontier."
        : "Completion retained, but it will not be used as evidence.");
      setAnswer("");
      setSourceUrl("");
      if (trackId) await invalidateFeedbackChain(trackId);
    },
    onError: (error: any) => setStatusMessage(error?.message || "Anchor could not update this evidence record."),
  });

  if (!trackId) return null;
  if (isLoading) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Checking what completed work changed</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is looking for new execution evidence and progress against the target requirements.</p>
      </section>
    );
  }
  if (isError || !model) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground">Progress feedback is not available yet</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Completing an execution task will create the first evidence record.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry</Button>
        </div>
      </section>
    );
  }
  if (!model.outcomes.length && !model.milestones.length) return null;

  const changed = latestRun?.coverageChanges.filter((change) => change.changed) || [];
  const achievedMilestones = model.milestones.filter((milestone) => milestone.status === "achieved").length;

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-execution-progress">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Target className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">What your completed work changed</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Task completion becomes progress only when Anchor can connect it to observable evidence and the requirement success bars.</p>
          </div>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{acceptedOutcomes.length} accepted outcome{acceptedOutcomes.length === 1 ? "" : "s"}</span>
      </div>

      {currentPending && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid="execution-outcome-confirmation">
          <div className="flex items-start gap-2