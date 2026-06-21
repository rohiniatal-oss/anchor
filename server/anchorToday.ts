import type { Express } from "express";
import type { Task } from "@shared/schema";
import { LANE_NAME, laneFocusAreaLabel, type CanonicalLaneName } from "./lanes";
import { storage } from "./storage";
import { buildTrackSpine } from "./trackSpine";
import { createNextTask } from "./nextTask";

// Anchor Today is the front door. It must read the same reason graph as the
// sequencer: the Tracks x Lanes spine. GoalState remains useful as a legacy
// rollup, but it should not be the daily planning source of truth.

type ExistingTaskAction = "use" | "shrink" | "ignore";

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

function focusAreaLabel(lane: CanonicalLaneName) {
  return laneFocusAreaLabel(lane, { proofLabel: "writing, projects, and brand" });
}

function taskMatchesSpineMove(task: Task, title: string, lane: CanonicalLaneName) {
  const text = taskText(task);
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
  const overlap = words.filter((w) => text.includes(w)).length;
  if (overlap >= 2) return true;
  if (lane === LANE_NAME.APPLICATIONS && /apply|application|cv|cover|interview|submit|tailor|requirements/i.test(text)) return true;
  if (lane === LANE_NAME.NETWORK && /network|contact|message|intro|referral|coffee|person/i.test(text)) return true;
  if (lane === LANE_NAME.LEARNING_DEVELOPMENT && /learn|resource|course|practice|drill|skill|development|study/i.test(text)) return true;
  if (lane === LANE_NAME.PROOF_ASSETS && /proof|memo|story|bullet|portfolio|case|evidence/i.test(text)) return true;
  if (lane === LANE_NAME.DIRECTION && /direction|role|inspect|signal|market|requirements|track/i.test(text) && !/apply|submit/i.test(text)) return true;
  return false;
}

function assessExistingTasks(tasks: Task[], bestMove: { title: string; lane: CanonicalLaneName }) {
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
      reason = "This already lines up with the best next move right now.";
      score += 6;
    } else if (["health", "admin"].includes(task.category)) {
      action = "use";
      reason = "Useful as a stabilising maintenance action, not the strategic move.";
      score += 1;
    }

    return { taskId: task.id, title: task.title, action, reason, firstStep: firstStepFromTask(task), score };
  }).sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROACTIVE TASK SURFACE
//
// Scans live data for urgent signals and auto-creates tasks (via the existing
// dedup-safe createNextTask machinery) so the user never has to visit the Jobs
// or Network tabs to find out something needs attention.
//
// Signals checked:
//   1. Jobs with a deadline within DEADLINE_HORIZON_DAYS (5 days), status not
//      archived or rejected.
//   2. Contacts with nextFollowUpDate in the past, status warm or active.
//   3. Learn items linked (via relatedJobId) to a job that triggered signal 1.
//
// createNextTask is idempotent — calling this on every /api/anchor/today
// request never creates duplicates.
// ─────────────────────────────────────────────────────────────────────────────

const DEADLINE_HORIZON_DAYS = 5;
const IGNORED_JOB_STATUSES = new Set(["archived", "rejected", "withdrawn", "offer_declined"]);

export type ProactiveSuggestion = {
  signal: "deadline_job" | "overdue_contact" | "learn_for_deadline_job";
  sourceType: "job" | "contact" | "learn";
  sourceId: number;
  label: string;
  urgency: "high" | "medium";
  taskCreated: boolean;
  taskReused: boolean;
  taskId: number | null;
};

