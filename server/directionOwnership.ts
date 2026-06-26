import type { Contact, Hustle, Job, Learn } from "@shared/schema";
import { rawDb, storage } from "./storage";

export const DIRECTION_OWNERSHIP_STATES = [
  "linked_to_direction",
  "candidate_for_direction",
  "unclassified_capture",
] as const;

export type DirectionOwnershipState = (typeof DIRECTION_OWNERSHIP_STATES)[number];
export type DirectionEntityType = "job" | "learn" | "contact" | "hustle";

type DirectionEntity = Job | Learn | Contact | Hustle;

type DirectionOwnershipRow = {
  id: number;
  entity_type: DirectionEntityType;
  entity_id: number;
  ownership_state: DirectionOwnershipState;
  track_id: number | null;
  candidate_track_id: number | null;
  reason: string;
  source: string;
  created_at: number;
  updated_at: number;
};

export type DirectionOwnershipView = {
  entityType: DirectionEntityType;
  entityId: number;
  title: string;
  ownershipState: DirectionOwnershipState;
  trackId: number | null;
  candidateTrackId: number | null;
  reason: string;
  persisted: boolean;
  source: string;
};

export type DirectionOwnershipAudit = {
  totals: Record<DirectionOwnershipState, number> & { total: number };
  objects: DirectionOwnershipView[];
  readOnlySnapshot: true;
};

const ENTITY_TYPES: DirectionEntityType[] = ["job", "learn", "contact", "hustle"];

