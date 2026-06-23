import type { Express } from "express";
import { storage } from "./storage";
import { runTrackResearch } from "./trackResearchAgent";

function parseJsonObject(value: string): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readDomain(body: any): string {
  return String(body?.domain || body?.focus || body?.area || body?.query || "").trim();
}

async function handleTrackResearch(req: any, res: any) {
  const domain = readDomain(req.body);
  if (!domain) return res.status(400).json({ error: "No domain provided" });

  const result = await runTrackResearch(domain, { materialize: req.body?.materialize !== false });
  if (!result) return res.status(500).json({ error: "Could not generate track research" });

  res.json({
    track: result.track,
    brief: result.brief,
    plan: result.brief.plan,
    materialized: result.materialized,
  });
}

export function registerTrackResearchRoutes(app: Express) {
  app.post("/api/track-research", handleTrackResearch);

  // Backward-compatible focus-area entry point. This route is registered before
  // capture.ts, so broad exploration now uses the structured track plan agent.
  app.post("/api/explore", handleTrackResearch);

  app.get("/api/career-tracks/:id/research-plan", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const track = await storage.getCareerTrack(id);
    if (!track) return res.status(404).json({ error: "Track not found" });
    const intelligence = parseJsonObject(track.trackIntelligence || "");
    res.json({
      track,
      intelligence,
      plan: intelligence?.trackPlan || null,
      sectorMap: intelligence?.sectorMap || [],
      roleShapes: intelligence?.roleShapes || [],
      gapAnalysis: intelligence?.gapAnalysis || null,
    });
  });
}
