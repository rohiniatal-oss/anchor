import type { Express } from "express";
import { storage } from "./storage";
import { buildStrategyBuilder } from "./strategyBuilder";

function safeText(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}

export function registerStrategyBuilderRoutes(app: Express) {
  app.get("/api/strategy-builder", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts] = await Promise.all([
      storage.getTasks(),
      storage.getJobs(),
      storage.getLearn(),
      storage.getHustles(),
      storage.getContacts(),
    ]);
    res.json(buildStrategyBuilder(tasks, jobs, learn, hustles, contacts));
  });

  // Accept suggested person type into the CRM without inventing a name.
  app.post("/api/strategy-builder/accept-person", async (req, res) => {
    const category = safeText(req.body?.category, 120);
    if (!category) return res.status(400).json({ error: "Need category" });
    const created = await storage.createContact({
      name: "",
      who: category,
      sector: safeText(req.body?.linkedArchetype || req.body?.sector, 80),
      why: safeText(req.body?.why, 240),
      status: "to_contact",
      note: safeText(req.body?.ask ? `Suggested ask: ${req.body.ask}` : "From Strategy Builder", 300),
      askType: "advice",
    } as any);
    res.json({ ok: true, contact: created });
  });

  // Accept resource category into Learn as a capability-building item.
  app.post("/api/strategy-builder/accept-resource", async (req, res) => {
    const category = safeText(req.body?.category, 180);
    if (!category) return res.status(400).json({ error: "Need category" });
    const created = await storage.createLearn({
      title: category,
      category: safeText(req.body?.linkedArchetype, 80),
      cost: "",
      url: "",
      note: safeText(req.body?.why || "From Strategy Builder", 300),
      done: false,
      active: false,
      type: "resource",
      learnStatus: "open",
      capabilityBuilt: safeText(req.body?.linkedArchetype, 120),
      requiredOutput: safeText(req.body?.output || "A reusable note or proof bullet", 240),
      proofIntent: true,
    } as any);
    res.json({ ok: true, learn: created });
  });

  // Accept proof gap into Hustles/Proof assets.
  app.post("/api/strategy-builder/accept-proof", async (req, res) => {
    const asset = safeText(req.body?.asset, 180);
    if (!asset) return res.status(400).json({ error: "Need asset" });
    const created = await storage.createHustle({
      title: asset,
      note: safeText(`${req.body?.gap || "Proof gap"}. Done when: ${req.body?.doneWhen || "Reusable proof exists."}`, 400),
      nextStep: "Define the claim and smallest reusable output",
      stage: "idea",
      coreClaim: "",
      contentPillar: safeText(req.body?.linkedArchetype, 100),
    } as any);
    res.json({ ok: true, hustle: created });
  });

  // Accept role archetype as a career track and add its next experiment as a task.
  app.post("/api/strategy-builder/accept-role", async (req, res) => {
    const archetype = safeText(req.body?.archetype, 140);
    if (!archetype) return res.status(400).json({ error: "Need archetype" });
    const track = await storage.createCareerTrack({
      name: archetype,
      slug: archetype.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80),
      description: safeText(req.body?.fitLogic, 300),
      targetRoleArchetype: archetype,
      priority: req.body?.priority === "convert" ? 80 : req.body?.priority === "explore" ? 60 : 30,
      status: req.body?.priority === "pause" ? "paused" : "active",
      whyItFits: safeText(req.body?.fitLogic, 300),
    } as any);
    const task = await storage.createTask({
      title: safeText(req.body?.nextExperiment || `Explore ${archetype}`, 180),
      list: "inbox",
      block: null,
      done: false,
      pinned: false,
      steps: "[]",
      sort: 0,
      category: "learning",
      size: "medium",
      status: "not_started",
      skipped: 0,
      doneWhen: "One clear role-family signal is captured",
      sourceType: "career_track",
      sourceId: track.id,
      sourceNote: "From Strategy Builder",
      relatedTrackId: track.id,
    } as any);
    res.json({ ok: true, track, task });
  });

  // Accept a plan shift as an inbox task, not an automatic plan mutation.
  app.post("/api/strategy-builder/accept-shift", async (req, res) => {
    const target = safeText(req.body?.target, 140);
    if (!target) return res.status(400).json({ error: "Need target" });
    const action = safeText(req.body?.action, 30);
    const created = await storage.createTask({
      title: `${action ? action + ": " : ""}${target}`,
      list: "inbox",
      block: null,
      done: false,
      pinned: false,
      steps: "[]",
      sort: 0,
      category: "admin",
      size: "quick",
      status: "not_started",
      skipped: 0,
      doneWhen: "The plan shift is reflected in the system",
      sourceType: "strategy_builder",
      sourceNote: safeText(req.body?.reason || "From Strategy Builder", 300),
    } as any);
    res.json({ ok: true, task: created });
  });
}
