import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Compass, RefreshCw, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateAndInvalidate } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import {
  ACTIVE_TARGET_STORAGE_KEY,
  chooseActiveTargetWorkspace,
  researchedTargetWorkspaces,
  type TargetWorkspaceSummary,
} from "@/lib/targetWorkspace";
import { TrackResearchReview } from "@/components/home/TrackResearchReview";
import { TrackDevelopmentPlan } from "@/components/home/TrackDevelopmentPlan";
import { TrackExecutionPriority } from "@/components/home/TrackExecutionPriority";
import { TrackExecutionBlueprint } from "@/components/home/TrackExecutionBlueprint";

type FocusAreaResearchCardProps = {
  onResearched?: (trackId?: number) => void;
};

type ActivationNotice = {
  status: "idle" | "running" | "success" | "error";
  trackId: number | null;
  message: string;
};

const EXAMPLES = ["AI strategy", "geopolitical risk advisory", "government delivery roles"];

function initialPersistedTrackId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const value = Number(window.localStorage.getItem(ACTIVE_TARGET_STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistActiveTrackId(trackId: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (trackId) window.localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, String(trackId));
    else window.localStorage.removeItem(ACTIVE_TARGET_STORAGE_KEY);
  } catch {
    // The workspace still works for this session when local storage is unavailable.
  }
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

function activationMessage(result: any): string {
  const materialization = result?.materializationResult || {};
  const created = Array.isArray(materialization.created) ? materialization.created.length : 0;
  const reused = Array.isArray(materialization.reused) ? materialization.reused.length : 0;
  const skipped = Array.isArray(materialization.skipped) ? materialization.skipped.length : 0;
  if (created > 0) {
    return `Anchor added ${created} focused task${created === 1 ? "" : "s"} to the active-work inbox${reused ? ` and retained ${reused} already active` : ""}. Today will decide what fits your actual day.${skipped ? ` ${skipped} item${skipped === 1 ? " was" : "s were"} held back safely.` : ""}`;
  }
  if (reused > 0) return `The current active slice is already in place with ${reused} live task${reused === 1 ? "" : "s"}. Today will decide what fits your actual day.`;
  return skipped > 0
    ? `Anchor kept ${skipped} blueprint item${skipped === 1 ? "" : "s"} out of the live task system because the readiness or capacity safeguards did not pass.`
    : "The execution plan is current and no additional live task is needed right now.";
}

export function FocusAreaResearchCard({ onResearched }: FocusAreaResearchCardProps) {
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(initialPersistedTrackId);
  const [freshResearch, setFreshResearch] = useState<TargetWorkspaceSummary | null>(null);
  const [activationNotice, setActivationNotice] = useState<ActivationNotice>({ status: "idle", trackId: null, message: "" });
  const { data: careerTracks = [] } = useCareerTracks();
  const researchedTargets = useMemo(() => researchedTargetWorkspaces(careerTracks), [careerTracks]);
  const selectedFromTracks = useMemo(
    () => chooseActiveTargetWorkspace(careerTracks, selectedTrackId),
    [careerTracks, selectedTrackId],
  );
  const visibleTrack = freshResearch?.id === selectedTrackId ? freshResearch : selectedFromTracks;

  useEffect(() => {
    if (!selectedFromTracks || selectedFromTracks.id === selectedTrackId) return;
    setSelectedTrackId(selectedFromTracks.id);
    persistActiveTrackId(selectedFromTracks.id);
  }, [selectedFromTracks, selectedTrackId]);

  function selectTrack(trackId: number) {
    setSelectedTrackId(trackId);
    persistActiveTrackId(trackId);
    if (freshResearch?.id !== trackId) setFreshResearch(null);
    setActivationNotice({ status: "idle", trackId, message: "" });
  }

  function runActivation(trackId: number) {
    setActivationNotice({
      status: "running",
      trackId,
      message: "Anchor is building and activating the smallest safe execution slice in the background.",
    });
    void activateTrackExecution(trackId)
      .then((result) => {
        setActivationNotice({ status: "success", trackId, message: activationMessage(result) });
      })
      .catch((activationError: any) => {
        setActivationNotice({
          status: "error",
          trackId,
          message: activationError?.message || "The target research is saved, but Anchor could not activate the execution slice.",
        });
      });
  }

  async function researchFocusArea(value = focus) {
    const domain = value.trim();
    if (!domain || busy) return;
    setBusy(true);
    setError("");
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
      if (!Number.isInteger(trackId) || trackId <= 0) throw new Error("Anchor researched the target but did not return a valid workspace.");
      await invalidateTrackResearchModels(trackId);
      const summary: TargetWorkspaceSummary = {
        id: trackId,
        name: track?.name || brief?.trackName || domain,
        summary: brief?.summary || track?.description || "Anchor created an evidence-backed requirement model for this target.",
        evidenceCount: Array.isArray(result?.evidencePack) ? result.evidencePack.length : null,
        status: track?.status || "active",
        priority: Number(track?.priority || 0),
        updatedAt: Date.now(),
      };
      setFreshResearch(summary);
      selectTrack(trackId);
      setFocus("");
      onResearched?.(trackId);
      runActivation(trackId);
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold leading-snug">Build toward a career direction</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Persistent target workspace</span>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                Tell Anchor the direction you want. It will research the requirements, assess your evidence, build the plan, and activate only a small safe slice.
              </p>
            </div>
            {researchedTargets.length > 1 && (
              <label className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                Target
                <select
                  value={visibleTrack?.id || ""}
                  onChange={(event) => selectTrack(Number(event.target.value))}
                  className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  data-testid="select-active-target-workspace"
                >
                  {researchedTargets.map((target) => (
                    <option key={target.id} value={target.id}>{target.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

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

          {visibleTrack && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2" data-testid="focus-area-result">
              <p className="text-xs font-medium text-primary">Current target: {visibleTrack.name}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{visibleTrack.summary}</p>
              {typeof visibleTrack.evidenceCount === "number" && (
                <p className="mt-1 text-[11px] text-muted-foreground">Built from {visibleTrack.evidenceCount} market evidence item{visibleTrack.evidenceCount === 1 ? "" : "s"}.</p>
              )}
            </div>
          )}

          {activationNotice.trackId === visibleTrack?.id && activationNotice.status !== "idle" && (
            <div className={`mt-2 rounded-lg border px-3 py-2 ${activationNotice.status === "error" ? "border-destructive/30 bg-destructive/5" : activationNotice.status === "success" ? "border-emerald-200 bg-emerald-50/60" : "border-primary/20 bg-primary/5"}`} data-testid="target-activation-notice">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className={`flex items-start gap-1.5 text-[11px] leading-snug ${activationNotice.status === "error" ? "text-destructive" : activationNotice.status === "success" ? "text-emerald-800" : "text-primary"}`}>
                  {activationNotice.status === "running" ? <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 animate-pulse" /> : activationNotice.status === "success" ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
                  {activationNotice.message}
                </p>
                {activationNotice.status === "error" && visibleTrack && (
                  <Button size="sm" variant="outline" onClick={() => runActivation(visibleTrack.id)}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry activation
                  </Button>
                )}
              </div>
            </div>
          )}

          <TrackResearchReview trackId={visibleTrack?.id} />
          <TrackDevelopmentPlan trackId={visibleTrack?.id} />
          <TrackExecutionPriority trackId={visibleTrack?.id} />
          <TrackExecutionBlueprint trackId={visibleTrack?.id} />
        </div>
      </div>
    </section>
  );
}
