// Raw DDL mirroring shared/schema.ts. Applied idempotently by storage.ts on DB
// open so every DB the app touches (prod data.db, dev, and throwaway test DBs)
// has the full current schema without invoking drizzle-kit push (interactive).
// CREATE TABLE IF NOT EXISTS makes this safe to run on an already-pushed DB.
// Kept as one place so a schema change here is obvious and shared everywhere.
export const SPINE_DDL = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  list TEXT NOT NULL DEFAULT 'inbox',
  block TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  steps TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'admin',
  deadline TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'not_started',
  skipped INTEGER NOT NULL DEFAULT 0,
  done_when TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT '',
  source_id INTEGER,
  source_step_type TEXT NOT NULL DEFAULT '',
  source_step_id INTEGER,
  source_url TEXT NOT NULL DEFAULT '',
  source_note TEXT NOT NULL DEFAULT '',
  source_status TEXT NOT NULL DEFAULT '',
  plan_item_id INTEGER,
  related_track_id INTEGER,
  related_opportunity_id INTEGER,
  parent_task_id INTEGER,
  depends_on TEXT NOT NULL DEFAULT '[]',
  blocks TEXT NOT NULL DEFAULT '[]',
  blocked_by TEXT NOT NULL DEFAULT '',
  blocker_reason TEXT NOT NULL DEFAULT '',
  readiness TEXT NOT NULL DEFAULT 'ready',
  minimum_outcome TEXT NOT NULL DEFAULT '',
  stretch_outcome TEXT NOT NULL DEFAULT '',
  estimate_minutes INTEGER,
  estimate_confidence TEXT NOT NULL DEFAULT '',
  estimate_reason TEXT NOT NULL DEFAULT '',
  actual_minutes INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start TEXT NOT NULL DEFAULT '',
  end TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'wishlist',
  deadline TEXT NOT NULL DEFAULT '',
  flag TEXT NOT NULL DEFAULT '',
  role_archetype TEXT NOT NULL DEFAULT '',
  opportunity_kind TEXT NOT NULL DEFAULT 'job',
  fit_score INTEGER,
  stretch_score INTEGER,
  strategic_value INTEGER,
  friction_score INTEGER,
  eligibility_risk TEXT NOT NULL DEFAULT '',
  warm_path_score INTEGER,
  application_readiness TEXT NOT NULL DEFAULT 'none',
  narrative_angle TEXT NOT NULL DEFAULT '',
  related_track_id INTEGER,
  source_url TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT '',
  source_checked_at INTEGER,
  deadline_confidence TEXT NOT NULL DEFAULT '',
  application_window_status TEXT NOT NULL DEFAULT 'open',
  jd_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS job_pipeline_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  sequence INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  task_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS proof_asset_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hustle_id INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  sequence INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  task_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS learn (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  cost TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'resource',
  learn_status TEXT NOT NULL DEFAULT 'open',
  application_deadline TEXT NOT NULL DEFAULT '',
  program_start TEXT NOT NULL DEFAULT '',
  program_end TEXT NOT NULL DEFAULT '',
  time_required TEXT NOT NULL DEFAULT '',
  capability_built TEXT NOT NULL DEFAULT '',
  required_output TEXT NOT NULL DEFAULT '',
  output_title TEXT NOT NULL DEFAULT '',
  output_status TEXT NOT NULL DEFAULT '',
  output_evidence_url TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '[]',
  unlocks TEXT NOT NULL DEFAULT '[]',
  related_track_id INTEGER,
  source_type TEXT NOT NULL DEFAULT '',
  source_id INTEGER,
  proof_intent INTEGER NOT NULL DEFAULT 0,
  deadline_confidence TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hustles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'idea',
  audience TEXT NOT NULL DEFAULT '',
  core_claim TEXT NOT NULL DEFAULT '',
  content_pillar TEXT NOT NULL DEFAULT '',
  first_post_idea TEXT NOT NULL DEFAULT '',
  publishing_cadence TEXT NOT NULL DEFAULT '',
  proof_asset_for_track INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  win_category TEXT NOT NULL DEFAULT 'mindset',
  track_id INTEGER,
  source_entity_type TEXT,
  source_entity_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  who TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'to_contact',
  note TEXT NOT NULL DEFAULT '',
  relationship_strength TEXT NOT NULL DEFAULT 'cold',
  source_network TEXT NOT NULL DEFAULT '',
  target_org TEXT NOT NULL DEFAULT '',
  target_role TEXT NOT NULL DEFAULT '',
  ask_type TEXT NOT NULL DEFAULT '',
  message_draft TEXT NOT NULL DEFAULT '',
  last_message TEXT NOT NULL DEFAULT '',
  next_follow_up_date TEXT NOT NULL DEFAULT '',
  referral_potential TEXT NOT NULL DEFAULT '',
  warmth_score INTEGER,
  related_track_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS career_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_role_archetype TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  why_it_fits TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS day_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'normal',
  energy TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'active',
  minimum_viable_item_id INTEGER,
  enough_for_today INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS day_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  slot TEXT NOT NULL DEFAULT 'now',
  source_type TEXT NOT NULL DEFAULT 'task',
  source_id INTEGER,
  task_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  why_selected TEXT NOT NULL DEFAULT '',
  done_when TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  planned_for TEXT NOT NULL DEFAULT '',
  started_at INTEGER,
  completed_at INTEGER,
  skipped_at INTEGER,
  moved_at INTEGER,
  parked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT '',
  source_id INTEGER,
  task_id INTEGER,
  plan_item_id INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cv_text TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL DEFAULT 'career',
  concern TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  recommended_route TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL DEFAULT 'learning-corpus',
  kind TEXT NOT NULL DEFAULT 'learning-resource',
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'llm',
  title TEXT NOT NULL,
  why_suggested TEXT NOT NULL DEFAULT '',
  linked_track_id INTEGER,
  linked_gap_key TEXT NOT NULL DEFAULT '',
  linked_combination TEXT NOT NULL DEFAULT '',
  confidence_score INTEGER,
  freshness_label TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  rank_score INTEGER,
  rank_reason TEXT NOT NULL DEFAULT '',
  execution_shape TEXT NOT NULL DEFAULT 'single-step',
  acceptance_entity_type TEXT NOT NULL DEFAULT '',
  acceptance_draft TEXT NOT NULL DEFAULT '{}',
  duplicate_of_id INTEGER,
  context_hash TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  accepted_at INTEGER,
  rejected_at INTEGER
);
CREATE TABLE IF NOT EXISTS recommendation_subdivisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER NOT NULL,
  subdivision_key TEXT NOT NULL,
  label TEXT NOT NULL,
  why_it_matters TEXT NOT NULL DEFAULT '',
  suggested_materials TEXT NOT NULL DEFAULT '[]',
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recommendation_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER NOT NULL,
  milestone_key TEXT NOT NULL,
  label TEXT NOT NULL,
  done_when TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  sequence INTEGER NOT NULL DEFAULT 0,
  suggested_task_title TEXT NOT NULL DEFAULT '',
  subdivision_key TEXT NOT NULL DEFAULT '',
  milestone_type TEXT NOT NULL DEFAULT 'content',
  scaffolding TEXT NOT NULL DEFAULT '',
  completion_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS network_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  archetype TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL DEFAULT '',
  why_it_matters TEXT NOT NULL DEFAULT '',
  what_to_ask TEXT NOT NULL DEFAULT '',
  suggested_searches TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  archetype TEXT NOT NULL,
  relevance_score INTEGER NOT NULL DEFAULT 0,
  access_types TEXT NOT NULL DEFAULT '[]',
  reasoning TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_tasks_list_done ON tasks(list, done);
