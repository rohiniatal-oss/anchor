import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, storage } from "./storage";
import { explainPersistedPlanItem, planDay } from "./brain";
import { dayPlans, dayPlanItems, insertTaskSchema, type DayPlan, type Task, type CareerTrack } from "@shared/schema";
import { isOpportunityActionable } from "@shared/domainState";
import { applyPlanningFeedback, buildPlanningMemory, deterministicUnstickStep, feedbackSummary, prependStep, previousDayKey, refinedEstimateFromSteps, stepsWithEstimatedMinutes } from "./planningFeedback";
import {
  broadPursuitMissingRolesPlanSummary,
  broadPursuitMissingRolesPlanWhy,
  broadPursuitMissingRolesPlannerNote,
  broadPursuitMissingRolesSupportingReasons,
} from "./broadPursuitCopy";
import { deriveBroadPursuitCoverage, deriveCareerGoalFrame } from "./goalState";
import { buildDeterministicTaskBreakdown } from "./taskBreakdownRoutes";
import { buildTaskIntakeDefaults, contextualizeTask, intakeWords, llmEnrichTask } from "./taskIntakeInference";
import { getDueCurriculumAnchors, linkDayToPlanItem } from "./curriculum/repository";
import { ensurePathwayRoleDiscoveryTasks } from "./pathwayRoleDiscovery";

// Plan-item sourceType for an injected curriculum day (the daily anchor).
const CURRICULUM_DAY_SOURCE = "curriculum_day";

