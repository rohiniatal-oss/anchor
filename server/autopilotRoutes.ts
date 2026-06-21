/**
 * autopilotRoutes.ts
 *
 * Registers GET /api/autopilot/proposals
 *
 * Wire in server/index.ts:
 *   import { registerAutopilotRoutes } from "./autopilotRoutes";
 *   registerAutopilotRoutes(app);
 */

import type { Express } from "express";
import { computeAutopilotProposals } from "./autopilot";

export function registerAutopilotRoutes(app: Express): void {
  app.get("/api/autopilot/proposals", async (_req, res) => {
    try {
      const proposals = await computeAutopilotProposals(5);
      res.json({ proposals });
    } catch (err) {
      console.error("[autopilot] proposals failed:", err);
      res.status(500).json({ proposals: [], error: "Autopilot unavailable" });
    }
  });
}
