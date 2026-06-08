import type { Express } from "express";
import { storage } from "./storage";
import { buildMarketGroundedStrategyBuilder, buildStrategyBuilder } from "./strategyBuilder";
import { buildAllTrackPlans, type TrackNeed } from "./trackPlanner";

function safeText(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}
function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function categoryForNeed(need: TrackNeed) {
  return need.lane === "Applications" ? "job" : need.lane === "Proof assets" ? "hustle" : need.lane === "Learning" ? "learning" : need.lane === "Network" ? "admin" : "learning";
}
function sizeForNeed(need: TrackNeed) {
  if (need.kind === "ongoing") return "quick";
  return need.lane === "Applications" ? "deep" : need.lane === "Proof assets" ? "medium" : "medium";
}
async function createTrackMoveIfMissing(args: {
  need: TrackNeed;
  track: any;
  existingTaskKeys: Set<string>;
  created: string[];
  label: "anchor" | "support" | "ongoing" | "cleanup";
}) {
  const { need, track, existingTaskKeys, created, label } = args;
  const title = need.move;
  if (existingTaskKeys.has(norm(title))) return;
  await storage.createTask({
    title,
    list: "inbox",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: categoryForNeed(need),
    size: sizeForNeed(need),
    status: "not_started",
    skipped: 0,
    doneWhen: need.doneWhen,
    sourceType: "strategy_builder",
    sourceStatus: `strategy_refresh:${label}`,
    sourceNote: `${track.name}: ${need.reason}`,
    relatedTrackId: track.id,
    minimumOutcome: need.doneWhen,
  } as any);
  existingTaskKeys.add(norm(title));
  created.push(`track_${label}:${track.name}:${need.lane}`);
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

  // Backend strategy refresh: market-ground the track universe, then reconcile each
  // active track into a sequence. Applications can be the anchor when fit/readiness
  // is strong; proof, learning, and networking remain support/ongoing moves rather
  // than hard prerequisites.
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

    const plans = buildAllTrackPlans(allTracks as any, { tasks, jobs, learn, hustles, contacts });
    const topPlans = plans.slice(0, 3);
    for (const plan of topPlans) {
      await createTrackMoveIfMissing({ need: plan.sequence.anchor, track: plan.track, existingTaskKeys, created, label: "anchor" });
      for (const support of plan.sequence.next.slice(0, 1)) {
        await createTrackMoveIfMissing({ need: support, track: plan.track, existingTaskKeys, created, label: "support" });
      }
      // Ongoing proof/learning is created only for the highest-priority track and
      // only as a small background move, so it strengthens the track without
      // crowding out applications.
      if (plan === topPlans[0]) {
        for (const ongoing of plan.sequence.ongoing.slice(0, 1)) {
          await createTrackMoveIfMissing({ need: ongoing, track: plan.track, existingTaskKeys, created, label: "ongoing" });
        }
      }

      const supportNeeds = [plan.sequence.anchor, ...plan.sequence.next, ...plan.sequence.ongoing];
      const needsNetworkSupport = supportNeeds.some((n) => n.lane === "Network");
      const needsLearningSupport = supportNeeds.some((n) => n.lane === "Learning");
      const needsProofSupport = supportNeeds.some((n) => n.lane === "Proof assets");

      if (needsNetworkSupport) {
        const person = strategy.peopleMap.find((p) => norm(p.linkedArchetype) === norm(plan.track.name) || norm(p.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { category: `${plan.track.name} insider`, why: `Reality-check ${plan.track.name}`, ask: "Ask what profiles actually get hired and which capability signals matter.", linkedArchetype: plan.track.name };
        if (!existingContactKeys.has(norm(person.category))) {
          await storage.createContact({
            name: "", who: person.category, sector: plan.track.name, why: safeText(person.why, 240), status: "to_contact",
            note: safeText(`Suggested ask: ${person.ask}`, 300), askType: "advice", relatedTrackId: plan.track.id,
          } as any);
          existingContactKeys.add(norm(person.category));
          created.push(`contact:${person.category}`);
        }
      }

      if (needsLearningSupport) {
        const resource = strategy.resourceMap.find((r) => norm(r.linkedArchetype) === norm(plan.track.name) || norm(r.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { category: `${plan.track.name} resource with required output`, why: `Close capability gap for ${plan.track.name}`, output: "A reusable note or proof bullet", linkedArchetype: plan.track.name };
        if (!existingLearnKeys.has(norm(resource.category))) {
          await storage.createLearn({
            title: resource.category, category: plan.track.name, cost: "", url: "", note: safeText(resource.why, 300), done: false,
            active: false, type: "resource", learnStatus: "open", capabilityBuilt: plan.track.name,
            requiredOutput: safeText(resource.output || "A reusable note, paragraph, or interview example", 240), proofIntent: true, relatedTrackId: plan.track.id,
          } as any);
          existingLearnKeys.add(norm(resource.category));
          created.push(`learn:${resource.category}`);
        }
      }

      if (needsProofSupport) {
        const support = strategy.capabilitySupport.find((p) => norm(p.linkedArchetype) === norm(plan.track.name) || norm(p.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { asset: `Reusable capability-support asset for ${plan.track.name}`, need: `Capability-support gap for ${plan.track.name}`, doneWhen: "A reusable paragraph, link, bullet, or interview example exists", linkedArchetype: plan.track.name };
        if (!existingProofKeys.has(norm(support.asset))) {
          await storage.createHustle({
            title: support.asset, note: safeText(`${support.need}. Done when: ${support.doneWhen}`, 400), nextStep: "Define the claim and smallest reusable output",
            stage: "idea", coreClaim: "", contentPillar: plan.track.name, proofAssetForTrack: plan.track.id,
          } as any);
          existingProofKeys.add(norm(support.asset));
          created.push(`support:${support.asset}`);
        }
      }
    }

    res.json({
      ok: true,
      created,
      strategyStatus: strategy.marketGroundingStatus,
      marketGroundedAt: strategy.marketGroundedAt,
      reconciledTracks: topPlans.map((p) => ({
        track: p.track.name,
        stage: p.stage,
        health: p.health,
        sequence: p.sequence,
        redundant: p.redundant,
      })),
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
    const created = await storage.createLearn({ title: category, category: safeText(req.body?.linkedArchetype, 80), cost: "", url: "", note: safeText(req.body?.why || "From Strategy Builder", 300), done: false, active: false, type: "resource", learnStatus: "open", capabilityBuilt: safeText(req.body?.linkedArchetype, 120), requiredOutput: safeText(req.body?.output || "A reusable note, paragraph, or interview example", 240), proofIntent: true } as any);
    res.json({ ok: true, learn: created });
  });

  async function acceptSupport(req: any, res: any) {
    const asset = safeText(req.body?.asset, 180);
    if (!asset) return res.status(400).json({ error: "Need asset" });
    const created = await storage.createHustle({ title: asset, note: safeText(`${req.body?.need || req.body?.gap || "Capability-support gap"}. Done when: ${req.body?.doneWhen || "Reusable capability support exists."}`, 400), nextStep: "Define the claim and smallest reusable output", stage: "idea", coreClaim: "", contentPillar: safeText(req.body?.linkedArchetype, 100) } as any);
    res.json({ ok: true, hustle: created });
  }
  app.post("/api/strategy-builder/accept-support", acceptSupport);
  app.post("/api/strategy-builder/accept-proof", acceptSupport);

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
