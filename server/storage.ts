import {
  tasks, events, jobs, learn, hustles, wins, contacts,
  dayPlans, dayPlanItems, activityLog, careerTracks, jobPipelineSteps, proofAssetSteps, entityLinks,
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
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, asc, desc } from "drizzle-orm";
import { templateForArchetype } from "@shared/jobTemplates";
import { templateForProofAsset } from "@shared/proofAssetTemplates";

const DB_PATH = process.env.ANCHOR_DB_PATH || "data.db";
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

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
  createPlan(p: InsertDayPlan): Promise<DayPlan>;
  updatePlan(id: number, patch: Partial<InsertDayPlan>): Promise<DayPlan | undefined>;
  getPlanItems(planId: number): Promise<DayPlanItem[]>;
  createPlanItem(i: InsertDayPlanItem): Promise<DayPlanItem>;
  updatePlanItem(id: number, patch: Partial<InsertDayPlanItem>): Promise<DayPlanItem | undefined>;
  clearPlanItems(planId: number): Promise<void>;
  logActivity(a: InsertActivityLog): Promise<void>;
  getActivityLog(): Promise<ActivityLog[]>;
  getCareerTracks(): Promise<CareerTrack[]>;
  createCareerTrack(t: InsertCareerTrack): Promise<CareerTrack>;
  linkTrack(entity: TrackEntity, id: number, trackId: number | null): Promise<any | undefined>;
  // P4.4 — learn proof-building
  markLearnEvidenced(id: number, outputEvidenceUrl: string, proofToId?: number | null): Promise<Learn | undefined>;
  getLearnProofLinkIds(): Promise<Set<number>>;
}

// Entities that carry a track link. Hustles store it in proofAssetForTrack;
// everything else in relatedTrackId.
export type TrackEntity = "jobs" | "learn" | "contacts" | "hustles" | "tasks";
const TRACK_TABLES = { jobs, learn, contacts, hustles, tasks } as const;

export class DatabaseStorage implements IStorage {
  async getTasks() { return db.select().from(tasks).orderBy(asc(tasks.sort), asc(tasks.id)).all(); }
  async createTask(t: InsertTask) { return db.insert(tasks).values({ ...t, createdAt: Date.now() }).returning().get(); }
  async updateTask(id: number, patch: Partial<InsertTask>) { return db.update(tasks).set(patch).where(eq(tasks.id, id)).returning().get(); }
  async deleteTask(id: number) { db.delete(tasks).where(eq(tasks.id, id)).run(); }

  async getEvents(day: string) { return db.select().from(events).where(eq(events.day, day)).orderBy(asc(events.start)).all(); }
  async replaceEventsForDay(day: string, items: InsertEvent[]) {
    db.delete(events).where(eq(events.day, day)).run();
    for (const it of items) db.insert(events).values({ ...it, day, createdAt: Date.now() }).run();
  }

  async getJobs() { return db.select().from(jobs).orderBy(desc(jobs.id)).all(); }
  async createJob(j: InsertJob) { return db.insert(jobs).values({ ...j, createdAt: Date.now() }).returning().get(); }
  async updateJob(id: number, patch: Partial<InsertJob>) { return db.update(jobs).set(patch).where(eq(jobs.id, id)).returning().get(); }
  async deleteJob(id: number) {
    db.delete(jobs).where(eq(jobs.id, id)).run();
    db.delete(jobPipelineSteps).where(eq(jobPipelineSteps.jobId, id)).run();
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
  async createLearn(l: InsertLearn) { return db.insert(learn).values({ ...l, createdAt: Date.now() }).returning().get(); }
  async updateLearn(id: number, patch: Partial<InsertLearn>) { return db.update(learn).set(patch).where(eq(learn.id, id)).returning().get(); }
  async deleteLearn(id: number) { db.delete(learn).where(eq(learn.id, id)).run(); }

  async getHustles() { return db.select().from(hustles).orderBy(desc(hustles.id)).all(); }
  async createHustle(h: InsertHustle) { return db.insert(hustles).values({ ...h, createdAt: Date.now() }).returning().get(); }
  async updateHustle(id: number, patch: Partial<InsertHustle>) { return db.update(hustles).set(patch).where(eq(hustles.id, id)).returning().get(); }
  async deleteHustle(id: number) {
    db.delete(hustles).where(eq(hustles.id, id)).run();
    db.delete(proofAssetSteps).where(eq(proofAssetSteps.hustleId, id)).run();
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
  async deleteContact(id: number) { db.delete(contacts).where(eq(contacts.id, id)).run(); }

  async getPlanByDate(date: string) { return db.select().from(dayPlans).where(eq(dayPlans.date, date)).get(); }
  async createPlan(p: InsertDayPlan) { const now = Date.now(); return db.insert(dayPlans).values({ ...p, createdAt: now, updatedAt: now }).returning().get(); }
  async updatePlan(id: number, patch: Partial<InsertDayPlan>) { return db.update(dayPlans).set({ ...patch, updatedAt: Date.now() }).where(eq(dayPlans.id, id)).returning().get(); }
  async getPlanItems(planId: number) { return db.select().from(dayPlanItems).where(eq(dayPlanItems.planId, planId)).orderBy(asc(dayPlanItems.sequence)).all(); }
  async createPlanItem(i: InsertDayPlanItem) { return db.insert(dayPlanItems).values({ ...i, createdAt: Date.now() }).returning().get(); }
  async updatePlanItem(id: number, patch: Partial<InsertDayPlanItem>) { return db.update(dayPlanItems).set(patch).where(eq(dayPlanItems.id, id)).returning().get(); }
  async clearPlanItems(planId: number) { db.delete(dayPlanItems).where(eq(dayPlanItems.planId, planId)).run(); }
  async logActivity(a: InsertActivityLog) { db.insert(activityLog).values({ ...a, timestamp: Date.now() }).run(); }
  // Read-only behavioural truth (P4.5 evidence layer). activityLog stays the
  // system-of-record; this is the only reader and never writes.
  async getActivityLog() { return db.select().from(activityLog).orderBy(desc(activityLog.timestamp)).all(); }
  async getCareerTracks() { return db.select().from(careerTracks).orderBy(desc(careerTracks.priority)).all(); }
  async createCareerTrack(t: InsertCareerTrack) { return db.insert(careerTracks).values({ ...t, createdAt: Date.now() }).returning().get(); }
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
}

export const storage = new DatabaseStorage();
