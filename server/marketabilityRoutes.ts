import type { Express } from "express";
import { taskCategoryForPlannerLane } from "./lanes";
import { storage } from "./storage";
import { buildMarketabilityPlan, type MarketabilityMove } from "./marketabilityEngine";

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function categoryForMove(move: MarketabilityMove) { return taskCategoryForPlannerLane(move.lane); }
function sizeForMove(move: MarketabilityMove) {
  if (move.kind === "cleanup" || move.kind === "network") return "quick";
  if (move.kind === "development") return "medium";
  return "quick";
}

async function buildPlan() {
  const [tasks, jobs, learn, hustles, contacts, tracks] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getCareerTracks(),
  ]);
  return { plan: buildMarketabilityPlan({ tasks, jobs, learn, hustles, contacts, tracks }), tasks };
}

export function registerMarketabilityRoutes(app: Express) {
  app.get("/api/marketability-plan", async (_req, res) => {
    const { plan } = await buildPlan();
    res.json(plan);
  });

  app.post("/api/marketability/apply", async (_req, res) => {
    const { plan, tasks } = await buildPlan();
    const existingTaskKeys = new Set(tasks.filter((t) => !t.done).map((t) => norm(t.title)));
    const created: string[] = [];
    const maxMoves = plan.mode === "role_active" || plan.mode === "interview_active" ? 1 : 2;

    for (const move of plan.topMoves.slice(0, maxMoves)) {
      if (existingTaskKeys.has(norm(move.title))) continue;
      await storage.createTask({
        title: move.title,
        list: "inbox",
        block: null,
        done: false,
        pinned: false,
        steps: "[]",
        sort: 0,
        category: categoryForMove(move),
        size: sizeForMove(move),
        status: "not_started",
        skipped: 0,
        doneWhen: move.doneWhen,
        sourceType: "marketability_engine",
        sourceStatus: `marketability:${move.kind}`,
        sourceNote: move.reason,
        relatedTrackId: move.trackId || null,
        minimumOutcome: move.doneWhen,
      } as any);
      existingTaskKeys.add(norm(move.title));
      created.push(`${move.kind}:${move.trackName || "general"}`);
    }

    res.json({
      ok: true,
      created,
      mode: plan.mode,
      weeklyMix: plan.weeklyMix,
      movesConsidered: plan.topMoves,
    });
  });
}
