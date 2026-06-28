import type { Express, Request, Response } from "express";
import { buildCompetenceDevelopmentSprintsFromStorage } from "./competenceDevelopmentSprint";
import { buildCompetenceEcosystemsFromStorage } from "./competenceEcosystem";
import { approveCompetenceSprintFirstTask, CompetenceSprintActivationError } from "./competenceSprintActivation";
import { assessCompetenceSprintTask, CompetenceSprintAssessmentError } from "./competenceSprintAssessment";

function backgroundMutation(req: Request): boolean {
  return String(req.header("X-Anchor-User-Intent") || "").toLowerCase() === "background";
}

function requireExplicitIntent(req: Request, res: Response, action = "Changing a competence development sprint") {
  if (!backgroundMutation(req)) return true;
  res.status(409).json({
    error: `${action} needs an explicit user action.`,
    code: "explicit_user_intent_required",
  });
  return false;
}

function listFor(value: unknown): "inbox" | "today" {
  return String(value || "inbox").toLowerCase() === "today" ? "today" : "inbox";
}

/**
 * Career development model. Ecosystem and sprint reads are pure previews. Sprint
 * approval is the first intentional bridge into task generation, and assessment
 * is the gate before the next blueprint is unlocked.
 */
export function registerCompetenceEcosystemRoutes(app: Express) {
  app.get("/api/competence/ecosystems", async (_req, res) => {
    res.json(await buildCompetenceEcosystemsFromStorage());
  });

  app.get("/api/competence/development-sprints", async (_req, res) => {
    res.json(await buildCompetenceDevelopmentSprintsFromStorage());
  });

  app.post("/api/competence/development-sprints/:trackId/approve", async (req, res) => {
    if (!requireExplicitIntent(req, res, "Approving a competence development sprint")) return;
    try {
      const result = await approveCompetenceSprintFirstTask({
        trackId: Number(req.params.trackId),
        list: listFor(req.body?.list),
      });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof CompetenceSprintActivationError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  });

  app.post("/api/competence/development-sprints/tasks/:taskId/assess", async (req, res) => {
    if (!requireExplicitIntent(req, res, "Assessing a competence sprint task")) return;
    try {
      const result = await assessCompetenceSprintTask({
        taskId: Number(req.params.taskId),
        rating: req.body?.rating,
        note: String(req.body?.note || ""),
        activateNext: req.body?.activateNext !== false,
        list: listFor(req.body?.list),
      });
      return res.status(result.nextTaskCreated ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof CompetenceSprintAssessmentError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  });
}
