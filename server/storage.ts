import {
  tasks, events, jobs, learn, hustles, wins, contacts,
  dayPlans, dayPlanItems, activityLog, careerTracks, jobPipelineSteps, proofAssetSteps, entityLinks,
  userProfile, discoverySessions, recommendations, recommendationSubdivisions, recommendationMilestones,
  networkGaps, contactClassifications, contactInteractions,
  type Task, type InsertTask,
  type Event, type InsertEvent,
  type Job, type InsertJob,
  type JobPipelineStep, type InsertJobPipelineStep,
  type ProofAssetStep, type InsertProofAssetStep,
  type Learn, type InsertLearn,
  type Hustle, type InsertHustle,
  type Win, type InsertWin,
  type Contact, type InsertContact,
  type DayPlan, type InsertDayPlan,
  type DayPlanItem, type InsertDayPlanItem,
  type ActivityLog, type InsertActivityLog,
  type CareerTrack, type InsertCareerTrack,
  type UserProfile,
  type DiscoverySession, type InsertDiscoverySession,
  type Recommendation, type InsertRecommendation,
  type RecommendationSubdivision, type InsertRecommendationSubdivision,
  type RecommendationMilestone, type InsertRecommendationMilestone,
  type NetworkGap, type InsertNetworkGap,
  type ContactClassification, type InsertContactClassification,
  type ContactInteraction, type InsertContactInteraction,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, asc, desc, inArray, and, or } from "drizzle-orm";
import { templateForArchetype } from "@shared/jobTemplates";
import { templateForProofAsset } from "@shared/proofAssetTemplates";
import { SPINE_DDL, SPINE_MIGRATIONS } from "./spine.schema.sql";

type DbClient = ReturnType<typeof drizzle>;
type SqliteHandle = InstanceType<typeof Database>;

function resolveDbPath(explicitDbPath?: string) {
  return explicitDbPath || process.env.ANCHOR_DB_PATH || "data.db";
}

export type StorageRuntime = {
  db: DbClient;
  rawDb: SqliteHandle;
  storage: DatabaseStorage;
  dbPath: string;
};

function openStorageRuntime(dbPath: string): StorageRuntime {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  // Ensure the full current schema exists on open. Idempotent (CREATE TABLE IF NOT
  // EXISTS) so it is a no-op on an already-pushed prod DB and gives throwaway test
  // DBs every table from shared/schema.ts regardless of import order.
  sqlite.exec(SPINE_DDL);
  // Column additions on existing tables — run each individually so they are
  // no-ops on DBs that already have the column.
  for (const migration of SPINE_MIGRATIONS) {
    try { sqlite.exec(migration); } catch { /* already applied */ }
  }
  return {
    db: drizzle(sqlite),
    rawDb: sqlite,
    storage: new DatabaseStorage(),
    dbPath,
  };
}

let activeRuntime: StorageRuntime | null = null;

export function initStorage(explicitDbPath?: string): StorageRuntime {
  const dbPath = resolveDbPath(explicitDbPath);
  if (!activeRuntime) {
    activeRuntime = openStorageRuntime(dbPath);
    return activeRuntime;
  }
  if (activeRuntime.dbPath !== dbPath) {
    throw new Error(`Storage already initialized for ${activeRuntime.dbPath}; cannot reinitialize for ${dbPath}`);
  }
  return activeRuntime;
}

export function getStorageRuntime(): StorageRuntime {
  return activeRuntime ?? initStorage();
}

function bindProxy<T extends object>(getTarget: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const target = getTarget();
      const value = Reflect.get(target as object, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, prop, value, receiver) {
      return Reflect.set(getTarget() as object, prop, value, receiver);
    },
    has(_target, prop) {
      return prop in getTarget();
    },
    ownKeys() {
      return Reflect.ownKeys(getTarget() as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Object.getOwnPropertyDescriptor(getTarget() as object, prop);
    },
  });
}

export const db = bindProxy<DbClient>(() => getStorageRuntime().db);
export const rawDb = bindProxy<SqliteHandle>(() => getStorageRuntime().rawDb);


