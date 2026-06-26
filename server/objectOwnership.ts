import type { Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { rawDb, storage, type TrackEntity } from "./storage";

export type OwnershipState = "linked_to_direction" | "candidate_for_direction" | "unclassified_capture" | "parked" | "stopped";
export type OwnershipConfidence = "high" | "medium" | "low";
export type StrategicObjectType = "task" | "job" | "learn" | "contact" | "hustle";
export type OwnershipResolutionAction = "assign_to_track" | "park" | "stop";

type StrategicObject = Task | Job | Learn | Contact | Hustle;

export type StrategicObjectOwnership = {
  objectType: StrategicObjectType;
  objectId: number;
  ownershipState: OwnershipState;
  trackId: number | null;
  reason: string;
  confidence: OwnershipConfidence;
  source: "derived" | "backfilled" | "manual";
  persisted: boolean;
  updatedAt: number | null;
};

export type ResolveStrategicObjectOwnershipInput = {
  objectType: StrategicObjectType;
  objectId: number;
  action: OwnershipResolutionAction;
  trackId?: number | null;
  reason?: string;
};

export type ResolveStrategicObjectOwnershipResult = {
  action: OwnershipResolutionAction;
  object: StrategicObject;
  ownership: StrategicObjectOwnership;
  resolvedAt: number;
};

type PersistedOwnershipRow = {
  object_type: StrategicObjectType;
  object_id: number;
  ownership_state: OwnershipState;
  track_id: number | null;
  reason: string;
  confidence: OwnershipConfidence;
  source: "derived" | "backfilled" | "manual";
  updated_at: number;
};

const OWNERSHIP_DDL = `
CREATE TABLE IF NOT EXISTS strategic_object_ownership (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_type TEXT NOT NULL,
  object_id INTEGER NOT NULL,
  ownership_state TEXT NOT NULL,
  track_id INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'medium',
  source TEXT NOT NULL DEFAULT 'derived',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategic_object_ownership_object
  ON strategic_object_ownership(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_strategic_object_ownership_state
  ON strategic_object_ownership(ownership_state, track_id);
`;

const STRATEGIC_OBJECT_TYPES = new Set<StrategicObjectType>(["task", "job", "learn", "contact", "hustle"]);
const OWNERSHIP_RESOLUTION_ACTIONS = new Set<OwnershipResolutionAction>(["assign_to_track", "park", "stop"]);
const TRACK_ENTITY_BY_OBJECT_TYPE: Record<StrategicObjectType, TrackEntity> = {
  task: "tasks",
  job: "jobs",
  learn: "learn",
  contact: "contacts",
  hustle: "hustles",
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function positiveInteger(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer`);
  return id;
}

function objectTypeFor(value: unknown): StrategicObjectType {
  const objectType = compact(value) as StrategicObjectType;
  if (STRATEGIC_OBJECT_TYPES.has(objectType)) return objectType;
  throw new Error("Unsupported strategic object type");
}

function resolutionActionFor(value: unknown): OwnershipResolutionAction {
  const action = compact(value) as OwnershipResolutionAction;
  if (OWNERSHIP_RESOLUTION_ACTIONS.has(action)) return action;
  throw new Error("Unsupported ownership resolution action");
}

function numberOrNull(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function includesAny(value: unknown, needles: string[]) {
  const text = compact(value).toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function ownershipKey(type: StrategicObjectType, id: number) {
  return `${type}:${id}`;
}

export function ensureObjectOwnershipSchema() {
  rawDb.exec(OWNERSHIP_DDL);
}

function ownershipFromTrackLink(
  objectType: StrategicObjectType,
  objectId: number,
  trackId: number | null,
  reason: string,
): StrategicObjectOwnership | null {
  if (!trackId) return null;
  return {
    objectType,
    objectId,
    ownershipState: "linked_to_direction",
    trackId,
    reason,
    confidence: "high",
    source: "derived",
    persisted: false,
    updatedAt: null,
  };
}

export function deriveTaskOwnership(task: Task): StrategicObjectOwnership {
  const trackId = numberOrNull(task.relatedTrackId)
    || (task.sourceType === "career_track" ? numberOrNull(task.sourceId) : null);
  const linked = ownershipFromTrackLink("task", task.id, trackId, "Task is explicitly linked to a career direction.");
  if (linked) return linked;

  const strategicSource = ["project", "work_definition", "recommendation", "track_research", "project_capture", "discovery_option"].includes(task.sourceType);
  const strategicCategory = ["job", "learning", "substack", "hustle", "interview"].includes(task.category);
  const needsParent = includesAny(task.sourceStatus, ["needs_parent", "routed:decision", "research", "discovery_option"]);
  if (strategicSource || strategicCategory || needsParent) {
    return {
      objectType: "task",
      objectId: task.id,
      ownershipState: "candidate_for_direction",
      trackId: null,
      reason: "Task appears career-related but is not yet linked to a direction.",
      confidence: strategicSource || strategicCategory ? "medium" : "low",
      source: "derived",
      persisted: false,
      updatedAt: null,
    };
  }

  return {
    objectType: "task",
    objectId: task.id,
    ownershipState: "unclassified_capture",
    trackId: null,
    reason: "Task has no direction link or strategic source signal.",
    confidence: "medium",
    source: "derived",
    persisted: false,
    updatedAt: null,
  };
}

export function deriveJobOwnership(job: Job): StrategicObjectOwnership {
  const linked = ownershipFromTrackLink("job", job.id, numberOrNull(job.relatedTrackId), "Opportunity is explicitly linked to a career direction.");
  if (linked) return linked;
  return {
    objectType: "job",
    objectId: job.id,
    ownershipState: "candidate_for_direction",
    trackId: null,
    reason: "Opportunity has no relatedTrackId and should be assigned to a direction or intentionally parked.",
    confidence: "high",
    source: "derived",
    persisted: false,
    updatedAt: null,
  };
}

export function deriveLearnOwnership(item: Learn): StrategicObjectOwnership {
  const linked = ownershipFromTrackLink("learn", item.id, numberOrNull(item.relatedTrackId), "Learning item is explicitly linked to a career direction.");
  if (linked) return linked;
  const candidate = !!item.proofIntent
    || !!compact(item.requiredOutput)
    || !!compact(item.capabilityBuilt)
    || ["recommendation", "track_research", "career_track"].includes(item.sourceType);
  return {
    objectType: "learn",
    objectId: item.id,
    ownershipState: candidate ? "candidate_for_direction" : "unclassified_capture",
    trackId: null,
    reason: candidate
      ? "Learning item builds capability or proof but is not yet linked to a direction."
      : "Learning item has no direction link or career-capital signal.",
    confidence: candidate ? "medium" : "low",
    source: "derived",
    persisted: false,
    updatedAt: null,
  };
}

export function deriveContactOwnership(contact: Contact): StrategicObjectOwnership {
  const linked = ownershipFromTrackLink("contact", contact.id, numberOrNull(contact.relatedTrackId), "Contact is explicitly linked to a career direction.");
  if (linked) return linked;
  const candidate = [contact.targetOrg, contact.targetRole, contact.sourceNetwork, contact.askType, contact.referralPotential]
    .some((value) => !!compact(value));
  return {
    objectType: "contact",
    objectId: contact.id,
    ownershipState: candidate ? "candidate_for_direction" : "unclassified_capture",
    trackId: null,
    reason: candidate
      ? "Contact has career-networking metadata but no direction link."
      : "Contact has no direction link or target context.",
    confidence: candidate ? "medium" : "low",
    source: "derived",
    persisted: false,
    updatedAt: null,
  };
}

export function deriveHustleOwnership(hustle: Hustle): StrategicObjectOwnership {
  const linked = ownershipFromTrackLink("hustle", hustle.id, numberOrNull(hustle.proofAssetForTrack), "Proof asset is explicitly linked to a career direction.");
  if (linked) return linked;
  return {
    objectType: "hustle",
    objectId: hustle.id,
    ownershipState: "candidate_for_direction",
    trackId: null,
    reason: "Proof asset should either support a direction or be intentionally parked.",
    confidence: "medium",
    source: "derived",
    persisted: false,
    updatedAt: null,
  };
}

function rowToOwnership(row: PersistedOwnershipRow): StrategicObjectOwnership {
  return {
    objectType: row.object_type,
    objectId: Number(row.object_id),
    ownershipState: row.ownership_state,
    trackId: row.track_id == null ? null : Number(row.track_id),
    reason: compact(row.reason),
    confidence: row.confidence || "medium",
    source: row.source || "derived",
    persisted: true,
    updatedAt: Number(row.updated_at || 0),
  };
}

function persistManualOwnership(input: {
  objectType: StrategicObjectType;
  objectId: number;
  ownershipState: OwnershipState;
  trackId: number | null;
  reason: string;
  confidence: OwnershipConfidence;
}): StrategicObjectOwnership {
  ensureObjectOwnershipSchema();
  const now = Date.now();
  const reason = compact(input.reason);
  rawDb.prepare(`
    INSERT INTO strategic_object_ownership (
      object_type, object_id, ownership_state, track_id, reason, confidence, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
    ON CONFLICT(object_type, object_id) DO UPDATE SET
      ownership_state = excluded.ownership_state,
      track_id = excluded.track_id,
      reason = excluded.reason,
      confidence = excluded.confidence,
      source = 'manual',
      updated_at = excluded.updated_at
  `).run(
    input.objectType,
    input.objectId,
    input.ownershipState,
    input.trackId,
    reason,
    input.confidence,
    now,
    now,
  );
  return {
    objectType: input.objectType,
    objectId: input.objectId,
    ownershipState: input.ownershipState,
    trackId: input.trackId,
    reason,
    confidence: input.confidence,
    source: "manual",
    persisted: true,
    updatedAt: now,
  };
}

async function readStrategicObject(objectType: StrategicObjectType, objectId: number): Promise<StrategicObject | null> {
  if (objectType === "task") return (await storage.getTasks()).find((task) => task.id === objectId) || null;
  if (objectType === "job") return await storage.getJob(objectId) || null;
  if (objectType === "learn") return await storage.getLearnItem(objectId) || null;
  if (objectType === "contact") return (await storage.getContacts()).find((contact) => contact.id === objectId) || null;
  return (await storage.getHustles()).find((hustle) => hustle.id === objectId) || null;
}

async function assignStrategicObject(objectType: StrategicObjectType, objectId: number, trackId: number): Promise<StrategicObject | null> {
  const linked = await storage.linkTrack(TRACK_ENTITY_BY_OBJECT_TYPE[objectType], objectId, trackId);
  if (!linked) return null;
  if (objectType === "task") {
    return await storage.updateTask(objectId, { sourceStatus: "assigned_to_direction", readiness: "ready" } as any) || linked;
  }
  return linked;
}

async function parkStrategicObject(objectType: StrategicObjectType, objectId: number): Promise<StrategicObject | null> {
  const unlinked = await storage.linkTrack(TRACK_ENTITY_BY_OBJECT_TYPE[objectType], objectId, null);
  if (!unlinked) return null;
  if (objectType === "task") {
    return await storage.updateTask(objectId, { sourceStatus: "parked", readiness: "waiting" } as any) || unlinked;
  }
  if (objectType === "learn") {
    return await storage.updateLearn(objectId, { active: false } as any) || unlinked;
  }
  return unlinked;
}

async function stopStrategicObject(objectType: StrategicObjectType, objectId: number): Promise<StrategicObject | null> {
  if (objectType === "task") {
    return await storage.updateTask(objectId, {
      relatedTrackId: null,
      done: true,
      status: "done",
      sourceStatus: "stopped",
      readiness: "waiting",
    } as any) || null;
  }
  if (objectType === "job") {
    return await storage.updateJob(objectId, {
      relatedTrackId: null,
      status: "closed",
      applicationWindowStatus: "closed",
      rejectReason: "Stopped during ownership resolution.",
    } as any) || null;
  }
  if (objectType === "learn") {
    return await storage.updateLearn(objectId, {
      relatedTrackId: null,
      learnStatus: "closed",
      active: false,
    } as any) || null;
  }
  if (objectType === "contact") {
    return await storage.updateContact(objectId, {
      relatedTrackId: null,
      status: "archived",
      nextFollowUpDate: "",
    } as any) || null;
  }
  return await storage.updateHustle(objectId, {
    proofAssetForTrack: null,
    nextStep: "Stopped during ownership resolution.",
  } as any) || null;
}

export function getPersistedOwnership(): Map<string, StrategicObjectOwnership> {
  ensureObjectOwnershipSchema();
  const rows = rawDb.prepare("SELECT * FROM strategic_object_ownership").all() as PersistedOwnershipRow[];
  return new Map(rows.map((row) => [ownershipKey(row.object_type, Number(row.object_id)), rowToOwnership(row)]));
}

function mergePersisted(derived: StrategicObjectOwnership, persisted: Map<string, StrategicObjectOwnership>) {
  const stored = persisted.get(ownershipKey(derived.objectType, derived.objectId));
  if (!stored) return derived;
  if (stored.source === "manual") return stored;
  return { ...derived, persisted: true, source: stored.source, updatedAt: stored.updatedAt } as StrategicObjectOwnership;
}

export async function deriveStrategicObjectOwnership(): Promise<StrategicObjectOwnership[]> {
  ensureObjectOwnershipSchema();
  const [tasks, jobs, learnItems, contacts, hustles] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getContacts(),
    storage.getHustles(),
  ]);
  const persisted = getPersistedOwnership();
  return [
    ...tasks.map(deriveTaskOwnership),
    ...jobs.map(deriveJobOwnership),
    ...learnItems.map(deriveLearnOwnership),
    ...contacts.map(deriveContactOwnership),
    ...hustles.map(deriveHustleOwnership),
  ].map((ownership) => mergePersisted(ownership, persisted));
}

export function summarizeOwnership(records: StrategicObjectOwnership[]) {
  const summary = {
    total: records.length,
    linked_to_direction: 0,
    candidate_for_direction: 0,
    unclassified_capture: 0,
    parked: 0,
    stopped: 0,
    persisted: 0,
  };
  for (const record of records) {
    summary[record.ownershipState] += 1;
    if (record.persisted) summary.persisted += 1;
  }
  return summary;
}

export async function ownershipSnapshot() {
  const objects = await deriveStrategicObjectOwnership();
  return {
    summary: summarizeOwnership(objects),
    objects,
    readOnlySnapshot: true,
  };
}

export async function backfillStrategicObjectOwnership() {
  ensureObjectOwnershipSchema();
  const records = await deriveStrategicObjectOwnership();
  const statement = rawDb.prepare(`
    INSERT INTO strategic_object_ownership (
      object_type, object_id, ownership_state, track_id, reason, confidence, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'backfilled', ?, ?)
    ON CONFLICT(object_type, object_id) DO UPDATE SET
      ownership_state = CASE WHEN strategic_object_ownership.source = 'manual' THEN strategic_object_ownership.ownership_state ELSE excluded.ownership_state END,
      track_id = CASE WHEN strategic_object_ownership.source = 'manual' THEN strategic_object_ownership.track_id ELSE excluded.track_id END,
      reason = CASE WHEN strategic_object_ownership.source = 'manual' THEN strategic_object_ownership.reason ELSE excluded.reason END,
      confidence = CASE WHEN strategic_object_ownership.source = 'manual' THEN strategic_object_ownership.confidence ELSE excluded.confidence END,
      source = CASE WHEN strategic_object_ownership.source = 'manual' THEN 'manual' ELSE 'backfilled' END,
      updated_at = excluded.updated_at
  `);
  const now = Date.now();
  const tx = rawDb.transaction((items: StrategicObjectOwnership[]) => {
    for (const item of items) {
      statement.run(
        item.objectType,
        item.objectId,
        item.ownershipState,
        item.trackId,
        item.reason,
        item.confidence,
        now,
        now,
      );
    }
  });
  tx(records);
  return {
    summary: summarizeOwnership(records),
    upserted: records.length,
    backfilledAt: now,
  };
}

export async function resolveStrategicObjectOwnership(
  input: ResolveStrategicObjectOwnershipInput,
): Promise<ResolveStrategicObjectOwnershipResult | null> {
  const objectType = objectTypeFor(input.objectType);
  const objectId = positiveInteger(input.objectId, "objectId");
  const action = resolutionActionFor(input.action);
  let object: StrategicObject | null = null;
  let ownershipState: OwnershipState = "unclassified_capture";
  let trackId: number | null = null;
  let confidence: OwnershipConfidence = "medium";
  let reason = compact(input.reason);

  if (action === "assign_to_track") {
    trackId = positiveInteger(input.trackId, "trackId");
    const track = await storage.getCareerTrack(trackId);
    if (!track) throw new Error("Career direction not found");
    object = await assignStrategicObject(objectType, objectId, trackId);
    if (!object) return null;
    ownershipState = "linked_to_direction";
    confidence = "high";
    reason ||= `Assigned to ${compact(track.name)}.`;
  } else if (action === "park") {
    object = await parkStrategicObject(objectType, objectId);
    if (!object) return null;
    ownershipState = "parked";
    confidence = "medium";
    reason ||= "Intentionally parked; keep it out of execution until it is assigned to a direction.";
  } else {
    object = await stopStrategicObject(objectType, objectId);
    if (!object) return null;
    ownershipState = "stopped";
    confidence = "high";
    reason ||= "Stopped by the user; do not treat this as active strategic work.";
  }

  const ownership = persistManualOwnership({ objectType, objectId, ownershipState, trackId, reason, confidence });
  await storage.logActivity({
    eventType: "strategic_object_ownership_resolved",
    sourceType: objectType,
    sourceId: objectId,
    taskId: objectType === "task" ? objectId : undefined,
    metadata: JSON.stringify({ action, ownershipState, trackId, reason }),
  } as any);
  return {
    action,
    object,
    ownership,
    resolvedAt: ownership.updatedAt || Date.now(),
  };
}
