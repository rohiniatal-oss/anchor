import type { Task } from "@shared/schema";
import { buildCompetenceDevelopmentSprintsFromStorage, type CompetenceDevelopmentSprint, type SprintExperience, type SprintTaskBlueprint } from "./competenceDevelopmentSprint";
import { storage } from "./storage";

export type CompetenceSprintActivationResult = {
  approved: true;
  reused: boolean;
  downstreamTasksCreated: 0 | 1;
  sprint: CompetenceDevelopmentSprint;
  experience: SprintExperience;
  taskBlueprint: SprintTaskBlueprint;
  task: Task;
};

export class CompetenceSprintActivationError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CompetenceSprintActivationError";
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

function categoryForSprint(sprint: CompetenceDevelopmentSprint) {
  if (sprint.developmentObjective === "create_signal" || sprint.targetCompetencyKind === "evidence") return "substack";
  if (sprint.focusContributor === "network" || sprint.focusContributor === "feedback") return "admin";
  return "learning";
}

function sourceStatusFor(sprint: CompetenceDevelopmentSprint, experienceIndex: number, taskIndex: number) {
  return `competence_sprint:${sprint.targetCompetencyKey}:experience_${experienceIndex + 1}:task_${taskIndex + 1}`;
}

function sourceNoteFor(sprint: CompetenceDevelopmentSprint, experience: SprintExperience, taskBlueprint: SprintTaskBlueprint) {
  return JSON.stringify({
    sprint: {
      trackId: sprint.trackId,
      trackName: sprint.trackName,
      targetCompetencyKey: sprint.targetCompetencyKey,
      targetCompetencyName: sprint.targetCompetencyName,
      targetCompetencyKind: sprint.targetCompetencyKind,
      targetLevel: sprint.targetLevel,
      currentLevel: sprint.currentLevel,
      confidence: sprint.confidence,
      developmentObjective: sprint.developmentObjective,
      focusContributor: sprint.focusContributor,
      thesis: sprint.thesis,
      rationale: sprint.rationale,
      exitCriteria: sprint.exitCriteria,
    },
    experience: {
      title: experience.title,
      contributor: experience.contributor,
      stage: experience.stage,
      experienceType: experience.experienceType,
      objective: experience.objective,
      doneWhen: experience.doneWhen,
      outputs: experience.outputs,
      whyThis: experience.whyThis,
      assessmentRubric: experience.assessmentRubric,
    },
    taskBlueprint,
  });
}

async function findExistingTask(trackId: number) {
  const tasks = await storage.getTasks();
  return tasks.find((task) =>
    !task.done
    && task.sourceType === "competence_development_sprint"
    && task.relatedTrackId === trackId
    && task.sourceStatus.startsWith("competence_sprint:"),
  ) || null;
}

export async function approveCompetenceSprintFirstTask(input: {
  trackId: number;
  list?: "inbox" | "today";
}): Promise<CompetenceSprintActivationResult> {
  const trackId = Number(input.trackId);
  if (!Number.isFinite(trackId) || trackId <= 0) {
    throw new CompetenceSprintActivationError(400, "bad_track_id", "A valid active career direction is required.");
  }

  const payload = await buildCompetenceDevelopmentSprintsFromStorage();
  const sprint = payload.sprints.find((item) => item.trackId === trackId);
  if (!sprint) {
    throw new CompetenceSprintActivationError(404, "sprint_not_found", "No active competence development sprint exists for that direction.");
  }

  const experience = sprint.experiences[0];
  const taskBlueprint = experience?.taskBlueprints?.[0];
  if (!experience || !taskBlueprint) {
    throw new CompetenceSprintActivationError(409, "sprint_not_activatable", "The sprint has no first experience task to activate.");
  }

  const sourceStatus = sourceStatusFor(sprint, 0, 0);
  const existing = await findExistingTask(trackId);
  if (existing) {
    return {
      approved: true,
      reused: true,
      downstreamTasksCreated: 0,
      sprint,
      experience,
      taskBlueprint,
      task: existing,
    };
  }

  const task = await storage.createTask({
    title: taskBlueprint.title,
    list: activationList(input.list),
    block: null,
    done: false,
    pinned: false,
    steps: JSON.stringify([
      { text: taskBlueprint.doneWhen, done: false },
      { text: "Keep the sprint thesis visible while doing this", done: false },
      { text: "Do not activate the next sprint task until this one is assessed", done: false },
    ]),
    sort: 0,
    category: categoryForSprint(sprint),
    size: taskBlueprint.estimatedMinutes <= 30 ? "quick" : taskBlueprint.estimatedMinutes >= 90 ? "deep" : "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: taskBlueprint.doneWhen,
    sourceType: "competence_development_sprint",
    sourceId: sprint.trackId,
    sourceStepType: "first_experience_task",
    sourceStepId: 1,
    sourceUrl: "",
    sourceNote: sourceNoteFor(sprint, experience, taskBlueprint),
    sourceStatus,
    relatedTrackId: sprint.trackId,
    minimumOutcome: taskBlueprint.doneWhen,
    estimateMinutes: taskBlueprint.estimatedMinutes,
    estimateConfidence: "medium",
    estimateReason: "competence_development_sprint_blueprint",
    readiness: "ready",
  } as any);

  await storage.logActivity({
    eventType: "competence_sprint_first_task_activated",
    sourceType: "career_track",
    sourceId: sprint.trackId,
    taskId: task.id,
    metadata: JSON.stringify({
      targetCompetencyKey: sprint.targetCompetencyKey,
      developmentObjective: sprint.developmentObjective,
      experienceTitle: compact(experience.title),
      taskBlueprintTitle: compact(taskBlueprint.title),
      readOnlySprintApproved: true,
    }),
  } as any);

  return {
    approved: true,
    reused: false,
    downstreamTasksCreated: 1,
    sprint,
    experience,
    taskBlueprint,
    task,
  };
}