export interface IStorage {
  getTasks(): Promise<Task[]>;
  createTask(t: InsertTask): Promise<Task>;
  updateTask(id: number, patch: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: number): Promise<void>;
  getEvents(day: string): Promise<Event[]>;
  replaceEventsForDay(day: string, items: InsertEvent[]): Promise<void>;
  getJobs(): Promise<Job[]>;
  createJob(j: InsertJob): Promise<Job>;
  updateJob(id: number, patch: Partial<InsertJob>): Promise<Job | undefined>;
  deleteJob(id: number): Promise<void>;
  getJobSteps(jobId: number): Promise<JobPipelineStep[]>;
  getJobStep(stepId: number): Promise<JobPipelineStep | undefined>;
  seedJobSteps(jobId: number): Promise<JobPipelineStep[]>;
  createJobStep(jobId: number, data: { stepLabel: string; sequence?: number; note?: string }): Promise<JobPipelineStep>;
  updateJobStep(stepId: number, patch: Partial<InsertJobPipelineStep>): Promise<JobPipelineStep | undefined>;
  deleteJobStep(stepId: number): Promise<void>;
  reorderJobSteps(jobId: number, orderedStepIds: number[]): Promise<JobPipelineStep[]>;
  getLearn(): Promise<Learn[]>;
  getLearnItem(id: number): Promise<Learn | undefined>;
  getLearnItems(ids: number[]): Promise<Learn[]>;
  createLearn(l: InsertLearn): Promise<Learn>;
  updateLearn(id: number, patch: Partial<InsertLearn>): Promise<Learn | undefined>;
  deleteLearn(id: number): Promise<void>;
  getHustles(): Promise<Hustle[]>;
  createHustle(h: InsertHustle): Promise<Hustle>;
  updateHustle(id: number, patch: Partial<InsertHustle>): Promise<Hustle | undefined>;
  deleteHustle(id: number): Promise<void>;
  getProofAssetSteps(hustleId: number): Promise<ProofAssetStep[]>;
  getProofAssetStep(stepId: number): Promise<ProofAssetStep | undefined>;
  seedProofAssetSteps(hustleId: number): Promise<ProofAssetStep[]>;
  createProofAssetStep(hustleId: number, data: { stepLabel: string; sequence?: number; note?: string }): Promise<ProofAssetStep>;
  updateProofAssetStep(stepId: number, patch: Partial<InsertProofAssetStep>): Promise<ProofAssetStep | undefined>;
  deleteProofAssetStep(stepId: number): Promise<void>;
  reorderProofAssetSteps(hustleId: number, orderedStepIds: number[]): Promise<ProofAssetStep[]>;
  getWins(): Promise<Win[]>;
  createWin(w: InsertWin): Promise<Win>;
  deleteWin(id: number): Promise<void>;
  getContacts(): Promise<Contact[]>;
  createContact(ct: InsertContact): Promise<Contact>;
  updateContact(id: number, patch: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<void>;
  getPlanByDate(date: string): Promise<DayPlan | undefined>;
  getPlan(id: number): Promise<DayPlan | undefined>;
  createPlan(p: InsertDayPlan): Promise<DayPlan>;
  updatePlan(id: number, patch: Partial<InsertDayPlan>): Promise<DayPlan | undefined>;
  getPlanItems(planId: number): Promise<DayPlanItem[]>;
  getPlanItem(id: number): Promise<DayPlanItem | undefined>;
  createPlanItem(i: InsertDayPlanItem): Promise<DayPlanItem>;
  updatePlanItem(id: number, patch: Partial<InsertDayPlanItem>): Promise<DayPlanItem | undefined>;
  clearPlanItems(planId: number): Promise<void>;
  logActivity(a: InsertActivityLog): Promise<void>;
  getActivityLog(): Promise<ActivityLog[]>;
  getCareerTracks(): Promise<CareerTrack[]>;
  createCareerTrack(t: InsertCareerTrack): Promise<CareerTrack>;
  updateCareerTrack(id: number, patch: Partial<InsertCareerTrack>): Promise<CareerTrack | undefined>;
  deleteCareerTrack(id: number): Promise<void>;
  getDiscoverySession(id: number): Promise<DiscoverySession | undefined>;
  createDiscoverySession(session: InsertDiscoverySession): Promise<DiscoverySession>;
  updateDiscoverySession(id: number, patch: Partial<InsertDiscoverySession>): Promise<DiscoverySession | undefined>;
  getRecommendations(): Promise<Recommendation[]>;
  getRecommendation(id: number): Promise<Recommendation | undefined>;
  createRecommendation(item: InsertRecommendation): Promise<Recommendation>;
  updateRecommendation(id: number, patch: Partial<InsertRecommendation>): Promise<Recommendation | undefined>;
  deleteRecommendation(id: number): Promise<void>;
  getRecommendationSubdivisions(recommendationId: number): Promise<RecommendationSubdivision[]>;
  createRecommendationSubdivision(item: InsertRecommendationSubdivision): Promise<RecommendationSubdivision>;
  updateRecommendationSubdivision(id: number, patch: Partial<InsertRecommendationSubdivision>): Promise<RecommendationSubdivision | undefined>;
  deleteRecommendationSubdivision(id: number): Promise<void>;
  getRecommendationMilestones(recommendationId: number): Promise<RecommendationMilestone[]>;
  getRecommendationMilestonesForRecommendationIds(recommendationIds: number[]): Promise<RecommendationMilestone[]>;
  getRecommendationMilestone(id: number): Promise<RecommendationMilestone | undefined>;
  createRecommendationMilestone(item: InsertRecommendationMilestone): Promise<RecommendationMilestone>;
  updateRecommendationMilestone(id: number, patch: Partial<InsertRecommendationMilestone>): Promise<RecommendationMilestone | undefined>;
  deleteRecommendationMilestone(id: number): Promise<void>;
  linkTrack(entity: TrackEntity, id: number, trackId: number | null): Promise<any | undefined>;
  // P4.4 — learn proof-building
  markLearnEvidenced(id: number, outputEvidenceUrl: string, proofToId?: number | null): Promise<Learn | undefined>;
  getLearnProofLinkIds(): Promise<Set<number>>;
  // Profile
  getProfile(): Promise<UserProfile | null>;
  upsertProfile(patch: { cvText: string }): Promise<UserProfile>;
  // Network Builder
  getNetworkGaps(trackId?: number): Promise<NetworkGap[]>;
  upsertNetworkGaps(trackId: number, gaps: InsertNetworkGap[]): Promise<NetworkGap[]>;
  getContactClassifications(contactId?: number): Promise<ContactClassification[]>;
  upsertContactClassifications(contactId: number, cls: InsertContactClassification[]): Promise<ContactClassification[]>;
  deleteContactClassifications(contactId: number): Promise<void>;
  getContactInteractions(contactId: number): Promise<ContactInteraction[]>;
  createContactInteraction(data: Omit<InsertContactInteraction, 'createdAt'>): Promise<ContactInteraction>;
  updateContactNextAction(id: number, nextActionType: string, nextActionDue: number | null, nextActionDesc: string): Promise<Contact | undefined>;
  // Job-contact links
  getJobContactLinks(jobId: number): Promise<number[]>;
  getAllJobContactLinks(): Promise<Record<number, number[]>>;
  linkContactToJob(contactId: number, jobId: number): Promise<any>;
  unlinkContactFromJob(contactId: number, jobId: number): Promise<void>;
}

// Entities that carry a track link. Hustles store it in proofAssetForTrack;
// everything else in relatedTrackId.
export type TrackEntity = "jobs" | "learn" | "contacts" | "hustles" | "tasks";
const TRACK_TABLES = { jobs, learn, contacts, hustles, tasks } as const;

export class DatabaseStorage implements IStorage {
  async getTasks() { return db.select().from(tasks).orderBy(asc(tasks.sort), asc(tasks.id)).all(); }
  async createTask(t: InsertTask) { return db.insert(tasks).values({ ...t, createdAt: Date.now() }).returning().get(); }
  async updateTask(id: number, patch: Partial<InsertTask>) { return db.update(tasks).set(patch).where(eq(tasks.id, id)).returning().get(); }
  async deleteTask(id: number) {
    this._cleanEntityLinks("task", id);
    db.delete(tasks).where(eq(tasks.id, id)).run();
  }

