import type { Express } from "express";
import { storage } from "./storage";
import { syncGapRecommendations } from "./gapRecommendations";
import { refreshNetworkIntelligence } from "./networkIntelligenceSync";

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

    if (refreshTriggered) {
      try {
        await syncGapRecommendations();
      } catch (error) {
        console.error("recommendation refresh after CV update failed", error);
      }
      void refreshNetworkIntelligence().catch((error) => {
        console.error("network refresh after CV update failed", error);
      });
    }

    res.json({ ...profile, refreshTriggered });
  });
}
