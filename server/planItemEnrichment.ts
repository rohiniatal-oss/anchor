/**
 * Enriches plan items for learn items that have LLM-generated curriculum
 * milestones. Replaces the generic "Open the learning item and capture a note"
 * first-step with the actual active checkpoint title from the curriculum.
 */

import { storage } from "./storage";
import { explainPersistedPlanItem } from "./brain";

async function activeMilestoneForLearnItem(
  learnSourceType: string | null | undefined,
  learnSourceId: number | null | undefined,
): Promise<{ label: string; suggestedTaskTitle: string; doneWhen: string } | null> {
  if (learnSourceType !== "recommendation" || learnSourceId == null) return null;
  const milestones = await storage.getRecommendationMilestones(learnSourceId);
  if (!milestones.length) return null;
  const active =
    milestones.find((m) => m.status === "active") ||
    milestones.find((m) => m.status === "todo") ||
    null;
  if (!active || !active.suggestedTaskTitle) return null;
  return { label: active.label, suggestedTaskTitle: active.suggestedTaskTitle, doneWhen: active.doneWhen };
}

export async function enrichPlanItems(items: any[]): Promise<any[]> {
  // Pre-fetch learn items for any plan item backed by a learn source to avoid
  // repeated DB calls in the loop.
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
              nextCheckpoint: { label: milestone.label, doneWhen: milestone.doneWhen },
            },
          };
        }
      }
    }
    return { ...item, explanation };
  }));
}
