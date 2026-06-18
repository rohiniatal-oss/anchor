import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export function useRecommendations<T = unknown[]>() {
  return useQuery<T>({ queryKey: ["/api/recommendations"] });
}

export async function invalidateIntelligenceQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/strategy/front-door"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/strategy"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/strategy/diagnostics"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/goals/state"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/networking/classifications"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/networking/gaps"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/networking/best-move"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/networking/analytics"] }),
  ]);
}

export function useSyncIntelligenceOnMount() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const freshnessRes = await apiRequest("GET", "/api/intelligence/freshness");
        const freshness = await freshnessRes.json().catch(() => ({ needsSync: true } as { needsSync?: boolean }));
        if (!freshness.needsSync) return;
        await apiRequest("POST", "/api/intelligence/sync");
        if (!cancelled) {
          await invalidateIntelligenceQueries(queryClient);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient]);
}

export const useSyncRecommendationsOnMount = useSyncIntelligenceOnMount;
