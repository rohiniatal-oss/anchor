import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";

export type MarketabilityMoveKind = "network" | "asset" | "upskill" | "proof" | "cleanup" | "development";
export type MarketabilityMode = "role_active" | "interview_active" | "signal_building" | "maintenance";

export type MarketabilityMove = {
  kind: MarketabilityMoveKind;
  title: string;
  lane: "Network" | "Applications" | "Learning" | "Development" | "Proof assets" | "Stability" | "Direction";
  priority: number;
  trackId?: number;
  trackName?: string;
  doneWhen: string;
  reason: string;
  outputType: "message" | "cv_bullet" | "story" | "positioning" | "note" | "proof_asset" | "cleanup" | "practice" | "skill_output";
};

export type MarketabilityPlan = {
  mode: MarketabilityMode;
  weeklyMix: { applications: number; networking: number; reusableAssets: number; learningDevelopment: number; proof: number; cleanup: number };
  moves: MarketabilityMove[];
  topMoves: MarketabilityMove[];
  rationale: string;
};

function t(...parts: unknown[]) { return parts.filter(Boolean).join(" ").toLowerCase(); }
function activeJobs(jobs: Job[]) { return jobs.filter((j) => !["closed", "rejected", "archived"].includes(j.status || "")); }
function activeTracks(tracks: CareerTrack[]) { return tracks.filter((x) => x.status === "active"); }
function trackName(track?: CareerTrack) { return track?.name || track?.targetRoleArchetype || "target track"; }
function belongsToTrackName(text: string, track: CareerTrack) {
  const hay = t(text);
  return [track.name, track.targetRoleArchetype, track.slug].filter(Boolean).some((x) => {
    const words = String(x).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    return words.some((w) => hay.includes(w));
  });
}
function hasOpenTask(tasks: Task[], re: RegExp, track?: CareerTrack) {
  return tasks.some((task) => !task.done && re.test(t(task.title, task.sourceNote, task.doneWhen)) && (!track || task.relatedTrackId === track.id || belongsToTrackName(t(task.title, task.sourceNote), track)));
}
function trackContacts(track: CareerTrack, contacts: Contact[]) {
  return contacts.filter((c) => c.relatedTrackId === track.id || belongsToTrackName(`${c.who} ${c.targetRole} ${c.sector} ${c.why}`, track));
}
function trackLearn(track: CareerTrack, learn: Learn[]) {
  return learn.filter((l) => l.relatedTrackId === track.id || belongsToTrackName(`${l.title} ${l.category} ${l.capabilityBuilt} ${l.requiredOutput}`, track));
}
function trackProof(track: CareerTrack, hustles: Hustle[]) {
  return hustles.filter((h) => h.proofAssetForTrack === track.id || belongsToTrackName(`${h.title} ${h.contentPillar} ${h.coreClaim} ${h.note}`, track));
}
function trackJobs(track: CareerTrack, jobs: Job[]) {
  return activeJobs(jobs).filter((j) => j.relatedTrackId === track.id || belongsToTrackName(`${j.title} ${j.company} ${j.roleArchetype} ${j.narrativeAngle} ${j.note}`, track));
}
function hasDevelopmentSignal(tasks: Task[], track: CareerTrack) {
  return hasOpenTask(tasks, /practice|drill|case|storyline|memo|write|presentation|interview answer|mock|skill|development/i, track);
}
function hasTooMuchLearning(learn: Learn[], tasks: Task[], track: CareerTrack) {
  const openLearn = trackLearn(track, learn).filter((l) => !l.done && l.learnStatus !== "closed").length;
  const openLearningTasks = tasks.filter((task) => !task.done && task.relatedTrackId === track.id && /learn|read|course|resource|prep|study/i.test(t(task.title, task.sourceNote))).length;
  return openLearn + openLearningTasks >= 3;
}

