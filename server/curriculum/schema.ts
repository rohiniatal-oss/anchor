import { rawDb } from "../storage";
import { CURRICULUM_DDL } from "./ddl";

// Module-level "already ensured" guard. The DDL is also part of SPINE_DDL (run on
// every DB open), so this is normally a no-op at boot. The guard means a later
// call from a pure GET read path never re-executes DDL — which the read-purity
// guard would otherwise reject with a 405. Mirrors the ownership-schema fix.
let curriculumSchemaReady = false;

export function ensureCurriculumSchema(): void {
  if (curriculumSchemaReady) return;
  rawDb.exec(CURRICULUM_DDL);
  // Additive migration for DBs created before the day↔plan-item link existed.
  // CREATE TABLE IF NOT EXISTS will not add a column to an existing table, so add
  // it idempotently (sqlite has no ADD COLUMN IF NOT EXISTS).
  try {
    rawDb.exec("ALTER TABLE curriculum_days ADD COLUMN day_plan_item_id INTEGER");
  } catch {
    // Column already exists — expected on every boot after the first.
  }
  curriculumSchemaReady = true;
}

// Test-only: lets a suite that truncates/reopens DBs force the next call to run.
export function __resetCurriculumSchemaGuardForTest(): void {
  curriculumSchemaReady = false;
}
