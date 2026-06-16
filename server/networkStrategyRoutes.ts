import type { Express } from "express";
import { storage } from "./storage";
import {
  generateNetworkGaps,
  classifyContact,
  computeRecommendedMove,
  draftOutreachMessage,
  computeBestNetworkingMove,
  computeNextAction,
  type ArchetypeKey,
  ARCHETYPE_META,
} from "./networkStrategy";

function ymdFromMs(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function registerNetworkStrategyRoutes(app: Express) {
  // GET /api/networking/gaps — all stored gaps (optionally filter by trackId)
  app.get("/api/networking/gaps", async (req, res) => {
    const trackId = req.query.trackId ? Number(req.query.trackId) : undefined;
    const gaps = await storage.getNetworkGaps(trackId);
    res.json({ gaps });
  });

  // POST /api/networking/generate-gaps/:trackId — AI generates gaps for a track
  app.post("/api/networking/generate-gaps/:trackId", async (req, res) => {
    const trackId = Number(req.params.trackId);
    if (!Number.isFinite(trackId)) return res.status(400).json({ error: "Bad trackId" });

    const [tracks, contacts] = await Promise.all([
      storage.getCareerTracks(),
      storage.getContacts(),
    ]);
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return res.status(404).json({ error: "Track not found" });

    try {
      const gaps = await generateNetworkGaps(track, contacts);
      if (gaps.length === 0) return res.status(500).json({ error: "Could not generate gaps right now." });

      const stored = await storage.upsertNetworkGaps(trackId, gaps.map((g) => ({
        trackId,
        archetype: g.archetype,
        priority: g.priority,
        reason: g.reason,
        whyItMatters: g.whyItMatters,
        whatToAsk: g.whatToAsk,
        suggestedSearches: JSON.stringify(g.suggestedSearches),
        createdAt: Date.now(),
      })));
      res.json({ gaps: stored });
    } catch {
      res.status(500).json({ error: "Could not generate gaps right now." });
    }
  });

  // GET /api/networking/classifications — all stored contact classifications
  app.get("/api/networking/classifications", async (_req, res) => {
    const classifications = await storage.getContactClassifications();
    res.json({ classifications });
  });

  // POST /api/networking/classify-contact/:contactId — AI classifies a contact
  app.post("/api/networking/classify-contact/:contactId", async (req, res) => {
    const contactId = Number(req.params.contactId);
    if (!Number.isFinite(contactId)) return res.status(400).json({ error: "Bad contactId" });

    const [contacts, tracks] = await Promise.all([
      storage.getContacts(),
      storage.getCareerTracks(),
    ]);
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const activeTracks = tracks.filter((t) => t.status === "active");
    if (activeTracks.length === 0) return res.json({ classifications: [] });

    try {
      const results = await classifyContact(contact, activeTracks);
      const stored = await storage.upsertContactClassifications(
        contactId,
        results.map((r) => ({
          contactId,
          trackId: r.trackId,
          archetype: r.archetype,
          relevanceScore: r.relevanceScore,
          accessTypes: JSON.stringify(r.accessTypes),
          reasoning: r.reasoning,
          createdAt: Date.now(),
        })),
      );
      res.json({ classifications: stored });
    } catch {
      res.status(500).json({ error: "Could not classify right now." });
    }
  });

  // POST /api/contacts/:id/recommend-move — compute best networking move
  app.post("/api/contacts/:id/recommend-move", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });

    const [contacts, tracks, jobs, allClassifications] = await Promise.all([
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getJobs(),
      storage.getContactClassifications(id),
    ]);
    const contact = contacts.find((c) => c.id === id);
    if (!contact) return res.status(404).json({ error: "Not found" });

    const bestCls = allClassifications
      .sort((a, b) => b.relevanceScore - a.relevanceScore)[0] ?? null;
    const track = bestCls ? tracks.find((t) => t.id === bestCls.trackId) ?? null : null;

    const clsForMove = bestCls ? {
      archetype: bestCls.archetype as ArchetypeKey,
      relevanceScore: bestCls.relevanceScore,
      accessTypes: JSON.parse(bestCls.accessTypes || "[]"),
      reasoning: bestCls.reasoning,
    } : null;

    try {
      const move = await computeRecommendedMove(contact, clsForMove, track, jobs);
      res.json({ move, track: track ? { id: track.id, name: track.name } : null });
    } catch {
      res.status(500).json({ error: "Could not compute move right now." });
    }
  });

  // POST /api/contacts/:id/draft-message — draft outreach message
  app.post("/api/contacts/:id/draft-message", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });

    const userContext = String(req.body?.context || "").trim().slice(0, 1000);

    const [contacts, tracks, jobs, allClassifications] = await Promise.all([
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getJobs(),
      storage.getContactClassifications(id),
    ]);
    const contact = contacts.find((c) => c.id === id);
    if (!contact) return res.status(404).json({ error: "Not found" });

    const bestCls = allClassifications
      .sort((a, b) => b.relevanceScore - a.relevanceScore)[0] ?? null;
    const track = bestCls ? tracks.find((t) => t.id === bestCls.trackId) ?? null : null;

    const clsForMove = bestCls ? {
      archetype: bestCls.archetype as ArchetypeKey,
      relevanceScore: bestCls.relevanceScore,
      accessTypes: JSON.parse(bestCls.accessTypes || "[]"),
      reasoning: bestCls.reasoning,
    } : null;

    try {
      const move = await computeRecommendedMove(contact, clsForMove, track, jobs);
      const draft = await draftOutreachMessage(contact, move, track, userContext);
      if (!draft) {
        return res.json({ draft: "", error: "Could not generate a draft right now." });
      }
      res.json({ draft, move, track: track ? { id: track.id, name: track.name } : null });
    } catch {
      res.status(500).json({ error: "Could not generate a draft right now." });
    }
  });

  // GET /api/networking/best-move — single best networking action across all contacts
  app.get("/api/networking/best-move", async (_req, res) => {
    const [contacts, tracks, jobs, classifications] = await Promise.all([
      storage.getContacts(),
      storage.getCareerTracks(),
      storage.getJobs(),
      storage.getContactClassifications(),
    ]);

    if (contacts.length === 0) return res.json({ bestMove: null });

    try {
      const result = await computeBestNetworkingMove(
        contacts,
        classifications.map((c) => ({
          contactId: c.contactId,
          trackId: c.trackId,
          archetype: c.archetype as ArchetypeKey,
          relevanceScore: c.relevanceScore,
          reasoning: c.reasoning,
        })),
        jobs,
        tracks,
      );
      res.json({ bestMove: result ? { contact: result.contact, move: result.move, track: result.track, reason: result.reason } : null });
    } catch {
      res.json({ bestMove: null });
    }
  });

  // GET /api/contacts/:id/interactions — list interactions for a contact
  app.get("/api/contacts/:id/interactions", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const interactions = await storage.getContactInteractions(id);
    res.json(interactions);
  });

  // POST /api/contacts/:id/log-interaction — log an interaction and compute next action
  app.post("/api/contacts/:id/log-interaction", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const contacts = await storage.getContacts();
    const contact = contacts.find((c: any) => c.id === id);
    if (!contact) return res.status(404).json({ error: "Not found" });

    const type = String(req.body?.type || "");
    const validTypes = ["outreach", "response", "meeting", "intro", "referral", "declined", "note"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: "Invalid type" });

    const note = String(req.body?.note || "").slice(0, 300);

    // Log the interaction
    const interaction = await storage.createContactInteraction({ contactId: id, type: type as any, note });

    // Auto-create Win for positive outcomes
    if (["meeting", "intro", "referral"].includes(type)) {
      const winText =
        type === "meeting" ? `Had a networking meeting: ${(contact as any).who || (contact as any).name}`
        : type === "intro" ? `Got an intro via ${(contact as any).who || (contact as any).name}`
        : `Got a referral from ${(contact as any).who || (contact as any).name}`;
      await storage.createWin({ text: winText, winCategory: "network", kind: "spontaneous", trackId: (contact as any).relatedTrackId ?? undefined } as any);
    }

    // Get classification for archetype (uses stored classifications if available)
    const classifications = await storage.getContactClassifications(id);
    const topCls = classifications.sort((a, b) => b.relevanceScore - a.relevanceScore)[0];
    const archetype = (topCls?.archetype ?? null) as ArchetypeKey | null;

    // Compute next action
    const nextAction = computeNextAction(type as any, archetype);
    const now = Date.now();
    const contactPatch: Record<string, unknown> = {};

    if (type === "outreach") {
      contactPatch.status = "messaged";
      contactPatch.outreachedAt = now;
    } else if (type === "response") {
      contactPatch.status = "replied";
      contactPatch.repliedAt = now;
    } else if (type === "meeting" || type === "intro" || type === "referral") {
      contactPatch.status = "replied";
      if (!(contact as any).repliedAt) contactPatch.repliedAt = now;
    }

    if (nextAction) {
      contactPatch.nextActionType = nextAction.type;
      contactPatch.nextActionDue = nextAction.dueMs;
      contactPatch.nextActionDesc = nextAction.desc;
      contactPatch.nextFollowUpDate = ymdFromMs(nextAction.dueMs);
    } else if (type === "declined") {
      // Clear next action only when the thread is explicitly closed out
      contactPatch.nextActionType = "";
      contactPatch.nextActionDue = null;
      contactPatch.nextActionDesc = "";
      contactPatch.nextFollowUpDate = "";
    }

    const updatedContact = Object.keys(contactPatch).length > 0
      ? await storage.updateContact(id, contactPatch as any)
      : contact;
    res.json({ ok: true, interaction, contact: updatedContact });
  });

  // GET /api/networking/analytics
  app.get("/api/networking/analytics", async (_req, res) => {
    const [contacts, classifications] = await Promise.all([
      storage.getContacts(),
      storage.getContactClassifications(),
    ]);

    // Compute reply rates by archetype from contact status
    const archetypeStats: Record<string, { outreached: number; responded: number; meetings: number }> = {};

    for (const contact of contacts) {
      const cls = classifications
        .filter((c: any) => c.contactId === (contact as any).id)
        .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)[0];
      if (!cls) continue;
      const arch = cls.archetype as string;
      if (!archetypeStats[arch]) archetypeStats[arch] = { outreached: 0, responded: 0, meetings: 0 };

      if ((contact as any).status === "messaged" || (contact as any).status === "replied") archetypeStats[arch].outreached++;
      if ((contact as any).status === "replied") archetypeStats[arch].responded++;
    }

    const byArchetype = Object.entries(archetypeStats).map(([archetype, s]) => ({
      archetype,
      outreached: s.outreached,
      responded: s.responded,
      replyRate: s.outreached > 0 ? Math.round((s.responded / s.outreached) * 100) : 0,
    }));

    // Overdue contacts
    const now = Date.now();
    const overdue = contacts
      .filter((c: any) => c.nextActionDue && c.nextActionDue < now && c.nextActionType)
      .map((c: any) => ({
        id: c.id,
        name: c.name || c.who,
        nextActionType: c.nextActionType,
        nextActionDesc: c.nextActionDesc,
        daysOverdue: Math.floor((now - c.nextActionDue) / 86400000),
      }))
      .sort((a: any, b: any) => b.daysOverdue - a.daysOverdue);

    // Simple rule-based insight
    const best = [...byArchetype].sort((a, b) => b.replyRate - a.replyRate)[0];
    const insight = best && best.outreached >= 2
      ? `${ARCHETYPE_META[best.archetype as ArchetypeKey]?.label ?? best.archetype} contacts are replying at ${best.replyRate}% — lean into this route.`
      : "Keep reaching out — you need a few more data points to see what's working.";

    res.json({ byArchetype, overdue, insight });
  });
}
