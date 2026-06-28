import type { Express, Request, Response } from "express";
import { buildCompetenceDevelopmentSprintsFromStorage } from "./competenceDevelopmentSprint";
import { buildCompetenceEcosystemsFromStorage } from "./competenceEcosystem";
import { approveCompetenceSprintFirstTask, CompetenceSprintActivationError } from "./competenceSprintActivation";

function backgroundMutation(req: Request): boolean {
  return String(req.header("X-Anchor-User-Intent") || "").toLowerCase() === "background";
}

function requireExplicitIntent(req: Request, res: Response) {
  if (!backgroundMutation(req)) return true;
  res.status(409).json({
    error: "Approving a competence development sprint needs an explicit user action.",
    code: "explicit_user_intent_required",
  });
  return false;
}

/**
 * Career development model. Ecosystem and sprint reads are pure previews. Sprint
 * approval is the first intentional bridge into task generation, and it creates
 * exactly one task from the first experience blueprint.
 */
export function registerCompetenceEcosystemRoutes(app: Express) {
  app.get("/api/competence/ecosystems", async (_req, res) => {
    res.json(await buildCompetenceEcosystemsFromStorage());
  });

  app.get("/api/competence/development-sprints", async (_req, res) => {
    res.json(await buildCompetenceDevelopmentSprintsFromStorage());
  });

  app.post("/api/competence/development-sprints/:trackId/approve", async (req, res) => {
    if (!requireExplicitIntent(req, res)) return;
    try {
      const result = await approveCompetenceSprintFirstTask({
        trackId: Number(req.params.trackId),
        list: String(req.body?.list || "inbox").toLowerCase() === "today" ? "today" : "inbox",
      });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof CompetenceSprintActivationError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  });
}
