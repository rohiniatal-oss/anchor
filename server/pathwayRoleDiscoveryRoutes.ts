import type { Express, NextFunction, Request, Response } from "express";
import { PATHWAY_ROLE_DISCOVERY_PLAN_SOURCE } from "./pathwayRoleDiscovery";
import { storage } from "./storage";

function numberParam(value: unknown) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Pathway discovery is Anchor-owned internal evidence gathering. If the legacy
 * Today auto-start effect tries to start a discovery status card, acknowledge it
 * without creating or pinning a user task. User work starts only after discovery
 * produces a real next action or a focused stuck question.
 */
export function registerPathwayRoleDiscoveryRoutes(app: Express) {
  app.post("/api/plan-items/:id/start", async (req: Request, res: Response, next: NextFunction) => {
    const id = numberParam(req.params.id);
    if (!id) return next();
    const item = await storage.getPlanItem(id);
    if (item?.sourceType !== PATHWAY_ROLE_DISCOVERY_PLAN_SOURCE) return next();
    await storage.updatePlanItem(id, {
      status: "started",
      startedAt: Date.now(),
    } as any);
    await storage.logActivity({
      eventType: "internal_discovery_started",
      sourceType: PATHWAY_ROLE_DISCOVERY_PLAN_SOURCE,
      sourceId: item.sourceId ?? undefined,
      planItemId: item.id,
      metadata: JSON.stringify({ status: item.sourceStatus || "" }),
    } as any);
    return res.json({
      ok: true,
      internal: true,
      message: "Anchor is handling this discovery internally.",
    });
  });
}
