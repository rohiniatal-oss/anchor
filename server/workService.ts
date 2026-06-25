import type { Task } from "@shared/schema";
import type {
  ActionStep,
  ProjectDecomposition,
  TaskDecomposition,
  TaskProposal,
  WorkDecomposition,
  WorkDefinition,
} from "@shared/work";
import {
  taskDecompositionSchema,
  workDecompositionSchema,
  workDefinitionSchema,
} from "@shared/work";
import { buildSourceContext } from "./taskBreakdownRoutes";
import { collectTaskBreakdownContext, formatContextBlocksForPrompt } from "./contextProviders";
import { storage, rawDb } from "./storage";
import { buildUserContext, formatContextForPrompt } from "./userContext";
import { decomposeWork, decomposeWorkDeterministically } from "./workDecomposition";
import {
  forceDefinitionAsTask,
  interpretWork,
  interpretWorkDeterministically,
  normalizeContextForWork,
} from "./workInterpretation";
import {
  createConfirmedWorkDefinition,
  createProjectGraph,
  ensureWorkSchema,
  findCandidateParent,
  getProject,
  getWorkDefinition,
  linkTaskToProject,
  listProjectMilestones,
  listProjectTaskLinks,
  listProjects,
  projectLinkForTask,
  removeProjectGraph,
  updateMilestoneStatus,
  type ProjectMilestoneRecord,
  type ProjectRecord,
} from "./workRepository";

export type WorkPreviewInput = {
  title: string;
  sourceType?: string;
  sourceId?: number | null;
  sourceNote?: string;
  doneWhen?: string;
  minimumOutcome?: string;
  steps?: unknown;
  relatedTrackId?: number | null;
  context?: string;
  refine?: boolean;
  externalResearchMockMode?: "success" | "empty" | "rate_limited" | "unavailable" | "error";
  forceWorkType?: WorkDefinition["workType"];
};

export type WorkPreview = {
  definition: WorkDefinition;
  decomposition: WorkDecomposition | null;
  nextAction: "clarify" | "confirm_project" | "confirm_task" | "attach_to_project";
  readOnlyPreview: true;
};

function sizeFor(minutes: number) {
  if (minutes <= 15) return "quick";
  if (minutes <= 60) return "medium";
  return "deep";
}

function stepsJson(steps: ActionStep[]) {
  return JSON.stringify(steps.map((step) => ({
    text: step.text,
    done: false,
    executor: step.executor,
    outputSpec: step.outputSpec,
  })));
}

function taskPatch(proposal: TaskProposal, steps: ActionStep[]) {
  return {
    title: proposal.title,
    category: proposal.category,
    size: sizeFor(proposal.estimateMinutes),
    estimateMinutes: proposal.estimateMinutes,
    estimateConfidence: "medium",
    estimateReason: "work_decomposition_v1",
    doneWhen: proposal.doneWhen,
    minimumOutcome: proposal.output,
    steps: stepsJson(steps),
    readiness: "ready",
    blockerReason: "",
    status: "not_started",
    done: false,
    pinned: false,
    sourceStatus: "project_task",
  };
}

async function createOrUpdateTask(input: {
  proposal: TaskProposal;
  steps: ActionStep[];
  sourceTaskId?: number | null;
  relatedTrackId?: number | null;
  projectId?: number | null;
  milestoneId?: number | null;
}) {
  const patch = taskPatch(input.proposal, input.steps);
  let task: Task | undefined;
  if (input.sourceTaskId) {
    task = await storage.updateTask(input.sourceTaskId, {
      ...patch,
      relatedTrackId: input.relatedTrackId ?? undefined,
    } as any);
  }
  if (!task) {
    task = await storage.createTask({
      ...patch,
      list: "inbox",
      block: null,
      sort: 0,
      skipped: 0,
      deadline: "",
      source: "coach",
      sourceType: input.projectId ? "project" : "task",
      sourceId: input.projectId ?? undefined,
      sourceNote: "",
      relatedTrackId: input.relatedTrackId ?? undefined,
      dependsOn: "[]",
      blocks: "[]",
      blockedBy: "",
      stretchOutcome: "",
    } as any);
  }
  if (input.projectId) {
    linkTaskToProject({
      projectId: input.projectId,
      milestoneId: input.milestoneId ?? null,
      taskId: task.id,
      role: "active_task",
    });
  }
  return task;
}

function sourceKind(sourceType: string) {
  return ["job", "learn", "hustle", "contact", "goal"].includes(sourceType)
    ? sourceType as "job" | "learn" | "hustle" | "contact" | "goal"
    : "task" as const;
}

