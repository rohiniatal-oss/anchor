import { useQuery } from "@tanstack/react-query";
import type { CareerTrack } from "@shared/schema";

export function useCareerTracks() {
  return useQuery<CareerTrack[]>({ queryKey: ["/api/career-tracks"] });
}