export async function deriveProactiveSuggestions(
  jobs: any[],
  contacts: any[],
  learn: any[]
): Promise<ProactiveSuggestion[]> {
  const nowMs = Date.now();
  const horizonMs = DEADLINE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const suggestions: ProactiveSuggestion[] = [];

  // ── Signal 1: Jobs with imminent deadlines ──────────────────────────────
  const deadlineJobIds = new Set<number>();

  for (const job of jobs) {
    if (IGNORED_JOB_STATUSES.has(job.status)) continue;
    if (!job.deadline) continue;

    const deadlineMs = typeof job.deadline === "number" ? job.deadline : new Date(job.deadline).getTime();
    if (isNaN(deadlineMs)) continue;

    const daysLeft = (deadlineMs - nowMs) / (24 * 60 * 60 * 1000);
    if (daysLeft < 0 || daysLeft > DEADLINE_HORIZON_DAYS) continue;

    deadlineJobIds.add(job.id);
    const daysLabel = daysLeft < 1 ? "today" : `in ${Math.ceil(daysLeft)}d`;
    const result = await createNextTask({ sourceType: "job", sourceId: job.id });
    suggestions.push({
      signal: "deadline_job",
      sourceType: "job",
      sourceId: job.id,
      label: `${job.title ?? "Role"} deadline ${daysLabel}`,
      urgency: daysLeft <= 1 ? "high" : "medium",
      taskCreated: result !== null && !result.reused,
      taskReused: result !== null && result.reused,
      taskId: result?.task.id ?? null,
    });
  }

  // ── Signal 2: Overdue contact follow-ups ───────────────────────────────
  for (const contact of contacts) {
    if (!contact.nextFollowUpDate) continue;
    const followUpMs = typeof contact.nextFollowUpDate === "number"
      ? contact.nextFollowUpDate
      : new Date(contact.nextFollowUpDate).getTime();
    if (isNaN(followUpMs)) continue;
    if (followUpMs > nowMs) continue; // future — not overdue yet

    const status = (contact.status ?? "").toLowerCase();
    if (status === "cold" || status === "archived") continue;

    const daysOverdue = Math.floor((nowMs - followUpMs) / (24 * 60 * 60 * 1000));
    const result = await createNextTask({ sourceType: "contact", sourceId: contact.id });
    suggestions.push({
      signal: "overdue_contact",
      sourceType: "contact",
      sourceId: contact.id,
      label: `Follow up with ${contact.name ?? "contact"} (${daysOverdue}d overdue)`,
      urgency: daysOverdue >= 7 ? "high" : "medium",
      taskCreated: result !== null && !result.reused,
      taskReused: result !== null && result.reused,
      taskId: result?.task.id ?? null,
    });
  }

  // ── Signal 3: Learn items linked to a deadline job ──────────────────────
  for (const item of learn) {
    // relatedJobId links a learn item to a specific job it unblocks
    const linkedJobId = item.relatedJobId ?? null;
    if (!linkedJobId || !deadlineJobIds.has(linkedJobId)) continue;
    if (item.learnStatus === "done" || item.learnStatus === "archived") continue;

    const result = await createNextTask({ sourceType: "learn", sourceId: item.id });
    suggestions.push({
      signal: "learn_for_deadline_job",
      sourceType: "learn",
      sourceId: item.id,
      label: `${item.title ?? "Learning item"} needed for deadline role`,
      urgency: "medium",
      taskCreated: result !== null && !result.reused,
      taskReused: result !== null && result.reused,
      taskId: result?.task.id ?? null,
    });
  }

  // Sort: high urgency first, then deadline_job > overdue_contact > learn
  const signalOrder = { deadline_job: 0, overdue_contact: 1, learn_for_deadline_job: 2 };
  suggestions.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "high" ? -1 : 1;
    return signalOrder[a.signal] - signalOrder[b.signal];
  });

  return suggestions;
}

export function buildAnchorToday(input: { tasks: Task[]; jobs: any[]; learn: any[]; hustles: any[]; contacts: any[]; tracks: any[] }) {
  const spine = buildTrackSpine(input);
  const assessedTasks = assessExistingTasks(input.tasks, { title: spine.bestMove.title, lane: spine.bestMove.lane });
  const useExistingTask = assessedTasks.find((t) => t.action === "use" || t.action === "shrink") || null;
  const ignoreForNow = assessedTasks.filter((t) => t.action === "ignore").slice(0, 3);
  const focusArea = focusAreaLabel(spine.bestMove.lane);

  const headline = spine.activeTrack
    ? `${spine.activeTrack.name} is the main path right now. Next, focus on ${focusArea}.`
    : `Next, focus on ${focusArea}.`;

  const bestMove = useExistingTask ? {
    title: useExistingTask.action === "shrink" ? `Shrink and do: ${useExistingTask.title}` : useExistingTask.title,
    firstStep: useExistingTask.firstStep,
    doneWhen: useExistingTask.action === "shrink" ? "One smaller useful step is complete." : "The task's next visible outcome is complete.",
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
    activeTrack: spine.activeTrack,
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

    // Proactive pass: auto-create tasks for urgent signals before building the
    // today surface. This is fire-and-await so the suggestions are ready to
    // include in the same response without a second round-trip.
    const proactiveSuggestions = await deriveProactiveSuggestions(jobs, contacts, learn);

    const today = buildAnchorToday({ tasks, jobs, learn, hustles, contacts, tracks });
    res.json({ ...today, proactiveSuggestions });
  });
}
