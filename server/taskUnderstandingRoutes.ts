import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { shouldUnderstandTask } from "./taskUnderstanding";
import {
  understandOpenTasksForPlanning,
  understandTask,
  understandTaskInput,
  type TaskUnderstandingResult,
} from "./taskUnderstandingService";

function numberParam(value: unknown): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function backgroundMutation(req: Request): boolean {
  return String(req.header("X-Anchor-User-Intent") || "").toLowerCase() === "background";
}

function mockMode(value: unknown) {
  const mode = String(value || "");
  return ["success", "empty", "rate_limited", "unavailable", "error"].includes(mode)
    ? mode as "success" | "empty" | "rate_limited" | "unavailable" | "error"
    : undefined;
}

function clarification(res: Response, result: TaskUnderstandingResult, status = 409) {
  const question = result.brief?.clarifyingQuestion || "What outcome should this task produce?";
  return res.status(status).json({
    error: question,
    code: "task_clarification_required",
    question,
    task: result.task,
    taskBrief: result.brief,
  });
}

async function beforeTaskStart(req: Request, res: Response, next: () => void) {
  if (backgroundMutation(req)) return next();
  const id = numberParam(req.params.id);
  if (!id) return next();
  const result = await understandTask(id);
  if (result.brief?.needsClarification) return clarification(res, result);
  return next();
}

export function registerTaskUnderstandingRoutes(app: Express) {
  app.use("/api/tasks", async (req, _res, next) => {
    if (req.method !== "POST" || req.path !== "/" || backgroundMutation(req)) return next();
    req.body = await understandTaskInput(req.body || {});
    return next();
  });

  app.post("/api/tasks/:id/understand", async (req, res) => {
    if (backgroundMutation(req)) {
      return res.status(409).json({ error: "This needs an explicit user action.", code: "explicit_user_intent_required" });
    }
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const result = await understandTask(id, {
      force: true,
      refine: true,
      suppliedContext: String(req.body?.context || "").trim().slice(0, 1500),
      mockMode: mockMode(req.body?.externalResearchMockMode),
    });
    if (!result.task) return res.status(404).json({ error: "Task not found" });
    if (result.brief?.needsClarification) return clarification(res, result);
    return res.json({ task: result.task, taskBrief: result.brief, changed: result.changed });
  });

  app.post("/api/tasks/:id/breakdown", async (req, res, next) => {
    if (backgroundMutation(req)) return next();
    const id = numberParam(req.params.id);
    if (!id) return next();
    const task = (await storage.getTasks()).find((entry) => entry.id === id);
    if (!task || !shouldUnderstandTask(task)) return next();
    const result = await understandTask(id, {
      refine: true,
      suppliedContext: String(req.body?.context || "").trim().slice(0, 1500),
      mockMode: mockMode(req.body?.externalResearchMockMode),
    });
    if (result.brief?.needsClarification) return clarification(res, result, 200);
    return res.json({ ...result.task, taskBrief: result.brief });
  });

  app.post("/api/tasks/:id/unstick-to-step", async (req, res, next) => {
    if (backgroundMutation(req)) return next();
    const id = numberParam(req.params.id);
    if (!id) return next();
    const task = (await storage.getTasks()).find((entry) => entry.id === id);
    if (!task || !shouldUnderstandTask(task)) return next();
    const result = await understandTask(id, {
      refine: true,
      suppliedContext: String(req.body?.hint || req.body?.context || "").trim().slice(0, 1500),
      mockMode: mockMode(req.body?.externalResearchMockMode),
    });
    if (result.brief?.needsClarification) return clarification(res, result);
    return res.json({ task: result.task, step: result.brief?.steps[0] || "", taskBrief: result.brief });
  });

  app.post("/api/tasks/:id/start", beforeTaskStart);

  app.post("/api/plan-items/:id/start", async (req, res, next) => {
    if (backgroundMutation(req)) return next();
    const itemId = numberParam(req.params.id);
    const item = itemId ? await storage.getPlanItem(itemId) : null;
    const taskId = item?.taskId ?? (item?.sourceType === "task" ? item.sourceId : null);
    if (taskId == null) return next();
    const result = await understandTask(Number(taskId));
    if (result.brief?.needsClarification) return clarification(res, result);
    return next();
  });

  const preparePlan = async (req: Request, _res: Response, next: () => void) => {
    if (!backgroundMutation(req)) await understandOpenTasksForPlanning();
    return next();
  };
  app.post("/api/plan/recompute", preparePlan);
  app.post("/api/plan/restart", preparePlan);
  app.post("/api/plan/prepare", preparePlan);
}