  async getEvents(day: string) { return db.select().from(events).where(eq(events.day, day)).orderBy(asc(events.start)).all(); }
  async replaceEventsForDay(day: string, items: InsertEvent[]) {
    db.delete(events).where(eq(events.day, day)).run();
    for (const it of items) db.insert(events).values({ ...it, day, createdAt: Date.now() }).run();
  }

  async getJobs() { return db.select().from(jobs).orderBy(desc(jobs.id)).all(); }
  async createJob(j: InsertJob) { return db.insert(jobs).values({ ...j, createdAt: Date.now() }).returning().get(); }
  async updateJob(id: number, patch: Partial<InsertJob>) { return db.update(jobs).set(patch).where(eq(jobs.id, id)).returning().get(); }
  async deleteJob(id: number) {
    this._cleanEntityLinks("job", id);
    db.delete(jobPipelineSteps).where(eq(jobPipelineSteps.jobId, id)).run();
    db.delete(jobs).where(eq(jobs.id, id)).run();
  }

  async getJobSteps(jobId: number) {
    return db.select().from(jobPipelineSteps).where(eq(jobPipelineSteps.jobId, jobId))
      .orderBy(asc(jobPipelineSteps.sequence), asc(jobPipelineSteps.id)).all();
  }
  async getJobStep(stepId: number) {
    return db.select().from(jobPipelineSteps).where(eq(jobPipelineSteps.id, stepId)).get();
  }
  // Seed the archetype template — only if the job exists and has no steps yet.
  async seedJobSteps(jobId: number) {
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) return [];
    const existing = await this.getJobSteps(jobId);
    if (existing.length > 0) return existing;
    const labels = templateForArchetype(job.roleArchetype);
    const now = Date.now();
    labels.forEach((stepLabel, i) => {
      db.insert(jobPipelineSteps).values({ jobId, stepLabel, status: "todo", sequence: i, note: "", createdAt: now }).run();
    });
    return this.getJobSteps(jobId);
  }
  async createJobStep(jobId: number, data: { stepLabel: string; sequence?: number; note?: string }) {
    const existing = await this.getJobSteps(jobId);
    const sequence = data.sequence ?? (existing.length ? existing[existing.length - 1].sequence + 1 : 0);
    return db.insert(jobPipelineSteps).values({
      jobId, stepLabel: data.stepLabel, status: "todo", sequence, note: data.note ?? "", createdAt: Date.now(),
    }).returning().get();
  }
  async updateJobStep(stepId: number, patch: Partial<InsertJobPipelineStep>) {
    return db.update(jobPipelineSteps).set(patch).where(eq(jobPipelineSteps.id, stepId)).returning().get();
  }
  async deleteJobStep(stepId: number) { db.delete(jobPipelineSteps).where(eq(jobPipelineSteps.id, stepId)).run(); }
  // Rewrite sequence from an ordered id list (ids not in the job are ignored).
  async reorderJobSteps(jobId: number, orderedStepIds: number[]) {
    const steps = await this.getJobSteps(jobId);
    const owned = new Set(steps.map((s) => s.id));
    orderedStepIds.filter((id) => owned.has(id)).forEach((id, i) => {
      db.update(jobPipelineSteps).set({ sequence: i }).where(eq(jobPipelineSteps.id, id)).run();
    });
    return this.getJobSteps(jobId);
  }

  async getLearn() { return db.select().from(learn).orderBy(desc(learn.id)).all(); }
  async getLearnItem(id: number) { return db.select().from(learn).where(eq(learn.id, id)).get(); }
  async getLearnItems(ids: number[]) {
    if (!ids.length) return [];
    return db.select().from(learn).where(inArray(learn.id, ids)).all();
  }
  async createLearn(l: InsertLearn) { return db.insert(learn).values({ ...l, createdAt: Date.now() }).returning().get(); }
  async updateLearn(id: number, patch: Partial<InsertLearn>) { return db.update(learn).set(patch).where(eq(learn.id, id)).returning().get(); }
  async deleteLearn(id: number) {
    this._cleanEntityLinks("learn", id);
    db.delete(learn).where(eq(learn.id, id)).run();
  }

  async getHustles() { return db.select().from(hustles).orderBy(desc(hustles.id)).all(); }
  async createHustle(h: InsertHustle) { return db.insert(hustles).values({ ...h, createdAt: Date.now() }).returning().get(); }
  async updateHustle(id: number, patch: Partial<InsertHustle>) { return db.update(hustles).set(patch).where(eq(hustles.id, id)).returning().get(); }
  async deleteHustle(id: number) {
    this._cleanEntityLinks("hustle", id);
    db.delete(proofAssetSteps).where(eq(proofAssetSteps.hustleId, id)).run();
    db.delete(hustles).where(eq(hustles.id, id)).run();
  }

