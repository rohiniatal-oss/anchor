import type { Express } from "express";
import { storage } from "./storage";
import { routeCapture, sortOpenCaptures } from "./capture";
import { buildTaskIntakeDefaults } from "./taskIntakeInference";
import { legacyCategoryToRoute } from "./captureCompatibility";
import { buildUserContext, formatContextForPrompt } from "./userContext";
import { computeEvidence } from "./evidence";
import { llm, llmJSON, MODEL_LIGHT } from "./llm";

function computeStreak(activity: { eventType: string; timestamp: number }[]): number {
  const dayKeys = new Set(
    activity
      .filter((a) => a.eventType === "completed")
      .map((a) => {
        const d = new Date(a.timestamp);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }),
  );
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dayKeys.has(key)) streak++;
    else break;
  }
  return streak;
}

export function registerTaskAssistRoutes(app: Express) {
  app.post("/api/unstick", async (req, res) => {
    const step = String(req.body?.step || "").trim();
    const currentStage = String(req.body?.currentStage || "").trim();
    const stageOutput = String(req.body?.stageOutput || "").trim();
    if (!step) return res.status(400).json({ error: "Need a step" });
    try {
      const stageCtx = currentStage
        ? ` The broader task is in the "${currentStage}" stage — the goal for this stage is: ${stageOutput || "not specified"}.`
        : "";
      const raw = await llm(
        `The user is frozen on a task and can't start. Your job is to find the smallest physical action that breaks the freeze.\n\n` +
        `STUCK ON: "${step}"${stageCtx}\n\n` +
        `REASONING (do this silently, don't output it):\n` +
        `1. What is the FIRST PHYSICAL thing they'd need to do? (open an app, pick up a pen, click a button)\n` +
        `2. Can it be done in under 60 seconds?\n` +
        `3. Does it produce something visible? (a cursor blinking, a tab open, one word typed)\n` +
        `If the step is vague ("research X"), make it concrete ("open Google and type [specific query]").\n` +
        `If the step is big ("write the report"), shrink it ("open a doc and type just the first sentence").\n\n` +
        `OUTPUT: One warm sentence. The action, not the advice. No preamble.`,
        { model: MODEL_LIGHT },
      );
      const hint = raw.replace(/^["']|["']$/g, "");
      res.json({ hint: hint || "Set a 2-minute timer and just open the first thing." });
    } catch {
      res.status(500).json({ error: "Couldn't think of one right now." });
    }
  });

  app.post("/api/tasks/:id/enrich", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    try {
      const inferred = buildTaskIntakeDefaults({
        title: task.title,
        category: task.category,
        size: task.size,
        estimateMinutes: task.estimateMinutes,
        estimateConfidence: task.estimateConfidence,
        estimateReason: task.estimateReason,
        doneWhen: task.doneWhen,
        steps: task.steps,
        minimumOutcome: task.minimumOutcome,
        readiness: task.readiness,
        blockerReason: task.blockerReason,
        status: task.status,
      });
      const patch: any = {};
      if (!task.size) patch.size = inferred.size;
      if (!task.category || task.category === "admin") patch.category = inferred.category;
      if (task.estimateMinutes == null) patch.estimateMinutes = inferred.estimateMinutes;
      if (!task.estimateConfidence) patch.estimateConfidence = inferred.estimateConfidence;
      if (!task.estimateReason) patch.estimateReason = inferred.estimateReason;
      if (!task.doneWhen) patch.doneWhen = inferred.doneWhen;
      if (!task.steps || task.steps === "[]") patch.steps = inferred.steps;
      if (!task.minimumOutcome) patch.minimumOutcome = inferred.minimumOutcome;
      if (!task.readiness) patch.readiness = inferred.readiness;
      if (!task.status) patch.status = inferred.status;
      const updated = await storage.updateTask(id, patch);
      res.json(updated);
    } catch {
      res.status(500).json({ error: "Couldn't enrich right now." });
    }
  });

  app.get("/api/stats", async (_req, res) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const weekAgo = startOfToday - 7 * 86400000;
    const y = new Date(startOfYesterday);
    const yesterdayKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    const [wins, activity, yesterdayPlan] = await Promise.all([
      storage.getWins(), storage.getActivityLog(), storage.getPlanByDate(yesterdayKey),
    ]);
    const yesterdayItems = yesterdayPlan ? await storage.getPlanItems(yesterdayPlan.id) : [];
    const yesterdayCompleted = yesterdayItems.filter((i: any) => i.status === "completed").length;
    const yesterdayTotal = yesterdayItems.length;
    const yesterdayWins = yesterdayItems
      .filter((i: any) => i.status === "completed")
      .slice(0, 4)
      .map((i: any) => i.title);
    const carriedOver = yesterdayItems
      .filter((i: any) => i.status === "skipped" || i.status === "planned" || i.status === "moved")
      .slice(0, 3)
      .map((i: any) => i.title);
    const thisWeek = wins.filter((w) => w.createdAt >= weekAgo);
    const weekActivity = activity.filter((a) => a.timestamp >= weekAgo);
    const todayActivity = activity.filter((a) => a.timestamp >= startOfToday);
    const weekTakeaways = thisWeek
      .filter((w) => (w.takeaway || "").trim())
      .map((w) => ({ win: w.text, takeaway: w.takeaway!, category: w.winCategory }));
    const [tracks, contacts] = await Promise.all([storage.getCareerTracks(), storage.getContacts()]);
    const evidence = await computeEvidence();
    const staleTracks = tracks
      .filter((t) => t.status === "active")
      .filter((t) => {
        const te = evidence.byTrack.get(t.id);
        return te?.producingVsPlanning === "idle";
      })
      .slice(0, 3)
      .map((t) => t.name);
    const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00").getTime();
    const overdueFollowUps = contacts
      .filter((c) => c.nextFollowUpDate && c.status !== "cold" && c.status !== "archived")
      .map((c) => {
        const dueMs = new Date(c.nextFollowUpDate + "T12:00:00").getTime();
        const daysOverdue = Math.floor((todayMs - dueMs) / 86400000);
        return { name: c.name || c.who || "Someone", daysOverdue };
      })
      .filter((c) => c.daysOverdue >= 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 4);
    const jobs = await storage.getJobs();
    const urgentDeadlines = jobs
      .filter((j) => j.deadline && (j.status === "wishlist" || j.status === "applied" || j.status === "interviewing"))
      .map((j) => {
        const dueMs = new Date(j.deadline + "T23:59:59").getTime();
        const daysLeft = Math.ceil((dueMs - Date.now()) / 86400000);
        return { role: `${j.title} at ${j.company}`, daysLeft };
      })
      .filter((j) => j.daysLeft <= 5)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 3);
    const twoWeeksAgo = startOfToday - 14 * 86400000;
    const staleJobs = jobs
      .filter((j) => !j.deadline && j.status === "wishlist" && j.createdAt && j.createdAt < twoWeeksAgo)
      .slice(0, 3)
      .map((j) => `${j.title}${j.company ? ` at ${j.company}` : ""}`);
    const allTasks = await storage.getTasks();
    const oneWeekAgo = startOfToday - 7 * 86400000;
    const stuckTasks = allTasks
      .filter((t) => !t.done && t.status === "in_progress")
      .filter((t) => {
        const lastEvent = activity
          .filter((a) => a.taskId === t.id)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        return !lastEvent || lastEvent.timestamp < oneWeekAgo;
      })
      .slice(0, 3)
      .map((t) => t.title);
    res.json({
      doneThisWeek: thisWeek.length,
      jobProgressThisWeek: thisWeek.filter((w) => w.winCategory === "job_progress").length,
      networkThisWeek: thisWeek.filter((w) => w.winCategory === "network").length,
      learningThisWeek: thisWeek.filter((w) => w.winCategory === "learning").length,
      proofAssetThisWeek: thisWeek.filter((w) => w.winCategory === "proof_asset").length,
      actionsToday: todayActivity.filter((a) => a.eventType === "completed").length,
      startsToday: todayActivity.filter((a) => a.eventType === "started").length,
      blockedToday: todayActivity.filter((a) => a.eventType === "blocked").length,
      completionsThisWeek: weekActivity.filter((a) => a.eventType === "completed").length,
      startsThisWeek: weekActivity.filter((a) => a.eventType === "started").length,
      blockedThisWeek: weekActivity.filter((a) => a.eventType === "blocked").length,
      streak: computeStreak(activity),
      yesterdayCompleted,
      yesterdayTotal,
      yesterdayWins,
      carriedOver,
      weekTakeaways,
      staleTracks,
      overdueFollowUps,
      urgentDeadlines,
      staleJobs,
      stuckTasks,
    });
  });

  app.post("/api/braindump/sort", async (_req, res) => {
    try {
      const suggestions = await sortOpenCaptures();
      res.json({
        suggestions: suggestions.map((suggestion) => ({
          id: suggestion.id,
          category: suggestion.category,
          route: suggestion.route,
          reason: suggestion.reason,
          confidence: suggestion.confidence,
          question: suggestion.question,
        })),
      });
    } catch {
      res.status(500).json({ error: "Couldn't sort right now." });
    }
  });

  app.post("/api/braindump/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const route = legacyCategoryToRoute(String(req.body?.category || req.body?.route || ""));
    if (!route) return res.status(400).json({ error: "Unknown category" });
    const result = await routeCapture(id, route);
    res.status(result.status).json(result.body);
  });

  app.post("/api/networking/suggest", async (req, res) => {
    const exclude: string[] = Array.isArray(req.body?.exclude) ? req.body.exclude.map((s: any) => String(s)) : [];
    const [jobs, contacts] = await Promise.all([storage.getJobs(), storage.getContacts()]);
    const targets = jobs.filter((j) => j.status === "wishlist" || j.status === "applied" || j.status === "interviewing")
      .map((j) => `${j.title} @ ${j.company} (${j.location})`);
    const alreadyTracked = contacts.map((c) => `${c.who} [${c.sector}]`);
    try {
      const j = await llmJSON<{ who?: string; sector?: string; why?: string }>(
        `${formatContextForPrompt(await buildUserContext())}\n\n` +
        `TARGET ROLES:\n${targets.map(t => `- ${t}`).join("\n") || "None yet"}\n\n` +
        `ALREADY TRACKED (don't repeat):\n${alreadyTracked.map(c => `- ${c}`).join("\n") || "None"}\n\n` +
        `EXCLUDE: ${JSON.stringify(exclude)}\n\n` +
        `TASK: Suggest ONE specific type of person who would most advance this job search.\n\n` +
        `REASONING STEPS:\n` +
        `1. Look at the target roles. Which specific companies, sectors, or functions appear?\n` +
        `2. Look at the user's background. What alumni networks, former employers, or professional communities could they tap?\n` +
        `3. Think about WHO is most likely to respond AND most useful: someone at a target company? A former colleague who moved into a target sector? An alumni connection in a relevant geography?\n` +
        `4. Pick the single highest-leverage person type — specific enough to search for (not "someone in the industry"), described by role + where they'd be found.\n` +
        `5. Explain WHY in one sentence: what specific target role does this person unlock, and how?\n\n` +
        `Return ONLY one JSON object: {"who":"<person type + where>","sector":"<short sector tag>","why":"<one sentence: which target role this unlocks and how>"}`,
        { model: MODEL_LIGHT },
      );
      if (!j || typeof j.who !== "string") return res.json({ suggestion: null });
      res.json({
        suggestion: {
          who: String(j.who).slice(0, 100),
          sector: String(j.sector || "").slice(0, 40),
          why: String(j.why || "").slice(0, 160),
        },
      });
    } catch {
      res.status(500).json({ error: "Couldn't think of one right now.", suggestion: null });
    }
  });

  app.post("/api/networking/accept", async (req, res) => {
    const who = String(req.body?.who || "").slice(0, 100);
    if (!who) return res.status(400).json({ error: "Need who" });
    const created = await storage.createContact({
      name: "",
      who,
      sector: String(req.body?.sector || "").slice(0, 40),
      why: String(req.body?.why || "").slice(0, 160),
      status: "to_contact",
      note: "",
    } as any);
    res.json({ ok: true, contact: created });
  });
}
