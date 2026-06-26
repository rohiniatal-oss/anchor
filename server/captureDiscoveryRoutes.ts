import type { Express, NextFunction, Request, Response } from "express";
import type { Task } from "@shared/schema";
import { isCareerDirectionResearchTitle, isSearchDiscoveryTitle } from "@shared/captureResearch";
import { classifyCapture, type CaptureSuggestion } from "./capture";
import { collectTaskBreakdownContext, formatContextBlocksForPrompt, type ContextBlock } from "./contextProviders";
import { buildRankedDiscoveryOptions } from "./discoveryOptions";
import { storage } from "./storage";
import { previewWork } from "./workService";

const MATERIALIZING_ROUTES = new Set(["job", "learn", "network", "proof", "task", "today", "subtask", "decision", "research"]);
const DEFAULT_DISCOVERY_PURPOSE = "so I can produce an evidence-backed shortlist and next action";

function requestedRoute(req: Request) {
  return String(req.body?.route || req.body?.category || "").trim().toLowerCase();
}

function numberParam(value: unknown): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function searchDiscoverySuggestion(task: Task): CaptureSuggestion {
  return {
    id: task.id,
    route: "research",
    category: "research",
    label: "Search / Discover",
    confidence: "high",
    reason: "This is discovery work. Anchor should search automatically, rank the results, and preview the best next option before creating any objects.",
    question: "What should this search help you decide, produce, or change?",
  };
}

function isSearchDiscoveryCapture(task: Task) {
  return isSearchDiscoveryTitle(task.title) && !isCareerDirectionResearchTitle(task.title);
}

function isSearchDiscoveryTitleForWork(title: string) {
  return isSearchDiscoveryTitle(title) && !isCareerDirectionResearchTitle(title);
}

export function classifyCaptureWithDiscovery(task: Task): CaptureSuggestion {
  return isSearchDiscoveryCapture(task) ? searchDiscoverySuggestion(task) : classifyCapture(task.id, task.title);
}

function workPreviewRequired(task: Task, route: string) {
  if (!isSearchDiscoveryCapture(task)) return false;
  return MATERIALIZING_ROUTES.has(route);
}

function mockMode(value: unknown) {
  const mode = String(value || "");
  return ["success", "empty", "rate_limited", "unavailable", "error"].includes(mode)
    ? mode as "success" | "empty" | "rate_limited" | "unavailable" | "error"
    : undefined;
}

