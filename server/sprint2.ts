import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, storage } from "./storage";
import { planDay } from "./brain";
import { dayPlans, dayPlanItems, type DayPlan } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 2 — Today becomes adaptive, especially mid-day restarts.
// This shadows the Sprint 1 plan routes with a current-time-aware planner. The
// key product fix: Anchor stops pretending a full day exists at 5pm.
// ─────────────────────────────────────────────────────────────────────────────

type Energy = "low" | "medium" | "high";
const WAKING_MINUTES = 10 * 60;

function coerceEnergy(raw: unknown): Energy {
  const s = String(raw || "medium");
  return s === "low" || s === "medium" || s === "high" ? s : "medium";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function parseClock(raw: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(raw || "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function dayStartMinute() {
  const h = Number(process.env.ANCHOR_DAY_START_HOUR || 8);
  return Number.isFinite(h) ? Math.max(0, Math.min(23, h)) * 60 : 8 * 60;
}

function nowMinuteOfDay() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

async function remainingBudgetFor(day: string, explicitAvailableMinutes?: number | null) {
  if (explicitAvailableMinutes != null && Number.isFinite(explicitAvailableMinutes)) {
    const remainingMinutes = clamp(Math.round(explicitAvailableMinutes), 15, WAKING_MINUTES);
    return {
      elapsedMinutes: WAKING_MINUTES - remainingMinutes,
      calendarRemainingMinutes: 0,
      busyEquivalentMinutes: WAKING_MINUTES - remainingMinutes,
      remainingMinutes,
      source: "explicit_available_minutes",
    };
  }

  const events = await storage.getEvents(day);
  const today = day === todayKey();
  const now = today ? nowMinuteOfDay() : dayStartMinute();
  const elapsedMinutes = today ? clamp(now - dayStartMinute(), 0, WAKING_MINUTES) : 0;

  let calendarRemainingMinutes = 0;
  for (const e of events) {
    const start = parseClock(e.start || "");
    const end = parseClock(e.end || "");
    if (start != null && end != null && end > start) {
      const effectiveStart = today ? Math.max(start, now) : start;
      const mins = end - effectiveStart;
      if (mins > 0 && mins < 12 * 60) calendarRemainingMinutes += mins;
    } else if (!today || now < 18 * 60) {
      // Untimed event: count it only if it could still affect the remaining day.
      calendarRemainingMinutes += 45;
    }
  }

  const busyEquivalentMinutes = clamp(elapsedMinutes + calendarRemainingMinutes, 0, WAKING_MINUTES);
  return {
    elapsedMinutes,
    calendarRemainingMinutes,
    busyEquivalentMinutes,
    remainingMinutes: WAKING_MINUTES - busyEquivalentMinutes,
    source: today ? "current_time_plus_remaining_calendar" : "calendar_only",
  };
}

async function buildAdaptivePlan(day: string, energy: Energy, opts: { availableMinutes?: number | null; restart?: boolean } = {}) {
  const [tasks, jobs, learn, hustles] = await Promise.all([
    storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(),
  ]);
  const budget = await remainingBudgetFor(day, opts.availableMinutes ?? null);
  const result = planDay(tasks, jobs, learn, hustles, energy, budget.busyEquivalentMinutes);
  const planMode = result.mode === "low" ? "low_energy" : result.mode;
  const note = opts.restart
    ? `Restart from here. ${result.note}`
    : result.note;

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
        note,
        createdAt: now,
        updatedAt: now,
      } as any).returning().get() as DayPlan;
    } else {
      current = tx.update(dayPlans).set({
        mode: planMode,
        energy,
        note,
        status: opts.restart ? "active" : current.status,
        enoughForToday: opts.restart ? false : current.enoughForToday,
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
  });

  const items = await storage.getPlanItems(plan.id);
  const events = await storage.getEvents(day);
  return { plan, items, events, budget, restart: !!opts.restart };
}

function readAvailableMinutes(raw: unknown) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function registerSprint2Routes(app: Express) {
  app.post("/api/plan/restart", async (req, res) => {
    const day = String(req.body?.day || todayKey());
    const energy = coerceEnergy(req.body?.energy);
    const availableMinutes = readAvailableMinutes(req.body?.availableMinutes);
    res.json(await buildAdaptivePlan(day, energy, { availableMinutes, restart: true }));
  });

  app.post("/api/plan/recompute", async (req, res) => {
    const day = String(req.body?.day || todayKey());
    const energy = coerceEnergy(req.body?.energy);
    const availableMinutes = readAvailableMinutes(req.body?.availableMinutes);
    res.json(await buildAdaptivePlan(day, energy, { availableMinutes, restart: false }));
  });

  // Dependency-safe read. If today's plan already exists, return it. If not, build
  // it with current-time awareness. Explicit restarts still use /api/plan/restart.
  app.get("/api/plan/current", async (req, res) => {
    const day = String(req.query.day || todayKey());
    const energy = coerceEnergy(req.query.energy);
    const plan = await storage.getPlanByDate(day);
    if (!plan) return res.json(await buildAdaptivePlan(day, energy));
    const items = await storage.getPlanItems(plan.id);
    const events = await storage.getEvents(day);
    const budget = await remainingBudgetFor(day, readAvailableMinutes(req.query.availableMinutes));
    res.json({ plan, items, events, budget, restart: false });
  });

  // Avoidance review is deterministic and non-destructive. It gives the UI a safe
  // way to respond to repeated park/move/skip patterns without guessing.
  app.get("/api/tasks/:id/avoidance-review", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const skipped = task.skipped || 0;
    const blocked = task.readiness === "blocked" || !!task.blockerReason;
    const deep = task.size === "deep";
    const pattern = blocked ? "blocked" : skipped >= 2 ? "avoided" : deep ? "large" : "normal";
    const recommendedAction = blocked ? "unblock"
      : skipped >= 2 ? "shrink_or_redefine"
      : deep ? "make_first_step"
      : "continue";
    res.json({
      taskId: task.id,
      pattern,
      recommendedAction,
      message: blocked ? "This is blocked, not a motivation problem. Name the missing input."
        : skipped >= 2 ? "This has slipped more than once. Shrink it, redefine it, or park it deliberately."
        : deep ? "This is big enough to need a first-step plan before starting."
        : "No avoidance pattern yet.",
      options: ["make_smaller", "park", "mark_blocked", "continue"],
    });
  });
}
