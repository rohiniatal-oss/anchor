import type { Express } from "express";
import { storage } from "./storage";

export function registerProfileRoutes(app: Express) {
  app.get("/api/profile", async (_req, res) => {
    const profile = await storage.getProfile();
    res.json(profile ?? { cvText: "" });
  });

  app.patch("/api/profile", async (req, res) => {
    const cvText = String(req.body?.cvText ?? "");
    const profile = await storage.upsertProfile({ cvText });
    res.json(profile);
  });
}