// Build the "now"-slot anchor items for any curriculum days that are due today.
// Each due active curriculum contributes one item; they outrank synthesised
// coverage prompts, which get demoted from "now" to "next".
function curriculumAnchorItems(day: string) {
  return getDueCurriculumAnchors(day).map((a) => ({
    slot: "now",
    isMVD: false,
    why: `Today's anchor from your ${a.theme} curriculum`,
    explanation: {
      summary: `Today's anchor from your ${a.theme} curriculum`,
      whyNow: `This is day ${a.dayNumber} of ${a.totalDays} of your ${a.theme} curriculum.`,
      whyThis: `It is the next scheduled day in your ${a.theme} curriculum.`,
      supportingReasons: [] as string[],
      firstStep: a.day.activity,
      stopRule: a.day.doneWhen,
    },
    candidate: {
      source: CURRICULUM_DAY_SOURCE,
      sourceId: a.day.id,
      taskId: null,
      title: a.day.title,
      doneWhen: a.day.doneWhen,
      sourceNote: "",
      sourceStatus: "",
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 2+ — Today becomes adaptive, especially mid-day restarts, and now uses
// behavioural feedback so repeated skips, missed MVDs, and blocked items change
// the next plan rather than resurfacing unchanged.
//
// Sprint 5A adds lightweight task-intake inference. Estimates are deliberately
// rough: intake_guess + low confidence. Breakdown and actuals can refine later.
// Sprint 5B lets task breakdown refine the estimate from step-level estimates.
// Sprint 6 keeps Today behaviour-first for ADHD execution: fewer items, smaller
// starts, no deep task without a first step.
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

async function planningMemoryFor(day: string) {
  const yesterday = previousDayKey(day);
  const yesterdayPlan = yesterday ? await storage.getPlanByDate(yesterday) : undefined;
  const yesterdayItems = yesterdayPlan ? await storage.getPlanItems(yesterdayPlan.id) : [];
  const activity = await storage.getActivityLog();
  return buildPlanningMemory({
    day,
    yesterdayItems,
    yesterdayMinimumViableItemId: yesterdayPlan?.minimumViableItemId ?? null,
    activity,
  });
}

function parseTaskSteps(raw: string) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.text === "string").map((s) => ({ text: String(s.text), done: !!s.done })) : [];
  } catch { return []; }
}

async function saveStarterStep(task: Task) {
  if (parseTaskSteps(task.steps || "[]").length > 0) return null;
  const step = deterministicUnstickStep(task);
  const steps = prependStep(task.steps || "[]", step);
  const updated = await storage.updateTask(task.id, { steps } as any);
  await storage.logActivity({
    eventType: "starter_step_created",
    sourceType: task.sourceType || "task",
    sourceId: task.sourceId ?? undefined,
    taskId: task.id,
    planItemId: task.planItemId ?? undefined,
    metadata: JSON.stringify({ step }),
  } as any);
  return updated;
}

function needsExecutionPlan(task: Task) {
  const title = `${task.title || ""} ${task.doneWhen || ""}`.toLowerCase();
  if (task.done || parseTaskSteps(task.steps || "[]").length > 0) return false;
  if (task.size === "deep") return true;
  if (["job", "learn", "contact", "hustle"].includes(String(task.sourceType || ""))) return true;
  if ((task.skipped || 0) >= 1) return true;
  return /(?:^|\b)(write|draft|rewrite|research|prepare|apply|decide|figure out|plan|outline|review|tailor|build)\b/.test(title);
}

async function saveExecutionReadySteps(task: Task) {
  if (!needsExecutionPlan(task)) return task;
  if (["job", "learn", "contact", "hustle"].includes(String(task.sourceType || ""))) {
    try {
      const breakdown = await buildDeterministicTaskBreakdown(task);
      if (breakdown.steps.length) {
        const updated = await storage.updateTask(task.id, {
          steps: JSON.stringify(breakdown.steps),
          minimumOutcome: breakdown.workflowState.stageOutput || task.minimumOutcome,
        } as any);
        if (updated) {
          await storage.logActivity({
            eventType: "starter_step_created",
            sourceType: task.sourceType || "task",
            sourceId: task.sourceId ?? undefined,
            taskId: task.id,
            planItemId: task.planItemId ?? undefined,
            metadata: JSON.stringify({ step: breakdown.steps[0]?.text || "", deterministicBreakdown: true }),
          } as any);
          return updated;
        }
      }
    } catch {
      // Fall through to the simpler starter-step fallback.
    }
  }
  return await saveStarterStep(task) || task;
}

function shrinkReason(task: Task) {
  if ((task.skipped || 0) >= 1) return "This kept slipping, so it was made smaller before it stalled again.";
  if (["job", "learn", "contact", "hustle"].includes(String(task.sourceType || ""))) {
    return "This had enough context to split into easier steps.";
  }
  if (task.size === "deep") return "This was a bit big, so it got a smaller starting step.";
  return "This looked heavy, so it was made smaller to start more easily.";
}

function itemWasPreShrunk(item: any, task: Task | undefined, preShrunkTaskIds: Set<number>) {
  if (!task || task.done) return false;
  return preShrunkTaskIds.has(task.id) && item?.candidate?.taskId === task.id;
}

function estimateForPlanItem(item: any, task: Task | undefined) {
  if (task?.estimateMinutes && task.estimateMinutes > 0) return task.estimateMinutes;
  if (item?.candidate?.size === "quick") return 15;
  if (item?.candidate?.size === "deep") return 90;
  return 45;
}

function fitPlanToRemainingTime(plan: any[], tasks: Task[], remainingMinutes: number) {
  if (plan.length <= 1) return plan;
  if (!Number.isFinite(remainingMinutes) || remainingMinutes <= 0) return plan.slice(0, 1);

  const byId = new Map(tasks.map((t) => [t.id, t]));
  let used = 0;
  const kept: any[] = [];
  for (const item of plan) {
    const task = item.candidate?.taskId ? byId.get(item.candidate.taskId) : undefined;
    const estimate = estimateForPlanItem(item, task);
    if (kept.length === 0 || used + estimate <= remainingMinutes) {
      kept.push(item);
      used += estimate;
    }
  }
  return kept.length ? kept : plan.slice(0, 1);
}

async function selfCorrectPlanItems(plan: any[], tasks: Task[], remainingMinutes: number) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preShrunkTaskIds = new Set<number>();
  for (const item of plan) {
    const task = item.candidate?.taskId ? byId.get(item.candidate.taskId) : undefined;
    if (task && !task.done && parseTaskSteps(task.steps || "[]").length === 0) {
      const updated = await saveExecutionReadySteps(task);
      if (updated) {
        byId.set(updated.id, updated);
        if (parseTaskSteps(updated.steps || "[]").length > 0) preShrunkTaskIds.add(updated.id);
      }
    }
  }
  const fitted = fitPlanToRemainingTime(plan, tasks, remainingMinutes);
  const corrected = fitted.map((item) => {
    const task = item.candidate?.taskId ? byId.get(item.candidate.taskId) : undefined;
    if (!itemWasPreShrunk(item, task, preShrunkTaskIds)) return item;
    const reason = shrinkReason(task!);
    return {
      ...item,
      why: `${item.why} ${reason}`.trim(),
      explanation: {
        ...item.explanation,
        summary: `${item.explanation.summary} This was made smaller so starting is easier.`,
        whyNow: reason,
        supportingReasons: [reason, ...(item.explanation.supportingReasons || [])].slice(0, 4),
      },
    };
  });
  // Report whether time pressure actually dropped anything, so the note layer
  // can explain a cut-down day without guessing from length comparisons.
  return { plan: corrected, trimmed: fitted.length < plan.length };
}

async function buildAdaptivePlan(day: string, energy: Energy, opts: { availableMinutes?: number | null; restart?: boolean } = {}) {
  const [initialTasks, jobs, learn, hustles, contacts, tracks, jobContactLinks] = await Promise.all([
    storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(), storage.getCareerTracks(), storage.getAllJobContactLinks(),
  ]);
  const tasks = await ensurePathwayRoleDiscoveryTasks({ tasks: initialTasks, jobs, tracks });
  const budget = await remainingBudgetFor(day, opts.availableMinutes ?? null);
  const memory = await planningMemoryFor(day);
  const goalFrame = deriveCareerGoalFrame(tasks, jobs, [], learn, contacts, hustles, tracks);
  const broadPursuitCoverage = deriveBroadPursuitCoverage(tasks, jobs, [], learn, contacts, hustles, tracks);
  const broadPursuitNeedsRealRoles = goalFrame.decisionMode === "broad-parallel-pursuit" && broadPursuitCoverage.missing.length > 0;
  const missingCombinationText = broadPursuitCoverage.missing.join("; ");
  const result = planDay(tasks, jobs, learn, hustles, energy, { remainingMinutes: budget.remainingMinutes }, contacts, tracks, new Map(), jobContactLinks);
  const feedbackPlan = applyPlanningFeedback(result.plan, memory, tasks);
  const corrected = await selfCorrectPlanItems(feedbackPlan, tasks, budget.remainingMinutes);
  const correctedPlan = broadPursuitNeedsRealRoles
    ? corrected.plan.map((item, index) => {
        if (item.candidate.source !== "goal") return item;
        return {
          ...item,
          why: broadPursuitMissingRolesPlanWhy(broadPursuitCoverage.missing),
          explanation: {
            ...item.explanation,
            summary: broadPursuitMissingRolesPlanSummary(),
            whyNow: "You said to apply across several plausible directions in parallel, and some of those path combinations still have no saved role at all.",
            whyThis: index === 0
              ? "It beats narrower comparison work because the market can only separate the lanes once real roles are in the pipeline."
              : item.explanation.whyThis,
            supportingReasons: broadPursuitMissingRolesSupportingReasons(broadPursuitCoverage.missing),
          },
        };
      })
    : corrected.plan;
  const planMode = result.mode === "low" ? "low_energy" : result.mode;
  const feedbackNote = feedbackSummary(memory);
  // Surface the cut-down note whenever time pressure shrank the day below the
  // actionable load — either the time-fit step dropped an item, OR the brain
  // itself capped the plan smaller than the number of live today-tasks because
  // the available time was tight. Both mean: today got trimmed to fit.
  const actionableToday = tasks.filter((t) => t.list === "today" && !t.done).length;
  const trimmedForTime = corrected.trimmed || (correctedPlan.length < actionableToday && budget.remainingMinutes > 0 && budget.remainingMinutes < 120);
  const overloadNote = trimmedForTime ? "Today was cut down to what can realistically fit." : "";
  const plannerNote = broadPursuitNeedsRealRoles
    ? broadPursuitMissingRolesPlannerNote(broadPursuitCoverage.missing)
    : result.note;
  const note = [opts.restart ? "Restart from here." : "", feedbackNote, overloadNote, plannerNote].filter(Boolean).join(" ");

  // Inject due curriculum days as the day's anchors. They sit ahead of the
  // synthesised coverage prompts (demoted from "now" to "next") so the curriculum
  // drives Today. Users with no active curriculum see the plan unchanged.
  const anchorItems = curriculumAnchorItems(day);
  const finalPlan = anchorItems.length
    ? [...anchorItems, ...correctedPlan.map((it) => (it.slot === "now" ? { ...it, slot: "next" } : it))]
    : correctedPlan;
  const curriculumLinks: { dayId: number; planItemId: number }[] = [];

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
    for (const item of finalPlan) {
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
        whySelected: item.explanation?.summary || item.why,
        doneWhen: c.doneWhen,
        sourceNote: c.sourceNote || "",
        sourceStatus: c.sourceStatus || "",
        status: previousAction ? previousAction.status : "planned",
        plannedFor: day,
        startedAt: previousAction?.startedAt ?? null,
        completedAt: previousAction?.completedAt ?? null,
        skippedAt: previousAction?.skippedAt ?? null,
        movedAt: previousAction?.movedAt ?? null,
        parkedAt: previousAction?.parkedAt ?? null,
        createdAt: now,
      } as any).returning().get();
      if (item.isMVD || sequence === 1) minimumViableItemId = created.id;
      if (c.source === CURRICULUM_DAY_SOURCE && c.sourceId != null) {
        curriculumLinks.push({ dayId: c.sourceId, planItemId: created.id });
      }
    }

    current = tx.update(dayPlans).set({
      minimumViableItemId,
      updatedAt: Date.now(),
    } as any).where(eq(dayPlans.id, current.id)).returning().get() as DayPlan;
    return current;
  });

  // Bidirectional link: record which day_plan_item each curriculum day produced.
  for (const link of curriculumLinks) linkDayToPlanItem(link.dayId, link.planItemId);

  const items = (await storage.getPlanItems(plan.id)).map((item) => ({
    ...item,
    explanation: explainPersistedPlanItem(item),
  }));
  const events = await storage.getEvents(day);
  return { plan, items, events, budget, memory: { yesterday: memory.yesterday, missedMvd: !!memory.missedMvdKey, skipped: memory.skippedKeys.size, parked: memory.parkedKeys.size }, restart: !!opts.restart };
}

