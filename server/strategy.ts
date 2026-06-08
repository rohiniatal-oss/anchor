import { storage } from "./storage";
import {
  isJobLive, isOpportunityActionable, getJobReadiness, isLearnDone, isLearnActive, getLearnStatus,
  isContactWarm, isProofLive, isTaskDone, getTaskReadiness, getTrackId,
  getLearnOutputState, type WinCategory,
} from "@shared/domainState";
import type { Job, Learn, Contact, Hustle, Task, CareerTrack, JobPipelineStep, ProofAssetStep } from "@shared/schema";
import { computeEvidence, type TrackEvidence, type EvidenceResult } from "./evidence";
import { computeLearningGaps, topLearningGapSignal, type TrackLearningGap, type LearningGapSignal } from "./learningStrategy";

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY DIAGNOSTICS — per-track health, the bottleneck types, and a
// deterministic recommended move. No LLM, no fabrication. An "unlinked" bucket
// (trackId null/0) collects orphaned source items so they stay fixable.
// ─────────────────────────────────────────────────────────────────────────

export type BottleneckType = "direction" | "readiness" | "proof" | "warmth" | "execution" | "learning" | "none";

export type TrackDiagnostic = {
  id: number;
  slug: string;
  name: string;
  status: string;
  priority: number;
  whyItFits: string;
  counts: { jobs: number; learn: number; contacts: number; hustles: number; tasks: number };
  signals: {
    directionGap: number;
    readinessGap: number;
    proofGap: number;      // count of active proof-support assets that are stalled; absence alone is not a gap
    warmthGap: number;
    executionGap: number;
    learningGap: number;   // P5 — count of REQUIRED capability domains not yet evidenced; structural, ranks below readiness/warmth/execution and above the calm nudges
    learnProofGap: number; // P4.4 — opt-in, lowest priority; never the sole bottleneck driver
    evidenceGap: number;   // P4.5 — soft "no evidence shipping" signal; lowest priority, never the loud primary
  };
  // P4.5 — compact, read-mostly evidence read for the per-track Strategy view.
  // Evidence is a HEALTH input + tiebreaker; it never becomes the loud primary
  // bottleneck on its own (stays below readiness/learning/warmth).
  evidence: {
    count: number;                 // wins in the rolling window attributed to the track
    topCategory: WinCategory | null;
    producingVsPlanning: TrackEvidence["producingVsPlanning"];
    executionRatio: number | null;
    lastEvidenceAt: number | null;
  };
  // P5 — compact, read-mostly capability-gap read for the per-track Strategy view.
  // A STRUCTURAL signal (a track missing a required capability), but it ranks below
  // readiness/learning/warmth and never inflates them. Null when the track has no
  // capability profile (no false alarms).
  learningGap: {
    requiredCount: number;
    evidencedCount: number;
    gapCount: number;
    topGapLabel: string | null;     // highest-ranked unmet domain, null if none
    topGapHasResource: boolean;     // a live Learn item already addresses the top gap
    recommendedMove: string | null; // deterministic move, null when no gap
  } | null;
  bottleneck: BottleneckType;
  bottleneckLabel: string;
  recommendedMove: string;
};

const LOW_WARMTH = 40; // warmPathScore threshold

// A contact is "overdue for follow-up" when its nextFollowUpDate is a valid
// past date. Stale warm paths erode warmth, so this feeds the warmth gap.
function isContactOverdue(c: Contact): boolean {
  const raw = (c.nextFollowUpDate || "").trim();
  if (!raw) return false;
  const due = new Date(raw + "T00:00:00");
  if (isNaN(due.getTime())) return false;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return due.getTime() < now.getTime();
}