  // ── Proof asset steps (P4.3) — mirror the job pipeline step methods exactly ──
  async getProofAssetSteps(hustleId: number) {
    return db.select().from(proofAssetSteps).where(eq(proofAssetSteps.hustleId, hustleId))
      .orderBy(asc(proofAssetSteps.sequence), asc(proofAssetSteps.id)).all();
  }
  async getProofAssetStep(stepId: number) {
    return db.select().from(proofAssetSteps).where(eq(proofAssetSteps.id, stepId)).get();
  }
  // Seed the kind-aware template — only if the asset exists and has no steps yet.
  async seedProofAssetSteps(hustleId: number) {
    const h = db.select().from(hustles).where(eq(hustles.id, hustleId)).get();
    if (!h) return [];
    const existing = await this.getProofAssetSteps(hustleId);
    if (existing.length > 0) return existing;
    const labels = templateForProofAsset(h);
    const now = Date.now();
    labels.forEach((stepLabel, i) => {
      db.insert(proofAssetSteps).values({ hustleId, stepLabel, status: "todo", sequence: i, note: "", createdAt: now }).run();
    });
    return this.getProofAssetSteps(hustleId);
  }
  async createProofAssetStep(hustleId: number, data: { stepLabel: string; sequence?: number; note?: string }) {
    const existing = await this.getProofAssetSteps(hustleId);
    const sequence = data.sequence ?? (existing.length ? existing[existing.length - 1].sequence + 1 : 0);
    return db.insert(proofAssetSteps).values({
      hustleId, stepLabel: data.stepLabel, status: "todo", sequence, note: data.note ?? "", createdAt: Date.now(),
    }).returning().get();
  }
  async updateProofAssetStep(stepId: number, patch: Partial<InsertProofAssetStep>) {
    return db.update(proofAssetSteps).set(patch).where(eq(proofAssetSteps.id, stepId)).returning().get();
  }
  async deleteProofAssetStep(stepId: number) { db.delete(proofAssetSteps).where(eq(proofAssetSteps.id, stepId)).run(); }
  async reorderProofAssetSteps(hustleId: number, orderedStepIds: number[]) {
    const steps = await this.getProofAssetSteps(hustleId);
    const owned = new Set(steps.map((s) => s.id));
    orderedStepIds.filter((id) => owned.has(id)).forEach((id, i) => {
      db.update(proofAssetSteps).set({ sequence: i }).where(eq(proofAssetSteps.id, id)).run();
    });
    return this.getProofAssetSteps(hustleId);
  }

  async getWins() { return db.select().from(wins).orderBy(desc(wins.id)).all(); }
  async createWin(w: InsertWin) { return db.insert(wins).values({ ...w, createdAt: Date.now() }).returning().get(); }
  async deleteWin(id: number) { db.delete(wins).where(eq(wins.id, id)).run(); }
  async getContacts() { return db.select().from(contacts).orderBy(desc(contacts.id)).all(); }
  async createContact(ct: InsertContact) { return db.insert(contacts).values({ ...ct, createdAt: Date.now() }).returning().get(); }
  async updateContact(id: number, patch: Partial<InsertContact>) { return db.update(contacts).set(patch).where(eq(contacts.id, id)).returning().get(); }
  async deleteContact(id: number) {
    this._cleanEntityLinks("contact", id);
    db.delete(contactClassifications).where(eq(contactClassifications.contactId, id)).run();
    db.delete(contactInteractions).where(eq(contactInteractions.contactId, id)).run();
    db.delete(contacts).where(eq(contacts.id, id)).run();
  }