async function shouldRefreshBroadPursuitPlan(items: Array<{ sourceType?: string | null; title?: string | null; whySelected?: string | null }>) {
  const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getCareerTracks(),
  ]);
  const goalFrame = deriveCareerGoalFrame(tasks, jobs, [], learn, contacts, hustles, tracks);
  if (goalFrame.decisionMode !== "broad-parallel-pursuit") return false;
  const broadPursuitCoverage = deriveBroadPursuitCoverage(tasks, jobs, [], learn, contacts, hustles, tracks);
  if (broadPursuitCoverage.missing.length === 0) return false;
  const goalItem = items.find((item) => item.sourceType === "goal");
  if (!goalItem) return true;
  const oldCopy = `${goalItem.title || ""} ${goalItem.whySelected || ""}`;
  return /plausible lane that still looks real|plausible role type that still looks real|still-empty combination/i.test(oldCopy);
}

function readAvailableMinutes(raw: unknown) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function findTaskForUnstick(tasks: Task[], stepText: string) {
  const pinned = tasks.find((t) => t.pinned && !t.done);
  if (pinned) return pinned;
  const needle = stepText.trim().toLowerCase();
  if (!needle) return tasks.find((t) => t.list === "today" && !t.done && t.status === "in_progress") || null;
  return tasks.find((t) => !t.done && parseTaskSteps(t.steps).some((s) => !s.done && s.text.trim().toLowerCase() === needle))
    || tasks.find((t) => t.list === "today" && !t.done && t.status === "in_progress")
    || null;
}

