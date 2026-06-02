import type { Express } from "express";
import { storage } from "./storage";
import type { Task } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4.7 — BRAIN DUMP AS UNIVERSAL CAPTURE
// Brain Dump is the lossless front door: capture first, classify conservatively,
// route only when there is enough signal, and never destroy the original thought.
// No schema change: captures are still tasks with list="inbox" until routed;
// object routes preserve the original row as list="captured" with route metadata.
// ─────────────────────────────────────────────────────────────────────────────

export const CAPTURE_ROUTES = ["task", "today", "job", "learn", "network", "proof", "decision", "keep"] as const;
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
  job: "Jobs",
  learn: "Learn",
  network: "Network",
  proof: "Proof Assets",
  decision: "Decision",
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
    return suggestion(id, "keep", "low", "Too little context to route safely", "Is this a person, task, resource, or idea?");
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
    return suggestion(id, "proof", "high", "This creates an output that can become proof");
  }

  // Learning / resources.
  if (has(t, /\b(read|study|learn about|course|book|article|podcast|lecture|syllabus|resource|watch|module|class|curriculum)\b/)) {
    return suggestion(id, "learn", "high", "This is a resource to study or consume");
  }

  // Decision / research is not automatically Learn: it is a thinking task until it
  // becomes a resource or output.
  if (has(t, /\b(figure out|work out|decide|choose|clarify|think through|whether|what kind|what type|pros and cons|trade[- ]?off)\b/)) {
    return suggestion(id, "decision", "medium", "This is a decision or research question, not a resource yet");
  }

  // Concrete execution verbs.
  if (has(t, /\b(send|book|pay|buy|schedule|reply|update|finish|review|clean|organise|organize|upload|download|print|renew|cancel|order)\b/)) {
    return suggestion(id, "task", "high", "This is a concrete action");
  }

  // If it sounds like a small to-do but has no domain signal, keep it as a task.
  if (title.length <= 80 && title.split(" ").length <= 8) {
    return suggestion(id, "task", "medium", "This looks actionable but has no specialist destination");
  }

  return suggestion(id, "keep", "low", "Not enough signal to route safely", "Should this become a task, learning item, contact, job, or proof asset?");
}

function routeToBlock(route: CaptureRoute, task?: Task): string | null {
  if (route === "today") return task?.size === "deep" ? "morning" : "afternoon";
  return null;
}

function routeForClient(route: string): CaptureRoute | null {
  if (route === "hustle") return "proof";
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

export async function routeCapture(id: number, rawRoute: string) {
  const route = routeForClient(rawRoute);
  if (!route) return { status: 400, body: { error: "Unknown route" } };

  const task = (await storage.getTasks()).find((t) => t.id === id);
  if (!task) return { status: 404, body: { error: "Capture not found" } };

  const inferred = classifyCapture(task.id, task.title);
  const reason = inferred.reason;

  if (route === "keep") {
    const updated = await storage.updateTask(id, { sourceStatus: "kept", sourceNote: reason } as any);
    return { status: 200, body: { moved: "keep", route, task: updated, reason } };
  }

  if (route === "today" || route === "task") {
    const patch: any = {
      list: route === "today" ? "today" : "inbox",
      block: routeToBlock(route, task),
      category: task.category || "admin",
      sourceStatus: route === "today" ? "routed:today:task" : "routed:task:task",
      sourceNote: reason,
    };
    const updated = await storage.updateTask(id, patch);
    return { status: 200, body: { moved: route, route, task: updated, reason } };
  }

  if (route === "decision") {
    const updated = await storage.updateTask(id, {
      list: "inbox",
      category: "admin",
      doneWhen: task.doneWhen || "A clear decision or next action is written down",
      sourceStatus: "routed:decision:task",
      sourceNote: reason,
    } as any);
    return { status: 200, body: { moved: "decision", route, task: updated, reason } };
  }

  if (route === "job") {
    const created = await storage.createJob({
      title: task.title, company: "", location: "", url: "",
      note: "From Brain Dump", nextStep: "Check requirements and next action", status: "wishlist",
    } as any);
    await markCaptureRouted(task, route, "job", created.id, reason);
    return { status: 200, body: { moved: "job", route, job: created, reason } };
  }

  if (route === "learn") {
    const created = await storage.createLearn({
      title: task.title, category: "", cost: "", url: "", note: "From Brain Dump",
      done: false, active: false, type: "resource", learnStatus: "open",
    } as any);
    await markCaptureRouted(task, route, "learn", created.id, reason);
    return { status: 200, body: { moved: "learn", route, learn: created, reason } };
  }

  if (route === "network") {
    const created = await storage.createContact({
      name: "", who: task.title, sector: "", why: "From Brain Dump", status: "to_contact",
      relationshipStrength: "cold", askType: "soft",
    } as any);
    await markCaptureRouted(task, route, "contact", created.id, reason);
    return { status: 200, body: { moved: "network", route, contact: created, reason } };
  }

  if (route === "proof") {
    const created = await storage.createHustle({
      title: task.title, note: "From Brain Dump", nextStep: "Define the smallest output", stage: "idea",
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

  app.post("/api/capture/:id/route", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await routeCapture(id, String(req.body?.route || req.body?.category || ""));
    res.status(result.status).json(result.body);
  });
}
