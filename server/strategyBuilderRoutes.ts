import type { Express } from "express";
import { storage } from "./storage";
import { buildStrategyBuilder } from "./strategyBuilder";

export function registerStrategyBuilderRoutes(app: Express) {
  app.get("/api/strategy-builder", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
    ]);
    res.json(buildStrategyBuilder(tasks, jobs, learn, hustles, contacts));
  });
}
