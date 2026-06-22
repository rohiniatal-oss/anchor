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

function deadlineDaysFromNow(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T23:59:59");
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - new Date().getTime()) / 86400000);
}

const STALE_DONE_WHEN = [
  "One clear role example or learning note is captured",
  "One clear example or learning note captured",
];

function freshDoneWhen(item: any): string | null {
  const dw = item.doneWhen?.trim();
  if (!dw || STALE_DONE_WHEN.some((s) => dw.toLowerCase() === s.toLowerCase())) {
    if (item.title) return `You've reviewed "${item.title.slice(0, 50).trim()}" and noted what stands out`;
    return null;
  }
  return dw;
}

function decoratePlanItems(items: any[]) {
  return items.map((item) => ({
    ...item,
    doneWhen: freshDoneWhen(item) || item.doneWhen,
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
          if (job.deadline) {
            const dd = deadlineDaysFromNow(job.deadline);
            if (dd !== null && dd <= 3) {
              lines.push(`URGENT: Deadline ${dd <= 0 ? "is today or overdue" : `in ${dd} day${dd === 1 ? "" : "s"}`}. Steps must move directly toward submission.`);
            }
          }
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
    try {
      const allTasks = await storage.getTasks();
      const doneSiblings = allTasks
        .filter((t) => t.id !== task.id && t.sourceType === task.sourceType && t.sourceId === task.sourceId && t.done)
        .slice(-4)
        .map((t) => t.title);
      if (doneSiblings.length) {
        lines.push(`Already done for this: ${doneSiblings.join("; ")}`);
      }
    } catch {}
  }
  try {
    const wins = await storage.getWins();
    const trackId = (task as any).relatedTrackId;
    const relevant = wins
      .filter((w) => (w.takeaway || "").trim() && (trackId ? w.trackId === trackId : true))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 3);
    if (relevant.length) {
      lines.push(`Recent lessons: ${relevant.map((w) => w.takeaway).join("; ")}`);
    }
  } catch {}
  return lines.join("\n");
}

type SkipReason = "cant_start" | "too_big" | "too_hard" | "wrong_moment" | "dont_want_to" | "doesnt_matter";

async function diagnoseSkipReason(task: any): Promise<{ reason: SkipReason; confidence: "auto" | "ask" }> {
  if (task.sourceType && task.sourceId != null) {
    try {
      if (task.sourceType === "job") {
        const job = (await storage.getJobs()).find((j) => j.id === task.sourceId);
        if (!job || job.status === "closed") return { reason: "doesnt_matter", confidence: "auto" };
      } else if (task.sourceType === "contact") {
        const contact = (await storage.getContacts()).find((c) => c.id === task.sourceId);
        if (!contact || contact.status === "archived" || contact.status === "cold") return { reason: "doesnt_matter", confidence: "auto" };
      } else if (task.sourceType === "learn") {
        const item = (await storage.getLearn()).find((l) => l.id === task.sourceId);
        if (!item) return { reason: "doesnt_matter", confidence: "auto" };
      }
    } catch {}
  }
  if (!task.relatedTrackId && !task.sourceType) {
    const tracks = await storage.getCareerTracks();
    if (tracks.filter((t) => t.status === "active").length === 0) {
      return { reason: "doesnt_matter", confidence: "auto" };
    }
  }
  const steps = parseTaskSteps(task.steps);
  if (steps.length === 0 || !steps[0]?.text) return { reason: "cant_start", confidence: "auto" };
  if (task.sourceType === "job" && task.sourceId != null) {
    try {
      const job = (await storage.getJobs()).find((j) => j.id === task.sourceId);
      if (job && !job.url && !job.jdText) return { reason: "cant_start", confidence: "auto" };
    } catch {}
  }
  const est = task.estimateMinutes || 0;
  if (est > 45 || task.size === "deep") return { reason: "too_big", confidence: "auto" };
  return { reason: "too_hard", confidence: "ask" };
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
  sourceStatus?: string | null;
  title?: string | null;
  whySelected?: string | null;
  doneWhen?: string | null;
}) {
  if (item.sourceType === "job") return "job";
  if (item.sourceType === "learn") return "learning";
  if (item.sourceType === "hustle") return "hustle";
  if (item.sourceType === "contact") return "admin";
  if (item.sourceType === "goal") {
    const sourceStatus = String(item.sourceStatus || "").toLowerCase();
    if (sourceStatus === "broad_parallel_pursuit_network_support") return "admin";
    if (sourceStatus === "broad_parallel_pursuit_learning_support") return "learning";
    const text = `${item.title || ""} ${item.whySelected || ""} ${item.doneWhen || ""} ${sourceStatus}`.toLowerCase();
    if (/contact|outreach|reach out|message|network|real person|reality-check|reality check|chat|how teams hire|find one person|person at/i.test(text)) return "admin";
    if (/learning focus|learning support|learn|learning|missing requirement|prep move|targeted prep/i.test(text)) return "learning";
    return "job";
  }
  return "admin";
}

