import { storage } from "./storage";
import {
  getTrackId, getLearnStatus, isLearnDone, getLearnOutputState,
} from "@shared/domainState";
import { domainForLearn, domainLabel, CAPABILITY_DOMAIN_KEYS } from "@shared/capabilityDomains";
import { requiredDomainsForTrack, type CapabilityDomainKey } from "@shared/capabilityTargets";
import type { CareerTrack, Learn, Hustle, Win } from "@shared/schema";
import { computeEvidence, type TrackKey } from "./evidence";

// ─────────────────────────────────────────────────────────────────────────
// LEARNING STRATEGY (P5) — the capability-gap engine + deterministic sequencing.
//
// 5.1  GAP DETECTION: for each track, compare the REQUIRED capability domains
//      (shared/capabilityTargets.ts, data-driven from the track) against the
//      EVIDENCED domains (computed from real data: evidenced Learn items, proof
//      assets, and learning/proof_asset wins attributed to the track). GAP =
//      required MINUS evidenced, ranked by track.priority.
//
// 5.3  SEQUENCING: order the gap-addressing Learn items deterministically using
//      prerequisites/unlocks + applicationDeadline/programStart + learnStatus.
//      A gap domain with no matching Learn item becomes an "unfilled gap" slot —
//      the hook where 5.2 (out-of-scope, Perplexity-layer) resources later attach.
//
// AFTERLINE RULE: a domain is only ever credited from a Learn item / proof asset /
// win whose OWN text normalizes to that domain. The geopolitics Substack
// normalizes to geo/comms, never ai-gov, so it can neither evidence an AI gap nor
// be demanded to carry AI content. Gaps are CAPABILITY coverage, satisfiable by
// Learn items/wins — never by changing a proof asset's topic. No LLM anywhere.
// ─────────────────────────────────────────────────────────────────────────

export type RankedGap = { domain: CapabilityDomainKey; label: string };

export type SequenceStep = {
  learnId: number | null;     // null = unfilled gap slot (no Learn item yet)
  title: string | null;       // Learn title, or null for an unfilled gap
  gapDomain: CapabilityDomainKey; // the domain this step addresses
  domainLabel: string;
  reason: string;             // deterministic, human-readable ordering reason
  hasUnmetPrereq: boolean;
  deadline: string;           // applicationDeadline or "" — surfaced for urgency
};

export type TrackLearningGap = {
  trackId: number;
  slug: string;
  name: string;
  priority: number;
  status: string;
  requiredDomains: CapabilityDomainKey[];
  evidencedDomains: CapabilityDomainKey[];
  gapDomains: CapabilityDomainKey[];
  rankedGaps: RankedGap[];      // gap domains, ranked (track priority is the outer rank)
  sequence: SequenceStep[];     // recommended learning path (incl. unfilled-gap slots)
  unfilledGapCount: number;     // gap domains with no matching Learn item yet
};

// A near-deadline window (days) within which a deadline-bearing Learn item is
// surfaced earlier in the sequence.
const NEAR_DEADLINE_DAYS = 45;

function daysUntil(dateStr: string, now: number): number | null {
  const raw = (dateStr || "").trim();
  if (!raw) return null;
  const d = new Date(raw + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - now) / 86400000);
}

// Normalize a free-text blob to a single capability domain via the shared
// normalizer (category arg, capabilityBuilt arg). Returns null when nothing
// matches — the deliberate "no forced bucket" behaviour.
function domainForText(text: string): CapabilityDomainKey | null {
  return domainForLearn(text, "") as CapabilityDomainKey | null;
}

// Compute the set of EVIDENCED capability domains for one track, respecting the
// Afterline rule (each source only credits the domain its OWN text normalizes to).
function evidencedDomainsForTrack(
  track: CareerTrack,
  learn: Learn[],
  hustles: Hustle[],
  trackWins: Win[],
  proofLinkIds: Set<number>,
): Set<CapabilityDomainKey> {
  const evidenced = new Set<CapabilityDomainKey>();

  // (a) Evidenced Learn items linked to the track.
  for (const l of learn) {
    if (getTrackId("learn", l) !== track.id) continue;
    if (getLearnOutputState(l, proofLinkIds.has(l.id)) !== "evidenced") continue;
    const key = domainForLearn(l.category, l.capabilityBuilt) as CapabilityDomainKey | null;
    if (key) evidenced.add(key);
  }

  // (b) Proof assets for the track — credit only the domain the asset's OWN text
  //     normalizes to (Afterline: a geopolitics Substack -> geo/comms, never ai-gov).
  for (const h of hustles) {
    if (getTrackId("hustles", h) !== track.id) continue;
    const key = domainForText(`${h.title} ${h.contentPillar} ${h.coreClaim} ${h.note}`);
    if (key) evidenced.add(key);
  }

  // (c) learning / proof_asset wins attributed to the track — credit only the
  //     domain the win text normalizes to (no spurious credit when it doesn't match).
  for (const w of trackWins) {
    if (w.winCategory !== "learning" && w.winCategory !== "proof_asset") continue;
    const key = domainForText(w.text);
    if (key) evidenced.add(key);
  }

  return evidenced;
}

