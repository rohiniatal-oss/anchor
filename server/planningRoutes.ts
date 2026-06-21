import type { Express } from "express";
import { llm, llmJSON, MODEL_LIGHT } from "./llm";
import { explainPersistedPlanItem, recommend, planDay } from "./brain";
import { createNextTask } from "./nextTask";
import { deterministicUnstickStep, prependStep } from "./planningFeedback";
import { buildDeterministicTaskBreakdown, normalizeExistingTaskBreakdown } from "./taskBreakdownRoutes";
import { completeRecommendationMilestone, setRecommendationMilestoneStatus } from "./recommendationMilestoneProgress";
import { storage } from "./storage";
import { insertEventSchema, type InsertActivityLog, type InsertDayPlanItem } from "@shared/schema";

type Energy = "low" | "medium" | "high";

function decoratePlanItems(items: any[]) {
  return items.map((item) => ({
    ...item,
    explanation: explainPersistedPlanItem(item),
  }));
}

async function buildShrinkContext(task: { id: number; title: string; sourceType?: string | null; sourceId?: number | null; doneWhen?: string | null; category?: string | null }) {
  const lines = [`Task: "${task.title}"`];
  if (task.doneWhen) lines.push(`Done when: ${task.doneWhen}`);
  if (task.sourceType && task.sourceId) {
    try {
      if (task.sourceType === "job") {
        const jobs = await storage.getJobs();
        const job = jobs.find((j) => j.id === task.sourceId);
        if (job) {
          lines.push(`Role: ${job.title}${job.company ? ` at ${job.company}` : ""}`);
          if (job.jdText) lines.push(`Key requirements: ${job.jdText.slice(0, 300)}`);
        }
      } else if (task.sourceType === "contact") {
        const contacts = await storage.getContacts();
        const contact = contacts.find((c) => c.id === task.sourceId);
        if (contact) {
          lines.push(`Contact: ${contact.name || contact.who}${contact.targetOrg ? ` at ${contact.targetOrg}` : ""}`);
          if (contact.why) lines.push(`Why they matter: ${contact.why}`);
        }
      } else if (task.sourceType === "learn") {
        const learn = await storage.getLearn();
        const item = learn.find((l) => l.id === task.sourceId);
        if (item) {
          lines.push(`Learning: ${item.title}`);
          if (item.capabilityBuilt) lines.push(`Builds: ${item.capabilityBuilt}`);
        }
      }
    } catch {}
  }
  return lines.join("\n");
}

function isStructuredTask(task: { sourceType?: string | null; category?: string | null }) {
  return ["job", "learn", "contact", "hustle", "goal"].includes(String(task.sourceType || ""))
    || ["job", "learning", "substack", "hustle", "afterline", "interview"].includes(String(task.category || ""));
}

function parseTaskSteps(raw: string) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.text === "string") : [];
  } catch {
    return [];
  }
}

export function categoryForPlanItem(item: {
  sourceType?: string | null;
  title?: string | null;
  whySelected?: string | null;
  doneWhen?: string | null;
}) {
  if (item.sourceType === "job") return "job";
  if (item.sourceType === "learn") return "learning";
  if (item.sourceType === "hustle") return "hustle";
  if (item.sourceType === "contact") return "admin";
  if (item.sourceType === "goal") {
    const text = `${item.title || ""} ${item.whySelected || ""} ${item.doneWhen || ""}`.toLowerCase();
    if (/contact|outreach|reach out|message|network/i.test(text)) return "admin";
    if (/learning focus|learning support|learn|learning/i.test(text)) return "learning";
    return "job";
  }
  return "admin";
}

async function saveStarterStep(task: any) {
  if (parseTaskSteps(task.steps || "[]").length > 0) return task;
  const step = deterministicUnstickStep(task);
  const steps = prependStep(task.steps || "[]", step);
  return await storage.updateTask(task.id, { steps } as any);
}

