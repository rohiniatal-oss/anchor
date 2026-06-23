import type { Express } from "express";
import { taskCategoryForPlannerLane } from "./lanes";
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
function learningFocusForArchetype(value: string) {
  const text = norm(value || "");
  if (/ai|technology|frontier|safety|governance/.test(text)) return "AI governance, strategy, and policy judgment";
  if (/chief of staff|founder office|operations|operating|operator/.test(text)) return "Operating cadence, decision support, and execution follow-through";
  if (/philanthropy|development|funder|foundation|global development/.test(text)) return "Strategy judgment, policy framing, and stakeholder communication";
  return "Geopolitical, policy, and strategic judgment";
}
function findTrackIdByArchetype(tracks: any[], linkedArchetype: string) {
  const key = norm(linkedArchetype || "");
  if (!key) return null;
  const match = tracks.find((track) => norm(track.name || "") === key || norm(track.targetRoleArchetype || "") === key);
  return match?.id ?? null;
}

function categoryForNeed(need: TrackNeed) { return taskCategoryForPlannerLane(need.lane); }
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
    const [tasks, jobs, learn, hustles, contacts, wins, tracks] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(), storage.getWins(), storage.getCareerTracks(),
    ]);
    res.json(buildStrategyBuilder(tasks, jobs, learn, hustles, contacts, wins, tracks));
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
    const [tasks, jobs, learn, hustles, contacts, tracks, wins] = await Promise.all([
      storage.getTasks(), storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(), storage.getCareerTracks(), storage.getWins(),
    ]);
    const strategy = await buildMarketGroundedStrategyBuilder(tasks, jobs, learn, hustles, contacts, wins, tracks);
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
          description: safeText(`${r.fitLogic}${r.marketSignal ? " Why it exists now: " + r.marketSignal : ""}`, 420),
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
      const needsExampleProjectIdea = supportNeeds.some((n) => n.lane === "Proof assets");

      if (needsNetworkSupport) {
        const person = strategy.peopleMap.find((p) => norm(p.linkedArchetype) === norm(plan.track.name) || norm(p.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { category: `${plan.track.name} insider`, why: `Reality-check ${plan.track.name}`, ask: "Ask what profiles actually get hired and which requirements matter most.", linkedArchetype: plan.track.name };
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
          || {
            category: `${plan.track.name} learning item`,
            why: `Give ${plan.track.name} one concrete learning item Anchor can turn into interview or application support`,
            output: "A useful note, checklist, or interview example",
            linkedArchetype: plan.track.name,
          };
        const capabilityBuilt = learningFocusForArchetype(resource.linkedArchetype || plan.track.targetRoleArchetype || plan.track.name);
        if (!existingLearnKeys.has(norm(resource.category))) {
          await storage.createLearn({
            title: resource.category, category: capabilityBuilt, cost: "", url: "", note: safeText(`${resource.why}. Optional useful result: ${resource.output || "A useful note or interview example"}`, 300), done: false,
            active: false, type: "resource", learnStatus: "open", capabilityBuilt,
            requiredOutput: "", proofIntent: false, relatedTrackId: plan.track.id,
          } as any);
          existingLearnKeys.add(norm(resource.category));
          created.push(`learn:${resource.category}`);
        }
      }

      if (needsExampleProjectIdea) {
        const support = strategy.exampleProjectIdeas.find((p) => norm(p.linkedArchetype) === norm(plan.track.name) || norm(p.linkedArchetype) === norm(plan.track.targetRoleArchetype))
          || { asset: `Optional writing or project example for ${plan.track.name}`, need: `This path may benefit from one clearer example, note, or project`, doneWhen: "A paragraph, link, bullet, or interview example exists that you can point to later", linkedArchetype: plan.track.name };
        if (!existingProofKeys.has(norm(support.asset))) {
          await storage.createHustle({
            title: support.asset, note: safeText(`${support.need}. Done when: ${support.doneWhen}`, 400), nextStep: "Define the angle and smallest useful version",
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
    const tracks = await storage.getCareerTracks();
    const relatedTrackId = findTrackIdByArchetype(tracks, safeText(req.body?.linkedArchetype || req.body?.sector, 140));
    const created = await storage.createContact({ name: "", who: category, sector: safeText(req.body?.linkedArchetype || req.body?.sector, 80), why: safeText(req.body?.why, 240), status: "to_contact", note: safeText(req.body?.ask ? `Suggested ask: ${req.body.ask}` : "From Strategy Builder", 300), askType: "advice", relatedTrackId, targetRole: safeText(req.body?.linkedArchetype, 140) } as any);
    res.json({ ok: true, contact: created });
  });

  app.post("/api/strategy-builder/accept-resource", async (req, res) => {
    const category = safeText(req.body?.category, 180);
    if (!category) return res.status(400).json({ error: "Need category" });
    const tracks = await storage.getCareerTracks();
    const linkedArchetype = safeText(req.body?.linkedArchetype, 140);
    const relatedTrackId = findTrackIdByArchetype(tracks, linkedArchetype);
    const capabilityBuilt = learningFocusForArchetype(linkedArchetype);
    const created = await storage.createLearn({ title: category, category: capabilityBuilt, cost: "", url: "", note: safeText(`${req.body?.why || "From Strategy Builder"}. Optional useful result: ${req.body?.output || "A useful note or interview example"}`, 300), done: false, active: false, type: "resource", learnStatus: "open", capabilityBuilt, requiredOutput: "", proofIntent: false, relatedTrackId } as any);
    res.json({ ok: true, learn: created });
  });

  async function acceptSupport(req: any, res: any) {
    const asset = safeText(req.body?.asset, 180);
    if (!asset) return res.status(400).json({ error: "Need asset" });
    const tracks = await storage.getCareerTracks();
    const linkedArchetype = safeText(req.body?.linkedArchetype, 140);
    const proofAssetForTrack = findTrackIdByArchetype(tracks, linkedArchetype);
    const created = await storage.createHustle({ title: asset, note: safeText(`${req.body?.need || req.body?.gap || "Optional support idea"}. Done when: ${req.body?.doneWhen || "A useful example, note, or project exists."}`, 400), nextStep: "Define the angle and smallest useful version", stage: "idea", coreClaim: "", contentPillar: linkedArchetype, proofAssetForTrack } as any);
    res.json({ ok: true, hustle: created });
  }
  app.post("/api/strategy-builder/accept-support", acceptSupport);
  app.post("/api/strategy-builder/accept-example", acceptSupport);
  app.post("/api/strategy-builder/accept-proof", acceptSupport);

  app.post("/api/strategy-builder/accept-role", async (req, res) => {
    const archetype = safeText(req.body?.archetype, 140);
    if (!archetype) return res.status(400).json({ error: "Need archetype" });
    const track = await storage.createCareerTrack({ name: archetype, slug: slug(archetype), description: safeText(req.body?.fitLogic, 300), targetRoleArchetype: archetype, priority: req.body?.priority === "convert" ? 80 : req.body?.priority === "explore" ? 60 : 30, status: req.body?.priority === "pause" ? "paused" : "active", whyItFits: safeText(req.body?.fitLogic, 300) } as any);
    const taskTitle = safeText(req.body?.nextExperiment || `Save one real ${archetype} posting with JD text so Anchor can compare it to your profile`, 180);
    const credGap = safeText(req.body?.credibilityGap, 200);
    const firstStep = `Open LinkedIn or Indeed and search "${archetype}"`;
    const secondStep = credGap
      ? `Save one realistic posting with JD text so Anchor can compare it against this possible gap: ${credGap}`
      : `Save one realistic posting with JD text so Anchor can extract the strongest asks`;
    const task = await storage.createTask({ title: taskTitle, list: "inbox", block: null, done: false, pinned: false, steps: JSON.stringify([{ text: firstStep, done: false }, { text: secondStep, done: false }]), sort: 0, category: "job", size: "medium", status: "not_started", skipped: 0, doneWhen: `One real ${archetype} posting is saved with enough JD text for Anchor to compare it to your profile`, sourceType: "career_track", sourceId: track.id, sourceNote: credGap ? `Credibility gap: ${credGap}` : "From Strategy Builder", relatedTrackId: track.id } as any);
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