export function buildMarketabilityPlan(input: { tasks: Task[]; jobs: Job[]; learn: Learn[]; hustles: Hustle[]; contacts: Contact[]; tracks: CareerTrack[] }): MarketabilityPlan {
  const jobs = activeJobs(input.jobs);
  const interviews = jobs.filter((j) => j.status === "interviewing").length;
  const applicationReady = jobs.filter((j) => (j.fitScore ?? 0) >= 70 || j.applicationReadiness !== "none" || j.status === "wishlist").length;
  const tracks = activeTracks(input.tracks).slice(0, 4);
  const mode: MarketabilityMode = interviews > 0 ? "interview_active" : applicationReady > 0 ? "role_active" : tracks.length > 0 ? "signal_building" : "maintenance";

  const weeklyMix = mode === "interview_active" ? { applications: 55, networking: 10, reusableAssets: 20, learningDevelopment: 10, proof: 5, cleanup: 0 }
    : mode === "role_active" ? { applications: 60, networking: 15, reusableAssets: 15, learningDevelopment: 5, proof: 5, cleanup: 0 }
    : mode === "signal_building" ? { applications: 15, networking: 30, reusableAssets: 20, learningDevelopment: 20, proof: 10, cleanup: 5 }
    : { applications: 15, networking: 20, reusableAssets: 25, learningDevelopment: 20, proof: 10, cleanup: 10 };

  const moves: MarketabilityMove[] = [];
  for (const track of tracks) {
    const name = trackName(track);
    const contacts = trackContacts(track, input.contacts);
    const learn = trackLearn(track, input.learn);
    const proof = trackProof(track, input.hustles);
    const roleCount = trackJobs(track, input.jobs).length;
    const tooMuchLearning = hasTooMuchLearning(input.learn, input.tasks, track);

    if (!contacts.some((c) => ["messaged", "replied"].includes(c.status || "")) && !hasOpenTask(input.tasks, /insider|reality-check|reality check|message|contact|network/i, track)) {
      moves.push({
        kind: "network", lane: "Network", priority: mode === "signal_building" ? 92 : 72, trackId: track.id, trackName: name,
        title: `Find one ${name} insider and draft a reality-check ask`,
        doneWhen: "One person type or named person is saved with a clear ask",
        reason: "Networking should create real role evidence or access, not generic activity.",
        outputType: "message",
      });
    }

    if (!hasOpenTask(input.tasks, /cv bullet|story bank|positioning|why me|narrative|achievement/i, track)) {
      moves.push({
        kind: "asset", lane: "Applications", priority: mode === "role_active" ? 86 : 78, trackId: track.id, trackName: name,
        title: `Create one reusable ${name} positioning paragraph or CV bullet`,
        doneWhen: "One paragraph or bullet can be reused in CV, cover, outreach, or interview prep",
        reason: "Reusable assets improve multiple applications without becoming a large proof project.",
        outputType: "cv_bullet",
      });
    }

    // Learning is content acquisition. Development is skill practice. Both must
    // create output and must not crowd out live applications.
    if (tooMuchLearning) {
      moves.push({
        kind: "cleanup", lane: "Stability", priority: 84, trackId: track.id, trackName: name,
        title: `Reduce ${name} prep to one active item with one useful result`,
        doneWhen: "Only one prep item remains active for this track; others are parked",
        reason: "Too many learning items usually creates avoidance and weakens execution focus.",
        outputType: "cleanup",
      });
    } else if (learn.length > 0 && !learn.some((l) => l.outputEvidenceUrl || l.done) && !hasOpenTask(input.tasks, /convert .*resource|convert .*prep|useful note|learning item|prep item|produce/i, track)) {
      moves.push({
        kind: "upskill", lane: "Learning", priority: mode === "role_active" ? 38 : 56, trackId: track.id, trackName: name,
        title: `Turn one ${name} prep item into five usable application or interview bullets`,
        doneWhen: "Five reusable bullets exist; no more consumption is needed today",
        reason: "Learning should produce near-term application/interview leverage.",
        outputType: "note",
      });
    }

    if (!hasDevelopmentSignal(input.tasks, track)) {
      moves.push({
        kind: "development", lane: "Development", priority: mode === "interview_active" ? 82 : mode === "role_active" ? 52 : 68, trackId: track.id, trackName: name,
        title: `Do one ${name} practice drill that gives you a reusable example`,
        doneWhen: "One short practice attempt exists: answer, mini-case, memo outline, or story draft",
        reason: "Development should build skill through practice, not only reading.",
        outputType: "practice",
      });
    }

    if (proof.length === 0 && !hasOpenTask(input.tasks, /proof asset|proof idea|memo fragment|case example/i, track)) {
      moves.push({
        kind: "proof", lane: "Proof assets", priority: mode === "role_active" ? 36 : 54, trackId: track.id, trackName: name,
        title: `Define one lightweight writing or project idea for ${name}`,
        doneWhen: "A small writing or project idea exists that could later become a paragraph, memo, story, or writing sample",
        reason: "Writing or project ideas can build credibility over time, but they should not block applications.",
        outputType: "proof_asset",
      });
    }

    if (roleCount === 0 && !hasOpenTask(input.tasks, /inspect three|role examples|requirements/i, track)) {
      moves.push({
        kind: "asset", lane: "Direction", priority: 82, trackId: track.id, trackName: name,
        title: `Review three ${name} role examples and note the requirements that keep coming up`,
        doneWhen: "Three role examples are saved with the main requirements they share",
        reason: "Without role examples, general prep can drift away from the market.",
        outputType: "note",
      });
    }
  }

  const openStrategyTasks = input.tasks.filter((task) => !task.done && (task.sourceType === "strategy_builder" || task.sourceStatus?.startsWith("strategy_refresh"))).length;
  if (openStrategyTasks > 8) {
    moves.push({
      kind: "cleanup", lane: "Stability", priority: 88,
      title: "Reduce strategy tasks to the next three live moves",
      doneWhen: "Only the next three strategy moves remain live; the rest are parked or later",
      reason: "Too many strategic tasks creates noise and decision load.",
      outputType: "cleanup",
    });
  }

  const sorted = moves.sort((a, b) => b.priority - a.priority);
  const topMoves = sorted.slice(0, mode === "role_active" || mode === "interview_active" ? 2 : 3);
  return {
    mode,
    weeklyMix,
    moves: sorted,
    topMoves,
    rationale: mode === "role_active" ? "Live roles exist, so learning and development should support application quality without crowding it out."
      : mode === "interview_active" ? "Interviewing is active, so story bank, practice, and follow-up prep should dominate."
      : mode === "signal_building" ? "No dominant live role is active, so networking, reusable assets, learning outputs, and development drills should build baseline competitiveness."
      : "Maintain baseline competitiveness with lightweight assets, networking, development, and cleanup.",
  };
}