async function saveUnstickStep(task: Task, step: string) {
  const steps = prependStep(task.steps || "[]", step);
  const updated = await storage.updateTask(task.id, { steps, status: "in_progress" } as any);
  await storage.logActivity({
    eventType: "unstick_used",
    sourceType: task.sourceType || "task",
    sourceId: task.sourceId ?? undefined,
    taskId: task.id,
    planItemId: task.planItemId ?? undefined,
    metadata: JSON.stringify({ step }),
  } as any);
  return updated;
}

function inferTrackId(title: string, tracks: CareerTrack[]) {
  const tokens = intakeWords(title);
  let best: { id: number; score: number } | null = null;
  for (const track of tracks.filter((t) => t.status === "active")) {
    const hay = `${track.slug} ${track.name} ${track.description} ${track.targetRoleArchetype}`.toLowerCase();
    const score = tokens.filter((token) => hay.includes(token)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: track.id, score };
  }
  return best?.id ?? undefined;
}

export async function enrichTaskInput(raw: any) {
  const inferred = buildTaskIntakeDefaults(raw || {});
  const relatedTrackId = raw?.relatedTrackId ?? inferTrackId(inferred.title, await storage.getCareerTracks());
  const enriched = {
    ...raw,
    ...inferred,
    relatedTrackId,
  };
  return insertTaskSchema.parse(enriched);
}

