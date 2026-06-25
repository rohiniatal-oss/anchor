import type { Express, Request, Response } from "express";
import { buildAnchorToday } from "./anchorToday";
import { explainPersistedPlanItem } from "./brain";
import { generateCompanyBrief } from "./companyIntelligence";
import { createNextTask, type NextTaskSourceType } from "./nextTask";
import { buildProactiveSuggestionPreviews } from "./proactiveSuggestions";
import { parseRoleModel } from "./roleModel";
import { storage } from "./storage";
import { ensureExecutionPriority } from "./trackResearchExecutionPriorityService";

const ACTIVATABLE_SOURCE_TYPES = new Set<NextTaskSourceType>(["job", "learn", "contact", "hustle"]);

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function numberParam(value: unknown): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function backgroundMutation(req: Request): boolean {
  return String(req.header("X-Anchor-User-Intent") || "").toLowerCase() === "background";
}

function requireExplicitIntent(req: Request, res: Response): boolean {
  if (!backgroundMutation(req)) return true;
  res.status(409).json({
    error: "This state change needs an explicit user action.",
    code: "explicit_user_intent_required",
  });
  return false;
}

async function storedTrack(req: Request, res: Response) {
  const id = numberParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Bad id" });
    return null;
  }
  const track = await storage.getCareerTrack(id);
  if (!track) {
    res.status(404).json({ error: "Track not found" });
    return null;
  }
  return { track, intelligence: parseJsonObject(track.trackIntelligence) };
}

/**
 * Pure read routes are registered before legacy routes. They read persisted
 * snapshots only; expensive synthesis and all persistence remain explicit POST
 * commands. This keeps old URLs stable while changing their trust contract.
 */
export function registerTrustBoundaryRoutes(app: Express) {
  app.get("/api/tasks", async (_req, res) => {
    return res.json(await storage.getTasks());
  });

  app.get("/api/plan/current", async (req, res) => {
    const day = String(req.query.day || new Date().toISOString().slice(0, 10));
    const plan = await storage.getPlanByDate(day);
    const items = plan
      ? (await storage.getPlanItems(plan.id)).map((item) => ({
          ...item,
          explanation: explainPersistedPlanItem(item),
        }))
      : [];
    const events = await storage.getEvents(day);
    return res.json({
      plan: plan || null,
      items,
      events,
      needsPreparation: !plan,
      readOnlySnapshot: true,
    });
  });

  app.post("/api/plan/prepare", (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    return res.redirect(307, "/api/plan/recompute");
  });

  app.get("/api/anchor/today", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
    ]);
    const today = buildAnchorToday({ tasks, jobs, learn, hustles, contacts, tracks });
    const proactiveSuggestions = buildProactiveSuggestionPreviews({ tasks, jobs, contacts, learn });
    return res.json({ ...today, proactiveSuggestions, readOnlySnapshot: true });
  });

  app.post("/api/anchor/suggestions/:sourceType/:sourceId/activate", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    const sourceType = String(req.params.sourceType || "") as NextTaskSourceType;
    const sourceId = numberParam(req.params.sourceId);
    if (!ACTIVATABLE_SOURCE_TYPES.has(sourceType) || !sourceId) {
      return res.status(400).json({ error: "Unsupported suggestion source" });
    }
    const result = await createNextTask({ sourceType, sourceId });
    if (!result) return res.status(404).json({ error: "Suggestion source not found" });
    await storage.logActivity({
      eventType: "suggestion_activated",
      sourceType,
      sourceId,
      taskId: result.task.id,
      metadata: JSON.stringify({ reused: result.reused, explicit: true }),
    } as any);
    return res.json({ ok: true, task: result.task, reused: result.reused });
  });

  app.get("/api/jobs/:id/company-brief", async (req, res) => {
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const job = await storage.getJob(id);
    if (!job) return res.status(404).json({ error: "Not found" });
    if (!(job.companyBrief || "").trim()) return res.json(null);
    try {
      return res.json(JSON.parse(job.companyBrief));
    } catch {
      return res.json(null);
    }
  });

  app.post("/api/jobs/:id/company-brief/refresh", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const job = await storage.getJob(id);
    if (!job) return res.status(404).json({ error: "Not found" });
    const brief = await generateCompanyBrief(job).catch(() => null);
    return res.json(brief);
  });

  app.get("/api/jobs/:id/role-model", async (req, res) => {
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const job = await storage.getJob(id);
    if (!job) return res.status(404).json({ error: "Not found" });
    return res.json(parseRoleModel(job.roleModel || ""));
  });

  app.get("/api/career-tracks/:id/intelligence", async (req, res) => {
    const stored = await storedTrack(req, res);
    if (!stored) return;
    return res.json(Object.keys(stored.intelligence).length ? stored.intelligence : null);
  });

  app.get("/api/career-tracks/:id/coverage", async (req, res) => {
    const stored = await storedTrack(req, res);
    if (!stored) return;
    return res.json({
      track: stored.track,
      requirementModel: stored.intelligence.requirementModel || null,
      coverageModel: stored.intelligence.coverageModel || null,
      refreshed: false,
      needsRefresh: !stored.intelligence.coverageModel,
      readOnlySnapshot: true,
    });
  });

  app.get("/api/career-tracks/:id/development-plan", async (req, res) => {
    const stored = await storedTrack(req, res);
    if (!stored) return;
    return res.json({
      track: stored.track,
      requirementModel: stored.intelligence.requirementModel || null,
      coverageModel: stored.intelligence.coverageModel || null,
      developmentPlanModel: stored.intelligence.developmentPlanModel || null,
      refreshed: false,
      needsRefresh: !stored.intelligence.developmentPlanModel,
      readOnlySnapshot: true,
    });
  });

  app.get("/api/career-tracks/:id/execution-blueprint", async (req, res) => {
    const stored = await storedTrack(req, res);
    if (!stored) return;
    return res.json({
      track: stored.track,
      requirementModel: stored.intelligence.requirementModel || null,
      coverageModel: stored.intelligence.coverageModel || null,
      developmentPlanModel: stored.intelligence.developmentPlanModel || null,
      executionBlueprintModel: stored.intelligence.executionBlueprintModel || null,
      refreshed: false,
      needsRefresh: !stored.intelligence.executionBlueprintModel,
      readOnlySnapshot: true,
    });
  });

  app.get("/api/career-tracks/:id/execution-priority", async (req, res) => {
    const stored = await storedTrack(req, res);
    if (!stored) return;
    return res.json({
      track: stored.track,
      requirementModel: stored.intelligence.requirementModel || null,
      coverageModel: stored.intelligence.coverageModel || null,
      developmentPlanModel: stored.intelligence.developmentPlanModel || null,
      executionBlueprintModel: stored.intelligence.executionBlueprintModel || null,
      executionPriorityModel: stored.intelligence.executionPriorityModel || null,
      refreshedPriority: false,
      needsRefresh: !stored.intelligence.executionPriorityModel,
      readOnlySnapshot: true,
    });
  });

  app.post("/api/career-tracks/:id/prepare-execution", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const result = await ensureExecutionPriority(id, true);
    if (!result) return res.status(404).json({ error: "Track not found" });
    if (!("executionPriorityModel" in result)) {
      return res.status(409).json({
        error: "error" in result ? String(result.error || "Execution planning is not available yet") : "Execution planning is not available yet",
      });
    }
    return res.json({ ...result, preparedExplicitly: true });
  });
}
