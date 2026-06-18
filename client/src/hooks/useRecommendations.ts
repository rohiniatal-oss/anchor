import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export function useRecommendations<T = unknown[]>() {
  return useQuery<T>({ queryKey: ["/api/recommendations"] });
}

export function useSyncRecommendationsOnMount() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const freshnessRes = await apiRequest("GET", "/api/recommendations/freshness");
        const freshness = await freshnessRes.json().catch(() => ({ needsSync: true } as { needsSync?: boolean }));
        if (!freshness.needsSync) return;
        await apiRequest("POST", "/api/recommendations/sync");
        if (!cancelled) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] }),
            queryClient.invalidateQueries({ queryKey: ["/api/strategy/front-door"] }),
            queryClient.invalidateQueries({ queryKey: ["/api/strategy"] }),
          ]);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient]);
}