async function refineTaskEstimate(task: Task, opts: { inferMissing?: boolean } = {}) {
  let steps = task.steps || "[]";
  if (opts.inferMissing) {
    steps = JSON.stringify(stepsWithEstimatedMinutes(steps));
  }
  const refined = refinedEstimateFromSteps(steps);
  if (!refined) return { task, refined: null };
  const updated = await storage.updateTask(task.id, {
    steps,
    estimateMinutes: refined.estimateMinutes,
    estimateConfidence: refined.estimateConfidence,
    estimateReason: refined.estimateReason,
  } as any);
  await storage.logActivity({
    eventType: "estimate_refined",
    sourceType: task.sourceType || "task",
    sourceId: task.sourceId ?? undefined,
    taskId: task.id,
    planItemId: task.planItemId ?? undefined,
    metadata: JSON.stringify(refined),
  } as any);
  return { task: updated, refined };
}

export function registerSprint2Routes(app: Express) {
  app.post("/api/tasks", async (req, res) => {
    try {
      const task = await storage.createTask(await enrichTaskInput(req.body || {}));
      await storage.logActivity({
        eventType: "created",
        sourceType: task.sourceType || "task",
        sourceId: task.sourceId ?? undefined,
        taskId: task.id,
        metadata: JSON.stringify({ estimateMinutes: task.estimateMinutes, estimateReason: task.estimateReason, category: task.category }),
      } as any);
      const steps = JSON.parse(task.steps || "[]");
      if (steps.length === 0) {
        await contextualizeTask(task.id);
        const refreshed = (await storage.getTasks()).find((t) => t.id === task.id);
        if (refreshed) return res.json(refreshed);
      }
      res.json(task);
      if (task.estimateConfidence === "low") {
        llmEnrichTask(task.id).catch(() => {});
      }
    } catch (e: any) {
      res.status(e?.status || 400).json({ error: e?.message || "Invalid task" });
    }
  });

  app.post("/api/tasks/:id/refine-estimate-from-steps", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const result = await refineTaskEstimate(task, { inferMissing: req.body?.inferMissing !== false });
    if (!result.refined) return res.status(400).json({ error: "No step estimates available", task: result.task });
    res.json(result);
  });

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

  app.get("/api/plan/current", async (req, res) => {
    const day = String(req.query.day || todayKey());
    const energy = coerceEnergy(req.query.energy);
    const plan = await storage.getPlanByDate(day);
    if (!plan) return res.json(await buildAdaptivePlan(day, energy));
    const persistedItems = await storage.getPlanItems(plan.id);
    if (await shouldRefreshBroadPursuitPlan(persistedItems)) {
      return res.json(await buildAdaptivePlan(day, energy, { availableMinutes: readAvailableMinutes(req.query.availableMinutes), restart: false }));
    }
    const items = persistedItems.map((item) => ({
      ...item,
      explanation: explainPersistedPlanItem(item),
    }));
    const events = await storage.getEvents(day);
    const budget = await remainingBudgetFor(day, readAvailableMinutes(req.query.availableMinutes));
    const memory = await planningMemoryFor(day);
    res.json({ plan, items, events, budget, memory: { yesterday: memory.yesterday, missedMvd: !!memory.missedMvdKey, skipped: memory.skippedKeys.size, parked: memory.parkedKeys.size }, restart: false });
  });

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

  app.post("/api/tasks/:id/unstick-to-step", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const provided = String(req.body?.hint || req.body?.step || "").trim();
    const step = provided || deterministicUnstickStep(task);
    const updated = await saveUnstickStep(task, step);
    res.json({ task: updated, step });
  });

  app.post("/api/unstick", async (req, res) => {
    const stepText = String(req.body?.step || "").trim();
    const tasks = await storage.getTasks();
    const task = findTaskForUnstick(tasks, stepText);
    const hint = task ? deterministicUnstickStep(task) : "Set a two-minute timer and do the smallest visible start";
    if (task) await saveUnstickStep(task, hint);
    res.json({ hint, saved: !!task, taskId: task?.id ?? null });
  });
}
