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
  curriculumSchemaReady = true;
}

// Test-only: lets a suite that truncates/reopens DBs force the next call to run.
export function __resetCurriculumSchemaGuardForTest(): void {
  curriculumSchemaReady = false;
}
