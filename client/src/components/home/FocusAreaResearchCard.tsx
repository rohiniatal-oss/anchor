import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Compass, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateAndInvalidate } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { TrackResearchReview } from "@/components/home/TrackResearchReview";
import { TrackDevelopmentPlan } from "@/components/home/TrackDevelopmentPlan";
import { TrackExecutionPriority } from "@/components/home/TrackExecutionPriority";
import { TrackExecutionBlueprint } from "@/components/home/TrackExecutionBlueprint";

type FocusAreaResearchCardProps = {
  onResearched?: (trackId?: number) => void;
};

type CareerTrackSummary = {
  id: number;
  name: string;
  description: string;
  priority: number;
  status: string;
  trackIntelligence: string;
  createdAt: number;
};

type SelectedTrackSummary = {
  id: number;
  name: string;
  summary: string;
  evidenceCount?: number;
};

type ActivationNotice = {
  state: "idle" | "pending" | "success" | "error";
  message: string;
};

const EXAMPLES = ["AI strategy", "geopolitical risk advisory", "government delivery roles"];
const ACTIVE_TARGET_STORAGE_KEY = "anchor.activeTargetTrackId";

function parseIntelligence(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hasTargetResearch(track: CareerTrackSummary): boolean {
  const intelligence = parseIntelligence(track.trackIntelligence);
  return intelligence.requirementModel?.mode === "requirement_model"
    || intelligence.coverageModel?.mode === "coverage_model"
    || intelligence.developmentPlanModel?.mode === "development_plan_model"
    || intelligence.executionBlueprintModel?.mode === "execution_blueprint_model";
}

function readStoredTargetId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const value = Number(window.localStorage.getItem(ACTIVE_TARGET_STORAGE_KEY));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function activationMessage(result: any): string {
  const materialization = result?.materializationResult;
  const created = Array.isArray(materialization?.created) ? materialization.created.length : 0;
  const reused = Array.isArray(materialization?.reused) ? materialization.reused.length : 0;
  const skipped = Array.isArray(materialization?.skipped) ? materialization.skipped : [];
  if (created) return `Anchor activated ${created} task${created === 1 ? "" : "s"} in This Week. Today will choose from them using your available time and energy.`;
  if (reused) return "The recommended work was already active, so Anchor created no duplicates.";
  if (skipped.length) return skipped[0]?.reason || "Anchor kept the plan but did not activate work because a safety condition changed.";
  return "The active slice is current and no additional live task was needed.";
}

async function invalidateTrackResearchModels(trackId?: number) {
  if (!trackId) return;
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/research-plan`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
  ]);
}

async function activateTrackExecution(trackId: number) {
  return mutateAndInvalidate(
    "POST",
    `/api/career-tracks/${trackId}/execution-priority/materialize`,
    {},
    [
      `/api/career-tracks/${trackId}/execution-priority`,
      "/api/tasks",
      "/api/anchor/today",
      "/api/plan/current",
      "/api/career-tracks",
    ],
  );
}

export function FocusAreaResearchCard({ onResearched }: FocusAreaResearchCardProps) {
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState<number | undefined>(readStoredTargetId);
  const [recentTrack, setRecentTrack] = useState<SelectedTrackSummary | null>(null);
  const [activationNotice, setActivationNotice] = useState<ActivationNotice>({ state: "idle", message: "" });
  const { data: tracks = [] } = useQuery<CareerTrackSummary[]>({
    queryKey: ["/api/career-tracks"],
    staleTime: 60_000,
    retry: false,
  });

  const researchedTracks = useMemo(() => tracks
    .filter(hasTargetResearch)
    .sort((left, right) => {
      const leftActive = left.status === "active" ? 1 : 0;
      const rightActive = right.status === "active" ? 1 : 0;
      return rightActive - leftActive
        || Number(right.priority || 0) - Number(left.priority || 0)
        || Number(right.createdAt || 0) - Number(left.createdAt || 0);
    }), [tracks]);

  useEffect(() => {
    if (selectedTrackId && researchedTracks.some((track) => track.id === selectedTrackId)) return;
    if (recentTrack?.id) {
      setSelectedTrackId(recentTrack.id);
      return;
    }
    if (researchedTracks[0]) setSelectedTrackId(researchedTracks[0].id);
  }, [recentTrack?.id, researchedTracks, selectedTrackId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedTrackId) window.localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, String(selectedTrackId));
    else window.localStorage.removeItem(ACTIVE_TARGET_STORAGE_KEY);
  }, [selectedTrackId]);

  const selectedTrack = useMemo<SelectedTrackSummary | null>(() => {
    if (!selectedTrackId) return null;
    if (recentTrack?.id === selectedTrackId) return recentTrack;
    const stored = researchedTracks.find((track) => track.id === selectedTrackId);
    if (!stored) return null;
    return {
      id: stored.id,
      name: stored.name,
      summary: stored.description || "Anchor has an evidence-backed development plan for this target.",
    };
  }, [recentTrack, researchedTracks, selectedTrackId]);

  function activateInBackground(trackId: number) {
    setActivationNotice({ state: "pending", message: "Anchor is selecting and activating the smallest safe execution slice." });
    void activateTrackExecution(trackId)
      .then((result) => setActivationNotice({ state: "success", message: activationMessage(result) }))
      .catch((activationError: any) => setActivationNotice({
        state: "error",
        message: activationError?.message || "The plan was created, but automatic activation did not complete. Use the active-slice control below to retry.",
      }));
  }

  async function researchFocusArea(value = focus) {
    const domain = value.trim();
    if (!domain || busy) return;
    setBusy(true);
    setError("");
    setActivationNotice({ state: "idle", message: "" });
    try {
      const result = await mutateAndInvalidate("POST", "/api/track-research", { domain }, [
        "/api/career-tracks",
        "/api/strategy",
        "/api/strategy/diagnostics",
        "/api/strategy/front-door",
        ...GOAL_SPINE_QUERY_KEYS,
      ]);
      const track = result?.track;
      const brief = result?.brief;
      const trackId = Number(track?.id);
      await invalidateTrackResearchModels(Number.isFinite(trackId) ? trackId : undefined);
      const selected = {
        id: trackId,
        name: track?.name || brief?.trackName || domain,
        summary: brief?.summary || track?.description || "Anchor created an evidence-backed requirement model for this target.",
        evidenceCount: Array.isArray(result?.evidencePack) ? result.evidencePack.length : undefined,
      };
      if (Number.isFinite(trackId)) {
        setRecentTrack(selected);
        setSelectedTrackId(trackId);
        onResearched?.(trackId);
        activateInBackground(trackId);
      }
      setFocus("");
    } catch (e: any) {
      setError(e?.message || "Could not research this career target. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4" data-testid="focus-area-research-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Compass className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold leading-snug">Build toward a career direction</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Research requirements</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Tell Anchor the direction you want. It will research the market requirements, assess your evidence, build the development and execution plans, and activate only the smallest useful slice.
          </p>

          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              researchFocusArea();
            }}
          >
            <Input
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              placeholder="AI strategy, geopolitical risk, government delivery..."
              aria-label="Career direction to build toward"
              data-testid="input-focus-area"
              disabled={busy}
              className="h-10"
            />
            <Button type="submit" disabled={busy || !focus.trim()} className="h-10 shrink-0" data-testid="button-research-focus-area">
              {busy ? <Sparkles className="mr-1 h-4 w-4 animate-pulse" /> : <Search className="mr-1 h-4 w-4" />}
              {busy ? "Researching requirements" : "Research target"}
            </Button>
          </form>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => researchFocusArea(example)}
                disabled={busy}
                className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                data-testid={`button-focus-example-${example.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
              >
                {example}
              </button>
            ))}
          </div>

          {error && (
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-snug text-destructive" data-testid="focus-area-error">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          {researchedTracks.length > 1 && (
            <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Active target workspace
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground"
                value={selectedTrackId || ""}
                onChange={(event) => {
                  const nextId = Number(event.target.value);
                  if (!Number.isFinite(nextId)) return;
                  setSelectedTrackId(nextId);
                  setRecentTrack((current) => current?.id === nextId ? current : null);
                  setActivationNotice({ state: "idle", message: "" });
                }}
                data-testid="select-active-target"
              >
                {researchedTracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
              </select>
            </label>
          )}

          {selectedTrack && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2" data-testid="focus-area-result">
              <p className="text-xs font-medium text-primary">Active target: {selectedTrack.name}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{selectedTrack.summary}</p>
              {typeof selectedTrack.evidenceCount === "number" && (
                <p className="mt-1 text-[11px] text-muted-foreground">Used {selectedTrack.evidenceCount} market evidence item{selectedTrack.evidenceCount === 1 ? "" : "s"} to build the requirement model.</p>
              )}
            </div>
          )}

          {activationNotice.state !== "idle" && (
            <div className={`mt-2 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[11px] leading-snug ${activationNotice.state === "error" ? "bg-destructive/10 text-destructive" : activationNotice.state === "success" ? "bg-emerald-50 text-emerald-800" : "bg-muted/40 text-muted-foreground"}`} role="status" data-testid="execution-activation-status">
              {activationNotice.state === "pending" ? <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin" /> : activationNotice.state === "success" ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
              <span>{activationNotice.message}</span>
            </div>
          )}

          <TrackResearchReview trackId={selectedTrackId} />
          <TrackDevelopmentPlan trackId={selectedTrackId} />
          <TrackExecutionPriority trackId={selectedTrackId} />
          <TrackExecutionBlueprint trackId={selectedTrackId} />
        </div>
      </div>
    </section>
  );
}
