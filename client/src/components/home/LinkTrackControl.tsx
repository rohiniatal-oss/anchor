// @ts-nocheck
import { useState } from "react";
import { Link2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import type { CareerTrack } from "@shared/schema";
import type { TrackedEntity } from "@shared/domainState";

const ENTITY_QUERY: Record<TrackedEntity, string> = {
  jobs: "/api/jobs", learn: "/api/learn", contacts: "/api/contacts", hustles: "/api/hustles", tasks: "/api/tasks",
};

export function LinkTrackControl({ entity, id, trackId, tracks }: { entity: TrackedEntity; id: number; trackId: number | null; tracks: CareerTrack[] }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  async function link(next: number | null) {
    await mutateAndInvalidate("PATCH", `/api/${entity}/${id}/link-track`, { trackId: next }, [ENTITY_QUERY[entity], "/api/strategy", "/api/strategy/diagnostics", "/api/strategy/unlinked", ...GOAL_SPINE_QUERY_KEYS]);
    setOpen(false);
    toast({ title: next ? "Linked to track." : "Unlinked.", description: next ? "It'll show up under this path in Strategy." : "Removed from its track." });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid={`button-link-track-${entity}-${id}`} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
          <Link2 className="w-3.5 h-3.5" /> {trackId ? "Role type" : "Link role type"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5" align="start">
        <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a role type</p>
        <div className="space-y-0.5">
          {tracks.map((t) => (
            <button key={t.id} onClick={() => link(t.id)} data-testid={`option-track-${t.id}`}
              className={`w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate ${trackId === t.id ? "text-primary font-medium" : ""}`}>
              {t.name}
            </button>
          ))}
          {trackId && (
            <button onClick={() => link(null)} className="w-full text-left text-sm px-2 py-1.5 rounded-md text-muted-foreground hover-elevate">Unlink</button>
          )}
          {tracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No role types yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
