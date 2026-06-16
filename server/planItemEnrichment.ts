/**
 * Enriches plan items for learn items that have LLM-generated curriculum
 * milestones. Replaces the generic "Open the learning item and capture a note"
 * first-step with the actual active checkpoint from the curriculum, including
 * scaffolding questions and milestone type.
 */

import { storage } from "./storage";
import { explainPersistedPlanItem } from "./brain";

type ActiveMilestone = {
  id: number;
  label: string;
  suggestedTaskTitle: string;
  doneWhen: string;
  scaffolding: string;
  milestoneType: string;
  sequence: number;
  totalMilestones: number;
  doneCount: number;
  completionNotes: string[];
};

async function activeMilestoneForLearnItem(
  learnSourceType: string | null | undefined,
  learnSourceId: number | null | undefined,
): Promise<ActiveMilestone | null> {
  if (learnSourceType !== "recommendation" || learnSourceId == null) return null;
  const milestones = await storage.getRecommendationMilestones(learnSourceId);
  if (!milestones.length) return null;
  const active =
    milestones.find((m) => m.status === "active") ||
    milestones.find((m) => m.status === "todo") ||
    null;
  if (!active || !active.suggestedTaskTitle) return null;
  const done = milestones.filter((m) => m.status === "done");
  return {
    id: active.id,
    label: active.label,
    suggestedTaskTitle: active.suggestedTaskTitle,
    doneWhen: active.doneWhen,
    scaffolding: (active as any).scaffolding || "",
    milestoneType: (active as any).milestoneType || "content",
    sequence: active.sequence,
    totalMilestones: milestones.length,
    doneCount: done.length,
    completionNotes: done
      .map((m) => (m as any).completionNote as string || "")
      .filter(Boolean),
  };
}

export async function enrichPlanItems(items: any[]): Promise<any[]> {
  const learnSourceIds = [...new Set(
    items.filter((i) => i.sourceType === "learn" && i.sourceId != null).map((i) => i.sourceId as number),
  )];
  const learnById = new Map<number, any>();
  for (const sid of learnSourceIds) {
    const l = await storage.getLearnItem(sid).catch(() => undefined);
    if (l) learnById.set(sid, l);
  }

  return Promise.all(items.map(async (item) => {
    const explanation = explainPersistedPlanItem(item);
    if (item.sourceType === "learn" && item.sourceId != null) {
      const learnItem = learnById.get(item.sourceId);
      if (learnItem) {
        const milestone = await activeMilestoneForLearnItem(learnItem.sourceType, learnItem.sourceId);
        if (milestone) {
          return {
            ...item,
            explanation: {
              ...explanation,
              firstStep: milestone.suggestedTaskTitle,
              nextCheckpoint: {
                id: milestone.id,
                label: milestone.label,
                doneWhen: milestone.doneWhen,
                scaffolding: milestone.scaffolding,
                milestoneType: milestone.milestoneType,
                sequence: milestone.sequence,
                totalMilestones: milestone.totalMilestones,
                doneCount: milestone.doneCount,
                completionNotes: milestone.completionNotes,
              },
            },
          };
        }
      }
    }
    return { ...item, explanation };
  }));
}