function providerTask(input: WorkPreviewInput): any {
  return {
    title: input.title,
    category: "thinking",
    doneWhen: input.doneWhen || "",
    minimumOutcome: input.minimumOutcome || "",
    sourceUrl: "",
    sourceNote: input.sourceNote || "",
    sourceType: input.sourceType || "task",
  };
}

async function sourceTask(id?: number | null) {
  if (!id) return null;
  return (await storage.getTasks()).find((task) => task.id === id) || null;
}

async function previewContext(input: WorkPreviewInput, existingTask: Task | null) {
  const userContext = await buildUserContext();
  const sections = [formatContextForPrompt(userContext)];
  const bundle = existingTask
    ? await buildSourceContext(existingTask, userContext)
    : {
        sourceContext: input.sourceNote || "",
        playbook: "",
        sourceKind: sourceKind(input.sourceType || "task"),
        source: null,
        parentContext: "",
        crossEngineContext: "",
      };
  if (bundle.sourceContext) sections.push(`Source context:\n${bundle.sourceContext}`);
  if (bundle.parentContext) sections.push(`Parent workflow:\n${bundle.parentContext}`);
  if ("crossEngineContext" in bundle && bundle.crossEngineContext) sections.push(`Connected context:\n${bundle.crossEngineContext}`);
  if (input.context) sections.push(`User clarification:\n${input.context}`);
  if (input.refine !== false) {
    const collected = await collectTaskBreakdownContext({
      task: existingTask || providerTask(input),
      sourceBundle: bundle,
      userAuthoredContext: input.context || "",
      mockMode: input.externalResearchMockMode,
    });
    const providerContext = formatContextBlocksForPrompt(collected.blocks);
    if (providerContext) sections.push(providerContext);
  }
  return normalizeContextForWork(sections.filter(Boolean).join("\n\n"));
}

export async function previewWork(input: WorkPreviewInput): Promise<WorkPreview> {
  const existingTask = input.sourceType === "task" ? await sourceTask(input.sourceId) : null;
  const context = await previewContext(input, existingTask);
  const firstPass = interpretWorkDeterministically({ ...input, context, candidateParent: null });
  const candidateParent = findCandidateParent({
    title: firstPass.title,
    objective: firstPass.objective,
    relatedTrackId: input.relatedTrackId ?? firstPass.parentDirectionId,
  });
  const definition = input.refine === false
    ? interpretWorkDeterministically({ ...input, context, candidateParent })
    : await interpretWork({ ...input, context, candidateParent });
  if (definition.needsClarification) {
    return { definition, decomposition: null, nextAction: "clarify", readOnlyPreview: true };
  }
  const decomposition = input.refine === false
    ? decomposeWorkDeterministically(definition)
    : await decomposeWork(definition, context);
  const nextAction = definition.workType === "project"
    ? "confirm_project"
    : definition.candidateParent
      ? "attach_to_project"
      : "confirm_task";
  return { definition, decomposition, nextAction, readOnlyPreview: true };
}

function currentMilestone(project: ProjectRecord, milestones: ProjectMilestoneRecord[]) {
  return milestones.find((milestone) => milestone.id === project.currentMilestoneId)
    || milestones.find((milestone) => milestone.status === "active")
    || milestones.find((milestone) => milestone.status === "proposed")
    || milestones[0]
    || null;
}