async function ensureExecutionReadyTask(task: any) {
  if (!task) return task;
  const repaired = await normalizeExistingTaskBreakdown(task as any);
  if (repaired.changed) {
    const updated = await storage.updateTask(task.id, {
      title: repaired.title,
      steps: repaired.steps,
      minimumOutcome: repaired.minimumOutcome,
    } as any);
    task = updated || { ...task, title: repaired.title, steps: repaired.steps, minimumOutcome: repaired.minimumOutcome };
  }
  if (parseTaskSteps(task.steps || "[]").length > 0) return task;

  if (isStructuredTask(task)) {
    try {
      const breakdown = await buildDeterministicTaskBreakdown(task as any);
      if (breakdown.steps.length) {
        const updated = await storage.updateTask(task.id, {
          steps: JSON.stringify(breakdown.steps),
          minimumOutcome: breakdown.workflowState.stageOutput || task.minimumOutcome,
        } as any);
        if (updated) return updated;
      }
    } catch {
      // Fall through to starter-step logic below.
    }
  }

  if (task.size === "deep") {
    return await saveStarterStep(task) || task;
  }
  return task;
}

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
  const [tasks, jobs, learn, hustles, contacts, tracks, jobContactLinks] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getCareerTracks(),
    storage.getAllJobContactLinks(),
  ]);
  const busy = await busyMinutesFor(day);
  const r = planDay(tasks, jobs, learn, hustles, energy, busy, contacts, tracks, new Map(), jobContactLinks);
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
      whySelected: pi.explanation.summary || pi.why,
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
    const [tasks, jobs, learn, hustles, contacts, tracks, jobContactLinks] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getAllJobContactLinks(),
    ]);
    const r = recommend(tasks, jobs, learn, hustles, energy, contacts, tracks, jobContactLinks);
    res.json(r);
  });

  app.post("/api/brain/plan", async (req, res) => {
    const energy = ["low", "medium", "high"].includes(req.body?.energy) ? req.body.energy : "medium";
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const [tasks, jobs, learn, hustles, contacts, tracks, events, jobContactLinks] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getEvents(day),
      storage.getAllJobContactLinks(),
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
    const r = planDay(tasks, jobs, learn, hustles, energy, busy, contacts, tracks, new Map(), jobContactLinks);
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
      return res.json({ ok: true, task: updated ? await ensureExecutionReadyTask(updated) : updated });
    }
    if (c.sourceId && (c.source === "job" || c.source === "learn" || c.source === "hustle" || c.source === "contact")) {
      const result = await createNextTask({ sourceType: c.source, sourceId: Number(c.sourceId) });
      if (result?.task) {
        const updated = await storage.updateTask(result.task.id, {
          list: "today",
          block: ["morning", "afternoon", "evening"].includes(c.block) ? c.block : "morning",
          pinned: req.body?.pin !== false,
          status: "in_progress",
        } as any);
        return res.json({ ok: true, task: updated ? await ensureExecutionReadyTask(updated) : updated });
      }
    }
    const block = ["morning", "afternoon", "evening"].includes(c.block) ? c.block : "morning";
    let created = await storage.createTask({
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
    created = await ensureExecutionReadyTask(created);
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
        const shrinkContext = await buildShrinkContext(task);
        const arr = await llmJSON<string[]>(
          "This task keeps slipping. Break it into 3-4 micro-steps. The first step must be under 2 minutes, immediately startable, and physical (open something, write one line, send one thing). " +
          "Each step should be specific to the actual task — never generic filler like 'do research' or 'think about it'. " +
          'Return ONLY a JSON array of strings.\n\n' + shrinkContext,
          { model: MODEL_LIGHT },
        ) || [];
        if (arr.length) {
          steps = JSON.stringify(arr.slice(0, 4).map((x) => ({ text: x, done: false })));
          autoShrunk = true;
        }
      } catch {
        // Fall through to deterministic shrinking below.
      }
      if (!autoShrunk) {
        try {
          const breakdown = await buildDeterministicTaskBreakdown(task as any);
          if (breakdown.steps.length) {
            steps = JSON.stringify(breakdown.steps);
            autoShrunk = true;
          }
        } catch {
          // Leave steps as-is if deterministic shrinking also fails.
        }
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
    res.json({ plan, items: decoratePlanItems(items), events });
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
        category: categoryForPlanItem(item),
        deadline: "",
        status: "in_progress",
        skipped: 0,
        doneWhen: item.doneWhen || "",
        sourceType: item.sourceType || "",
        sourceId: item.sourceId ?? undefined,
        planItemId: item.id,
      } as any);
    }
    task = await ensureExecutionReadyTask(task);

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
    res.json({ plan, items: decoratePlanItems(items) });
  });

  app.post("/api/tasks/:id/complete", async (req, res) => {
    const id = Number(req.params.id);
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    await storage.updateTask(id, { done: true, status: "done", pinned: false } as any);
    let completedMilestoneId: number | null = null;
    if (task.sourceStepType === "recommendation_milestone" && task.sourceStepId) {
      await completeRecommendationMilestone(task.sourceStepId);
      completedMilestoneId = task.sourceStepId;
    } else if (task.sourceType === "learn" && task.sourceId != null) {
      const learnItem = await storage.getLearnItem(task.sourceId).catch(() => undefined);
      if (learnItem?.sourceType === "recommendation" && learnItem.sourceId != null) {
        const milestones = await storage.getRecommendationMilestones(learnItem.sourceId);
        const active = milestones.find((m) => m.status === "active") || milestones.find((m) => m.status === "todo");
        if (active) { await completeRecommendationMilestone(active.id); completedMilestoneId = active.id; }
      }
    }
    const winCategory =
      task.category === "job" || task.category === "interview" ? "job_progress"
      : task.category === "learning" ? "learning"
      : task.category === "substack" || task.category === "hustle" || task.category === "afterline" ? "proof_asset"
      : task.sourceType === "contact" ? "network"
      : "admin";
    const win = await storage.createWin({ text: task.title, kind: "planned", winCategory, trackId: task.relatedTrackId ?? null, sourceEntityType: task.sourceType || "task", sourceEntityId: task.sourceId ?? task.id } as any);
    await storage.logActivity({ eventType: "completed", sourceType: task.sourceType || "task", sourceId: task.sourceId ?? undefined, taskId: id, planItemId: task.planItemId ?? undefined } as any);
    await syncPlanItem(day, task, { status: "completed", completedAt: Date.now() });
    await refreshDoneEnough(day);
    res.json({ ok: true, completedMilestoneId, winId: win?.id ?? null });
  });

  app.patch("/api/wins/:id", async (req, res) => {
    const id = Number(req.params.id);
    const takeaway = String(req.body?.takeaway || "").trim().slice(0, 500);
    if (!takeaway) return res.status(400).json({ error: "No takeaway" });
    const updated = await storage.updateWin(id, { takeaway } as any);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/block", async (req, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "Blocked").slice(0, 160);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    await storage.updateTask(id, { readiness: "blocked", blockerReason: reason, status: "stuck", pinned: false } as any);
    if (task.sourceStepType === "recommendation_milestone" && task.sourceStepId) {
      await setRecommendationMilestoneStatus(task.sourceStepId, "blocked");
    }
    await storage.logActivity({ eventType: "blocked", sourceType: "task", taskId: id, metadata: JSON.stringify({ reason }) } as any);
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/park", async (req, res) => {
    const id = Number(req.params.id);
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    await storage.updateTask(id, { list: "inbox", block: null, pinned: false, skipped: (task.skipped || 0) + 1 } as any);
    if (task.sourceStepType === "recommendation_milestone" && task.sourceStepId) {
      await setRecommendationMilestoneStatus(task.sourceStepId, "active");
    }
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