  async getPlanByDate(date: string) { return db.select().from(dayPlans).where(eq(dayPlans.date, date)).get(); }
  async getPlan(id: number) { return db.select().from(dayPlans).where(eq(dayPlans.id, id)).get(); }
  async createPlan(p: InsertDayPlan) { const now = Date.now(); return db.insert(dayPlans).values({ ...p, createdAt: now, updatedAt: now }).returning().get(); }
  async updatePlan(id: number, patch: Partial<InsertDayPlan>) { return db.update(dayPlans).set({ ...patch, updatedAt: Date.now() }).where(eq(dayPlans.id, id)).returning().get(); }
  async getPlanItems(planId: number) { return db.select().from(dayPlanItems).where(eq(dayPlanItems.planId, planId)).orderBy(asc(dayPlanItems.sequence)).all(); }
  async getPlanItem(id: number) { return db.select().from(dayPlanItems).where(eq(dayPlanItems.id, id)).get(); }
  async createPlanItem(i: InsertDayPlanItem) { return db.insert(dayPlanItems).values({ ...i, createdAt: Date.now() }).returning().get(); }
  async updatePlanItem(id: number, patch: Partial<InsertDayPlanItem>) { return db.update(dayPlanItems).set(patch).where(eq(dayPlanItems.id, id)).returning().get(); }
  async clearPlanItems(planId: number) { db.delete(dayPlanItems).where(eq(dayPlanItems.planId, planId)).run(); }
  async logActivity(a: InsertActivityLog) { db.insert(activityLog).values({ ...a, timestamp: Date.now() }).run(); }
  // Read-only behavioural truth (P4.5 evidence layer). activityLog stays the
  // system-of-record; this is the only reader and never writes.
  async getActivityLog() { return db.select().from(activityLog).orderBy(desc(activityLog.timestamp)).all(); }
  async getCareerTracks() { return db.select().from(careerTracks).orderBy(desc(careerTracks.priority)).all(); }
  async createCareerTrack(t: InsertCareerTrack) { return db.insert(careerTracks).values({ ...t, createdAt: Date.now() }).returning().get(); }
  async updateCareerTrack(id: number, patch: Partial<InsertCareerTrack>) { return db.update(careerTracks).set(patch).where(eq(careerTracks.id, id)).returning().get(); }
  async deleteCareerTrack(id: number) {
    db.update(tasks).set({ relatedTrackId: null } as any).where(eq(tasks.relatedTrackId, id)).run();
    db.update(jobs).set({ relatedTrackId: null } as any).where(eq(jobs.relatedTrackId, id)).run();
    db.update(learn).set({ relatedTrackId: null } as any).where(eq(learn.relatedTrackId, id)).run();
    db.update(hustles).set({ proofAssetForTrack: null } as any).where(eq(hustles.proofAssetForTrack, id)).run();
    db.update(contacts).set({ relatedTrackId: null } as any).where(eq(contacts.relatedTrackId, id)).run();
    db.update(wins).set({ trackId: null } as any).where(eq(wins.trackId, id)).run();
    db.delete(networkGaps).where(eq(networkGaps.trackId, id)).run();
    db.delete(contactClassifications).where(eq(contactClassifications.trackId, id)).run();
    const trackRecs = db.select().from(recommendations).where(eq(recommendations.linkedTrackId, id)).all();
    for (const rec of trackRecs) {
      db.delete(recommendationSubdivisions).where(eq(recommendationSubdivisions.recommendationId, rec.id)).run();
      db.delete(recommendationMilestones).where(eq(recommendationMilestones.recommendationId, rec.id)).run();
    }
    db.delete(recommendations).where(eq(recommendations.linkedTrackId, id)).run();
    db.delete(careerTracks).where(eq(careerTracks.id, id)).run();
  }
  async getDiscoverySession(id: number) { return db.select().from(discoverySessions).where(eq(discoverySessions.id, id)).get(); }
  async createDiscoverySession(session: InsertDiscoverySession) {
    const now = Date.now();
    return db.insert(discoverySessions).values({ ...session, createdAt: now, updatedAt: now }).returning().get();
  }
  async updateDiscoverySession(id: number, patch: Partial<InsertDiscoverySession>) {
    return db.update(discoverySessions).set({ ...patch, updatedAt: Date.now() }).where(eq(discoverySessions.id, id)).returning().get();
  }
  async getRecommendations() {
    return db.select().from(recommendations)
      .orderBy(desc(recommendations.rankScore), desc(recommendations.createdAt), desc(recommendations.id)).all();
  }
  async getRecommendation(id: number) {
    return db.select().from(recommendations).where(eq(recommendations.id, id)).get();
  }
  async createRecommendation(item: InsertRecommendation) {
    return db.insert(recommendations).values({ ...item, createdAt: Date.now() }).returning().get();
  }
  async updateRecommendation(id: number, patch: Partial<InsertRecommendation>) {
    return db.update(recommendations).set(patch).where(eq(recommendations.id, id)).returning().get();
  }
  async deleteRecommendation(id: number) {
    db.delete(recommendationSubdivisions).where(eq(recommendationSubdivisions.recommendationId, id)).run();
    db.delete(recommendationMilestones).where(eq(recommendationMilestones.recommendationId, id)).run();
    db.delete(recommendations).where(eq(recommendations.id, id)).run();
  }
  async getRecommendationSubdivisions(recommendationId: number) {
    return db.select().from(recommendationSubdivisions)
      .where(eq(recommendationSubdivisions.recommendationId, recommendationId))
      .orderBy(asc(recommendationSubdivisions.sequence), asc(recommendationSubdivisions.id)).all();
  }
  async createRecommendationSubdivision(item: InsertRecommendationSubdivision) {
    return db.insert(recommendationSubdivisions).values({ ...item, createdAt: Date.now() }).returning().get();
  }
  async updateRecommendationSubdivision(id: number, patch: Partial<InsertRecommendationSubdivision>) {
    return db.update(recommendationSubdivisions).set(patch)
      .where(eq(recommendationSubdivisions.id, id)).returning().get();
  }
  async deleteRecommendationSubdivision(id: number) {
    db.delete(recommendationSubdivisions).where(eq(recommendationSubdivisions.id, id)).run();
  }
  async getRecommendationMilestones(recommendationId: number) {
    return db.select().from(recommendationMilestones)
      .where(eq(recommendationMilestones.recommendationId, recommendationId))
      .orderBy(asc(recommendationMilestones.sequence), asc(recommendationMilestones.id)).all();
  }
  async getRecommendationMilestonesForRecommendationIds(recommendationIds: number[]) {
    if (!recommendationIds.length) return [];
    return db.select().from(recommendationMilestones)
      .where(inArray(recommendationMilestones.recommendationId, recommendationIds))
      .orderBy(
        asc(recommendationMilestones.recommendationId),
        asc(recommendationMilestones.sequence),
        asc(recommendationMilestones.id),
      ).all();
  }
  async getRecommendationMilestone(id: number) {
    return db.select().from(recommendationMilestones)
      .where(eq(recommendationMilestones.id, id)).get();
  }
  async createRecommendationMilestone(item: InsertRecommendationMilestone) {
    return db.insert(recommendationMilestones).values({ ...item, createdAt: Date.now() }).returning().get();
  }
  async updateRecommendationMilestone(id: number, patch: Partial<InsertRecommendationMilestone>) {
    return db.update(recommendationMilestones).set(patch)
      .where(eq(recommendationMilestones.id, id)).returning().get();
  }
  async deleteRecommendationMilestone(id: number) {
    db.delete(recommendationMilestones).where(eq(recommendationMilestones.id, id)).run();
  }
  _cleanEntityLinks(type: string, id: number) {
    db.delete(entityLinks).where(
      or(
        and(eq(entityLinks.fromType, type), eq(entityLinks.fromId, id)),
        and(eq(entityLinks.toType, type), eq(entityLinks.toId, id)),
      ),
    ).run();
  }

