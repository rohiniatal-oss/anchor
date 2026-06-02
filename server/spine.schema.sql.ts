// Raw DDL mirroring shared/schema.ts — used ONLY by the spine test harness to
// stand up a throwaway sqlite DB without invoking drizzle-kit push (which is
// interactive). Kept beside the tests so a schema change here is obvious.
export const SPINE_DDL = `
CREATE TABLE tasks (
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
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start TEXT NOT NULL DEFAULT '',
  end TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE jobs (
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
  created_at INTEGER NOT NULL
);
CREATE TABLE job_pipeline_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  sequence INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  task_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE proof_asset_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hustle_id INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  sequence INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  task_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE learn (
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
  output_evidence_url TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '[]',
  unlocks TEXT NOT NULL DEFAULT '[]',
  related_track_id INTEGER,
  proof_intent INTEGER NOT NULL DEFAULT 0,
  deadline_confidence TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE hustles (
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
CREATE TABLE wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  win_category TEXT NOT NULL DEFAULT 'mindset',
  track_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE contacts (
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
CREATE TABLE career_tracks (
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
CREATE TABLE day_plans (
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
CREATE TABLE day_plan_items (
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
CREATE TABLE entity_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT '',
  source_id INTEGER,
  task_id INTEGER,
  plan_item_id INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL
);
`;
