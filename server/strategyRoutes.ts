import type { Express } from "express";
import { getStrategyFrontDoor } from "./strategy";

export function registerStrategyRoutes(app: Express) {
  app.get("/api/strategy/front-door", async (_req, res) => res.json(await getStrategyFrontDoor()));

  app.get("/api/strategy", async (_req, res) => {
    const fd = await getStrategyFrontDoor();
    const tracks = fd.tracks.map((t) => ({
      id: t.id, slug: t.slug, name: t.name, status: t.status, priority: t.priority, whyItFits: t.whyItFits,
      roles: t.counts.jobs, learning: t.counts.learn, contacts: t.counts.contacts, proofAssets: t.counts.hustles,
      bottleneck: t.bottleneckLabel, nextMove: t.recommendedMove,
    }));
    res.json({ tracks, insights: fd.insights.map((i) => i.text) });
  });
}
