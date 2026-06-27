// Raw DDL for the living-curriculum subsystem. Kept in its own import-free module
// so it can be appended to SPINE_DDL (so every opened DB gets the tables) without
// creating an import cycle with storage.ts. ensureCurriculumSchema() in schema.ts
// runs the same DDL idempotently. CREATE TABLE IF NOT EXISTS makes both safe.
export const CURRICULUM_DDL = `
CREATE TABLE IF NOT EXISTS curricula (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  weeks INTEGER NOT NULL DEFAULT 0,
  hours_per_day INTEGER NOT NULL DEFAULT 0,
  capstone_shape TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  start_date TEXT NOT NULL DEFAULT '',
  composed_json TEXT NOT NULL DEFAULT '{}',
  model TEXT NOT NULL DEFAULT '',
  standing_obligations_json TEXT NOT NULL DEFAULT '[]',
  milestones_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL,
  week_number INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL,
  module_id INTEGER NOT NULL,
  day_index INTEGER NOT NULL DEFAULT 0,
  planned_date TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  activity TEXT NOT NULL DEFAULT '',
  done_when TEXT NOT NULL DEFAULT '',
  hours INTEGER NOT NULL DEFAULT 0,
  morning_json TEXT NOT NULL DEFAULT 'null',
  afternoon_json TEXT NOT NULL DEFAULT 'null',
  status TEXT NOT NULL DEFAULT 'planned',
  sequence INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  skipped_at INTEGER,
  day_plan_item_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL,
  day_id INTEGER NOT NULL,
  artifact_number INTEGER NOT NULL DEFAULT 0,
  technique_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  word_target INTEGER,
  save_as TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  draft TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  submitted_at INTEGER
);
CREATE TABLE IF NOT EXISTS curriculum_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL,
  module_id INTEGER NOT NULL,
  tier TEXT NOT NULL DEFAULT 'secondary',
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum_capstone (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL,
  shape TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  done_when TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  day_id INTEGER,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_curriculum_modules_curriculum ON curriculum_modules(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_days_curriculum ON curriculum_days(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_days_module ON curriculum_days(module_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_days_plan_item ON curriculum_days(day_plan_item_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_artifacts_curriculum ON curriculum_artifacts(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_artifacts_day ON curriculum_artifacts(day_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_sources_curriculum ON curriculum_sources(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_capstone_curriculum ON curriculum_capstone(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_events_curriculum ON curriculum_events(curriculum_id, created_at);
`;
