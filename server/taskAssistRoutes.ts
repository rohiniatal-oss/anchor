import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";
import { routeCapture, sortOpenCaptures } from "./capture";
import { buildTaskIntakeDefaults } from "./taskIntakeInference";
import { legacyCategoryToRoute } from "./captureCompatibility";
import { USER_PROFILE } from "./userPromptProfile";

export function registerTaskAssistRoutes(app: Express) {
  app.post("/api/unstick", async (req, res) => {
    const step = String(req.body?.step || "").trim();
    const currentStage = String(req.body?.currentStage || "").trim();
    const stageOutput = String(req.body?.stageOutput || "").trim();
    if (!step) return res.status(400).json({ error: "Need a step" });
    try {
      const client = new OpenAI();
      const stageCtx = currentStage
        ? ` The broader task is in the "${currentStage}" stage — the goal for this stage is: ${stageOutput || "not specified"}.`
        : "";
      const r = await client.responses.create({
        model: "gpt_5_1",
        input: 'Someone with ADHD is stuck and can\'t start this step: "' + step + '".' + stageCtx +
          " Give ONE tiny physical 60-second action to break the freeze (e.g. 'Open a blank doc and type one sentence')." +
          " Warm, one short sentence, no preamble. Return just the sentence.",
      });
      const hint = (r.output_text || "").trim().replace(/^["']|["']$/g, "");
      res.json({ hint: hint || "Set a 2-minute timer and just open the first thing." });
    } catch {
      res.status(500).json({ error: "Couldn't think of one right now." });
    }
  });

  app.post("/api/tasks/:id/enrich", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    try {
      const inferred = buildTaskIntakeDefaults({
        title: task.title,
        category: task.category,
        size: task.size,
        estimateMinutes: task.estimateMinutes,
        estimateConfidence: task.estimateConfidence,
        estimateReason: task.estimateReason,
        doneWhen: task.doneWhen,
        steps: task.steps,
        minimumOutcome: task.minimumOutcome,
        readiness: task.readiness,
        blockerReason: task.blockerReason,
        status: task.status,
      });
      const patch: any = {};
      if (!task.size) patch.size = inferred.size;
      if (!task.category || task.category === "admin") patch.category = inferred.category;
      if (task.estimateMinutes == null) patch.estimateMinutes = inferred.estimateMinutes;
      if (!task.estimateConfidence) patch.estimateConfidence = inferred.estimateConfidence;
      if (!task.estimateReason) patch.estimateReason = inferred.estimateReason;
      if (!task.doneWhen) patch.doneWhen = inferred.doneWhen;
      if (!task.steps || task.steps === "[]") patch.steps = inferred.steps;
      if (!task.minimumOutcome) patch.minimumOutcome = inferred.minimumOutcome;
      if (!task.readiness) patch.readiness = inferred.readiness;
      if (!task.status) patch.status = inferred.status;
      const updated = await storage.updateTask(id, patch);
      res.json(updated);
    } catch {
      res.status(500).json({ error: "Couldn't enrich right now." });
    }
  });

  app.get("/api/stats", async (_req, res) => {
    const weekAgo = Date.now() - 7 * 86400000;
    const wins = await storage.getWins();
    res.json({ doneThisWeek: wins.filter((w) => w.createdAt >= weekAgo).length });
  });

  app.post("/api/braindump/sort", async (_req, res) => {
    try {
      const suggestions = await sortOpenCaptures();
      res.json({
        suggestions: suggestions.map((suggestion) => ({
          id: suggestion.id,
          category: suggestion.category,
          route: suggestion.route,
          reason: suggestion.reason,
          confidence: suggestion.confidence,
          question: suggestion.question,
        })),
      });
    } catch {
      res.status(500).json({ error: "Couldn't sort right now." });
    }
  });

  app.post("/api/braindump/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const route = legacyCategoryToRoute(String(req.body?.category || req.body?.route || ""));
    if (!route) return res.status(400).json({ error: "Unknown category" });
    const result = await routeCapture(id, route);
    res.status(result.status).json(result.body);
  });

  app.post("/api/networking/suggest", async (req, res) => {
    const exclude: string[] = Array.isArray(req.body?.exclude) ? req.body.exclude.map((s: any) => String(s)) : [];
    const [jobs, contacts] = await Promise.all([storage.getJobs(), storage.getContacts()]);
    const targets = jobs.filter((j) => j.status === "wishlist" || j.status === "applied" || j.status === "interviewing")
      .map((j) => `${j.title} @ ${j.company} (${j.location})`);
    const alreadyTracked = contacts.map((c) => `${c.who} [${c.sector}]`);
    try {
      const client = new OpenAI();
      const out = await client.responses.create({
        model: "gpt_5_1",
        input:
          `You plan warm networking for ${USER_PROFILE}\n\n` +
          `Given her TARGET ROLES below, suggest ONE specific *kind of person* to reach - tied to those exact orgs/sectors - that would most move her hunt. Reason strategically: which warm route (ex-TBI, ex-Bain, ex-Abraaj, LSR/Delhi alum, someone already at the target org or its sector) best unlocks these roles. Describe them by TYPE + WHERE (no invented names).\n\n` +
          `TARGET ROLES: ${JSON.stringify(targets)}\nALREADY TRACKED (don't repeat): ${JSON.stringify(alreadyTracked)}\nEXCLUDE: ${JSON.stringify(exclude)}\n\n` +
          `Return ONLY one JSON object: {"who":"<person type + where, e.g. 'ex-Bain colleague now in AI policy'>","sector":"<short sector tag>","why":"<one tight sentence on why this unlocks a target role>"}.`,
      });
      let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let j: any = {};
      try { j = JSON.parse(text); } catch { j = {}; }
      if (!j || typeof j.who !== "string") return res.json({ suggestion: null });
      res.json({
        suggestion: {
          who: String(j.who).slice(0, 100),
          sector: String(j.sector || "").slice(0, 40),
          why: String(j.why || "").slice(0, 160),
        },
      });
    } catch {
      res.status(500).json({ error: "Couldn't think of one right now.", suggestion: null });
    }
  });

  app.post("/api/networking/accept", async (req, res) => {
    const who = String(req.body?.who || "").slice(0, 100);
    if (!who) return res.status(400).json({ error: "Need who" });
    const created = await storage.createContact({
      name: "",
      who,
      sector: String(req.body?.sector || "").slice(0, 40),
      why: String(req.body?.why || "").slice(0, 160),
      status: "to_contact",
      note: "",
    } as any);
    res.json({ ok: true, contact: created });
  });
}
