import { storage } from "./storage";
import { getTrackId } from "@shared/domainState";
import { WIN_CATEGORIES, type WinCategory } from "@shared/domainState";
import type {
  Win, ActivityLog, Task, Job, Learn, Contact, Hustle, CareerTrack,
} from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────
// EVIDENCE LAYER (P4.5) — the SINGLE shared place for deterministic
// track-attribution of evidence + per-track evidence metrics. Read-mostly over
// two existing sources of truth: the `wins` table (winCategory) and
// `activityLog` (behavioural truth). NO schema change: a win/activity event is
// attributed to a track by following its source object's existing track link;
// when none can be derived it falls into the "untracked" bucket — we NEVER
// invent a track. Strategy + the wins summary both consume this; the join logic
// lives here once so the two stay consistent.
// ─────────────────────────────────────────────────────────────────────────

export const EVIDENCE_WINDOW_DAYS = 28;
const WIN_MATCH_WINDOW_MS = 5 * 60 * 1000; // a win auto-created on task-completion lands within minutes of the completed event

// untracked is a valid bucket id (never a real track id, which are >= 1).
export const UNTRACKED = "untracked" as const;
export type TrackKey = number | typeof UNTRACKED;

export type EvidenceByCategory = Record<WinCategory, number>;

export type TrackEvidence = {
  trackId: TrackKey;
  evidenceCount: number;            // wins in the rolling window attributed to the track
  evidenceCountAllTime: number;     // all-time win count (no window)
  evidenceByCategory: EvidenceByCategory; // window counts by winCategory
  topCategory: WinCategory | null;  // highest-count category in the window (null if none)
  lastEvidenceAt: number | null;    // most recent attributed win timestamp (staleness)
  executionRatio: number | null;    // completed / (completed+skipped+parked+moved) over window; null when no such events
  executionEvents: number;          // denominator size (window) — lets callers ignore thin samples
  openTasks: number;                // open (not-done) tasks on the track
  producingVsPlanning: "producing" | "balanced" | "planning" | "idle"; // evidence-vs-intent read
};

function emptyByCategory(): EvidenceByCategory {
  return WIN_CATEGORIES.reduce((acc, c) => { acc[c] = 0; return acc; }, {} as EvidenceByCategory);
}

function normalizeWinCategory(raw: string | null | undefined): WinCategory {
  return (WIN_CATEGORIES as readonly string[]).includes(raw || "")
    ? (raw as WinCategory) : "mindset";
}

// Map a task id -> its relatedTrackId (or null). One pass, reused for both wins
// (via the completed event) and activity events.
function taskTrackMap(tasks: Task[]): Map<number, number | null> {
  const m = new Map<number, number | null>();
  for (const t of tasks) m.set(t.id, t.relatedTrackId ?? null);
  return m;
}

// Resolve the track for an activity event. event.taskId -> task.relatedTrackId
// is the strongest signal; otherwise sourceType/sourceId -> that object's track
// link (hustles via proofAssetForTrack). Returns null when nothing derivable.
function trackForActivity(
  e: ActivityLog,
  taskTrack: Map<number, number | null>,
  jobsById: Map<number, Job>, learnById: Map<number, Learn>,
  contactsById: Map<number, Contact>, hustlesById: Map<number, Hustle>,
): number | null {
  if (e.taskId != null && taskTrack.has(e.taskId)) {
    const tid = taskTrack.get(e.taskId);
    if (tid != null) return tid;
  }
  const sid = e.sourceId;
  if (sid != null) {
    switch (e.sourceType) {
      case "job": { const o = jobsById.get(sid); return o ? getTrackId("jobs", o) : null; }
      case "learn": { const o = learnById.get(sid); return o ? getTrackId("learn", o) : null; }
      case "contact": { const o = contactsById.get(sid); return o ? getTrackId("contacts", o) : null; }
      case "hustle": { const o = hustlesById.get(sid); return o ? getTrackId("hustles", o) : null; }
      default: return null;
    }
  }
  return null;
}