  async linkTrack(entity: TrackEntity, id: number, trackId: number | null) {
    const table = TRACK_TABLES[entity];
    const patch = entity === "hustles" ? { proofAssetForTrack: trackId } : { relatedTrackId: trackId };
    return db.update(table).set(patch as any).where(eq(table.id, id)).returning().get();
  }

  // P4.4 — persist the produced-artifact link on a learn item (flips its derived
  // outputState to "evidenced"). Optionally record a proof_for entityLink from
  // the learn item to a produced object (e.g. a task) when an id is supplied.
  async markLearnEvidenced(id: number, outputEvidenceUrl: string, proofToId?: number | null) {
    const updated = db.update(learn).set({ outputEvidenceUrl }).where(eq(learn.id, id)).returning().get();
    if (!updated) return undefined;
    if (proofToId != null && Number.isFinite(proofToId)) {
      db.insert(entityLinks).values({
        fromType: "learn", fromId: id, toType: "task", toId: proofToId,
        relationType: "proof_for", createdAt: Date.now(),
      }).run();
    }
    return updated;
  }

  // P4.4 — set of learn ids that already have a proof_for entityLink. Lets the
  // derived outputState count an evidenced item even before its url is filled in.
  async getLearnProofLinkIds() {
    const rows = db.select().from(entityLinks)
      .where(eq(entityLinks.fromType, "learn")).all()
      .filter((r) => r.relationType === "proof_for");
    return new Set<number>(rows.map((r) => r.fromId));
  }

