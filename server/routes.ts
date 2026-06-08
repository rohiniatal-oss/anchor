import type { Express } from "express";
import type { Server } from 'node:http';
import { storage, type TrackEntity } from "./storage";
import { createNextTask, materializeJobStep, materializeProofStep, type NextTaskSourceType } from "./nextTask";
import { getTrackDiagnostics, getUnlinkedItems, getEvidencePayload } from "./strategy";
import { computeLearningGaps } from "./learningStrategy";
import { computeWinsSummary } from "./evidence";

import {
  insertTaskSchema, insertJobSchema,
  insertLearnSchema, insertHustleSchema, insertWinSchema, insertContactSchema,
  insertJobPipelineStepSchema, insertProofAssetStepSchema,
} from "@shared/schema";
import { isSubmitStep } from "@shared/jobTemplates";
import { migrateFellowshipLearnRows } from "./fellowshipMigration";
import { registerPlanningRoutes } from "./planningRoutes";
import { registerStrategyRoutes } from "./strategyRoutes";
import { registerTaskAssistRoutes } from "./taskAssistRoutes";

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

  crud(app, "tasks", () => storage.getTasks(), insertTaskSchema,
    (d) => storage.createTask(d), (id, d) => storage.updateTask(id, d), (id) => storage.deleteTask(id));
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

  // ═══ P4.1: JOB PIPELINE STEPS — a TASK-GENERATIVE readiness rail over a job ═══
  // Steps are SEEDED from an archetype template, then editable per job. Each step
  // does ONLY ONE of: materialize-as-task (reuses 3.5 createNextTask provenance +
  // dedupe), mark-done, or mark-blocked. Editing changes sequence/label only.

  // Seed from template — no-op if steps already exist; always returns the steps.
  app.get("/api/jobs/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getJobSteps(id));
  });
  app.post("/api/jobs/:id/steps/seed", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const steps = await storage.seedJobSteps(id);
    if (!steps.length) {
      const job = (await storage.getJobs()).find((j) => j.id === id);
      if (!job) return res.status(404).json({ error: "Job not found" });
    }
    res.json(steps);
  });

  // Add a custom step.
  app.post("/api/jobs/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const stepLabel = String(req.body?.stepLabel || "").trim().slice(0, 120);
    if (!stepLabel) return res.status(400).json({ error: "Need a stepLabel" });
    const note = String(req.body?.note || "").slice(0, 300);
    const sequence = Number.isFinite(Number(req.body?.sequence)) ? Number(req.body.sequence) : undefined;
    res.json(await storage.createJobStep(id, { stepLabel, note, sequence }));
  });

  // Edit label / status / note / sequence (the one-action contract is unchanged).
  // P4.6a #3: marking the SUBMIT step done is a DETERMINISTIC submit signal —
  // it advances the job wishlist -> applied (derived from the step label, no fuzzy
  // task.doneWhen matching). Any other step done does NOT touch job status.
  app.patch("/api/steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const p = insertJobPipelineStepSchema.partial().omit({ jobId: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateJobStep(stepId, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (p.data.status === "done" && isSubmitStep(updated.stepLabel)) {
      const jb = (await storage.getJobs()).find((x) => x.id === updated.jobId);
      if (jb && jb.status === "wishlist") {
        await storage.updateJob(jb.id, { status: "applied", applicationReadiness: "submitted" } as any);
        await storage.logActivity({ eventType: "completed", sourceType: "job", sourceId: jb.id, metadata: JSON.stringify({ stepId, submitted: true }) } as any);
      }
    }
    res.json(updated);
  });

  // P4.6a #3: explicit "Mark application submitted" affordance on the job card —
  // the safest deterministic path to wishlist -> applied. Never fabricated.
  app.post("/api/jobs/:id/mark-submitted", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const job = (await storage.getJobs()).find((x) => x.id === id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status === "wishlist") {
      await storage.updateJob(id, { status: "applied", applicationReadiness: "submitted" } as any);
    }
    await storage.logActivity({ eventType: "completed", sourceType: "job", sourceId: id, metadata: JSON.stringify({ submitted: true, explicit: true }) } as any);
    const updated = (await storage.getJobs()).find((x) => x.id === id);
    res.json({ ok: true, job: updated });
  });

  app.delete("/api/steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    await storage.deleteJobStep(stepId);
    res.json({ ok: true });
  });

  app.patch("/api/jobs/:id/steps/reorder", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const ordered = Array.isArray(req.body?.orderedStepIds) ? req.body.orderedStepIds.map(Number).filter(Number.isFinite) : null;
    if (!ordered) return res.status(400).json({ error: "Need orderedStepIds:number[]" });
    res.json(await storage.reorderJobSteps(id, ordered));
  });

  // Materialize a step into a task via the existing provenance + dedupe machinery.
  // The step records the resulting taskId; status moves to done when materialized
  // (the task now carries the work). Reuses an open task rather than duplicating.
  app.post("/api/steps/:stepId/materialize", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getJobStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const result = await materializeJobStep(step);
    if (!result) return res.status(404).json({ error: "Job not found" });
    await storage.logActivity({ eventType: "planned", sourceType: "job", sourceId: step.jobId, taskId: result.task.id, metadata: JSON.stringify({ stepId, reused: result.reused }) } as any);
    res.json({ ...result.task, reused: result.reused, stepId });
  });

  // mark-blocked: thin status + blocker note on the step. NOT a parallel state
  // machine — if the step already materialized a task, reuse task readiness=blocked.
  app.post("/api/steps/:stepId/block", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getJobStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const updated = await storage.updateJobStep(stepId, { status: "blocked", note: reason } as any);
    if (step.taskId) {
      await storage.updateTask(step.taskId, { readiness: "blocked", blockerReason: reason, status: "stuck" } as any);
    }
    await storage.logActivity({ eventType: "blocked", sourceType: "job", sourceId: step.jobId, taskId: step.taskId ?? undefined, metadata: JSON.stringify({ stepId, reason }) } as any);
    res.json(updated);
  });

  // ═══ P4.3: PROOF ASSET STEPS — a TASK-GENERATIVE proof-production rail over a ═══
  // proof asset (hustle). Steps are SEEDED from a kind-aware template (substack/
  // afterline/memo), then editable per asset. Each step does ONLY ONE of:
  // materialize-as-task (reuses 3.5 createNextTask provenance + dedupe, carrying
  // proofAssetForTrack as relatedTrackId), mark-done, or mark-blocked. Mirrors the
  // 4.1 job step API exactly; "blocked" is distinct from "skipped".
  app.get("/api/hustles/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getProofAssetSteps(id));
  });

  // Seed from the kind-aware template — no-op if steps already exist.
  app.post("/api/hustles/:id/steps/seed", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const steps = await storage.seedProofAssetSteps(id);
    if (!steps.length) {
      const h = (await storage.getHustles()).find((x) => x.id === id);
      if (!h) return res.status(404).json({ error: "Proof asset not found" });
    }
    res.json(steps);
  });

  // Add a custom step.
  app.post("/api/hustles/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const stepLabel = String(req.body?.stepLabel || "").trim().slice(0, 120);
    if (!stepLabel) return res.status(400).json({ error: "Need a stepLabel" });
    const note = String(req.body?.note || "").slice(0, 300);
    const sequence = Number.isFinite(Number(req.body?.sequence)) ? Number(req.body.sequence) : undefined;
    res.json(await storage.createProofAssetStep(id, { stepLabel, note, sequence }));
  });

  // Edit label / status / note / sequence (one-action contract unchanged).
  app.patch("/api/proof-steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const p = insertProofAssetStepSchema.partial().omit({ hustleId: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateProofAssetStep(stepId, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/proof-steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    await storage.deleteProofAssetStep(stepId);
    res.json({ ok: true });
  });

  app.patch("/api/hustles/:id/steps/reorder", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const ordered = Array.isArray(req.body?.orderedStepIds) ? req.body.orderedStepIds.map(Number).filter(Number.isFinite) : null;
    if (!ordered) return res.status(400).json({ error: "Need orderedStepIds:number[]" });
    res.json(await storage.reorderProofAssetSteps(id, ordered));
  });

  // Materialize a proof step into a task via the existing provenance + dedupe
  // machinery. The task carries proofAssetForTrack (as relatedTrackId) from the
  // hustle branch of createNextTask. Records the resulting taskId; reuses an
  // open hustle task rather than duplicating.
  app.post("/api/proof-steps/:stepId/materialize", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getProofAssetStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const result = await materializeProofStep(step);
    if (!result) return res.status(404).json({ error: "Proof asset not found" });
    await storage.logActivity({ eventType: "planned", sourceType: "hustle", sourceId: step.hustleId, taskId: result.task.id, metadata: JSON.stringify({ stepId, reused: result.reused }) } as any);
    res.json({ ...result.task, reused: result.reused, stepId });
  });

  // mark-blocked: thin status + blocker note on the step. "blocked" is distinct
  // from "skipped". If the step already materialized a task, propagate
  // readiness="blocked" to that task (NOT a parallel state machine).
  app.post("/api/proof-steps/:stepId/block", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getProofAssetStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const updated = await storage.updateProofAssetStep(stepId, { status: "blocked", note: reason } as any);
    if (step.taskId) {
      await storage.updateTask(step.taskId, { readiness: "blocked", blockerReason: reason, status: "stuck" } as any);
    }
    await storage.logActivity({ eventType: "blocked", sourceType: "hustle", sourceId: step.hustleId, taskId: step.taskId ?? undefined, metadata: JSON.stringify({ stepId, reason }) } as any);
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
