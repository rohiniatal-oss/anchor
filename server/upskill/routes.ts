// HTTP surface for the ongoing upskill plan. v1 is API-only — users see the
// items inside the existing Today view. All CRUD is here so it can be driven by
// curl until a dedicated client page lands.
import type { Express } from "express";
import { checkinInputSchema } from "./types";
import * as repo from "./repository";
import { recompose } from "./planner";
import { completeUpskillItem, skipUpskillItem } from "./materializer";

export function registerUpskillRoutes(app: Express): void {
  // Manual recompose. Reports the failure reason (e.g. missing_openai_key,
  // no_active_tracks, invalid_model_output) rather than a vague null.
  app.post("/api/upskill/recompose", async (_req, res) => {
    const result = await recompose();
    if (!result.ok) {
      const status = result.reason === "no_active_tracks" ? 400
        : result.reason === "missing_openai_key" ? 503
        : 502;
      return res.status(status).json({ error: result.reason, detail: result.detail });
    }
    res.status(201).json({ ok: true, items: repo.listHorizon() });
  });

  app.get("/api/upskill/horizon", async (_req, res) => {
    res.json({ items: repo.listHorizon() });
  });

  app.post("/api/upskill/checkin", async (req, res) => {
    const parsed = checkinInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const checkin = repo.insertCheckin(parsed.data);
    // A check-in is an explicit "adapt now" signal — recompose immediately.
    const result = await recompose();
    res.status(201).json({ checkin, recompose: result.ok ? "ok" : result.reason });
  });

  app.post("/api/upskill/items/:id/complete", async (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getItem(id)) return res.status(404).json({ error: "Upskill item not found" });
    completeUpskillItem(id, String(req.body?.title || ""));
    res.json({ ok: true, item: repo.getItem(id) });
  });

  app.post("/api/upskill/items/:id/skip", async (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getItem(id)) return res.status(404).json({ error: "Upskill item not found" });
    skipUpskillItem(id, String(req.body?.reason || ""));
    res.json({ ok: true, item: repo.getItem(id) });
  });
}
