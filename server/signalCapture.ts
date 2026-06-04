import type { Express } from "express";
import type { ActivityLog } from "@shared/schema";
import { storage } from "./storage";

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL CAPTURE AND PREFERENCE LEARNING
// Lightweight feedback loop after an exploration: capture what was learned,
// summarise attractions / avoidances / unknowns, and expose it to discovery and
// planning layers. Stored as activity-log events to avoid schema migration.
// ─────────────────────────────────────────────────────────────────────────────

type SignalSource = "role" | "conversation" | "article" | "podcast" | "job_review" | "other";
type SignalReaction = "interesting" | "neutral" | "not_for_me" | "unclear";
type EnergySignal = -2 | -1 | 0 | 1 | 2;

type ExplorationSignal = {
  sourceType: SignalSource;
  direction: string;
  reaction: SignalReaction;
  attributes: string[];
  energy: EnergySignal;
  note: string;
  sourceId?: number | null;
  timestamp?: number;
};

const ALLOWED_SOURCES = ["role", "conversation", "article", "podcast", "job_review", "other"];
const ALLOWED_REACTIONS = ["interesting", "neutral", "not_for_me", "unclear"];

function safeJson(raw: string) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function cleanList(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8);
}

function normaliseEnergy(raw: unknown): EnergySignal {
  const n = Number(raw);
  if (n === -2 || n === -1 || n === 0 || n === 1 || n === 2) return n;
  return 0;
}

export function normaliseExplorationSignal(raw: any): ExplorationSignal {
  const sourceType = ALLOWED_SOURCES.includes(raw.sourceType) ? raw.sourceType : "other";
  const reaction = ALLOWED_REACTIONS.includes(raw.reaction) ? raw.reaction : "unclear";
  return {
    sourceType,
    direction: String(raw.direction || "").trim(),
    reaction,
    attributes: cleanList(raw.attributes),
    energy: normaliseEnergy(raw.energy),
    note: String(raw.note || ""),
    sourceId: raw.sourceId == null ? null : Number(raw.sourceId),
  };
}

export function explorationSignalsFromActivity(log: ActivityLog[]): ExplorationSignal[] {
  return log
    .filter((event) => event.eventType === "exploration_signal")
    .map((event) => ({ ...normaliseExplorationSignal(safeJson(event.metadata)), timestamp: event.timestamp }))
    .filter((signal) => !!signal.direction || signal.attributes.length > 0 || !!signal.note)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function addCount(map: Record<string, number>, key: string, delta = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + delta;
}

function topKeys(map: Record<string, number>, min = 1) {
  return Object.entries(map)
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

export function preferenceSummaryFromSignals(signals: ExplorationSignal[]) {
  const attractions: Record<string, number> = {};
  const avoidances: Record<string, number> = {};
  const unknowns: Record<string, number> = {};
  const directionScores: Record<string, number> = {};

  for (const signal of signals) {
    const directionDelta = signal.reaction === "interesting" ? 2 : signal.reaction === "not_for_me" ? -2 : signal.reaction === "unclear" ? 0 : 1;
    if (signal.direction) addCount(directionScores, signal.direction, directionDelta + signal.energy);

    for (const attribute of signal.attributes) {
      if (signal.reaction === "interesting" || signal.energy > 0) addCount(attractions, attribute, 1 + Math.max(0, signal.energy));
      if (signal.reaction === "not_for_me" || signal.energy < 0) addCount(avoidances, attribute, 1 + Math.abs(Math.min(0, signal.energy)));
      if (signal.reaction === "unclear" || signal.reaction === "neutral") addCount(unknowns, attribute);
    }

    if (signal.reaction === "unclear" && signal.direction) addCount(unknowns, signal.direction);
  }

  return {
    attractions: topKeys(attractions),
    avoidances: topKeys(avoidances),
    unknowns: topKeys(unknowns),
    directionScores: Object.entries(directionScores)
      .sort((a, b) => b[1] - a[1])
      .map(([direction, score]) => ({ direction, score })),
    signalCount: signals.length,
  };
}

export function registerSignalCaptureRoutes(app: Express) {
  app.get("/api/signals/preferences", async (_req, res) => {
    const signals = explorationSignalsFromActivity(await storage.getActivityLog());
    res.json({ signals, summary: preferenceSummaryFromSignals(signals) });
  });

  app.post("/api/signals/exploration", async (req, res) => {
    const signal = normaliseExplorationSignal(req.body || {});
    if (!signal.direction && signal.attributes.length === 0 && !signal.note) {
      return res.status(400).json({ error: "Signal needs a direction, attribute, or note" });
    }
    await storage.logActivity({
      eventType: "exploration_signal",
      sourceType: signal.sourceType,
      sourceId: signal.sourceId ?? undefined,
      metadata: JSON.stringify(signal),
    } as any);
    const signals = explorationSignalsFromActivity(await storage.getActivityLog());
    res.json({ signal, summary: preferenceSummaryFromSignals(signals) });
  });
}
