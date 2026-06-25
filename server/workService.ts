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

function taskPatch(proposal: TaskProposal, steps: ActionStep[], input: {
  projectId?: number | null;
  milestoneId?: number | null;
  sourceNote?: string;
}) {
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
    sourceType: input.projectId ? "project" : "task",
    sourceId: input.projectId ?? undefined,
    sourceStepType: input.milestoneId ? "project_milestone" : "",
    sourceStepId: input.milestoneId ?? undefined,
    sourceStatus: input.projectId ? "project_task" : "confirmed_task",
    sourceNote: input.sourceNote || "",
  };
}

async function createOrUpdateTask(input: {
  proposal: TaskProposal;
  steps: ActionStep[];
  sourceTaskId?: number | null;
  relatedTrackId?: number | null;
  projectId?: number | null;
  milestoneId?: number | null;
  sourceNote?: string;
}) {
  const patch = taskPatch(input.proposal, input.steps, input);
  let task: Task | undefined;
  if (input.sourceTaskId) {
    task = await storage.updateTask(input.sourceTaskId, {
      ...patch,
      list: "inbox",
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

/** Preview the correct work level and its decomposition without persisting it. */
export async function previewWork(input: WorkPreviewInput): Promise<WorkPreview> {
  ensureWorkSchema();
  const existingTask = ["task", "capture"].includes(input.sourceType || "") ? await sourceTask(input.sourceId) : null;
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

/** Return a pure project snapshot including activation and review readiness. */
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
  const enrichedMilestones = milestones.map((milestone) => ({
    ...milestone,
    tasks: links
      .filter((link) => link.milestoneId === milestone.id)
      .map((link) => ({ link, task: taskById.get(link.taskId) || null })),
  }));
  const current = enrichedMilestones.find((milestone) => milestone.id === project.currentMilestoneId)
    || enrichedMilestones.find((milestone) => milestone.status === "active")
    || null;
  const currentTasks = current?.tasks.map((entry) => entry.task).filter(Boolean) as Task[] | undefined;
  const openTask = currentTasks?.find((task) => !task.done && task.status !== "done") || null;
  const allCurrentTasksDone = !!currentTasks?.length && currentTasks.every((task) => task.done || task.status === "done");
  return {
    project,
    definition: getWorkDefinition(project.workDefinitionId),
    milestones: enrichedMilestones,
    currentMilestone: current,
    activeTask: openTask,
    needsTaskActivation: !!current && !openTask && !allCurrentTasksDone,
    needsMilestoneReview: !!current && allCurrentTasksDone && current.status !== "done",
    canCompleteMilestone: !!current && allCurrentTasksDone,
    unassignedTasks: links
      .filter((link) => link.milestoneId == null)
      .map((link) => ({ link, task: taskById.get(link.taskId) || null })),
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

function asTaskPlan(definition: WorkDefinition, decomposition: WorkDecomposition): TaskDecomposition {
  if (decomposition.kind === "task") return decomposition.task;
  const fallback = decomposeWorkDeterministically(forceDefinitionAsTask(definition));
  if (fallback.kind !== "task") throw new Error("A task plan could not be created.");
  return fallback.task;
}

function definitionSourceNote(definition: WorkDefinition, project?: ProjectRecord | null, milestone?: ProjectMilestoneRecord | null) {
  return `Anchor work definition: ${JSON.stringify({
    version: definition.version,
    workType: definition.workType,
    objective: definition.objective,
    whyNow: definition.whyNow,
    desiredOutcome: definition.desiredOutcome,
    successCriteria: definition.successCriteria,
    projectId: project?.id ?? null,
    projectTitle: project?.title || "",
    milestoneId: milestone?.id ?? null,
    milestoneTitle: milestone?.title || "",
  })}`;
}

function existingProjectForSource(definition: WorkDefinition) {
  if (definition.sourceId == null) return null;
  const row = rawDb.prepare(`
    SELECT p.id
    FROM projects p
    JOIN work_definitions w ON w.id = p.work_definition_id
    WHERE w.source_type = ? AND w.source_id = ?
    ORDER BY p.id DESC
    LIMIT 1
  `).get(definition.sourceType, definition.sourceId) as { id?: number } | undefined;
  return row?.id ? getProject(Number(row.id)) : null;
}

async function archiveProjectCapture(sourceTaskId: number | null | undefined, project: ProjectRecord, definition: WorkDefinition) {
  if (!sourceTaskId) return;
  const capture = await sourceTask(sourceTaskId);
  if (!capture) return;
  const sourceNote = [
    capture.sourceNote,
    definitionSourceNote(definition, project),
  ].filter(Boolean).join("\n");
  await storage.updateTask(capture.id, {
    list: "captured",
    sourceType: "project_capture",
    sourceId: project.id,
    sourceStatus: "project_confirmed",
    sourceNote,
  } as any);
}

async function activateStandaloneTask(definition: WorkDefinition, plan: TaskDecomposition, sourceTaskId?: number | null) {
  const task = await createOrUpdateTask({
    proposal: plan.task,
    steps: plan.steps,
    sourceTaskId,
    relatedTrackId: definition.parentDirectionId,
    sourceNote: definitionSourceNote(definition),
  });
  const storedDefinition = createConfirmedWorkDefinition({ ...definition, sourceType: "task", sourceId: task.id });
  await storage.logActivity({
    eventType: "work_activated",
    sourceType: "task",
    sourceId: task.id,
    taskId: task.id,
    metadata: JSON.stringify({ workDefinitionId: storedDefinition.id, workType: "task", explicit: true }),
  } as any);
  return { kind: "task" as const, task, definition: storedDefinition, taskActivated: true };
}

async function attachToProject(definition: WorkDefinition, plan: TaskDecomposition, sourceTaskId?: number | null) {
  const projectId = definition.candidateParent?.projectId;
  const project = projectId ? getProject(projectId) : null;
  if (!project) return activateStandaloneTask({ ...definition, candidateParent: null }, plan, sourceTaskId);
  const milestone = currentMilestone(project, listProjectMilestones(project.id));
  const existingLinks = listProjectTaskLinks(project.id).filter((link) => link.milestoneId === milestone?.id);
  const tasks = await storage.getTasks();
  const existing = existingLinks.map((link) => tasks.find((task) => task.id === link.taskId)).find((task) => task && !task.done);
  if (existing) return { kind: "task" as const, task: existing, project, milestone, reused: true, taskActivated: true };
  const task = await createOrUpdateTask({
    proposal: plan.task,
    steps: plan.steps,
    sourceTaskId,
    relatedTrackId: project.relatedTrackId,
    projectId: project.id,
    milestoneId: milestone?.id ?? null,
    sourceNote: definitionSourceNote(definition, project, milestone),
  });
  const storedDefinition = createConfirmedWorkDefinition({ ...definition, sourceType: "task", sourceId: task.id });
  await storage.logActivity({
    eventType: "work_attached_to_project",
    sourceType: "project",
    sourceId: project.id,
    taskId: task.id,
    metadata: JSON.stringify({ workDefinitionId: storedDefinition.id, milestoneId: milestone?.id ?? null, explicit: true }),
  } as any);
  return { kind: "task" as const, task, project, milestone, definition: storedDefinition, reused: false, taskActivated: true };
}

/** Confirm a project and its milestone map without creating a live task. */
async function confirmProject(definition: WorkDefinition, decomposition: ProjectDecomposition, sourceTaskId?: number | null) {
  const existing = existingProjectForSource(definition);
  if (existing) {
    return {
      kind: "project" as const,
      ...(await projectDetail(existing.id))!,
      decomposition: existing.decompositionModel,
      reused: true,
      taskActivated: false,
      nextAction: "activate_first_task" as const,
    };
  }
  const graph = createProjectGraph({ definition, decomposition });
  await archiveProjectCapture(sourceTaskId, graph.project, definition);
  await storage.logActivity({
    eventType: "project_confirmed",
    sourceType: "project",
    sourceId: graph.project.id,
    metadata: JSON.stringify({ workDefinitionId: graph.definition.id, explicit: true, taskActivated: false }),
  } as any);
  return {
    kind: "project" as const,
    ...(await projectDetail(graph.project.id))!,
    decomposition,
    reused: false,
    taskActivated: false,
    nextAction: "activate_first_task" as const,
  };
}

/** Persist only the work object selected by the user. */
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
    const error = new Error(definition.clarifyingQuestion || "This work needs clarification before confirmation.") as Error & { status?: number; code?: string };
    error.status = 409;
    error.code = "work_clarification_required";
    throw error;
  }
  if (definition.workType === "project" && decomposition.kind === "project") {
    return confirmProject(definition, decomposition.project, input.sourceTaskId);
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

/** Preview only the next task for the current project milestone. */
export async function previewNextProjectWork(projectId: number, refine = true) {
  ensureWorkSchema();
  const detail = await projectDetail(projectId);
  if (!detail?.definition) return null;
  const milestone = detail.milestones.find((item) => item.id === detail.project.currentMilestoneId)
    || detail.milestones.find((item) => item.status === "active")
    || detail.milestones.find((item) => item.status === "proposed");
  if (!milestone) return null;
  const tasks = milestone.tasks.map((entry: any) => entry.task).filter(Boolean) as Task[];
  const openTask = tasks.find((task) => !task.done && task.status !== "done");
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

  const stored = detail.project.decompositionModel;
  if (stored && stored.currentMilestoneKey === milestone.milestoneKey && stored.currentTasks.length) {
    const proposal = stored.currentTasks[stored.activeTaskIndex] || stored.currentTasks[0];
    const decomposition = taskDecompositionSchema.parse({
      version: 1,
      task: proposal,
      steps: stored.activeTaskSteps,
      rollingPlan: false,
    });
    return { project: detail.project, milestone, decomposition, requiresActivation: true, readOnlyPreview: true };
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

/** Activate one next task only; repeated calls reuse the open milestone task. */
export async function activateNextProjectTask(input: { projectId: number; milestoneId: number; decomposition: unknown }) {
  ensureWorkSchema();
  const project = getProject(input.projectId);
  if (!project) return null;
  const milestone = listProjectMilestones(project.id).find((item) => item.id === input.milestoneId);
  if (!milestone) return null;
  const links = listProjectTaskLinks(project.id).filter((link) => link.milestoneId === milestone.id);
  const tasks = await storage.getTasks();
  const existing = links.map((link) => tasks.find((task) => task.id === link.taskId)).find((task) => task && !task.done && task.status !== "done");
  if (existing) return { project: await projectDetail(project.id), milestone, task: existing, reused: true };

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
    sourceNote: definitionSourceNote(milestoneTaskDefinition(project, milestone), project, milestone),
  });
  await storage.logActivity({
    eventType: "project_task_activated",
    sourceType: "project",
    sourceId: project.id,
    taskId: task.id,
    metadata: JSON.stringify({ milestoneId: milestone.id, explicit: true }),
  } as any);
  return { project: await projectDetail(project.id), milestone, task, reused: false };
}

/** Complete a milestone only after its linked tasks are done or explicitly overridden. */
export async function completeProjectMilestone(projectId: number, milestoneId: number, confirmIncomplete = false) {
  ensureWorkSchema();
  const project = getProject(projectId);
  const milestones = listProjectMilestones(projectId);
  const milestone = milestones.find((item) => item.id === milestoneId);
  if (!project || !milestone) return null;
  if (project.currentMilestoneId && project.currentMilestoneId !== milestone.id) {
    const error = new Error("Only the current milestone can be completed.") as Error & { status?: number; code?: string };
    error.status = 409;
    error.code = "not_current_milestone";
    throw error;
  }
  const links = listProjectTaskLinks(projectId).filter((link) => link.milestoneId === milestone.id);
  const tasks = await storage.getTasks();
  const incomplete = links
    .map((link) => tasks.find((task) => task.id === link.taskId))
    .filter((task): task is Task => !!task && !task.done && task.status !== "done");
  if ((!links.length || incomplete.length) && !confirmIncomplete) {
    const error = new Error("Complete the current task, or explicitly confirm that the milestone outcome is satisfied.") as Error & { status?: number; code?: string };
    error.status = 409;
    error.code = "milestone_review_required";
    throw error;
  }

  updateMilestoneStatus(milestone.id, "done");
  const next = milestones.find((item) => item.sequence > milestone.sequence && item.status === "proposed") || null;
  rawDb.prepare("UPDATE projects SET current_milestone_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(next?.id ?? null, next ? "active" : "completed", Date.now(), projectId);
  if (next) updateMilestoneStatus(next.id, "active");
  await storage.logActivity({
    eventType: "project_milestone_completed",
    sourceType: "project",
    sourceId: projectId,
    metadata: JSON.stringify({ milestoneId, nextMilestoneId: next?.id ?? null, explicit: true }),
  } as any);
  return {
    project: await projectDetail(projectId),
    completedMilestone: milestone,
    nextMilestone: next,
  };
}