  async getJobContactLinks(jobId: number): Promise<number[]> {
    const rows = db.select().from(entityLinks)
      .where(and(
        eq(entityLinks.fromType, "contact"),
        eq(entityLinks.toType, "job"),
        eq(entityLinks.toId, jobId),
        eq(entityLinks.relationType, "contact_for"),
      )).all();
    return rows.map((r) => r.fromId);
  }

  async getAllJobContactLinks(): Promise<Record<number, number[]>> {
    const rows = db.select().from(entityLinks)
      .where(and(
        eq(entityLinks.fromType, "contact"),
        eq(entityLinks.toType, "job"),
        eq(entityLinks.relationType, "contact_for"),
      )).all();
    const result: Record<number, number[]> = {};
    for (const r of rows) {
      (result[r.toId] ??= []).push(r.fromId);
    }
    return result;
  }

  async linkContactToJob(contactId: number, jobId: number) {
    const existing = db.select().from(entityLinks)
      .where(and(
        eq(entityLinks.fromType, "contact"),
        eq(entityLinks.fromId, contactId),
        eq(entityLinks.toType, "job"),
        eq(entityLinks.toId, jobId),
        eq(entityLinks.relationType, "contact_for"),
      )).get();
    if (existing) return existing;
    return db.insert(entityLinks).values({
      fromType: "contact", fromId: contactId,
      toType: "job", toId: jobId,
      relationType: "contact_for", createdAt: Date.now(),
    }).returning().get();
  }

  async unlinkContactFromJob(contactId: number, jobId: number) {
    db.delete(entityLinks).where(and(
      eq(entityLinks.fromType, "contact"),
      eq(entityLinks.fromId, contactId),
      eq(entityLinks.toType, "job"),
      eq(entityLinks.toId, jobId),
      eq(entityLinks.relationType, "contact_for"),
    )).run();
  }

  async getProfile() {
    return db.select().from(userProfile).get() ?? null;
  }
  async upsertProfile(patch: { cvText: string }) {
    const existing = await this.getProfile();
    if (existing) {
      return db.update(userProfile).set({ cvText: patch.cvText, updatedAt: Date.now() })
        .where(eq(userProfile.id, existing.id)).returning().get();
    }
    return db.insert(userProfile).values({ cvText: patch.cvText, updatedAt: Date.now() }).returning().get();
  }

  // Network Builder
  async getNetworkGaps(trackId?: number) {
    if (trackId != null) return db.select().from(networkGaps).where(eq(networkGaps.trackId, trackId)).all();
    return db.select().from(networkGaps).all();
  }
  async upsertNetworkGaps(trackId: number, gaps: InsertNetworkGap[]) {
    db.delete(networkGaps).where(eq(networkGaps.trackId, trackId)).run();
    const now = Date.now();
    for (const g of gaps) db.insert(networkGaps).values({ ...g, trackId, createdAt: now }).run();
    return this.getNetworkGaps(trackId);
  }
  async getContactClassifications(contactId?: number) {
    if (contactId != null) return db.select().from(contactClassifications).where(eq(contactClassifications.contactId, contactId)).all();
    return db.select().from(contactClassifications).all();
  }
  async upsertContactClassifications(contactId: number, cls: InsertContactClassification[]) {
    db.delete(contactClassifications).where(eq(contactClassifications.contactId, contactId)).run();
    const now = Date.now();
    for (const c of cls) db.insert(contactClassifications).values({ ...c, contactId, createdAt: now }).run();
    return this.getContactClassifications(contactId);
  }
  async deleteContactClassifications(contactId: number) {
    db.delete(contactClassifications).where(eq(contactClassifications.contactId, contactId)).run();
  }
  async getContactInteractions(contactId: number) {
    return db.select().from(contactInteractions)
      .where(eq(contactInteractions.contactId, contactId))
      .orderBy(desc(contactInteractions.createdAt)).all();
  }
  async createContactInteraction(data: Omit<InsertContactInteraction, 'createdAt'>) {
    const now = Date.now();
    return db.insert(contactInteractions).values({ ...data, createdAt: now }).returning().get();
  }
  async updateContactNextAction(id: number, nextActionType: string, nextActionDue: number | null, nextActionDesc: string) {
    return db.update(contacts).set({ nextActionType, nextActionDue, nextActionDesc } as any)
      .where(eq(contacts.id, id)).returning().get();
  }
}

export const storage = bindProxy<IStorage>(() => getStorageRuntime().storage);
