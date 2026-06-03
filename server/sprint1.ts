import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, storage } from "./storage";
import { planDay } from "./brain";
import { classifyCapture, routeCapture, type CaptureRoute } from "./capture";
import {
  dayPlans,
  dayPlanItems,
  insertTaskSchema,
  insertWinSchema,
  type Task,
  type DayPlan,
} from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 1 — execution-spine hardening.
// These routes are registered BEFORE the legacy app routes, so they safely shadow
// older endpoints without deleting the old code yet. The goal is one coherent path:
// capture → route → plan → start → complete → win/activity/evidence.
// ─────────────────────────────────────────────────────────────────────────────

type Energy = "low" | "medium" | "high";

function coerceEnergy(raw: unknown): Energy {
  const s = String(raw || "medium");
  return s === "low" || s === "medium" || s === "high" ? s : "medium";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isCompletionPatch(patch: Partial<Task>) {
  return patch.done === true || patch.status === "done";
}

function winCategoryFor(task: Task) {
  return task.category === "job" || task.category === "interview" ? "job_progress"
    : task.category === "learning" ? "learning"
    : task.category === "substack" || task.category === "hustle" || task.category === "afterline" ? "proof_asset"
    : task.sourceType === "contact" ? "network"
    : "admin";
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

async function syncPlanItem(day: string, task: Task, patch: any) {
  const plan = await storage.getPlanByDate(day);
  if (!plan) return;
  const items = await storage.getPlanItems(plan.id);
  const item =
    (task.planItemId != null ? items.find((i) => i.id === task.planItemId) : undefined)
    || items.find((i) => i.taskId === task.id)
    || items.find((i) => i.sourceType === "task" && i.sourceId === task.id);
  if (item) await storage.updatePlanItem(item.id, patch);
}

async function completeTask(task: Task, day: string, extraPatch: Partial<Task> = {}) {
  const completedAt = Date.now();
  const updated = await storage.updateTask(task.id, {
    ...extraPatch,
    done: true,
    status: "done",
    pinned: false,
  } as any);

  await storage.createWin({
    text: task.title,
    kind: "planned",
    winCategory: winCategoryFor(task),
    trackId: task.relatedTrackId ?? null,
  } as any);
  await storage.logActivity({
    eventType: "completed",
    sourceType: task.sourceType || "task",
    sourceId: task.sourceId ?? undefined,
    taskId: task.id,
    planItemId: task.planItemId ?? undefined,
  } as any);
  await syncPlanItem(day, task, { status: "completed", completedAt });
  await refreshDoneEnough(day);
  return updated;
}

async function busyMinutesFor(day: string) {
  const events = await storage.getEvents(day);
  let busy = 0;
  for (const e of events) {
    const start = /^(\d{1,2}):(\d{2})/.exec(e.start || "");
    const end = /^(\d{1,2}):(\d{2})/.exec(e.end || "");
    if (start && end) {
      const mins = (Number(end[1]) * 60 + Number(end[2])) - (Number(start[1]) * 60 + Number(start[2]));
      if (mins > 0 && mins < 12 * 60) busy += mins;
    } else {
      busy += 45;
    }
  }
  return busy;
}

async function buildPlanTransactional(day: string, energy: Energy) {
  const [tasks, jobs, learn, hustles] = await Promise.all([
    storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(),
  ]);
  const busy = await busyMinutesFor(day);
  const result = planDay(tasks, jobs, learn, hustles, energy, busy);
  const planMode = result.mode === "low" ? "low_energy" : result.mode;

  const plan = db.transaction((tx) => {
    const now = Date.now();
    let current = tx.select().from(dayPlans).where(eq(dayPlans.date, day)).get() as DayPlan | undefined;
    if (!current) {
      current = tx.insert(dayPlans).values({
        date: day,
        mode: planMode,
        energy,
        status: "active",
        enoughForToday: false,
        note: result.note,
        createdAt: now,
        updatedAt: now,
      } as any).returning().get() as DayPlan;
    } else {
      current = tx.update(dayPlans).set({
        mode: planMode,
        energy,
        note: result.note,
        updatedAt: now,
      } as any).where(eq(dayPlans.id, current.id)).returning().get() as DayPlan;
    }

    const previous = tx.select().from(dayPlanItems).where(eq(dayPlanItems.planId, current.id)).all();
    const actioned = new Map(previous
      .filter((i) => i.status !== "planned")
      .map((i) => [`${i.sourceType}:${i.sourceId}`, i] as const));

    tx.delete(dayPlanItems).where(eq(dayPlanItems.planId, current.id)).run();

    let minimumViableItemId: number | null = null;
    let sequence = 0;
    for (const item of result.plan) {
      const c = item.candidate;
      const previousAction = actioned.get(`${c.source}:${c.sourceId}`);
      const created = tx.insert(dayPlanItems).values({
        planId: current.id,
        sequence: sequence++,
        slot: item.slot,
        sourceType: c.source,
        sourceId: c.sourceId,
        taskId: c.taskId ?? null,
        title: c.title,
        whySelected: item.why,
        doneWhen: c.doneWhen,
        status: previousAction ? previousAction.status : "planned",
        plannedFor: day,
        startedAt: previousAction?.startedAt ?? null,
        completedAt: previousAction?.completedAt ?? null,
        skippedAt: previousAction?.skippedAt ?? null,
        movedAt: previousAction?.movedAt ?? null,
        parkedAt: previousAction?.parkedAt ?? null,
        createdAt: now,
      } as any).returning().get();
      if (item.isMVD) minimumViableItemId = created.id;
    }

    current = tx.update(dayPlans).set({
      minimumViableItemId,
      updatedAt: Date.now(),
    } as any).where(eq(dayPlans.id, current.id)).returning().get() as DayPlan;
    return current;
  })();

  const items = await storage.getPlanItems(plan.id);
  const events = await storage.getEvents(day);
  return { plan, items, events, busyMinutes: busy };
}

function legacyTriageShape(id: number, title: string) {
  const s = classifyCapture(id, title);
  if (s.route === "keep") {
    return { id, kind: "clutter", parentType: "", parentId: null, parentLabel: "", reason: s.reason };
  }
  if (s.route === "learn") {
    return { id, kind: "subtask", parentType: "learn", parentId: -1, parentLabel: "Learn", reason: s.reason };
  }
  if (s.route === "network") {
    return { id, kind: "subtask", parentType: "contact", parentId: -1, parentLabel: "Network", reason: s.reason };
  }
  if (s.route === "proof") {
    return { id, kind: "note_idea", parentType: "", parentId: null, parentLabel: "", reason: s.reason };
  }
  if (s.route === "job") {
    return { id, kind: "new_project", parentType: "", parentId: null, parentLabel: "", reason: s.reason };
  }
  return { id, kind: "standalone_task", parentType: "", parentId: null, parentLabel: "", reason: s.reason };
}

function routeForLegacyAction(action: string, task: Task, body: any): CaptureRoute {
  if (action === "do_today") return "today";
  if (action === "file_substack") return "proof";
  if (action === "file_learn") return "learn";
  if (action === "make_role") return "job";
  if (action === "keep") return "keep";
  if (action === "attach_subtask") {
    const parentType = String(body?.parentType || "");
    if (parentType === "learn") return "learn";
    if (parentType === "contact" || parentType === "network") return "network";
    if (parentType === "hustle") return "proof";
  }
  return classifyCapture(task.id, task.title).route;
}

export function registerSprint1Routes(app: Express) {
  // Compatibility for the current React query key ["/api/events", day], which
  // fetches /api/events/YYYY-MM-DD while the legacy backend expects ?day=.
  app.get("/api/events/:day", async (req, res) => {
    res.json(await storage.getEvents(String(req.params.day || "")));
  });

  // Transactional persisted-plan routes. These shadow the older recompute/current
  // handlers so clearing + recreating plan items cannot leave a half-built plan.
  app.get("/api/plan/current", async (req, res) => {
    const day = String(req.query.day || todayKey());
    const energy = coerceEnergy(req.query.energy);
    let plan = await storage.getPlanByDate(day);
    if (!plan) return res.json(await buildPlanTransactional(day, energy));
    const items = await storage.getPlanItems(plan.id);
    const events = await storage.getEvents(day);
    res.json({ plan, items, events });
  });

  app.post("/api/plan/recompute", async (req, res) => {
    const day = String(req.body?.day || todayKey());
    const energy = coerceEnergy(req.body?.energy);
    res.json(await buildPlanTransactional(day, energy));
  });

  // Completion-aware PATCH. This preserves existing PATCH semantics for normal
  // edits, but any direct done/status=done patch is routed through the same spine
  // as /api/tasks/:id/complete: task, plan item, activity log, win, MVD.
  app.patch("/api/tasks/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const parsed = insertTaskSchema.partial().safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    if (isCompletionPatch(parsed.data as Partial<Task>) && !task.done && task.status !== "done") {
      const day = String((req.body as any)?.day || todayKey());
      return res.json(await completeTask(task, day, parsed.data as Partial<Task>));
    }
    const updated = await storage.updateTask(id, parsed.data);
    res.json(updated);
  });

  // Win de-dupe guard for the legacy MiniTaskRow path: after the completion-aware
  // PATCH logs a win, the old UI still posts /api/wins. Return the just-created
  // win instead of creating a duplicate.
  app.post("/api/wins", async (req, res) => {
    const parsed = insertWinSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const text = String(parsed.data.text || "").trim();
    const recent = (await storage.getWins()).find((w) =>
      w.text === text && Date.now() - w.createdAt < 30_000
    );
    if (recent) return res.json({ ...recent, reused: true });
    res.json(await storage.createWin(parsed.data));
  });

  // Legacy Brain Dump UI bridge. The visible UI can keep calling /api/braindump/*,
  // but the routing decision now delegates to the deterministic capture contract.
  app.post("/api/braindump/:id/triage", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    res.json(legacyTriageShape(id, task.title));
  });

  app.post("/api/braindump/:id/apply", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });

    // Preserve true subtasks under existing parents; synthetic parentId -1 is the
    // compatibility bridge used to route Learn/Network in the old UI.
    if (String(req.body?.action || "") === "attach_subtask" && Number(req.body?.parentId) > 0) {
      const parentType = String(req.body?.parentType || "");
      const parentId = Number(req.body?.parentId);
      await storage.updateTask(id, {
        list: "inbox",
        sourceType: parentType,
        sourceId: parentId,
        relatedOpportunityId: parentType === "job" ? parentId : undefined,
      } as any);
      return res.json({ ok: true, result: "attached" });
    }

    const route = routeForLegacyAction(String(req.body?.action || ""), task, req.body);
    const result = await routeCapture(id, route);
    res.status(result.status).json({ ok: result.status < 400, result: (result.body as any).moved, ...(result.body as any) });
  });
}
