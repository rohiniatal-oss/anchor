import type { Express } from "express";
import { storage } from "./storage";
import { buildMarketGroundedStrategyBuilder, buildStrategyBuilder } from "./strategyBuilder";

function safeText(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}
function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function registerStrategyBuilderRoutes(app: Express) {
  app.get("/api/strategy-builder", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(),
    ]);
    res.json(buildStrategyBuilder(tasks, jobs, learn, hustles, contacts));
  });

  // Backend strategy refresh: market-ground the plan, quietly add only a small
  // number of missing strategic objects, then Today can recompute from the new system.
  // This is deliberately conservative and deduped — no visible review panel needed.
  app.post("/api/strategy-builder/apply", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(), storage.getCareerTracks(),
    ]);
    const strategy = await buildMarketGroundedStrategyBuilder(tasks, jobs, learn, hustles, contacts);
    const created: string[] = [];

    const existingTrackKeys = new Set(tracks.map((t) => norm(`${t.name} ${t.targetRoleArchetype}`)));
    const existingTaskKeys = new Set(tasks.filter((t) => !t.done).map((t) => norm(t.title)));
    const existingContactKeys = new Set(contacts.map((c) => norm(`${c.who} ${c.targetRole}`)));
    const existingLearnKeys = new Set(learn.map((l) => norm(`${l.title} ${l.capabilityBuilt}`)));
    const existingProofKeys = new Set(hustles.map((h) => norm(`${h.title} ${h.coreClaim}`)));

    const trackByName = new Map(tracks.map((t) => [norm(t.name), t]));

    for (const r of strategy.roleArchetypes.filter((x) => x.priority === "explore" || x.priority === "convert").slice(0, 2)) {
      const key = norm(r.archetype);
      let track = trackByName.get(key);
      if (!track && !existingTrackKeys.has(key)) {
        track = await storage.createCareerTrack({
          name: r.archetype,
          slug: slug(r.archetype),
          description: safeText(`${r.fitLogic}${r.marketSignal ? " Market signal: " + r.marketSignal : ""}`, 420),
          targetRoleArchetype: r.archetype,
          priority: r.priority === "convert" ? 80 : 60,
          status: "active",
          whyItFits: safeText(r.fitLogic, 300),
        } as any);
        created.push(`track:${r.archetype}`);
      }
      if (track && !existingTaskKeys.has(norm(r.nextExperiment))) {
        await storage.createTask({
          title: r.nextExperiment,
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
          sourceNote: "Market-grounded strategy refresh",
          relatedTrackId: track.id,
        } as any);
        created.push(`task:${r.nextExperiment}`);
      }
    }

    for (const p of strategy.peopleMap.slice(0, 2)) {
      if (!existingContactKeys.has(norm(p.category))) {
        await storage.createContact({
          name: "",
          who: p.category,
          sector: p.linkedArchetype,
          why: safeText(p.why, 240),
          status: "to_contact",
          note: safeText(`Suggested ask: ${p.ask}`, 300),
          askType: "advice",
        } as any);
        created.push(`contact:${p.category}`);
      }
    }

    for (const r of strategy.resourceMap.slice(0, 1)) {
      if (!existingLearnKeys.has(norm(r.category))) {
        await storage.createLearn({
          title: r.category,
          category: r.linkedArchetype,
          cost: "",
          url: "",
          note: safeText(r.why, 300),
          done: false,
          active: false,
          type: "resource",
          learnStatus: "open",
          capabilityBuilt: r.linkedArchetype,
          requiredOutput: safeText(r.output || "A reusable note or proof bullet", 240),
          proofIntent: true,
        } as any);
        created.push(`learn:${r.category}`);
      }
    }

    for (const p of strategy.proofGaps.slice(0, 1)) {
      if (!existingProofKeys.has(norm(p.asset))) {
        await storage.createHustle({
          title: p.asset,
          note: safeText(`${p.gap}. Done when: ${p.doneWhen}`, 400),
          nextStep: "Define the claim and smallest reusable output",
          stage: "idea",
          coreClaim: "",
          contentPillar: p.linkedArchetype,
        } as any);
        created.push(`proof:${p.asset}`);
      }
    }

    res.json({ ok: true, created, strategyStatus: strategy.marketGroundingStatus, marketGroundedAt: strategy.marketGroundedAt });
  });

  app.post("/api/strategy-builder/accept-person", async (req, res) => {
    const category = safeText(req.body?.category, 120);
    if (!category) return res.status(400).json({ error: "Need category" });
    const created = await storage.createContact({ name: "", who: category, sector: safeText(req.body?.linkedArchetype || req.body?.sector, 80), why: safeText(req.body?.why, 240), status: "to_contact", note: safeText(req.body?.ask ? `Suggested ask: ${req.body.ask}` : "From Strategy Builder", 300), askType: "advice" } as any);
    res.json({ ok: true, contact: created });
  });

  app.post("/api/strategy-builder/accept-resource", async (req, res) => {
    const category = safeText(req.body?.category, 180);
    if (!category) return res.status(400).json({ error: "Need category" });
    const created = await storage.createLearn({ title: category, category: safeText(req.body?.linkedArchetype, 80), cost: "", url: "", note: safeText(req.body?.why || "From Strategy Builder", 300), done: false, active: false, type: "resource", learnStatus: "open", capabilityBuilt: safeText(req.body?.linkedArchetype, 120), requiredOutput: safeText(req.body?.output || "A reusable note or proof bullet", 240), proofIntent: true } as any);
    res.json({ ok: true, learn: created });
  });

  app.post("/api/strategy-builder/accept-proof", async (req, res) => {
    const asset = safeText(req.body?.asset, 180);
    if (!asset) return res.status(400).json({ error: "Need asset" });
    const created = await storage.createHustle({ title: asset, note: safeText(`${req.body?.gap || "Proof gap"}. Done when: ${req.body?.doneWhen || "Reusable proof exists."}`, 400), nextStep: "Define the claim and smallest reusable output", stage: "idea", coreClaim: "", contentPillar: safeText(req.body?.linkedArchetype, 100) } as any);
    res.json({ ok: true, hustle: created });
  });

  app.post("/api/strategy-builder/accept-role", async (req, res) => {
    const archetype = safeText(req.body?.archetype, 140);
    if (!archetype) return res.status(400).json({ error: "Need archetype" });
    const track = await storage.createCareerTrack({ name: archetype, slug: slug(archetype), description: safeText(req.body?.fitLogic, 300), targetRoleArchetype: archetype, priority: req.body?.priority === "convert" ? 80 : req.body?.priority === "explore" ? 60 : 30, status: req.body?.priority === "pause" ? "paused" : "active", whyItFits: safeText(req.body?.fitLogic, 300) } as any);
    const task = await storage.createTask({ title: safeText(req.body?.nextExperiment || `Explore ${archetype}`, 180), list: "inbox", block: null, done: false, pinned: false, steps: "[]", sort: 0, category: "learning", size: "medium", status: "not_started", skipped: 0, doneWhen: "One clear role-family signal is captured", sourceType: "career_track", sourceId: track.id, sourceNote: "From Strategy Builder", relatedTrackId: track.id } as any);
    res.json({ ok: true, track, task });
  });

  app.post("/api/strategy-builder/accept-shift", async (req, res) => {
    const target = safeText(req.body?.target, 140);
    if (!target) return res.status(400).json({ error: "Need target" });
    const action = safeText(req.body?.action, 30);
    const created = await storage.createTask({ title: `${action ? action + ": " : ""}${target}`, list: "inbox", block: null, done: false, pinned: false, steps: "[]", sort: 0, category: "admin", size: "quick", status: "not_started", skipped: 0, doneWhen: "The plan shift is reflected in the system", sourceType: "strategy_builder", sourceNote: safeText(req.body?.reason || "From Strategy Builder", 300) } as any);
    res.json({ ok: true, task: created });
  });
}
