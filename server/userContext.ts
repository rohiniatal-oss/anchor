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

export async function buildUserContext(): Promise<UserContext> {
  const [profile, tracks, jobs, contacts, wins, evidence, learns, hustles] = await Promise.all([
    storage.getProfile(),
    storage.getCareerTracks(),
    storage.getJobs(),
    storage.getContacts(),
    storage.getWins(),
    computeEvidence(),
    storage.getLearn(),
    storage.getHustles(),
  ]);

  const cv = profile?.cvText || null;

  const activeTracks = tracks.filter((t) => t.status === "active");
  const trackSummaries = activeTracks.map((t) => {
    const trackJobs = jobs.filter((j) => getTrackId("jobs", j) === t.id);
    const liveJobs = trackJobs.filter(isJobLive);
    const trackContacts = contacts.filter((c) => getTrackId("contacts", c) === t.id);
    const warmContacts = trackContacts.filter(isContactWarm);
    const te = evidence.byTrack.get(t.id);
    const exec = te?.executionRatio != null ? `${Math.round(te.executionRatio * 100)}% execution` : "no activity";
    return `${t.name}: ${liveJobs.length} live roles, ${warmContacts.length} warm contacts, ${exec}`;
  }).join("; ");

  const recentWins = wins
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5)
    .map((w) => w.text)
    .join("; ");

  const totalEvidence = evidence.byTrack.size;
  const producing = [...evidence.byTrack.values()].filter((e) => e.producingVsPlanning === "producing").length;
  const planning = [...evidence.byTrack.values()].filter((e) => e.producingVsPlanning === "planning").length;
  const idle = [...evidence.byTrack.values()].filter((e) => e.producingVsPlanning === "idle").length;

  const activeTrackIds = new Set<number | null>(activeTracks.map((t) => t.id));
  const activeJobs = jobs.filter((j) => activeTrackIds.has(getTrackId("jobs", j)));
  const phase = activeTracks.length === 0
    ? "exploration"
    : liveJobCount(activeJobs) === 0
    ? "fit-discovery"
    : "active-pursuit";

  const activitySignal = `${producing} tracks producing, ${planning} planning, ${idle} idle`;

  const activeLearnItems = learns.filter((l) => l.active && !l.done);
  const activeLearning = activeLearnItems
    .slice(0, 6)
    .map((l) => `${l.title}${l.capabilityBuilt ? ` (building: ${l.capabilityBuilt})` : ""}`)
    .join("; ");

  const activeHustles = hustles.filter((h) => h.stage !== "done" && h.stage !== "abandoned");
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

export function formatContextForPrompt(ctx: UserContext): string {
  const parts = [`User profile: ${ctx.profile}`];
  if (ctx.cv) parts.push(`\nCV (abbreviated): ${ctx.cv.slice(0, 1200)}`);
  parts.push(`\nPhase: ${ctx.phase}.`);
  if (ctx.trackSummaries) parts.push(`Active tracks: ${ctx.trackSummaries}.`);
  if (ctx.recentWins) parts.push(`Recent wins: ${ctx.recentWins}.`);
  if (ctx.activeLearning) parts.push(`Currently learning: ${ctx.activeLearning}.`);
  if (ctx.proofAssets) parts.push(`Proof assets in progress: ${ctx.proofAssets}.`);
  parts.push(`Activity: ${ctx.activitySignal}.`);
  return parts.join("\n");
}
