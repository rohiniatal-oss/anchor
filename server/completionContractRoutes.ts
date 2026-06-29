import type { Express } from "express";
import { completionContractForLearn, completionContractForTask } from "@shared/completionContracts";
import { storage } from "./storage";

function idParam(value: unknown) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * App-wide completion contracts. These are read-only: they tell the client what
 * kind of completion a task or learning item needs without mutating the item.
 */
export function registerCompletionContractRoutes(app: Express) {
  app.get("/api/tasks/:id/completion-contract", async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const task = (await storage.getTasks()).find((item) => item.id === id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({
      entityType: "task",
      entityId: task.id,
      contract: completionContractForTask(task),
    });
  });

  app.get("/api/learn/:id/completion-contract", async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const item = (await storage.getLearn()).find((learn) => learn.id === id);
    if (!item) return res.status(404).json({ error: "Learn item not found" });
    res.json({
      entityType: "learn",
      entityId: item.id,
      contract: completionContractForLearn(item),
    });
  });
}
