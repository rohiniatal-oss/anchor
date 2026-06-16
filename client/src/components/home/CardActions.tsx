// @ts-nocheck
import { useState } from "react";
import { ListChecks, Loader2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { taskActionLabelForEntity, taskCreatedLabelForEntity, taskToastDescription } from "@/lib/taskActionCopy";
import { LinkTrackControl } from "@/components/home/LinkTrackControl";
import type { CareerTrack } from "@shared/schema";
import type { TrackedEntity } from "@shared/domainState";

export function CardActions({ entity, id, trackId, tracks, onViewTasks, nextTaskHint }: { entity: Exclude<TrackedEntity, "tasks">; id: number; trackId: number | null; tracks: CareerTrack[]; onViewTasks: () => void; nextTaskHint?: string | null }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function createNext() {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/${entity}/${id}/create-next-task`, {}, ["/api/tasks", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: r?.reused ? "Already on your list." : taskCreatedLabelForEntity(entity), description: taskToastDescription(r, "There's already an open task for this.") });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-2.5 pt-2 border-t border-card-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button onClick={createNext} disabled={busy} data-testid={`button-create-next-${entity}-${id}`} className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {taskActionLabelForEntity(entity)}
        </button>
        <button onClick={onViewTasks} data-testid={`button-view-tasks-${entity}-${id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ListChecks className="w-3.5 h-3.5" /> View linked tasks
        </button>
        <LinkTrackControl entity={entity} id={id} trackId={trackId} tracks={tracks} />
      </div>
      {nextTaskHint && <p className="mt-1.5 text-[11px] text-muted-foreground">{nextTaskHint}</p>}
    </div>
  );
}