function compact(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function tableName(type: DirectionEntityType) {
  return type === "job" ? "jobs" : type === "learn" ? "learn" : type === "contact" ? "contacts" : "hustles";
}

function validEntityType(value: unknown): value is DirectionEntityType {
  return ENTITY_TYPES.includes(value as DirectionEntityType);
}

function validState(value: unknown): value is DirectionOwnershipState {
  return DIRECTION_OWNERSHIP_STATES.includes(value as DirectionOwnershipState);
}

function titleFor(type: DirectionEntityType, entity: DirectionEntity) {
  if (type === "job") {
    const job = entity as Job;
    return [job.title, job.company].filter(Boolean).join(" · ") || `Job ${job.id}`;
  }
  if (type === "learn") return (entity as Learn).title || `Learn ${entity.id}`;
  if (type === "contact") {
    const contact = entity as Contact;
    return contact.name || contact.who || `Contact ${contact.id}`;
  }
  return (entity as Hustle).title || `Proof asset ${entity.id}`;
}

function linkedTrackId(type: DirectionEntityType, entity: DirectionEntity): number | null {
  const value = type === "hustle"
    ? Number((entity as Hustle).proofAssetForTrack)
    : Number((entity as Job | Learn | Contact).relatedTrackId);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function defaultReason(type: DirectionEntityType, entity: DirectionEntity) {
  const trackId = linkedTrackId(type, entity);
  if (trackId) return "The source object has an explicit direction link.";
  return "No direction link is stored yet, so Anchor treats this as explicitly unclassified until a direction is selected.";
}

export function ensureDirectionOwnershipSchema() {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS direction_ownerships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      ownership_state TEXT NOT NULL DEFAULT 'unclassified_capture',
      track_id INTEGER,
      candidate_track_id INTEGER,
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'system',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_direction_ownership_entity ON direction_ownerships(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_direction_ownership_track ON direction_ownerships(track_id);
    CREATE INDEX IF NOT EXISTS idx_direction_ownership_candidate ON direction_ownerships(candidate_track_id);
    CREATE INDEX IF NOT EXISTS idx_direction_ownership_state ON direction_ownerships(ownership_state);
  `);
}

function ownershipRows() {
  ensureDirectionOwnershipSchema();
  return rawDb.prepare("SELECT * FROM direction_ownerships").all() as DirectionOwnershipRow[];
}

function rowByKey() {
  const map = new Map<string, DirectionOwnershipRow>();
  for (const row of ownershipRows()) map.set(`${row.entity_type}:${row.entity_id}`, row);
  return map;
}

async function objectsFor(type: DirectionEntityType): Promise<DirectionEntity[]> {
  if (type === "job") return storage.getJobs();
  if (type === "learn") return storage.getLearn();
  if (type === "contact") return storage.getContacts();
  return storage.getHustles();
}

async function objectById(type: DirectionEntityType, id: number): Promise<DirectionEntity | null> {
  const objects = await objectsFor(type);
  return objects.find((object) => object.id === id) || null;
}

function viewFor(type: DirectionEntityType, entity: DirectionEntity, row?: DirectionOwnershipRow): DirectionOwnershipView {
  const sourceTrackId = linkedTrackId(type, entity);
  if (sourceTrackId) {
    return {
      entityType: type,
      entityId: entity.id,
      title: titleFor(type, entity),
      ownershipState: "linked_to_direction",
      trackId: sourceTrackId,
      candidateTrackId: null,
      reason: row?.reason || defaultReason(type, entity),
      persisted: Boolean(row),
      source: row?.source || "derived_from_object_link",
    };
  }

  if (row && validState(row.ownership_state)) {
    return {
      entityType: type,
      entityId: entity.id,
      title: titleFor(type, entity),
      ownershipState: row.ownership_state,
      trackId: row.track_id || null,
      candidateTrackId: row.candidate_track_id || null,
      reason: row.reason || defaultReason(type, entity),
      persisted: true,
      source: row.source || "registry",
    };
  }

  return {
    entityType: type,
    entityId: entity.id,
    title: titleFor(type, entity),
    ownershipState: "unclassified_capture",
    trackId: null,
    candidateTrackId: null,
    reason: defaultReason(type, entity),
    persisted: false,
    source: "derived_unclassified",
  };
}

export async function buildDirectionOwnershipAudit(): Promise<DirectionOwnershipAudit> {
  const rows = rowByKey();
  const objects: DirectionOwnershipView[] = [];
  for (const type of ENTITY_TYPES) {
    for (const entity of await objectsFor(type)) {
      objects.push(viewFor(type, entity, rows.get(`${type}:${entity.id}`)));
    }
  }
  const totals = {
    linked_to_direction: 0,
    candidate_for_direction: 0,
    unclassified_capture: 0,
    total: objects.length,
  };
  for (const object of objects) totals[object.ownershipState] += 1;
  return { totals, objects, readOnlySnapshot: true };
}

function upsertOwnership(input: {
  entityType: DirectionEntityType;
  entityId: number;
  ownershipState: DirectionOwnershipState;
  trackId?: number | null;
  candidateTrackId?: number | null;
  reason: string;
  source: string;
}) {
  ensureDirectionOwnershipSchema();
  const now = Date.now();
  rawDb.prepare(`
    INSERT INTO direction_ownerships (
      entity_type, entity_id, ownership_state, track_id, candidate_track_id, reason, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      ownership_state = excluded.ownership_state,
      track_id = excluded.track_id,
      candidate_track_id = excluded.candidate_track_id,
      reason = excluded.reason,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(
    input.entityType,
    input.entityId,
    input.ownershipState,
    input.trackId ?? null,
    input.candidateTrackId ?? null,
    input.reason,
    input.source,
    now,
    now,
  );
}

export async function backfillDirectionOwnerships() {
  const changed: DirectionOwnershipView[] = [];
  const rows = rowByKey();
  for (const type of ENTITY_TYPES) {
    for (const entity of await objectsFor(type)) {
      const existing = rows.get(`${type}:${entity.id}`);
      const derived = viewFor(type, entity, existing);
      if (existing && existing.ownership_state === derived.ownershipState && (existing.track_id || null) === derived.trackId && (existing.candidate_track_id || null) === derived.candidateTrackId) {
        continue;
      }
      upsertOwnership({
        entityType: type,
        entityId: entity.id,
        ownershipState: derived.ownershipState,
        trackId: derived.trackId,
        candidateTrackId: derived.candidateTrackId,
        reason: derived.reason,
        source: derived.source === "derived_unclassified" ? "backfill_unclassified" : "backfill_linked",
      });
      changed.push({ ...derived, persisted: true });
    }
  }
  return { changed, audit: await buildDirectionOwnershipAudit() };
}

async function updateObjectTrackLink(type: DirectionEntityType, id: number, trackId: number | null) {
  if (type === "hustle") return storage.updateHustle(id, { proofAssetForTrack: trackId } as any);
  if (type === "job") return storage.updateJob(id, { relatedTrackId: trackId } as any);
  if (type === "learn") return storage.updateLearn(id, { relatedTrackId: trackId } as any);
  return storage.updateContact(id, { relatedTrackId: trackId } as any);
}

export async function setDirectionOwnership(input: {
  entityType: DirectionEntityType;
  entityId: number;
  ownershipState: DirectionOwnershipState;
  trackId?: number | null;
  candidateTrackId?: number | null;
  reason?: string;
  source?: string;
  confirmUnlink?: boolean;
}) {
  if (!validEntityType(input.entityType)) throw new Error("Unsupported entity type");
  if (!validState(input.ownershipState)) throw new Error("Unsupported ownership state");
  const entity = await objectById(input.entityType, input.entityId);
  if (!entity) return null;

  const existingTrackId = linkedTrackId(input.entityType, entity);
  if (input.ownershipState === "linked_to_direction") {
    const trackId = Number(input.trackId);
    if (!Number.isFinite(trackId) || trackId <= 0) throw new Error("linked_to_direction requires trackId");
    await updateObjectTrackLink(input.entityType, input.entityId, trackId);
    upsertOwnership({
      entityType: input.entityType,
      entityId: input.entityId,
      ownershipState: "linked_to_direction",
      trackId,
      candidateTrackId: null,
      reason: compact(input.reason) || "User explicitly linked this object to a direction.",
      source: compact(input.source) || "explicit_user_action",
    });
    return viewFor(input.entityType, (await objectById(input.entityType, input.entityId))!, rowByKey().get(`${input.entityType}:${input.entityId}`));
  }

  if (input.ownershipState === "candidate_for_direction") {
    const candidateTrackId = Number(input.candidateTrackId ?? input.trackId);
    if (!Number.isFinite(candidateTrackId) || candidateTrackId <= 0) throw new Error("candidate_for_direction requires candidateTrackId");
    if (existingTrackId) throw new Error("This object is already linked. Unlink it before marking it as a candidate.");
    upsertOwnership({
      entityType: input.entityType,
      entityId: input.entityId,
      ownershipState: "candidate_for_direction",
      trackId: null,
      candidateTrackId,
      reason: compact(input.reason) || "User marked this as a candidate for a direction.",
      source: compact(input.source) || "explicit_user_action",
    });
    return viewFor(input.entityType, entity, rowByKey().get(`${input.entityType}:${input.entityId}`));
  }

  if (existingTrackId && !input.confirmUnlink) {
    throw new Error("This object is linked to a direction. Pass confirmUnlink to mark it unclassified.");
  }
  if (existingTrackId) await updateObjectTrackLink(input.entityType, input.entityId, null);
  upsertOwnership({
    entityType: input.entityType,
    entityId: input.entityId,
    ownershipState: "unclassified_capture",
    trackId: null,
    candidateTrackId: null,
    reason: compact(input.reason) || "User explicitly marked this object as unclassified.",
    source: compact(input.source) || "explicit_user_action",
  });
  return viewFor(input.entityType, (await objectById(input.entityType, input.entityId)) || entity, rowByKey().get(`${input.entityType}:${input.entityId}`));
}
