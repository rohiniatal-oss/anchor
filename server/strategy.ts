import { storage } from "./storage";
import {
  isJobLive, getJobReadiness, isLearnDone, isLearnActive, getLearnStatus,
  isContactWarm, isProofLive, isTaskDone, getTaskReadiness, getTrackId,
} from "@shared/domainState";
import type { Job, Learn, Contact, Hustle, Task, CareerTrack, JobPipelineStep } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY DIAGNOSTICS — per-track health, the five bottleneck types, and a
// deterministic recommended move. No LLM, no fabrication. An "unlinked" bucket
// (trackId null/0) collects orphaned source items so they stay fixable.
// ─────────────────────────────────────────────────────────────────────────

export type BottleneckType = "direction" | "readiness" | "proof" | "warmth" | "execution" | "none";

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
    proofGap: number;
    warmthGap: number;
    executionGap: number;
  };
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

function diagnoseTrack(
  track: CareerTrack,
  jobs: Job[], learn: Learn[], contacts: Contact[], hustles: Hustle[], tasks: Task[],
  stepsByJob: Map<number, JobPipelineStep[]>,
): TrackDiagnostic {
  const tJobs = jobs.filter((j) => getTrackId("jobs", j) === track.id);
  const tLiveJobs = tJobs.filter(isJobLive);
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

  // proof gap: few active proof assets; learn items missing requiredOutput
  const liveProof = tHustles.filter(isProofLive).length;
  const learnNoOutput = tLearn.filter((l) => !l.requiredOutput || !l.requiredOutput.trim()).length;
  const proofGap = (liveProof === 0 ? 1 : 0) + learnNoOutput;

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

  const signals = { directionGap, readinessGap, proofGap, warmthGap, executionGap };

  // ── Primary bottleneck (deterministic priority order) + recommended move ──
  let bottleneck: BottleneckType = "none";
  let bottleneckLabel = "Moving well — keep the drumbeat";
  let recommendedMove = "Advance the next live item on this track";

  const credibilityTrack = /credib|thought|advisor|proof|substack|writ|policy/i.test(`${track.slug} ${track.name} ${track.targetRoleArchetype}`);

  if (directionGap > 0) {
    bottleneck = "direction";
    bottleneckLabel = "No live opportunities yet";
    recommendedMove = "Add or activate a role, learning item, or proof asset on this track";
  } else if (proofGap > 0 && (credibilityTrack || liveProof === 0)) {
    bottleneck = "proof";
    bottleneckLabel = liveProof === 0 ? "No live proof asset" : "Learning without an output";
    recommendedMove = liveProof === 0
      ? "Create a proof-asset task to move it past the idea stage"
      : "Define the required output for your learning";
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
  }

  return {
    id: track.id, slug: track.slug, name: track.name, status: track.status,
    priority: track.priority, whyItFits: track.whyItFits,
    counts: { jobs: tJobs.length, learn: tLearn.length, contacts: tContacts.length, hustles: tHustles.length, tasks: tTasks.length },
    signals, bottleneck, bottleneckLabel, recommendedMove,
  };
}

export async function getTrackDiagnostics(): Promise<TrackDiagnostic[]> {
  const [tracks, jobs, learn, contacts, hustles, tasks] = await Promise.all([
    storage.getCareerTracks(), storage.getJobs(), storage.getLearn(),
    storage.getContacts(), storage.getHustles(), storage.getTasks(),
  ]);
  // Pull each live job's pipeline steps so the rail feeds the readiness gap.
  const liveJobs = jobs.filter(isJobLive);
  const stepLists = await Promise.all(liveJobs.map((j) => storage.getJobSteps(j.id)));
  const stepsByJob = new Map<number, JobPipelineStep[]>();
  liveJobs.forEach((j, i) => stepsByJob.set(j.id, stepLists[i]));
  return tracks.map((t) => diagnoseTrack(t, jobs, learn, contacts, hustles, tasks, stepsByJob));
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
