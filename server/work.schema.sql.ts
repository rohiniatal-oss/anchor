export const WORK_DDL = `
CREATE TABLE IF NOT EXISTS work_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL DEFAULT 'capture',
  source_id INTEGER,
  work_type TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  why_now TEXT NOT NULL DEFAULT '',
  desired_outcome TEXT NOT NULL,
  success_criteria TEXT NOT NULL DEFAULT '[]',
  deliverables TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  assumptions TEXT NOT NULL DEFAULT '[]',
  estimated_scope TEXT NOT NULL DEFAULT 'single_session',
  confidence TEXT NOT NULL DEFAULT 'medium',
  parent_direction_id INTEGER,
  candidate_parent_project_id INTEGER,
  status TEXT NOT NULL DEFAULT 'confirmed',
  interpretation_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  why_now TEXT NOT NULL DEFAULT '',
  desired_outcome TEXT NOT NULL,
  success_criteria TEXT NOT NULL DEFAULT '[]',
  deliverables TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  related_track_id INTEGER,
  work_definition_id INTEGER NOT NULL,
  current_milestone_id INTEGER,
  decomposition_model TEXT NOT NULL DEFAULT '{}',
  decomposition_fingerprint TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  milestone_key TEXT NOT NULL,
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  done_when TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, milestone_key)
);

CREATE TABLE IF NOT EXISTS project_task_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  milestone_id INTEGER,
  task_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'active_task',
  created_at INTEGER NOT NULL,
  UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_work_definitions_source ON work_definitions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_projects_track_status ON projects(related_track_id, status);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id, sequence);
CREATE INDEX IF NOT EXISTS idx_project_task_links_project ON project_task_links(project_id, milestone_id);
`;
