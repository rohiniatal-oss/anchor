import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage, type TrackEntity } from "./storage";
import OpenAI from "openai";
import { recommend, planDay } from "./brain";
import { createNextTask, materializeJobStep, type NextTaskSourceType } from "./nextTask";
import { getTrackDiagnostics, getUnlinkedItems } from "./strategy";
import {
  insertTaskSchema, insertEventSchema, insertJobSchema,
  insertLearnSchema, insertHustleSchema, insertWinSchema, insertContactSchema,
  insertJobPipelineStepSchema,
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

  // Context-aware breakdown (MUST-FIX #1: NOT title-only). Pulls the REAL source
  // context (job posting, learning output, hustle note) so steps are grounded in
  // what the thing actually needs. First step is MEANINGFUL, never "Google it".
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const context = String(req.body?.context || "").slice(0, 300);

    let sourceContext = "";
    let playbook = "";
    if (task.sourceType === "job" && task.sourceId) {
      const j = (await storage.getJobs()).find((x) => x.id === task.sourceId);
      if (j) {
        sourceContext = `This is a JOB APPLICATION. Role: ${j.title} at ${j.company}. Status: ${j.status}. Readiness: ${j.applicationReadiness}. ${j.note ? "Posting notes: " + j.note : ""} ${j.url ? "URL: " + j.url : ""}`;
        playbook = "APPLICATION playbook: verify requirements \u2192 prepare materials \u2192 draft answers \u2192 review \u2192 submit. First step = open the posting & list exactly what it asks for.";
      }
    } else if (task.sourceType === "learn" && task.sourceId) {
      const l = (await storage.getLearn()).find((x) => x.id === task.sourceId);
      if (l) {
        sourceContext = `This is a LEARNING item (${l.type}). ${l.note ? "Notes: " + l.note : ""} Required output: ${l.requiredOutput || "a concrete output"}. ${l.applicationDeadline ? "Deadline: " + l.applicationDeadline : ""}`;
        playbook = (l.type === "fellowship" || l.type === "course")
          ? "COURSE/FELLOWSHIP playbook: confirm real deadline \u2192 check eligibility/prereq \u2192 apply or enrol \u2192 schedule the work. First step = confirm deadline & prerequisite."
          : "READING playbook: choose the piece \u2192 extract one note \u2192 produce the output. First step = open it and read the first section.";
      }
    } else if (task.sourceType === "hustle" && task.sourceId) {
      const h = (await storage.getHustles()).find((x) => x.id === task.sourceId);
      if (h) {
        sourceContext = `This is a PROOF-ASSET / project step (${h.title}, stage: ${h.stage}). ${h.note ? "Notes: " + h.note : ""}`;
        playbook = /substack/i.test(h.title)
          ? "WRITING playbook: pick audience \u2192 sharpen the claim \u2192 outline \u2192 ugly first draft \u2192 publish. If brand new, first step = decide the angle (a decision, not producing)."
          : "BUILD playbook: define the smallest testable slice \u2192 build it \u2192 try it \u2192 note what to change.";
      }
    } else if (task.sourceUrl || task.sourceNote) {
      sourceContext = `${task.sourceNote ? "Context: " + task.sourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
    }

    try {
      const client = new OpenAI();
      const r = await client.responses.create({
        model: "gpt_5_1",
        input:
          `You break a task into a real, ordered sequence for Rohini (ADHD, rebuilding momentum). ` +
          `Ground the steps in the ACTUAL thing this task needs \u2014 use the source context below, do NOT guess from the title. ` +
          `Think it THROUGH: what does it actually involve, and what is the genuine FIRST step given where she likely is? ` +
          `Never skip ahead (if she's brand new, the first step is understanding/deciding, not producing). ` +
          `The first step must be MEANINGFUL and frictionless \u2014 "open the saved posting & note what it asks", NEVER "Google it" or "pick up the phone". ` +
          `Use as many steps as the task genuinely needs (2-6), each max ~10 words, in real order.\n\n` +
          (playbook ? `Relevant playbook: ${playbook}\n\n` : "") +
          `IF you cannot tell how far along she is and it materially changes the sequence, ask ONE short question first.\n\n` +
          `Task: "${task.title}". Category: ${task.category}. Done when: ${task.doneWhen || "(unset)"}.\n` +
          `SOURCE CONTEXT: ${sourceContext || "(none beyond the title)"}\n` +
          `${context ? "Her answer to your last question: " + context : "No extra context yet."}\n\n` +
          `Return ONLY JSON: either {"question":"<one short question>"} if you must ask, or {"steps":["...","..."]} ordered steps.`,
      });
      let text = (r.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let j: any = {}; try { j = JSON.parse(text); } catch { j = {}; }
      if (j && typeof j.question === "string" && !context) return res.json({ question: String(j.question).slice(0, 140) });
      let arr: string[] = Array.isArray(j?.steps) ? j.steps.slice(0, 6).map(String)
        : (Array.isArray(j) ? j.slice(0, 6).map(String) : []);
      if (!arr.length) arr = ["Open the saved link & check what's needed", "Do the smallest next bit", "Keep going if you can"];
      const objs = arr.map((s) => ({ text: s, done: false }));
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
    const [tasks, jobs, learn, hustles] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles()]);
    const r = recommend(tasks, jobs, learn, hustles, energy);
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
    // Carry the FULL source context onto the task (MUST-FIX #2).
    const created = await storage.createTask({
      title: String(c.title), list: "today", block, done: false, pinned: req.body?.pin !== false,
      steps: "[]", sort: 0, category: c.category || "admin", deadline: c.deadline || "",
      size: c.size || "medium", status: "in_progress", skipped: 0, doneWhen: c.doneWhen || "",
      sourceType: c.source || "", sourceId: c.sourceId ?? undefined,
      sourceUrl: c.sourceUrl || "", sourceNote: c.sourceNote || "", sourceStatus: c.sourceStatus || "",
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

  // \u2550\u2550\u2550 P2: PERSISTED DAY PLAN (Now/Next/Later/Bonus + Minimum Viable Day) \u2550\u2550\u2550
  async function busyMinutesFor(day: string): Promise<number> {
    const events = await storage.getEvents(day);
    let busy = 0;
    for (const e of events) {
      const m = /^(\d{1,2}):(\d{2})/.exec(e.start || "");
      const n = /^(\d{1,2}):(\d{2})/.exec(e.end || "");
      if (m && n) { const mins = (Number(n[1]) * 60 + Number(n[2])) - (Number(m[1]) * 60 + Number(m[2])); if (mins > 0 && mins < 12 * 60) busy += mins; }
      else { busy += 45; }
    }
    return busy;
  }

  async function buildPlan(day: string, energy: "low"|"medium"|"high") {
    const [tasks, jobs, learn, hustles] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles()]);
    const busy = await busyMinutesFor(day);
    const r = planDay(tasks, jobs, learn, hustles, energy, busy);
    let plan = await storage.getPlanByDate(day);
    const planMode = r.mode === "low" ? "low_energy" : r.mode;
    if (!plan) plan = await storage.createPlan({ date: day, mode: planMode, energy, status: "active", enoughForToday: false, note: r.note } as any);
    else plan = await storage.updatePlan(plan.id, { mode: planMode, energy, note: r.note } as any);
    const prevItems = await storage.getPlanItems(plan!.id);
    const actioned = new Map(prevItems.filter((i) => i.status !== "planned").map((i) => [`${i.sourceType}:${i.sourceId}`, i] as const));
    await storage.clearPlanItems(plan!.id);
    let mvdItemId: number | null = null; let seq = 0;
    for (const pi of r.plan) {
      const c = pi.candidate;
      const prev = actioned.get(`${c.source}:${c.sourceId}`);
      const item = await storage.createPlanItem({
        planId: plan!.id, sequence: seq++, slot: pi.slot,
        sourceType: c.source, sourceId: c.sourceId, taskId: c.taskId ?? undefined,
        title: c.title, whySelected: pi.why, doneWhen: c.doneWhen,
        status: prev ? prev.status : "planned", plannedFor: day,
        startedAt: prev?.startedAt ?? undefined, completedAt: prev?.completedAt ?? undefined,
      } as any);
      if (pi.isMVD) mvdItemId = item.id;
    }
    if (mvdItemId) await storage.updatePlan(plan!.id, { minimumViableItemId: mvdItemId } as any);
    return storage.getPlanByDate(day);
  }

  app.get("/api/plan/current", async (req, res) => {
    const day = String(req.query.day || new Date().toISOString().slice(0, 10));
    const energy = ["low","medium","high"].includes(String(req.query.energy)) ? String(req.query.energy) as any : "medium";
    let plan = await storage.getPlanByDate(day);
    if (!plan) await buildPlan(day, energy);
    plan = await storage.getPlanByDate(day);
    const items = plan ? await storage.getPlanItems(plan.id) : [];
    const events = await storage.getEvents(day);
    res.json({ plan, items, events });
  });

  app.post("/api/plan/recompute", async (req, res) => {
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const energy = ["low","medium","high"].includes(req.body?.energy) ? req.body.energy : "medium";
    await buildPlan(day, energy);
    const plan = await storage.getPlanByDate(day);
    const items = plan ? await storage.getPlanItems(plan.id) : [];
    res.json({ plan, items });
  });

  async function refreshDoneEnough(day: string) {
    const plan = await storage.getPlanByDate(day);
    if (!plan || !plan.minimumViableItemId) return;
    const items = await storage.getPlanItems(plan.id);
    const mvd = items.find((i) => i.id === plan.minimumViableItemId);
    if (mvd && mvd.status === "completed" && !plan.enoughForToday)
      await storage.updatePlan(plan.id, { enoughForToday: true, status: "done_enough" } as any);
  }

  async function syncPlanItem(day: string, taskId: number, patch: any) {
    const plan = await storage.getPlanByDate(day);
    if (!plan) return;
    const items = await storage.getPlanItems(plan.id);
    const it = items.find((i) => i.taskId === taskId || (i.sourceType === "task" && i.sourceId === taskId));
    if (it) await storage.updatePlanItem(it.id, patch);
  }

  app.post("/api/tasks/:id/complete", async (req, res) => {
    const id = Number(req.params.id);
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    await storage.updateTask(id, { done: true, status: "done", pinned: false } as any);
    const winCategory =
      task.category === "job" || task.category === "interview" ? "job_progress"
      : task.category === "learning" ? "learning"
      : task.category === "substack" || task.category === "hustle" || task.category === "afterline" ? "proof_asset"
      : task.sourceType === "contact" ? "network"
      : "admin";
    await storage.createWin({ text: task.title, kind: "planned", winCategory } as any);
    await storage.logActivity({ eventType: "completed", sourceType: task.sourceType || "task", sourceId: task.sourceId ?? undefined, taskId: id } as any);
    if (task.sourceType === "job" && task.sourceId) {
      const jb = (await storage.getJobs()).find((x) => x.id === task.sourceId);
      if (jb && jb.status === "wishlist") await storage.updateJob(jb.id, { status: "applied" } as any);
    }
    await syncPlanItem(day, id, { status: "completed", completedAt: Date.now() });
    await refreshDoneEnough(day);
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/block", async (req, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    await storage.updateTask(id, { readiness: "blocked", blockerReason: reason, status: "stuck", pinned: false } as any);
    await storage.logActivity({ eventType: "blocked", sourceType: "task", taskId: id, metadata: JSON.stringify({ reason }) } as any);
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/park", async (req, res) => {
    const id = Number(req.params.id);
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    await storage.updateTask(id, { list: "inbox", block: null, pinned: false, skipped: (task.skipped || 0) + 1 } as any);
    await storage.logActivity({ eventType: "parked", sourceType: "task", taskId: id } as any);
    await syncPlanItem(day, id, { status: "parked", parkedAt: Date.now() });
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/move-later", async (req, res) => {
    const id = Number(req.params.id);
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const order = ["morning", "afternoon", "evening"];
    const i = order.indexOf(task.block || "morning");
    await storage.updateTask(id, { block: order[Math.min(i + 1, order.length - 1)], pinned: false } as any);
    await storage.logActivity({ eventType: "moved", sourceType: "task", taskId: id } as any);
    await syncPlanItem(day, id, { status: "moved", movedAt: Date.now() });
    res.json({ ok: true });
  });

  // ═══ P3: STRATEGY — per-track dashboard + bottleneck insights (computed) ═══
  // The quiet strategic view. Connects jobs / learning / network / proof per
  // career track, finds each track's bottleneck and next move, and surfaces
  // 1-3 cross-cutting insights. Pure deterministic logic — no LLM, no fabrication.
  app.get("/api/strategy", async (_req, res) => {
    const [tracks, jobs, learn, hustles, contacts] = await Promise.all([
      storage.getCareerTracks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(),
    ]);

    const liveJobStatuses = ["wishlist", "applied", "interviewing"];
    const rows = tracks.map((t) => {
      const tJobs = jobs.filter((j) => j.relatedTrackId === t.id && liveJobStatuses.includes(j.status) && j.eligibilityRisk !== "likely_ineligible");
      const tApplied = tJobs.filter((j) => j.status === "applied" || j.status === "interviewing");
      const tLearn = learn.filter((l) => l.relatedTrackId === t.id && !l.done && l.learnStatus !== "closed");
      const tLearnActive = tLearn.filter((l) => l.active);
      const tContacts = contacts.filter((c) => c.relatedTrackId === t.id);
      const tWarm = tContacts.filter((c) => c.status === "messaged" || c.status === "replied");
      const tProof = hustles.filter((h) => h.proofAssetForTrack === t.id);
      const tProofLive = tProof.filter((h) => h.stage !== "idea");
      const topFit = tJobs.reduce((m, j) => Math.max(m, j.fitScore ?? 0), 0);

      // Bottleneck: the single weakest link on this track (in priority order).
      let bottleneck = "", nextMove = "";
      if (tJobs.length === 0 && tLearn.length === 0 && tProof.length === 0) {
        bottleneck = "No live opportunities yet"; nextMove = "Add a role or a learning item to this track";
      } else if (tProof.length > 0 && tJobs.length === 0 && tLearn.length === 0) {
        // A proof / thought-leadership track: the work IS the proof asset.
        bottleneck = tProofLive.length === 0 ? "Proof asset still just an idea" : "Keep the proof asset moving";
        nextMove = tProofLive.length === 0 ? "Move your proof asset past the idea stage" : "Ship the next piece of your proof asset";
      } else if (tJobs.length > 0 && tApplied.length === 0) {
        bottleneck = `${tJobs.length} role${tJobs.length > 1 ? "s" : ""} saved, none submitted`;
        nextMove = "Submit your strongest application on this track";
      } else if (tContacts.length === 0) {
        bottleneck = "No warm contact on this path";
        nextMove = "Identify one person to reach in this sector";
      } else if (tWarm.length === 0 && tContacts.length > 0) {
        bottleneck = "Contacts identified but none messaged";
        nextMove = "Send the first outreach message";
      } else if (tProof.length > 0 && tProofLive.length === 0) {
        bottleneck = "Proof asset still just an idea";
        nextMove = "Move your proof asset past the idea stage";
      } else {
        bottleneck = "Moving well — keep the drumbeat";
        nextMove = "Advance the next live application";
      }

      return {
        id: t.id, slug: t.slug, name: t.name, status: t.status, priority: t.priority, whyItFits: t.whyItFits,
        roles: tJobs.length, applied: tApplied.length, topFit,
        learning: tLearn.length, learningActive: tLearnActive.length,
        contacts: tContacts.length, warmContacts: tWarm.length,
        proofAssets: tProof.length, proofLive: tProofLive.length,
        bottleneck, nextMove,
      };
    });

    // Cross-cutting insights (max 3, highest-signal first).
    const insights: string[] = [];
    const activeRows = rows.filter((r) => r.status === "active");
    const totalLiveRoles = activeRows.reduce((s, r) => s + r.roles, 0);
    const totalApplied = activeRows.reduce((s, r) => s + r.applied, 0);
    if (totalLiveRoles >= 2 && totalApplied === 0)
      insights.push(`Your bottleneck isn't more roles — it's submitting. You have ${totalLiveRoles} live, none applied yet. Pick one and send it.`);
    const richNoContacts = activeRows.find((r) => (r.roles + r.learning) >= 2 && r.contacts === 0);
    if (richNoContacts)
      insights.push(`Your ${richNoContacts.name} path has roles and learning but no warm contact — a referral would unlock far more than another saved role.`);
    const totalLearn = activeRows.reduce((s, r) => s + r.learning, 0);
    const totalProofLive = activeRows.reduce((s, r) => s + r.proofLive, 0);
    if (totalLearn >= 4 && totalProofLive === 0)
      insights.push(`You're collecting learning (${totalLearn} items) but no proof asset is live yet — one published piece beats three half-read courses.`);
    if (insights.length === 0 && activeRows.length)
      insights.push(`Most focus is on ${activeRows[0].name}. That's your spine — keep it moving and let the rest stay light.`);

    res.json({ tracks: rows, insights });
  });

  // ═══ P3.5: NEXT-TASK ENGINE — every source can spawn a provenance-carrying task ═══
  // Maps an entity route segment to the source type the engine understands.
  const NEXT_TASK_SOURCES: Record<string, NextTaskSourceType> = {
    jobs: "job", learn: "learn", contacts: "contact", hustles: "hustle",
  };
  for (const [seg, sourceType] of Object.entries(NEXT_TASK_SOURCES)) {
    app.post(`/api/${seg}/:id/create-next-task`, async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
      const result = await createNextTask({ sourceType, sourceId: id });
      if (!result) return res.status(404).json({ error: "Source not found" });
      res.json({ ...result.task, reused: result.reused });
    });
  }

  // ═══ P4.1: JOB PIPELINE STEPS — a TASK-GENERATIVE readiness rail over a job ═══
  // Steps are SEEDED from an archetype template, then editable per job. Each step
  // does ONLY ONE of: materialize-as-task (reuses 3.5 createNextTask provenance +
  // dedupe), mark-done, or mark-blocked. Editing changes sequence/label only.
  app.get("/api/jobs/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getJobSteps(id));
  });

  // Seed from template — no-op if steps already exist; always returns the steps.
  app.post("/api/jobs/:id/steps/seed", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const steps = await storage.seedJobSteps(id);
    if (!steps.length) {
      // distinguish "no such job" from "seeded zero" — only the former is an error
      const job = (await storage.getJobs()).find((j) => j.id === id);
      if (!job) return res.status(404).json({ error: "Job not found" });
    }
    res.json(steps);
  });

  // Add a custom step.
  app.post("/api/jobs/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const stepLabel = String(req.body?.stepLabel || "").trim().slice(0, 120);
    if (!stepLabel) return res.status(400).json({ error: "Need a stepLabel" });
    const note = String(req.body?.note || "").slice(0, 300);
    const sequence = Number.isFinite(Number(req.body?.sequence)) ? Number(req.body.sequence) : undefined;
    res.json(await storage.createJobStep(id, { stepLabel, note, sequence }));
  });

  // Edit label / status / note / sequence (the one-action contract is unchanged).
  app.patch("/api/steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const p = insertJobPipelineStepSchema.partial().omit({ jobId: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateJobStep(stepId, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    await storage.deleteJobStep(stepId);
    res.json({ ok: true });
  });

  app.patch("/api/jobs/:id/steps/reorder", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const ordered = Array.isArray(req.body?.orderedStepIds) ? req.body.orderedStepIds.map(Number).filter(Number.isFinite) : null;
    if (!ordered) return res.status(400).json({ error: "Need orderedStepIds:number[]" });
    res.json(await storage.reorderJobSteps(id, ordered));
  });

  // Materialize a step into a task via the existing provenance + dedupe machinery.
  // The step records the resulting taskId; status moves to done when materialized
  // (the task now carries the work). Reuses an open task rather than duplicating.
  app.post("/api/steps/:stepId/materialize", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getJobStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const result = await materializeJobStep(step);
    if (!result) return res.status(404).json({ error: "Job not found" });
    await storage.logActivity({ eventType: "planned", sourceType: "job", sourceId: step.jobId, taskId: result.task.id, metadata: JSON.stringify({ stepId, reused: result.reused }) } as any);
    res.json({ ...result.task, reused: result.reused, stepId });
  });

  // mark-blocked: thin status + blocker note on the step. NOT a parallel state
  // machine — if the step already materialized a task, reuse task readiness=blocked.
  app.post("/api/steps/:stepId/block", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getJobStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const updated = await storage.updateJobStep(stepId, { status: "blocked", note: reason } as any);
    if (step.taskId) {
      await storage.updateTask(step.taskId, { readiness: "blocked", blockerReason: reason, status: "stuck" } as any);
    }
    await storage.logActivity({ eventType: "blocked", sourceType: "job", sourceId: step.jobId, taskId: step.taskId ?? undefined, metadata: JSON.stringify({ stepId, reason }) } as any);
    res.json(updated);
  });

  // ═══ P3.5: TRACK COHERENCE — link any source/task to a career track in place ═══
  const LINK_ENTITIES = new Set<TrackEntity>(["jobs", "learn", "contacts", "hustles", "tasks"]);
  app.patch("/api/:entity/:id/link-track", async (req, res) => {
    const entity = String(req.params.entity) as TrackEntity;
    if (!LINK_ENTITIES.has(entity)) return res.status(400).json({ error: "Unknown entity" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const raw = req.body?.trackId;
    if (raw !== null && raw !== undefined && !Number.isFinite(Number(raw)))
      return res.status(400).json({ error: "trackId must be a number or null" });
    const trackId = raw === null || raw === undefined ? null : Number(raw);
    const updated = await storage.linkTrack(entity, id, trackId);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // Career tracks list (for the in-card Link track control).
  app.get("/api/career-tracks", async (_req, res) => res.json(await storage.getCareerTracks()));

  // ═══ P3.5: STRATEGY DIAGNOSTICS — per-track bottlenecks + unlinked bucket ═══
  app.get("/api/strategy/diagnostics", async (_req, res) => res.json({ tracks: await getTrackDiagnostics() }));
  app.get("/api/strategy/unlinked", async (_req, res) => res.json(await getUnlinkedItems()));

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
