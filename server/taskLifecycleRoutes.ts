import type { Express, Request, Response } from "express";
import { insertTaskSchema, insertWinSchema, type Task } from "@shared/schema";
import { createNextTask, type NextTaskSourceType } from "./nextTask";
import { storage } from "./storage";
import {
  blockTask,
  completeTask,
  moveTaskLater,
  parkTask,
  reopenTask,
  skipTask,
  startTask,
  TaskLifecycleError,
  type TaskLifecycleInput,
} from "./taskLifecycleService";

const SOURCE_TYPES = new Set<NextTaskSourceType>(["job", "learn", "contact", "hustle"]);
const SLOT_TO_BLOCK: Record<string, string> = {
  now: "morning",
  next: "afternoon",
  later: "evening",
  bonus: "evening",
};

function taskId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new TaskLifecycleError("Bad id", 400);
  return id;
}

function day(req: Request): string {
  return String(req.body?.day || new Date().toISOString().slice(0, 10));
}

function idempotencyKey(req: Request): string {
  return String(req.header("Idempotency-Key") || req.body?.idempotencyKey || "").trim().slice(0, 160);
}

function completionFields(req: Request): Partial<TaskLifecycleInput> {
  return {
    completionOutcome: typeof req.body?.completionOutcome === "string" ? req.body.completionOutcome : typeof req.body?.outcome === "string" ? req.body.outcome : undefined,
    completionRating: typeof req.body?.completionRating === "string" ? req.body.completionRating : typeof req.body?.rating === "string" ? req.body.rating : undefined,
    completionNote: typeof req.body?.completionNote === "string" ? req.body.completionNote : typeof req.body?.note === "string" ? req.body.note : undefined,
  };
}

function lifecycleInput(req: Request, extra: Partial<TaskLifecycleInput> = {}): TaskLifecycleInput {
  return {
    taskId: taskId(req),
    day: day(req),
    idempotencyKey: idempotencyKey(req),
    ...extra,
  };
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

function sendError(res: Response, error: unknown) {
  const status = error instanceof TaskLifecycleError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Task transition failed";
  return res.status(status).json({ error: message });
}

function categoryForPlanItem(item: any): string {
  if (item.sourceType === "job") return "job";
  if (item.sourceType === "learn") return "learning";
  if (item.sourceType === "hustle") return "hustle";
  if (item.sourceType === "contact") return "admin";
  const text = `${item.title || ""} ${item.whySelected || ""} ${item.doneWhen || ""}`.toLowerCase();
  if (/apply|application|role|job|cv|cover|interview|submit/.test(text)) return "job";
  if (/learn|study|practice|course|resource/.test(text)) return "learning";
  if (/write|publish|memo|portfolio|project|proof/.test(text)) return "hustle";
  return "admin";
}

async function materializeTaskForPlanItem(item: any): Promise<Task> {
  const allTasks = await storage.getTasks();
  let task = item.taskId ? allTasks.find((candidate) => candidate.id === item.taskId) : undefined;
  if (!task && item.sourceType === "task" && item.sourceId != null) {
    task = allTasks.find((candidate) => candidate.id === item.sourceId);
  }
  if (!task && SOURCE_TYPES.has(item.sourceType as NextTaskSourceType) && item.sourceId != null) {
    const result = await createNextTask({ sourceType: item.sourceType as NextTaskSourceType, sourceId: Number(item.sourceId) });
    task = result?.task;
  }
  if (task) return task;

  return storage.createTask({
    title: String(item.title || "Next planned move"),
    list: "inbox",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: categoryForPlanItem(item),
    deadline: "",
    size: "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: String(item.doneWhen || "The next visible outcome is complete"),
    sourceType: String(item.sourceType || "plan_item"),
    sourceId: item.sourceId ?? undefined,
    sourceNote: String(item.sourceNote || ""),
    sourceStatus: String(item.sourceStatus || ""),
    planItemId: item.id,
  } as any);
}

/**
 * Registers the single state-transition boundary before legacy task routes.
 * Existing clients keep their URLs, but every task transition now follows the
 * same transaction, provenance and idempotency rules.
 */
export function registerTaskLifecycleRoutes(app: Express) {
  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      const parsed = insertTaskSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const id = taskId(req);
      const before = (await storage.getTasks()).find((task) => task.id === id);
      if (!before) return res.status(404).json({ error: "Not found" });
      const patch = parsed.data as Record<string, unknown>;
      const completing = (patch.done === true || patch.status === "done") && !before.done && before.status !== "done";
      const reopening = (patch.done === false || (typeof patch.status === "string" && patch.status !== "done")) && (before.done || before.status === "done");
      if (completing) {
        const result = completeTask(lifecycleInput(req, { patch, ...completionFields(req) }));
        return res.json(result.task);
      }
      if (reopening) {
        const result = reopenTask(lifecycleInput(req, { patch }));
        return res.json(result.task);
      }
      const updated = await storage.updateTask(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Not found" });
      return res.json(updated);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/start", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    try {
      return res.json(startTask(lifecycleInput(req, {
        block: typeof req.body?.block === "string" ? req.body.block : null,
        planItemId: req.body?.planItemId == null ? null : Number(req.body.planItemId),
      })));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/complete", async (req, res) => {
    try {
      return res.json(completeTask(lifecycleInput(req, completionFields(req))));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/reopen", async (req, res) => {
    try {
      return res.json(reopenTask(lifecycleInput(req)));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/skip", async (req, res) => {
    try {
      const result = skipTask(lifecycleInput(req, { reason: String(req.body?.reason || "") }));
      return res.json({ ...result, skipped: result.task.skipped, needsDiagnosis: (result.task.skipped || 0) >= 2 });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/park", async (req, res) => {
    try {
      return res.json(parkTask(lifecycleInput(req, { reason: String(req.body?.reason || "") })));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/block", async (req, res) => {
    try {
      return res.json(blockTask(lifecycleInput(req, { reason: String(req.body?.reason || "Blocked") })));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/tasks/:id/move-later", async (req, res) => {
    try {
      return res.json(moveTaskLater(lifecycleInput(req)));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/plan-items/:id/start", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });
      const item = await storage.getPlanItem(id);
      if (!item) return res.status(404).json({ error: "Plan item not found" });
      const task = await materializeTaskForPlanItem(item);
      const result = startTask({
        taskId: task.id,
        day: String(req.body?.day || item.plannedFor || new Date().toISOString().slice(0, 10)),
        block: SLOT_TO_BLOCK[item.slot] || null,
        planItemId: item.id,
        idempotencyKey: idempotencyKey(req),
      });
      await storage.updatePlanItem(item.id, { taskId: result.task.id, status: "started", startedAt: Date.now() } as any);
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/plan-items/:id/complete", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });
      const item = await storage.getPlanItem(id);
      if (!item) return res.status(404).json({ error: "Plan item not found" });
      const task = await materializeTaskForPlanItem(item);
      const result = completeTask({
        taskId: task.id,
        day: String(req.body?.day || item.plannedFor || new Date().toISOString().slice(0, 10)),
        planItemId: item.id,
        idempotencyKey: idempotencyKey(req),
        ...completionFields(req),
      });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/plan-items/:id/skip", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });
      const item = await storage.getPlanItem(id);
      if (!item) return res.status(404).json({ error: "Plan item not found" });
      const task = await materializeTaskForPlanItem(item);
      const result = skipTask({
        taskId: task.id,
        day: String(req.body?.day || item.plannedFor || new Date().toISOString().slice(0, 10)),
        planItemId: item.id,
        reason: String(req.body?.reason || ""),
        idempotencyKey: idempotencyKey(req),
      });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
