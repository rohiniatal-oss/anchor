import type { Express } from "express";
import { buildCompetenceEcosystemsFromStorage } from "./competenceEcosystem";

/**
 * Read-only career development model. This is deliberately not a task generator:
 * it locates the user inside competence ecosystems so later planners can choose
 * coherent developmental experiences instead of ad hoc learning tasks.
 */
export function registerCompetenceEcosystemRoutes(app: Express) {
  app.get("/api/competence/ecosystems", async (_req, res) => {
    res.json(await buildCompetenceEcosystemsFromStorage());
  });
}