export function diagnoseTrack(
  track: CareerTrack,
  jobs: Job[], learn: Learn[], contacts: Contact[], hustles: Hustle[], tasks: Task[],
  stepsByJob: Map<number, JobPipelineStep[]>,
  proofStepsByHustle: Map<number, ProofAssetStep[]>,
  ev: TrackEvidence,
  lg: TrackLearningGap | undefined,
): TrackDiagnostic {
  const tJobs = jobs.filter((j) => getTrackId("jobs", j) === track.id);
  // Window-aware "live": a watch/closed fellowship (or any closed-window job) is
  // MONITORED, not a live application, so it must not inflate readiness/warmth.
  const tLiveJobs = tJobs.filter(isOpportunityActionable);
  const tLearn = learn.filter((l) => getTrackId("learn", l) === track.id && !isLearnDone(l) && getLearnStatus(l) !== "closed");
  const tContacts = contacts.filter((c) => getTrackId("contacts", c) === track.id);
  const tHustles = hustles.filter((h) => getTrackId("hustles", h) === track.id);
  const tTasks = tasks.filter((t) => t.relatedTrackId === track.id);

  // ── Signal counts (one per bottleneck type) ──
  // direction gap: too few active objects on the track (nothing live to pull on)
  const liveObjects = tLiveJobs.length + tLearn.filter(isLearnActive).length + tHustles.filter(isProofLive).length;
  const directionGap = liveObjects === 0 ? 1 : 0;

  // readiness gap: jobs with low readiness; tasks needing info or blocked
  const lowReadinessJobs = tLiveJobs.filter((j) => getJobReadiness(j) === "none" || getJobReadiness(j) === "cv").length;
  const stuckTasks = tTasks.filter((t) => !isTaskDone(t) && (getTaskReadiness(t) === "needs_info" || getTaskReadiness(t) === "blocked")).length;
  // P4.1/4.2: a job's pipeline rail feeds the readiness gap so it isn't ornamental —
  // a live job with steps but little done, or with blocked steps, signals work
  // left to ready the application. Blocked steps now carry their own status
  // "blocked" (P4.2 fold-in); "skipped" is a separate resolved state, not a stall.
  const stallSteps = tLiveJobs.reduce((acc, j) => {
    const steps = stepsByJob.get(j.id) || [];
    if (steps.length === 0) return acc;
    const done = steps.filter((s) => s.status === "done").length;
    const blocked = steps.filter((s) => s.status === "blocked").length;
    const fewDone = done < Math.ceil(steps.length / 2) ? 1 : 0;
    return acc + fewDone + blocked;
  }, 0);
  const readinessGap = lowReadinessJobs + stuckTasks + stallSteps;

  // proof gap: ONLY active proof-support assets that are already in motion but
  // stalled. Proof is an optional compounding lane; simply lacking a proof asset
  // is not a frontline gap for this track.
  const liveProof = tHustles.filter(isProofLive).length;
  const proofStall = tHustles.reduce((acc, h) => {
    const steps = proofStepsByHustle.get(h.id) || [];
    if (steps.length === 0) return acc;
    const done = steps.filter((s) => s.status === "done").length;
    const blocked = steps.filter((s) => s.status === "blocked").length;
    const fewDone = done < Math.ceil(steps.length / 2) ? 1 : 0;
    return acc + fewDone + blocked;
  }, 0);
  // P4.4 — learn-proof signal (GENTLE, LOW PRIORITY, OPT-IN ONLY): count learn
  // items the user has opted into the proof-building lane (track-linked here, so
  // already opted-in) that are still "producing" — i.e. no output evidence yet.
  // Pure-consumption / reference items are NEVER counted and never reduce proof
  // health. This signal is reported separately and DELIBERATELY excluded from the
  // primary proofGap math so it can never become the bottleneck on its own.
  const learnNoOutput = tLearn.filter((l) => getLearnOutputState(l) === "producing").length;
  const proofGap = proofStall;

  // warmth gap: live jobs with low warmPathScore; cold / absent contacts; AND
  // contacts overdue for follow-up (P4.2) — a stale warm path is a warmth gap too.
  const lowWarmJobs = tLiveJobs.filter((j) => (j.warmPathScore ?? 0) < LOW_WARMTH).length;
  const noWarmContacts = tContacts.filter(isContactWarm).length === 0 ? 1 : 0;
  const overdueContacts = tContacts.filter(isContactOverdue).length;
  const warmthGap = (tLiveJobs.length > 0 ? lowWarmJobs : 0) + (tContacts.length === 0 ? 1 : noWarmContacts) + overdueContacts;

  // execution gap: many ready tasks vs few done
  const readyTasks = tTasks.filter((t) => !isTaskDone(t) && getTaskReadiness(t) === "ready").length;
  const doneTasks = tTasks.filter(isTaskDone).length;
  const executionGap = readyTasks >= 3 && doneTasks === 0 ? readyTasks : 0;

  // learnProofGap is reported alongside the others but is INTENTIONALLY the lowest
  // priority — it can only surface as the recommended move once every structural
  // gap (direction/warmth/readiness/execution/learning) is clear. Opt-in only.
  const learnProofGap = learnNoOutput;

  // P4.5 — evidence gap (SOFT, LOW PRIORITY): a track that has live work in
  // motion (live jobs / active learn / live proof) but ZERO recent wins is
  // "generating plans, not producing evidence". This is a track-HEALTH input and
  // a tiebreaker — DELIBERATELY computed last and gated so it can only surface as
  // the recommended move once every structural gap is clear. It is NOT folded
  // into any other gap's math, so it can never become the loud primary blocker.
  const hasLiveWork = liveObjects > 0 || tTasks.some((t) => !isTaskDone(t));
  const evidenceGap = (hasLiveWork && ev.evidenceCount === 0) ? 1 : 0;

  // P5 — learning gap: count of REQUIRED capability domains for this track not yet
  // evidenced. STRUCTURAL (a real capability hole), but it ranks BELOW
  // readiness/warmth/execution and ABOVE the calm learn-proof / evidence nudges, so it
  // never overrides a more urgent structural blocker. Zero when the track has no
  // capability profile — no false alarms (Afterline: gaps are CAPABILITY coverage,
  // never a demand to put AI content on the geopolitics proof asset).
  const learningGap = lg ? lg.gapDomains.length : 0;
  const signals = { directionGap, readinessGap, proofGap, warmthGap, executionGap, learningGap, learnProofGap, evidenceGap };

  // ── Primary bottleneck (deterministic priority order) + recommended move ──
  let bottleneck: BottleneckType = "none";
  let bottleneckLabel = "Moving well — keep the drumbeat";
  let recommendedMove = "Advance the next live item on this track";

  if (directionGap > 0) {
    bottleneck = "direction";
    bottleneckLabel = "No live opportunities yet";
    recommendedMove = "Add or activate a role, learning item, or proof asset on this track";
  } else if (warmthGap > 0 && tLiveJobs.length > 0) {
    const overdue = tContacts.filter(isContactOverdue).length;
    bottleneck = "warmth";
    bottleneckLabel = tContacts.length === 0
      ? "Roles but no warm contact"
      : overdue > 0 ? `${overdue} contact${overdue > 1 ? "s" : ""} overdue for follow-up` : "Contacts are cold";
    recommendedMove = overdue > 0
      ? "Follow up with the contacts that have gone cold"
      : "Create an outreach task to warm a path to these roles";
  } else if (readinessGap > 0) {
    bottleneck = "readiness";
    bottleneckLabel = stuckTasks > 0 ? "Tasks blocked or need info" : "Applications not ready";
    recommendedMove = stuckTasks > 0
      ? "Create a task to unblock what's stuck"
      : "Create a task to tailor materials for your strongest role";
  } else if (executionGap > 0) {
    bottleneck = "execution";
    bottleneckLabel = `${executionGap} ready tasks, none done`;
    recommendedMove = "Pick the top ready task and finish one today";
  } else if (learningGap > 0 && lg) {
    // P5 — STRUCTURAL capability gap, reached only when no readiness/warmth/
    // execution blocker is louder. Names the top unmet domain and points at the
    // sequenced Learn item if one exists, else flags the unfilled-gap slot.
    const topGap = lg.rankedGaps[0];
    const step = lg.sequence.find((s) => s.gapDomain === topGap.domain && s.learnId !== null);
    bottleneck = "learning";
    bottleneckLabel = learningGap === 1
      ? `Missing a required capability: ${topGap.label}`
      : `${learningGap} required capabilities not yet evidenced`;
    recommendedMove = step
      ? `Build ${topGap.label}: do the next step on "${step.title}"`
      : `No resource yet for ${topGap.label} — find one`;
  } else if (proofGap > 0 && liveProof > 0) {
    // Optional, low-priority capability support: only surfaces once the main
    // conversion blockers are quiet, and only for proof assets the user already
    // chose to keep live.
    bottleneck = "proof";
    bottleneckLabel = "Active proof asset stalled";
    recommendedMove = "Produce one reusable output from the active proof asset";
  } else if (learnProofGap > 0) {
    // LOWEST-PRIORITY, OPT-IN nudge: only reached when nothing structural is the
    // bottleneck. Stays "proof"-typed but is gentle — never the primary blocker.
    bottleneck = "proof";
    bottleneckLabel = learnProofGap === 1
      ? "A proof-building learning item has no output yet"
      : `${learnProofGap} proof-building learning items have no output yet`;
    recommendedMove = "When you're ready, give one an output so it becomes reusable evidence";
  } else if (evidenceGap > 0) {
    // P4.5 — SOFTEST nudge, reached only when every structural gap is clear: the
    // track has live work but nothing has shipped as evidence lately. Stays
    // "execution"-typed and calm — a gentle "log/ship one win", never an alarm.
    bottleneck = "execution";
    bottleneckLabel = "Live work, no recent evidence";
    recommendedMove = liveProof > 0
      ? "Ship one proof output and log it as a win"
      : "Log a win for this track to show it's moving";
  }

  return {
    id: track.id, slug: track.slug, name: track.name, status: track.status,
    priority: track.priority, whyItFits: track.whyItFits,
    counts: { jobs: tJobs.length, learn: tLearn.length, contacts: tContacts.length, hustles: tHustles.length, tasks: tTasks.length },
    signals,
    evidence: {
      count: ev.evidenceCount, topCategory: ev.topCategory,
      producingVsPlanning: ev.producingVsPlanning,
      executionRatio: ev.executionRatio, lastEvidenceAt: ev.lastEvidenceAt,
    },
    learningGap: buildLearningGapRead(lg),
    bottleneck, bottleneckLabel, recommendedMove,
  };
}

