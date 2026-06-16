import type { Express } from "express";
import type { Server } from 'node:http';
import { storage, type TrackEntity } from "./storage";
import { createNextTask, type NextTaskSourceType } from "./nextTask";
import { getTrackDiagnostics, getUnlinkedItems, getEvidencePayload } from "./strategy";
import { computeLearningGaps } from "./learningStrategy";
import { computeWinsSummary } from "./evidence";
import { z } from "zod";

import {
  insertTaskSchema, insertJobSchema,
  insertLearnSchema, insertHustleSchema, insertWinSchema, insertContactSchema,
  insertRecommendationSchema, insertRecommendationSubdivisionSchema, insertRecommendationMilestoneSchema,
} from "@shared/schema";
import { migrateFellowshipLearnRows } from "./fellowshipMigration";
import { registerPlanningRoutes } from "./planningRoutes";
import { registerStrategyRoutes } from "./strategyRoutes";
import { registerTaskAssistRoutes } from "./taskAssistRoutes";
import { registerWorkflowStepRoutes } from "./workflowStepRoutes";
import { normalizeExistingTaskBreakdown } from "./taskBreakdownRoutes";
import { normalizeRecommendationMilestones, setRecommendationMilestoneStatus } from "./recommendationMilestoneProgress";
import { syncGapRecommendations } from "./gapRecommendations";

const acceptRecommendationSchema = z.object({
  entityType: z.enum(["task", "learn", "contact", "job", "hustle"]).optional(),
  title: z.string().trim().min(1).max(180).optional(),
  list: z.enum(["inbox", "today"]).optional(),
  trackId: z.number().int().nullable().optional(),
});

function safeJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function trimSentence(value: string | undefined, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function inferRecommendationEntityType(rec: {
  collection: string;
  kind: string;
  acceptanceEntityType: string;
}) {
  if (rec.acceptanceEntityType === "task" || rec.acceptanceEntityType === "learn" || rec.acceptanceEntityType === "contact" || rec.acceptanceEntityType === "job" || rec.acceptanceEntityType === "hustle") {
    return rec.acceptanceEntityType;
  }
  if (rec.collection === "learning-corpus" || rec.kind === "learning-resource" || rec.kind === "learning-theme") return "learn";
  if (rec.collection === "network-targets" || rec.kind === "contact-person-type" || rec.kind === "contact-actual-person") return "contact";
  if (rec.collection === "project-ideas" || rec.kind === "project-idea") return "hustle";
  if (rec.kind === "organization-target" || rec.kind === "role-example" || rec.kind === "next-step-idea") return "task";
  return "task";
}

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
        title: normalized.title,
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
  // Auto-generate gap-driven recommendations before returning the list; must be
  // registered before the crud() line so Express resolves this GET first.
  app.get("/api/recommendations", async (_q, res) => {
    try { await syncGapRecommendations(); } catch (e) { console.error("gap-rec sync skipped:", e); }
    res.json(await storage.getRecommendations());
  });
  crud(app, "recommendations", () => storage.getRecommendations(), insertRecommendationSchema,
    (d) => storage.createRecommendation(d), (id, d) => storage.updateRecommendation(id, d), (id) => storage.deleteRecommendation(id));

  app.get("/api/recommendations/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const recommendation = await storage.getRecommendation(id);
    if (!recommendation) return res.status(404).json({ error: "Not found" });
    const [subdivisions, milestones] = await Promise.all([
      storage.getRecommendationSubdivisions(id),
      storage.getRecommendationMilestones(id),
    ]);
    res.json({ ...recommendation, subdivisions, milestones });
  });

  app.get("/api/recommendations/:id/subdivisions", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getRecommendationSubdivisions(id));
  });
  app.post("/api/recommendations/:id/subdivisions", async (req, res) => {
    const recommendationId = Number(req.params.id);
    if (!Number.isFinite(recommendationId)) return res.status(400).json({ error: "Bad id" });
    const p = insertRecommendationSubdivisionSchema.safeParse({ ...req.body, recommendationId });
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(await storage.createRecommendationSubdivision(p.data));
  });
  app.patch("/api/recommendation-subdivisions/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const p = insertRecommendationSubdivisionSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateRecommendationSubdivision(id, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });
  app.delete("/api/recommendation-subdivisions/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    await storage.deleteRecommendationSubdivision(id);
    res.json({ ok: true });
  });

  app.get("/api/recommendations/:id/milestones", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getRecommendationMilestones(id));
  });
  app.post("/api/recommendations/:id/milestones", async (req, res) => {
    const recommendationId = Number(req.params.id);
    if (!Number.isFinite(recommendationId)) return res.status(400).json({ error: "Bad id" });
    const p = insertRecommendationMilestoneSchema.safeParse({ ...req.body, recommendationId });
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const created = await storage.createRecommendationMilestone(p.data);
    await normalizeRecommendationMilestones(recommendationId);
    res.json((await storage.getRecommendationMilestone(created.id)) || created);
  });
  app.patch("/api/recommendation-milestones/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const p = insertRecommendationMilestoneSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const existing = await storage.getRecommendationMilestone(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const requestedStatus = String(p.data.status || "").trim();
    const nonStatusPatch = { ...p.data } as Record<string, unknown>;
    delete nonStatusPatch.status;
    let updated = Object.keys(nonStatusPatch).length
      ? await storage.updateRecommendationMilestone(id, nonStatusPatch as any)
      : await storage.getRecommendationMilestone(id);
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (requestedStatus === "todo" || requestedStatus === "active" || requestedStatus === "blocked" || requestedStatus === "done" || requestedStatus === "skipped") {
      updated = (await setRecommendationMilestoneStatus(id, requestedStatus as any)) || undefined;
    } else {
      await normalizeRecommendationMilestones(existing.recommendationId);
      updated = (await storage.getRecommendationMilestone(id)) || undefined;
    }
    res.json(updated || existing);
  });
  app.delete("/api/recommendation-milestones/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const existing = await storage.getRecommendationMilestone(id);
    await storage.deleteRecommendationMilestone(id);
    if (existing) await normalizeRecommendationMilestones(existing.recommendationId);
    res.json({ ok: true });
  });

  app.post("/api/recommendations/:id/accept", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const p = acceptRecommendationSchema.safeParse(req.body || {});
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });

    const recommendation = await storage.getRecommendation(id);
    if (!recommendation) return res.status(404).json({ error: "Not found" });
    if (recommendation.status === "accepted") return res.status(409).json({ error: "Recommendation already accepted" });

    const [subdivisions, milestones] = await Promise.all([
      storage.getRecommendationSubdivisions(id),
      storage.getRecommendationMilestones(id),
    ]);
    const draft = safeJsonObject(recommendation.acceptanceDraft);
    const entityType = p.data.entityType || inferRecommendationEntityType(recommendation);
    const title = p.data.title || trimSentence(draft.title, 180) || recommendation.title;
    const trackId = p.data.trackId === undefined ? (draft.relatedTrackId ?? recommendation.linkedTrackId ?? null) : p.data.trackId;

    const arcSummary = [
      subdivisions.length ? `${subdivisions.length} subtopic${subdivisions.length === 1 ? "" : "s"}` : "",
      milestones.length ? `${milestones.length} checkpoint${milestones.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", ");
    const acceptedFromRecommendation = trimSentence(
      `${draft.note || recommendation.whySuggested || "Accepted from recommendation inventory."}${arcSummary ? ` Includes ${arcSummary}.` : ""}`,
      400,
    );

    let created: any;
    if (entityType === "learn") {
      created = await storage.createLearn({
        title,
        category: trimSentence(draft.category || draft.capabilityBuilt || recommendation.linkedGapKey, 120),
        cost: trimSentence(draft.cost, 80),
        url: trimSentence(draft.url || recommendation.sourceUrl, 500),
        note: acceptedFromRecommendation,
        done: false,
        active: false,
        type: recommendation.kind === "learning-theme" ? "practice" : "resource",
        learnStatus: "open",
        capabilityBuilt: trimSentence(draft.capabilityBuilt || recommendation.linkedGapKey, 180),
        requiredOutput: trimSentence(draft.requiredOutput, 240),
        proofIntent: Boolean(draft.proofIntent),
        relatedTrackId: trackId,
        sourceType: "recommendation",
        sourceId: recommendation.id,
      } as any);
    } else if (entityType === "contact") {
      created = await storage.createContact({
        name: trimSentence(draft.name, 120),
        who: title,
        sector: trimSentence(draft.sector || draft.linkedArchetype, 120),
        why: trimSentence(draft.why || recommendation.whySuggested, 240),
        status: "to_contact",
        note: acceptedFromRecommendation,
        askType: trimSentence(draft.askType || "advice", 40),
        relatedTrackId: trackId,
        targetOrg: trimSentence(draft.targetOrg, 140),
        targetRole: trimSentence(draft.targetRole, 140),
      } as any);
    } else if (entityType === "hustle") {
      created = await storage.createHustle({
        title,
        note: acceptedFromRecommendation,
        nextStep: trimSentence(draft.nextStep || milestones[0]?.suggestedTaskTitle || "Define the smallest useful first version", 180),
        stage: trimSentence(draft.stage || "idea", 40),
        proofAssetForTrack: trackId,
        coreClaim: trimSentence(draft.coreClaim, 180),
        contentPillar: trimSentence(draft.contentPillar, 140),
      } as any);
    } else if (entityType === "job") {
      created = await storage.createJob({
        title,
        company: trimSentence(draft.company, 140),
        location: trimSentence(draft.location, 140),
        url: trimSentence(draft.url || recommendation.sourceUrl, 500),
        note: acceptedFromRecommendation,
        nextStep: trimSentence(draft.nextStep || milestones[0]?.suggestedTaskTitle || "Review fit and decide whether to pursue", 180),
        status: "wishlist",
        roleArchetype: trimSentence(draft.roleArchetype, 120),
        relatedTrackId: trackId,
      } as any);
    } else {
      created = await storage.createTask({
        title,
        list: p.data.list || draft.list || "inbox",
        block: null,
        done: false,
        pinned: false,
        steps: "[]",
        sort: 0,
        category: trimSentence(draft.category || "learning", 40) || "learning",
        size: trimSentence(draft.size || "medium", 20) || "medium",
        status: "not_started",
        skipped: 0,
        doneWhen: trimSentence(draft.doneWhen || milestones[0]?.doneWhen || "A concrete next move is completed", 240),
        sourceType: "recommendation",
        sourceId: recommendation.id,
        sourceUrl: trimSentence(recommendation.sourceUrl, 500),
        sourceNote: acceptedFromRecommendation,
        relatedTrackId: trackId,
        minimumOutcome: trimSentence(draft.doneWhen || milestones[0]?.doneWhen || "A concrete next move is completed", 240),
      } as any);
    }

    const now = Date.now();
    const updated = await storage.updateRecommendation(id, {
      status: "accepted",
      acceptanceEntityType: entityType,
      reviewedAt: now,
      acceptedAt: now,
    } as any);
    await storage.logActivity({
      eventType: "recommendation_accepted",
      sourceType: "recommendation",
      sourceId: id,
      metadata: JSON.stringify({ entityType, createdId: created?.id ?? null }),
    } as any);
    res.json({ ok: true, entityType, created, recommendation: updated, subdivisions, milestones });
  });

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
