import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { registerCaptureRoutes } from "./capture";
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
initStorage();
warnIfUsingDefaultDbPath();
seedInitialData().catch((e) => console.error("Seed failed:", e));

app.get("/api/health", (_req, res) => {
  try {
    getStorageRuntime().rawDb.prepare("SELECT 1").get();
    res.json({ status: "ok", uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: "error" });
  }
});

registerOptionalBasicAuth(app);
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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Capture remains the clean routing contract. Candidate, goal-state,
  // exploration, Strategy Builder, Track Spine, Marketability, Brain, task breakdown,
  // and Anchor Today routes sit upstream of generic CRUD because they create the planning context.
  registerPersistenceAdminRoutes(app);
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

    return res.status(status).json({ message });
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
