/**
 * Persistence + hydration for the living curriculum. Uses the shared rawDb handle
 * and the same prepared-statement style as the rest of the server (no new ORM).
 */
import { rawDb } from "../storage";
import { ensureCurriculumSchema } from "./schema";
import { addDays, todayYmd } from "./dates";
import type {
  ComposedCurriculum,
  ComposeInput,
  CurriculumEvent,
  PersistedCurriculum,
  PersistedDay,
  PersistedModule,
  PersistedSource,
} from "./types";

// Spine sources are load-bearing, so they enter a "pending" verification state
// (verification itself is stubbed for the prototype — see PR notes). Secondary
// sources are explicitly unverified.
function verificationFor(tier: string): { status: string; verified: number } {
  return tier === "spine"
    ? { status: "pending", verified: 0 }
    : { status: "unverified", verified: 0 };
}

type CurriculumRow = {
  id: number; track_id: number; theme: string; summary: string; weeks: number;
  hours_per_day: number; capstone_shape: string; status: string; start_date: string;
  composed_json: string; model: string; created_at: number; updated_at: number;
};
type ModuleRow = {
  id: number; curriculum_id: number; week_number: number; title: string; focus: string;
  objective: string; sequence: number;
};
type DayRow = {
  id: number; curriculum_id: number; module_id: number; day_index: number; planned_date: string;
  title: string; focus: string; activity: string; done_when: string; hours: number; status: string;
  sequence: number; completed_at: number | null; skipped_at: number | null;
};
type SourceRow = {
  id: number; curriculum_id: number; module_id: number; tier: string; title: string; author: string;
  url: string; why: string; verification_status: string; verified: number; sequence: number;
};
type CapstoneRow = { shape: string; title: string; description: string; done_when: string };
type EventRow = { id: number; curriculum_id: number; event_type: string; day_id: number | null; payload: string; created_at: number };

/**
 * Persist a validated ComposedCurriculum and materialise its days onto a calendar
 * starting at startDate (default today): one curriculum-day per consecutive
 * calendar day. Returns the curriculum id.
 */
