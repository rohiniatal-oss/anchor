import type { Express } from "express";
import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { buildCareerGoalState } from "./goalState";

// ─────────────────────────────────────────────────────────────────────────────
// GOAL ↔ TASK RECONCILIATION
// Bridge top-down goal/workstream needs with bottom-up existing tasks. Anchor
// should not blindly create new tasks when a relevant task exists, nor blindly
// use backlog tasks that are premature, vague, blocked, or misaligned.
// ─────────────────────────────────────────────────────────────────────────────

type TaskAssessment = "aligned_ready" | "aligned_but_vague" | "blocked" | "too_large" | "premature" | "misaligned" | "maintenance";
type ReconciliationAction = "use" | "refine" | "unblock" | "shrink" | "defer" | "park";

type ReconciledTask = {
  taskId: number;
  title: string;
  workstream: string | null;
  assessment: TaskAssessment;
  action: ReconciliationAction;
  reason: string;
  firstStep: string;
  score: number;
};

function activeTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && ["today", "this_week", "later"].includes(t.list));
}

function textFor(task: Task) {
  return `${task.title} ${task.category} ${task.doneWhen} ${task.sourceType} ${task.sourceNote} ${task.blockerReason}`.toLowerCase();
}

function keywordsFor(workstream: string) {
  switch (workstream) {
    case "Direction": return ["direction", "role", "career", "inspect", "signal", "attribute", "job family", "explore"];
    case "Market map": return ["role", "job", "market", "compare", "save", "description", "jd"];
    case "Network": return ["person", "contact", "message", "network", "alum", "colleague", "reality check", "intro"];
    case "Positioning": return ["positioning", "story", "narrative", "cv", "bullet", "pitch", "profile"];
    case "Proof": return ["proof", "gap", "evidence", "bullet", "sample", "portfolio", "requirement"];
    case "Applications": return ["apply", "application", "interview", "cover", "cv", "follow-up", "submit"];
    case "Energy and stability": return ["health", "admin", "walk", "meal", "sleep", "gym", "pay", "book"];
    default: return [];
  }
}

function taskMatchesWorkstream(task: Task, workstream: string) {
  const text = textFor(task);
  return keywordsFor(workstream).filter((k) => text.includes(k)).length;
}

function hasSteps(task: Task) {
  try {
    const parsed = JSON.parse(task.steps || "[]");
    return Array.isArray(parsed) && parsed.some((s) => s && typeof s.text === "string");
  } catch { return false; }
}

function firstStep(task: Task) {
  try {
    const parsed = JSON.parse(task.steps || "[]");
    const step = Array.isArray(parsed) ? parsed.find((s) => s && typeof s.text === "string" && !s.done) : null;
    if (step?.text) return String(step.text);
  } catch {}
  if (/message|email|contact|person|network/i.test(task.title)) return "Open the person or message thread.";
  if (/role|job|inspect|career/i.test(task.title)) return "Open LinkedIn or the saved role.";
  if (/cv|bullet|story|proof|gap/i.test(task.title)) return "Open the role or CV section you are working from.";
  return "Open the task and do the smallest visible first step.";
}

function isVague(task: Task) {
  const title = task.title.trim();
  if (title.split(/\s+/).length <= 2) return true;
  if (/figure out|research|look into|sort out|work on|jobs|career|networking/i.test(title) && !hasSteps(task)) return true;
  return !task.doneWhen && !hasSteps(task);
}

function isApplicationLike(task: Task) {
  return /apply|application|cover|interview|submit/i.test(textFor(task));
}

function inferBestWorkstream(task: Task, workstreams: Array<{ name: string }>) {
  const scored = workstreams.map((w) => ({ name: w.name, score: taskMatchesWorkstream(task, w.name) })).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0] : null;
}

