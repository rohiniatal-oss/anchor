import type { Express, NextFunction, Request, Response } from "express";
import type { Task } from "@shared/schema";
import { isCareerDirectionResearchTitle, isSearchDiscoveryTitle } from "@shared/captureResearch";
import { classifyCapture, type CaptureSuggestion } from "./capture";
import { storage } from "./storage";

const MATERIALIZING_ROUTES = new Set(["job", "learn", "network", "proof", "task", "today", "subtask", "decision", "research"]);

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
    reason: "This is discovery work. Anchor should understand the goal and preview the work before creating any objects.",
    question: "What should this search help you decide, produce, or change?",
  };
}

function isSearchDiscoveryCapture(task: Task) {
  return isSearchDiscoveryTitle(task.title) && !isCareerDirectionResearchTitle(task.title);
}

export function classifyCaptureWithDiscovery(task: Task): CaptureSuggestion {
  return isSearchDiscoveryCapture(task) ? searchDiscoverySuggestion(task) : classifyCapture(task.id, task.title);
}

function workPreviewRequired(task: Task, route: string) {
  if (!isSearchDiscoveryCapture(task)) return false;
  return MATERIALIZING_ROUTES.has(route);
}

export function registerCaptureDiscoveryRoutes(app: Express) {
  app.post("/api/capture/sort", async (_req, res) => {
    const inbox = (await storage.getTasks()).filter((task) => task.list === "inbox" && !task.done);
    return res.json({ suggestions: inbox.map(classifyCaptureWithDiscovery) });
  });

  app.post("/api/capture/:id/suggest", async (req, res, next: NextFunction) => {
    const id = numberParam(req.params.id);
    if (!id) return next();
    const task = (await storage.getTasks()).find((item) => item.id === id);
    if (!task) return next();
    if (!isSearchDiscoveryCapture(task)) return next();
    return res.json({ suggestion: searchDiscoverySuggestion(task) });
  });

  app.post("/api/capture/:id/route", async (req: Request, res: Response, next: NextFunction) => {
    const route = requestedRoute(req);
    const id = numberParam(req.params.id);
    if (!id || !route) return next();
    const task = (await storage.getTasks()).find((item) => item.id === id);
    if (!task || !workPreviewRequired(task, route)) return next();

    return res.status(409).json({
      error: "Search and discovery captures must be interpreted before Anchor creates objects.",
      code: "work_interpretation_required",
      route,
      nextAction: "interpret_work",
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