function inferWinCategory(task: { category?: string | null; sourceType?: string | null; title: string }): string {
  if (task.category === "job" || task.category === "interview") return "job_progress";
  if (task.category === "learning") return "learning";
  if (task.category === "substack" || task.category === "hustle" || task.category === "afterline") return "proof_asset";
  if (task.sourceType === "contact") return "network";
  if (task.sourceType === "job") return "job_progress";
  if (task.sourceType === "learn") return "learning";
  const t = task.title.toLowerCase();
  if (/interview|application|apply|resume|cv|cover letter|job posting/i.test(t)) return "job_progress";
  if (/portfolio|project|publish|post|article|blog|build/i.test(t)) return "proof_asset";
  if (/\bread\b|learn|study|course|tutorial|practice/i.test(t)) return "learning";
  if (/message|outreach|follow.?up|network|connect|intro|referral/i.test(t)) return "network";
  if (/write|draft/i.test(t)) return "proof_asset";
  return "admin";
}

async function updateSourceEntityOnComplete(task: { sourceType?: string | null; sourceId?: number | null; title: string }) {
  if (!task.sourceType || task.sourceId == null) return;
  try {
    if (task.sourceType === "job") {
      const t = task.title;
      if (/submit|apply|send.*application/i.test(t)) {
        const job = (await storage.getJobs()).find((j) => j.id === task.sourceId);
        if (job && job.status === "wishlist") {
          await storage.updateJob(task.sourceId, { status: "applied" } as any);
        }
      } else if (/interview|prep.*interview|mock.*interview/i.test(t)) {
        const job = (await storage.getJobs()).find((j) => j.id === task.sourceId);
        if (job && (job.status === "wishlist" || job.status === "applied")) {
          await storage.updateJob(task.sourceId, { status: "interviewing" } as any);
        }
      }
    } else if (task.sourceType === "contact") {
      if (/message|draft|send|outreach|email|reach out|follow.?up/i.test(task.title)) {
        await storage.updateContact(task.sourceId, {
          status: "messaged",
          lastContactedAt: new Date().toISOString(),
        } as any);
      }
    }
  } catch {}
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
      doneWhen: repaired.doneWhen,
      minimumOutcome: repaired.minimumOutcome,
    } as any);
    task = updated || { ...task, title: repaired.title, steps: repaired.steps, doneWhen: repaired.doneWhen, minimumOutcome: repaired.minimumOutcome };
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
  return await saveStarterStep(task) || task;
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
  const [tasks, jobs, learn, hustles, contacts, tracks, jobContactLinks, profile] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getCareerTracks(),
    storage.getAllJobContactLinks(),
    storage.getProfile(),
  ]);
  const busy = await busyMinutesFor(day);
  const r = planDay(tasks, jobs, learn, hustles, energy, busy, contacts, tracks, new Map(), jobContactLinks, profile);
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
      sourceNote: c.sourceNote || "",
      sourceStatus: c.sourceStatus || "",
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
    const [tasks, jobs, learn, hustles, contacts, tracks, jobContactLinks, profile] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getAllJobContactLinks(),
      storage.getProfile(),
    ]);
    const r = recommend(tasks, jobs, learn, hustles, energy, contacts, tracks, jobContactLinks, profile);
    res.json(r);
  });

  app.post("/api/brain/plan", async (req, res) => {
    const energy = ["low", "medium", "high"].includes(req.body?.energy) ? req.body.energy : "medium";
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
    const [tasks, jobs, learn, hustles, contacts, tracks, events, jobContactLinks, profile] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getEvents(day),
      storage.getAllJobContactLinks(),
      storage.getProfile(),
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
    const r = planDay(tasks, jobs, learn, hustles, energy, busy, contacts, tracks, new Map(), jobContactLinks, profile);
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
    let replacement: string | null = null;
    let autoAction: string | null = null;
    let needsDiagnosis = false;

    if (skipped >= 2) {
      const diag = await diagnoseSkipReason(task);
      if (diag.confidence === "auto") {
        if (diag.reason === "doesnt_matter") {
          await storage.updateTask(id, { list: "inbox", pinned: false, skipped, status: "not_started" } as any);
          await syncPlanItem(day, task, { status: "skipped", skippedAt: Date.now() });
          await storage.logActivity({ eventType: "skipped", sourceType: task.sourceType || "task", taskId: id, metadata: JSON.stringify({ skipped, autoAction: "parked", reason: "doesnt_matter" }) } as any);
          return res.json({ ok: true, autoAction: "parked", message: "This lost its connection to your active goals, so I parked it." });
        }
        if (diag.reason === "cant_start") {
          try {
            const shrinkContext = await buildShrinkContext(task);
            const arr = await llmJSON<string[]>(
              "This task keeps slipping because the first step isn't clear enough. Break it into 3-4 micro-steps. " +
              "The first step must be under 2 minutes, immediately startable, and physical (open something, write one line, send one thing). " +
              "Each step should be specific to the actual task — never generic filler. " +
              'Return ONLY a JSON array of strings.\n\n' + shrinkContext,
              { model: MODEL_LIGHT },
            ) || [];
            if (arr.length) {
              steps = JSON.stringify(arr.slice(0, 4).map((x) => ({ text: x, done: false })));
              autoShrunk = true;
              autoAction = "clarified";
            }
          } catch {}
          if (!autoShrunk) {
            try {
              const breakdown = await buildDeterministicTaskBreakdown(task as any);
              if (breakdown.steps.length) { steps = JSON.stringify(breakdown.steps); autoShrunk = true; autoAction = "clarified"; }
            } catch {}
          }
        }
        if (diag.reason === "too_big") {
          try {
            const shrinkContext = await buildShrinkContext(task);
            const result = await llmJSON<{ replacement: string; steps: string[] }>(
              "This task is too big to start. Find the SMALLEST useful slice — something that takes 15 minutes max and produces one visible result. " +
              "The slice should be a meaningful first piece of the full task, not just planning or thinking. " +
              'Return JSON: {"replacement":"<15-min slice title>","steps":["<2-3 micro-steps>"]}\n\n' + shrinkContext,
              { model: MODEL_LIGHT },
            );
            if (result?.replacement && result.steps?.length) {
              replacement = result.replacement;
              steps = JSON.stringify(result.steps.slice(0, 3).map((x) => ({ text: x, done: false })));
              autoShrunk = true;
              autoAction = "shrunk";
            }
          } catch {}
        }
      } else {
        needsDiagnosis = true;
      }
    }

    const patch: any = { skipped, steps, pinned: false, status: "not_started" };
    if (replacement) patch.title = replacement;
    const updated = await storage.updateTask(id, patch);
    await syncPlanItem(day, task, { status: "skipped", skippedAt: Date.now() });
    const activity: InsertActivityLog = {
      eventType: "skipped",
      sourceType: task.sourceType || "task",
      sourceId: task.sourceId ?? undefined,
      taskId: id,
      planItemId: task.planItemId ?? undefined,
      metadata: JSON.stringify({ skipped, autoShrunk, replacement: !!replacement, autoAction, needsDiagnosis }),
    };
    await storage.logActivity(activity);
    res.json({ ...updated, replacement: !!replacement, autoAction, needsDiagnosis });
  });

  app.post("/api/tasks/:id/skip-resolve", async (req, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "") as SkipReason;
    const valid: SkipReason[] = ["too_hard", "wrong_moment", "dont_want_to", "doesnt_matter"];
    if (!valid.includes(reason)) return res.status(400).json({ error: "Invalid reason" });
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const day = String(req.body?.day || new Date().toISOString().slice(0, 10));

    if (reason === "doesnt_matter") {
      await storage.updateTask(id, { list: "inbox", pinned: false, status: "not_started" } as any);
      await storage.logActivity({ eventType: "skip_resolved", sourceType: "task", taskId: id, metadata: JSON.stringify({ reason }) } as any);
      return res.json({ action: "parked", message: "Parked — it's out of your way." });
    }

    if (reason === "wrong_moment") {
      await storage.updateTask(id, { pinned: false, block: null } as any);
      await storage.logActivity({ eventType: "skip_resolved", sourceType: "task", taskId: id, metadata: JSON.stringify({ reason }) } as any);
      return res.json({ action: "rescheduled", message: "I'll try a different time for this." });
    }

    if (reason === "too_hard") {
      let learnTitle: string | null = null;
      try {
        const shrinkContext = await buildShrinkContext(task);
        const result = await llmJSON<{ learnFirst: string; smallerVersion: string; steps: string[] }>(
          "This task keeps being skipped because the user doesn't feel ready — it requires skills or knowledge they don't have yet. " +
          "Figure out WHAT they'd need to learn first, and create a simpler version of the task they can do after learning. " +
          'Return JSON: {"learnFirst":"<one specific thing to learn/practice first — a concrete skill, not a topic>","smallerVersion":"<a version of this task that assumes they\'ve done the learning>","steps":["<2-3 steps for the smaller version>"]}\n\n' + shrinkContext,
          { model: MODEL_LIGHT },
        );
        if (result?.learnFirst) {
          learnTitle = result.learnFirst;
          const learn = await storage.createLearn({
            title: result.learnFirst,
            learnType: "practice",
            category: task.category || "learning",
            relatedTrackId: task.relatedTrackId ?? null,
          } as any);
          if (result.smallerVersion && result.steps?.length) {
            await storage.updateTask(id, {
              title: result.smallerVersion,
              steps: JSON.stringify(result.steps.slice(0, 3).map((x) => ({ text: x, done: false }))),
              pinned: false, status: "not_started",
              blockedBy: learn?.id ? `learn:${learn.id}` : "",
            } as any);
          } else if (learn?.id) {
            await storage.updateTask(id, { blockedBy: `learn:${learn.id}` } as any);
          }
          await storage.logActivity({ eventType: "skip_resolved", sourceType: "task", taskId: id, metadata: JSON.stringify({ reason, learnItemId: learn?.id }) } as any);
          return res.json({ action: "learn_first", message: `I added "${result.learnFirst}" to your learning list. The task is ready once you've done that.`, learnTitle: result.learnFirst });
        }
      } catch {}
      return res.json({ action: "learn_first", message: "I couldn't figure out the gap — try breaking it down yourself." });
    }

    if (reason === "dont_want_to") {
      try {
        const shrinkContext = await buildShrinkContext(task);
        const goalLink = await llm(
          "This task keeps being skipped because the user is avoiding it emotionally. " +
          "In ONE warm sentence (no preamble), remind them WHY this task matters for their career goal. " +
          "Then suggest the absolute smallest version — something so tiny it bypasses the resistance. " +
          "Format: [why it matters]. [tiny version to start with].\n\n" + shrinkContext,
          { model: MODEL_LIGHT },
        );
        const result = await llmJSON<{ tinyVersion: string; steps: string[] }>(
          "Create the TINIEST possible version of this task — something that takes under 5 minutes and feels so small " +
          "it's hard to say no. The goal is to bypass emotional resistance by making the first move trivially easy. " +
          'Return JSON: {"tinyVersion":"<absurdly small version>","steps":["<1-2 micro-steps>"]}\n\n' + shrinkContext,
          { model: MODEL_LIGHT },
        );
        if (result?.tinyVersion && result.steps?.length) {
          await storage.updateTask(id, {
            title: result.tinyVersion,
            steps: JSON.stringify(result.steps.slice(0, 2).map((x) => ({ text: x, done: false }))),
            pinned: false, status: "not_started",
          } as any);
        }
        await storage.logActivity({ eventType: "skip_resolved", sourceType: "task", taskId: id, metadata: JSON.stringify({ reason }) } as any);
        return res.json({ action: "shrunk_tiny", message: goalLink || "I made it as small as possible — just get the first thing done." });
      } catch {}
      await storage.logActivity({ eventType: "skip_resolved", sourceType: "task", taskId: id, metadata: JSON.stringify({ reason }) } as any);
      return res.json({ action: "shrunk_tiny", message: "I made it smaller. Just do the first step — that's enough for today." });
    }

    res.json({ action: "none", message: "Noted." });
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
    try {
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
      sourceNote: item.sourceNote || task?.sourceNote || "",
      sourceStatus: item.sourceStatus || task?.sourceStatus || "",
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
        sourceNote: item.sourceNote || "",
        sourceStatus: item.sourceStatus || "",
        planItemId: item.id,
      } as any);
    }
    task = await ensureExecutionReadyTask(task);

    await storage.updatePlanItem(item.id, { taskId: task!.id, status: "started", startedAt: Date.now() } as any);
    await storage.logActivity({ eventType: "started", sourceType: item.sourceType || "task", sourceId: item.sourceId ?? undefined, taskId: task!.id, planItemId: item.id } as any);
    res.json({ ok: true, task });
    } catch (err: any) {
      console.error("start plan item failed:", err);
      res.status(500).json({ error: err?.message || "Failed to start item" });
    }
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
    let nextMilestoneHint: string | null = null;
    if (task.sourceStepType === "recommendation_milestone" && task.sourceStepId) {
      await completeRecommendationMilestone(task.sourceStepId);
      completedMilestoneId = task.sourceStepId;
      const milestone = await storage.getRecommendationMilestone(task.sourceStepId).catch(() => undefined);
      if (milestone) {
        const siblings = await storage.getRecommendationMilestones(milestone.recommendationId);
        const next = siblings.find((m) => m.status === "active" || m.status === "todo");
        if (next) nextMilestoneHint = next.suggestedTaskTitle || next.label;
      }
    } else if (task.sourceType === "learn" && task.sourceId != null) {
      const learnItem = await storage.getLearnItem(task.sourceId).catch(() => undefined);
      if (learnItem?.sourceType === "recommendation" && learnItem.sourceId != null) {
        const milestones = await storage.getRecommendationMilestones(learnItem.sourceId);
        const active = milestones.find((m) => m.status === "active") || milestones.find((m) => m.status === "todo");
        if (active) { await completeRecommendationMilestone(active.id); completedMilestoneId = active.id; }
        const refreshed = await storage.getRecommendationMilestones(learnItem.sourceId);
        const next = refreshed.find((m) => m.status === "active" || m.status === "todo");
        if (next) nextMilestoneHint = next.suggestedTaskTitle || next.label;
      }
    }
    const winCategory = inferWinCategory(task);
    const win = await storage.createWin({ text: task.title, kind: "planned", winCategory, trackId: task.relatedTrackId ?? null, sourceEntityType: task.sourceType || "task", sourceEntityId: task.sourceId ?? task.id } as any);
    await storage.logActivity({ eventType: "completed", sourceType: task.sourceType || "task", sourceId: task.sourceId ?? undefined, taskId: id, planItemId: task.planItemId ?? undefined } as any);
    await updateSourceEntityOnComplete(task);
    await syncPlanItem(day, task, { status: "completed", completedAt: Date.now() });
    await refreshDoneEnough(day);
    res.json({ ok: true, completedMilestoneId, winId: win?.id ?? null, winCategory, nextMilestoneHint });
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