// P5 — the compact per-track capability read for the Strategy view. Null when the
// track has no capability profile (requiredDomains empty) so the UI shows nothing.
function buildLearningGapRead(lg: TrackLearningGap | undefined): TrackDiagnostic["learningGap"] {
  if (!lg || lg.requiredDomains.length === 0) return null;
  const topGap = lg.rankedGaps[0] ?? null;
  let topGapHasResource = false;
  let recommendedMove: string | null = null;
  if (topGap) {
    const step = lg.sequence.find((s) => s.gapDomain === topGap.domain && s.learnId !== null);
    topGapHasResource = !!step;
    recommendedMove = step
      ? `Build ${topGap.label}: do the next step on "${step.title}"`
      : `No resource yet for ${topGap.label} — find one`;
  }
  return {
    requiredCount: lg.requiredDomains.length,
    evidencedCount: lg.evidencedDomains.length,
    gapCount: lg.gapDomains.length,
    topGapLabel: topGap ? topGap.label : null,
    topGapHasResource,
    recommendedMove,
  };
}

export async function getTrackDiagnostics(): Promise<TrackDiagnostic[]> {
  const [tracks, jobs, learn, contacts, hustles, tasks, evidence] = await Promise.all([
    storage.getCareerTracks(), storage.getJobs(), storage.getLearn(),
    storage.getContacts(), storage.getHustles(), storage.getTasks(),
    computeEvidence(), // P4.5 — shared evidence layer, attribution lives in evidence.ts
  ]);
  // Pull each live job's pipeline steps so the rail feeds the readiness gap.
  const liveJobs = jobs.filter(isJobLive);
  const stepLists = await Promise.all(liveJobs.map((j) => storage.getJobSteps(j.id)));
  const stepsByJob = new Map<number, JobPipelineStep[]>();
  liveJobs.forEach((j, i) => stepsByJob.set(j.id, stepLists[i]));
  // P4.3: pull each proof asset's production rail so a stalled asset feeds the proof gap.
  const proofStepLists = await Promise.all(hustles.map((h) => storage.getProofAssetSteps(h.id)));
  const proofStepsByHustle = new Map<number, ProofAssetStep[]>();
  hustles.forEach((h, i) => proofStepsByHustle.set(h.id, proofStepLists[i]));
  const emptyEv = (id: number): TrackEvidence => ({
    trackId: id, evidenceCount: 0, evidenceCountAllTime: 0,
    evidenceByCategory: { job_progress: 0, learning: 0, network: 0, proof_asset: 0, mindset: 0, admin: 0 },
    topCategory: null, lastEvidenceAt: null, executionRatio: null, executionEvents: 0,
    openTasks: 0, producingVsPlanning: "idle",
  });
  // P5 — per-track capability gaps (data-driven targets vs evidenced domains).
  const learningGaps = await computeLearningGaps();
  const lgByTrack = new Map<number, TrackLearningGap>();
  for (const g of learningGaps.tracks) lgByTrack.set(g.trackId, g);
  const diagnostics = tracks.map((t) =>
    diagnoseTrack(t, jobs, learn, contacts, hustles, tasks, stepsByJob, proofStepsByHustle,
      evidence.byTrack.get(t.id) ?? emptyEv(t.id), lgByTrack.get(t.id)));

  // P4.5 — evidence is a TIEBREAKER for the per-track ranking, applied AFTER the
  // existing priority order (track.priority, then bottleneck severity). It only
  // separates tracks that are otherwise tied: a track with live work and no
  // recent evidence sorts ahead of an equally-ranked one that's shipping. This
  // nudges attention without overriding readiness/learning/warmth.
  // Severity is the cross-track tiebreaker (applied after track.priority). The
  // learning gap is STRUCTURAL but ranks below the readiness/warmth/execution
  // blockers. Proof support is lower still: useful, but not a frontline gate.
  const severity: Record<BottleneckType, number> = {
    direction: 6, warmth: 5, readiness: 4, execution: 3, learning: 2, proof: 1, none: 0,
  };
  return diagnostics.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (severity[b.bottleneck] !== severity[a.bottleneck]) return severity[b.bottleneck] - severity[a.bottleneck];
    // tiebreaker: surface the evidence-starved track first
    return (a.evidence.count) - (b.evidence.count);
  });
}

