import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { completionContractForTask, type CompletionContract } from "@shared/completionContracts";
import { buildAnchorToday, assessExistingTasks } from "./anchorToday";
import { buildTrackSpine } from "./trackSpine";
import { storage } from "./storage";

export type BrainSignal = {
  kind: "deadline" | "overdue_contact" | "blocked_task" | "stale_today" | "active_track" | "existing_task";
  label: string;
  weight: number;
  sourceType: string;
  sourceId?: number;
};

export type BrainCandidate = {
  id: string;
  title: string;
  source: "existing_task" | "track_spine" | "marketability" | "fallback" | "maintenance";
  sourceId?: number;
  trackId?: number;
  lane: string;
  score: number;
  confidence: "low" | "medium" | "high";
  firstStep: string;
  doneWhen: string;
  reason: string;
  completionContract: CompletionContract | null;
  tradeoffs: string[];
};

export type AnchorBrainDecision = {
  readOnly: true;
  generatedAt: number;
  question: "what_should_i_do_next";
  recommendation: BrainCandidate;
  alternatives: BrainCandidate[];
  whyThis: string[];
  whyNotOthers: string[];
  assumptions: string[];
  couldChangeIf: string[];
  signals: BrainSignal[];
  trace: string[];
};

export type AnchorBrainInput = {
  tasks: Task[];
  jobs: Job[];
  learn: Learn[];
  hustles: Hustle[];
  contacts: Contact[];
  tracks: CareerTrack[];
};

const DEADLINE_HORIZON_DAYS = 5;
const EXISTING_TASK_EXECUTION_BONUS = 6;
const EXACT_REUSE_BONUS = 8;

