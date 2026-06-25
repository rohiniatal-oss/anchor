import { useQuery } from "@tanstack/react-query";

export function useRecommendations<T = unknown[]>() {
  return useQuery<T>({ queryKey: ["/api/recommendations"] });
}

/**
 * Kept as a compatibility hook for existing callers. Recommendation synthesis
 * is now an explicit command rather than a hidden write performed on mount.
 */
export function useSyncRecommendationsOnMount() {
  return undefined;
}