// P4.5 — read-only per-track + untracked evidence metrics, exposed for the
// Strategy dashboard. Reuses the single shared evidence layer (evidence.ts).
export type EvidencePayload = {
  windowDays: number;
  tracks: (TrackEvidence & { name?: string; slug?: string })[];
  untracked: TrackEvidence;
};
export async function getEvidencePayload(): Promise<EvidencePayload> {
  const [tracks, evidence] = await Promise.all([storage.getCareerTracks(), computeEvidence()]);
  const nameById = new Map(tracks.map((t) => [t.id, t] as const));
  const trackRows: EvidencePayload["tracks"] = [];
  evidence.byTrack.forEach((ev, key) => {
    if (key === "untracked") return;
    const t = nameById.get(key as number);
    trackRows.push({ ...ev, name: t?.name, slug: t?.slug });
  });
  const untracked = evidence.byTrack.get("untracked")!;
  return { windowDays: evidence.windowDays, tracks: trackRows, untracked };
}

// ─────────────────────────────────────────────────────────────────────────
// P4.6a #5 — UNIFIED STRATEGY FRONT DOOR. getTrackDiagnostics is the ONE engine;
// this wraps it once to produce everything the Strategy view needs in a single
// payload: ranked tracks, the topThree focus set, cross-cutting insights derived
// FROM the diagnostics (not a parallel computation), the unlinked bucket, and the
// evidence payload. Legacy /api/strategy delegates here so there is no second
// source of truth.
// ─────────────────────────────────────────────────────────────────────────
export type StrategyInsight = { kind: string; text: string };
export type StrategyFrontDoor = {
  tracks: TrackDiagnostic[];
  topThree: TrackDiagnostic[];
  insights: StrategyInsight[];
  unlinked: { items: UnlinkedItem[]; counts: Record<string, number> };
  evidence: EvidencePayload;
  // P5 — the single highest-priority active track with an open capability gap +
  // its recommended move. Null when no active track has a gap. Read-only.
  learningGap: LearningGapSignal | null;
};

