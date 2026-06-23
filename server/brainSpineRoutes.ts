import type { Express } from "express";
import { storage } from "./storage";
import { planDay, recommend } from "./brain";
import { enrichPlanItems, buildLearnMilestoneProgress } from "./planItemEnrichment";

function validEnergy(value: unknown): "low" | "medium" | "high" {
  return ["low", "medium", "high"].includes(String(value)) ? String(value) as any : "medium";
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

async function readBrainInputs(day?: string) {
  const [tasks, jobs, learn, hustles, contacts, tracks, events, jobContactLinks, profile, wins] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getCareerTracks(),
    day ? storage.getEvents(day) : Promise.resolve([]),
    storage.getAllJobContactLinks(),
    storage.getProfile(),
    storage.getWins(),
  ]);
  return { tasks, jobs, learn, hustles, contacts, tracks, events, jobContactLinks, profile, wins };
}

async function buildAndPersistPlan(day: string, energy: "low" | "medium" | "high") {
  const inputs = await readBrainInputs(day);
  const busy = await busyMinutesFor(day);
  const learnMilestoneProgress = await buildLearnMilestoneProgress(inputs.learn);
  const r = planDay(inputs.tasks, inputs.jobs, inputs.learn, inputs.hustles, energy, busy, inputs.contacts, inputs.tracks, learnMilestoneProgress, inputs.jobContactLinks, inputs.profile, inputs.wins);
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
  return { result: r, plan: await storage.getPlanByDate(day), busyMinutes: busy, events: inputs.events };
}

export function registerBrainSpineRoutes(app: Express) {
  app.post("/api/brain/recommend", async (req, res, next) => {
    try {
      const energy = validEnergy(req.body?.energy);
      const inputs = await readBrainInputs();
      res.json(recommend(inputs.tasks, inputs.jobs, inputs.learn, inputs.hustles, energy, inputs.contacts, inputs.tracks, inputs.jobContactLinks, inputs.profile, inputs.wins));
    } catch (err) { next(err); }
  });

  app.post("/api/brain/plan", async (req, res, next) => {
    try {
      const energy = validEnergy(req.body?.energy);
      const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
      const inputs = await readBrainInputs(day);
      const busy = await busyMinutesFor(day);
      const learnMilestoneProgress = await buildLearnMilestoneProgress(inputs.learn);
      const r = planDay(inputs.tasks, inputs.jobs, inputs.learn, inputs.hustles, energy, busy, inputs.contacts, inputs.tracks, learnMilestoneProgress, inputs.jobContactLinks, inputs.profile, inputs.wins);
      res.json({ ...r, busyMinutes: busy, events: inputs.events });
    } catch (err) { next(err); }
  });

  app.get("/api/plan/current", async (req, res, next) => {
    try {
      const day = String(req.query.day || new Date().toISOString().slice(0, 10));
      const energy = validEnergy(req.query.energy);
      let plan = await storage.getPlanByDate(day);
      if (!plan) await buildAndPersistPlan(day, energy);
      plan = await storage.getPlanByDate(day);
      const items = plan ? await storage.getPlanItems(plan.id) : [];
      const events = await storage.getEvents(day);
      res.json({ plan, items: await enrichPlanItems(items), events });
    } catch (err) { next(err); }
  });

  app.post("/api/plan/recompute", async (req, res, next) => {
    try {
      const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
      const energy = validEnergy(req.body?.energy);
      await buildAndPersistPlan(day, energy);
      const plan = await storage.getPlanByDate(day);
      const items = plan ? await storage.getPlanItems(plan.id) : [];
      res.json({ plan, items: await enrichPlanItems(items) });
    } catch (err) { next(err); }
  });
}