// Deterministically attribute a win to a track. P5: PREFER the explicit
// wins.trackId column (set from the originating task's relatedTrackId on win
// creation) when present. Only LEGACY rows with no trackId fall back to the
// 4.5 text-match: follow win -> nearest "completed" event with matching task
// title within a short window -> task.relatedTrackId. If neither resolves, the
// win is "untracked" (we never guess a track).
function trackForWin(
  w: Win,
  completedEvents: ActivityLog[],
  tasksById: Map<number, Task>,
  taskTrack: Map<number, number | null>,
): number | null {
  // P5 — explicit column wins. Null stays untracked (a valid, deliberate state).
  if (w.trackId != null) return w.trackId;
  // Legacy fallback: text-match against the completed event within the window.
  let best: ActivityLog | null = null;
  let bestDelta = Infinity;
  for (const e of completedEvents) {
    if (e.taskId == null) continue;
    const t = tasksById.get(e.taskId);
    if (!t || t.title !== w.text) continue;
    const delta = Math.abs(e.timestamp - w.createdAt);
    if (delta <= WIN_MATCH_WINDOW_MS && delta < bestDelta) { best = e; bestDelta = delta; }
  }
  if (best && best.taskId != null) {
    const tid = taskTrack.get(best.taskId);
    if (tid != null) return tid;
  }
  return null;
}

function producingVsPlanning(evidenceCount: number, openTasks: number): TrackEvidence["producingVsPlanning"] {
  if (evidenceCount === 0 && openTasks === 0) return "idle";
  if (evidenceCount === 0) return "planning";          // intent but no evidence shipped
  if (openTasks > evidenceCount * 2) return "planning"; // lots of plans, little evidence
  if (evidenceCount >= openTasks) return "producing";
  return "balanced";
}

export type EvidenceResult = {
  windowDays: number;
  byTrack: Map<TrackKey, TrackEvidence>;
};

// Compute per-track evidence metrics (+ untracked bucket) over a rolling window.
export async function computeEvidence(windowDays = EVIDENCE_WINDOW_DAYS): Promise<EvidenceResult> {
  const [tracks, wins, activity, tasks, jobs, learn, contacts, hustles] = await Promise.all([
    storage.getCareerTracks(), storage.getWins(), storage.getActivityLog(),
    storage.getTasks(), storage.getJobs(), storage.getLearn(),
    storage.getContacts(), storage.getHustles(),
  ]);

  const windowStart = Date.now() - windowDays * 86400000;
  const tasksById = new Map(tasks.map((t) => [t.id, t] as const));
  const jobsById = new Map(jobs.map((o) => [o.id, o] as const));
  const learnById = new Map(learn.map((o) => [o.id, o] as const));
  const contactsById = new Map(contacts.map((o) => [o.id, o] as const));
  const hustlesById = new Map(hustles.map((o) => [o.id, o] as const));
  const taskTrack = taskTrackMap(tasks);
  const completedEvents = activity.filter((e) => e.eventType === "completed");

  // Seed a bucket per track + the untracked bucket so every track is present
  // (a zero-evidence active track must still surface a result for strategy).
  const buckets = new Map<TrackKey, TrackEvidence>();
  const seed = (key: TrackKey): TrackEvidence => ({
    trackId: key, evidenceCount: 0, evidenceCountAllTime: 0,
    evidenceByCategory: emptyByCategory(), topCategory: null, lastEvidenceAt: null,
    executionRatio: null, executionEvents: 0, openTasks: 0, producingVsPlanning: "idle",
  });
  for (const t of tracks) buckets.set(t.id, seed(t.id));
  buckets.set(UNTRACKED, seed(UNTRACKED));
  const bucket = (key: TrackKey): TrackEvidence => {
    let b = buckets.get(key);
    if (!b) { b = seed(key); buckets.set(key, b); }
    return b;
  };

  // ── Wins -> evidence (window + all-time + by-category + lastEvidenceAt) ──
  for (const w of wins) {
    const tid = trackForWin(w, completedEvents, tasksById, taskTrack);
    const key: TrackKey = tid != null ? tid : UNTRACKED;
    const b = bucket(key);
    b.evidenceCountAllTime += 1;
    if (w.createdAt >= windowStart) {
      b.evidenceCount += 1;
      b.evidenceByCategory[normalizeWinCategory(w.winCategory)] += 1;
      if (b.lastEvidenceAt == null || w.createdAt > b.lastEvidenceAt) b.lastEvidenceAt = w.createdAt;
    }
  }

  // ── activityLog -> executionRatio (behavioural "are plans turning into done") ──
  const EXEC_NUM = new Set(["completed"]);
  const EXEC_DEN = new Set(["completed", "skipped", "parked", "moved"]);
  const execNum = new Map<TrackKey, number>();
  const execDen = new Map<TrackKey, number>();
  for (const e of activity) {
    if (e.timestamp < windowStart) continue;
    if (!EXEC_DEN.has(e.eventType)) continue;
    const tid = trackForActivity(e, taskTrack, jobsById, learnById, contactsById, hustlesById);
    const key: TrackKey = tid != null ? tid : UNTRACKED;
    execDen.set(key, (execDen.get(key) || 0) + 1);
    if (EXEC_NUM.has(e.eventType)) execNum.set(key, (execNum.get(key) || 0) + 1);
  }

  // ── open tasks per track (producingVsPlanning denominator) ──
  for (const t of tasks) {
    if (t.status === "done" || t.done) continue;
    const key: TrackKey = t.relatedTrackId != null ? t.relatedTrackId : UNTRACKED;
    bucket(key).openTasks += 1;
  }

  // ── finalize derived fields ──
  buckets.forEach((b, key) => {
    const den = execDen.get(key) || 0;
    b.executionEvents = den;
    b.executionRatio = den > 0 ? (execNum.get(key) || 0) / den : null;
    let top: WinCategory | null = null; let topN = 0;
    for (const c of WIN_CATEGORIES) if (b.evidenceByCategory[c] > topN) { top = c; topN = b.evidenceByCategory[c]; }
    b.topCategory = top;
    b.producingVsPlanning = producingVsPlanning(b.evidenceCount, b.openTasks);
  });

  return { windowDays, byTrack: buckets };
}