export function persistComposedCurriculum(
  trackId: number,
  input: ComposeInput,
  composed: ComposedCurriculum,
  model = "",
): number {
  ensureCurriculumSchema();
  const now = Date.now();
  const startDate = input.startDate || todayYmd();

  const insertCurriculum = rawDb.prepare(`
    INSERT INTO curricula (track_id, theme, summary, weeks, hours_per_day, capstone_shape, status, start_date, composed_json, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `);
  const insertModule = rawDb.prepare(`
    INSERT INTO curriculum_modules (curriculum_id, week_number, title, focus, objective, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDay = rawDb.prepare(`
    INSERT INTO curriculum_days (curriculum_id, module_id, day_index, planned_date, title, focus, activity, done_when, hours, status, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)
  `);
  const insertSource = rawDb.prepare(`
    INSERT INTO curriculum_sources (curriculum_id, module_id, tier, title, author, url, why, verification_status, verified, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCapstone = rawDb.prepare(`
    INSERT INTO curriculum_capstone (curriculum_id, shape, title, description, done_when, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = rawDb.transaction(() => {
    const curriculumId = Number(insertCurriculum.run(
      trackId,
      composed.theme,
      composed.summary || "",
      composed.weeks,
      Math.round(composed.hoursPerDay),
      composed.capstone.shape,
      startDate,
      JSON.stringify(composed),
      model,
      now,
      now,
    ).lastInsertRowid);

    let dayIndex = 0;
    composed.modules.forEach((mod, modSeq) => {
      const moduleId = Number(insertModule.run(
        curriculumId, mod.weekNumber, mod.title, mod.focus || "", mod.objective || "", modSeq, now,
      ).lastInsertRowid);

      (mod.sources || []).forEach((src, srcSeq) => {
        const v = verificationFor(src.tier);
        insertSource.run(
          curriculumId, moduleId, src.tier, src.title, src.author || "", src.url || "",
          src.why || "", v.status, v.verified, srcSeq, now,
        );
      });

      mod.days.forEach((day) => {
        const plannedDate = addDays(startDate, dayIndex);
        insertDay.run(
          curriculumId, moduleId, dayIndex, plannedDate, day.title, day.focus || "",
          day.activity || "", day.doneWhen || "", Math.round(day.hours ?? composed.hoursPerDay), dayIndex, now,
        );
        dayIndex += 1;
      });
    });

    insertCapstone.run(
      curriculumId, composed.capstone.shape, composed.capstone.title,
      composed.capstone.description || "", composed.capstone.doneWhen || "", now,
    );

    return curriculumId;
  });

  return tx();
}

function rowToSource(row: SourceRow): PersistedSource {
  return {
    id: row.id, tier: row.tier as PersistedSource["tier"], title: row.title, author: row.author,
    url: row.url, why: row.why, verificationStatus: row.verification_status, verified: !!row.verified,
  };
}

function rowToDay(row: DayRow): PersistedDay {
  return {
    id: row.id, moduleId: row.module_id, dayIndex: row.day_index, plannedDate: row.planned_date,
    title: row.title, focus: row.focus, activity: row.activity, doneWhen: row.done_when,
    hours: row.hours, status: row.status as PersistedDay["status"], sequence: row.sequence,
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    skippedAt: row.skipped_at == null ? null : Number(row.skipped_at),
  };
}

export function getCurriculum(id: number): PersistedCurriculum | null {
  ensureCurriculumSchema();
  const row = rawDb.prepare("SELECT * FROM curricula WHERE id = ?").get(id) as CurriculumRow | undefined;
  if (!row) return null;

  const modules = rawDb.prepare("SELECT * FROM curriculum_modules WHERE curriculum_id = ? ORDER BY sequence, id").all(id) as ModuleRow[];
  const days = rawDb.prepare("SELECT * FROM curriculum_days WHERE curriculum_id = ? ORDER BY sequence, id").all(id) as DayRow[];
  const sources = rawDb.prepare("SELECT * FROM curriculum_sources WHERE curriculum_id = ? ORDER BY sequence, id").all(id) as SourceRow[];
  const capstone = rawDb.prepare("SELECT shape, title, description, done_when FROM curriculum_capstone WHERE curriculum_id = ? ORDER BY id LIMIT 1").get(id) as CapstoneRow | undefined;

  const daysByModule = new Map<number, PersistedDay[]>();
  for (const d of days) {
    const list = daysByModule.get(d.module_id) || [];
    list.push(rowToDay(d));
    daysByModule.set(d.module_id, list);
  }
  const sourcesByModule = new Map<number, PersistedSource[]>();
  for (const s of sources) {
    const list = sourcesByModule.get(s.module_id) || [];
    list.push(rowToSource(s));
    sourcesByModule.set(s.module_id, list);
  }

  const hydratedModules: PersistedModule[] = modules.map((m) => ({
    id: m.id, weekNumber: m.week_number, title: m.title, focus: m.focus, objective: m.objective,
    sequence: m.sequence, sources: sourcesByModule.get(m.id) || [], days: daysByModule.get(m.id) || [],
  }));

  return {
    id: row.id, trackId: row.track_id, theme: row.theme, summary: row.summary, weeks: row.weeks,
    hoursPerDay: row.hours_per_day, capstoneShape: row.capstone_shape, status: row.status,
    startDate: row.start_date, model: row.model, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    capstone: capstone
      ? { shape: capstone.shape, title: capstone.title, description: capstone.description, doneWhen: capstone.done_when }
      : null,
    modules: hydratedModules,
  };
}

export function listCurricula(trackId?: number): PersistedCurriculum[] {
  ensureCurriculumSchema();
  const rows = trackId
    ? rawDb.prepare("SELECT id FROM curricula WHERE track_id = ? ORDER BY created_at DESC, id DESC").all(trackId) as { id: number }[]
    : rawDb.prepare("SELECT id FROM curricula ORDER BY created_at DESC, id DESC").all() as { id: number }[];
  return rows.map((r) => getCurriculum(r.id)).filter((c): c is PersistedCurriculum => c != null);
}

export function getDay(curriculumId: number, dayId: number): PersistedDay | null {
  ensureCurriculumSchema();
  const row = rawDb.prepare("SELECT * FROM curriculum_days WHERE id = ? AND curriculum_id = ?").get(dayId, curriculumId) as DayRow | undefined;
  return row ? rowToDay(row) : null;
}

export function recordCurriculumEvent(curriculumId: number, eventType: string, dayId: number | null, payload: Record<string, unknown>): void {
  ensureCurriculumSchema();
  rawDb.prepare(`
    INSERT INTO curriculum_events (curriculum_id, event_type, day_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(curriculumId, eventType, dayId, JSON.stringify(payload || {}), Date.now());
}

export function getCurriculumEvents(curriculumId: number, eventType?: string): CurriculumEvent[] {
  ensureCurriculumSchema();
  const rows = (eventType
    ? rawDb.prepare("SELECT * FROM curriculum_events WHERE curriculum_id = ? AND event_type = ? ORDER BY created_at, id").all(curriculumId, eventType)
    : rawDb.prepare("SELECT * FROM curriculum_events WHERE curriculum_id = ? ORDER BY created_at, id").all(curriculumId)) as EventRow[];
  return rows.map((r) => ({
    id: r.id, curriculumId: r.curriculum_id, eventType: r.event_type,
    dayId: r.day_id == null ? null : Number(r.day_id),
    payload: (() => { try { return JSON.parse(r.payload); } catch { return {}; } })(),
    createdAt: Number(r.created_at),
  }));
}

export function touchCurriculum(id: number): void {
  rawDb.prepare("UPDATE curricula SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}