// 5.3 — deterministic sequencing of the gap-addressing Learn items for a track.
// Ordering keys (in priority): unmet-prereq items sort AFTER their prereqs;
// near-deadline items surface earlier; then learnStatus progress; then id.
function sequenceForTrack(
  track: CareerTrack,
  gapDomains: CapabilityDomainKey[],
  learn: Learn[],
  now: number,
): SequenceStep[] {
  const tLearn = learn.filter(
    (l) => getTrackId("learn", l) === track.id && !isLearnDone(l) && getLearnStatus(l) !== "closed",
  );
  const liveIds = new Set(tLearn.map((l) => l.id));

  // Map each Learn item to its (first) gap domain it addresses. Only items whose
  // domain is an open gap participate; the rest aren't part of the gap path.
  const gapSet = new Set<CapabilityDomainKey>(gapDomains);
  type Entry = { l: Learn; domain: CapabilityDomainKey; unmet: boolean; dleft: number | null };
  const entries: Entry[] = [];
  const coveredDomains = new Set<CapabilityDomainKey>();

  for (const l of tLearn) {
    const key = domainForLearn(l.category, l.capabilityBuilt) as CapabilityDomainKey | null;
    if (!key || !gapSet.has(key)) continue;
    let prereqs: number[] = [];
    try { const a = JSON.parse(l.prerequisites || "[]"); if (Array.isArray(a)) prereqs = a.map(Number).filter(Number.isFinite); } catch { /* ignore */ }
    // unmet prereq = a prerequisite that is still a live (not-done) item on the track.
    const unmet = prereqs.some((id) => liveIds.has(id));
    entries.push({ l, domain: key, unmet, dleft: daysUntil(l.applicationDeadline, now) });
    coveredDomains.add(key);
  }

  // Deterministic sort. Primary: items with met prerequisites first (unmet after).
  // Secondary: near-deadline first (smaller days-left wins; null = no deadline = last).
  // Tertiary: learnStatus progress (active/enrolled ahead of open). Then id (stable).
  const statusRank = (l: Learn): number => {
    const s = getLearnStatus(l);
    if (s === "active" || s === "enrolled") return 0;
    if (s === "applied") return 1;
    if (s === "watch") return 2;
    return 3; // open / other
  };
  entries.sort((a, b) => {
    if (a.unmet !== b.unmet) return a.unmet ? 1 : -1;
    const aNear = a.dleft != null && a.dleft <= NEAR_DEADLINE_DAYS && a.dleft >= 0;
    const bNear = b.dleft != null && b.dleft <= NEAR_DEADLINE_DAYS && b.dleft >= 0;
    if (aNear !== bNear) return aNear ? -1 : 1;
    if (aNear && bNear && a.dleft !== b.dleft) return (a.dleft as number) - (b.dleft as number);
    const sr = statusRank(a.l) - statusRank(b.l);
    if (sr !== 0) return sr;
    return a.l.id - b.l.id;
  });

  const steps: SequenceStep[] = entries.map((e) => {
    const near = e.dleft != null && e.dleft <= NEAR_DEADLINE_DAYS && e.dleft >= 0;
    const reason = e.unmet
      ? "Has an unmet prerequisite — comes after the items it depends on"
      : near
        ? `Deadline in ${e.dleft} day${e.dleft === 1 ? "" : "s"} — do this sooner`
        : "Builds a required capability for this track";
    return {
      learnId: e.l.id,
      title: e.l.title,
      gapDomain: e.domain,
      domainLabel: domainLabel(e.domain),
      reason,
      hasUnmetPrereq: e.unmet,
      deadline: e.l.applicationDeadline || "",
    };
  });

  // Unfilled-gap slots: gap domains with NO matching live Learn item. These are
  // the attach points for later (out-of-scope) discovered resources.
  for (const g of gapDomains) {
    if (coveredDomains.has(g)) continue;
    steps.push({
      learnId: null,
      title: null,
      gapDomain: g,
      domainLabel: domainLabel(g),
      reason: "No resource yet for this capability — find one",
      hasUnmetPrereq: false,
      deadline: "",
    });
  }

  return steps;
}

