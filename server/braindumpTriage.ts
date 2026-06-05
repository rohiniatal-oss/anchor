import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";

type TriageCategory =
  | "standalone_task"
  | "subtask"
  | "job"
  | "learn"
  | "hustle"
  | "contact"
  | "deadline"
  | "blocker"
  | "note"
  | "duplicate"
  | "parking_lot"
  | "keep";

const VALID = new Set<TriageCategory>([
  "standalone_task", "subtask", "job", "learn", "hustle", "contact", "deadline",
  "blocker", "note", "duplicate", "parking_lot", "keep",
]);

function legacyCategory(category: TriageCategory): string {
  // Preserve the old UI contract while returning richer metadata. Existing buttons
  // can still call /move with category=today/job/learn/hustle/keep.
  if (category === "standalone_task" || category === "subtask" || category === "deadline" || category === "blocker") return "today";
  if (category === "parking_lot" || category === "note" || category === "duplicate") return "keep";
  return category;
}

function heuristicCategory(title: string): TriageCategory {
  const t = title.toLowerCase();
  if (/\b(deadline|due|closes|by \d|before \d|tomorrow|today)\b/.test(t)) return "deadline";
  if (/\b(blocked|stuck|waiting|can't|cannot|need from|depends on)\b/.test(t)) return "blocker";
  if (/\b(call|message|email|intro|coffee|reach out|follow up with)\b/.test(t)) return "contact";
  if (/\b(job|role|posting|application|interview|cv|cover letter|apply)\b/.test(t)) return "job";
  if (/\b(course|read|learn|book|podcast|resource|fellowship|programme|program)\b/.test(t)) return "learn";
  if (/\b(substack|memo|essay|forecast|portfolio|build|side project|prototype|afterline)\b/.test(t)) return "hustle";
  if (/\b(idea|maybe|someday|could|parking)\b/.test(t)) return "parking_lot";
  return "standalone_task";
}

export function registerBraindumpTriageRoutes(app: Express) {
  // Rich sort: classifies capture items by their real role in the system, not just
  // which tab they should be dumped into. This route is registered before the old
  // generic routes, so it supersedes the legacy 5-bucket endpoint while keeping its
  // response shape backward-compatible.
  app.post("/api/braindump/sort", async (_req, res) => {
    const [inbox, jobs, learn, hustles, contacts] = await Promise.all([
      storage.getTasks().then((tasks) => tasks.filter((t) => t.list === "inbox" && !t.done)),
      storage.getJobs(), storage.getLearn(), storage.getHustles(), storage.getContacts(),
    ]);
    if (inbox.length === 0) return res.json({ suggestions: [] });

    try {
      const client = new OpenAI();
      const items = inbox.map((t) => `${t.id}: ${t.title}`).join("\n");
      const context = JSON.stringify({
        jobs: jobs.slice(0, 25).map((j) => ({ id: j.id, title: j.title, company: j.company, status: j.status })),
        learn: learn.slice(0, 25).map((l) => ({ id: l.id, title: l.title, status: l.learnStatus, active: l.active })),
        hustles: hustles.slice(0, 25).map((h) => ({ id: h.id, title: h.title, stage: h.stage })),
        contacts: contacts.slice(0, 25).map((c) => ({ id: c.id, who: c.who || c.name, status: c.status })),
      });
      const r = await client.responses.create({
        model: "gpt_5_1",
        input:
          `Classify each brain-dump item into exactly one category: standalone_task, subtask, job, learn, hustle, contact, deadline, blocker, note, duplicate, parking_lot, keep.\n` +
          `Use subtask when the item belongs under an existing job/learn/hustle/task. Use deadline when it updates a source object's due date. Use blocker when it explains why something cannot move. Use duplicate when an existing source already covers it.\n` +
          `Return ONLY JSON like [{"id":12,"category":"subtask","targetType":"job","targetId":3,"reason":"belongs under existing role"}].\n` +
          `Existing objects: ${context}\nItems:\n${items}`,
      });
      const text = (r.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let parsed: any[] = [];
      try { parsed = JSON.parse(text); } catch { parsed = []; }
      const suggestions = parsed
        .filter((p) => inbox.some((t) => t.id === Number(p.id)) && VALID.has(p.category))
        .map((p) => ({
          id: Number(p.id),
          category: legacyCategory(p.category),
          kind: p.category,
          targetType: typeof p.targetType === "string" ? p.targetType.slice(0, 20) : "",
          targetId: Number.isFinite(Number(p.targetId)) ? Number(p.targetId) : null,
          reason: typeof p.reason === "string" ? p.reason.slice(0, 180) : "",
        }));
      res.json({ suggestions });
    } catch {
      // Deterministic fallback keeps capture useful even without AI.
      res.json({
        suggestions: inbox.map((t) => {
          const kind = heuristicCategory(t.title);
          return { id: t.id, category: legacyCategory(kind), kind, targetType: "", targetId: null, reason: "Heuristic fallback" };
        }),
      });
    }
  });

  // Rich move: accepts both old categories and new kinds. Unknown nuanced items are
  // kept in inbox with a source note rather than being forced into the wrong table.
  app.post("/api/braindump/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const requested = String(req.body?.kind || req.body?.category || "keep") as TriageCategory | "today";
    const cat: TriageCategory | "today" = VALID.has(requested as TriageCategory) || requested === "today" ? requested : "keep";
    const targetType = String(req.body?.targetType || "");
    const targetId = Number(req.body?.targetId || 0);
    const note = `From brain dump: ${task.title}`;

    if (cat === "today" || cat === "standalone_task") {
      return res.json({ moved: "today", task: await storage.updateTask(id, { list: "today", block: null, doneWhen: task.doneWhen || "One useful next action is complete" } as any) });
    }
    if (cat === "subtask" && targetType && targetId) {
      return res.json({ moved: "today", task: await storage.updateTask(id, { list: "today", block: null, sourceType: targetType, sourceId: targetId, sourceNote: note } as any) });
    }
    if (cat === "deadline" || cat === "blocker") {
      const patch: any = { list: "today", block: null, sourceNote: note };
      if (cat === "blocker") { patch.readiness = "blocked"; patch.blockerReason = task.title.slice(0, 160); }
      return res.json({ moved: "today", task: await storage.updateTask(id, patch) });
    }
    if (cat === "job") {
      await storage.createJob({ title: task.title, company: "", location: "", url: "", note, nextStep: "Open the posting or source and capture requirements", status: "wishlist" } as any);
      await storage.deleteTask(id);
      return res.json({ moved: "job" });
    }
    if (cat === "learn") {
      await storage.createLearn({ title: task.title, category: "", cost: "", url: "", note, done: false, active: false, requiredOutput: "One concrete takeaway or output" } as any);
      await storage.deleteTask(id);
      return res.json({ moved: "learn" });
    }
    if (cat === "hustle") {
      await storage.createHustle({ title: task.title, note, nextStep: "Define the smallest testable output", stage: "idea" } as any);
      await storage.deleteTask(id);
      return res.json({ moved: "hustle" });
    }
    if (cat === "contact") {
      await storage.createContact({ name: "", who: task.title, sector: "", why: "Captured from brain dump", status: "to_contact", note } as any);
      await storage.deleteTask(id);
      return res.json({ moved: "contact" });
    }

    // note / duplicate / parking_lot / keep: leave it parked in inbox but mark it so
    // the user can see why it did not become a live task.
    const updated = await storage.updateTask(id, { sourceNote: `${cat}: ${note}`, readiness: "waiting" } as any);
    return res.json({ moved: "keep", task: updated });
  });
}
