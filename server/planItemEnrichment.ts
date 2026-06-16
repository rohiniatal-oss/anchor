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

function activeMilestoneFromMilestones(milestones: any[]): ActiveMilestone | null {
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

export async function buildLearnMilestoneProgress(learnItems: any[]): Promise<Map<number, { done: number; total: number }>> {
  const map = new Map<number, { done: number; total: number }>();
  const recommendationIds = [...new Set(
    learnItems
      .filter((l) => l.sourceType === "recommendation" && l.sourceId != null)
      .map((l) => l.sourceId as number),
  )];
  const milestoneRows = await storage.getRecommendationMilestonesForRecommendationIds(recommendationIds).catch(() => []);
  const milestonesByRecommendationId = new Map<number, any[]>();
  for (const milestone of milestoneRows) {
    const current = milestonesByRecommendationId.get(milestone.recommendationId) || [];
    current.push(milestone);
    milestonesByRecommendationId.set(milestone.recommendationId, current);
  }
  for (const l of learnItems) {
    if (l.sourceType !== "recommendation" || l.sourceId == null) continue;
    const milestones = milestonesByRecommendationId.get(l.sourceId) || [];
    if (!milestones.length) continue;
    map.set(l.id, { done: milestones.filter((m: any) => m.status === "done").length, total: milestones.length });
  }
  return map;
}

export async function enrichPlanItems(items: any[]): Promise<any[]> {
  const learnSourceIds = [...new Set(
    items.filter((i) => i.sourceType === "learn" && i.sourceId != null).map((i) => i.sourceId as number),
  )];
  const learnRows = await storage.getLearnItems(learnSourceIds).catch(() => []);
  const learnById = new Map<number, any>();
  for (const learnItem of learnRows) {
    learnById.set(learnItem.id, learnItem);
  }
  const recommendationIds = [...new Set(
    learnRows
      .filter((l) => l.sourceType === "recommendation" && l.sourceId != null)
      .map((l) => l.sourceId as number),
  )];
  const milestoneRows = await storage.getRecommendationMilestonesForRecommendationIds(recommendationIds).catch(() => []);
  const milestonesByRecommendationId = new Map<number, any[]>();
  for (const milestone of milestoneRows) {
    const current = milestonesByRecommendationId.get(milestone.recommendationId) || [];
    current.push(milestone);
    milestonesByRecommendationId.set(milestone.recommendationId, current);
  }

  return Promise.all(items.map(async (item) => {
    const explanation = explainPersistedPlanItem(item);
    if (item.sourceType === "learn" && item.sourceId != null) {
      const learnItem = learnById.get(item.sourceId);
      if (learnItem) {
        const milestones = learnItem.sourceType === "recommendation" && learnItem.sourceId != null
          ? milestonesByRecommendationId.get(learnItem.sourceId) || []
          : [];
        const milestone = activeMilestoneFromMilestones(milestones);
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