export type LearningGapResult = {
  tracks: TrackLearningGap[];
};

// Compute per-track capability gaps + sequencing. Read-only over existing storage.
export async function computeLearningGaps(now = Date.now()): Promise<LearningGapResult> {
  const [tracks, learn, hustles, evidence, proofLinkIds] = await Promise.all([
    storage.getCareerTracks(), storage.getLearn(), storage.getHustles(),
    computeEvidence(), storage.getLearnProofLinkIds(),
  ]);
  const wins = await storage.getWins();

  // Wins attributed to each track via the shared evidence layer (P5: prefers
  // wins.trackId, text-match fallback). evidence.byTrack gives counts, but we
  // need the actual win rows per track for domain normalization — recompute the
  // attribution cheaply by reusing the same key the evidence layer exposes.
  // computeEvidence already attributed; to avoid forking that logic we group
  // wins by their attributed track using the wins.trackId column directly (the
  // common, deterministic case) and leave legacy untracked wins out of domain
  // crediting (they cannot be cleanly tied to a track here without the window).
  const winsByTrack = new Map<number, Win[]>();
  for (const w of wins) {
    if (w.trackId == null) continue;
    const arr = winsByTrack.get(w.trackId) || [];
    arr.push(w);
    winsByTrack.set(w.trackId, arr);
  }

  const result: TrackLearningGap[] = [];
  for (const track of tracks) {
    const required = requiredDomainsForTrack(track);
    const evidencedSet = evidencedDomainsForTrack(
      track, learn, hustles, winsByTrack.get(track.id) || [], proofLinkIds,
    );
    const evidencedDomains = CAPABILITY_DOMAIN_KEYS.filter((k) => evidencedSet.has(k as CapabilityDomainKey)) as CapabilityDomainKey[];
    const gapDomains = required.filter((d) => !evidencedSet.has(d));
    const rankedGaps: RankedGap[] = gapDomains.map((d) => ({ domain: d, label: domainLabel(d) }));
    const sequence = sequenceForTrack(track, gapDomains, learn, now);
    result.push({
      trackId: track.id, slug: track.slug, name: track.name,
      priority: track.priority, status: track.status,
      requiredDomains: required,
      evidencedDomains,
      gapDomains,
      rankedGaps,
      sequence,
      unfilledGapCount: sequence.filter((s) => s.learnId === null).length,
    });
  }

  // Outer rank: by track.priority desc, then by number of gaps desc (more gaps =
  // more attention), then by id for stability.
  result.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.gapDomains.length !== a.gapDomains.length) return b.gapDomains.length - a.gapDomains.length;
    return a.trackId - b.trackId;
  });

  return { tracks: result };
}

// Convenience: the single highest-priority track that has an open gap, with a
// recommended move. Used by the strategy front-door (5.4). Returns null when no
// track has a gap.
export type LearningGapSignal = {
  trackId: number;
  trackName: string;
  gapDomains: CapabilityDomainKey[];
  topGap: RankedGap;
  recommendedMove: string;
  hasResource: boolean; // true when a Learn item already addresses the top gap
  learnId: number | null; // the specific Learn item id to act on next (null when no resource)
};

export function topLearningGapSignal(gaps: TrackLearningGap[]): LearningGapSignal | null {
  // gaps already sorted by priority then gap count; first active track with a gap.
  for (const g of gaps) {
    if (g.status !== "active") continue;
    if (g.gapDomains.length === 0) continue;
    const topGap = g.rankedGaps[0];
    // Is there a live Learn item for the top gap (i.e. a sequence step with an id)?
    const step = g.sequence.find((s) => s.gapDomain === topGap.domain && s.learnId !== null);
    const hasResource = !!step;
    const recommendedMove = hasResource
      ? `Build ${topGap.label}: do the next step on "${step!.title}"`
      : `No resource yet for ${topGap.label} — find one`;
    return {
      trackId: g.trackId, trackName: g.name,
      gapDomains: g.gapDomains, topGap, recommendedMove, hasResource,
      learnId: step?.learnId ?? null,
    };
  }
  return null;
}
