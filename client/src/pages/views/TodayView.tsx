import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CareerCompassCard } from "@/components/home/CareerCompassCard";
import { RightNow } from "@/components/home/RightNow";
import { DayPlanCard } from "@/components/home/DayPlanCard";
import { WinLogger } from "@/components/home/WinLogger";
import { Tab } from "@/lib/homeTypes";
import type { CareerGoalT } from "@shared/goalState";
import type { DayPlanT, PlanItemT, WinT } from "@shared/schema";

export function TodayView({
  goal,
  onOpenTab,
  showSecondary,
  showDoneList,
  showUpcomingPlan,
}: {
  goal: CareerGoalT;
  onOpenTab: (tab: Tab) => void;
  showSecondary?: boolean;
  showDoneList?: boolean;
  showUpcomingPlan?: boolean;
}) {
  const qc = useQueryClient();

  const { data: plan } = useQuery<DayPlanT>({ queryKey: ["/api/day-plan"] });
  const { data: pinned } = useQuery<PlanItemT | null>({ queryKey: ["/api/pinned"] });
  const { data: wins = [] } = useQuery<WinT[]>({ queryKey: ["/api/wins"] });

  const executionState = plan?.executionState ?? {
    defaultSecondaryOpen: false,
    defaultDoneListOpen: false,
  };

  const activeItems: PlanItemT[] = plan?.items?.filter((it) => it.status === "pending") ?? [];

  const startItemMut = useMutation({
    mutationFn: (item: PlanItemT) =>
      apiRequest("POST", `/api/plan-items/${item.id}/pin`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pinned"] });
      qc.invalidateQueries({ queryKey: ["/api/day-plan"] });
    },
  });

  function startItem(item: PlanItemT) {
    return startItemMut.mutateAsync(item);
  }

  const secondaryOpen = showSecondary ?? executionState.defaultSecondaryOpen;
  const doneListOpen = showDoneList ?? executionState.defaultDoneListOpen;
  const upcomingPlanOpen = showUpcomingPlan ?? false;

  const hadPinned = useRef(false);
  const lastPinnedPlanItemId = useRef<number | null>(null);
  useEffect(() => {
    if (pinned) {
      hadPinned.current = true;
      lastPinnedPlanItemId.current = pinned.planItemId ?? null;
      return;
    }
    if (!hadPinned.current) return;
    if (plan?.enoughForToday) { hadPinned.current = false; return; }
    const next = activeItems.find((it) => it.id !== lastPinnedPlanItemId.current);
    if (!next) return;
    hadPinned.current = false;
    void startItem(next);
  }, [pinned, plan?.enoughForToday, activeItems]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="space-y-4">
      {goal && (
        <CareerCompassCard
          goal={goal}
          onOpenTab={onOpenTab}
          showOpenStrategy
        />
      )}
      {pinned ? (
        <RightNow
          item={pinned}
          goal={goal}
          onOpenTab={onOpenTab}
        />
      ) : (
        <div className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
          <p className="text-sm text-muted-foreground">
            {greeting}. Nothing pinned yet — pick something from the plan below.
          </p>
        </div>
      )}
      {plan && (
        <DayPlanCard
          plan={plan}
          onPin={startItem}
          secondaryOpen={secondaryOpen}
          doneListOpen={doneListOpen}
          upcomingPlanOpen={upcomingPlanOpen}
          onOpenTab={onOpenTab}
          goal={goal}
        />
      )}
      <WinLogger wins={wins} goal={goal} />
    </div>
  );
}
