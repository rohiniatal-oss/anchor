import { storage } from "./storage";
import { USER_PROFILE } from "./userPromptProfile";
import { computeEvidence } from "./evidence";
import { isJobLive, isContactWarm, getTrackId } from "@shared/domainState";

export type UserContext = {
  profile: string;
  cv: string | null;
  phase: string;
  trackSummaries: string;
  recentWins: string;
  activitySignal: string;
  activeLearning: string;
  proofAssets: string;
};

/**
 * Context scope controls which DB queries fire.
 * - "full"      — all 8 queries (legacy, used by coaching summary)
 * - "job"       — profile, CV, tracks, jobs, wins (no contacts, learns, hustles)
 * - "contact"   — profile, CV, tracks, contacts, wins (no learns, hustles)
 * - "learn"     — profile, CV, tracks, learns, hustles, wins (no jobs, contacts)
 * - "goal"      — profile, tracks, wins (minimal)
 * - "task"      — profile, CV, wins (bare minimum for generic tasks)
 */
export type UserContextScope = "full" | "job" | "contact" | "learn" | "goal" | "task";

export async function buildUserContext(scope: UserContextScope = "full"): Promise<UserContext> {
  const needsJobs = scope === "full" || scope === "job";
  const needsContacts = scope === "full" || scope === "contact";
  const needsLearn = scope === "full" || scope === "learn";
  const needsHustles = scope === "full" || scope === "learn";
  const needsEvidence = scope === "full" || scope === "job" || scope === "contact";

  const [profile, tracks, jobs, contacts, wins, evidence, learns, hustles] = await Promise.all([
    storage.getProfile(),
    storage.getCareerTracks(),
    needsJobs ? storage.getJobs() : Promise.resolve([]),
    needsContacts ? storage.getContacts() : Promise.resolve([]),
    storage.getWins(),
    needsEvidence ? computeEvidence() : Promise.resolve({ byTrack: new Map() }),
    needsLearn ? storage.getLearn() : Promise.resolve([]),
    needsHustles ? storage.getHustles() : Promise.resolve([]),
  ]);

  const cv = profile?.cvText || null;

  const activeTracks = tracks.filter((t) => t.status === "active");
  const trackSummaries = activeTracks.map((t) => {
    const trackJobs = needsJobs ? jobs.filter((j) => getTrackId("jobs", j) === t.id) : [];
    const liveJobs = trackJobs.filter(isJobLive);
    const trackContacts = needsContacts ? contacts.filter((c) => getTrackId("contacts", c) === t.id) : [];
    const warmContacts = trackContacts.filter(isContactWarm);
    const te = needsEvidence ? evidence.byTrack.get(t.id) : undefined;
    const exec = te?.executionRatio != null ? `${Math.round(te.executionRatio * 100)}% execution` : "no activity";
    const parts = [t.name];
    if (needsJobs) parts.push(`${liveJobs.length} live roles`);
    if (needsContacts) parts.push(`${warmContacts.length} warm contacts`);
    parts.push(exec);
    return parts.join(", ");
  }).join("; ");

  const recentWins = wins
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5)
    .map((w) => w.text)
    .join("; ");

  const activeJobs = needsJobs ? jobs.filter((j) => activeTracks.some((t) => getTrackId("jobs", j) === t.id)) : [];
  const phase = activeTracks.length === 0
    ? "exploration"
    : liveJobCount(activeJobs) === 0
    ? "fit-discovery"
    : "active-pursuit";

  const producing = needsEvidence ? [...evidence.byTrack.values()].filter((e) => e.producingVsPlanning === "producing").length : 0;
  const planning = needsEvidence ? [...evidence.byTrack.values()].filter((e) => e.producingVsPlanning === "planning").length : 0;
  const idle = needsEvidence ? [...evidence.byTrack.values()].filter((e) => e.producingVsPlanning === "idle").length : 0;
  const activitySignal = needsEvidence ? `${producing} tracks producing, ${planning} planning, ${idle} idle` : "";

  const activeLearnItems = needsLearn ? learns.filter((l) => l.active && !l.done) : [];
  const activeLearning = activeLearnItems
    .slice(0, 6)
    .map((l) => `${l.title}${l.capabilityBuilt ? ` (building: ${l.capabilityBuilt})` : ""}`)
    .join("; ");

  const activeHustles = needsHustles ? hustles.filter((h) => h.stage !== "done" && h.stage !== "abandoned") : [];
  const proofAssets = activeHustles
    .slice(0, 4)
    .map((h) => `${h.title}${h.coreClaim ? ` — "${h.coreClaim}"` : ""}${h.stage ? ` [${h.stage}]` : ""}`)
    .join("; ");

  return { profile: USER_PROFILE, cv, phase, trackSummaries, recentWins, activitySignal, activeLearning, proofAssets };
}

function liveJobCount(jobs: any[]) {
  return jobs.filter(isJobLive).length;
}

export function contextFingerprint(ctx: UserContext): string {
  const key = `${ctx.phase}|${ctx.trackSummaries}|${(ctx.cv || "").slice(0, 200)}|${ctx.activeLearning}|${ctx.proofAssets}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Select the most relevant CV excerpt for a given task/job rather than always
 * slicing the first 1,200 chars. Splits into paragraph blocks and prioritises
 * those containing keywords from the job title, role archetype, or task title.
 */
export function relevantCvExcerpt(cv: string | null, keywords: string[]): string {
  if (!cv) return "";
  if (!keywords.length) return cv.slice(0, 1200);

  const blocks = cv.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  if (blocks.length <= 3) return cv.slice(0, 1200);

  const lower = keywords.map((k) => k.toLowerCase());
  const scored = blocks.map((block) => {
    const blockLower = block.toLowerCase();
    const score = lower.reduce((n, k) => n + (blockLower.includes(k) ? 1 : 0), 0);
    return { block, score };
  });

  const first = scored[0];
  const rest = scored.slice(1).sort((a, b) => b.score - a.score);

  let result = first.block + "\n\n";
  for (const { block } of rest) {
    if ((result + "\n\n" + block).length > 1600) break;
    result += "\n\n" + block;
  }
  return result.slice(0, 1600);
}

export function formatContextForPrompt(ctx: UserContext, cvExcerpt?: string): string {
  const parts = [`User profile: ${ctx.profile}`];
  const cv = cvExcerpt ?? (ctx.cv ? ctx.cv.slice(0, 1200) : null);
  if (cv) parts.push(`\nCV (abbreviated): ${cv}`);
  parts.push(`\nPhase: ${ctx.phase}.`);
  if (ctx.trackSummaries) parts.push(`Active tracks: ${ctx.trackSummaries}.`);
  if (ctx.recentWins) parts.push(`Recent wins: ${ctx.recentWins}.`);
  if (ctx.activeLearning) parts.push(`Currently learning: ${ctx.activeLearning}.`);
  if (ctx.proofAssets) parts.push(`Proof assets in progress: ${ctx.proofAssets}.`);
  if (ctx.activitySignal) parts.push(`Activity: ${ctx.activitySignal}.`);
  return parts.join("\n");
}
