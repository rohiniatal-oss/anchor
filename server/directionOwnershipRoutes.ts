import type { Express, Request, Response } from "express";
import {
  backfillDirectionOwnerships,
  buildDirectionOwnershipAudit,
  ensureDirectionOwnershipSchema,
  setDirectionOwnership,
  type DirectionEntityType,
  type DirectionOwnershipState,
} from "./directionOwnership";

function numberParam(value: unknown): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function explicitUserIntent(req: Request) {
  return String(req.header("X-Anchor-User-Intent") || "explicit").toLowerCase() !== "background";
}

function requireExplicitIntent(req: Request, res: Response) {
  if (explicitUserIntent(req)) return true;
  res.status(409).json({
    error: "This ownership change needs an explicit user action.",
    code: "explicit_user_intent_required",
  });
  return false;
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "Ownership update failed";
  if (/unsupported|requires|bad id/i.test(message)) return 400;
  if (/already linked|unlink|current/i.test(message)) return 409;
  return 500;
}

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Ownership update failed";
  return res.status(errorStatus(error)).json({ error: message });
}

/**
 * Direction ownership is a normalization layer over existing objects. Reads are
 * pure snapshots; writes are explicit commands that either backfill the registry
 * or change one object's ownership state.
 */
export function registerDirectionOwnershipRoutes(app: Express) {
  // Install the registry before request handling so GET /audit never needs to run DDL.
  ensureDirectionOwnershipSchema();

  app.get("/api/direction-ownership/audit", async (_req, res) => {
    return res.json(await buildDirectionOwnershipAudit());
  });

  app.post("/api/direction-ownership/backfill", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    try {
      return res.json(await backfillDirectionOwnerships());
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/direction-ownership/:entityType/:id", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    try {
      const view = await setDirectionOwnership({
        entityType: String(req.params.entityType || "") as DirectionEntityType,
        entityId: id,
        ownershipState: String(req.body?.ownershipState || "") as DirectionOwnershipState,
        trackId: req.body?.trackId == null ? null : Number(req.body.trackId),
        candidateTrackId: req.body?.candidateTrackId == null ? null : Number(req.body.candidateTrackId),
        reason: String(req.body?.reason || ""),
        source: String(req.body?.source || "explicit_user_action"),
        confirmUnlink: req.body?.confirmUnlink === true,
      });
      return view ? res.json({ ownership: view }) : res.status(404).json({ error: "Object not found" });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
