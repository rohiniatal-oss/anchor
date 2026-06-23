import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";

export type TrackStage = "define" | "signal" | "network" | "convert" | "maintain";
export type TrackNeed = {
  lane: "Direction" | "Proof assets" | "Network" | "Learning" | "Applications" | "Stability";
  priority: number;
  stage: TrackStage;
  move: string;
  doneWhen: string;
  reason: string;
  kind?: "anchor" | "support" | "ongoing" | "cleanup";
};
export type TrackSequence = {
  anchor: TrackNeed;
  next: TrackNeed[];
  ongoing: TrackNeed[];
  cleanup: TrackNeed[];
};
export type TrackPlan = {
  track: CareerTrack;
  stage: TrackStage;
  health: "empty" | "thin" | "building" | "ready" | "overloaded";
  needs: TrackNeed[];
  primaryNeed: TrackNeed;
  sequence: TrackSequence;
  redundant: Array<{ entity: "task" | "job" | "learn" | "contact" | "hustle"; id: number; title: string; reason: string }>;
  summary: string;
};

function tx(...parts: unknown[]) { return parts.filter(Boolean).join(" ").toLowerCase(); }
function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function sameish(a: string, b: string) {
  const aa = norm(a), bb = norm(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  if (Math.min(aa.length, bb.length) >= 16 && (aa.includes(bb) || bb.includes(aa))) return true;
  const aw = new Set(aa.split(" ").filter((w) => w.length > 4));
  const bw = new Set(bb.split(" ").filter((w) => w.length > 4));
  const overlap = [...aw].filter((w) => bw.has(w)).length;
  return overlap >= 3;
}

function belongsToTrack(track: CareerTrack, text: string, relatedTrackId?: number | null) {
  if (relatedTrackId && relatedTrackId === track.id) return true;
  const hay = tx(text);
  const keys = [track.name, track.targetRoleArchetype, track.slug].filter(Boolean).map(norm).filter(Boolean);
  return keys.some((k) => k.split(" ").filter((w) => w.length > 3).some((w) => hay.includes(w)));
}

function trackJobs(track: CareerTrack, jobs: Job[]) {
  return jobs.filter((j) => belongsToTrack(track, `${j.title} ${j.company} ${j.roleArchetype} ${j.narrativeAngle} ${j.note}`, j.relatedTrackId));
}
function trackLearn(track: CareerTrack, learn: Learn[]) {
  return learn.filter((l) => belongsToTrack(track, `${l.title} ${l.category} ${l.capabilityBuilt} ${l.requiredOutput} ${l.note}`, l.relatedTrackId));
}
function trackContacts(track: CareerTrack, contacts: Contact[]) {
  return contacts.filter((c) => belongsToTrack(track, `${c.who} ${c.targetRole} ${c.targetOrg} ${c.sector} ${c.why}`, c.relatedTrackId));
}
function trackHustles(track: CareerTrack, hustles: Hustle[]) {
  return hustles.filter((h) => belongsToTrack(track, `${h.title} ${h.contentPillar} ${h.coreClaim} ${h.note}`, h.proofAssetForTrack));
}
function trackTasks(track: CareerTrack, tasks: Task[]) {
  return tasks.filter((t) => !t.done && belongsToTrack(track, `${t.title} ${t.category} ${t.sourceType} ${t.sourceNote} ${t.doneWhen}`, t.relatedTrackId));
}

function duplicateGroups<T extends { id: number }>(items: T[], titleOf: (x: T) => string) {
  const redundant: Array<{ id: number; title: string; reason: string }> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (sameish(titleOf(items[i]), titleOf(items[j]))) {
        redundant.push({ id: items[j].id, title: titleOf(items[j]), reason: `Looks duplicative of ${titleOf(items[i])}` });
      }
    }
  }
  return redundant;
}

function buildSequence(needs: TrackNeed[]): TrackSequence {
  const cleanup = needs.filter((n) => n.kind === "cleanup");
  const ongoing = needs.filter((n) => n.kind === "ongoing").sort((a, b) => b.priority - a.priority);
  const support = needs.filter((n) => n.kind === "support").sort((a, b) => b.priority - a.priority);
  const anchors = needs.filter((n) => n.kind === "anchor").sort((a, b) => b.priority - a.priority);
  const anchor = anchors[0] || support[0] || ongoing[0] || cleanup[0] || needs[0];
  const anchorKey = `${anchor.lane}:${anchor.move}`;
  const next = [...anchors.slice(1), ...support].filter((n) => `${n.lane}:${n.move}` !== anchorKey).slice(0, 2);
  return { anchor, next, ongoing, cleanup };
}

