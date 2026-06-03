import type { Express } from "express";
import type { Job, Task } from "@shared/schema";
import { storage } from "./storage";
import { deterministicUnstickStep } from "./planningFeedback";

// ─────────────────────────────────────────────────────────────────────────────
// NEXT USEFUL MOVE
// Core Anchor thesis: do not ask the user to diagnose why they are stuck. Pick
// one small, low-risk move from current context and make it executable.
// ─────────────────────────────────────────────────────────────────────────────

type NextMove = {
  move: string;
  why: string;
  firstStep: string;
  source: "blocked_task" | "avoided_task" | "active_task" | "job_signal" | "job_warm_path" | "career_signal" | "maintenance";
  taskId?: number | null;
  jobId?: number | null;
  canCreateTodayTask: boolean;
};

function activeTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && ["today", "this_week", "later"].includes(t.list));
}

function blockedTaskMove(tasks: Task[]): NextMove | null {
  const task = activeTasks(tasks).find((t) => t.readiness === "blocked" || !!t.blockerReason);
  if (!task) return null;
  const missing = task.blockerReason || task.blockedBy || "the missing input";
  return {
    move: `Get the missing input for: ${task.title}`,
    why: "This is blocked, so the useful move is to remove the blocker, not force the task.",
    firstStep: `Write down or find: ${missing}`,
    source: "blocked_task",
    taskId: task.id,
    canCreateTodayTask: true,
  };
}

function avoidedTaskMove(tasks: Task[]): NextMove | null {
  const task = activeTasks(tasks).find((t) => (t.skipped || 0) >= 2);
  if (!task) return null;
  return {
    move: `Do the five-minute version of: ${task.title}`,
    why: "This has slipped before, so the useful move is to make it smaller rather than try harder.",
    firstStep: deterministicUnstickStep(task),
    source: "avoided_task",
    taskId: task.id,
    canCreateTodayTask: true,
  };
}

function activeTaskMove(tasks: Task[]): NextMove | null {
  const task = activeTasks(tasks).find((t) => t.pinned || t.status === "in_progress") || activeTasks(tasks).find((t) => t.list === "today");
  if (!task) return null;
  return {
    move: task.title,
    why: "You already have a live task. The useful move is to start the next visible step, not re-plan.",
    firstStep: deterministicUnstickStep(task),
    source: "active_task",
    taskId: task.id,
    canCreateTodayTask: false,
  };
}

function interestingRoleMove(jobs: Job[]): NextMove | null {
  const openJobs = jobs.filter((j) => !["closed", "rejected"].includes(j.status || "") && j.applicationWindowStatus !== "closed");
  const highFit = openJobs.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0))[0];
  if (highFit && (highFit.fitScore || 0) >= 70) {
    return {
      move: `Look at one promising role: ${highFit.title}`,
      why: "You do not need certainty yet. You need one signal about whether this direction is attractive or not.",
      firstStep: "Open the role and mark it exciting, neutral, or no.",
      source: "job_signal",
      jobId: highFit.id,
      canCreateTodayTask: true,
    };
  }
  return null;
}

function warmPathMove(jobs: Job[]): NextMove | null {
  const job = jobs
    .filter((j) => !["closed", "rejected"].includes(j.status || ""))
    .sort((a, b) => (b.warmPathScore || 0) - (a.warmPathScore || 0))[0];
  if (!job || (job.warmPathScore || 0) < 60) return null;
  return {
    move: `Send one warm-path message for: ${job.title}`,
    why: "A warm signal is more useful than more private overthinking.",
    firstStep: "Write the first line of the message only.",
    source: "job_warm_path",
    jobId: job.id,
    canCreateTodayTask: true,
  };
}

function careerSignalMove(jobs: Job[]): NextMove {
  if (jobs.length === 0) {
    return {
      move: "Save one role that looks even 30% interesting",
      why: "You do not need to choose a career today. You need one signal.",
      firstStep: "Open LinkedIn or a jobs site.",
      source: "career_signal",
      canCreateTodayTask: true,
    };
  }
  return {
    move: "Look at one saved role and mark it exciting, neutral, or no",
    why: "The goal is not to decide your whole career. It is to collect one piece of signal.",
    firstStep: "Open the first saved role.",
    source: "career_signal",
    canCreateTodayTask: true,
  };
}

export function chooseNextMove(tasks: Task[], jobs: Job[]): NextMove {
  return blockedTaskMove(tasks)
    || avoidedTaskMove(tasks)
    || activeTaskMove(tasks)
    || interestingRoleMove(jobs)
    || warmPathMove(jobs)
    || careerSignalMove(jobs);
}

export function registerNextMoveRoutes(app: Express) {
  app.get("/api/next-move", async (_req, res) => {
    const [tasks, jobs] = await Promise.all([storage.getTasks(), storage.getJobs()]);
    res.json(chooseNextMove(tasks, jobs));
  });

  app.post("/api/next-move/create-task", async (_req, res) => {
    const [tasks, jobs] = await Promise.all([storage.getTasks(), storage.getJobs()]);
    const move = chooseNextMove(tasks, jobs);
    if (!move.canCreateTodayTask) return res.json({ move, task: null });
    const task = await storage.createTask({
      title: move.move,
      list: "today",
      done: false,
      category: move.source.startsWith("job") || move.source === "career_signal" ? "job" : "admin",
      size: "quick",
      estimateMinutes: 15,
      estimateConfidence: "low",
      estimateReason: "next_move_default",
      doneWhen: "The small move is complete",
      steps: JSON.stringify([{ text: move.firstStep, done: false, estimateMinutes: 5 }]),
      status: "not_started",
      sourceType: move.source,
      sourceId: move.jobId || move.taskId || null,
      taskId: move.taskId || undefined,
    } as any);
    await storage.logActivity({
      eventType: "next_move_created",
      sourceType: move.source,
      sourceId: move.jobId || move.taskId || undefined,
      taskId: task.id,
      metadata: JSON.stringify(move),
    } as any);
    res.json({ move, task });
  });
}
