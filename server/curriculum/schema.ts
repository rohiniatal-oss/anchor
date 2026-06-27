import { rawDb } from "../storage";
import { CURRICULUM_DDL } from "./ddl";

// Module-level "already ensured" guard. The DDL is also part of SPINE_DDL (run on
// every DB open), so this is normally a no-op at boot. The guard means a later
// call from a pure GET read path never re-executes DDL — which the read-purity
// guard would otherwise reject with a 405. Mirrors the ownership-schema fix.
let curriculumSchemaReady = false;

function addColumnIfMissing(table: string, column: string, definition: string): void {
  try {
    rawDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    const message = String((err as Error)?.message || err);
    if (!/duplicate column name/i.test(message)) throw err;
  }
}

export function ensureCurriculumSchema(): void {
  if (curriculumSchemaReady) return;
  rawDb.exec(CURRICULUM_DDL);
  // Additive migrations for DBs created before later prototype fields existed.
  // CREATE TABLE IF NOT EXISTS will not add columns to existing tables, and sqlite
  // has no ADD COLUMN IF NOT EXISTS.
  addColumnIfMissing("curriculum_days", "day_plan_item_id", "INTEGER");
  addColumnIfMissing("curriculum_modules", "phase_title", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("curriculum_modules", "rationale", "TEXT NOT NULL DEFAULT ''");
  curriculumSchemaReady = true;
}

// Test-only: lets a suite that truncates/reopens DBs force the next call to run.
export function __resetCurriculumSchemaGuardForTest(): void {
  curriculumSchemaReady = false;
}
