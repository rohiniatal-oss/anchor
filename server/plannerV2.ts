import type { Express } from "express";
import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { buildCareerGoalState } from "./goalState";

// ─────────────────────────────────────────────────────────────────────────────
// PLANNER V2
// Safe side-by-side planner that starts from goal/workstream state rather than a
// flat task backlog. It does not replace the existing persisted planner yet.
// ─────────────────────────────────────────────────────────────────────────────

type Energy = "low" | "medium" | "high";
type PlanRole = "must_do" | "maintenance" | "optional";

type GoalAwarePlanItem = {
  role: PlanRole;
  title: string;
  workstream: string;
  sourceType: "existing_task" | "goal_state" | "maintenance_task";
  sourceId: number | null;
  firstStep: string;
  doneWhen: string;
  stopWhen: string;
  whySelected: string;
};

function coerceEnergy(raw: unknown): Energy {
  const s = String(raw || "medium");
  return s === "low" || s === "medium" || s === "high" ? s : "medium";
}

function readAvailableMinutes(raw: unknown) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function activeTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && ["today", "this_week", "later"].includes(t.list));
}

function parseFirstStep(task: Task) {
  try {
    const parsed = JSON.parse(task.steps || "[]");
    const first = Array.isArray(parsed) ? parsed.find((s) => s && typeof s.text === "string" && !s.done) : null;
    if (first?.text) return String(first.text);
  } catch {}
  return "Open the task and do the smallest visible first step.";
}

function workstreamKeywords(workstream: string) {
  switch (workstream) {
    case "Direction": return ["direction", "role", "career", "inspect", "signal", "attribute", "job family"];
    case "Market map": return ["role", "job", "market", "compare", "save", "description"];
    case "Network": return ["person", "contact", "message", "network", "alum", "colleague", "reality check"];
    case "Positioning": return ["positioning", "story", "narrative", "cv", "bullet", "pitch"];
    case "Proof": return ["proof", "gap", "evidence", "bullet", "sample", "portfolio"];
    case "Applications": return ["apply", "application", "interview", "cover", "cv", "follow-up"];
    default: return ["admin", "health", "maintenance", "walk", "meal", "sleep"];
  }
}

function scoreTaskForWorkstream(task: Task, workstream: string) {
  const text = `${task.title} ${task.category} ${task.doneWhen} ${task.sourceType} ${task.sourceNote}`.toLowerCase();
  const keywords = workstreamKeywords(workstream);
  let score = keywords.filter((k) => text.includes(k)).length * 3;
  if (task.list === "today") score += 2;
  if (task.pinned) score += 3;
  if (task.readiness === "blocked" || task.blockerReason) score -= 5;
  if ((task.skipped || 0) >= 2) score -= 2;
  if (task.size === "quick") score += 1;
  return score;
}

function bestTaskForWorkstream(tasks: Task[], workstream: string) {
  const scored = activeTasks(tasks)
    .map((task) => ({ task, score: scoreTaskForWorkstream(task, workstream) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.task ?? null;
}

function maintenanceTask(tasks: Task[]) {
  return activeTasks(tasks).find((t) => ["health", "admin"].includes(t.category) && t.size === "quick")
    || activeTasks(tasks).find((t) => ["health", "admin"].includes(t.category))
    || null;
}

function itemFromTask(role: PlanRole, task: Task, workstream: string, why: string): GoalAwarePlanItem {
  return {
    role,
    title: task.title,
    workstream,
    sourceType: role === "maintenance" ? "maintenance_task" : "existing_task",
    sourceId: task.id,
    firstStep: parseFirstStep(task),
    doneWhen: task.doneWhen || "The next visible action is complete",
    stopWhen: task.estimateMinutes && task.estimateMinutes <= 20 ? "Stop when the small action is done." : "Stop after one useful unit of progress.",
    whySelected: why,
  };
}

function itemFromGoal(role: PlanRole, title: string, workstream: string, why: string, stopRule: string): GoalAwarePlanItem {
  return {
    role,
    title,
    workstream,
    sourceType: "goal_state",
    sourceId: null,
    firstStep: title.toLowerCase().includes("inspect") ? "Open LinkedIn or a jobs site." : "Open a blank note and write the first concrete line.",
    doneWhen: "One useful signal or small unit of progress exists",
    stopWhen: stopRule,
    whySelected: why,
  };
}

export function buildGoalAwarePlan(tasks: Task[], goal: ReturnType<typeof buildCareerGoalState>, opts: { energy?: Energy; availableMinutes?: number | null } = {}) {
  const energy = opts.energy || "medium";
  const availableMinutes = opts.availableMinutes ?? null;
  const focus = goal.workstreams.find((w) => w.name === goal.recommendedFocus) || goal.workstreams[0];
  const matchingTask = bestTaskForWorkstream(tasks, focus.name);
  const mustDo = matchingTask
    ? itemFromTask("must_do", matchingTask, focus.name, `This existing task advances the current bottleneck: ${focus.bottleneck}.`)
    : itemFromGoal("must_do", goal.todayPlan.mustDo, focus.name, goal.reason, goal.todayPlan.stopRule);

  const items: GoalAwarePlanItem[] = [mustDo];
  const maint = maintenanceTask(tasks);
  const shouldAddMaintenance = energy !== "low" && (!availableMinutes || availableMinutes >= 45);
  if (shouldAddMaintenance && maint) {
    items.push(itemFromTask("maintenance", maint, "Energy and stability", "A small maintenance action keeps the day from becoming all-or-nothing."));
  }

  const shouldAddOptional = energy === "high" || (!availableMinutes || availableMinutes >= 90);
  if (shouldAddOptional) {
    items.push(itemFromGoal("optional", goal.todayPlan.next, focus.name, "This is the next useful move if the must-do is complete and energy remains.", goal.todayPlan.stopRule));
  }

  return {
    dayType: goal.dayType,
    whyToday: goal.reason,
    recommendedFocus: goal.recommendedFocus,
    items,
    goalState: goal,
    trace: [
      ...goal.trace,
      matchingTask ? `Matched an existing task to ${focus.name}.` : `No good existing task matched ${focus.name}; used goal-state next move.`,
      shouldAddMaintenance && maint ? "Added one maintenance task for stability." : "Skipped maintenance task because of energy/time or no suitable task.",
      shouldAddOptional ? "Added optional next move." : "Kept plan minimal because of energy/time.",
    ],
  };
}

export function registerPlannerV2Routes(app: Express) {
  app.get("/api/plan/v2/current", async (req, res) => {
    const energy = coerceEnergy(req.query.energy);
    const availableMinutes = readAvailableMinutes(req.query.availableMinutes);
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    const goal = buildCareerGoalState(tasks, jobs, log);
    res.json(buildGoalAwarePlan(tasks, goal, { energy, availableMinutes }));
  });
}
