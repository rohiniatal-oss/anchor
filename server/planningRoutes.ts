import type { Express } from "express";
import OpenAI from "openai";
import { recommend, planDay } from "./brain";
import { createNextTask } from "./nextTask";
import { storage } from "./storage";
import { insertEventSchema, type InsertActivityLog, type InsertDayPlanItem } from "@shared/schema";

type Energy = "low" | "medium" | "high";

async function busyMinutesFor(day: string): Promise<number> {
  const events = await storage.getEvents(day);
  let busy = 0;
  for (const e of events) {
    const m = /^(\d{1,2}):(\d{2})/.exec(e.start || "");
    const n = /^(\d{1,2}):(\d{2})/.exec(e.end || "");
    if (m && n) {
      const mins = (Number(n[1]) * 60 + Number(n[2])) - (Number(m[1]) * 60 + Number(m[2]));
      if (mins > 0 && mins < 12 * 60) busy += mins;
    } else {
      busy += 45;
    }
  }
  return busy;
}

async function buildPlan(day: string, energy: Energy) {
  const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getCareerTracks(),
  ]);
  const busy = await busyMinutesFor(day);
  const r = planDay(tasks, jobs, learn, hustles, energy, busy, contacts, tracks);
  let plan = await storage.getPlanByDate(day);
  const planMode = r.mode === "low" ? "low_energy" : r.mode;
  if (!plan) plan = await storage.createPlan({ date: day, mode: planMode, energy, status: "active", enoughForToday: false, note: r.note } as any);
  else plan = await storage.updatePlan(plan.id, { mode: planMode, energy, note: r.note } as any);
  const prevItems = await storage.getPlanItems(plan!.id);
  const actioned = new Map(prevItems.filter((i) => i.status !== "planned").map((i) => [`${i.sourceType}:${i.sourceId}`, i] as const));
  await storage.clearPlanItems(plan!.id);
  let mvdItemId: number | null = null;
  let seq = 0;
  for (const pi of r.plan) {
    const c = pi.candidate;
    const prev = actioned.get(`${c.source}:${c.sourceId}`);
    const item = await storage.createPlanItem({
      planId: plan!.id,
      sequence: seq++,
      slot: pi.slot,
      sourceType: c.source,
      sourceId: c.sourceId,
      taskId: c.taskId ?? undefined,
      title: c.title,
      whySelected: pi.why,
      doneWhen: c.doneWhen,
      status: prev ? prev.status : "planned",
      plannedFor: day,
      startedAt: prev?.startedAt ?? undefined,
      completedAt: prev?.completedAt ?? undefined,
    } as any);
    if (pi.isMVD) mvdItemId = item.id;
  }
  if (mvdItemId) await storage.updatePlan(plan!.id, { minimumViableItemId: mvdItemId } as any);
  return storage.getPlanByDate(day);
}

async function refreshDoneEnough(day: string) {
  const plan = await storage.getPlanByDate(day);
  if (!plan || !plan.minimumViableItemId) return;
  const items = await storage.getPlanItems(plan.id);
  const mvd = items.find((i) => i.id === plan.minimumViableItemId);
  if (mvd && mvd.status === "completed" && !plan.enoughForToday) {
    await storage.updatePlan(plan.id, { enoughForToday: true, status: "done_enough" } as any);
  }
}

async function syncPlanItem(day: string, task: { id: number; planItemId?: number | null }, patch: Partial<InsertDayPlanItem>) {
  const plan = await storage.getPlanByDate(day);
  if (!plan) return;
  const items = await storage.getPlanItems(plan.id);
  const it =
    (task.planItemId != null ? items.find((i) => i.id === task.planItemId) : undefined)
    || items.find((i) => i.taskId === task.id)
    || items.find((i) => i.sourceType === "task" && i.sourceId === task.id);
  if (it) await storage.updatePlanItem(it.id, patch);
}

