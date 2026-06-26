import { useState } from "react";
import { Ban, Link2, Loader2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import type { CareerTrack } from "@shared/schema";
import type { TrackedEntity } from "@shared/domainState";

const ENTITY_QUERY: Record<TrackedEntity, string> = {
  jobs: "/api/jobs", learn: "/api/learn", contacts: "/api/contacts", hustles: "/api/hustles", tasks: "/api/tasks",
};

const OBJECT_TYPE: Record<TrackedEntity, "job" | "learn" | "contact" | "hustle" | "task"> = {
  jobs: "job", learn: "learn", contacts: "contact", hustles: "hustle", tasks: "task",
};

const INVALIDATE_KEYS = [
  "/api/strategy",
  "/api/strategy/diagnostics",
  "/api/strategy/unlinked",
  "/api/strategy/front-door",
  "/api/ownership/strategic-objects",
  "/api/anchor/today",
  ...GOAL_SPINE_QUERY_KEYS,
];

type OwnershipAction = "assign_to_track" | "park" | "stop";

export function LinkTrackControl({ entity, id, trackId, tracks }: { entity: TrackedEntity; id: number; trackId: number | null; tracks: CareerTrack[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<OwnershipAction | null>(null);
  const { toast } = useToast();

  async function resolve(action: OwnershipAction, nextTrackId?: number) {
    if (busy) return;
    if (action === "stop" && typeof window !== "undefined" && !window.confirm("Stop this item? It will be closed or deactivated where Anchor has a status for it.")) return;
    setBusy(action);
    try {
      await mutateAndInvalidate(
        "POST",
        "/api/ownership/strategic-objects/resolve",
        {
          objectType: OBJECT_TYPE[entity],
          objectId: id,
          action,
          ...(nextTrackId ? { trackId: nextTrackId } : {}),
        },
        [ENTITY_QUERY[entity], ...INVALIDATE_KEYS],
      );
      setOpen(false);
      if (action === "assign_to_track") {
        toast({ title: "Assigned to role type.", description: "It will now count under that direction in Strategy." });
      } else if (action === "park") {
        toast({ title: "Parked.", description: "It will stay out of active execution until you assign it to a direction." });
      } else {
        toast({ title: "Stopped.", description: "Anchor will no longer treat it as active strategic work." });
      }
    } catch (error: any) {
      toast({ title: "Couldn't update ownership", description: error?.message || "Try again in a moment." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button data-testid={`button-link-track-${entity}-${id}`} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 disabled:opacity-60" disabled={busy !== null}>
            {busy === "assign_to_track" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            {trackId ? "Role type" : "Assign"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1.5" align="start">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Assign to a role type</p>
          <div className="space-y-0.5">
            {tracks.map((t) => (
              <button key={t.id} onClick={() => resolve("assign_to_track", t.id)} data-testid={`option-track-${t.id}`}
                disabled={busy !== null}
                className={`w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate disabled:opacity-60 ${trackId === t.id ? "text-primary font-medium" : ""}`}>
                {t.name}
              </button>
            ))}
            {trackId && (
              <button onClick={() => resolve("park")} disabled={busy !== null} className="w-full text-left text-sm px-2 py-1.5 rounded-md text-muted-foreground hover-elevate disabled:opacity-60">
                Park outside role types
              </button>
            )}
            {tracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No role types yet.</p>}
          </div>
        </PopoverContent>
      </Popover>
      {!trackId && (
        <>
          <button
            onClick={() => resolve("park")}
            disabled={busy !== null}
            data-testid={`button-park-ownership-${entity}-${id}`}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-60"
          >
            {busy === "park" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Park
          </button>
          <button
            onClick={() => resolve("stop")}
            disabled={busy !== null}
            data-testid={`button-stop-ownership-${entity}-${id}`}
            className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1 disabled:opacity-60"
          >
            {busy === "stop" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            Stop
          </button>
        </>
      )}
    </span>
  );
}