// Cross-cutting insights READ OFF the diagnostics (single engine). Highest-signal
// first, capped at 3, calm and never fabricated.
function deriveInsights(tracks: TrackDiagnostic[]): StrategyInsight[] {
  const out: StrategyInsight[] = [];
  const active = tracks.filter((t) => t.status === "active");

  const readinessTrack = active.find((t) => t.bottleneck === "readiness");
  if (readinessTrack)
    out.push({ kind: "readiness", text: `Your bottleneck on ${readinessTrack.name} isn't more roles — it's getting one ready. ${readinessTrack.recommendedMove}.` });

  const warmthTrack = active.find((t) => t.bottleneck === "warmth");
  if (warmthTrack)
    out.push({ kind: "warmth", text: `${warmthTrack.name} has live roles but no warm path — a referral would unlock more than another saved role.` });

  const proofTrack = active.find((t) => t.bottleneck === "proof");
  if (proofTrack)
    out.push({ kind: "proof", text: `${proofTrack.name}: ${proofTrack.bottleneckLabel.toLowerCase()}. Ship one reusable output if it will compound the lane.` });

  // P5 — structural capability gap, surfaced calmly and ranked below the above.
  const learningTrack = active.find((t) => t.bottleneck === "learning" && t.learningGap);
  if (learningTrack && learningTrack.learningGap?.recommendedMove)
    out.push({ kind: "learning", text: `${learningTrack.name}: ${learningTrack.learningGap.recommendedMove}.` });

  if (out.length === 0 && active.length)
    out.push({ kind: "focus", text: `Most focus is on ${active[0].name}. That's your spine — keep it moving and let the rest stay light.` });

  return out.slice(0, 3);
}

