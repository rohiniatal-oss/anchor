/**
 * useAutopilot.ts
 *
 * Fetches autopilot proposals on Today load.
 * Only runs when there is no pinned task — stays out of the way once
 * the user has started something.
 *
 * Usage in Today:
 *   const { topProposal, proposals, isLoading } = useAutopilot(!pinnedTask);
 */

import { useQuery } from "@tanstack/react-query";

export type AutopilotProposal = {
  title: string;
  reason: string;
  sourceType: "job" | "contact" | "learn" | "capture" | "hustle";
  sourceId: number;
  urgency: "critical" | "high" | "normal";
  existingTaskId?: number;
};

async function fetchProposals(): Promise<{ proposals: AutopilotProposal[] }> {
  const res = await fetch("/api/autopilot/proposals");
  if (!res.ok) return { proposals: [] };
  return res.json();
}

export function useAutopilot(enabled: boolean) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["autopilot-proposals"],
    queryFn: fetchProposals,
    enabled,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 0,
  });

  const proposals = data?.proposals ?? [];

  return {
    topProposal: proposals[0] ?? null,
    proposals,
    isLoading,
    hasError: !!error,
  };
}