// ── Wins summary (compact by-category + window counts + streak) for the UI ──
export type WinsSummary = {
  total: number;
  thisWeek: number;
  thisMonth: number;
  byCategory: EvidenceByCategory;     // all-time category counts
  byCategoryWeek: EvidenceByCategory; // last-7-day category counts
  streakDays: number;                 // consecutive days (ending today) with >= 1 win
  trackByWinId: Record<number, number | typeof UNTRACKED>; // derived track per win (read-only chip)
};

// Local-day key (YYYY-MM-DD) so "consecutive days" respects the user's calendar.
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function computeWinsSummary(): Promise<WinsSummary> {
  const [wins, activity, tasks] = await Promise.all([
    storage.getWins(), storage.getActivityLog(), storage.getTasks(),
  ]);
  const tasksById = new Map(tasks.map((t) => [t.id, t] as const));
  const taskTrack = taskTrackMap(tasks);
  const completedEvents = activity.filter((e) => e.eventType === "completed");

  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;
  const byCategory = emptyByCategory();
  const byCategoryWeek = emptyByCategory();
  const trackByWinId: Record<number, number | typeof UNTRACKED> = {};

  for (const w of wins) {
    const cat = normalizeWinCategory(w.winCategory);
    byCategory[cat] += 1;
    if (w.createdAt >= weekAgo) byCategoryWeek[cat] += 1;
    const tid = trackForWin(w, completedEvents, tasksById, taskTrack);
    trackByWinId[w.id] = tid != null ? tid : UNTRACKED;
  }

  // streak: consecutive calendar days ending today (or, if no win today, ending
  // yesterday — a same-day gap before logging shouldn't reset a real streak).
  const winDays = new Set(wins.map((w) => dayKey(w.createdAt)));
  let streakDays = 0;
  const cursor = new Date();
  if (!winDays.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (winDays.has(dayKey(cursor.getTime()))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    total: wins.length,
    thisWeek: wins.filter((w) => w.createdAt >= weekAgo).length,
    thisMonth: wins.filter((w) => w.createdAt >= monthAgo).length,
    byCategory, byCategoryWeek, streakDays, trackByWinId,
  };
}
