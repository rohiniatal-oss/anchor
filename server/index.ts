import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { llmUsageStats } from "./llm";
import { registerCaptureRoutes } from "./capture";
import { registerCaptureResearchRoutes } from "./captureResearchRoutes";
import { registerSearchDiscoveryRoutes } from "./searchDiscovery";
import { registerTrackResearchRoutes } from "./trackResearchRoutes";
import { registerTrackResearchCoverageRoutes } from "./trackResearchCoverageRoutes";
import { registerTrackResearchDevelopmentRoutes } from "./trackResearchDevelopmentRoutes";
import { registerTrackResearchExecutionRoutes } from "./trackResearchExecutionRoutes";
import { registerTrackResearchExecutionPriorityRoutes } from "./trackResearchExecutionPriorityRoutes";
import { registerSprint1Routes } from "./sprint1";
import { registerSprint2Routes } from "./sprint2";
import { registerJobTruthRoutes } from "./jobTruth";
import { registerCandidateRoutes } from "./candidates";
import { registerDiscoveryRoutes } from "./discovery";
import { registerGoalStateRoutes } from "./goalState";
import { registerExplorationQueueRoutes } from "./explorationQueue";
import { registerAnchorTodayRoutes } from "./anchorToday";
import { registerStrategyBuilderRoutes } from "./strategyBuilderRoutes";
import { registerMarketabilityRoutes } from "./marketabilityRoutes";
import { registerTrackSpineRoutes } from "./trackSpineRoutes";
import { registerBrainSpineRoutes } from "./brainSpineRoutes";
import { registerTaskBreakdownRoutes } from "./taskBreakdownRoutes";
import { registerProfileRoutes } from "./profileRoutes";
import { registerNetworkStrategyRoutes } from "./networkStrategyRoutes";
import { registerOptionalBasicAuth, registerPersistenceAdminRoutes, startOptionalSqliteBackups, warnIfUsingDefaultDbPath } from "./guardrails";
import { installReadPurityGuard } from "./requestMutationGuard";
import { registerTaskLifecycleRoutes } from "./taskLifecycleRoutes";
import { registerTrustBoundaryRoutes } from "./trustBoundaryRoutes";
import { registerWorkRoutes } from "./workRoutes";
import { ensureWorkSchema } from "./workRepository";
import { ensureObjectOwnershipSchema } from "./objectOwnership";
import { registerObjectOwnershipRoutes } from "./objectOwnershipRoutes";
import { serveStatic } from "./static";
import { initStorage, getStorageRuntime } from "./storage";
import { seedInitialData } from "./seed";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
const runtime = initStorage();
// Project and ownership tables are installed before the request guard so future
// GET routes can remain pure reads while still working against old databases.
ensureWorkSchema();
ensureObjectOwnershipSchema();
installReadPurityGuard(app, runtime.storage, runtime.rawDb);
warnIfUsingDefaultDbPath();
seedInitialData().catch((e) => console.error("Seed failed:", e));

app.get("/api/health", (_req, res) => {
  try {
    getStorageRuntime().rawDb.prepare("SELECT 1").get();
    res.json({ status: "ok", uptime: process.uptime() });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(503).json({ status: "error" });
  }
});

registerOptionalBasicAuth(app);

app.get("/api/llm-usage", (_req, res) => {
  res.json(llmUsageStats());
});
startOptionalSqliteBackups();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Never log response bodies: they can contain CV text, contacts, drafts,
      // research evidence and other private career data.
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // Work interpretation is a preview boundary. It identifies project vs task,
  // then separates project decomposition from task-level action breakdown.
  registerWorkRoutes(app);
  registerObjectOwnershipRoutes(app);

  // These boundaries are intentionally first. Existing URLs remain compatible,
  // while reads become pure and all task transitions share one lifecycle.
  registerTrustBoundaryRoutes(app);
  registerTaskLifecycleRoutes(app);

  // Track research is the single career-direction research brain. Search and
  // discovery capture routing is registered before the legacy router so search-
  // like requests cannot auto-materialize objects.
  registerPersistenceAdminRoutes(app);
  registerTrackResearchRoutes(app);
  registerTrackResearchCoverageRoutes(app);
  registerTrackResearchDevelopmentRoutes(app);
  registerTrackResearchExecutionRoutes(app);
  registerTrackResearchExecutionPriorityRoutes(app);
  registerCaptureResearchRoutes(app);
  registerSearchDiscoveryRoutes(app);
  registerCaptureRoutes(app);
  registerSprint2Routes(app);
  registerSprint1Routes(app);
  registerJobTruthRoutes(app);
  registerCandidateRoutes(app);
  registerDiscoveryRoutes(app);
  registerGoalStateRoutes(app);
  registerExplorationQueueRoutes(app);
  registerStrategyBuilderRoutes(app);
  registerTrackSpineRoutes(app);
  registerMarketabilityRoutes(app);
  registerBrainSpineRoutes(app);
  registerTaskBreakdownRoutes(app);
  registerProfileRoutes(app);
  registerNetworkStrategyRoutes(app);
  registerAnchorTodayRoutes(app);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message, code: err.code || undefined });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
