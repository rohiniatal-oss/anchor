import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export function useRecommendations<T = unknown[]>() {
  const queryClient = useQueryClient();
  const query = useQuery<T>({ queryKey: ["/api/recommendations"] });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await apiRequest("POST", "/api/recommendations/sync");
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  return query;
}
