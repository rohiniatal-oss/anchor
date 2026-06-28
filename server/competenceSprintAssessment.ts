import type { Task, Win } from "@shared/schema";
import type { CompletionContract, SprintTaskBlueprint } from "./competenceDevelopmentSprint";
import { storage } from "./storage";

export type CompetenceSprintAssessmentRating = "weak" | "adequate" | "strong";
export type CompetenceSprintAssessmentOutcome =
  | "completed"
  | "captured"
  | "understood"
  | "continued"
  | "useful_signal"
  | "clearer"
  | "saved_for_later"
  | "needs_more_input"
  | "needs_feedback"
  | "not_useful"
  | "stop";

export type CompetenceSprintAssessmentResult = {
  assessed: true;
  rating: CompetenceSprintAssessmentRating | null;
  outcome: CompetenceSprintAssessmentOutcome | string;
  contractSatisfied: boolean;
  completionContract: CompletionContract | null;
  task: Task;
  win: Win;
  nextTaskCreated: 0 | 1;
  nextTask: Task | null;
  reusedNextTask: boolean;
  nextAction: string;
};

export class CompetenceSprintAssessmentError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CompetenceSprintAssessmentError";
    this.status = status;
    this.code = code;
  }
}

function compact(value: unknown, max = 800) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function activationList(value: unknown): "inbox" | "today" {
  return String(value || "").toLowerCase() === "today" ? "today" : "inbox";
}

