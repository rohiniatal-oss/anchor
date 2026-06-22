import type { ActivityLog, DayPlanItem, Task } from "@shared/schema";
import { explainPersistedPlanItem, type PlanItem, type Candidate, type SlotName } from "./brain";

// ─────────────────────────────────────────────────────────────────────────────
// PLANNING FEEDBACK
// Deterministic behavioural memory for the planner. This keeps Anchor from being
// a static recommender: yesterday's plan, skips, blocks, and carry-forward state
// influence today's persisted plan without making planning LLM-dependent.
// ─────────────────────────────────────────────────────────────────────────────

export type PlanningMemory = {
  date: string;
  yesterday: string;
  completedKeys: Set<string>;
  unfinishedKeys: Set<string>;
  skippedKeys: Set<string>;
  parkedKeys: Set<string>;
  startedUnfinishedKeys: Set<string>;
  missedMvdKey: string | null;
  eventCountsByTaskId: Map<number, Record<string, number>>;
};

export type TaskStep = { text: string; done: boolean; estimateMinutes?: number };

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function previousDayKey(day: string) {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

function keyFor(sourceType: string, sourceId: number | null | undefined, taskId?: number | null) {
  if (sourceType && sourceId != null) return `${sourceType}:${sourceId}`;
  if (taskId != null) return `task:${taskId}`;
  return "";
}

function keyForItem(item: DayPlanItem) {
  return keyFor(item.sourceType, item.sourceId, item.taskId);
}

function keyForCandidate(c: Candidate) {
  return keyFor(c.source, c.sourceId, c.taskId);
}

function addEventCount(map: Map<number, Record<string, number>>, a: ActivityLog) {
  if (!a.taskId) return;
  const current = map.get(a.taskId) || {};
  current[a.eventType] = (current[a.eventType] || 0) + 1;
  map.set(a.taskId, current);
}

export function buildPlanningMemory(args: {
  day: string;
  yesterdayItems: DayPlanItem[];
  yesterdayMinimumViableItemId?: number | null;
  activity: ActivityLog[];
}): PlanningMemory {
  const yesterday = previousDayKey(args.day);
  const completedKeys = new Set<string>();
  const unfinishedKeys = new Set<string>();
  const skippedKeys = new Set<string>();
  const parkedKeys = new Set<string>();
  const startedUnfinishedKeys = new Set<string>();
  const eventCountsByTaskId = new Map<number, Record<string, number>>();
  let missedMvdKey: string | null = null;

  for (const item of args.yesterdayItems) {
    const key = keyForItem(item);
    if (!key) continue;
    if (item.status === "completed") completedKeys.add(key);
    if (item.status === "skipped") skippedKeys.add(key);
    if (item.status === "parked") parkedKeys.add(key);
    if (item.status === "started") startedUnfinishedKeys.add(key);
    if (["planned", "started", "skipped", "moved", "parked"].includes(item.status)) unfinishedKeys.add(key);
    if (args.yesterdayMinimumViableItemId === item.id && item.status !== "completed") missedMvdKey = key;
  }

  const since = new Date(`${yesterday}T00:00:00`).getTime();
  for (const a of args.activity) {
    if (a.timestamp >= since) addEventCount(eventCountsByTaskId, a);
  }

  return { date: args.day, yesterday, completedKeys, unfinishedKeys, skippedKeys, parkedKeys, startedUnfinishedKeys, missedMvdKey, eventCountsByTaskId };
}

function cloneCandidate(c: Candidate, patch: Partial<Candidate>): Candidate {
  return { ...c, ...patch };
}

function asPlanItem(candidate: Candidate, why: string, slot: SlotName = "now", isMVD = false): PlanItem {
  return {
    candidate,
    why,
    slot,
    isMVD,
    explanation: explainPersistedPlanItem({
      sourceType: candidate.source,
      whySelected: why,
      doneWhen: candidate.doneWhen || "",
    }),
  };
}

function unblockPlanItems(tasks: Task[]): PlanItem[] {
  return tasks
    .filter((t) => !t.done && t.list === "today" && (t.readiness === "blocked" || !!t.blockerReason))
    .slice(0, 2)
    .map((t) => {
      const reason = t.blockerReason || t.blockedBy || "missing input";
      const c: Candidate = {
        source: "task",
        sourceId: t.id,
        taskId: t.id,
        title: `Unblock: ${t.title}`,
        category: "admin",
        size: "quick",
        deadline: t.deadline || "",
        status: t.status || "stuck",
        skipped: t.skipped || 0,
        sourceUrl: t.sourceUrl || "",
        sourceNote: t.sourceNote || "",
        sourceStatus: t.sourceStatus || "",
        doneWhen: `The blocker is named or resolved: ${reason}`,
        whyNow: "blocked, so the next action is to remove the blocker",
        fitScore: null,
        blocked: false,
        blockerReason: "",
        eligibilityRisk: "",
      };
      return asPlanItem(c, `Blocked item. Do the unblock step first: ${reason}`, "now", false);
    });
}

export function applyPlanningFeedback(plan: PlanItem[], memory: PlanningMemory, tasks: Task[]) {
  const blockedItems = unblockPlanItems(tasks);
  const completedYesterday = memory.completedKeys;
  const filtered: PlanItem[] = [];

  for (const item of plan) {
    const key = keyForCandidate(item.candidate);
    // Do not blindly repeat non-deadline source work completed yesterday. Tasks
    // already disappear when done; this mainly prevents recurring job/learn source
    // candidates from resurfacing immediately without a new reason.
    const hasDeadline = !!item.candidate.deadline;
    if (key && completedYesterday.has(key) && !hasDeadline) continue;

    let next = item;
    const taskSkipped = item.candidate.taskId ? (memory.eventCountsByTaskId.get(item.candidate.taskId)?.skipped || 0) : 0;
    const repeatedlySkipped = item.candidate.skipped >= 2 || taskSkipped >= 2 || (key && memory.skippedKeys.has(key));
    const carriedForward = key && memory.unfinishedKeys.has(key);
    const missedMvd = key && memory.missedMvdKey === key;

    if (repeatedlySkipped) {
      next = {
        ...next,
        candidate: cloneCandidate(item.candidate, {
          title: `Shrink or decide: ${item.candidate.title}`,
          size: "quick",
          doneWhen: "You have either made it smaller, blocked it, parked it, or done a 5-minute start",
        }),
        why: "This has slipped before, so do not repeat it unchanged. Shrink it or make a decision.",
      };
    } else if (missedMvd) {
      next = {
        ...next,
        why: `Carry-forward from yesterday's minimum viable day. Do the smallest version first.`,
      };
    } else if (carriedForward) {
      next = {
        ...next,
        why: `Carried forward from yesterday. Finish or deliberately park it.`,
      };
    }

    filtered.push(next);
  }

  const seen = new Set<string>();
  const merged = [...blockedItems, ...filtered].filter((item) => {
    const k = keyForCandidate(item.candidate);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, Math.max(1, plan.length || blockedItems.length));

  const slots: SlotName[] = ["now", "next", "later", "bonus"];
  return merged.map((item, i) => ({
    ...item,
    slot: slots[Math.min(i, slots.length - 1)],
    isMVD: i === 0,
  }));
}

export function feedbackSummary(memory: PlanningMemory) {
  const bits: string[] = [];
  if (memory.missedMvdKey) bits.push("yesterday's MVD carried forward");
  if (memory.skippedKeys.size > 0) bits.push(`${memory.skippedKeys.size} skipped item${memory.skippedKeys.size === 1 ? "" : "s"}`);
  if (memory.parkedKeys.size > 0) bits.push(`${memory.parkedKeys.size} parked item${memory.parkedKeys.size === 1 ? "" : "s"}`);
  if (memory.startedUnfinishedKeys.size > 0) bits.push(`${memory.startedUnfinishedKeys.size} started but unfinished`);
  return bits.length ? `Adjusted for ${bits.join(", ")}.` : "";
}

export function parseSteps(rawSteps: string): TaskStep[] {
  try {
    const parsed = JSON.parse(rawSteps || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.text === "string")
      .map((s) => ({
        text: s.text,
        done: !!s.done,
        estimateMinutes: Number.isFinite(Number(s.estimateMinutes)) && Number(s.estimateMinutes) > 0 ? Math.round(Number(s.estimateMinutes)) : undefined,
      }));
  } catch {
    return [];
  }
}

export function refinedEstimateFromSteps(rawSteps: string) {
  const steps = parseSteps(rawSteps);
  const estimates = steps.map((s) => s.estimateMinutes).filter((n): n is number => Number.isFinite(n));
  if (estimates.length === 0) return null;
  return {
    estimateMinutes: estimates.reduce((sum, n) => sum + n, 0),
    estimateConfidence: estimates.length === steps.length ? "medium" : "low",
    estimateReason: estimates.length === steps.length ? "breakdown_sum" : "breakdown_partial_sum",
    stepsCount: steps.length,
    estimatedStepsCount: estimates.length,
  };
}

export function stepsWithEstimatedMinutes(rawSteps: string) {
  const steps = parseSteps(rawSteps);
  return steps.map((s) => {
    if (s.estimateMinutes) return s;
    const text = s.text.toLowerCase();
    const estimateMinutes = /open|check|send|message|email|find|list|skim|note/.test(text) ? 5
      : /draft|write|rewrite|research|prepare|review|tailor|build/.test(text) ? 20
      : 10;
    return { ...s, estimateMinutes };
  });
}

export function prependStep(rawSteps: string, text: string) {
  const steps = parseSteps(rawSteps).map((s) => ({ text: s.text, done: s.done, ...(s.estimateMinutes ? { estimateMinutes: s.estimateMinutes } : {}) }));
  const trimmed = text.trim();
  if (!trimmed) return JSON.stringify(steps);
  const withoutDuplicate = steps.filter((s) => s.text.trim().toLowerCase() !== trimmed.toLowerCase());
  return JSON.stringify([{ text: trimmed, done: false }, ...withoutDuplicate]);
}

export function deterministicUnstickStep(task: Task) {
  if (task.readiness === "blocked" || task.blockerReason) {
    return `Write down what's missing: ${task.blockerReason || task.blockedBy || "what's blocking this"}`;
  }
  if (task.sourceUrl) return "Check the saved link and note what you need from it";
  if (task.sourceType === "job") {
    if (/cv|resume|tailor/i.test(task.title)) return "Pick the 2 CV bullets closest to this role and sharpen one";
    if (/cover/i.test(task.title)) return "Write the opening line — why this role, why you, why now";
    if (/apply|submit/i.test(task.title)) return "Fill in the first required field on the application";
    if (/research|understand/i.test(task.title)) return "Write down the 3 key requirements in your own words";
  }
  if (task.sourceType === "contact") {
    if (/draft|outreach|message|email/i.test(task.title)) return "Write the subject line and first sentence";
    if (/prep|prepare|conversation/i.test(task.title)) return "Write down the one thing you most want to learn from them";
    if (/follow/i.test(task.title)) return "Send a one-line check-in referencing your last exchange";
  }
  if (task.sourceType === "learn") {
    if (/read|watch|listen|review/i.test(task.title)) return "Read just the intro or first section and note one takeaway";
    if (/note|write|summarise|summarize/i.test(task.title)) return "Write one sentence about what you've learned so far";
    if (/practice|try|build|create/i.test(task.title)) return "Do one small practice attempt — even 5 minutes counts";
  }
  if (task.size === "deep") return "Write one rough sentence to break the blank page";
  if (/email|message|reach|follow/i.test(task.title)) return "Write the first line";
  return "Pick the one part of this you can do in 5 minutes";
}
