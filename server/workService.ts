import type { Task } from "@shared/schema";
import type {
  ActionStep,
  ProjectDecomposition,
  TaskDecomposition,
  TaskProposal,
  WorkDecomposition,
  WorkDefinition,
} from "@shared/work";
import { workDecompositionSchema, workDefinitionSchema } from "@shared/work";
import { buildSourceContext } from "./taskBreakdownRoutes";
import { collectTaskBreakdownContext, formatContextBlocksForPrompt, inputForTaskResearch } from "./contextProviders";
import { storage, rawDb } from "./storage";
import { buildUserContext, formatContextForPrompt } from "./userContext";
import { decomposeWork, decomposeWorkDeterministically } from "./workDecomposition";
import { forceDefinitionAsTask, interpretWork, interpretWorkDeterministically, normalizeContextForWork } from "./workInterpretation";
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

function taskSize(minutes: number) {
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

function baseTaskPatch(proposal: TaskProposal, steps: ActionStep[]) {
  return {
    title: proposal.title,
    category: proposal.category,
    size: taskSize(proposal.estimateMinutes),
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
  const patch = baseTaskPatch(input.proposal, input.steps);
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

function publicTaskForContext(input: WorkPreviewInput): any {
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

async function previewContext(input: WorkPreviewInput, sourceTask?: Task | null) {
  const userContext = await buildUserContext();
  const sections = [formatContextForPrompt(userContext)];
  let bundle: Awaited<ReturnType<typeof buildSourceContext>> | null = null;
  if (sourceTask) {
    bundle = await buildSourceContext(sourceTask, userContext);
    if (bundle.sourceContext) sections.push(`Source context:\n${bundle.sourceContext}`);
    if (bundle.parentContext) sections.push(`Parent workflow:\n${bundle.parentContext}`);
    if (bundle.crossEngineContext) sections.push(`Connected context:\n${bundle.crossEngineContext}`);
  }
  if (input.context) sections.push(`User clarification:\n${input.context}`);
  if (input.refine) {
    const task = sourceTask || publicTaskForContext(input);
    const sourceBundle = bundle || {
      sourceContext: input.sourceNote || "",
      playbook: "",
      sourceKind: "task" as const,
      source: null,
      parentContext: "",
    };
    const researchInput = inputForTaskResearch({
      task,
      sourceBundle,
      userAuthoredContext: input.context || "",
      mockMode: input.externalResearchMockMode,
    });
    const collected = await collectTaskBreakdownContext(researchInput);
    const provider = formatContextBlocksForPrompt(collected.blocks);
    if (provider) sections.push(provider);
  }
  return normalizeContextForWork(sections.filter(Boolean).join("\n\n"));
}

async function sourceTask(id?: number | null) {
  if (!id) return null;
  return (await storage.getTasks()).find((task) => task.id === id) || null;
}

export async function previewWork(input: WorkPreviewInput): Promise<WorkPreview> {
  ensureWorkSchema();
  const existingTask = input.sourceType === "task" ? await sourceTask(input.sourceId) : null;
  const context = await previewContext(input, existingTask);
  const initial = interpretWorkDeterministically({
    ...input,
    context,
    candidateParent: null,
  });
  const candidateParent = findCandidateParent({
    title: initial.title,
    objective: initial.objective,
    relatedTrackId: input.relatedTrackId ?? initial.parentDirectionId,
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
    : definition.workType === "milestone" && definition.candidateParent
      ? "attach_to_project"
      : "confirm_task";
  return { definition, decomposition, nextAction, readOnlyPreview: true };
}

function currentProjectMilestone(project: ProjectRecord, milestones: ProjectMilestoneRecord[]) {
  return milestones.find((milestone) => milestone.id === project.currentMilestoneId)
    || milestones.find((milestone) => milestone.status === "active")
    || milestones.find((milestone) => milestone.status === "proposed")
    || milestones[0]
    || null;
}

export async function projectDetail(projectId: number) {
  ensureWorkSchema();
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
    unassignedTasks: links.filter((link) => link.milestoneId == null).map((link) => ({ link, task: taskById.get(link.taskId) || null })),
  };
}

export function allProjectSummaries() {
  ensureWorkSchema();
  return listProjects(["active", "paused", "proposed"]).map((project) => ({
    ...project,
    milestoneCount: listProjectMilestones(project.id).length,
    taskCount: listProjectTaskLinks(project.id).length,
  }));
}

async function activateStandaloneTask(definition: WorkDefinition, decomposition: TaskDecomposition, sourceTaskId?: number | null) {
  const task = await createOrUpdateTask({
    proposal: decomposition.task,
    steps: decomposition.steps,
    sourceTaskId,
    relatedTrackId: definition.parentDirectionId,
  });
  const storedDefinition = createConfirmedWorkDefinition({
    ...definition,
    sourceType: "task",
    sourceId: task.id,
  });
  await storage.logActivity({
    eventType: "work_activated",
    sourceType: "task",
    sourceId: task.id,
    taskId: task.id,
    metadata: JSON.stringify({ workDefinitionId: storedDefinition.id, workType: "task", explicit: true }),
  } as any);
  return { kind: "task" as const, task, definition: storedDefinition };
}

async function attachTaskToExistingProject(definition: WorkDefinition, decomposition: TaskDecomposition, sourceTaskId?: number | null) {
  const projectId = definition.candidateParent?.projectId;
  if (!projectId) return activateStandaloneTask(definition, decomposition, sourceTaskId);
  const project = getProject(projectId);
  if (!project) return activateStandaloneTask({ ...definition, candidateParent: null }, decomposition, sourceTaskId);
  const milestones = listProjectMilestones(project.id);
  const current = currentProjectMilestone(project, milestones);
  const task = await createOrUpdateTask({
    proposal: decomposition.task,
    steps: decomposition.steps,
    sourceTaskId,
    relatedTrackId: project.relatedTrackId,
    projectId: project.id,
    milestoneId: current?.id ?? null,
  });
  const storedDefinition = createConfirmedWorkDefinition({ ...definition, sourceType: "task", sourceId: task.id });
  await storage.logActivity({
    eventType: "work_attached_to_project",
    sourceType: "project",
    sourceId: project.id,
    taskId: task.id,
    metadata: JSON.stringify({ workDefinitionId: storedDefinition.id, milestoneId: current?.id ?? null, explicit: true }),
  } as any);
  return { kind: "task" as const, task, project, milestone: current, definition: storedDefinition };
}

async function activateProject(definition: WorkDefinition, decomposition: ProjectDecomposition, sourceTaskId?: number | null) {
  if (sourceTaskId) {
    const linked = projectLinkForTask(sourceTaskId);
    if (linked) return { kind: "project" as const, ...(await projectDetail(linked.projectId))! };
  }
  const graph = createProjectGraph({ definition, decomposition });
  const current = graph.milestones.find((milestone) => milestone.milestoneKey === decomposition.currentMilestoneKey) || graph.milestones[0];
  const activeTask = decomposition.currentTasks[decomposition.activeTaskIndex] || decomposition.currentTasks[0];
  try {
    const task = await createOrUpdateTask({
      proposal: activeTask,
      steps: decomposition.activeTaskSteps,
      sourceTaskId,
      relatedTrackId: definition.parentDirectionId,
      projectId: graph.project.id,
      milestoneId: current?.id ?? null,
    });
    await storage.logActivity({
      eventType: "project_activated",
      sourceType: "project",
      sourceId: graph.project.id,
      taskId: task.id,
      metadata: JSON.stringify({ workDefinitionId: graph.definition.id, milestoneId: current?.id ?? null, explicit: true }),
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
  ensureWorkSchema();
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
  if (decomposition.kind === "project" && definition.workType === "project") {
    return activateProject(definition, decomposition.project, input.sourceTaskId);
  }
  const taskPlan = decomposition.kind === "task"
    ? decomposition.task
    : decomposeWorkDeterministically(forceDefinitionAsTask(definition)).kind === "task"
      ? (decomposeWorkDeterministically(forceDefinitionAsTask(definition)) as { kind: "task"; task: TaskDecomposition }).task
      : null;
  if (!taskPlan) throw new Error("A task plan could not be created.");
  if (input.mode === "attach_to_parent" || definition.workType === "milestone") {
    return attachTaskToExistingProject(definition, taskPlan, input.sourceTaskId);
  }
  return activateStandaloneTask(definition, taskPlan, input.sourceTaskId);
}

export async function previewNextProjectWork(projectId: number, refine = true) {
  ensureWorkSchema();
  const detail = await projectDetail(projectId);
  if (!detail?.definition) return null;
  const current = detail.milestones.find((milestone) => milestone.id === detail.project.currentMilestoneId)
    || detail.milestones.find((milestone) => milestone.status === "active")
    || detail.milestones.find((milestone) => milestone.status === "proposed");
  if (!current) return null;
  const openTasks = current.tasks.map((entry: any) => entry.task).filter((task: Task | null) => task && !task.done);
  if (openTasks.length) {
    return { project: detail.project, milestone: current, existingActiveTask: openTasks[0], requiresActivation: false };
  }
  if (current.status !== "done") {
    return {
      project: detail.project,
      milestone: current,
      requiresMilestoneReview: true,
      message: "The current task is complete. Confirm the milestone outcome before Anchor opens the next frontier.",
    };
  }
  const next = detail.milestones.find((milestone) => milestone.status === "proposed");
  if (!next) return { project: detail.project, complete: true };
  const stored = detail.project.decompositionModel;
  const baseDefinition = {
    version: 1,
    workType: "task",
    title: next.title,
    objective: next.outcome,
    whyNow: `This is the next frontier in ${detail.project.title}.`,
    desiredOutcome: next.outcome,
    successCriteria: [next.doneWhen],
    deliverables: [next.outcome],
    constraints: [],
    assumptions: [],
    estimatedScope: "single_session",
    confidence: "medium",
    parentDirectionId: detail.project.relatedTrackId,
    candidateParent: { projectId, projectTitle: detail.project.title, reason: "This is the next milestone in the confirmed project.", confidence: 1 },
    needsClarification: false,
    clarifyingQuestion: "",
    sourceTitle: next.title,
    sourceType: "project",
    sourceId: projectId,
  } satisfies WorkDefinition;
  const context = formatContextForPrompt(await buildUserContext());
  const taskPlan = refine ? await decomposeWork(baseDefinition, context) : decomposeWorkDeterministically(baseDefinition);
  const decomposition = taskPlan.kind === "task" ? taskPlan.task : decomposeWorkDeterministically(forceDefinitionAsTask(baseDefinition)).kind === "task"
    ? (decomposeWorkDeterministically(forceDefinitionAsTask(baseDefinition)) as { kind: "task"; task: TaskDecomposition }).task
    : null;
  return { project: detail.project, milestone: next, decomposition, requiresActivation: true, sourceModel: stored?.version || 1 };
}

export async function activateNextProjectTask(input: { projectId: number; milestoneId: number; decomposition: unknown }) {
  ensureWorkSchema();
  const project = getProject(input.projectId);
  if (!project) return null;
  const milestone = listProjectMilestones(project.id).find((item) => item.id === input.milestoneId);
  if (!milestone) return null;
  const decomposition = taskDecompositionSchemaCompat(input.decomposition);
  updateMilestoneStatus(milestone.id, "active");
  rawDb.prepare("UPDATE projects SET current_milestone_id = ?, updated_at = ? WHERE id = ?").run(milestone.id, Date.now(), project.id);
  const task = await createOrUpdateTask({
    proposal: decomposition.task,
    steps: decomposition.steps,
    relatedTrackId: project.relatedTrackId,
    projectId: project.id,
    milestoneId: milestone.id,
  });
  return { project: getProject(project.id), milestone, task };
}

function taskDecompositionSchemaCompat(value: unknown): TaskDecomposition {
  const parsed = workDecompositionSchema.safeParse(value);
  if (parsed.success && parsed.data.kind === "task") return parsed.data.task;
  const direct = (value as any)?.task && (value as any)?.steps ? value : null;
  if (!direct) throw new Error("Invalid task decomposition");
  return {
    version: 1,
    task: direct.task,
    steps: direct.steps,
    rollingPlan: false,
  } as TaskDecomposition;
}

export function completeProjectMilestone(projectId: number, milestoneId: number) {
  ensureWorkSchema();
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