export function reconcileGoalAndTasks(tasks: Task[], goal: ReturnType<typeof buildCareerGoalState>) {
  const focus = goal.workstreams.find((w) => w.name === goal.recommendedFocus) || goal.workstreams[0];
  const applications = goal.workstreams.find((w) => w.name === "Applications");
  const assessed: ReconciledTask[] = activeTasks(tasks).map((task) => {
    const best = inferBestWorkstream(task, goal.workstreams);
    const focusedScore = taskMatchesWorkstream(task, focus.name);
    const blocked = task.readiness === "blocked" || !!task.blockerReason;
    const vague = isVague(task);
    const tooLarge = task.size === "deep" && !hasSteps(task);
    // An application task should be deferred while the direction/proof gates are
    // still incomplete. The gate signal is nextMoveType === "wait"; checking status
    // alone is unreliable because the task being assessed flips Applications to
    // "active" via hasApplicationTask in goalState.
    const prematureApplication =
      isApplicationLike(task) &&
      (applications?.status === "premature" || applications?.nextMoveType === "wait");
    const maintenance = ["health", "admin"].includes(task.category) || best?.name === "Energy and stability";

    let assessment: TaskAssessment = "misaligned";
    let action: ReconciliationAction = "park";
    let reason = "This does not clearly advance the current goal bottleneck.";
    let score = focusedScore * 4 + (task.list === "today" ? 2 : 0) + (task.pinned ? 3 : 0);

    if (blocked) {
      assessment = "blocked";
      action = "unblock";
      reason = "This may matter, but it is blocked. The useful move is to remove the blocker first.";
      score -= 3;
    } else if (prematureApplication) {
      assessment = "premature";
      action = "defer";
      reason = "Applications are premature because direction/proof gates are not ready enough.";
      score -= 4;
    } else if (focusedScore > 0 && tooLarge) {
      assessment = "too_large";
      action = "shrink";
      reason = `This matches ${focus.name}, but it is too large without steps.`;
      score += 1;
    } else if (focusedScore > 0 && vague) {
      assessment = "aligned_but_vague";
      action = "refine";
      reason = `This matches ${focus.name}, but needs a clearer done condition or first step.`;
      score += 2;
    } else if (focusedScore > 0) {
      assessment = "aligned_ready";
      action = "use";
      reason = `This directly advances the current bottleneck: ${focus.bottleneck}.`;
      score += 5;
    } else if (maintenance) {
      assessment = "maintenance";
      action = "use";
      reason = "This does not solve the strategic bottleneck, but it may stabilise the day.";
      score += 1;
    } else if (best && best.score > 0) {
      assessment = "misaligned";
      action = "defer";
      reason = `This relates to ${best.name}, but today is focused on ${focus.name}.`;
      score += best.score;
    }

    if ((task.skipped || 0) >= 2 && action === "use") {
      assessment = "aligned_but_vague";
      action = "shrink";
      reason = "This has been skipped repeatedly, so it should be made smaller before being used.";
      score -= 1;
    }

    return {
      taskId: task.id,
      title: task.title,
      workstream: best?.name || null,
      assessment,
      action,
      reason,
      firstStep: firstStep(task),
      score,
    };
  }).sort((a, b) => b.score - a.score);

  const usable = assessed.find((t) => ["use", "refine", "shrink", "unblock"].includes(t.action) && t.assessment !== "maintenance");
  const recommendedTaskSource = usable ? `${usable.action}_existing_task` : "generate_from_goal_state";

  return {
    goal: goal.goal,
    recommendedFocus: focus.name,
    bottleneck: focus.bottleneck,
    recommendedTaskSource,
    taskAssessments: assessed,
    recommendedTask: usable || null,
    fallbackMove: usable ? null : {
      title: goal.todayPlan.mustDo,
      workstream: focus.name,
      reason: goal.reason,
      firstStep: goal.todayPlan.mustDo.toLowerCase().includes("inspect") ? "Open LinkedIn or a jobs site." : "Open a blank note and write the first concrete line.",
      stopWhen: goal.todayPlan.stopRule,
    },
    trace: [
      `Goal focus is ${focus.name}.`,
      `Bottleneck is ${focus.bottleneck}.`,
      usable ? `Selected existing task ${usable.taskId} with action ${usable.action}.` : "No existing task was good enough; use goal-state fallback.",
    ],
  };
}

export function registerGoalTaskReconciliationRoutes(app: Express) {
  app.get("/api/goals/reconcile-tasks", async (_req, res) => {
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    const goal = buildCareerGoalState(tasks, jobs, log);
    res.json(reconcileGoalAndTasks(tasks, goal));
  });
}
