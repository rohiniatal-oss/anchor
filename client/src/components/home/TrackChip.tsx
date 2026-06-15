// @ts-nocheck
import { AlertTriangle, Compass } from "lucide-react";
import type { CareerTrack } from "@shared/schema";

export function TrackChip({ trackId, tracks }: { trackId: number | null; tracks: CareerTrack[] }) {
  if (!trackId) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" data-testid="badge-unlinked">
        <AlertTriangle className="w-2.5 h-2.5" /> unlinked
      </span>
    );
  }
  const t = tracks.find((x) => x.id === trackId);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" data-testid="badge-track">
      <Compass className="w-2.5 h-2.5" /> {t?.name || `Track ${trackId}`}
    </span>
  );
}
