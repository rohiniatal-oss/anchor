import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";

export function registerTaskAssistRoutes(app: Express) {
  app.post("/api/unstick", async (req, res) => {
    const step = String(req.body?.step || "").trim();
    if (!step) return res.status(400).json({ error: "Need a step" });
    try {
      const client = new OpenAI();
      const r = await client.responses.create({
        model: "gpt_5_1",
        input: 'Someone with ADHD is stuck and can\'t start this step: "' + step + '". ' +
          "Give ONE tiny physical 60-second action to break the freeze (e.g. 'Open a blank doc and type one sentence'). " +
          "Warm, one short sentence, no preamble. Return just the sentence.",
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
      const client = new OpenAI();
      const today = new Date().toISOString().slice(0, 10);
      const out = await client.responses.create({
        model: "gpt_5_1",
        input: `Today is ${today}. For this task, estimate size and any real deadline. ` +
          `size: "quick" (<15min), "medium" (~45min), or "deep" (2h+). ` +
          `deadline: a YYYY-MM-DD date ONLY if the task clearly implies one, else "". ` +
          `category: one of job, substack, interview, health, learning, hustle, afterline, admin. ` +
          `Return ONLY JSON like {"size":"quick","deadline":"","category":"admin"}. Task: "${task.title}"`,
      });
      let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let j: any = {};
      try { j = JSON.parse(text); } catch { j = {}; }
      const patch: any = {};
      if (["quick", "medium", "deep"].includes(j.size)) patch.size = j.size;
      if (typeof j.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.deadline)) patch.deadline = j.deadline;
      if (["job", "substack", "interview", "health", "learning", "hustle", "afterline", "admin"].includes(j.category)) patch.category = j.category;
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
    const inbox = (await storage.getTasks()).filter((t) => t.list === "inbox" && !t.done);
    if (inbox.length === 0) return res.json({ suggestions: [] });
    try {
      const client = new OpenAI();
      const list = inbox.map((t) => `${t.id}: ${t.title}`).join("\n");
      const r = await client.responses.create({
        model: "gpt_5_1",
        input: "Sort each brain-dump note into ONE category: 'today' (a task to do soon), 'job' (job/role/application), " +
          "'learn' (study/read/course), 'hustle' (side-income or project), or 'keep' (vague, leave it). " +
          'Return ONLY JSON like [{"id":12,"category":"today"}]. Items:\n' + list,
      });
      let text = (r.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let parsed: { id: number; category: string }[] = [];
      try { parsed = JSON.parse(text); } catch { parsed = []; }
      const valid = new Set(["today", "job", "learn", "hustle", "keep"]);
      res.json({ suggestions: parsed.filter((p) => inbox.some((t) => t.id === p.id) && valid.has(p.category)) });
    } catch {
      res.status(500).json({ error: "Couldn't sort right now." });
    }
  });

  app.post("/api/braindump/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const cat = String(req.body?.category || "");
    if (cat === "today") return res.json({ moved: "today", task: await storage.updateTask(id, { list: "today", block: "morning" }) });
    if (cat === "job") {
      await storage.createJob({ title: task.title, company: "", location: "", url: "", note: "From brain dump", nextStep: "", status: "wishlist" });
      await storage.deleteTask(id);
      return res.json({ moved: "job" });
    }
    if (cat === "learn") {
      await storage.createLearn({ title: task.title, category: "", cost: "", url: "", note: "From brain dump", done: false, active: false });
      await storage.deleteTask(id);
      return res.json({ moved: "learn" });
    }
    if (cat === "hustle") {
      await storage.createHustle({ title: task.title, note: "From brain dump", nextStep: "", stage: "idea" });
      await storage.deleteTask(id);
      return res.json({ moved: "hustle" });
    }
    return res.status(400).json({ error: "Unknown category" });
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
          `You plan warm networking for Rohini (ex-Tony Blair Institute, Bain, Abraaj; LSR/Delhi Univ alum; targeting geopolitics, AI governance, advisory, chief-of-staff in London/UAE/remote).\n\n` +
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
