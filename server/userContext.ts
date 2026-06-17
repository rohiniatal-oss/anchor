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
};

export async function buildUserContext(): Promise<UserContext> {
  const [profile, tracks, jobs, contacts, wins, evidence] = await Promise.all([
    storage.getProfile(),
    storage.getCareerTracks(),
    storage.getJobs(),
    storage.getContacts(),
    storage.getWins(),
    computeEvidence(),
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

  return { profile: USER_PROFILE, cv, phase, trackSummaries, recentWins, activitySignal };
}

function liveJobCount(jobs: any[]) {
  return jobs.filter(isJobLive).length;
}

export function formatContextForPrompt(ctx: UserContext): string {
  const parts = [`User profile: ${ctx.profile}`];
  if (ctx.cv) parts.push(`CV summary available.`);
  parts.push(`Phase: ${ctx.phase}.`);
  if (ctx.trackSummaries) parts.push(`Active tracks: ${ctx.trackSummaries}.`);
  if (ctx.recentWins) parts.push(`Recent wins: ${ctx.recentWins}.`);
  parts.push(`Activity: ${ctx.activitySignal}.`);
  return parts.join(" ");
}