export async function projectDetail(projectId: number) {
  const project = getProject(projectId);
  if (!project) return null;
  const [tasks, milestones, links] = await Promise.all([
    storage.getTasks(),
    Promise.resolve(listProjectMilestones(projectId)),
    Promise.resolve(listProjectTaskLinks(projectId)),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return {
    project,
    definition: getWorkDefinition(project.workDefinitionId),
    milestones: milestones.map((milestone) => ({
      ...milestone,
      tasks: links
        .filter((link) => link.milestoneId === milestone.id)
        .map((link) => ({ link, task: taskById.get(link.taskId) || null })),
    })),
    unassignedTasks: links
      .filter((link) => link.milestoneId == null)
      .map((link) => ({ link, task: taskById.get(link.taskId) || null })),
  };
}

export function allProjectSummaries() {
  return listProjects(["active", "paused", "proposed"]).map((project) => ({
    ...project,
    milestoneCount: listProjectMilestones(project.id).length,
    taskCount: listProjectTaskLinks(project.id).length,
  }));
}

function asTaskPlan(definition: WorkDefinition, decomposition: WorkDecomposition): TaskDecomposition {
  if (decomposition.kind === "task") return decomposition.task;
  const fallback = decomposeWorkDeterministically(forceDefinitionAsTask(definition));
  if (fallback.kind !== "task") throw new Error("A task plan could not be created.");
  return fallback.task;
}

async function activateStandaloneTask(definition: WorkDefinition, plan: TaskDecomposition, sourceTaskId?: number | null) {
  const task = await createOrUpdateTask({
    proposal: plan.task,
    steps: plan.steps,
    sourceTaskId,
    relatedTrackId: definition.parentDirectionId,
  });
  const storedDefinition = createConfirmedWorkDefinition({ ...definition, sourceType: "task", sourceId: task.id });
  await storage.logActivity({
    eventType: "work_activated",
    sourceType: "task",
    sourceId: task.id,
    taskId: task.id,
    metadata: JSON.stringify({ workDefinitionId: storedDefinition.id, workType: "task", explicit: true }),
  } as any);
  return { kind: "task" as const, task, definition: storedDefinition };
}

async function attachToProject(definition: WorkDefinition, plan: TaskDecomposition, sourceTaskId?: number | null) {
  const projectId = definition.candidateParent?.projectId;
  const project = projectId ? getProject(projectId) : null;
  if (!project) return activateStandaloneTask({ ...definition, candidateParent: null }, plan, sourceTaskId);
  const milestone = currentMilestone(project, listProjectMilestones(project.id));
  const task = await createOrUpdateTask({
    proposal: plan.task,
    steps: plan.steps,
    sourceTaskId,
    relatedTrackId: project.relatedTrackId,
    projectId: project.id,
    milestoneId: milestone?.id ?? null,
  });
  const storedDefinition = createConfirmedWorkDefinition({ ...definition, sourceType: "task", sourceId: task.id });
  await storage.logActivity({
    eventType: "work_attached_to_project",
    sourceType: "project",
    sourceId: project.id,
    taskId: task.id,
    metadata: JSON.stringify({ workDefinitionId: storedDefinition.id, milestoneId: milestone?.id ?? null, explicit: true }),
  } as any);
  return { kind: "task" as const, task, project, milestone, definition: storedDefinition };
}

async function activateProject(definition: WorkDefinition, decomposition: ProjectDecomposition, sourceTaskId?: number | null) {
  if (sourceTaskId) {
    const linked = projectLinkForTask(sourceTaskId);
    if (linked) return { kind: "project" as const, ...(await projectDetail(linked.projectId))! };
  }
  const graph = createProjectGraph({ definition, decomposition });
  const milestone = graph.milestones.find((item) => item.milestoneKey === decomposition.currentMilestoneKey) || graph.milestones[0];
  const proposal = decomposition.currentTasks[decomposition.activeTaskIndex] || decomposition.currentTasks[0];
  try {
    const task = await createOrUpdateTask({
      proposal,
      steps: decomposition.activeTaskSteps,
      sourceTaskId,
      relatedTrackId: definition.parentDirectionId,
      projectId: graph.project.id,
      milestoneId: milestone?.id ?? null,
    });
    await storage.logActivity({
      eventType: "project_activated",
      sourceType: "project",
      sourceId: graph.project.id,
      taskId: task.id,
      metadata: JSON.stringify({ workDefinitionId: graph.definition.id, milestoneId: milestone?.id ?? null, explicit: true }),
    } as any);
    return { kind: "project" as const, ...(await projectDetail(graph.project.id))!, activeTask: task };
  } catch (error) {
    removeProjectGraph(graph.project.id);
    throw error;
  }
}

export async function activateWork(input: {
  definition: unknown;
  decomposition: unknown;
  sourceTaskId?: number | null;
  mode?: "as_interpreted" | "as_task" | "attach_to_parent";
}) {
  let definition = workDefinitionSchema.parse(input.definition);
  let decomposition = workDecompositionSchema.parse(input.decomposition);
  if (input.mode === "as_task") {
    definition = forceDefinitionAsTask(definition);
    decomposition = decomposeWorkDeterministically(definition);
  }
  if (definition.needsClarification) {
    const error = new Error(definition.clarifyingQuestion || "This work needs clarification before activation.") as Error & { status?: number; code?: string };
    error.status = 409;
    error.code = "work_clarification_required";
    throw error;
  }
  if (definition.workType === "project" && decomposition.kind === "project") {
    return activateProject(definition, decomposition.project, input.sourceTaskId);
  }
  const plan = asTaskPlan(definition, decomposition);
  if (input.mode === "attach_to_parent" || definition.candidateParent) {
    return attachToProject(definition, plan, input.sourceTaskId);
  }
  return activateStandaloneTask(definition, plan, input.sourceTaskId);
}

function milestoneTaskDefinition(project: ProjectRecord, milestone: ProjectMilestoneRecord): WorkDefinition {
  return workDefinitionSchema.parse({
    version: 1,
    workType: "task",
    title: milestone.title,
    objective: milestone.outcome,
    whyNow: `This is the next frontier in ${project.title}.`,
    desiredOutcome: milestone.outcome,
    successCriteria: [milestone.doneWhen],
    deliverables: [milestone.outcome],
    constraints: [],
    assumptions: [],
    estimatedScope: "single_session",
    confidence: "medium",
    parentDirectionId: project.relatedTrackId,
    candidateParent: {
      projectId: project.id,
      projectTitle: project.title,
      reason: "This is the current milestone in the confirmed project.",
      confidence: 1,
    },
    needsClarification: false,
    clarifyingQuestion: "",
    sourceTitle: milestone.title,
    sourceType: "project",
    sourceId: project.id,
  });
}

export async function previewNextProjectWork(projectId: number, refine = true) {
  const detail = await projectDetail(projectId);
  if (!detail?.definition) return null;
  const milestone = detail.milestones.find((item) => item.id === detail.project.currentMilestoneId)
    || detail.milestones.find((item) => item.status === "active")
    || detail.milestones.find((item) => item.status === "proposed");
  if (!milestone) return null;
  const tasks = milestone.tasks.map((entry: any) => entry.task).filter(Boolean) as Task[];
  const openTask = tasks.find((task) => !task.done);
  if (openTask) {
    return { project: detail.project, milestone, existingActiveTask: openTask, requiresActivation: false };
  }
  if (tasks.length > 0 && milestone.status !== "done") {
    return {
      project: detail.project,
      milestone,
      requiresMilestoneReview: true,
      message: "The current task is complete. Confirm the milestone outcome before Anchor opens the next frontier.",
    };
  }
  const definition = milestoneTaskDefinition(detail.project, milestone);
  const context = formatContextForPrompt(await buildUserContext());
  const generated = refine ? await decomposeWork(definition, context) : decomposeWorkDeterministically(definition);
  return {
    project: detail.project,
    milestone,
    decomposition: asTaskPlan(definition, generated),
    requiresActivation: true,
    readOnlyPreview: true,
  };
}

function parseTaskDecomposition(value: unknown): TaskDecomposition {
  const wrapped = workDecompositionSchema.safeParse(value);
  if (wrapped.success && wrapped.data.kind === "task") return wrapped.data.task;
  const direct = taskDecompositionSchema.safeParse(value);
  if (direct.success) return direct.data;
  throw new Error("Invalid task decomposition");
}

export async function activateNextProjectTask(input: { projectId: number; milestoneId: number; decomposition: unknown }) {
  const project = getProject(input.projectId);
  if (!project) return null;
  const milestone = listProjectMilestones(project.id).find((item) => item.id === input.milestoneId);
  if (!milestone) return null;
  const plan = parseTaskDecomposition(input.decomposition);
  updateMilestoneStatus(milestone.id, "active");
  rawDb.prepare("UPDATE projects SET current_milestone_id = ?, updated_at = ? WHERE id = ?")
    .run(milestone.id, Date.now(), project.id);
  const task = await createOrUpdateTask({
    proposal: plan.task,
    steps: plan.steps,
    relatedTrackId: project.relatedTrackId,
    projectId: project.id,
    milestoneId: milestone.id,
  });
  return { project: getProject(project.id), milestone, task };
}

export function completeProjectMilestone(projectId: number, milestoneId: number) {
  const project = getProject(projectId);
  const milestone = listProjectMilestones(projectId).find((item) => item.id === milestoneId);
  if (!project || !milestone) return null;
  updateMilestoneStatus(milestone.id, "done");
  const next = listProjectMilestones(projectId).find((item) => item.status === "proposed");
  rawDb.prepare("UPDATE projects SET current_milestone_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(next?.id ?? null, next ? "active" : "done", Date.now(), projectId);
  if (next) updateMilestoneStatus(next.id, "active");
  return { project: getProject(projectId), completedMilestone: milestone, nextMilestone: next || null };
}
