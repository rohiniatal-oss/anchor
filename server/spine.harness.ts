// Spine test harness (P4.6a #8). Stands up a throwaway sqlite DB + an in-process
// express server wired with the REAL routes, so the identity chain can be tested
// end to end over HTTP. The harness picks the DB path explicitly via initStorage()
// before any route work begins, so tests no longer depend on storage import order.
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type Database from "better-sqlite3";

export type Harness = {
  base: string;
  server: Server;
  sqlite: InstanceType<typeof Database>;
  storage: typeof import("./storage").storage;
  reset: () => void;
  close: () => Promise<void>;
};

const TABLES = [
  "tasks", "events", "jobs", "job_pipeline_steps", "proof_asset_steps",
  "learn", "hustles", "wins", "contacts", "career_tracks",
  "discovery_sessions", "recommendations", "recommendation_subdivisions", "recommendation_milestones",
  "day_plans", "day_plan_items", "entity_links", "activity_log",
  "strategic_object_ownership", "ownership_resolution_feedback",
];

// The suite shares one initialized harness/DB per process. Per-test isolation
// comes from reset(), which truncates every table.
let singleton: Harness | null = null;

export async function makeHarness(): Promise<Harness> {
  if (singleton) return singleton;
  const dbPath = path.join(os.tmpdir(), `anchor-spine-${process.pid}-${Date.now()}.db`);
  process.env.ANCHOR_DB_PATH = dbPath;
  // The spine tests never hit model-backed routes.
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-noop";

  // Schema is created by storage.ts during explicit initStorage(dbPath).
  const express = (await import("express")).default;
  const { registerCaptureDiscoveryRoutes } = await import("./captureDiscoveryRoutes");
  const { registerCaptureRoutes } = await import("./capture");
  const { registerSprint2Routes } = await import("./sprint2");
  const { registerSprint1Routes } = await import("./sprint1");
  const { registerJobTruthRoutes } = await import("./jobTruth");
  const { registerCandidateRoutes } = await import("./candidates");
  const { registerDiscoveryRoutes } = await import("./discovery");
  const { registerGoalStateRoutes } = await import("./goalState");
  const { registerTaskBreakdownRoutes } = await import("./taskBreakdownRoutes");
  const { registerObjectOwnershipRoutes } = await import("./objectOwnershipRoutes");
  const { registerRoutes } = await import("./routes");
  const { initStorage, storage } = await import("./storage");
  // Reset/inspect through the same handle the harness initialized for this DB.
  const runtime = initStorage(dbPath);
  const sqlite = runtime.rawDb;

  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  registerCaptureDiscoveryRoutes(app);
  registerCaptureRoutes(app);
  registerSprint2Routes(app);
  registerSprint1Routes(app);
  registerJobTruthRoutes(app);
  registerCandidateRoutes(app);
  registerDiscoveryRoutes(app);
  registerGoalStateRoutes(app);
  registerTaskBreakdownRoutes(app);
  registerObjectOwnershipRoutes(app);
  await registerRoutes(httpServer, app);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const reset = () => {
    for (const t of TABLES) {
      sqlite.prepare(`DELETE FROM ${t}`).run();
      sqlite.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(t);
    }
  };

  singleton = {
    base, server: httpServer, sqlite, storage, reset,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      // Do not close/unlink here: sqlite is storage's shared handle (closing it
      // would break any later-loading test file in the same process), and the DB
      // is a throwaway temp/data file truncated per test by reset().
      singleton = null;
    },
  };
  return singleton;
}

export async function api(base: string, method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}