function compact(value: unknown, max = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function normalized(value: unknown) {
  return compact(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function activeTasks(tasks: Task[]) {
  return tasks.filter((task) => !task.done && ["today", "this_week", "later", "inbox"].includes(task.list));
}

function taskFirstStep(task: Task) {
  try {
    const parsed = JSON.parse(task.steps || "[]");
    const step = Array.isArray(parsed) ? parsed.find((item) => item && typeof item.text === "string" && !item.done) : null;
    if (step?.text) return compact(step.text, 240);
  } catch {}
  return task.doneWhen || task.minimumOutcome || `Open ${task.title} and do the smallest concrete step.`;
}

function materiallyMatchesMove(task: Task, move: { title: string; lane: string; trackId?: number }) {
  const taskText = normalized([task.title, task.category, task.doneWhen, task.minimumOutcome].join(" "));
  const moveTitle = normalized(move.title);
  if (!taskText || !moveTitle) return false;
  if (taskText === moveTitle || taskText.includes(moveTitle) || moveTitle.includes(taskText)) return true;
  if (move.trackId && task.relatedTrackId === move.trackId && task.list === "today" && task.readiness !== "blocked") return true;
  if (move.trackId && task.relatedTrackId === move.trackId && task.category === move.lane) return true;

  const moveWords = moveTitle.split(" ").filter((word) => word.length > 4);
  const overlap = moveWords.filter((word) => taskText.includes(word)).length;
  return overlap >= Math.min(3, Math.max(2, moveWords.length));
}

function urgencySignals(input: AnchorBrainInput): BrainSignal[] {
  const nowMs = Date.now();
  const horizonMs = DEADLINE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const signals: BrainSignal[] = [];

  for (const job of input.jobs) {
    if (["archived", "rejected", "withdrawn", "offer_declined"].includes(job.status || "")) continue;
    if (!job.deadline) continue;
    const deadlineMs = typeof job.deadline === "number" ? job.deadline : new Date(job.deadline).getTime();
    if (!Number.isFinite(deadlineMs)) continue;
    const msLeft = deadlineMs - nowMs;
    if (msLeft < 0 || msLeft > horizonMs) continue;
    const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    signals.push({
      kind: "deadline",
      label: `${job.title || "Role"} deadline ${daysLeft <= 1 ? "today" : `in ${daysLeft}d`}`,
      weight: daysLeft <= 1 ? 10 : 7,
      sourceType: "job",
      sourceId: job.id,
    });
  }

  for (const contact of input.contacts) {
    if (!contact.nextFollowUpDate) continue;
    const followUpMs = typeof contact.nextFollowUpDate === "number" ? contact.nextFollowUpDate : new Date(contact.nextFollowUpDate).getTime();
    if (!Number.isFinite(followUpMs) || followUpMs > nowMs) continue;
    if (["cold", "archived"].includes(contact.status || "")) continue;
    const daysOverdue = Math.floor((nowMs - followUpMs) / (24 * 60 * 60 * 1000));
    signals.push({
      kind: "overdue_contact",
      label: `Follow up with ${contact.name || contact.who || "contact"} (${daysOverdue}d overdue)`,
      weight: daysOverdue >= 7 ? 6 : 4,
      sourceType: "contact",
      sourceId: contact.id,
    });
  }

  for (const task of activeTasks(input.tasks)) {
    if (task.readiness === "blocked" || task.blockerReason) {
      signals.push({
        kind: "blocked_task",
        label: `${task.title} is blocked`,
        weight: 3,
        sourceType: "task",
        sourceId: task.id,
      });
    } else if (task.list === "today" && !task.pinned) {
      signals.push({
        kind: "stale_today",
        label: `${task.title} is already in Today`,
        weight: 2,
        sourceType: "task",
        sourceId: task.id,
      });
    }
  }

  const activeTrack = input.tracks.find((track) => track.status === "active");
  if (activeTrack) {
    signals.push({
      kind: "active_track",
      label: `${activeTrack.name} is the active career direction`,
      weight: 5,
      sourceType: "career_track",
      sourceId: activeTrack.id,
    });
  }

  return signals.sort((a, b) => b.weight - a.weight);
}

function confidenceFor(score: number, signals: BrainSignal[], hasExistingTask: boolean): BrainCandidate["confidence"] {
  if (score >= 14 || (hasExistingTask && signals.some((signal) => signal.weight >= 7))) return "high";
  if (score >= 8 || hasExistingTask || signals.length >= 2) return "medium";
  return "low";
}

function taskCandidate(task: Task, score: number, reason: string, firstStep: string): BrainCandidate {
  const contract = completionContractForTask(task);
  return {
    id: `task:${task.id}`,
    title: task.title,
    source: task.category === "admin" || task.category === "health" ? "maintenance" : "existing_task",
    sourceId: task.id,
    trackId: task.relatedTrackId ?? undefined,
    lane: task.category || "task",
    score,
    confidence: confidenceFor(score, [], true),
    firstStep,
    doneWhen: task.doneWhen || task.minimumOutcome || contract.completionPrompt,
    reason,
    completionContract: contract,
    tradeoffs: task.category === "health" || task.category === "admin"
      ? ["Stabilising action, but may not move the strategic career path directly."]
      : ["Uses an existing task, but may be less strategic than the spine move if it is stale."],
  };
}

function spineCandidate(input: AnchorBrainInput): BrainCandidate {
  const spine = buildTrackSpine(input);
  const pseudoTask = {
    title: spine.bestMove.title,
    category: spine.bestMove.lane,
    sourceType: spine.bestMove.source,
    sourceStepType: "brain_best_move",
    sourceNote: "",
    doneWhen: spine.bestMove.doneWhen,
    minimumOutcome: spine.bestMove.doneWhen,
    steps: "[]",
  } as Pick<Task, "title" | "category" | "sourceType" | "sourceStepType" | "sourceNote" | "doneWhen" | "minimumOutcome" | "steps">;
  const contract = completionContractForTask(pseudoTask as Task);
  const activeTrackBoost = spine.activeTrack ? 5 : 0;
  return {
    id: `spine:${spine.bestMove.source}:${spine.bestMove.trackId || "global"}`,
    title: spine.bestMove.title,
    source: spine.bestMove.source,
    trackId: spine.bestMove.trackId,
    lane: spine.bestMove.lane,
    score: 8 + activeTrackBoost,
    confidence: spine.activeTrack ? "high" : "medium",
    firstStep: spine.bestMove.firstStep,
    doneWhen: spine.bestMove.doneWhen,
    reason: spine.bestMove.reason,
    completionContract: contract,
    tradeoffs: ["Most strategically aligned move, but may require creating or shrinking a task before execution."],
  };
}

function buildCandidates(input: AnchorBrainInput, signals: BrainSignal[]): BrainCandidate[] {
  const spine = buildTrackSpine(input);
  const assessed = assessExistingTasks(input.tasks, { title: spine.bestMove.title, lane: spine.bestMove.lane });
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const spineMove = spineCandidate(input);
  const existing = assessed
    .filter((item) => item.action === "use" || item.action === "shrink")
    .slice(0, 5)
    .map((item) => {
      const task = taskById.get(item.taskId);
      if (!task) return null;
      const signalBoost = signals.filter((signal) => signal.sourceType === "task" && signal.sourceId === task.id).reduce((sum, signal) => sum + signal.weight, 0);
      const reuseBoost = materiallyMatchesMove(task, spine.bestMove) ? EXACT_REUSE_BONUS : 0;
      const reason = reuseBoost
        ? `${item.reason} Reusing the existing task avoids creating a duplicate abstract recommendation.`
        : item.reason;
      return taskCandidate(task, item.score + EXISTING_TASK_EXECUTION_BONUS + signalBoost + reuseBoost, reason, item.firstStep);
    })
    .filter((item): item is BrainCandidate => Boolean(item));

  const existingIds = new Set(existing.map((candidate) => candidate.sourceId));
  const directReuse = activeTasks(input.tasks)
    .filter((task) => !existingIds.has(task.id) && materiallyMatchesMove(task, spine.bestMove))
    .slice(0, 3)
    .map((task) => taskCandidate(
      task,
      spineMove.score + EXACT_REUSE_BONUS,
      "This existing task materially matches the strategic spine move, so reusing it avoids duplicate planning.",
      taskFirstStep(task),
    ));

  const urgentTaskIds = new Set(signals.filter((signal) => signal.sourceType === "task").map((signal) => signal.sourceId));
  const urgentExisting = activeTasks(input.tasks)
    .filter((task) => urgentTaskIds.has(task.id) && !existing.some((candidate) => candidate.sourceId === task.id) && !directReuse.some((candidate) => candidate.sourceId === task.id))
    .slice(0, 3)
    .map((task) => taskCandidate(task, 6, "Urgent existing work is visible in the current system state.", task.doneWhen || "Do the smallest unblock step."));

  return [...existing, ...directReuse, spineMove, ...urgentExisting]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 6);
}

function whyThis(recommendation: BrainCandidate, signals: BrainSignal[]) {
  const strongest = signals.slice(0, 3).map((signal) => signal.label);
  return [
    recommendation.reason,
    `It scores highest among current executable and strategic moves with ${recommendation.confidence} confidence.`,
    ...strongest.map((signal) => `Relevant signal: ${signal}.`),
  ];
}

function assumptions(input: AnchorBrainInput) {
  return [
    "The active career direction should dominate unless an urgent deadline or stabilising task overrides it.",
    "Existing tasks are preferred when they already match the strategic move because they reduce startup cost.",
    "Blocked or vague tasks should be shrunk before execution, not ignored or treated as ready.",
    input.tasks.some((task) => task.pinned && !task.done)
      ? "A pinned task is assumed to represent current user intent unless it conflicts with stronger signals."
      : "No pinned task is currently treated as an explicit current intent signal.",
  ];
}

function couldChangeIf(input: AnchorBrainInput) {
  return [
    "A job deadline moves inside the next five days.",
    "A contact follow-up becomes overdue or receives a reply.",
    "The user pins a different task or marks the current task done.",
    input.tracks.length ? "The active career direction changes priority or status." : "A career direction becomes active.",
  ];
}

export function buildAnchorBrainDecision(input: AnchorBrainInput): AnchorBrainDecision {
  const signals = urgencySignals(input);
  const candidates = buildCandidates(input, signals);
  const recommendation = candidates[0] || spineCandidate(input);
  const alternatives = candidates.filter((candidate) => candidate.id !== recommendation.id).slice(0, 3);
  const today = buildAnchorToday(input);

  return {
    readOnly: true,
    generatedAt: Date.now(),
    question: "what_should_i_do_next",
    recommendation,
    alternatives,
    whyThis: whyThis(recommendation, signals),
    whyNotOthers: alternatives.map((candidate) => `${candidate.title}: ${candidate.tradeoffs[0] || "Lower score right now."}`),
    assumptions: assumptions(input),
    couldChangeIf: couldChangeIf(input),
    signals,
    trace: [
      "Built read-only Anchor Brain decision.",
      `Anchor Today headline: ${compact(today.headline)}`,
      `Recommendation source: ${recommendation.source}.`,
      `Compared ${candidates.length} candidates across existing tasks and strategic spine.`,
    ],
  };
}

export function registerAnchorBrainRoutes(app: import("express").Express) {
  app.get("/api/anchor/brain", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
    ]);
    res.json(buildAnchorBrainDecision({ tasks, jobs, learn, hustles, contacts, tracks }));
  });
}