export function registerPlanningRoutes(app: Express) {
  app.post("/api/brain/recommend", async (req, res) => {
    const energy = ["low", "medium", "high"].includes(req.body?.energy) ? req.body.energy : "medium";
    const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
    ]);
    const r = recommend(tasks, jobs, learn, hustles, energy, contacts, tracks);
    res.json(r);
  });

  app.post("/api/brain/plan", async (req, res) => {
    const energy = ["low", "medium", "high"].includes(req.body?.energy) ? req.body.energy : "medium";
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const [tasks, jobs, learn, hustles, contacts, tracks, events] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getEvents(day),
    ]);
    let busy = 0;
    for (const e of events) {
      const m = /^(\d{1,2}):(\d{2})/.exec(e.start || "");
      const n = /^(\d{1,2}):(\d{2})/.exec(e.end || "");
      if (m && n) {
        const mins = (Number(n[1]) * 60 + Number(n[2])) - (Number(m[1]) * 60 + Number(m[2]));
        if (mins > 0 && mins < 12 * 60) busy += mins;
      } else {
        busy += 45;
      }
    }
    const r = planDay(tasks, jobs, learn, hustles, energy, busy, contacts, tracks);
    res.json({ ...r, busyMinutes: busy, events });
  });

  app.post("/api/brain/accept", async (req, res) => {
    const c = req.body?.candidate;
    if (!c || !c.title) return res.status(400).json({ error: "Need candidate" });
    for (const t of await storage.getTasks()) {
      if (t.pinned) await storage.updateTask(t.id, { pinned: false });
    }
    if (c.source === "task") {
      const updated = await storage.updateTask(Number(c.sourceId), { pinned: true, status: "in_progress" });
      return res.json({ ok: true, task: updated });
    }
    const block = ["morning", "afternoon", "evening"].includes(c.block) ? c.block : "morning";
    const created = await storage.createTask({
      title: String(c.title),
      list: "today",
      block,
      done: false,
      pinned: req.body?.pin !== false,
      steps: "[]",
      sort: 0,
      category: c.category || "admin",
      deadline: c.deadline || "",
      size: c.size || "medium",
      status: "in_progress",
      skipped: 0,
      doneWhen: c.doneWhen || "",
      sourceType: c.source || "",
      sourceId: c.sourceId ?? undefined,
      sourceUrl: c.sourceUrl || "",
      sourceNote: c.sourceNote || "",
      sourceStatus: c.sourceStatus || "",
    } as any);
    res.json({ ok: true, task: created });
  });

  app.post("/api/tasks/:id/skip", async (req, res) => {
    const id = Number(req.params.id);
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const skipped = (task.skipped || 0) + 1;
    let steps = task.steps;
    let autoShrunk = false;
    if (skipped >= 2 && (!steps || steps === "[]")) {
      try {
        const client = new OpenAI();
        const out = await client.responses.create({
          model: "gpt_5_1",
          input: "Someone with ADHD keeps avoiding this task. Break it into 3-4 tiny steps, first one under 2 minutes and physical. " +
            'Return ONLY a JSON array of strings. Task: "' + task.title + '"',
        });
        let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
        let arr: string[] = [];
        try { arr = JSON.parse(text); } catch { arr = []; }
        if (arr.length) {
          steps = JSON.stringify(arr.slice(0, 4).map((x) => ({ text: x, done: false })));
          autoShrunk = true;
        }
      } catch {
        // Leave steps as-is if the helper call fails.
      }
    }
    const updated = await storage.updateTask(id, { skipped, steps, pinned: false, status: "not_started" });
    await syncPlanItem(day, task, { status: "skipped", skippedAt: Date.now() });
    const activity: InsertActivityLog = {
      eventType: "skipped",
      sourceType: task.sourceType || "task",
      sourceId: task.sourceId ?? undefined,
      taskId: id,
      planItemId: task.planItemId ?? undefined,
      metadata: JSON.stringify({ skipped, autoShrunk }),
    };
    await storage.logActivity(activity);
    res.json(updated);
  });

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
          await storage.updateTask(c.id, { pinned: true });
          pinned = true;
        }
      }
    }
    res.json({ ok: true });
  });

  app.get("/api/plan/current", async (req, res) => {
    const day = String(req.query.day || new Date().toISOString().slice(0, 10));
    const energy = ["low", "medium", "high"].includes(String(req.query.energy)) ? String(req.query.energy) as Energy : "medium";
    let plan = await storage.getPlanByDate(day);
    if (!plan) await buildPlan(day, energy);
    plan = await storage.getPlanByDate(day);
    const items = plan ? await storage.getPlanItems(plan.id) : [];
    const events = await storage.getEvents(day);
    res.json({ plan, items, events });
  });

  const SLOT_TO_BLOCK: Record<string, string> = { now: "morning", next: "afternoon", later: "evening", bonus: "evening" };

  app.post("/api/plan-items/:id/start", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const item = await storage.getPlanItem(id);
    if (!item) return res.status(404).json({ error: "Plan item not found" });
    const day = String(req.body?.day || item.plannedFor || new Date().toISOString().slice(0, 10));
    const block = item.slot && SLOT_TO_BLOCK[item.slot] ? SLOT_TO_BLOCK[item.slot] : null;

    let task = item.taskId ? (await storage.getTasks()).find((t) => t.id === item.taskId) : undefined;
    if (!task && item.sourceType === "task" && item.sourceId) {
      task = (await storage.getTasks()).find((t) => t.id === item.sourceId);
    }
    if (!task && item.sourceId && (item.sourceType === "job" || item.sourceType === "learn" || item.sourceType === "hustle" || item.sourceType === "contact")) {
      const result = await createNextTask({ sourceType: item.sourceType, sourceId: item.sourceId });
      if (result) task = result.task;
    }

    for (const t of await storage.getTasks()) {
      if (t.pinned && t.id !== task?.id) await storage.updateTask(t.id, { pinned: false });
    }

    const preserve: any = {
      list: "today",
      pinned: true,
      status: "in_progress",
      block,
      planItemId: item.id,
      doneWhen: item.doneWhen || task?.doneWhen || "",
      sourceType: item.sourceType || task?.sourceType || "",
      sourceId: item.sourceId ?? task?.sourceId ?? undefined,
    };
    if (task) {
      task = await storage.updateTask(task.id, preserve);
    } else {
      task = await storage.createTask({
        title: item.title,
        list: "today",
        block,
        done: false,
        pinned: true,
        steps: "[]",
        sort: 0,
        category: item.sourceType === "job" ? "job" : item.sourceType === "learn" ? "learning" : item.sourceType === "hustle" ? "hustle" : "admin",
        deadline: "",
        status: "in_progress",
        skipped: 0,
        doneWhen: item.doneWhen || "",
        sourceType: item.sourceType || "",
        sourceId: item.sourceId ?? undefined,
        planItemId: item.id,
      } as any);
    }

    await storage.updatePlanItem(item.id, { taskId: task!.id, status: "started", startedAt: Date.now() } as any);
    await storage.logActivity({ eventType: "started", sourceType: item.sourceType || "task", sourceId: item.sourceId ?? undefined, taskId: task!.id, planItemId: item.id } as any);
    res.json({ ok: true, task });
  });

  app.post("/api/plan/recompute", async (req, res) => {
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const energy = ["low", "medium", "high"].includes(req.body?.energy) ? req.body.energy : "medium";
    await buildPlan(day, energy);
    const plan = await storage.getPlanByDate(day);
    const items = plan ? await storage.getPlanItems(plan.id) : [];
    res.json({ plan, items });
  });

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
    await storage.createWin({ text: task.title, kind: "planned", winCategory, trackId: task.relatedTrackId ?? null } as any);
    await storage.logActivity({ eventType: "completed", sourceType: task.sourceType || "task", sourceId: task.sourceId ?? undefined, taskId: id, planItemId: task.planItemId ?? undefined } as any);
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

  app.get("/api/events", async (req, res) => res.json(await storage.getEvents(String(req.query.day || ""))));
  app.put("/api/events", async (req, res) => {
    const day = String(req.body?.day || "");
    const p = insertEventSchema.array().safeParse(req.body?.events || []);
    if (!day || !p.success) return res.status(400).json({ error: "Need day + events" });
    await storage.replaceEventsForDay(day, p.data);
    res.json({ ok: true });
  });
}
