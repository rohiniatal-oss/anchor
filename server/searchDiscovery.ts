import type { Express, NextFunction, Request, Response } from "express";
import { classifyCapture, type CaptureSuggestion } from "./capture";
import { storage } from "./storage";

const SEARCH_ROUTE_ALIASES = new Set(["search", "discover", "discovery", "explore", "research"]);
const SEARCH_COMMAND_RE = /^(?:please\s+)?(?:search(?:\s+for)?|find(?:\s+me)?|look\s+(?:up|for|into)|find\s+out\s+about|identify|map(?:\s+out)?|scan|source|shortlist|discover|locate|research|investigate|explore|understand)\b/i;
const HARD_SEARCH_COMMAND_RE = /^(?:please\s+)?(?:search(?:\s+for)?|look\s+(?:up|for|into)|find\s+out\s+about|research|investigate|explore|understand)\b/i;
const SEARCH_OBJECT_RE = /\b(roles?|jobs?|postings?|vacanc(?:y|ies)|companies|organisations|organizations|people|contacts?|alumni|experts?|courses?|programs?|programmes?|fellowships?|resources?|articles?|reports?|datasets?|examples?|events?|grants?|funders?|teams?|workstreams?|requirements?|landscape|market|opportunities|paths?)\b/i;
const ATOMIC_NOT_SEARCH_RE = /^(?:send|email|reply|forward|pay|book|cancel|confirm|call|text|message|sign|renew|submit|post|share|download|upload|print|return|schedule|open|save|paste|attach|apply|write|draft)\b/i;
const GENERIC_SEARCH_TARGET_RE = /^(?:jobs?|roles?|people|contacts?|courses?|resources?|companies|organisations|organizations|programs?|programmes?|fellowships?|things?|options?|ideas?|examples?|opportunities)$/i;

function compact(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value: unknown) {
  return compact(value).toLowerCase();
}

function stripSearchCommand(title: string) {
  return compact(title)
    .replace(/^(?:please\s+)?(?:search(?:\s+for)?|find(?:\s+me)?|look\s+(?:up|for|into)|find\s+out\s+about|identify|map(?:\s+out)?|scan|source|shortlist|discover|locate|research|investigate|explore|understand)\s+(?:about\s+|for\s+)?/i, "")
    .replace(/\s+(?:so\s+that|so\s+i\s+can|to\s+help\s+me|in\s+order\s+to)\s+.+$/i, "")
    .replace(/[.?!]+$/g, "")
    .trim();
}

export function isSearchDiscoveryCapture(title: string) {
  const text = compact(title);
  if (!text || ATOMIC_NOT_SEARCH_RE.test(text)) return false;
  if (HARD_SEARCH_COMMAND_RE.test(text)) return true;
  if (SEARCH_COMMAND_RE.test(text) && SEARCH_OBJECT_RE.test(text)) return true;
  if (/\b(search|shortlist|map|pipeline|options|candidates|list)\b/i.test(text) && SEARCH_OBJECT_RE.test(text)) return true;
  return false;
}

export function classifySearchDiscoveryCapture(id: number, title: string): CaptureSuggestion | null {
  if (!isSearchDiscoveryCapture(title)) return null;
  const target = stripSearchCommand(title);
  const generic = !target || GENERIC_SEARCH_TARGET_RE.test(lower(target));
  return {
    id,
    route: "research" as any,
    category: "research" as any,
    label: "Search / Discover",
    confidence: generic ? "low" : HARD_SEARCH_COMMAND_RE.test(title) ? "high" : "medium",
    reason: generic
      ? "This is a search request, but the target or purpose is too broad to create objects safely"
      : "This is search/discovery work. Anchor should understand the goal and preview results before creating jobs, contacts, learning items, or tasks.",
    question: generic
      ? "What should this search help you decide, produce, or change?"
      : undefined,
  };
}

function classifySearchAwareCapture(id: number, title: string) {
  return classifySearchDiscoveryCapture(id, title) || classifyCapture(id, title);
}

function isSearchRoute(rawRoute: unknown) {
  return SEARCH_ROUTE_ALIASES.has(lower(rawRoute));
}

async function safeSearchRoute(id: number) {
  const task = (await storage.getTasks()).find((item) => item.id === id);
  if (!task) return { status: 404, body: { error: "Capture not found" } };
  const suggestion = classifySearchAwareCapture(task.id, task.title);
  const updated = await storage.updateTask(task.id, {
    list: "inbox",
    sourceStatus: "needs_search_interpretation",
    sourceNote: suggestion.reason,
    readiness: suggestion.confidence === "low" ? "needs_info" : task.readiness,
    blockerReason: suggestion.question || task.blockerReason || "",
    pinned: false,
  } as any);
  return {
    status: 200,
    body: {
      moved: "search",
      route: "research",
      task: updated || task,
      reason: suggestion.reason,
      question: suggestion.question,
      requiresWorkPreview: true,
      materialized: null,
    },
  };
}

/**
 * Search/discovery is broader than research. This route layer sits before the
 * legacy capture router so search-like text can never auto-create jobs, learn
 * items, contacts, proof assets, or tasks before the work preview is confirmed.
 */
export function registerSearchDiscoveryRoutes(app: Express) {
  app.post("/api/capture/sort", async (_req, res) => {
    const inbox = (await storage.getTasks()).filter((task) => task.list === "inbox" && !task.done);
    res.json({ suggestions: inbox.map((task) => classifySearchAwareCapture(task.id, task.title)) });
  });

  app.post("/api/capture/:id/suggest", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const task = (await storage.getTasks()).find((item) => item.id === id);
    if (!task) return res.status(404).json({ error: "Capture not found" });
    res.json({ suggestion: classifySearchAwareCapture(task.id, task.title) });
  });

  app.post("/api/capture/:id/route", async (req: Request, res: Response, next: NextFunction) => {
    const rawRoute = req.body?.route || req.body?.category;
    if (!isSearchRoute(rawRoute)) return next();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await safeSearchRoute(id);
    return res.status(result.status).json(result.body);
  });
}
