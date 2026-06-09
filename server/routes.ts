import type { Express } from "express";
import type { Server } from 'node:http';
import { storage, type TrackEntity } from "./storage";
import { createNextTask, type NextTaskSourceType } from "./nextTask";
import { getTrackDiagnostics, getUnlinkedItems, getEvidencePayload } from "./strategy";
import { computeLearningGaps } from "./learningStrategy";
import { computeWinsSummary } from "./evidence";

import {
  insertTaskSchema, insertJobSchema,
  insertLearnSchema, insertHustleSchema, insertWinSchema, insertContactSchema,
} from "@shared/schema";
import { migrateFellowshipLearnRows } from "./fellowshipMigration";
import { registerPlanningRoutes } from "./planningRoutes";
import { registerStrategyRoutes } from "./strategyRoutes";
import { registerTaskAssistRoutes } from "./taskAssistRoutes";
import { registerWorkflowStepRoutes } from "./workflowStepRoutes";
import { normalizeExistingTaskBreakdown } from "./taskBreakdownRoutes";

function crud(app: Express, name: string, get: () => Promise<any>, schema: any,
  create: (d: any) => Promise<any>, update: (id: number, d: any) => Promise<any>, del: (id: number) => Promise<any>) {
  app.get(`/api/${name}`, async (_q, res) => res.json(await get()));
  app.post(`/api/${name}`, async (req, res) => {
    const p = schema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(await create(p.data));
  });
  app.patch(`/api/${name}/:id`, async (req, res) => {
    const p = schema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const u = await update(Number(req.params.id), p.data);
    if (!u) return res.status(404).json({ error: "Not found" });
    res.json(u);
  });
  app.delete(`/api/${name}/:id`, async (req, res) => { await del(Number(req.params.id)); res.json({ ok: true }); });
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // MECE fix: move any legacy fellowship `learn` rows into the opportunity
  // pipeline before serving. Idempotent + conservative (dedupe by title+kind;
  // never misclassifies a course). Safe to run on every boot.
  try { migrateFellowshipLearnRows(); } catch (e) { console.error("Fellowship migration skipped:", e); }

  app.get("/api/tasks", async (_q, res) => {
    const current = await storage.getTasks();
    const repaired = await Promise.all(current.map(async (task) => {
      const normalized = await normalizeExistingTaskBreakdown(task);
      if (!normalized.changed) return task;
      return await storage.updateTask(task.id, {
        steps: normalized.steps,
        minimumOutcome: normalized.minimumOutcome,
      } as any) || { ...task, steps: normalized.steps, minimumOutcome: normalized.minimumOutcome };
    }));
    res.json(repaired);
  });
  app.post("/api/tasks", async (req, res) => {
    const p = insertTaskSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(await storage.createTask(p.data));
  });
  app.patch("/api/tasks/:id", async (req, res) => {
    const p = insertTaskSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const u = await storage.updateTask(Number(req.params.id), p.data);
    if (!u) return res.status(404).json({ error: "Not found" });
    res.json(u);
  });
  app.delete("/api/tasks/:id", async (req, res) => {
    await storage.deleteTask(Number(req.params.id));
    res.json({ ok: true });
  });
  crud(app, "jobs", () => storage.getJobs(), insertJobSchema,
    (d) => storage.createJob(d), (id, d) => storage.updateJob(id, d), (id) => storage.deleteJob(id));
  crud(app, "learn", () => storage.getLearn(), insertLearnSchema,
    (d) => storage.createLearn(d), (id, d) => storage.updateLearn(id, d), (id) => storage.deleteLearn(id));
  crud(app, "hustles", () => storage.getHustles(), insertHustleSchema,
    (d) => storage.createHustle(d), (id, d) => storage.updateHustle(id, d), (id) => storage.deleteHustle(id));
  crud(app, "wins", () => storage.getWins(), insertWinSchema,
    (d) => storage.createWin(d), () => Promise.resolve(undefined), (id) => storage.deleteWin(id));
  crud(app, "contacts", () => storage.getContacts(), insertContactSchema,
    (d) => storage.createContact(d), (id, d) => storage.updateContact(id, d), (id) => storage.deleteContact(id));

  registerTaskAssistRoutes(app);
  registerPlanningRoutes(app);
  registerWorkflowStepRoutes(app);
  registerStrategyRoutes(app);

  // ═══ P3.5: NEXT-TASK ENGINE — every source can spawn a provenance-carrying task ═══
  // Maps an entity route segment to the source type the engine understands.
  const NEXT_TASK_SOURCES: Record<string, NextTaskSourceType> = {
    jobs: "job", learn: "learn", contacts: "contact", hustles: "hustle",
  };
  for (const [seg, sourceType] of Object.entries(NEXT_TASK_SOURCES)) {
    app.post(`/api/${seg}/:id/create-next-task`, async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
      const result = await createNextTask({ sourceType, sourceId: id });
      if (!result) return res.status(404).json({ error: "Source not found" });
      res.json({ ...result.task, reused: result.reused });
    });
  }

  // ═══ P4.4: LEARN AS A PROOF-BUILDING VIEW ═══
  // create-output-task is an intent-named ALIAS over the existing 3.5 learn
  // create-next-task (REUSES createNextTask(sourceType "learn") — title from
  // requiredOutput, doneWhen references the artifact — with provenance + dedupe).
  // No parallel task creator. PATCH /api/learn/:id is already provided by crud()
  // and accepts requiredOutput / outputEvidenceUrl / learnStatus / relatedTrackId.
  app.post("/api/learn/:id/create-output-task", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await createNextTask({ sourceType: "learn", sourceId: id });
    if (!result) return res.status(404).json({ error: "Learn item not found" });
    res.json({ ...result.task, reused: result.reused });
  });

  // mark-evidenced: persist the produced-artifact url onto the learn item (flips
  // derived outputState to "evidenced"); optionally record a proof_for entityLink
  // to a produced task when proofToId is supplied (kept optional/simple).
  app.post("/api/learn/:id/mark-evidenced", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const outputEvidenceUrl = String(req.body?.outputEvidenceUrl || "").trim().slice(0, 500);
    if (!outputEvidenceUrl) return res.status(400).json({ error: "Need outputEvidenceUrl" });
    const rawProof = req.body?.proofToId;
    const proofToId = rawProof === null || rawProof === undefined ? null : Number(rawProof);
    if (proofToId !== null && !Number.isFinite(proofToId)) return res.status(400).json({ error: "proofToId must be a number or null" });
    const updated = await storage.markLearnEvidenced(id, outputEvidenceUrl, proofToId);
    if (!updated) return res.status(404).json({ error: "Learn item not found" });
    await storage.logActivity({ eventType: "completed", sourceType: "learn", sourceId: id, metadata: JSON.stringify({ evidenced: true, proofToId }) } as any);
    res.json(updated);
  });

  // ═══ P3.5: TRACK COHERENCE — link any source/task to a career track in place ═══
  const LINK_ENTITIES = new Set<TrackEntity>(["jobs", "learn", "contacts", "hustles", "tasks"]);
  app.patch("/api/:entity/:id/link-track", async (req, res) => {
    const entity = String(req.params.entity) as TrackEntity;
    if (!LINK_ENTITIES.has(entity)) return res.status(400).json({ error: "Unknown entity" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const raw = req.body?.trackId;
    if (raw !== null && raw !== undefined && !Number.isFinite(Number(raw)))
      return res.status(400).json({ error: "trackId must be a number or null" });
    const trackId = raw === null || raw === undefined ? null : Number(raw);
    const updated = await storage.linkTrack(entity, id, trackId);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // Career tracks list (for the in-card Link track control).
  app.get("/api/career-tracks", async (_req, res) => res.json(await storage.getCareerTracks()));

  // ═══ P3.5: STRATEGY DIAGNOSTICS — per-track bottlenecks + unlinked bucket ═══
  app.get("/api/strategy/diagnostics", async (_req, res) => res.json({ tracks: await getTrackDiagnostics() }));
  app.get("/api/strategy/unlinked", async (_req, res) => res.json(await getUnlinkedItems()));

  // ═══ P4.5: EVIDENCE LAYER — read-only derived metrics over wins + activityLog ═══
  // Per-track diagnostics already carry compact per-track evidence (above); this
  // endpoint exposes the full per-track + untracked-bucket metrics. No write path.
  app.get("/api/strategy/evidence", async (_req, res) => res.json(await getEvidencePayload()));

  // ═══ P5: LEARNING STRATEGY — per-track capability gaps + deterministic sequencing ═══
  // Read-only. The gap engine (server/learningStrategy.ts) compares each track's
  // REQUIRED capability domains (data-driven from the track) against its EVIDENCED
  // domains and exposes the gap + a sequenced learning path (incl. unfilled-gap
  // slots where out-of-scope discovered resources later attach). No write path.
  app.get("/api/strategy/learning-gaps", async (_req, res) => res.json(await computeLearningGaps()));

  // Compact wins summary (by-category + window counts + streak + derived track per win).
  app.get("/api/wins/summary", async (_req, res) => res.json(await computeWinsSummary()));

  return httpServer;
}
