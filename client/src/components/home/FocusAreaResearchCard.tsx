import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass, Search, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateAndInvalidate } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { TrackResearchReview } from "@/components/home/TrackResearchReview";
import { TrackDevelopmentPlan } from "@/components/home/TrackDevelopmentPlan";
import { TrackExecutionPriority } from "@/components/home/TrackExecutionPriority";
import { TrackExecutionEvidence } from "@/components/home/TrackExecutionEvidence";
import { TrackExecutionBlueprint } from "@/components/home/TrackExecutionBlueprint";

type FocusAreaResearchCardProps = {
  onResearched?: (trackId?: number) => void;
};

type CareerTrackSummary = {
  id: number;
  name: string;
  description: string;
  status: string;
  trackIntelligence: string;
  createdAt: number;
};

type DisplayTrack = {
  id: number;
  name: string;
  summary: string;
  evidenceCount?: number;
};

const EXAMPLES = ["AI strategy", "geopolitical risk advisory", "government delivery roles"];
const ACTIVE_TARGET_STORAGE_KEY = "anchor.activeCareerTargetId";

function parseIntelligence(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function trackDisplay(track: CareerTrackSummary): DisplayTrack {
  const intelligence = parseIntelligence(track.trackIntelligence);
  return {
    id: track.id,
    name: track.name,
    summary: intelligence.researchSummary || track.description || "Anchor has an evidence-backed requirement model for this target.",
    evidenceCount: Array.isArray(intelligence.evidencePack) ? intelligence.evidencePack.length : undefined,
  };
}

function researchedTrack(track: CareerTrackSummary): boolean {
  const intelligence = parseIntelligence(track.trackIntelligence);
  return Boolean(intelligence.researchedAt || intelligence.requirementModel || intelligence.coverageModel);
}

function storedTrackId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const value = Number(window.localStorage.getItem(ACTIVE_TARGET_STORAGE_KEY));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function invalidateTrackResearchModels(trackId?: number) {
  if (!trackId) return;
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/research-plan`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/coverage`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/development-plan`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-priority`] }),
    queryClient.invalidateQueries({ queryKey: [`/api/career-tracks/${trackId}/execution-outcomes`] }),
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
  const [selectedTrackId, setSelectedTrackId] = useState<number | undefined>(storedTrackId);
  const [recentTrack, setRecentTrack] = useState<DisplayTrack | null>(null);
  const [activationMessage, setActivationMessage] = useState("");
  const { data: tracks = [] } = useQuery<CareerTrackSummary[]>({
    queryKey: ["/api/career-tracks"],
    staleTime: 30_000,
    retry: false,
  });

  const researchedTracks = useMemo(
    () => tracks.filter(researchedTrack).sort((left, right) => {
      const leftUpdated = Number(parseIntelligence(left.trackIntelligence).lastUpdated || left.createdAt || 0);
      const rightUpdated = Number(parseIntelligence(right.trackIntelligence).lastUpdated || right.createdAt || 0);
      return rightUpdated - leftUpdated;
    }),
    [tracks],
  );

  useEffect(() => {
    if (selectedTrackId && researchedTracks.some((track) => track.id === selectedTrackId)) return;
    const fallback = researchedTracks.find((track) => track.status === "active") || researchedTracks[0];
    if (!fallback) return;
    setSelectedTrackId(fallback.id);
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, String(fallback.id));
  }, [researchedTracks, selectedTrackId]);

  const selectedTrack = useMemo(
    () => researchedTracks.find((track) => track.id === selectedTrackId),
    [researchedTracks, selectedTrackId],
  );
  const displayTrack = recentTrack?.id === selectedTrackId
    ? recentTrack
    : selectedTrack
      ? trackDisplay(selectedTrack)
      : null;

  function chooseTrack(trackId: number) {
    setSelectedTrackId(trackId);
    setRecentTrack(null);
    setActivationMessage("");
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_TARGET_STORAGE_KEY, String(trackId));
  }

  async function researchFocusArea(value = focus) {
    const domain = value.trim();
    if (!domain || busy) return;
    setBusy(true);
    setError("");
    setActivationMessage("");
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
      await invalidateTrackResearchModels(trackId);
      const nextTrack: DisplayTrack = {
        id: trackId,
        name: track?.name || brief?.trackName || domain,
        summary: brief?.summary || track?.description || "Anchor created an evidence-backed requirement model for this target.",
        evidenceCount: Array.isArray(result?.evidencePack) ? result.evidencePack.length : undefined,
      };
      setRecentTrack(nextTrack);
      chooseTrack(trackId);
      setRecentTrack(nextTrack);
      setFocus("");
      onResearched?.(trackId);

      if (Number.isFinite(trackId)) {
        setActivationMessage("Anchor is selecting and activating the smallest safe execution slice.");
        void activateTrackExecution(trackId)
          .then((activation) => {
            const created = Number(activation?.materializationResult?.created?.length || 0);
            const reused = Number(activation?.materializationResult?.reused?.length || 0);
            setActivationMessage(created
              ? `${created} selected task${created === 1 ? " is" : "s are"} now available in Inbox. Today will decide when they fit.`
              : reused
                ? "The selected execution work was already active, so Anchor created no duplicates."
                : "The plan is current and no additional live task was needed.");
          })
          .catch((activationError: any) => {
            setActivationMessage(activationError?.message || "The plan is ready, but automatic activation did not complete. Use the active-slice retry action below.");
          });
      }
    } catch (e: any) {
      setError(e?.message || "Could not research this career target. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4" data-testid="focus-area-research-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg