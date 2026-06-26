import type { Express, Request, Response } from "express";
import {
  backfillStrategicObjectOwnership,
  ensureObjectOwnershipSchema,
  ownershipSnapshot,
} from "./objectOwnership";

function backgroundMutation(req: Request): boolean {
  return String(req.header("X-Anchor-User-Intent") || "").toLowerCase() === "background";
}

function requireExplicitIntent(req: Request, res: Response) {
  if (!backgroundMutation(req)) return true;
  res.status(409).json({
    error: "This ownership repair needs an explicit user action.",
    code: "explicit_user_intent_required",
  });
  return false;
}

export function registerObjectOwnershipRoutes(app: Express) {
  ensureObjectOwnershipSchema();

  app.get("/api/ownership/strategic-objects", async (_req, res) => {
    return res.json(await ownershipSnapshot());
  });

  app.post("/api/ownership/strategic-objects/backfill", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    return res.json(await backfillStrategicObjectOwnership());
  });
}
