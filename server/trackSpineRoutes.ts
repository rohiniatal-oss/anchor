import type { Express } from "express";
import { storage } from "./storage";
import { buildTrackSpine } from "./trackSpine";

export function registerTrackSpineRoutes(app: Express) {
  app.get("/api/track-spine", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
    ]);
    res.json(buildTrackSpine({ tasks, jobs, learn, hustles, contacts, tracks }));
  });
}
