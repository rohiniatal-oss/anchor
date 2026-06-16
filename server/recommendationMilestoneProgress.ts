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

function winCategoryForTask(task: { category?: string; sourceType?: string }) {
  return task.category === "job" || task.category === "interview" ? "job_progress"
    : task.category === "learning" ? "learning"
    : task.category === "substack" || task.category === "hustle" || task.category === "afterline" ? "proof_asset"
    : task.sourceType === "contact" ? "network"
    : "admin";
}

async function closeLinkedOpenTasksForMilestone(milestoneId: number) {
  const openTasks = (await storage.getTasks()).filter((task) =>
    task.sourceStepType === "recommendation_milestone"
    && task.sourceStepId === milestoneId
    && !task.done,
  );
  if (!openTasks.length) return;

  const completedAt = Date.now();
  for (const task of openTasks) {
    await storage.updateTask(task.id, {
      done: true,
      status: "done",
      pinned: false,
    } as any);
    if (task.planItemId != null) {
      await storage.updatePlanItem(task.planItemId, {
        status: "completed",
        completedAt,
      } as any);
      const planItem = await storage.getPlanItem(task.planItemId);
      const plan = planItem ? await storage.getPlan(planItem.planId) : undefined;
      if (plan && plan.minimumViableItemId === planItem?.id && !plan.enoughForToday) {
        await storage.updatePlan(plan.id, {
          enoughForToday: true,
          status: "done_enough",
        } as any);
      }
    }
    await storage.createWin({
      text: task.title,
      kind: "planned",
      winCategory: winCategoryForTask(task),
      trackId: task.relatedTrackId ?? null,
    } as any);
    await storage.logActivity({
      eventType: "completed",
      sourceType: task.sourceType || "task",
      sourceId: task.sourceId ?? undefined,
      taskId: task.id,
      planItemId: task.planItemId ?? undefined,
      metadata: JSON.stringify({ via: "recommendation_milestone" }),
    } as any);
  }
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
  if (status === "done") {
    await closeLinkedOpenTasksForMilestone(milestoneId);
  }
  await normalizeRecommendationMilestones(milestone.recommendationId);
  return await storage.getRecommendationMilestone(milestoneId);
}

export async function completeRecommendationMilestone(milestoneId: number) {
  return await setRecommendationMilestoneStatus(milestoneId, "done");
}
