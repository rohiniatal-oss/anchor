import type { Express, Request, Response } from "express";
import type { Task } from "@shared/schema";
import { storage } from "./storage";
import { interpretCapture } from "./captureInterpret";
import {
  researchCareerDirection,
  type StoredStructuredTrackResearchResult,
} from "./structuredTrackResearchService";

const CAREER_DIRECTION_VERB_RE = /^(?:please\s+)?(?:explore|get\s+into|break\s+into|map\s+out)\b/i;
const CAREER_DIRECTION_NOUN_RE = /\b(?:career|careers|field|industry|industries|job|jobs|profession|professions|role|roles|sector|sectors|space)\b/i;
const RESEARCH_PREFIX_RE = /^(?:please\s+)?(?:explore|get\s+into|break\s+into|look\s+into|research|understand|investigate|learn\s+about|map\s+out)\s+/i;
const GENERIC_SUFFIX_RE = /\s+(?:career|careers|field|industry|industries|job|jobs|profession|professions|role|roles|sector|sectors|space)\s*$/i;

export type CareerDirectionResearchRunner = (
  domain: string,
) => Promise<StoredStructuredTrackResearchResult | null>;

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

/**
 * Direction research is narrower than general research. It covers exploration
 * of a role family, career path, field, or sector. Entity research such as
 * "Research TBI" stays in the project/task interpretation flow.
 */
export function isCareerDirectionResearchCapture(title: string): boolean {
  const cleaned = compact(title);
  if (!cleaned) return false;
  const interpretation = interpretCapture(cleaned);
  if (interpretation.mode !== "research") return false;
  return CAREER_DIRECTION_VERB_RE.test(cleaned) || CAREER_DIRECTION_NOUN_RE.test(cleaned);
}

export function careerDirectionDomain(title: string): string {
  const cleaned = compact(title);
  const interpreted = interpretCapture(cleaned);
  const inferred = compact(interpreted.domain);
  if (inferred) return inferred;
  return compact(cleaned.replace(RESEARCH_PREFIX_RE, "").replace(GENERIC_SUFFIX_RE, ""));
}

function researchNote(task: Task, result: StoredStructuredTrackResearchResult) {
  const line = `Career direction researched: ${result.track.name}. The evidence-backed direction model was stored without activating jobs, learning items, contacts, proof assets, projects, or tasks.`;
  const existing = compact(task.sourceNote);
  if (!existing) return line;
  if (existing.includes(line)) return existing;
  return `${existing}\n${line}`;
}

/**
 * Route one confirmed career-direction capture. Failure leaves the original
 * capture untouched and retryable. Success attaches it to one researched track.
 */
export async function routeCareerDirectionCapture(
  id: number,
  runner: CareerDirectionResearchRunner = researchCareerDirection,
) {
  const task = (await storage.getTasks()).find((item) => item.id === id);
  if (!task) return { status: 404, body: { error: "Capture not found" } };

  if (!isCareerDirectionResearchCapture(task.title)) {
    return {
      status: 409,
      body: {
        error: "This looks like bounded research, not a career direction.",
        code: "work_interpretation_required",
        route: "research",
        task,
        nextAction: "interpret_work",
      },
    };
  }

  const domain = careerDirectionDomain(task.title);
  if (!domain) {
    return {
      status: 409,
      body: {
        error: "What career direction should Anchor research?",
        code: "career_direction_required",
        route: "research",
        task,
      },
    };
  }

  let result: StoredStructuredTrackResearchResult | null = null;
  try {
    result = await runner(domain);
  } catch (error) {
    console.error("Career-direction capture research failed:", error);
  }

  if (!result) {
    return {
      status: 502,
      body: {
        error: `Could not research ${domain}. The original capture was left unchanged.`,
        code: "career_direction_research_failed",
        retryable: true,
        route: "research",
        task,
      },
    };
  }

  const updated = await storage.updateTask(task.id, {
    list: "captured",
    sourceType: "career_track",
    sourceId: result.track.id,
    sourceStatus: "routed:research:career_track",
    sourceNote: researchNote(task, result),
    relatedTrackId: result.track.id,
    pinned: false,
  } as any);

  return {
    status: 200,
    body: {
      moved: "research",
      route: "research",
      ...result,
      capture: updated || task,
      downstreamObjectsCreated: {
        jobs: 0,
        learningItems: 0,
        contacts: 0,
        proofAssets: 0,
        projects: 0,
        tasks: 0,
      },
      reason: `Researched ${result.track.name} as a career direction. No live execution objects were created.`,
    },
  };
}

function requestedRoute(req: Request) {
  return String(req.body?.route || req.body?.category || "").trim().toLowerCase();
}

/**
 * Register before the legacy capture router. Non-research routes pass through;
 * research can no longer reach the old domain-brief materializer.
 */
export function registerCaptureResearchRoutes(app: Express) {
  app.post("/api/capture/:id/route", async (req: Request, res: Response, next) => {
    if (requestedRoute(req) !== "research") return next();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const result = await routeCareerDirectionCapture(id);
    return res.status(result.status).json(result.body);
  });
}
