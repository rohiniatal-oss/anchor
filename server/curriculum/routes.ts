import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { MODEL_PRIMARY } from "../llm";
import { composeCurriculum, CurriculumComposeError } from "./composer";
import { persistComposedCurriculum, getCurriculum, listCurricula, getDay, getCurriculumEvents } from "./repository";
import { completeDay, skipDay, CurriculumDayError } from "./materializer";
import { exportCurriculumMarkdown } from "./exporter";
import { CAPSTONE_SHAPES, type ComposeInput } from "./types";

const composeBodySchema = z.object({
  trackId: z.coerce.number().int().positive(),
  weeks: z.coerce.number().int().min(1).max(104),
  hoursPerDay: z.coerce.number().min(0).max(24),
  capstoneShape: z.enum(CAPSTONE_SHAPES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function registerCurriculumRoutes(app: Express): void {
  // Compose → persist → materialise. Without an OPENAI_API_KEY this returns a
  // clear, actionable error rather than a vague failure.
  app.post("/api/curricula/compose", async (req, res) => {
    const parsed = composeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const input = parsed.data as ComposeInput;

    const track = await storage.getCareerTrack(input.trackId);
    if (!track) return res.status(404).json({ error: "Career direction not found" });

    try {
      const composed = await composeCurriculum(track, input);
      const id = persistComposedCurriculum(input.trackId, input, composed, MODEL_PRIMARY);
      return res.status(201).json(getCurriculum(id));
    } catch (err) {
      if (err instanceof CurriculumComposeError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.get("/api/curricula", async (req, res) => {
    const trackId = req.query.trackId ? Number(req.query.trackId) : undefined;
    res.json(listCurricula(Number.isFinite(trackId as number) ? trackId : undefined));
  });

  app.get("/api/curricula/:id", async (req, res) => {
    const curriculum = getCurriculum(Number(req.params.id));
    if (!curriculum) return res.status(404).json({ error: "Curriculum not found" });
    res.json(curriculum);
  });

  app.get("/api/curricula/:id/export", async (req, res) => {
    const curriculum = getCurriculum(Number(req.params.id));
    if (!curriculum) return res.status(404).json({ error: "Curriculum not found" });
    const markdown = exportCurriculumMarkdown(curriculum);
    if (String(req.query.format || "").toLowerCase() === "json") {
      return res.json({ markdown });
    }
    res.type("text/markdown").send(markdown);
  });

  app.get("/api/curricula/:id/events", async (req, res) => {
    const curriculum = getCurriculum(Number(req.params.id));
    if (!curriculum) return res.status(404).json({ error: "Curriculum not found" });
    res.json(getCurriculumEvents(Number(req.params.id)));
  });

  app.post("/api/curricula/:id/days/:dayId/complete", async (req, res) => {
    const curriculumId = Number(req.params.id);
    const dayId = Number(req.params.dayId);
    if (!getDay(curriculumId, dayId)) return res.status(404).json({ error: "Day not found" });
    try {
      res.json(completeDay(curriculumId, dayId, String(req.body?.note || "")));
    } catch (err) {
      if (err instanceof CurriculumDayError) return res.status(404).json({ error: err.message });
      throw err;
    }
  });

  app.post("/api/curricula/:id/days/:dayId/skip", async (req, res) => {
    const curriculumId = Number(req.params.id);
    const dayId = Number(req.params.dayId);
    if (!getDay(curriculumId, dayId)) return res.status(404).json({ error: "Day not found" });
    try {
      res.json(skipDay(curriculumId, dayId, String(req.body?.reason || "")));
    } catch (err) {
      if (err instanceof CurriculumDayError) return res.status(404).json({ error: err.message });
      throw err;
    }
  });
}
