import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage, type TrackEntity } from "./storage";
import OpenAI from "openai";
import { recommend, planDay } from "./brain";
import { createNextTask, materializeJobStep, materializeProofStep, type NextTaskSourceType } from "./nextTask";
import { getTrackDiagnostics, getUnlinkedItems, getEvidencePayload, getStrategyFrontDoor } from "./strategy";
import { computeLearningGaps } from "./learningStrategy";
import { computeWinsSummary } from "./evidence";
import {
  insertTaskSchema, insertEventSchema, insertJobSchema,
  insertLearnSchema, insertHustleSchema, insertWinSchema, insertContactSchema,
  insertJobPipelineStepSchema, insertProofAssetStepSchema,
} from "@shared/schema";
import { isSubmitStep } from "@shared/jobTemplates";
import { migrateFellowshipLearnRows } from "./fellowshipMigration";

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
  // MECE fix: move any legacy fellowship `learn` rows into the opportunity
  // pipeline before serving. Idempotent + conservative (dedupe by title+kind;
  // never misclassifies a course). Safe to run on every boot.
  try { migrateFellowshipLearnRows(); } catch (e) { console.error("Fellowship migration skipped:", e); }

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
        sourceContext = `This is a LEARNING item (${l.type}). Title: "${l.title}". ${l.url ? "URL: " + l.url + ". " : ""}${l.note ? "Notes: " + l.note + ". " : ""}${l.capabilityBuilt ? "Capability it should build: " + l.capabilityBuilt + ". " : ""}Required output: ${l.requiredOutput || "a concrete output"}. ${l.applicationDeadline ? "Deadline: " + l.applicationDeadline : ""}`;
        playbook = (l.type === "fellowship" || l.type === "course")
          ? "COURSE/FELLOWSHIP playbook: confirm real deadline \u2192 check eligibility/prereq \u2192 apply or enrol \u2192 schedule the work. First step = confirm deadline & prerequisite."
          // NOT a canned recipe. Reason about THIS specific resource: you likely
          // know what it is (e.g. the 80,000 Hours career guide). Steps must show
          // you understand WHAT it is and what it's FOR, help her TRIAGE which
          // parts matter for her goals (AI governance / strategy / chief-of-staff)
          // vs what to skip, and end in a concrete useful output — NEVER vague
          // filler like "read that section slowly".
          : `READING/RESOURCE — reason about THIS specific resource ("${l.title}"${l.url ? ", " + l.url : ""}). If you know what it is, use that. Steps should: (1) orient — what this resource is and what it's good for; (2) triage — which 1-2 parts actually matter for her AI-governance / strategy / chief-of-staff goals and which to skip; (3) end in a concrete output that proves she got the useful part. No generic "read slowly" steps.`;
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
          `She's targeting AI governance / strategic advisory / chief-of-staff roles (ex-Bain, TBI, Abraaj). ` +
          `Ground the steps in the ACTUAL thing this task needs \u2014 use the source context below, and your own knowledge of what the named resource/role IS. Do NOT produce generic filler that could apply to any task. ` +
          `If the task is to read/use a known resource, show you understand what it is, what's worth her time in it, and what to skip \u2014 not "read it slowly". ` +
          `Think it THROUGH: what does it actually involve, and what is the genuine FIRST step given where she likely is? ` +
          `Never skip ahead (if she's brand new, the first step is understanding/deciding, not producing). ` +
          `The first step must be MEANINGFUL and frictionless \u2014 "open the saved posting & note what it asks", NEVER "Google it" or "pick up the phone". ` +
          `Use as many steps as the task genuinely needs (2-6), each max ~10 words, in real order.\n\n` +
          (playbook ? `Relevant playbook: ${playbook}\n\n` : "") +
          `STRONGLY PREFER giving steps over asking. If you recognise the resource or role (e.g. the 80,000 Hours career guide), reason from what you know and produce a sensible default sequence \u2014 do NOT ask her where she is. Only ask ONE short question in the rare case the sequence would be genuinely wrong without it (and never for a well-known public resource).\n\n` +
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

  // ── BRAIN-DUMP TRIAGE: classify a captured item by KIND, then act coherently.
  //    An inbox item is NOT always a standalone task — it may be a SUBTASK of an
  //    existing job/learn/hustle, a note/idea, a new project, or clutter. We
  //    classify once (LLM, grounded in her REAL pipeline) and return a SUGGESTION
  //    the UI confirms with one tap — we never silently reshape her day, so the
  //    plan stays trustworthy. Kinds:
  //      standalone_task  -> offer "Do today" (promotes to today's plan)
  //      subtask          -> offer "Add under <parent>" (attaches as a step; shows
  //                          through the parent, never orphaned as its own line)
  //      note_idea        -> offer "File as <Substack idea / Learn>"
  //      new_project      -> offer "Make it a <hustle / role / learn track>"
  //      clutter          -> keep in inbox (no action)
  app.post("/api/braindump/:id/triage", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const [jobs, learn, hustles] = await Promise.all([storage.getJobs(), storage.getLearn(), storage.getHustles()]);

    // Compact, ID'd context so the model can name a real parent (no fabrication).
    const liveJobs = jobs.filter((j) => ["wishlist", "applied", "interviewing"].includes(j.status));
    const ctx = [
      ...liveJobs.map((j) => `job#${j.id}: ${j.title}${j.company ? " @ " + j.company : ""}`),
      ...learn.filter((l) => !l.done).map((l) => `learn#${l.id}: ${l.title}`),
      ...hustles.map((h) => `hustle#${h.id}: ${h.title}`),
    ].join("\n");

    let kind = "standalone_task", parentType = "", parentId: number | null = null, reason = "";
    try {
      const client = new OpenAI();
      const out = await client.responses.create({
        model: "gpt_5_1",
        input:
          `Classify ONE captured thought from Rohini's brain dump. Decide what KIND it is and, ` +
          `if it belongs under something she already has, WHICH parent.\n\n` +
          `KINDS:\n` +
          `- "standalone_task": a single actionable to-do that stands on its own (e.g. "call the recruiter back").\n` +
          `- "subtask": a step of one of her EXISTING items below (e.g. "draft cover letter" under a specific job).\n` +
          `- "note_idea": a thought/idea/seed, not yet actionable (e.g. a writing topic).\n` +
          `- "new_project": implies a whole new project/role/learning track, not a one-off task.\n` +
          `- "clutter": personal/no-action-needed/too-vague.\n\n` +
          `HER EXISTING ITEMS (use these exact ids for a subtask parent):\n${ctx || "(none)"}\n\n` +
          `CAPTURED THOUGHT: "${task.title}"\n\n` +
          `Return ONLY JSON: {"kind":"...","parentType":"job|learn|hustle|","parentId":<number or null>,"reason":"<=12 words"}.`,
      });
      let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const j: any = JSON.parse(text);
      const kinds = ["standalone_task", "subtask", "note_idea", "new_project", "clutter"];
      if (kinds.includes(j.kind)) kind = j.kind;
      if (["job", "learn", "hustle"].includes(j.parentType)) parentType = j.parentType;
      if (Number.isFinite(j.parentId)) parentId = Number(j.parentId);
      if (typeof j.reason === "string") reason = j.reason.slice(0, 80);
    } catch {
      // LLM down — safe default: treat as a standalone task she can choose to do.
      kind = "standalone_task";
    }

    // Validate a claimed parent actually exists (never trust a fabricated id).
    let parentLabel = "";
    if (kind === "subtask" && parentType && parentId != null) {
      const pool = parentType === "job" ? jobs : parentType === "learn" ? learn : hustles;
      const parent = pool.find((x: any) => x.id === parentId);
      if (!parent) { kind = "standalone_task"; parentType = ""; parentId = null; }
      else parentLabel = (parent as any).title || "";
    }

    res.json({ id, kind, parentType, parentId, parentLabel, reason });
  });

  // Act on an accepted triage suggestion (one tap from the UI). Coherent per kind.
  app.post("/api/braindump/:id/apply", async (req, res) => {
    const id = Number(req.params.id);
    const action = String(req.body?.action || "");
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });

    if (action === "do_today") {
      const block = task.size === "deep" ? "morning" : task.size === "medium" ? "afternoon" : "evening";
      const updated = await storage.updateTask(id, { list: "today", block } as any);
      return res.json({ ok: true, result: "today", task: updated });
    }
    if (action === "attach_subtask") {
      const parentType = String(req.body?.parentType || "");
      const parentId = Number(req.body?.parentId);
      // Carry the parent's context onto the task and link it, so it shows THROUGH
      // the parent's next-step rail rather than floating as its own plan line.
      await storage.updateTask(id, {
        list: "inbox", sourceType: parentType, sourceId: parentId,
        relatedOpportunityId: parentType === "job" ? parentId : undefined,
      } as any);
      return res.json({ ok: true, result: "attached" });
    }
    if (action === "file_substack") {
      await storage.createHustle({ title: task.title, note: "From brain dump", nextStep: "Decide your angle", stage: "idea" } as any);
      await storage.deleteTask(id);
      return res.json({ ok: true, result: "substack" });
    }
    if (action === "file_learn") {
      await storage.createLearn({ title: task.title, category: "", cost: "", url: "", note: "From brain dump", done: false, active: false } as any);
      await storage.deleteTask(id);
      return res.json({ ok: true, result: "learn" });
    }
    if (action === "make_role") {
      await storage.createJob({ title: task.title, company: "", location: "", url: "", note: "From brain dump", nextStep: "", status: "wishlist" } as any);
      await storage.deleteTask(id);
      return res.json({ ok: true, result: "job" });
    }
    // keep / clutter -> no-op, stays in inbox
    return res.json({ ok: true, result: "kept" });
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

  // ═══ P4.6a: PLAN-ITEM IDENTITY CHAIN ═══
  // Start a plan item -> reads the EXACT day_plan_items.id, creates OR reuses the
  // backing task (reusing the 3.5 createNextTask/dedupe for non-task sources; if
  // the plan item already has a taskId, that task is reused), stores taskId back
  // on the plan item (both-way link), marks the item started, pins the task as
  // Right Now, and PRESERVES slot/source/url/deadline/doneWhen/whySelected onto
  // the task. The block is DERIVED from the slot (or left null) — never hardcoded.
  // slot context: now -> morning, next -> afternoon, later/bonus -> evening.
  const SLOT_TO_BLOCK: Record<string, string> = { now: "morning", next: "afternoon", later: "evening", bonus: "evening" };
  app.post("/api/plan-items/:id/start", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const item = await storage.getPlanItem(id);
    if (!item) return res.status(404).json({ error: "Plan item not found" });
    const day = String(req.body?.day || item.plannedFor || new Date().toISOString().slice(0, 10));
    const block = item.slot && SLOT_TO_BLOCK[item.slot] ? SLOT_TO_BLOCK[item.slot] : null;

    // 1) Resolve the backing task: explicit link first, then existing task source,
    //    then the shared createNextTask machinery for job/learn/hustle/contact.
    let task = item.taskId ? (await storage.getTasks()).find((t) => t.id === item.taskId) : undefined;
    if (!task && item.sourceType === "task" && item.sourceId) {
      task = (await storage.getTasks()).find((t) => t.id === item.sourceId);
    }
    if (!task && item.sourceId && (item.sourceType === "job" || item.sourceType === "learn" || item.sourceType === "hustle" || item.sourceType === "contact")) {
      const result = await createNextTask({ sourceType: item.sourceType, sourceId: item.sourceId });
      if (result) task = result.task;
    }

    // 2) Unpin any existing focus before pinning the new one.
    for (const t of await storage.getTasks()) { if (t.pinned && t.id !== task?.id) await storage.updateTask(t.id, { pinned: false }); }

    // 3) Preserve the plan item's full identity onto the task. block derived (or null).
    const preserve: any = {
      list: "today", pinned: true, status: "in_progress", block,
      planItemId: item.id,
      doneWhen: item.doneWhen || task?.doneWhen || "",
      sourceType: item.sourceType || task?.sourceType || "",
      sourceId: item.sourceId ?? task?.sourceId ?? undefined,
    };
    if (task) {
      task = await storage.updateTask(task.id, preserve);
    } else {
      // No source object resolvable (e.g. a free-text plan item) — materialise a
      // task that still carries the plan item's identity.
      task = await storage.createTask({
        title: item.title, list: "today", block, done: false, pinned: true, steps: "[]", sort: 0,
        category: item.sourceType === "job" ? "job" : item.sourceType === "learn" ? "learning" : item.sourceType === "hustle" ? "hustle" : "admin",
        deadline: "", status: "in_progress", skipped: 0, doneWhen: item.doneWhen || "",
        sourceType: item.sourceType || "", sourceId: item.sourceId ?? undefined, planItemId: item.id,
      } as any);
    }

    // 4) Both-way link + mark the plan item started.
    await storage.updatePlanItem(item.id, { taskId: task!.id, status: "started", startedAt: Date.now() } as any);
    await storage.logActivity({ eventType: "started", sourceType: item.sourceType || "task", sourceId: item.sourceId ?? undefined, taskId: task!.id, planItemId: item.id } as any);
    res.json({ ok: true, task });
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

  // Resolve plan item <-> task by EXPLICIT id link FIRST (for ALL source types),
  // then fall back to source inference only if no id link exists (P4.6a #2).
  // task.planItemId (set by /start) is the strongest link; then item.taskId; then
  // a "task"-sourced item whose sourceId is this task; then nothing.
  async function syncPlanItem(day: string, task: { id: number; planItemId?: number | null }, patch: any) {
    const plan = await storage.getPlanByDate(day);
    if (!plan) return;
    const items = await storage.getPlanItems(plan.id);
    const it =
      (task.planItemId != null ? items.find((i) => i.id === task.planItemId) : undefined)
      || items.find((i) => i.taskId === task.id)
      || items.find((i) => i.sourceType === "task" && i.sourceId === task.id);
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
    // P5 — attribute the win to the originating task's track explicitly (no more
    // fragile text-match). Null when the task is untracked, which stays valid.
    await storage.createWin({ text: task.title, kind: "planned", winCategory, trackId: task.relatedTrackId ?? null } as any);
    await storage.logActivity({ eventType: "completed", sourceType: task.sourceType || "task", sourceId: task.sourceId ?? undefined, taskId: id, planItemId: task.planItemId ?? undefined } as any);
    // P4.6a #3: a GENERIC completed job-linked task NEVER changes job status — it
    // only logs activity/evidence (above). Job wishlist->applied advances ONLY via
    // the submit pipeline step or the explicit "Mark application submitted" button.
    // The old fuzzy auto-applied trigger is CUT.
    await syncPlanItem(day, task, { status: "completed", completedAt: Date.now() });
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
    await syncPlanItem(day, task, { status: "parked", parkedAt: Date.now() });
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
    await syncPlanItem(day, task, { status: "moved", movedAt: Date.now() });
    res.json({ ok: true });
  });

  // ═══ STRATEGY — ONE engine (getTrackDiagnostics), ONE front door ═══════════
  // P4.6a #5: the diagnostics engine is the single source of truth. The unified
  // front-door returns everything the Strategy view needs in one payload; the
  // legacy /api/strategy now DELEGATES to it (mapping to its old { tracks,
  // insights } shape) so there is no parallel computation to drift.
  app.get("/api/strategy/front-door", async (_req, res) => res.json(await getStrategyFrontDoor()));

  app.get("/api/strategy", async (_req, res) => {
    const fd = await getStrategyFrontDoor();
    const tracks = fd.tracks.map((t) => ({
      id: t.id, slug: t.slug, name: t.name, status: t.status, priority: t.priority, whyItFits: t.whyItFits,
      roles: t.counts.jobs, learning: t.counts.learn, contacts: t.counts.contacts, proofAssets: t.counts.hustles,
      bottleneck: t.bottleneckLabel, nextMove: t.recommendedMove,
    }));
    res.json({ tracks, insights: fd.insights.map((i) => i.text) });
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

  // ═══ P4.4: LEARN AS A PROOF-BUILDING VIEW ═══
  // create-output-task is an intent-named ALIAS over the existing 3.5 learn
  // create-next-task (REUSES createNextTask(sourceType "learn") — title from
  // requiredOutput, doneWhen references the artifact — with provenance + dedupe).
  // No parallel task creator. PATCH /api/learn/:id is already provided by crud()
  // and accepts requiredOutput / outputEvidenceUrl / learnStatus / relatedTrackId.
  app.post("/api/learn/:id/create-output-task", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await createNextTask({ sourceType: "learn", sourceId: id });
    if (!result) return res.status(404).json({ error: "Learn item not found" });
    res.json({ ...result.task, reused: result.reused });
  });

  // mark-evidenced: persist the produced-artifact url onto the learn item (flips
  // derived outputState to "evidenced"); optionally record a proof_for entityLink
  // to a produced task when proofToId is supplied (kept optional/simple).
  app.post("/api/learn/:id/mark-evidenced", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const outputEvidenceUrl = String(req.body?.outputEvidenceUrl || "").trim().slice(0, 500);
    if (!outputEvidenceUrl) return res.status(400).json({ error: "Need outputEvidenceUrl" });
    const rawProof = req.body?.proofToId;
    const proofToId = rawProof === null || rawProof === undefined ? null : Number(rawProof);
    if (proofToId !== null && !Number.isFinite(proofToId)) return res.status(400).json({ error: "proofToId must be a number or null" });
    const updated = await storage.markLearnEvidenced(id, outputEvidenceUrl, proofToId);
    if (!updated) return res.status(404).json({ error: "Learn item not found" });
    await storage.logActivity({ eventType: "completed", sourceType: "learn", sourceId: id, metadata: JSON.stringify({ evidenced: true, proofToId }) } as any);
    res.json(updated);
  });

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
  // P4.6a #3: marking the SUBMIT step done is a DETERMINISTIC submit signal —
  // it advances the job wishlist -> applied (derived from the step label, no fuzzy
  // task.doneWhen matching). Any other step done does NOT touch job status.
  app.patch("/api/steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const p = insertJobPipelineStepSchema.partial().omit({ jobId: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateJobStep(stepId, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (p.data.status === "done" && isSubmitStep(updated.stepLabel)) {
      const jb = (await storage.getJobs()).find((x) => x.id === updated.jobId);
      if (jb && jb.status === "wishlist") {
        await storage.updateJob(jb.id, { status: "applied", applicationReadiness: "submitted" } as any);
        await storage.logActivity({ eventType: "completed", sourceType: "job", sourceId: jb.id, metadata: JSON.stringify({ stepId, submitted: true }) } as any);
      }
    }
    res.json(updated);
  });

  // P4.6a #3: explicit "Mark application submitted" affordance on the job card —
  // the safest deterministic path to wishlist -> applied. Never fabricated.
  app.post("/api/jobs/:id/mark-submitted", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const job = (await storage.getJobs()).find((x) => x.id === id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status === "wishlist") {
      await storage.updateJob(id, { status: "applied", applicationReadiness: "submitted" } as any);
    }
    await storage.logActivity({ eventType: "completed", sourceType: "job", sourceId: id, metadata: JSON.stringify({ submitted: true, explicit: true }) } as any);
    const updated = (await storage.getJobs()).find((x) => x.id === id);
    res.json({ ok: true, job: updated });
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

  // ═══ P4.3: PROOF ASSET STEPS — a TASK-GENERATIVE proof-production rail over a ═══
  // proof asset (hustle). Steps are SEEDED from a kind-aware template (substack/
  // afterline/memo), then editable per asset. Each step does ONLY ONE of:
  // materialize-as-task (reuses 3.5 createNextTask provenance + dedupe, carrying
  // proofAssetForTrack as relatedTrackId), mark-done, or mark-blocked. Mirrors the
  // 4.1 job step API exactly; "blocked" is distinct from "skipped".
  app.get("/api/hustles/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    res.json(await storage.getProofAssetSteps(id));
  });

  // Seed from the kind-aware template — no-op if steps already exist.
  app.post("/api/hustles/:id/steps/seed", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const steps = await storage.seedProofAssetSteps(id);
    if (!steps.length) {
      const h = (await storage.getHustles()).find((x) => x.id === id);
      if (!h) return res.status(404).json({ error: "Proof asset not found" });
    }
    res.json(steps);
  });

  // Add a custom step.
  app.post("/api/hustles/:id/steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const stepLabel = String(req.body?.stepLabel || "").trim().slice(0, 120);
    if (!stepLabel) return res.status(400).json({ error: "Need a stepLabel" });
    const note = String(req.body?.note || "").slice(0, 300);
    const sequence = Number.isFinite(Number(req.body?.sequence)) ? Number(req.body.sequence) : undefined;
    res.json(await storage.createProofAssetStep(id, { stepLabel, note, sequence }));
  });

  // Edit label / status / note / sequence (one-action contract unchanged).
  app.patch("/api/proof-steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const p = insertProofAssetStepSchema.partial().omit({ hustleId: true }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const updated = await storage.updateProofAssetStep(stepId, p.data);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/proof-steps/:stepId", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    await storage.deleteProofAssetStep(stepId);
    res.json({ ok: true });
  });

  app.patch("/api/hustles/:id/steps/reorder", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const ordered = Array.isArray(req.body?.orderedStepIds) ? req.body.orderedStepIds.map(Number).filter(Number.isFinite) : null;
    if (!ordered) return res.status(400).json({ error: "Need orderedStepIds:number[]" });
    res.json(await storage.reorderProofAssetSteps(id, ordered));
  });

  // Materialize a proof step into a task via the existing provenance + dedupe
  // machinery. The task carries proofAssetForTrack (as relatedTrackId) from the
  // hustle branch of createNextTask. Records the resulting taskId; reuses an
  // open hustle task rather than duplicating.
  app.post("/api/proof-steps/:stepId/materialize", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getProofAssetStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const result = await materializeProofStep(step);
    if (!result) return res.status(404).json({ error: "Proof asset not found" });
    await storage.logActivity({ eventType: "planned", sourceType: "hustle", sourceId: step.hustleId, taskId: result.task.id, metadata: JSON.stringify({ stepId, reused: result.reused }) } as any);
    res.json({ ...result.task, reused: result.reused, stepId });
  });

  // mark-blocked: thin status + blocker note on the step. "blocked" is distinct
  // from "skipped". If the step already materialized a task, propagate
  // readiness="blocked" to that task (NOT a parallel state machine).
  app.post("/api/proof-steps/:stepId/block", async (req, res) => {
    const stepId = Number(req.params.stepId);
    if (!Number.isFinite(stepId)) return res.status(400).json({ error: "Bad id" });
    const step = await storage.getProofAssetStep(stepId);
    if (!step) return res.status(404).json({ error: "Step not found" });
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const updated = await storage.updateProofAssetStep(stepId, { status: "blocked", note: reason } as any);
    if (step.taskId) {
      await storage.updateTask(step.taskId, { readiness: "blocked", blockerReason: reason, status: "stuck" } as any);
    }
    await storage.logActivity({ eventType: "blocked", sourceType: "hustle", sourceId: step.hustleId, taskId: step.taskId ?? undefined, metadata: JSON.stringify({ stepId, reason }) } as any);
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

  // ═══ P4.5: EVIDENCE LAYER — read-only derived metrics over wins + activityLog ═══
  // Per-track diagnostics already carry compact per-track evidence (above); this
  // endpoint exposes the full per-track + untracked-bucket metrics. No write path.
  app.get("/api/strategy/evidence", async (_req, res) => res.json(await getEvidencePayload()));

  // ═══ P5: LEARNING STRATEGY — per-track capability gaps + deterministic sequencing ═══
  // Read-only. The gap engine (server/learningStrategy.ts) compares each track's
  // REQUIRED capability domains (data-driven from the track) against its EVIDENCED
  // domains and exposes the gap + a sequenced learning path (incl. unfilled-gap
  // slots where out-of-scope discovered resources later attach). No write path.
  app.get("/api/strategy/learning-gaps", async (_req, res) => res.json(await computeLearningGaps()));

  // Compact wins summary (by-category + window counts + streak + derived track per win).
  app.get("/api/wins/summary", async (_req, res) => res.json(await computeWinsSummary()));

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
