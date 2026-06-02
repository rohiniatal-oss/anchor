import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";
import OpenAI from "openai";
import { recommend, planDay } from "./brain";
import {
  insertTaskSchema, insertEventSchema, insertJobSchema,
  insertLearnSchema, insertHustleSchema, insertWinSchema, insertContactSchema,
} from "@shared/schema";

function crud(app: Express, name: string, get: () => Promise<any>, schema: any,
  create: (d: any) => Promise<any>, update: (id: number, d: any) => Promise<any>, del: (id: number) => Promise<any>) {
  app.get(`/api/${name}`, async (_q, res) => res.json(await get()));
  app.post(`/api/${name}`, async (req, res) => {
    const p = schema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(await create(p.data));
  });
  app.patch(`/api/${name}/:id`, async (req, res) => {
    const p = schema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const u = await update(Number(req.params.id), p.data);
    if (!u) return res.status(404).json({ error: "Not found" });
    res.json(u);
  });
  app.delete(`/api/${name}/:id`, async (req, res) => { await del(Number(req.params.id)); res.json({ ok: true }); });
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  crud(app, "tasks", () => storage.getTasks(), insertTaskSchema,
    (d) => storage.createTask(d), (id, d) => storage.updateTask(id, d), (id) => storage.deleteTask(id));
  crud(app, "jobs", () => storage.getJobs(), insertJobSchema,
    (d) => storage.createJob(d), (id, d) => storage.updateJob(id, d), (id) => storage.deleteJob(id));
  crud(app, "learn", () => storage.getLearn(), insertLearnSchema,
    (d) => storage.createLearn(d), (id, d) => storage.updateLearn(id, d), (id) => storage.deleteLearn(id));
  crud(app, "hustles", () => storage.getHustles(), insertHustleSchema,
    (d) => storage.createHustle(d), (id, d) => storage.updateHustle(id, d), (id) => storage.deleteHustle(id));
  crud(app, "wins", () => storage.getWins(), insertWinSchema,
    (d) => storage.createWin(d), () => Promise.resolve(undefined), (id) => storage.deleteWin(id));
  crud(app, "contacts", () => storage.getContacts(), insertContactSchema,
    (d) => storage.createContact(d), (id, d) => storage.updateContact(id, d), (id) => storage.deleteContact(id));

  // Break a task into tiny steps
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    try {
      const client = new OpenAI();
      const r = await client.responses.create({
        model: "gpt_5_1",
        input: "You help someone with ADHD who finds starting overwhelming. Break this task into 3-5 tiny steps. " +
          "The FIRST step must be almost laughably small and physical (under 2 minutes). Each step max ~8 words, action-first, no numbering. " +
          'Return ONLY a JSON array of strings. Task: "' + task.title + '"',
      });
      let text = (r.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let steps: string[] = [];
      try { steps = JSON.parse(text); } catch { steps = text.split("\n").map((s) => s.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean); }
      const objs = steps.slice(0, 5).map((s) => ({ text: s, done: false }));
      res.json(await storage.updateTask(id, { steps: JSON.stringify(objs) }));
    } catch { res.status(500).json({ error: "Could not break this down right now." }); }
  });

  // Unstick a single step
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
    } catch { res.status(500).json({ error: "Couldn't think of one right now." }); }
  });

  // Enrich a task: AI estimates size and extracts a real deadline if present.
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
      let j: any = {}; try { j = JSON.parse(text); } catch { j = {}; }
      const patch: any = {};
      if (["quick","medium","deep"].includes(j.size)) patch.size = j.size;
      if (typeof j.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.deadline)) patch.deadline = j.deadline;
      if (["job","substack","interview","health","learning","hustle","afterline","admin"].includes(j.category)) patch.category = j.category;
      const updated = await storage.updateTask(id, patch);
      res.json(updated);
    } catch { res.status(500).json({ error: "Couldn't enrich right now." }); }
  });

  // "Done this week" count for momentum (wins logged in the last 7 days).
  app.get("/api/stats", async (_req, res) => {
    const weekAgo = Date.now() - 7 * 86400000;
    const wins = await storage.getWins();
    res.json({ doneThisWeek: wins.filter((w) => w.createdAt >= weekAgo).length });
  });

  // Sort brain dump
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
    } catch { res.status(500).json({ error: "Couldn't sort right now." }); }
  });

  // Move a brain-dump item
  app.post("/api/braindump/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const cat = String(req.body?.category || "");
    if (cat === "today") return res.json({ moved: "today", task: await storage.updateTask(id, { list: "today", block: "morning" }) });
    if (cat === "job") { await storage.createJob({ title: task.title, company: "", location: "", url: "", note: "From brain dump", nextStep: "", status: "wishlist" }); await storage.deleteTask(id); return res.json({ moved: "job" }); }
    if (cat === "learn") { await storage.createLearn({ title: task.title, category: "", cost: "", url: "", note: "From brain dump", done: false, active: false }); await storage.deleteTask(id); return res.json({ moved: "learn" }); }
    if (cat === "hustle") { await storage.createHustle({ title: task.title, note: "From brain dump", nextStep: "", stage: "idea" }); await storage.deleteTask(id); return res.json({ moved: "hustle" }); }
    return res.status(400).json({ error: "Unknown category" });
  });

  // ---- COACH: ONE concrete next action (not a list). Reads live state, suggests
  //      the single highest-leverage thing she probably hasn't thought of.
  //      `exclude` lets the UI ask for a different one ("something else").
  app.post("/api/coach", async (req, res) => {
    const exclude: string[] = Array.isArray(req.body?.exclude) ? req.body.exclude.map((s: any) => String(s)) : [];
    const [tasks, jobs, learn, hustles, wins] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getWins(),
    ]);
    const existing = tasks.filter((t) => !t.done).map((t) => t.title.toLowerCase());
    const openJobs = jobs.filter((j) => j.status !== "closed").map((j) => `${j.title} @ ${j.company} [${j.status}]`);
    const activeLearn = learn.filter((l) => l.active && !l.done).map((l) => l.title);
    const hustleSteps = hustles.filter((h) => h.stage !== "earning").map((h) => `${h.title}: ${h.nextStep}`);
    const recentWins = wins.slice(0, 5).map((w) => w.text);
    try {
      const client = new OpenAI();
      const out = await client.responses.create({
        model: "gpt_5_1",
        input:
          `You are a sharp, warm job-hunt coach for Rohini \u2014 ex-Tony Blair Institute, Bain, Abraaj; targeting geopolitics, AI governance, strategic advisory, and chief-of-staff roles in London / UAE / remote. ADHD, rebuilding momentum.\n\n` +
          `Suggest THE SINGLE most useful next action she probably hasn't thought of \u2014 ONE thing, concrete, doable today, first-step-friendly. Reason from her live pipeline (the specific roles/sectors below), not generic advice. Prefer the highest-leverage move right now (a near deadline, an obvious follow-up, a credibility step, a smart bit of prep). NOT networking (that has its own engine). Examples of the right shape: "Tailor your CV bullets for the GovAI ops role", "Draft the opening line of your Impact Accelerator application", "Outline a Substack post on this week's biggest geopolitical shift".\n\n` +
          `Do NOT invent names. ONE action line, max ~12 words. Don't repeat anything in her list or the exclude set.\n\n` +
          `OPEN ROLES: ${JSON.stringify(openJobs)}\nACTIVE LEARNING: ${JSON.stringify(activeLearn)}\nPROJECTS: ${JSON.stringify(hustleSteps)}\nALREADY ON LIST: ${JSON.stringify(existing)}\nEXCLUDE (already shown, pick something different): ${JSON.stringify(exclude)}\nRECENT WINS: ${JSON.stringify(recentWins)}\n\n` +
          `Return ONLY one JSON object: {"title":"...","category":"job|substack|learning|admin","size":"quick|medium|deep","why":"<=8 words"}.`,
      });
      let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let j: any = {}; try { j = JSON.parse(text); } catch { j = {}; }
      if (!j || typeof j.title !== "string") return res.json({ suggestion: null });
      const suggestion = {
        title: String(j.title).slice(0, 120),
        category: ["job", "substack", "learning", "admin"].includes(j.category) ? j.category : "job",
        size: ["quick", "medium", "deep"].includes(j.size) ? j.size : "quick",
        why: typeof j.why === "string" ? j.why.slice(0, 60) : "",
      };
      res.json({ suggestion, date: new Date().toISOString().slice(0, 10) });
    } catch { res.status(500).json({ error: "Coach couldn't think right now.", suggestion: null }); }
  });

  // COACH: accept the one action -> drops straight into TODAY, brain places the block
  //      by size (deep -> morning, medium -> afternoon, quick -> evening). No focus hijack.
  app.post("/api/coach/accept", async (req, res) => {
    const title = String(req.body?.title || "").slice(0, 120);
    const category = ["job", "substack", "learning", "admin"].includes(req.body?.category) ? req.body.category : "job";
    const size = ["quick", "medium", "deep"].includes(req.body?.size) ? req.body.size : "quick";
    if (!title) return res.status(400).json({ error: "Need a title" });
    const block = size === "deep" ? "morning" : size === "medium" ? "afternoon" : "evening";
    const created = await storage.createTask({
      title, list: "today", block, done: false, sort: 0, category, size,
      deadline: "", status: "not_started", skipped: 0, pinned: false, steps: "[]", doneWhen: "", source: "coach",
    } as any);
    res.json({ ok: true, task: created });
  });

  // ---- NETWORKING ENGINE: sector-aware outreach suggestions tied to her real pipeline.
  //      Returns WHO to reach (by type + sector) and WHY \u2014 she fills in the name.
  //      `exclude` swaps for a different person-type.
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
          `Given her TARGET ROLES below, suggest ONE specific *kind of person* to reach \u2014 tied to those exact orgs/sectors \u2014 that would most move her hunt. Reason strategically: which warm route (ex-TBI, ex-Bain, ex-Abraaj, LSR/Delhi alum, someone already at the target org or its sector) best unlocks these roles. Describe them by TYPE + WHERE (no invented names).\n\n` +
          `TARGET ROLES: ${JSON.stringify(targets)}\nALREADY TRACKED (don't repeat): ${JSON.stringify(alreadyTracked)}\nEXCLUDE: ${JSON.stringify(exclude)}\n\n` +
          `Return ONLY one JSON object: {"who":"<person type + where, e.g. 'ex-Bain colleague now in AI policy'>","sector":"<short sector tag>","why":"<one tight sentence on why this unlocks a target role>"}.`,
      });
      let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let j: any = {}; try { j = JSON.parse(text); } catch { j = {}; }
      if (!j || typeof j.who !== "string") return res.json({ suggestion: null });
      res.json({ suggestion: { who: String(j.who).slice(0, 100), sector: String(j.sector || "").slice(0, 40), why: String(j.why || "").slice(0, 160) } });
    } catch { res.status(500).json({ error: "Couldn't think of one right now.", suggestion: null }); }
  });

  // NETWORKING: accept a suggested person-type into the outreach tracker (status to_contact).
  app.post("/api/networking/accept", async (req, res) => {
    const who = String(req.body?.who || "").slice(0, 100);
    if (!who) return res.status(400).json({ error: "Need who" });
    const created = await storage.createContact({
      name: "", who, sector: String(req.body?.sector || "").slice(0, 40),
      why: String(req.body?.why || "").slice(0, 160), status: "to_contact", note: "",
    } as any);
    res.json({ ok: true, contact: created });
  });

  // Brain: recommend ONE next action from capacity (energy + time)
  app.post("/api/brain/recommend", async (req, res) => {
    const energy = ["low","medium","high"].includes(req.body?.energy) ? req.body.energy : "medium";
    const time = ["15","45","120"].includes(String(req.body?.time)) ? String(req.body.time) : "45";
    const [tasks, jobs, learn, hustles] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles()]);
    const r = recommend(tasks, jobs, learn, hustles, energy, time);
    res.json(r);
  });

  // Brain: build a BALANCED day plan (~3 items, varied types, laid across blocks).
  // Reads today's calendar to know how busy the day already is.
  app.post("/api/brain/plan", async (req, res) => {
    const energy = ["low","medium","high"].includes(req.body?.energy) ? req.body.energy : "medium";
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const [tasks, jobs, learn, hustles, events] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getEvents(day),
    ]);
    // Estimate minutes the calendar already eats (timed events only).
    let busy = 0;
    for (const e of events) {
      const m = /^(\d{1,2}):(\d{2})/.exec(e.start || "");
      const n = /^(\d{1,2}):(\d{2})/.exec(e.end || "");
      if (m && n) {
        const mins = (Number(n[1]) * 60 + Number(n[2])) - (Number(m[1]) * 60 + Number(m[2]));
        if (mins > 0 && mins < 12 * 60) busy += mins;
      } else { busy += 45; } // untimed event -> assume ~45m
    }
    const r = planDay(tasks, jobs, learn, hustles, energy, busy);
    res.json({ ...r, busyMinutes: busy, events });
  });

  // Accept a brain pick: if it's already a today task, just pin it; otherwise create a today task from the candidate.
  app.post("/api/brain/accept", async (req, res) => {
    const c = req.body?.candidate;
    if (!c || !c.title) return res.status(400).json({ error: "Need candidate" });
    // unpin any existing pinned task first
    for (const t of await storage.getTasks()) { if (t.pinned) await storage.updateTask(t.id, { pinned: false }); }
    if (c.source === "task") {
      const updated = await storage.updateTask(Number(c.sourceId), { pinned: true, status: "in_progress" });
      return res.json({ ok: true, task: updated });
    }
    const block = ["morning","afternoon","evening"].includes(c.block) ? c.block : "morning";
    const created = await storage.createTask({
      title: String(c.title), list: "today", block, done: false, pinned: req.body?.pin !== false,
      steps: "[]", sort: 0, category: c.category || "admin", deadline: c.deadline || "",
      size: c.size || "medium", status: "in_progress", skipped: 0, doneWhen: "",
    } as any);
    res.json({ ok: true, task: created });
  });

  // Skip the current pick — kindly: increment avoidance, auto-break-down so it's easier next time.
  app.post("/api/tasks/:id/skip", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const skipped = (task.skipped || 0) + 1;
    let steps = task.steps;
    // After 2+ skips, if it has no steps yet, shrink it automatically.
    if (skipped >= 2 && (!steps || steps === "[]")) {
      try {
        const client = new OpenAI();
        const out = await client.responses.create({
          model: "gpt_5_1",
          input: "Someone with ADHD keeps avoiding this task. Break it into 3-4 tiny steps, first one under 2 minutes and physical. " +
            'Return ONLY a JSON array of strings. Task: "' + task.title + '"',
        });
        let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
        let arr: string[] = []; try { arr = JSON.parse(text); } catch { arr = []; }
        if (arr.length) steps = JSON.stringify(arr.slice(0,4).map((x) => ({ text: x, done: false })));
      } catch { /* leave steps as-is */ }
    }
    const updated = await storage.updateTask(id, { skipped, steps });
    res.json(updated);
  });

  // Today plan (morning briefing writes the day in)
  app.post("/api/today/plan", async (req, res) => {
    const day = String(req.body?.day || "");
    if (!day) return res.status(400).json({ error: "Need day" });
    if (Array.isArray(req.body?.events)) {
      const p = insertEventSchema.array().safeParse(req.body.events.map((e: any) => ({ ...e, day })));
      if (p.success) await storage.replaceEventsForDay(day, p.data);
    }
    for (const t of await storage.getTasks()) {
      if (t.list === "today" && !t.done && t.title.startsWith("\u2728 ")) await storage.deleteTask(t.id);
    }
    const blocks = req.body?.blocks || {};
    const focus = (req.body?.focus || "").trim();
    let pinned = false;
    for (const b of ["morning", "afternoon", "evening"] as const) {
      for (const title of (Array.isArray(blocks[b]) ? blocks[b] : [])) {
        const c = await storage.createTask({ title: "\u2728 " + String(title), list: "today", block: b, done: false, pinned: false, steps: "[]", sort: 0 } as any);
        if (!pinned && focus && String(title).toLowerCase().includes(focus.toLowerCase().slice(0, 20))) {
          await storage.updateTask(c.id, { pinned: true }); pinned = true;
        }
      }
    }
    res.json({ ok: true });
  });

  // Events read
  app.get("/api/events", async (req, res) => res.json(await storage.getEvents(String(req.query.day || ""))));
  app.put("/api/events", async (req, res) => {
    const day = String(req.body?.day || "");
    const p = insertEventSchema.array().safeParse(req.body?.events || []);
    if (!day || !p.success) return res.status(400).json({ error: "Need day + events" });
    await storage.replaceEventsForDay(day, p.data);
    res.json({ ok: true });
  });

  return httpServer;
}