CREATE INDEX IF NOT EXISTS idx_day_plan_items_plan ON day_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_day_plan_items_task ON day_plan_items(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_log_source ON activity_log(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_wins_track ON wins(track_id);
CREATE INDEX IF NOT EXISTS idx_wins_created ON wins(created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_track ON contacts(related_track_id);
CREATE INDEX IF NOT EXISTS idx_contact_classifications_contact ON contact_classifications(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact ON contact_interactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_network_gaps_track ON network_gaps(track_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_milestones_rec ON recommendation_milestones(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;

// Migrations for columns added to existing tables after initial release.
// Each is run individually with try/catch so it is a no-op if already applied.
export const SPINE_MIGRATIONS = [
  `ALTER TABLE jobs ADD COLUMN jd_text TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE learn ADD COLUMN output_title TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE learn ADD COLUMN output_status TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE learn ADD COLUMN source_type TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE learn ADD COLUMN source_id INTEGER`,
  `ALTER TABLE tasks ADD COLUMN source_step_type TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE tasks ADD COLUMN source_step_id INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_source_step ON tasks(source_step_type, source_step_id)`,
  `ALTER TABLE recommendation_milestones ADD COLUMN milestone_type TEXT NOT NULL DEFAULT 'content'`,
  `ALTER TABLE recommendation_milestones ADD COLUMN scaffolding TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE recommendation_milestones ADD COLUMN completion_note TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE contacts ADD COLUMN outreachedAt INTEGER`,
  `ALTER TABLE contacts ADD COLUMN repliedAt INTEGER`,
  `ALTER TABLE contacts ADD COLUMN nextActionType TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE contacts ADD COLUMN nextActionDue INTEGER`,
  `ALTER TABLE contacts ADD COLUMN nextActionDesc TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE jobs ADD COLUMN reject_reason TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE wins ADD COLUMN source_entity_type TEXT`,
  `ALTER TABLE wins ADD COLUMN source_entity_id INTEGER`,
  `ALTER TABLE recommendations ADD COLUMN context_hash TEXT`,
  `ALTER TABLE contacts ADD COLUMN linkedin_url TEXT NOT NULL DEFAULT ''`,
];
