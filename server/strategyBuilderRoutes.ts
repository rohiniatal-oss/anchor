import type { Express } from "express";
import { storage } from "./storage";
import { buildMarketGroundedStrategyBuilder, buildStrategyBuilder } from "./strategyBuilder";
import { buildAllTrackPlans } from "./trackPlanner";

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

  app.get("/api/track-plans", async (_req, res) => {
    const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(), storage.getCareerTracks(),
    ]);
    res.json({ plans: buildAllTrackPlans(tracks, { tasks, jobs, learn, hustles, contacts }) });
  });

  // Backend strategy refresh: market-ground the plan, then reconcile around each
  // active track's actual path-to-conversion. It creates only the next coherent
  // track move, plus narrowly scoped supporting objects, instead of dumping a
  // basket of recommendations into the system.
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
    const allTracks = [...tracks];

    // First, update the strategic track universe from market grounding. This is
    // limited to the top two lanes and does not yet create support clutter.
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
        allTracks.push(track as any);
        trackByName.set(key, track as any);
        created.push(`track:${r.archetype}`);
      }
    }

    // Then reconcile the actual active tracks. The track plan decides the next
    // required move; Strategy Builder only supplies market context.
    const plans = buildAllTrackPlans(allTracks as any, { tasks, jobs, learn, hustles, contacts });
    const topPlans = plans.slice(0, 3);
    for (const plan of topPlans) {
      const need = plan.primaryNeed;
      const title = need.move;
      if (!existingTaskKeys.has(norm(title))) {
        await storage.createTask({
          title,
          list: "inbox",
          block: null,
          done: false,
          pinned: false,
          steps: "[]",
          sort: 0,
          category: need.lane === "Applications" ? "job" : need.lane === "Proof assets" ? "hustle" : need.lane === "Learning" ? "learning" : need.lane === "Network" ? "admin" : "learning",
          size: need.lane === "Proof assets" || need.lane === "Applications" ? "deep" : "medium",
          status: "not_started",
          skipped: 0,
          doneWhen: need.doneWhen,
          sourceType: "strategy_builder",
          sourceStatus: "strategy_refresh",
          sourceNote: `${plan.track.name}: ${need.reason}`,
          relatedTrackId: plan.track.id,
          minimumOutcome: need.doneWhen,
        } as any);
        existingTaskKeys.add(norm(title));
        created.push(`track_move:${plan.track.name}:${need.lane}`);
      }

      // Create exactly one missing support object for the primary bottleneck,
      // linked to the same track, so the plan has structure not loose ideas.
      if (need.lane === "Network") {
        const person = strategy.peopleMap.find((p) => norm(p.linkedArchetype) === norm(plan.track.name) || norm(p.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { category: `${plan.track.name} insider`, why: `Reality-check ${plan.track.name}`, ask: "Ask what profiles actually get hired and what proof matters.", linkedArchetype: plan.track.name };
        if (!existingContactKeys.has(norm(person.category))) {
          await storage.createContact({
            name: "", who: person.category, sector: plan.track.name, why: safeText(person.why, 240), status: "to_contact",
            note: safeText(`Suggested ask: ${person.ask}`, 300), askType: "advice", relatedTrackId: plan.track.id,
          } as any);
          existingContactKeys.add(norm(person.category));
          created.push(`contact:${person.category}`);
        }
      }

      if (need.lane === "Learning") {
        const resource = strategy.resourceMap.find((r) => norm(r.linkedArchetype) === norm(plan.track.name) || norm(r.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { category: `${plan.track.name} resource with required output`, why: `Close capability gap for ${plan.track.name}`, output: "A reusable note or proof bullet", linkedArchetype: plan.track.name };
        if (!existingLearnKeys.has(norm(resource.category))) {
          await storage.createLearn({
            title: resource.category, category: plan.track.name, cost: "", url: "", note: safeText(resource.why, 300), done: false,
            active: false, type: "resource", learnStatus: "open", capabilityBuilt: plan.track.name,
            requiredOutput: safeText(resource.output || "A reusable note or proof bullet", 240), proofIntent: true, relatedTrackId: plan.track.id,
          } as any);
          existingLearnKeys.add(norm(resource.category));
          created.push(`learn:${resource.category}`);
        }
      }

      if (need.lane === "Proof assets") {
        const proof = strategy.proofGaps.find((p) => norm(p.linkedArchetype) === norm(plan.track.name) || norm(p.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { asset: `Reusable proof asset for ${plan.track.name}`, gap: `Evidence gap for ${plan.track.name}`, doneWhen: "A reusable paragraph, link, or bullet exists", linkedArchetype: plan.track.name };
        if (!existingProofKeys.has(norm(proof.asset))) {
          await storage.createHustle({
            title: proof.asset, note: safeText(`${proof.gap}. Done when: ${proof.doneWhen}`, 400), nextStep: "Define the claim and smallest reusable output",
            stage: "idea", coreClaim: "", contentPillar: plan.track.name, proofAssetForTrack: plan.track.id,
          } as any);
          existingProofKeys.add(norm(proof.asset));
          created.push(`proof:${proof.asset}`);
        }
      }
    }

    res.json({
      ok: true,
      created,
      strategyStatus: strategy.marketGroundingStatus,
      marketGroundedAt: strategy.marketGroundedAt,
      reconciledTracks: topPlans.map((p) => ({ track: p.track.name, stage: p.stage, health: p.health, primaryNeed: p.primaryNeed, redundant: p.redundant })),
    });
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