function parseSourceNote(task: Task): Record<string, any> {
  try {
    const parsed = JSON.parse(task.sourceNote || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ratingFor(value: unknown): CompetenceSprintAssessmentRating | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (["weak", "adequate", "strong"].includes(raw)) return raw as CompetenceSprintAssessmentRating;
  throw new CompetenceSprintAssessmentError(400, "bad_assessment_rating", "Assessment rating must be weak, adequate, or strong.");
}

function outcomeFor(value: unknown, contract: CompletionContract | null): CompetenceSprintAssessmentOutcome | string {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (raw) return raw;
  if (contract?.assessmentMode === "choice" && contract.afterActionOptions.includes("captured")) return "captured";
  if (contract?.assessmentMode === "self_rating") return "understood";
  if (contract?.assessmentMode === "binary") return "completed";
  return "completed";
}

function winCategoryFor(task: Task) {
  if (["substack", "hustle", "afterline"].includes(task.category)) return "proof_asset";
  if (task.category === "admin") return "admin";
  return "learning";
}

function taskIndex(task: Task) {
  const match = String(task.sourceStatus || "").match(/task_(\d+)/i);
  if (match) return Math.max(0, Number(match[1]) - 1);
  return Math.max(0, Number(task.sourceStepId || 1) - 1);
}

function taskBlueprints(note: Record<string, any>): SprintTaskBlueprint[] {
  const items = note?.experience?.taskBlueprints;
  return Array.isArray(items) ? items.filter((item) => item?.title && item?.doneWhen) : [];
}

function currentBlueprint(note: Record<string, any>): SprintTaskBlueprint | null {
  const blueprint = note?.taskBlueprint;
  return blueprint && blueprint.title && blueprint.doneWhen ? blueprint as SprintTaskBlueprint : null;
}

function completionContractFor(note: Record<string, any>): CompletionContract | null {
  const contract = currentBlueprint(note)?.completionContract;
  if (!contract || typeof contract !== "object") return null;
  return contract as CompletionContract;
}

function sourceStatusFor(note: Record<string, any>, nextIndex: number) {
  const target = compact(note?.sprint?.targetCompetencyKey || "competency", 120).replace(/[^a-zA-Z0-9_:-]+/g, "_");
  return `competence_sprint:${target}:experience_1:task_${nextIndex + 1}`;
}

function sourceNoteForNext(note: Record<string, any>, nextBlueprint: SprintTaskBlueprint, assessment: Record<string, any>) {
  return JSON.stringify({
    ...note,
    assessment,
    taskBlueprint: nextBlueprint,
    assessmentHistory: [...(Array.isArray(note.assessmentHistory) ? note.assessmentHistory : []), assessment],
  });
}

function assessmentLabel(rating: CompetenceSprintAssessmentRating | null, outcome: string) {
  return rating || outcome || "completed";
}

function contractSatisfied(rating: CompetenceSprintAssessmentRating | null, outcome: string) {
  if (rating) return rating !== "weak";
  return !["stop", "not_useful", "needs_more_input", "not_done", "incomplete"].includes(outcome);
}

async function currentTask(taskId: number): Promise<Task> {
  const task = (await storage.getTasks()).find((item) => item.id === taskId);
  if (!task) throw new CompetenceSprintAssessmentError(404, "task_not_found", "Task not found.");
  if (task.sourceType !== "competence_development_sprint") {
    throw new CompetenceSprintAssessmentError(400, "not_competence_sprint_task", "Only competence development sprint tasks can be assessed here.");
  }
  if (!task.done && task.status !== "done") {
    throw new CompetenceSprintAssessmentError(409, "task_not_complete", "Complete the sprint task before assessing the output.");
  }
  return task;
}

async function upsertAssessmentWin(task: Task, label: string, note: string): Promise<Win> {
  const text = `Competence sprint assessment: ${label}${note ? `. ${note}` : ""}`;
  const existing = (await storage.getWins()).find((win) => win.sourceEntityType === "task" && win.sourceEntityId === task.id);
  if (existing) {
    return (await storage.updateWin(existing.id, {
      takeaway: text,
      winCategory: existing.winCategory || winCategoryFor(task),
    } as any)) as Win;
  }
  return storage.createWin({
    text: task.title,
    kind: "planned",
    winCategory: winCategoryFor(task),
    trackId: task.relatedTrackId ?? undefined,
    sourceEntityType: "task",
    sourceEntityId: task.id,
    takeaway: text,
  } as any);
}

async function findActiveSprintTask(trackId: number | null | undefined): Promise<Task | null> {
  if (trackId == null) return null;
  return (await storage.getTasks()).find((task) =>
    !task.done
    && task.sourceType === "competence_development_sprint"
    && task.relatedTrackId === trackId
    && task.sourceStatus.startsWith("competence_sprint:"),
  ) || null;
}

async function createNextTask(input: {
  current: Task;
  note: Record<string, any>;
  assessment: Record<string, any>;
  nextBlueprint: SprintTaskBlueprint;
  nextIndex: number;
  list?: "inbox" | "today";
}) {
  const existing = await findActiveSprintTask(input.current.relatedTrackId);
  if (existing) return { task: existing, created: false as const };
  const task = await storage.createTask({
    title: input.nextBlueprint.title,
    list: activationList(input.list),
    block: null,
    done: false,
    pinned: false,
    steps: JSON.stringify([
      { text: input.nextBlueprint.doneWhen, done: false },
      { text: "Use the previous sprint assessment before starting", done: false },
      { text: "Assess this output before unlocking another sprint task", done: false },
    ]),
    sort: 0,
    category: input.current.category,
    size: input.nextBlueprint.estimatedMinutes <= 30 ? "quick" : input.nextBlueprint.estimatedMinutes >= 90 ? "deep" : "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: input.nextBlueprint.doneWhen,
    sourceType: "competence_development_sprint",
    sourceId: input.current.sourceId,
    sourceStepType: "sprint_experience_task",
    sourceStepId: input.nextIndex + 1,
    sourceUrl: "",
    sourceNote: sourceNoteForNext(input.note, input.nextBlueprint, input.assessment),
    sourceStatus: sourceStatusFor(input.note, input.nextIndex),
    relatedTrackId: input.current.relatedTrackId,
    minimumOutcome: input.nextBlueprint.doneWhen,
    estimateMinutes: input.nextBlueprint.estimatedMinutes,
    estimateConfidence: "medium",
    estimateReason: "competence_development_sprint_assessment_unlock",
    readiness: "ready",
  } as any);
  return { task, created: true as const };
}

export async function assessCompetenceSprintTask(input: {
  taskId: number;
  rating?: unknown;
  outcome?: unknown;
  note?: string;
  activateNext?: boolean;
  list?: "inbox" | "today";
}): Promise<CompetenceSprintAssessmentResult> {
  const taskId = Number(input.taskId);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    throw new CompetenceSprintAssessmentError(400, "bad_task_id", "A valid sprint task is required.");
  }
  const completed = await currentTask(taskId);
  const source = parseSourceNote(completed);
  const completionContract = completionContractFor(source);
  const rating = ratingFor(input.rating);
  if (!rating && completionContract?.assessmentMode === "rubric") {
    throw new CompetenceSprintAssessmentError(400, "bad_assessment_rating", "Rubric-assessed tasks need a weak, adequate, or strong rating.");
  }
  const outcome = outcomeFor(input.outcome, completionContract);
  const label = assessmentLabel(rating, outcome);
  const satisfied = contractSatisfied(rating, outcome);
  const assessment = {
    rating,
    outcome,
    contractSatisfied: satisfied,
    completionContract,
    note: compact(input.note || "", 1000),
    assessedAt: Date.now(),
    assessedTaskId: completed.id,
    assessedTaskTitle: completed.title,
  };

  const task = (await storage.updateTask(completed.id, {
    sourceStatus: `${completed.sourceStatus}:assessed_${label}`,
    sourceNote: JSON.stringify({
      ...source,
      assessment,
      assessmentHistory: [...(Array.isArray(source.assessmentHistory) ? source.assessmentHistory : []), assessment],
    }),
  } as any)) as Task;
  const win = await upsertAssessmentWin(task, label, assessment.note);

  let nextTask: Task | null = null;
  let nextTaskCreated: 0 | 1 = 0;
  let reusedNextTask = false;
  const blueprints = taskBlueprints(source);
  const nextIndex = taskIndex(completed) + 1;
  const nextBlueprint = blueprints[nextIndex];
  if (satisfied && input.activateNext !== false && nextBlueprint) {
    const result = await createNextTask({ current: task, note: source, assessment, nextBlueprint, nextIndex, list: input.list });
    nextTask = result.task;
    nextTaskCreated = result.created ? 1 : 0;
    reusedNextTask = !result.created;
  }

  await storage.logActivity({
    eventType: "competence_sprint_task_assessed",
    sourceType: "task",
    sourceId: task.id,
    taskId: task.id,
    metadata: JSON.stringify({
      rating,
      outcome,
      contractSatisfied: satisfied,
      note: assessment.note,
      completionContract: completionContract?.contract || "legacy_rubric",
      nextTaskId: nextTask?.id ?? null,
      nextTaskCreated,
      targetCompetencyKey: source?.sprint?.targetCompetencyKey || "",
      focusContributor: source?.sprint?.focusContributor || "",
    }),
  } as any);

  const nextAction = !satisfied
    ? "Do not unlock the next sprint task yet. Repeat, narrow, or stop according to the completion contract."
    : nextTask
      ? "Continue with the next unlocked sprint task, then assess it before progressing."
      : "Assessment recorded. No further task blueprint exists for this experience.";

  return { assessed: true, rating, outcome, contractSatisfied: satisfied, completionContract, task, win, nextTaskCreated, nextTask, reusedNextTask, nextAction };
}
