import type { Express, Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// PROTOTYPE-GRADE OPERATIONAL GUARDRAILS
// No new dependencies. Both are opt-in so local development remains unchanged.
//
// Auth:
//   ANCHOR_BASIC_USER=...
//   ANCHOR_BASIC_PASSWORD=...
//
// Backups:
//   ANCHOR_BACKUP_DIR=./backups
//   ANCHOR_BACKUP_INTERVAL_MINUTES=360   optional, default 6h
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

export function backupSqliteNow() {
  const dbPath = process.env.ANCHOR_DB_PATH || "data.db";
  const backupDir = process.env.ANCHOR_BACKUP_DIR || "";
  if (!backupDir) return null;
  if (!fs.existsSync(dbPath)) return null;

  fs.mkdirSync(backupDir, { recursive: true });
  const parsed = path.parse(dbPath);
  const target = path.join(backupDir, `${parsed.name}-${timestamp()}${parsed.ext || ".db"}`);
  fs.copyFileSync(dbPath, target);
  return target;
}

export function startOptionalSqliteBackups() {
  const backupDir = process.env.ANCHOR_BACKUP_DIR || "";
  if (!backupDir) return;

  try { backupSqliteNow(); } catch (e) { console.error("Anchor backup skipped:", e); }

  const raw = Number(process.env.ANCHOR_BACKUP_INTERVAL_MINUTES || 360);
  const intervalMinutes = Number.isFinite(raw) && raw >= 15 ? raw : 360;
  setInterval(() => {
    try { backupSqliteNow(); } catch (e) { console.error("Anchor backup skipped:", e); }
  }, intervalMinutes * 60 * 1000).unref?.();
}
