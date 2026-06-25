import type { ProjectDecomposition, WorkDefinition } from "@shared/work";
import { rawDb } from "./storage";
import { WORK_DDL } from "./work.schema.sql";

export type StoredWorkDefinition = {
  id: number;
  sourceType: string;
  sourceId: number | null;
  workType: WorkDefinition["workType"];
  title: string;
  objective: string;
  whyNow: string;
  desiredOutcome: string;
  successCriteria: string[];
  deliverables: string[];
  constraints: string[];
  assumptions: string[];
  estimatedScope: WorkDefinition["estimatedScope"];
  confidence: WorkDefinition["confidence"];
  parentDirectionId: number | null;
  candidateParentProjectId: number | null;
  status: string;
  interpretationVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type ProjectRecord = {
  id: number;
  title: string;
  objective: string;
  whyNow: string;
  desiredOutcome: string;
  successCriteria: string[];
  deliverables: string[];
  status: string;
  relatedTrackId: number | null;
  workDefinitionId: number;
  currentMilestoneId: number | null;
  decompositionModel: ProjectDecomposition | null;
  decompositionFingerprint: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectMilestoneRecord = {
  id: number;
  projectId: number;
  milestoneKey: string;
  title: string;
  outcome: string;
  doneWhen: string;
  status: string;
  sequence: number;
  createdAt: number;
  updatedAt: number;
};

export type ProjectTaskLinkRecord = {
  id: number;
  projectId: number;
  milestoneId: number | null;
  taskId: number;
  role: string;
  createdAt: number;
};

export type ProjectCandidate = {
  projectId: number;
  projectTitle: string;
  reason: string;
  confidence: number;
};

function parseList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseModel(value: unknown): ProjectDecomposition | null {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && Array.isArray(parsed.milestones) ? parsed as ProjectDecomposition : null;
  } catch {
    return null;
  }
}

function workDefinitionFromRow(row: any): StoredWorkDefinition {
  return {
    id: Number(row.id),
    sourceType: String(row.source_type || "capture"),
    sourceId: row.source_id == null ? null : Number(row.source_id),
    workType: row.work_type,
    title: String(row.title || ""),
    objective: String(row.objective || ""),
    whyNow: String(row.why_now || ""),
    desiredOutcome: String(row.desired_outcome || ""),
    successCriteria: parseList(row.success_criteria),
    deliverables: parseList(row.deliverables),
    constraints: parseList(row.constraints_json),
    assumptions: parseList(row.assumptions),
    estimatedScope: row.estimated_scope,
    confidence: row.confidence,
    parentDirectionId: row.parent_direction_id == null ? null : Number(row.parent_direction_id),
    candidateParentProjectId: row.candidate_parent_project_id == null ? null : Number(row.candidate_parent_project_id),
    status: String(row.status || "confirmed"),
    interpretationVersion: Number(row.interpretation_version || 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function projectFromRow(row: any): ProjectRecord {
  return {
    id: Number(row.id),
    title: String(row.title || ""),
    objective: String(row.objective || ""),
    whyNow: String(row.why_now || ""),
    desiredOutcome: String(row.desired_outcome || ""),
    successCriteria: parseList(row.success_criteria),
    deliverables: parseList(row.deliverables),
    status: String(row.status || "active"),
    relatedTrackId: row.related_track_id == null ? null : Number(row.related_track_id),
    workDefinitionId: Number(row.work_definition_id),
    currentMilestoneId: row.current_milestone_id == null ? null : Number(row.current_milestone_id),
    decompositionModel: parseModel(row.decomposition_model),
    decompositionFingerprint: String(row.decomposition_fingerprint || ""),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function milestoneFromRow(row: any): ProjectMilestoneRecord {
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    milestoneKey: String(row.milestone_key || ""),
    title: String(row.title || ""),
    outcome: String(row.outcome || ""),
    doneWhen: String(row.done_when || ""),
    status: String(row.status || "proposed"),
    sequence: Number(row.sequence || 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function linkFromRow(row: any): ProjectTaskLinkRecord {
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    milestoneId: row.milestone_id == null ? null : Number(row.milestone_id),
    taskId: Number(row.task_id),
    role: String(row.role || "active_task"),
    createdAt: Number(row.created_at),
  };
}

export function ensureWorkSchema() {
  rawDb.exec(WORK_DDL);
}

export function workFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `work-${(hash >>> 0).toString(36)}`;
}

export function listProjects(statuses: string[] = ["active", "paused", "proposed"]): ProjectRecord[] {
  if (!statuses.length) return [];
  const placeholders = statuses.map(() => "?").join(",");
  const rows = rawDb.prepare(`SELECT * FROM projects WHERE status IN (${placeholders}) ORDER BY updated_at DESC, id DESC`).all(...statuses);
  return rows.map(projectFromRow);
}

export function getProject(projectId: number): ProjectRecord | null {
  const row = rawDb.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  return row ? projectFromRow(row) : null;
}

export function getWorkDefinition(id: number): StoredWorkDefinition | null {
  const row = rawDb.prepare("SELECT * FROM work_definitions WHERE id = ?").get(id);
  return row ? workDefinitionFromRow(row) : null;
}

export function listProjectMilestones(projectId: number): ProjectMilestoneRecord[] {
  return rawDb.prepare("SELECT * FROM project_milestones WHERE project_id = ? ORDER BY sequence, id")
    .all(projectId)
    .map(milestoneFromRow);
}

export function listProjectTaskLinks(projectId: number): ProjectTaskLinkRecord[] {
  return rawDb.prepare("SELECT * FROM project_task_links WHERE project_id = ? ORDER BY id")
    .all(projectId)
    .map(linkFromRow);
}

export function projectLinkForTask(taskId: number): ProjectTaskLinkRecord | null {
  const row = rawDb.prepare("SELECT * FROM project_task_links WHERE task_id = ?").get(taskId);
  return row ? linkFromRow(row) : null;
}

function tokens(value: string) {
  const ignored = new Set(["about", "after", "again", "against", "being", "could", "current", "doing", "from", "have", "into", "more", "should", "that", "their", "then", "this", "through", "with", "your"]);
  return new Set(String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !ignored.has(word)));
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

export function findCandidateParent(input: { title: string; objective?: string; relatedTrackId?: number | null }): ProjectCandidate | null {
  const queryTokens = tokens(`${input.title} ${input.objective || ""}`);
  let best: ProjectCandidate | null = null;
  for (const project of listProjects(["active", "paused"])) {
    const lexical = overlap(queryTokens, tokens(`${project.title} ${project.objective} ${project.desiredOutcome}`));
    const trackBoost = input.relatedTrackId && project.relatedTrackId === input.relatedTrackId ? 0.25 : 0;
    const score = Math.min(1, lexical * 0.75 + trackBoost);
    if (score < 0.35 || (best && best.confidence >= score)) continue;
    best = {
      projectId: project.id,
      projectTitle: project.title,
      reason: trackBoost
        ? "This work shares both the active direction and key outcome language with an existing project."
        : "This work overlaps strongly with the objective of an existing project.",
      confidence: Number(score.toFixed(2)),
    };
  }
  return best;
}

export function createConfirmedWorkDefinition(definition: WorkDefinition): StoredWorkDefinition {
  const now = Date.now();
  const result = rawDb.prepare(`
    INSERT INTO work_definitions (
      source_type, source_id, work_type, title, objective, why_now, desired_outcome,
      success_criteria, deliverables, constraints_json, assumptions, estimated_scope,
      confidence, parent_direction_id, candidate_parent_project_id, status,
      interpretation_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
  `).run(
    definition.sourceType || "capture",
    definition.sourceId ?? null,
    definition.workType,
    definition.title,
    definition.objective,
    definition.whyNow,
    definition.desiredOutcome,
    JSON.stringify(definition.successCriteria),
    JSON.stringify(definition.deliverables),
    JSON.stringify(definition.constraints),
    JSON.stringify(definition.assumptions),
    definition.estimatedScope,
    definition.confidence,
    definition.parentDirectionId ?? null,
    definition.candidateParent?.projectId ?? null,
    definition.version,
    now,
    now,
  );
  return getWorkDefinition(Number(result.lastInsertRowid))!;
}

export function createProjectGraph(input: {
  definition: WorkDefinition;
  decomposition: ProjectDecomposition;
}): { definition: StoredWorkDefinition; project: ProjectRecord; milestones: ProjectMilestoneRecord[] } {
  const create = rawDb.transaction(() => {
    const definition = createConfirmedWorkDefinition(input.definition);
    const now = Date.now();
    const fingerprint = workFingerprint(input.decomposition);
    const projectResult = rawDb.prepare(`
      INSERT INTO projects (
        title, objective, why_now, desired_outcome, success_criteria, deliverables,
        status, related_track_id, work_definition_id, current_milestone_id,
        decomposition_model, decomposition_fingerprint, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      input.definition.title,
      input.definition.objective,
      input.definition.whyNow,
      input.definition.desiredOutcome,
      JSON.stringify(input.definition.successCriteria),
      JSON.stringify(input.definition.deliverables),
      input.definition.parentDirectionId ?? null,
      definition.id,
      JSON.stringify(input.decomposition),
      fingerprint,
      now,
      now,
    );
    const projectId = Number(projectResult.lastInsertRowid);
    const insertMilestone = rawDb.prepare(`
      INSERT INTO project_milestones (
        project_id, milestone_key, title, outcome, done_when, status, sequence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const milestone of input.decomposition.milestones) {
      insertMilestone.run(
        projectId,
        milestone.key,
        milestone.title,
        milestone.outcome,
        milestone.doneWhen,
        milestone.key === input.decomposition.currentMilestoneKey ? "active" : "proposed",
        milestone.sequence,
        now,
        now,
      );
    }
    const milestones = listProjectMilestones(projectId);
    const current = milestones.find((milestone) => milestone.milestoneKey === input.decomposition.currentMilestoneKey) || milestones[0];
    rawDb.prepare("UPDATE projects SET current_milestone_id = ?, updated_at = ? WHERE id = ?").run(current?.id ?? null, now, projectId);
    return { definition, project: getProject(projectId)!, milestones };
  });
  return create();
}

export function linkTaskToProject(input: { projectId: number; milestoneId?: number | null; taskId: number; role?: string }) {
  const now = Date.now();
  rawDb.prepare(`
    INSERT INTO project_task_links (project_id, milestone_id, task_id, role, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET project_id = excluded.project_id, milestone_id = excluded.milestone_id, role = excluded.role
  `).run(input.projectId, input.milestoneId ?? null, input.taskId, input.role || "active_task", now);
  return projectLinkForTask(input.taskId)!;
}

export function updateProjectDecomposition(projectId: number, decomposition: ProjectDecomposition) {
  rawDb.prepare("UPDATE projects SET decomposition_model = ?, decomposition_fingerprint = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(decomposition), workFingerprint(decomposition), Date.now(), projectId);
  return getProject(projectId);
}

export function updateMilestoneStatus(milestoneId: number, status: string) {
  rawDb.prepare("UPDATE project_milestones SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), milestoneId);
}

export function removeProjectGraph(projectId: number) {
  const remove = rawDb.transaction(() => {
    const project = getProject(projectId);
    if (!project) return;
    rawDb.prepare("DELETE FROM project_task_links WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM project_milestones WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    rawDb.prepare("DELETE FROM work_definitions WHERE id = ?").run(project.workDefinitionId);
  });
  remove();
}
