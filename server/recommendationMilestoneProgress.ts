import { storage } from "./storage";

export async function normalizeRecommendationMilestones(recommendationId: number) {
  const milestones = await storage.getRecommendationMilestones(recommendationId);
  const current = milestones.filter((milestone) => milestone.status === "active" || milestone.status === "blocked");
  if (current.length > 1) {
    for (const extra of current.slice(1)) {
      await storage.updateRecommendationMilestone(extra.id, { status: "todo", completedAt: null } as any);
    }
  }
  const hasCurrent = milestones.some((milestone) => milestone.status === "active" || milestone.status === "blocked");
  const next = milestones.find((milestone) => milestone.status === "todo");
  if (!hasCurrent && next) {
    await storage.updateRecommendationMilestone(next.id, { status: "active", completedAt: null } as any);
  }
  return await storage.getRecommendationMilestones(recommendationId);
}

export async function setRecommendationMilestoneStatus(milestoneId: number, status: "todo" | "active" | "blocked" | "done" | "skipped") {
  const milestone = await storage.getRecommendationMilestone(milestoneId);
  if (!milestone) return null;

  if (status === "active" || status === "blocked") {
    const siblings = await storage.getRecommendationMilestones(milestone.recommendationId);
    for (const sibling of siblings) {
      if (sibling.id !== milestoneId && (sibling.status === "active" || sibling.status === "blocked")) {
        await storage.updateRecommendationMilestone(sibling.id, { status: "todo", completedAt: null } as any);
      }
    }
  }

  const patch: Record<string, unknown> = { status };
  patch.completedAt = status === "done" ? Date.now() : null;
  await storage.updateRecommendationMilestone(milestoneId, patch as any);
  await normalizeRecommendationMilestones(milestone.recommendationId);
  return await storage.getRecommendationMilestone(milestoneId);
}

export async function completeRecommendationMilestone(milestoneId: number) {
  return await setRecommendationMilestoneStatus(milestoneId, "done");
}