function compact(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function evidenceFromBlock(block: ContextBlock) {
  return {
    title: compact(block.sourceTitle || block.label || "Public source"),
    snippet: compact(block.text),
    url: compact(block.sourceUrl),
    domain: compact(block.sourceDomain),
    date: compact(block.sourceDate),
    citationId: compact(block.metadata?.citationId),
  };
}

async function taskForId(id: number) {
  return (await storage.getTasks()).find((item) => item.id === id) || null;
}

function bodyTask(req: Request, fallback?: Task | null): Task {
  return {
    ...(fallback || {}),
    id: fallback?.id || Number(req.body?.sourceId || 0),
    title: String(req.body?.title || fallback?.title || ""),
    category: String(req.body?.category || fallback?.category || "thinking"),
    doneWhen: String(req.body?.doneWhen || fallback?.doneWhen || ""),
    minimumOutcome: String(req.body?.minimumOutcome || fallback?.minimumOutcome || ""),
    sourceUrl: String(req.body?.sourceUrl || fallback?.sourceUrl || ""),
    sourceNote: String(req.body?.sourceNote || fallback?.sourceNote || ""),
    sourceType: String(req.body?.sourceType || fallback?.sourceType || "task"),
    steps: req.body?.steps ?? fallback?.steps ?? "[]",
    relatedTrackId: req.body?.relatedTrackId == null ? fallback?.relatedTrackId ?? null : Number(req.body.relatedTrackId),
  } as Task;
}

async function automaticDiscoveryPreview(task: Task, req: Request) {
  const sourceBundle = {
    sourceContext: task.sourceNote || "",
    playbook: "",
    sourceKind: "task" as const,
    source: null,
    parentContext: "",
  };
  const collected = await collectTaskBreakdownContext({
    task: {
      title: task.title,
      category: task.category,
      doneWhen: task.doneWhen,
      minimumOutcome: task.minimumOutcome,
      sourceUrl: task.sourceUrl,
      sourceNote: task.sourceNote,
      sourceType: task.sourceType,
    },
    sourceBundle,
    userAuthoredContext: String(req.body?.context || "").trim().slice(0, 1500),
    mockMode: mockMode(req.body?.externalResearchMockMode),
  });
  const evidence = (collected.blocks.externalResearch || []).map(evidenceFromBlock);
  const ranked = buildRankedDiscoveryOptions({ title: task.title, evidence });
  const providerContext = formatContextBlocksForPrompt(collected.blocks);
  const userContext = [
    String(req.body?.context || "").trim().slice(0, 1500),
    providerContext,
    ranked.options.length ? `Ranked discovery options:\n${ranked.options.map((option) => `${option.rank}. ${option.title}: ${option.whyRelevant}`).join("\n")}` : "",
    ranked.recommendedNextAction ? `Recommended next action: ${ranked.recommendedNextAction}` : "",
  ].filter(Boolean).join("\n\n");
  const preview = await previewWork({
    title: task.title,
    sourceType: "task",
    sourceId: task.id || null,
    sourceNote: [task.sourceNote, DEFAULT_DISCOVERY_PURPOSE].filter(Boolean).join(". "),
    doneWhen: task.doneWhen,
    minimumOutcome: task.minimumOutcome,
    steps: task.steps,
    relatedTrackId: task.relatedTrackId,
    context: userContext,
    refine: false,
  });
  return {
    ...preview,
    automaticDiscovery: true,
    evidence,
    evidenceStatus: collected.externalResearch.status,
    evidenceQuery: collected.externalResearch.debug?.query || "",
    evidenceProvider: collected.externalResearch.provider,
    rankedOptions: ranked.options,
    discoverySummary: ranked.summary,
    recommendedNextAction: ranked.recommendedNextAction,
  };
}

export function registerCaptureDiscoveryRoutes(app: Express) {
  app.post("/api/work/interpret", async (req: Request, res: Response, next: NextFunction) => {
    const title = String(req.body?.title || "").trim();
    if (!isSearchDiscoveryTitleForWork(title)) return next();
    const sourceId = numberParam(req.body?.sourceId);
    const fallback = sourceId ? await taskForId(sourceId) : null;
    const task = bodyTask(req, fallback);
    return res.json(await automaticDiscoveryPreview(task, req));
  });

  app.post("/api/capture/sort", async (_req, res) => {
    const inbox = (await storage.getTasks()).filter((task) => task.list === "inbox" && !task.done);
    return res.json({ suggestions: inbox.map(classifyCaptureWithDiscovery) });
  });

  app.post("/api/capture/:id/suggest", async (req, res, next: NextFunction) => {
    const id = numberParam(req.params.id);
    if (!id) return next();
    const task = await taskForId(id);
    if (!task) return next();
    if (!isSearchDiscoveryCapture(task)) return next();
    return res.json({ suggestion: searchDiscoverySuggestion(task) });
  });

  app.post("/api/capture/:id/discover", async (req, res) => {
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const task = await taskForId(id);
    if (!task) return res.status(404).json({ error: "Capture not found" });
    if (!isSearchDiscoveryCapture(task)) {
      return res.status(400).json({ error: "This capture is not search or discovery work." });
    }
    return res.json(await automaticDiscoveryPreview(task, req));
  });

  app.post("/api/capture/:id/route", async (req: Request, res: Response, next: NextFunction) => {
    const route = requestedRoute(req);
    const id = numberParam(req.params.id);
    if (!id || !route) return next();
    const task = await taskForId(id);
    if (!task || !workPreviewRequired(task, route)) return next();

    return res.status(409).json({
      error: "Search and discovery captures must be interpreted before Anchor creates objects.",
      code: "work_interpretation_required",
      route,
      nextAction: "auto_discover",
      suggestion: searchDiscoverySuggestion(task),
      task,
      downstreamObjectsCreated: {
        jobs: 0,
        learningItems: 0,
        contacts: 0,
        proofAssets: 0,
        projects: 0,
        tasks: 0,
      },
    });
  });
}