export function buildTrackPlan(track: CareerTrack, data: { tasks: Task[]; jobs: Job[]; learn: Learn[]; hustles: Hustle[]; contacts: Contact[] }): TrackPlan {
  const jobs = trackJobs(track, data.jobs).filter((j) => j.status !== "closed");
  const learn = trackLearn(track, data.learn).filter((l) => !l.done && l.learnStatus !== "closed");
  const contacts = trackContacts(track, data.contacts).filter((c) => c.status !== "closed");
  const hustles = trackHustles(track, data.hustles).filter((h) => h.stage !== "earning");
  const tasks = trackTasks(track, data.tasks);

  const highFitJobs = jobs.filter((j) => (j.fitScore ?? 0) >= 70 || j.applicationReadiness !== "none");
  const appliedJobs = jobs.filter((j) => j.status === "applied" || j.status === "interviewing");
  const activeSignals = tasks.filter((t) => /inspect|signal|role family|market|pattern|requirements/i.test(t.title));
  const proofInMotion = hustles.some((h) => h.stage === "testing" || h.coreClaim || h.firstPostIdea || h.nextStep) || learn.some((l) => l.outputEvidenceUrl || l.requiredOutput);
  const networkActive = contacts.some((c) => c.status === "messaged" || c.status === "replied" || c.messageDraft);

  let stage: TrackStage = "define";
  if (jobs.length >= 3 || activeSignals.length > 0) stage = "signal";
  if (networkActive) stage = "network";
  if (highFitJobs.length > 0 && jobs.length >= 1) stage = "convert";
  if (appliedJobs.length > 0) stage = "maintain";

  const needs: TrackNeed[] = [];
  if (jobs.length < 3) needs.push({ lane: "Direction", priority: 100, stage: "signal", kind: "anchor", move: `Save one real ${track.name} posting with JD text for Anchor to compare`, doneWhen: "One real posting is saved with enough JD text for Anchor to compare it to your profile", reason: "The track does not yet have enough real role evidence." });
  if (highFitJobs.length > 0) needs.push({ lane: "Applications", priority: 110, stage: "convert", kind: "anchor", move: `Convert one high-fit ${track.name} role into an application step`, doneWhen: "One tailored application step is done", reason: "Applications do not need to wait for optional projects or public work when role fit/readiness is clear." });
  if (!networkActive) needs.push({ lane: "Network", priority: highFitJobs.length > 0 ? 76 : 84, stage: "network", kind: "support", move: `Find one ${track.name} insider for a reality-check conversation`, doneWhen: "One person type or named person is saved with a clear ask", reason: "Network helps sharpen and access the track, but should not block selective applications." });
  if (!proofInMotion) needs.push({ lane: "Proof assets", priority: 55, stage: "convert", kind: "ongoing", move: `Only if useful, define one lightweight project, writing, or brand idea for ${track.name}`, doneWhen: "One optional idea, note, or bullet exists", reason: "Projects, writing, and brand-building are optional compounding assets, not prerequisites for applications." });
  if (learn.length > 0 && !learn.some((l) => l.outputEvidenceUrl || l.done)) needs.push({ lane: "Learning", priority: 48, stage: "convert", kind: "ongoing", move: `Turn one ${track.name} learning item into a useful note`, doneWhen: "One learning item has notes or a reusable note you can use again", reason: "Learning should compound into track leverage, but not crowd out applications." });
  if (tasks.length > 6) needs.push({ lane: "Stability", priority: 72, stage: "maintain", kind: "cleanup", move: `Reduce ${track.name} to the next three live moves`, doneWhen: "Only the next three track moves remain live", reason: "Too many open tasks can fragment the track." });

  if (needs.length === 0) needs.push({ lane: "Applications", priority: 50, stage: "maintain", kind: "anchor", move: `Maintain ${track.name} with one selective conversion or follow-up`, doneWhen: "One selective conversion/follow-up is complete", reason: "The track has basic coverage; maintain momentum." });
  needs.sort((a, b) => b.priority - a.priority);
  const sequence = buildSequence(needs);

  const redundant = [
    ...duplicateGroups(tasks, (t) => t.title).map((r) => ({ entity: "task" as const, ...r })),
    ...duplicateGroups(jobs, (j) => `${j.title} ${j.company}`).map((r) => ({ entity: "job" as const, ...r })),
    ...duplicateGroups(learn, (l) => l.title).map((r) => ({ entity: "learn" as const, ...r })),
    ...duplicateGroups(contacts, (c) => c.who || c.name).map((r) => ({ entity: "contact" as const, ...r })),
    ...duplicateGroups(hustles, (h) => h.title).map((r) => ({ entity: "hustle" as const, ...r })),
  ].slice(0, 10);

  const count = jobs.length + learn.length + contacts.length + hustles.length + tasks.length;
  const health: TrackPlan["health"] = count === 0 ? "empty" : redundant.length >= 4 || tasks.length > 8 ? "overloaded" : count < 4 ? "thin" : highFitJobs.length > 0 ? "ready" : "building";

  return {
    track,
    stage,
    health,
    needs,
    primaryNeed: sequence.anchor,
    sequence,
    redundant,
    summary: `${track.name} is at ${stage}; anchor move is ${sequence.anchor.lane}: ${sequence.anchor.move}.`,
  };
}

export function buildAllTrackPlans(tracks: CareerTrack[], data: { tasks: Task[]; jobs: Job[]; learn: Learn[]; hustles: Hustle[]; contacts: Contact[] }) {
  return tracks.filter((t) => t.status === "active").map((track) => buildTrackPlan(track, data)).sort((a, b) => b.primaryNeed.priority - a.primaryNeed.priority);
}