export async function getStrategyFrontDoor(): Promise<StrategyFrontDoor> {
  const [tracks, unlinked, evidence, learningGaps] = await Promise.all([
    getTrackDiagnostics(), getUnlinkedItems(), getEvidencePayload(), computeLearningGaps(),
  ]);
  return {
    tracks,
    topThree: tracks.slice(0, 3),
    insights: deriveInsights(tracks),
    unlinked,
    evidence,
    learningGap: topLearningGapSignal(learningGaps.tracks),
  };
}

export type UnlinkedItem = { entity: "jobs" | "learn" | "contacts" | "hustles"; id: number; title: string; status: string };

// Source items with no track link (trackId null/0) — orphans that should be linked.
export async function getUnlinkedItems(): Promise<{ items: UnlinkedItem[]; counts: Record<string, number> }> {
  const [jobs, learn, contacts, hustles] = await Promise.all([
    storage.getJobs(), storage.getLearn(), storage.getContacts(), storage.getHustles(),
  ]);
  const items: UnlinkedItem[] = [];
  for (const j of jobs) if (isJobLive(j) && !getTrackId("jobs", j)) items.push({ entity: "jobs", id: j.id, title: j.title, status: j.status });
  for (const l of learn) if (!isLearnDone(l) && getLearnStatus(l) !== "closed" && !getTrackId("learn", l)) items.push({ entity: "learn", id: l.id, title: l.title, status: l.learnStatus });
  for (const c of contacts) if (!getTrackId("contacts", c)) items.push({ entity: "contacts", id: c.id, title: c.who || c.name || "contact", status: c.status });
  for (const h of hustles) if (!getTrackId("hustles", h)) items.push({ entity: "hustles", id: h.id, title: h.title, status: h.stage });
  const counts: Record<string, number> = { jobs: 0, learn: 0, contacts: 0, hustles: 0 };
  for (const it of items) counts[it.entity]++;
  return { items, counts };
}
