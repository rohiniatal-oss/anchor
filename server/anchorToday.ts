import type { Express } from "express";
import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { buildTrackSpine } from "./trackSpine";

// Anchor Today is the front door. It must read the same reason graph as the
// sequencer: the Tracks x Lanes spine. GoalState remains useful as a legacy
// rollup, but it should not be the daily planning source of truth.

type ExistingTaskAction = "use" | "shrink" | "defer" | "ignore";

function activeTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && ["today", "this_week", "later", "inbox"].includes(t.list));
}

function taskText(task: Task) {
  return `${task.title} ${task.category} ${task.doneWhen} ${task.sourceType} ${task.sourceNote} ${task.blockerReason}`.toLowerCase();
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
  if (/cv|cover|application/i.test(task.title)) return "Open the role and application material.";
  return "Open the task and do the smallest visible first step.";
}

function taskMatchesSpineMove(task: Task, title: string, lane: string) {
  const text = taskText(task);
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
  const overlap = words.filter((w) => text.includes(w)).length;
  if (overlap >= 2) return true;
  if (lane === "Applications" && /apply|application|cv|cover|interview|submit|tailor|requirements/i.test(text)) return true;
  if (lane === "Network" && /network|contact|message|intro|referral|coffee|person/i.test(text)) return true;
  if (lane === "Learning and development" && /learn|resource|course|practice|drill|skill|development|study/i.test(text)) return true;
  if (lane === "Proof assets" && /proof|memo|story|bullet|portfolio|case|evidence/i.test(text)) return true;
  if (lane === "Direction" && /direction|role|inspect|signal|market|requirements|track/i.test(text) && !/apply|submit/i.test(text)) return true;
  return false;
}

function assessExistingTasks(tasks: Task[], bestMove: { title: string; lane: string }) {
  return activeTasks(tasks).map((task) => {
    let action: ExistingTaskAction = "ignore";
    let reason = "Not clearly connected to the current track move.";
    let score = task.list === "today" ? 2 : 0;
    const matches = taskMatchesSpineMove(task, bestMove.title, bestMove.lane);
    const blocked = task.readiness === "blocked" || !!task.blockerReason;

    if (blocked && matches) {
      action = "shrink";
      reason = "This matches the spine move but is blocked, so reduce it to the unblock step.";
      score += 3;
    } else if (matches && isVague(task)) {
      action = "shrink";
      reason = "This matches the spine move, but needs a clearer first step or done condition.";
      score += 4;
    } else if (matches) {
      action = "use";
      reason = "This matches the current Tracks x Lanes spine move.";
      score += 6;
    } else if (["health", "admin"].includes(task.category)) {
      action = "use";
      reason = "Useful as a stabilising maintenance action, not the strategic move.";
      score += 1;
    }

    return { taskId: task.id, title: task.title, action, reason, firstStep: firstStepFromTask(task), score };
  }).sort((a, b) => b.score - a.score);
}

export function buildAnchorToday(input: { tasks: Task[]; jobs: any[]; learn: any[]; hustles: any[]; contacts: any[]; tracks: any[] }) {
  const spine = buildTrackSpine(input);
  const assessedTasks = assessExistingTasks(input.tasks, { title: spine.bestMove.title, lane: spine.bestMove.lane });
  const useExistingTask = assessedTasks.find((t) => t.action === "use" || t.action === "shrink") || null;
  const ignoreForNow = assessedTasks.filter((t) => t.action === "defer" || t.action === "ignore").slice(0, 3);

  const headline = spine.activeTrack
    ? `${spine.activeTrack.name} is the active track; ${spine.bestMove.lane.toLowerCase()} is the next move.`
    : `${spine.bestMove.lane} is the next useful move.`;

  const bestMove = useExistingTask ? {
    title: useExistingTask.action === "shrink" ? `Shrink and do: ${useExistingTask.title}` : useExistingTask.title,
    firstStep: useExistingTask.firstStep,
    doneWhen: useExistingTask.action === "shrink" ? "One smaller useful output exists." : "The task's next visible outcome is complete.",
    stopWhen: spine.bestMove.stopWhen,
    source: "existing_task",
    reason: useExistingTask.reason,
  } : {
    title: spine.bestMove.title,
    firstStep: spine.bestMove.firstStep,
    doneWhen: spine.bestMove.doneWhen,
    stopWhen: spine.bestMove.stopWhen,
    source: spine.bestMove.source,
    reason: spine.bestMove.reason,
  };

  return {
    headline,
    goal: spine.goal,
    bottleneck: spine.bestMove.lane,
    why: spine.bestMove.reason,
    bestMove,
    useExistingTask,
    ignoreForNow,
    spine: {
      activeTrack: spine.activeTrack,
      tracks: spine.tracks,
      globalLanes: spine.globalLanes,
      marketabilityMode: spine.marketability.mode,
      marketabilityWeeklyMix: spine.marketability.weeklyMix,
    },
    trace: [
      ...spine.trace,
      useExistingTask ? `Existing task ${useExistingTask.taskId} can be ${useExistingTask.action === "shrink" ? "shrunk" : "used"}.` : "No existing task matched the spine move, so using spine bestMove.",
    ],
  };
}

export function registerAnchorTodayRoutes(app: Express) {
  app.get("/api/anchor/today", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(), storage.getCareerTracks(),
    ]);
    res.json(buildAnchorToday({ tasks, jobs, learn, hustles, contacts, tracks }));
  });
}
