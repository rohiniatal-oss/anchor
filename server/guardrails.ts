import type { Express, Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// ─────────────────────────────────────────────────────────────────────────────
// PROTOTYPE-GRADE OPERATIONAL GUARDRAILS
// No new dependencies. Optional auth and backups stay opt-in so local development
// remains unchanged.
//
// Auth:
//   ANCHOR_BASIC_USER=...
//   ANCHOR_BASIC_PASSWORD=...
//
// Live DB persistence:
//   ANCHOR_DB_PATH=/data/anchor.db
//
// Backups:
//   ANCHOR_BACKUP_DIR=/data/backups
//   ANCHOR_BACKUP_INTERVAL_MINUTES=360   optional, default 6h
//
// Admin routes:
//   enabled automatically outside production, or in production when either
//   Basic Auth is configured or ANCHOR_ADMIN_ROUTES=true.
// ─────────────────────────────────────────────────────────────────────────────

function safeEq(a: string, b: string) {
  // Constant-time enough for a tiny prototype without adding a dependency.
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

function parseBasicAuth(header: string | undefined) {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function basicAuthConfigured() {
  return !!(process.env.ANCHOR_BASIC_USER && process.env.ANCHOR_BASIC_PASSWORD);
}

export function registerOptionalBasicAuth(app: Express) {
  const expectedUser = process.env.ANCHOR_BASIC_USER || "";
  const expectedPassword = process.env.ANCHOR_BASIC_PASSWORD || "";
  if (!expectedUser || !expectedPassword) return;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const supplied = parseBasicAuth(req.headers.authorization);
    if (supplied && safeEq(supplied.user, expectedUser) && safeEq(supplied.password, expectedPassword)) {
      return next();
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="Anchor"');
    return res.status(401).send("Authentication required");
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function dbPath() {
  return process.env.ANCHOR_DB_PATH || "data.db";
}

function backupDir() {
  return process.env.ANCHOR_BACKUP_DIR || "";
}

function checkpointWal(filePath: string) {
  // The app runs SQLite in WAL mode. Copying only data.db can miss committed rows
  // that still sit in data.db-wal, so checkpoint before creating a file backup.
  const sqlite = new Database(filePath);
  try {
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    sqlite.close();
  }
}

function fileMeta(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function recentBackups(dir: string) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
    .map(fileMeta)
    .filter(Boolean)
    .sort((a, b) => String(b!.updatedAt).localeCompare(String(a!.updatedAt)))
    .slice(0, 10);
}

export function persistenceStatus() {
  const liveDbPath = dbPath();
  const backupsPath = backupDir();
  return {
    dbPath: liveDbPath,
    dbPathIsExplicit: !!process.env.ANCHOR_DB_PATH,
    dbExists: fs.existsSync(liveDbPath),
    db: fileMeta(liveDbPath),
    walExists: fs.existsSync(`${liveDbPath}-wal`),
    shmExists: fs.existsSync(`${liveDbPath}-shm`),
    backupsEnabled: !!backupsPath,
    backupDir: backupsPath || null,
    backupDirExists: backupsPath ? fs.existsSync(backupsPath) : false,
    recentBackups: recentBackups(backupsPath),
    recommendedEnv: {
      ANCHOR_DB_PATH: "/data/anchor.db",
      ANCHOR_BACKUP_DIR: "/data/backups",
    },
    warning: process.env.ANCHOR_DB_PATH
      ? null
      : "ANCHOR_DB_PATH is not set, so Anchor is using data.db in the app working directory. This may reset on deploy/update unless the working directory is persistent.",
  };
}

export function warnIfUsingDefaultDbPath() {
  if (process.env.ANCHOR_DB_PATH) return;
  console.warn("[anchor:persistence] ANCHOR_DB_PATH is not set. Using ./data.db. Set ANCHOR_DB_PATH=/data/anchor.db on a persistent volume to avoid data resets after updates.");
}

export function backupSqliteNow() {
  const liveDbPath = dbPath();
  const backupsPath = backupDir();
  if (!backupsPath) return null;
  if (!fs.existsSync(liveDbPath)) return null;

  checkpointWal(liveDbPath);
  fs.mkdirSync(backupsPath, { recursive: true });
  const parsed = path.parse(liveDbPath);
  const target = path.join(backupsPath, `${parsed.name}-${timestamp()}${parsed.ext || ".db"}`);
  fs.copyFileSync(liveDbPath, target);
  return target;
}

export function startOptionalSqliteBackups() {
  const backupsPath = backupDir();
  if (!backupsPath) return;

  try { backupSqliteNow(); } catch (e) { console.error("Anchor backup skipped:", e); }

  const raw = Number(process.env.ANCHOR_BACKUP_INTERVAL_MINUTES || 360);
  const intervalMinutes = Number.isFinite(raw) && raw >= 15 ? raw : 360;
  setInterval(() => {
    try { backupSqliteNow(); } catch (e) { console.error("Anchor backup skipped:", e); }
  }, intervalMinutes * 60 * 1000).unref?.();
}

function adminRoutesAllowed() {
  return process.env.NODE_ENV !== "production"
    || process.env.ANCHOR_ADMIN_ROUTES === "true"
    || basicAuthConfigured();
}

export function registerPersistenceAdminRoutes(app: Express) {
  app.get("/api/admin/persistence", (_req, res) => {
    if (!adminRoutesAllowed()) {
      return res.status(403).json({
        error: "Admin routes disabled in production. Configure ANCHOR_BASIC_USER and ANCHOR_BASIC_PASSWORD, or set ANCHOR_ADMIN_ROUTES=true.",
      });
    }
    res.json(persistenceStatus());
  });

  app.post("/api/admin/backup-now", (_req, res) => {
    if (!adminRoutesAllowed()) {
      return res.status(403).json({
        error: "Admin routes disabled in production. Configure ANCHOR_BASIC_USER and ANCHOR_BASIC_PASSWORD, or set ANCHOR_ADMIN_ROUTES=true.",
      });
    }
    try {
      const backupPath = backupSqliteNow();
      if (!backupPath) {
        return res.status(400).json({
          error: "Backup not created. Set ANCHOR_BACKUP_DIR and ensure the database file exists.",
          status: persistenceStatus(),
        });
      }
      res.json({ ok: true, backupPath, status: persistenceStatus() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Backup failed", status: persistenceStatus() });
    }
  });
}
