import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { needsWorkInterpretation } from "./workInterpretation";
import {
  activateNextProjectTask,
  activateWork,
  allProjectSummaries,
  completeProjectMilestone,
  previewNextProjectWork,
  previewWork,
  projectDetail,
  type WorkPreviewInput,
} from "./workService";

function numberParam(value: unknown): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function backgroundMutation(req: Request): boolean {
  return String(req.header("X-Anchor-User-Intent") || "").toLowerCase() === "background";
}

function requireExplicitIntent(req: Request, res: Response) {
  if (!backgroundMutation(req)) return true;
  res.status(409).json({
    error: "This change needs an explicit user action.",
    code: "explicit_user_intent_required",
  });
  return false;
}

function previewInput(body: any): WorkPreviewInput {
  return {
    title: String(body?.title || "").trim(),
    sourceType: String(body?.sourceType || "capture"),
    sourceId: body?.sourceId == null ? null : Number(body.sourceId),
    sourceNote: String(body?.sourceNote || ""),
    doneWhen: String(body?.doneWhen || ""),
    minimumOutcome: String(body?.minimumOutcome || ""),
    steps: body?.steps,
    relatedTrackId: body?.relatedTrackId == null ? null : Number(body.relatedTrackId),
    context: String(body?.context || "").trim().slice(0, 2000),
    refine: body?.refine !== false,
    externalResearchMockMode: body?.externalResearchMockMode,
    forceWorkType: body?.forceWorkType,
  };
}

async function taskPreviewInput(req: Request) {
  const id = numberParam(req.params.id);
  if (!id) return null;
  const task = (await storage.getTasks()).find((entry) => entry.id === id);
  if (!task) return null;
  return {
    task,
    input: previewInput({
      title: task.title,
      sourceType: "task",
      sourceId: task.id,
      sourceNote: task.sourceNote,
      doneWhen: task.doneWhen,
      minimumOutcome: task.minimumOutcome,
      steps: task.steps,
      relatedTrackId: task.relatedTrackId,
      context: req.body?.context,
      refine: req.body?.refine,
      externalResearchMockMode: req.body?.externalResearchMockMode,
    }),
  };
}

function sendError(res: Response, error: unknown) {
  const candidate = error as Error & { status?: number; code?: string };
  return res.status(candidate.status || 500).json({
    error: candidate.message || "Work planning failed.",
    code: candidate.code || undefined,
  });
}

/** Register the preview → confirm → activate work-object workflow. */
export function registerWorkRoutes(app: Express) {
  app.post("/api/work/interpret", async (req, res) => {
    try {
      const input = previewInput(req.body || {});
      if (!input.title) return res.status(400).json({ error: "A title or capture is required." });
      return res.json(await previewWork(input));
    } catch (error) {
      return sendError(res, error);
    }
  });

  const confirmWork = async (req: Request, res: Response) => {
    if (!requireExplicitIntent(req, res)) return;
    try {
      return res.json(await activateWork({
        definition: req.body?.definition,
        decomposition: req.body?.decomposition,
        sourceTaskId: req.body?.sourceTaskId == null ? null : Number(req.body.sourceTaskId),
        mode: req.body?.mode || "as_interpreted",
      }));
    } catch (error) {
      return sendError(res, error);
    }
  };

  // /activate remains as a compatibility alias. Project confirmation creates
  // only the project and milestone map; a separate command activates a task.
  app.post("/api/work/confirm", confirmWork);
  app.post("/api/work/activate", confirmWork);

  app.get("/api/projects", (_req, res) => {
    return res.json({ projects: allProjectSummaries(), readOnlySnapshot: true });
  });

  app.get("/api/projects/:id", async (req, res) => {
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const detail = await projectDetail(id);
    return detail
      ? res.json({ ...detail, readOnlySnapshot: true })
      : res.status(404).json({ error: "Project not found" });
  });

  app.post("/api/projects/:id/decompose", async (req, res) => {
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    try {
      const result = await previewNextProjectWork(id, req.body?.refine !== false);
      return result
        ? res.json({ ...result, readOnlyPreview: true })
        : res.status(404).json({ error: "Project not found" });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/projects/:id/activate-next", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    const id = numberParam(req.params.id);
    const milestoneId = Number(req.body?.milestoneId);
    if (!id || !Number.isFinite(milestoneId)) {
      return res.status(400).json({ error: "Project and milestone are required." });
    }
    try {
      const result = await activateNextProjectTask({
        projectId: id,
        milestoneId,
        decomposition: req.body?.decomposition,
      });
      return result
        ? res.json(result)
        : res.status(404).json({ error: "Project or milestone not found" });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/projects/:id/milestones/:milestoneId/complete", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    const projectId = numberParam(req.params.id);
    const milestoneId = numberParam(req.params.milestoneId);
    if (!projectId || !milestoneId) return res.status(400).json({ error: "Bad id" });
    try {
      const result = await completeProjectMilestone(
        projectId,
        milestoneId,
        req.body?.confirmIncomplete === true,
      );
      return result
        ? res.json(result)
        : res.status(404).json({ error: "Project or milestone not found" });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/interpret", async (req, res) => {
    try {
      const found = await taskPreviewInput(req);
      if (!found) return res.status(404).json({ error: "Task not found" });
      return res.json(await previewWork(found.input));
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Broad work stops at a preview. The legacy breakdown route remains the final
  // layer only for work already confirmed as an independently useful task.
  app.post("/api/tasks/:id/breakdown", async (req, res, next) => {
    try {
      const found = await taskPreviewInput(req);
      if (!found || !needsWorkInterpretation({
        title: found.task.title,
        doneWhen: found.task.doneWhen,
        steps: found.task.steps,
      })) return next();
      const preview = await previewWork(found.input);
      return res.json({
        workDefinition: preview.definition,
        decomposition: preview.decomposition,
        nextAction: preview.nextAction,
        question: preview.definition.needsClarification ? preview.definition.clarifyingQuestion : undefined,
        requiresConfirmation: !preview.definition.needsClarification,
        readOnlyPreview: true,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/unstick-to-step", async (req, res, next) => {
    try {
      const found = await taskPreviewInput(req);
      if (!found || !needsWorkInterpretation({
        title: found.task.title,
        doneWhen: found.task.doneWhen,
        steps: found.task.steps,
      })) return next();
      const preview = await previewWork(found.input);
      return res.json({
        workDefinition: preview.definition,
        decomposition: preview.decomposition,
        nextAction: preview.nextAction,
        question: preview.definition.needsClarification ? preview.definition.clarifyingQuestion : undefined,
        requiresConfirmation: !preview.definition.needsClarification,
        readOnlyPreview: true,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
