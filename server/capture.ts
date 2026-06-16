import type { Express } from "express";
import { storage } from "./storage";
import type { Task } from "@shared/schema";
import OpenAI from "openai";
import { buildCaptureTaskPatch } from "./captureTaskRouting";
import { USER_PROFILE } from "./userPromptProfile";

// Resolve a bare captured thought into REAL asset details before filing, so a
// brain-dump like "read 80,000 hours career guide" becomes a Learn item WITH its
// canonical URL, type, optional reusable result, and capability â€” context that then flows
// through to the breakdown and everywhere else. Knowledge-grounded; safe empty
// fallback so filing never blocks if the model is unavailable.
async function resolveAssetDetails(title: string, kind: "learn" | "job" | "proof" | "network"): Promise<Record<string, string>> {
  try {
    const client = new OpenAI();
    const ask =
      kind === "learn"
        ? `Resolve this learning capture. If it's a known public resource, give its CANONICAL url. Fields: title (clean), url (real canonical URL or ""), learnType (course|fellowship|book|podcast|resource|practice), category (short label), requiredOutput (optional reusable result, if there is an obvious one), capabilityBuilt (the skill it builds).`
        : kind === "job"
        ? `Resolve this into a real opportunity. Fields: title (clean role title), company (if implied else ""), location (if implied else ""), url (real careers/board URL if a known org else ""), nextStep (concrete first step, e.g. "open the board and shortlist 3 roles").`
        : kind === "proof"
        ? `Resolve this writing/build/proof capture. Fields: title (clean), nextStep (a concrete first move, e.g. "decide the angle: your specific take").`
        : `Resolve this networking capture. Fields: who (who this person/type is), why (why reach them), askType (soft|referral|advice|reconnect|follow_up), nextStep (concrete first move).`;
    const out = await client.responses.create({
      model: "gpt_5_1",
      input:
        `User profile: ${USER_PROFILE} ` +
        `${ask}\nUse real-world knowledge; NEVER invent a fake URL â€” use "" if unsure. ` +
        `Capture: "${title}". Return ONLY a JSON object with those exact fields.`,
    });
    let text = (out.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const j = JSON.parse(text);
    return (j && typeof j === "object") ? j : {};
  } catch {
    return {};
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PHASE 4.7 â€” BRAIN DUMP AS UNIVERSAL CAPTURE
// Brain Dump is the lossless front door: capture first, classify conservatively,
// route only when there is enough signal, and never destroy the original thought.
// No schema change: captures are still tasks with list="inbox" until routed;
// object routes preserve the original row as list="captured" with route metadata.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const CAPTURE_ROUTES = [
  "task", "today", "subtask", "job", "learn", "network", "proof",
  "deadline", "blocker", "decision", "note", "duplicate", "parking_lot", "keep",
] as const;
export type CaptureRoute = (typeof CAPTURE_ROUTES)[number];
export type CaptureConfidence = "high" | "medium" | "low";

export type CaptureSuggestion = {
  id: number;
  route: CaptureRoute;
  // `category` is kept as a compatibility alias for the existing BrainDump UI.
  // New callers should read `route`.
  category: CaptureRoute | "hustle";
  label: string;
  confidence: CaptureConfidence;
  reason: string;
  question?: string;
};

const ROUTE_LABEL: Record<CaptureRoute, string> = {
  task: "Task",
  today: "Today",
  subtask: "Subtask",
  job: "Jobs",
  learn: "Learn",
  network: "Network",
  proof: "Projects / Public Work",
  deadline: "Deadline",
  blocker: "Blocker",
  decision: "Decision",
  note: "Note",
  duplicate: "Duplicate",
  parking_lot: "Parking Lot",
  keep: "Keep in Brain Dump",
};

function compact(raw: string): string {
  return (raw || "").trim().replace(/\s+/g, " ");
}

function has(text: string, re: RegExp): boolean {
  return re.test(text);
}

function suggestion(id: number, route: CaptureRoute, confidence: CaptureConfidence, reason: string, question?: string): CaptureSuggestion {
  return {
    id,
    route,
    // Existing UI already knows "hustle" as Proof. Keep API route clean while
    // avoiding a breaking label for old clients.
    category: route === "proof" ? "hustle" : route,
    label: ROUTE_LABEL[route],
    confidence,
    reason,
    question,
  };
}

// Deterministic first-pass classifier. The LLM can polish later, but routing must
// be auditable and conservative. Ambiguous items return `keep` with a question.
export function classifyCapture(id: number, raw: string): CaptureSuggestion {
  const title = compact(raw);
  const t = title.toLowerCase();

  if (!title) return suggestion(id, "keep", "low", "Empty capture", "What did you want to capture?");

  // One-word / name-only items are usually people or vague reminders, but they are
  // not safely routeable without the user's intent.
  if (title.split(" ").length <= 2 && !has(t, /\b(read|study|apply|write|pay|book|send|message|call|email|course|job|role)\b/)) {
    return suggestion(id, "keep", "low", "Too little context to route safely", "Is this a person, task, learning item, or idea?");
  }

  // Source hygiene before destination routing: these are updates to existing work,
  // not standalone jobs/resources by default.
  if (has(t, /\b(blocked|stuck|waiting on|waiting for|can't|cannot|need from|depends on|no access|missing info|need info)\b/)) {
    return suggestion(id, "blocker", "high", "This explains why an existing item cannot move");
  }

  if (has(t, /\b(deadline|due|closes|closing|by\s+(mon|tue|wed|thu|fri|sat|sun|tomorrow|today|\d{1,2})|before\s+\d{1,2}|submit by)\b/)) {
    return suggestion(id, "deadline", "high", "This looks like a date or deadline update");
  }

  if (has(t, /\b(step|subtask|part of|for the role|for that job|for the application|for the memo|for substack|for course|under)\b/)) {
    return suggestion(id, "subtask", "medium", "This sounds like a child action under an existing object", "Which job, learning item, or project/public-work item should this attach to?");
  }

  if (has(t, /\b(already added|duplicate|same as|covered by|already have)\b/)) {
    return suggestion(id, "duplicate", "high", "This appears to duplicate an existing item");
  }

  if (has(t, /\b(note|remember|thought|insight|interesting|worth noting|quote|context)\b/)) {
    return suggestion(id, "note", "medium", "This is context to preserve, not necessarily an action");
  }

  if (has(t, /\b(someday|maybe|parking lot|later idea|not now|one day|could do)\b/)) {
    return suggestion(id, "parking_lot", "high", "This is an idea to park rather than execute now");
  }

  // Applications / opportunities. Fellowships are things you apply to; courses are
  // Learn unless the capture explicitly says applying to a fellowship/program.
  if (has(t, /\b(fellowship|internship|job|role|posting|vacancy|interview|application|apply|cover letter|cv|resume|résumé)\b/)) {
    return suggestion(id, "job", "high", "This is an opportunity or application workflow");
  }

  // Network. Person + relational action belongs in Network, not generic Tasks.
  if (has(t, /\b(message|dm|email|call|whatsapp|follow up|follow-up|intro|introduce|coffee|referral|reconnect|reach out|ask\s+.+\babout\b)\b/)) {
    return suggestion(id, "network", "high", "This is a relationship or outreach action");
  }

  // Proof assets. Production verbs beat consumption nouns.
  if (has(t, /\b(write|draft|publish|post|substack|memo|essay|article|build|ship|launch|prototype|portfolio|case study|forecast log)\b/)) {
    return suggestion(id, "proof", "high", "This creates a memo, post, project, or other reusable public-facing work");
  }

  // Learning / resources.
  if (has(t, /\b(read|study|learn about|course|book|article|podcast|lecture|syllabus|resource|watch|module|class|curriculum)\b/)) {
    return suggestion(id, "learn", "high", "This is something to study, practise, or turn into prep");
  }

  // Decision / research is not automatically Learn: it is a thinking task until it
  // becomes a resource or output.
  if (has(t, /\b(figure out|work out|decide|choose|clarify|think through|whether|what kind|what type|pros and cons|trade[- ]?off)\b/)) {
    return suggestion(id, "decision", "medium", "This is a decision or research question, not a learning item yet");
  }

  // Concrete execution verbs.
  if (has(t, /\b(send|book|pay|buy|schedule|reply|update|finish|review|clean|organise|organize|upload|download|print|renew|cancel|order)\b/)) {
    return suggestion(id, "task", "high", "This is a concrete action");
  }

  // If it sounds like a small to-do but has no domain signal, keep it as a task.
  if (title.length <= 80 && title.split(" ").length <= 8) {
    return suggestion(id, "task", "medium", "This looks actionable but has no specialist destination");
  }

  return suggestion(id, "keep", "low", "Not enough signal to route safely", "Should this become a task, learning item, contact, job, or project/public-work item?");
}

// A capture has no slot/plan context, so we never fabricate a time block.
// This matches the Phase 4.6a convention (/api/plan-items/:id/start): block is
// derived from real slot context or left null â€” never hardcoded by guessing.
function routeToBlock(_route: CaptureRoute, _task?: Task): string | null {
  return null;
}

function routeForClient(route: string): CaptureRoute | null {
  if (route === "hustle") return "proof";
  if (route === "idea") return "parking_lot";
  return (CAPTURE_ROUTES as readonly string[]).includes(route) ? route as CaptureRoute : null;
}

async function markCaptureRouted(task: Task, route: CaptureRoute, routedToType: string, routedToId: number | null, reason: string) {
  return storage.updateTask(task.id, {
    list: "captured",
    sourceType: "capture",
    sourceId: routedToId ?? undefined,
    sourceStatus: `routed:${route}:${routedToType}`,
    sourceNote: reason,
    pinned: false,
  } as any);
}

function parkedStatus(route: CaptureRoute) {
  return route === "duplicate" ? "duplicate" : route === "parking_lot" ? "parked" : route === "note" ? "note" : "kept";
}

export async function routeCapture(id: number, rawRoute: string) {
  const route = routeForClient(rawRoute);
  if (!route) return { status: 400, body: { error: "Unknown route" } };

  const task = (await storage.getTasks()).find((t) => t.id === id);
  if (!task) return { status: 404, body: { error: "Capture not found" } };

  const inferred = classifyCapture(task.id, task.title);
  const reason = inferred.reason;

  if (route === "keep" || route === "note" || route === "duplicate" || route === "parking_lot") {
    const updated = await storage.updateTask(id, {
      list: route === "keep" ? task.list : "captured",
      sourceStatus: parkedStatus(route),
      sourceNote: reason,
      readiness: route === "parking_lot" ? "waiting" : task.readiness,
      pinned: false,
    } as any);
    return { status: 200, body: { moved: route === "parking_lot" ? "parking_lot" : route, route, task: updated, reason } };
  }

  if (route === "today" || route === "task") {
    const patch = buildCaptureTaskPatch(task, {
      list: route === "today" ? "today" : "inbox",
      block: routeToBlock(route, task),
      sourceStatus: route === "today" ? "routed:today:task" : "routed:task:task",
      sourceNote: reason,
    });
    const updated = await storage.updateTask(id, patch);
    return { status: 200, body: { moved: route, route, task: updated, reason } };
  }

  if (route === "subtask") {
    const updated = await storage.updateTask(id, buildCaptureTaskPatch(task, {
      list: "inbox",
      sourceStatus: "needs_parent",
      sourceNote: reason,
      doneWhen: "This is attached to the right parent item",
      minimumOutcome: "This is attached to the right parent item",
    }) as any);
    return { status: 200, body: { moved: "subtask", route, task: updated, reason, question: inferred.question } };
  }

  if (route === "deadline") {
    const updated = await storage.updateTask(id, buildCaptureTaskPatch(task, {
      list: "inbox",
      category: "admin",
      sourceStatus: "deadline_update",
      sourceNote: reason,
      doneWhen: "The relevant source item has the correct deadline",
      minimumOutcome: "The relevant source item has the correct deadline",
    }) as any);
    return { status: 200, body: { moved: "deadline", route, task: updated, reason } };
  }

  if (route === "blocker") {
    const updated = await storage.updateTask(id, buildCaptureTaskPatch(task, {
      list: "inbox",
      readiness: "blocked",
      blockerReason: task.title.slice(0, 160),
      sourceStatus: "blocker_update",
      sourceNote: reason,
      doneWhen: "The blocker is attached to the right item or resolved",
      minimumOutcome: "The blocker is attached to the right item or resolved",
    }) as any);
    return { status: 200, body: { moved: "blocker", route, task: updated, reason } };
  }

  if (route === "decision") {
    const updated = await storage.updateTask(id, buildCaptureTaskPatch(task, {
      list: "inbox",
      category: "admin",
      doneWhen: "A clear decision or next action is written down",
      minimumOutcome: "A clear decision or next action is written down",
      sourceStatus: "routed:decision:task",
      sourceNote: reason,
    }) as any);
    return { status: 200, body: { moved: "decision", route, task: updated, reason } };
  }

  if (route === "job") {
    const d = await resolveAssetDetails(task.title, "job");
    const created = await storage.createJob({
      title: d.title || task.title, company: d.company || "", location: d.location || "", url: d.url || "",
      note: "From Brain Dump", nextStep: d.nextStep || "Check requirements and next action", status: "wishlist",
    } as any);
    await markCaptureRouted(task, route, "job", created.id, reason);
    return { status: 200, body: { moved: "job", route, job: created, reason } };
  }

  if (route === "learn") {
    const d = await resolveAssetDetails(task.title, "learn");
    const created = await storage.createLearn({
      title: d.title || task.title, category: d.category || "", cost: "", url: d.url || "", note: "From Brain Dump",
      done: false, active: false, type: d.learnType || "resource", learnStatus: "open",
      requiredOutput: d.requiredOutput || "", capabilityBuilt: d.capabilityBuilt || "",
    } as any);
    await markCaptureRouted(task, route, "learn", created.id, reason);
    return { status: 200, body: { moved: "learn", route, learn: created, reason } };
  }

  if (route === "network") {
    const d = await resolveAssetDetails(task.title, "network");
    const created = await storage.createContact({
      name: "", who: d.who || task.title, sector: "", why: d.why || "From Brain Dump", status: "to_contact",
      relationshipStrength: "cold", askType: d.askType || "soft",
    } as any);
    await markCaptureRouted(task, route, "contact", created.id, reason);
    return { status: 200, body: { moved: "network", route, contact: created, reason } };
  }

  if (route === "proof") {
    const d = await resolveAssetDetails(task.title, "proof");
    const created = await storage.createHustle({
      title: d.title || task.title, note: "From Brain Dump", nextStep: d.nextStep || "Define the smallest useful piece", stage: "idea",
    } as any);
    await markCaptureRouted(task, route, "hustle", created.id, reason);
    return { status: 200, body: { moved: "proof", route, hustle: created, reason } };
  }

  return { status: 400, body: { error: "Unhandled route" } };
}

export async function sortOpenCaptures() {
  const inbox = (await storage.getTasks()).filter((t) => t.list === "inbox" && !t.done);
  return inbox.map((t) => classifyCapture(t.id, t.title));
}

export function registerCaptureRoutes(app: Express) {
  app.get("/api/capture/routes", async (_req, res) => {
    res.json({ routes: CAPTURE_ROUTES.map((route) => ({ route, label: ROUTE_LABEL[route] })) });
  });

  app.post("/api/capture/sort", async (_req, res) => {
    res.json({ suggestions: await sortOpenCaptures() });
  });

  app.post("/api/capture/:id/suggest", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const task = (await storage.getTasks()).find((item) => item.id === id);
    if (!task) return res.status(404).json({ error: "Capture not found" });
    res.json({ suggestion: classifyCapture(task.id, task.title) });
  });

  app.post("/api/capture/:id/route", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await routeCapture(id, String(req.body?.route || req.body?.category || ""));
    res.status(result.status).json(result.body);
  });
}

