import type { Express, NextFunction, Request, Response } from "express";
import type { CareerTrack, Task } from "@shared/schema";
import { buildCaptureTaskPatch } from "./captureTaskRouting";
import { interpretCapture } from "./captureInterpret";
import { storage } from "./storage";
import { runStructuredTrackResearch, type StructuredTrackResearchResult } from "./trackResearchMethod";

export type StructuredResearchRunner = (
  domain: string,
  options?: { materialize?: boolean },
) => Promise<StructuredTrackResearchResult | null>;

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function numberParam(value: unknown): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function routeForRequest(req: Request) {
  return compact(req.body?.route || req.body?.category || "").toLowerCase();
}

/**
 * Extract only the broad direction to research. This is intentionally conservative:
 * when the target remains vague, the capture stays retryable rather than being
 * materialized into downstream objects.
 */
export function researchDomainForCapture(title: string): string {
  const interpreted = interpretCapture(title);
  const interpretedDomain = compact(interpreted.domain);
  if (interpretedDomain) return interpretedDomain;
  return compact(title)
    .replace(/^(?:please\s+)?(?:explore|get into|break into|look into|research|understand|investigate|learn about)\s+/i, "")
    .replace(/\s+(?:roles?|careers?|jobs?|field|space|industry|sector)\s*$/i, "")
    .replace(/[.?!]+$/g, "");
}

function zeroMaterialized() {
  return { trackId: undefined as number | undefined, jobIds: [] as number[], learnIds: [] as number[], contactIds: [] as number[], hustleIds: [] as number[] };
}

function successPatch(task: Task, track: CareerTrack, domain: string) {
  return {
    ...buildCaptureTaskPatch(task, {
      list: "captured",
      category: "admin",
      sourceType: "career_track",
      sourceId: track.id,
      sourceStatus: "routed:research:track",
      sourceNote: `Researched ${domain}. Stored the direction model on ${track.name}; no execution objects were created.`,
      relatedTrackId: track.id,
    } as any),
    list: "captured",
    sourceType: "career_track",
    sourceId: track.id,
    sourceStatus: "routed:research:track",
    relatedTrackId: track.id,
    pinned: false,
  } as any;
}

function retryPatch(task: Task, domain: string, reason: string) {
  return {
    ...buildCaptureTaskPatch(task, {
      list: task.list || "inbox",
      category: task.category || "admin",
      sourceStatus: "routed:research:retryable",
      sourceNote: `Research for ${domain || task.title} did not complete: ${reason}. Original capture left available for retry.`,
    } as any),
    list: task.list || "inbox",
    sourceStatus: "routed:research:retryable",
    pinned: false,
  } as any;
}

/**
 * Product contract: broad research creates or updates one direction model only.
 * It never materializes jobs, learn items, contacts, proof assets, or live tasks.
 */
export async function routeResearchCapture(
  id: number,
  runner: StructuredResearchRunner = runStructuredTrackResearch,
) {
  const task = (await storage.getTasks()).find((candidate) => candidate.id === id);
  if (!task) return { status: 404, body: { error: "Capture not found" } };

  const domain = researchDomainForCapture(task.title);
  if (!domain || domain.split(" ").length === 0) {
    const updated = await storage.updateTask(id, retryPatch(task, domain, "research target is unclear"));
    return {
      status: 409,
      body: {
        moved: "research",
        route: "research",
        retryable: true,
        question: "What direction or topic should Anchor research?",
        task: updated || task,
        materialized: zeroMaterialized(),
      },
    };
  }

  let result: StructuredTrackResearchResult | null = null;
  try {
    result = await runner(domain, { materialize: false });
  } catch (error) {
    result = null;
  }

  if (!result) {
    const updated = await storage.updateTask(id, retryPatch(task, domain, "structured track research failed"));
    return {
      status: 200,
      body: {
        moved: "research",
        route: "research",
        retryable: true,
        task: updated || task,
        reason: "Research could not be completed. The capture remains retryable and no execution objects were created.",
        materialized: zeroMaterialized(),
      },
    };
  }

  const updated = await storage.updateTask(id, successPatch(task, result.track, domain));
  return {
    status: 200,
    body: {
      moved: "research",
      route: "research",
      track: result.track,
      brief: result.brief,
      organizedWorkspace: result.organizedWorkspace,
      materialized: result.materialized || zeroMaterialized(),
      task: updated || task,
      reason: `Researched ${domain} and stored one direction model. No execution objects were created.`,
    },
  };
}

/**
 * Register before the legacy capture router. Non-research routes fall through to
 * the existing capture routing logic; research is intercepted into the structured
 * track-research brain.
 */
export function registerCaptureResearchRoutes(app: Express) {
  app.post("/api/capture/:id/route", async (req: Request, res: Response, next: NextFunction) => {
    if (routeForRequest(req) !== "research") return next();
    const id = numberParam(req.params.id);
    if (!id) return res.status(400).json({ error: "Bad id" });
    const result = await routeResearchCapture(id);
    return res.status(result.status).json(result.body);
  });
}
