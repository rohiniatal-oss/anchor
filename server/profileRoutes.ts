import type { Express } from "express";
import { storage } from "./storage";
import { syncFreshIntelligence } from "./recommendationFreshness";

export function registerProfileRoutes(app: Express) {
  app.get("/api/profile", async (_req, res) => {
    const profile = await storage.getProfile();
    res.json(profile ?? { cvText: "" });
  });

  app.patch("/api/profile", async (req, res) => {
    const cvText = String(req.body?.cvText ?? "");
    const existing = await storage.getProfile();
    const profile = await storage.upsertProfile({ cvText });
    const refreshTriggered = (existing?.cvText || "") !== cvText;
    let intelligenceRefreshed = false;
    let intelligence = null;

    if (refreshTriggered) {
      try {
        intelligence = await syncFreshIntelligence();
        intelligenceRefreshed = true;
      } catch (error) {
        console.error("intelligence refresh after CV update failed", error);
      }
    }

    res.json({ ...profile, refreshTriggered, intelligenceRefreshed, intelligence });
  });
}
