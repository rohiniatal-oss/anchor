import type { CareerTrack, Job, Task } from "@shared/schema";
import { storage } from "./storage";

export const PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS = "role_discovery_needed";

function norm(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function targetFor(track: CareerTrack) {
  return String(track.targetRoleArchetype || track.name || "this pathway").trim();
}

function belongsToTrack(track: CareerTrack, text: string, relatedTrackId?: number | null) {
  if (relatedTrackId && relatedTrackId === track.id) return true;
  const hay = norm(text);
  return [track.name, track.targetRoleArchetype, track.slug]
    .filter(Boolean)
    .map(norm)
    .some((key) => key.split(" ").filter((word) => word.length > 3).some((word) => hay.includes(word)));
}

function liveJobsForTrack(track: CareerTrack, jobs: Job[]) {
  return jobs.filter((job) =>
    job.status !== "closed"
    && belongsToTrack(track, `${job.title} ${job.company} ${job.roleArchetype} ${job.narrativeAngle} ${job.note}`, job.relatedTrackId),
  );
}

function existingDiscoveryTask(track: CareerTrack, tasks: Task[]) {
  return tasks.find((task) =>
    !task.done
    && task.sourceType === "career_track"
    && task.relatedTrackId === track.id
    && task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS,
  ) || null;
}

export function pathwayRoleDiscoveryTaskDraft(track: CareerTrack) {
  const target = targetFor(track);
  return {
    title: `Have Anchor discover real ${target} role targets`,
    list: "today",
    block: null,
    done: false,
    pinned: false,
    steps: JSON.stringify([
      { text: `Let Anchor search for current ${target} roles, teams, and hiring signals`, done: false },
      { text: "Review the ranked options and reject anything stale, generic, or irrelevant", done: false },
      { text: "Activate only the option you actually want to pursue; Anchor can then save it as a Job with source evidence", done: false },
    ]),
    sort: 0,
    category: "job",
    size: "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: "At least three current role targets or target organizations are ranked from public evidence; only user-approved options become Jobs.",
    sourceType: "career_track",
    sourceId: track.id,
    sourceStepType: "role_discovery",
    sourceStepId: 1,
    sourceUrl: "",
    sourceNote: JSON.stringify({
      reason: "A pathway should trigger Anchor-led role discovery before asking the user to manually save jobs.",
      trackId: track.id,
      trackName: track.name,
      targetRoleArchetype: track.targetRoleArchetype || "",
    }),
    sourceStatus: PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS,
    relatedTrackId: track.id,
    minimumOutcome: "Anchor has an evidence-backed shortlist of real role targets to review or reject.",
    estimateMinutes: 25,
    estimateConfidence: "medium",
    estimateReason: "pathway_role_discovery",
    readiness: "ready",
  };
}

export async function ensurePathwayRoleDiscoveryTasks(input: {
  tasks: Task[];
  jobs: Job[];
  tracks: CareerTrack[];
}): Promise<Task[]> {
  let tasks = input.tasks;
  for (const track of input.tracks.filter((item) => item.status === "active")) {
    const jobs = liveJobsForTrack(track, input.jobs);
    if (jobs.length >= 3) continue;
    if (existingDiscoveryTask(track, tasks)) continue;
    const created = await storage.createTask(pathwayRoleDiscoveryTaskDraft(track) as any);
    if (created) tasks = [...tasks, created];
  }
  return tasks;
}
