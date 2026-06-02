import {
  tasks, events, jobs, learn, hustles, wins, contacts,
  dayPlans, dayPlanItems, activityLog, careerTracks, jobPipelineSteps,
  type Task, type InsertTask,
  type Event, type InsertEvent,
  type Job, type InsertJob,
  type JobPipelineStep, type InsertJobPipelineStep,
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
  getCareerTracks(): Promise<CareerTrack[]>;
  createCareerTrack(t: InsertCareerTrack): Promise<CareerTrack>;
  linkTrack(entity: TrackEntity, id: number, trackId: number | null): Promise<any | undefined>;
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
  async deleteHustle(id: number) { db.delete(hustles).where(eq(hustles.id, id)).run(); }

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
  async getCareerTracks() { return db.select().from(careerTracks).orderBy(desc(careerTracks.priority)).all(); }
  async createCareerTrack(t: InsertCareerTrack) { return db.insert(careerTracks).values({ ...t, createdAt: Date.now() }).returning().get(); }
  async linkTrack(entity: TrackEntity, id: number, trackId: number | null) {
    const table = TRACK_TABLES[entity];
    const patch = entity === "hustles" ? { proofAssetForTrack: trackId } : { relatedTrackId: trackId };
    return db.update(table).set(patch as any).where(eq(table.id, id)).returning().get();
  }
}

export const storage = new DatabaseStorage();
