import type { Express } from "express";
import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { buildCareerGoalState } from "./goalState";
import { buildExplorationQueue } from "./explorationQueue";

// ─────────────────────────────────────────────────────────────────────────────
// ANCHOR TODAY INTELLIGENCE
// Front-door synthesis layer. The user should not have to decide whether to look
// at goals, tasks, candidates, or exploration. Anchor Today gives one clear view:
// what is going on, what matters now, what to do, and what to ignore.
// ─────────────────────────────────────────────────────────────────────────────

type ExistingTaskAction = "use" | "shrink" | "defer" | "ignore";

function activeTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && ["today", "this_week", "later"].includes(t.list));
}

function taskText(task: Task) {
  return `${task.title} ${task.category} ${task.doneWhen} ${task.sourceType} ${task.sourceNote} ${task.blockerReason}`.toLowerCase();
}

function isApplicationTask(task: Task) {
  return /apply|application|interview|cover|submit/i.test(taskText(task));
}

function isDirectionTask(task: Task) {
  return /direction|role|career|inspect|signal|attribute|explore|job family|research/i.test(taskText(task));
}

function hasSteps(task: Task) {
  try {
    const parsed = JSON.parse(task.steps || "[]");
    return Array.isArray(parsed) && parsed.some((s) => s && typeof s.text === "string");
  } catch { return false; }
}

function isVague(task: Task) {
  if (/figure out|research|look into|sort out|work on|jobs|career/i.test(task.title) && !hasSteps(task)) return true;
  return !task.doneWhen && !hasSteps(task);
}

function firstStepFromTask(task: Task) {
  try {
    const parsed = JSON.parse(task.steps || "[]");
    const step = Array.isArray(parsed) ? parsed.find((s) => s && typeof s.text === "string" && !s.done) : null;
    if (step?.text) return String(step.text);
  } catch {}
  if (/role|job|inspect|career|research/i.test(task.title)) return "Open LinkedIn or the saved role.";
  if (/message|person|network|contact/i.test(task.title)) return "Open the contact or message thread.";
  return "Open the task and do the smallest visible first step.";
}

function assessExistingTasks(tasks: Task[], applicationsPremature: boolean) {
  const assessed = activeTasks(tasks).map((task) => {
    let action: ExistingTaskAction = "ignore";
    let reason = "Not clearly connected to today's bottleneck.";
    let score = task.list === "today" ? 2 : 0;

    if (isApplicationTask(task) && applicationsPremature) {
      action = "defer";
      reason = "Applications are premature until direction/proof is clearer.";
      score -= 3;
    } else if (isDirectionTask(task) && isVague(task)) {
      action = "shrink";
      reason = "Aligned with the current need, but too vague to execute as written.";
      score += 4;
    } else if (isDirectionTask(task)) {
      action = "use";
      reason = "This directly supports direction signal today.";
      score += 5;
    } else if (["health", "admin"].includes(task.category)) {
      action = "use";
      reason = "Useful as a stabilising maintenance action, not the strategic move.";
      score += 1;
    }

    return {
      taskId: task.id,
      title: task.title,
      action,
      reason,
      firstStep: firstStepFromTask(task),
      score,
    };
  }).sort((a, b) => b.score - a.score);

  return assessed;
}

export function buildAnchorToday(tasks: Task[], jobs: any[], log: any[]) {
  const goalState = buildCareerGoalState(tasks, jobs, log);
  const exploration = buildExplorationQueue(tasks, jobs, log);
  const applications = goalState.workstreams.find((w) => w.name === "Applications");
  const applicationsPremature = applications?.status === "premature";
  const assessedTasks = assessExistingTasks(tasks, !!applicationsPremature);
  const useExistingTask = assessedTasks.find((t) => t.action === "use" || t.action === "shrink") || null;
  const ignoreForNow = assessedTasks.filter((t) => t.action === "defer" || t.action === "ignore").slice(0, 3);
  const recommendedExploration = exploration.recommended;

  const headline = goalState.recommendedFocus === "Direction"
    ? "Today is for direction signal, not applications."
    : `Today is for ${goalState.recommendedFocus.toLowerCase()} progress.`;

  const bestMove = useExistingTask ? {
    title: useExistingTask.action === "shrink" ? `Shrink and do: ${useExistingTask.title}` : useExistingTask.title,
    firstStep: useExistingTask.firstStep,
    doneWhen: useExistingTask.action === "shrink" ? "One small useful signal exists." : "The task's next visible outcome is complete.",
    stopWhen: "Stop after one useful signal or 20 minutes.",
    source: "existing_task",
    reason: useExistingTask.reason,
  } : {
    title: recommendedExploration?.smallestExperiment.title || goalState.todayPlan.mustDo,
    firstStep: recommendedExploration?.smallestExperiment.firstStep || "Open the relevant app or note.",
    doneWhen: recommendedExploration?.smallestExperiment.doneWhen || "One useful signal exists.",
    stopWhen: recommendedExploration?.smallestExperiment.stopWhen || goalState.todayPlan.stopRule,
    source: "exploration_queue",
    reason: recommendedExploration ? `Most worth exploring: ${recommendedExploration.direction}.` : goalState.reason,
  };

  return {
    headline,
    goal: goalState.goal,
    bottleneck: goalState.recommendedFocus,
    why: goalState.reason,
    bestMove,
    useExistingTask,
    ignoreForNow,
    exploration: {
      recommended: recommendedExploration,
      topExplorations: exploration.topExplorations,
    },
    goalState: {
      dayType: goalState.dayType,
      workstreams: goalState.workstreams,
    },
    trace: [
      "Read goal state, exploration queue, existing tasks, and activity history.",
      `Goal bottleneck is ${goalState.recommendedFocus}.`,
      recommendedExploration ? `Exploration queue recommends ${recommendedExploration.direction}.` : "No exploration recommendation found.",
      useExistingTask ? `Existing task ${useExistingTask.taskId} can be ${useExistingTask.action === "shrink" ? "shrunk" : "used"}.` : "No suitable existing task found, so using exploration fallback.",
      applicationsPremature ? "Application-like tasks are deferred because applications are premature." : "Applications are not marked premature.",
    ],
  };
}

export function registerAnchorTodayRoutes(app: Express) {
  app.get("/api/anchor/today", async (_req, res) => {
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    res.json(buildAnchorToday(tasks, jobs, log));
  });
}
