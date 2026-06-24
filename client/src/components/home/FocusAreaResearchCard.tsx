import { useState } from "react";
import { Compass, Search, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { TrackResearchReview } from "@/components/home/TrackResearchReview";
import { TrackDevelopmentPlan } from "@/components/home/TrackDevelopmentPlan";
import { TrackExecutionBlueprint } from "@/components/home/TrackExecutionBlueprint";

type FocusAreaResearchCardProps = {
  onResearched?: (trackId?: number) => void;
};

const EXAMPLES = ["AI strategy", "geopolitical risk advisory", "government delivery roles"];

export function FocusAreaResearchCard({ onResearched }: FocusAreaResearchCardProps) {
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastTrack, setLastTrack] = useState<{ id?: number; name: string; summary: string; evidenceCount?: number } | null>(null);

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
      setLastTrack({
        id: track?.id,
        name: track?.name || brief?.trackName || domain,
        summary: brief?.summary || track?.description || "Anchor created an evidence-backed requirement model for this target.",
        evidenceCount: Array.isArray(result?.evidencePack) ? result.evidencePack.length : undefined,
      });
      setFocus("");
      onResearched?.(track?.id);
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
            Tell Anchor the direction you want. It will research what the market requires, assess the evidence you already have, build the development plan, and define the complete work hierarchy beneath it.
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

          {lastTrack && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2" data-testid="focus-area-result">
              <p className="text-xs font-medium text-primary">Target researched: {lastTrack.name}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{lastTrack.summary}</p>
              {typeof lastTrack.evidenceCount === "number" && (
                <p className="mt-1 text-[11px] text-muted-foreground">Used {lastTrack.evidenceCount} market evidence item{lastTrack.evidenceCount === 1 ? "" : "s"} to build the requirement model.</p>
              )}
            </div>
          )}

          <TrackResearchReview trackId={lastTrack?.id} />
          <TrackDevelopmentPlan trackId={lastTrack?.id} />
          <TrackExecutionBlueprint trackId={lastTrack?.id} />
        </div>
      </div>
    </section>
  );
}
