import { storage } from "./storage";
import {
  isJobLive, isOpportunityActionable, getJobReadiness, isLearnDone, isLearnActive, getLearnStatus,
  isContactWarm, isProofLive, isTaskDone, getTaskReadiness, getTrackId,
  getLearnOutputState, type WinCategory,
} from "@shared/domainState";
import { learningGapRecommendedMove } from "@shared/learningGapSuggestions";
import type { Job, Learn, Contact, Hustle, Task, CareerTrack, JobPipelineStep, ProofAssetStep } from "@shared/schema";
import { computeEvidence, type TrackEvidence, type EvidenceResult } from "./evidence";
import { computeLearningGaps, topLearningGapSignal, type TrackLearningGap, type LearningGapSignal } from "./learningStrategy";
import { buildUserContext, contextFingerprint } from "./userContext";
import { getPersistedOwnership, getOwnershipFeedback, type StrategicObjectType, type OwnershipFeedback } from "./objectOwnership";

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
    proofGap: number;
    warmthGap: number;
    executionGap: number;
    learningGap: number;
    learnProofGap: number;
    evidenceGap: number;
  };
  evidence: {
    count: number;
    topCategory: WinCategory | null;
    producingVsPlanning: TrackEvidence["producingVsPlanning"];
    executionRatio: number | null;
    lastEvidenceAt: number | null;
  };
  learningGap: {
    requiredCount: number;
    evidencedCount: number;
    gapCount: number;
    topGapDomain: string | null;
    topGapLabel: string | null;
    topGapHasResource: boolean;
    recommendedMove: string | null;
  } | null;
  bottleneck: BottleneckType;
  bottleneckLabel: string;
  recommendedMove: string;
};

const LOW_WARMTH = 40;

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
  const tLiveJobs = tJobs.filter(isOpportunityActionable);
  const tLearn = learn.filter((l) => getTrackId("learn", l) === track.id && !isLearnDone(l) && getLearnStatus(l) !== "closed");
  const tContacts = contacts.filter((c) => getTrackId("contacts", c) === track.id);
  const tHustles = hustles.filter((h) => getTrackId("hustles", h) === track.id);
  const tTasks = tasks.filter((t) => t.relatedTrackId === track.id);

  const liveObjects = tLiveJobs.length + tLearn.filter(isLearnActive).length + tHustles.filter(isProofLive).length;
  const directionGap = liveObjects === 0 ? 1 : 0;
  const lowReadinessJobs = tLiveJobs.filter((j) => getJobReadiness(j) === "none" || getJobReadiness(j) === "cv").length;
  const stuckTasks = tTasks.filter((t) => !isTaskDone(t) && (getTaskReadiness(t) === "needs_info" || getTaskReadiness(t) === "blocked")).length;
  const stallSteps = tLiveJobs.reduce((acc, j) => {
    const steps = stepsByJob.get(j.id) || [];
    if (steps.length === 0) return acc;
    const done = steps.filter((s) => s.status === "done").length;
    const blocked = steps.filter((s) => s.status === "blocked").length;
    const fewDone = done < Math.ceil(steps.length / 2) ? 1 : 0;
    return acc + fewDone + blocked;
  }, 0);
  const readinessGap = lowReadinessJobs + stuckTasks + stallSteps;

  const liveProof = tHustles.filter(isProofLive).length;
  const proofStall = tHustles.reduce((acc, h) => {
    const steps = proofStepsByHustle.get(h.id) || [];
    if (steps.length === 0) return acc;
    const done = steps.filter((s) => s.status === "done").length;
    const blocked = steps.filter((s) => s.status === "blocked").length;
    const fewDone = done < Math.ceil(steps.length / 2) ? 1 : 0;
    return acc + fewDone + blocked;
  }, 0);
  const learnNoOutput = tLearn.filter((l) => getLearnOutputState(l) === "producing").length;
  const proofGap = proofStall;

  const lowWarmJobs = tLiveJobs.filter((j) => (j.warmPathScore ?? 0) < LOW_WARMTH).length;
  const noWarmContacts = tContacts.filter(isContactWarm).length === 0 ? 1 : 0;
  const overdueContacts = tContacts.filter(isContactOverdue).length;
  const warmthGap = (tLiveJobs.length > 0 ? lowWarmJobs : 0) + (tContacts.length === 0 ? 1 : noWarmContacts) + overdueContacts;

  const readyTasks = tTasks.filter((t) => !isTaskDone(t) && getTaskReadiness(t) === "ready").length;
  const doneTasks = tTasks.filter(isTaskDone).length;
  const executionGap = readyTasks >= 3 && doneTasks === 0 ? readyTasks : 0;
  const learnProofGap = learnNoOutput;
  const hasLiveWork = tLearn.some(isLearnActive) || tHustles.some(isProofLive) || tTasks.some((t) => !isTaskDone(t));
  const evidenceGap = (hasLiveWork && ev.evidenceCount === 0) ? 1 : 0;
  const learningGap = lg ? lg.gapDomains.length : 0;
  const signals = { directionGap, readinessGap, proofGap, warmthGap, executionGap, learningGap, learnProofGap, evidenceGap };

  let bottleneck: BottleneckType = "none";
  let bottleneckLabel = "Moving well - keep going";
  let recommendedMove = "Advance the next live item on this track";

  if (directionGap > 0) {
    bottleneck = "direction";
    bottleneckLabel = "No live roles yet";
    recommendedMove = "Save one real role, or compare a few real role examples, so this track has something concrete to aim at";
  } else if (warmthGap > 0 && tLiveJobs.length > 0) {
    const overdue = tContacts.filter(isContactOverdue).length;
    bottleneck = "warmth";
    bottleneckLabel = tContacts.length === 0
      ? "Live roles, but no one to reach out to yet"
      : overdue > 0 ? `${overdue} contact${overdue > 1 ? "s" : ""} need${overdue === 1 ? "s" : ""} a follow-up` : "Contacts exist, but none are likely to help yet";
    recommendedMove = overdue > 0
      ? "Follow up with the contacts that need a nudge"
      : "Reach out to the person most likely to help with these roles";
  } else if (readinessGap > 0) {
    bottleneck = "readiness";
    bottleneckLabel = stuckTasks > 0 ? "Something is stuck or needs more info" : "Applications aren't ready yet";
    recommendedMove = stuckTasks > 0
      ? "Create a task to unblock what's stuck"
      : "Create a task to tailor materials for your strongest role";
  } else if (executionGap > 0) {
    bottleneck = "execution";
    bottleneckLabel = `${executionGap} task${executionGap > 1 ? "s" : ""} ready to go — none started yet`;
    recommendedMove = "Pick the top ready task and get one done today";
  } else if (learningGap > 0 && lg) {
    const topGap = lg.rankedGaps[0];
    const step = lg.sequence.find((s) => s.gapDomain === topGap.domain && s.learnId !== null);
    bottleneck = "learning";
    bottleneckLabel = learningGap === 1
      ? `Start learning about ${topGap.label} to strengthen this path`
      : `${learningGap} learning areas need coverage`;
    recommendedMove = step
      ? `Build ${topGap.label}: do the next step on "${step.title}"`
      : learningGapRecommendedMove(topGap.domain, topGap.label);
  } else if (proofGap > 0 && liveProof > 0) {
    bottleneck = "proof";
    bottleneckLabel = "A project you started has stalled";
    recommendedMove = "Move the active project one concrete step forward";
  } else if (learnProofGap > 0) {
    bottleneck = "proof";
    bottleneckLabel = learnProofGap === 1
      ? "A study item could produce something concrete — it hasn't yet"
      : `${learnProofGap} study items could each produce something concrete — none have yet`;
    recommendedMove = "If it would help, turn one study item into a note or brief you could reuse later";
  } else if (evidenceGap > 0) {
    bottleneck = "execution";
    bottleneckLabel = "In motion, but no wins logged recently";
    recommendedMove = liveProof > 0
      ? "Ship something small and log it as a win for this track"
      : "Log a recent win so this track shows it's moving";
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
      : learningGapRecommendedMove(topGap.domain, topGap.label);
  }
  return {
    requiredCount: lg.requiredDomains.length,
    evidencedCount: lg.evidencedDomains.length,
    gapCount: lg.gapDomains.length,
    topGapDomain: topGap ? topGap.domain : null,
    topGapLabel: topGap ? topGap.label : null,
    topGapHasResource,
    recommendedMove,
  };
}

export async function getTrackDiagnostics(): Promise<TrackDiagnostic[]> {
  const [tracks, jobs, learn, contacts, hustles, tasks, evidence] = await Promise.all([
    storage.getCareerTracks(), storage.getJobs(), storage.getLearn(),
    storage.getContacts(), storage.getHustles(), storage.getTasks(),
    computeEvidence(),
  ]);
  const liveJobs = jobs.filter(isJobLive);
  const stepLists = await Promise.all(liveJobs.map((j) => storage.getJobSteps(j.id)));
  const stepsByJob = new Map<number, JobPipelineStep[]>();
  liveJobs.forEach((j, i) => stepsByJob.set(j.id, stepLists[i]));
  const proofStepLists = await Promise.all(hustles.map((h) => storage.getProofAssetSteps(h.id)));
  const proofStepsByHustle = new Map<number, ProofAssetStep[]>();
  hustles.forEach((h, i) => proofStepsByHustle.set(h.id, proofStepLists[i]));
  const emptyEv = (id: number): TrackEvidence => ({
    trackId: id, evidenceCount: 0, evidenceCountAllTime: 0,
    evidenceByCategory: { job_progress: 0, learning: 0, network: 0, proof_asset: 0, mindset: 0, admin: 0 },
    topCategory: null, lastEvidenceAt: null, executionRatio: null, executionEvents: 0,
    openTasks: 0, producingVsPlanning: "idle",
  });
  const learningGaps = await computeLearningGaps();
  const lgByTrack = new Map<number, TrackLearningGap>();
  for (const g of learningGaps.tracks) lgByTrack.set(g.trackId, g);
  const diagnostics = tracks.map((t) =>
    diagnoseTrack(t, jobs, learn, contacts, hustles, tasks, stepsByJob, proofStepsByHustle,
      evidence.byTrack.get(t.id) ?? emptyEv(t.id), lgByTrack.get(t.id)));

  const severity: Record<BottleneckType, number> = {
    direction: 6, warmth: 5, readiness: 4, execution: 3, learning: 2, proof: 1, none: 0,
  };
  return diagnostics.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (severity[b.bottleneck] !== severity[a.bottleneck]) return severity[b.bottleneck] - severity[a.bottleneck];
    return (a.evidence.count) - (b.evidence.count);
  });
}

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

export type StrategyInsight = { kind: string; text: string };
export type StrategyFrontDoor = {
  tracks: TrackDiagnostic[];
  topThree: TrackDiagnostic[];
  insights: StrategyInsight[];
  unlinked: { items: UnlinkedItem[]; counts: Record<string, number> };
  evidence: EvidencePayload;
  learningGap: LearningGapSignal | null;
  staleRecommendations?: number;
  contextHash?: string;
};

export function deriveInsights(tracks: TrackDiagnostic[], activitySignal?: string, rejectedJobs?: Job[]): StrategyInsight[] {
  const out: StrategyInsight[] = [];
  const active = tracks.filter((t) => t.status === "active");

  const readinessTrack = active.find((t) => t.bottleneck === "readiness");
  if (readinessTrack)
    out.push({ kind: "readiness", text: `For ${readinessTrack.name}, the issue is not more saved roles. It is getting one ready. ${readinessTrack.recommendedMove}.` });

  const warmthTrack = active.find((t) => t.bottleneck === "warmth");
  if (warmthTrack) {
    const hasContacts = warmthTrack.counts.contacts > 0;
    out.push({
      kind: "warmth",
      text: hasContacts
        ? `${warmthTrack.name} already has people linked to it, so the next gain is better follow-through or a clearer ask. ${warmthTrack.recommendedMove}.`
        : `${warmthTrack.name} has live roles, but no useful person to reach out to yet. A referral or warm intro would help more than saving another role.`,
    });
  }

  const proofTrack = active.find((t) => t.bottleneck === "proof");
  if (proofTrack)
    out.push({ kind: "proof", text: `${proofTrack.name}: ${proofTrack.bottleneckLabel.toLowerCase()}. Only do this if it would genuinely help you learn, explain your fit, or build your brand.` });

  const learningTrack = active.find((t) => t.bottleneck === "learning" && t.learningGap);
  if (learningTrack && learningTrack.learningGap?.recommendedMove)
    out.push({ kind: "learning", text: `${learningTrack.name}: ${learningTrack.learningGap.recommendedMove}.` });

  if (activitySignal) {
    const match = activitySignal.match(/(\d+) producing.*?(\d+) planning.*?(\d+) idle/);
    if (match) {
      const [, producing, planning, idle] = match.map(Number);
      if (producing === 0 && planning > 0)
        out.push({ kind: "momentum", text: `All ${planning} active track${planning > 1 ? "s are" : " is"} in planning mode — none producing. The one with the most saved roles is closest to action — ship something small there to build momentum.` });
      if (idle > 1)
        out.push({ kind: "focus", text: `${idle} tracks are idle. Consider pausing or archiving them to focus energy on what's moving.` });
    }
  }

  if (rejectedJobs && rejectedJobs.length >= 2) {
    const reasons = rejectedJobs
      .map((j) => (j.rejectReason || "").trim().toLowerCase())
      .filter(Boolean);
    if (reasons.length >= 2) {
      const freq = new Map<string, number>();
      for (const r of reasons) {
        for (const [pattern, label] of REJECTION_PATTERNS) {
          if (pattern.test(r)) freq.set(label, (freq.get(label) || 0) + 1);
        }
      }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).find(([, count]) => count >= 2);
      if (top) {
        out.push({ kind: "learning", text: `${top[1]} rejected roles cite "${top[0]}" as a factor. This may be a capability gap worth addressing directly — through learning, proof assets, or reframing.` });
      }
    }
  }

  if (out.length === 0 && active.length)
    out.push({ kind: "focus", text: `Most of the focus is on ${active[0].name}. Keep that moving and let the rest stay light.` });

  return out.slice(0, 3);
}

const REJECTION_PATTERNS: [RegExp, string][] = [
  [/experience|years|seniority|senior|junior/, "experience level"],
  [/visa|sponsor|right to work|work permit/, "visa/sponsorship"],
  [/technical|coding|programming|engineer/, "technical skills"],
  [/salary|compensation|pay/, "compensation"],
  [/location|remote|relocation|relocate/, "location"],
  [/sector|industry|domain/, "sector experience"],
  [/overqualified|too senior/, "overqualification"],
  [/culture|fit|values/, "culture fit"],
];

export async function getStrategyFrontDoor(): Promise<StrategyFrontDoor> {
  const [tracks, unlinked, evidence, learningGaps, userCtx, jobs, recs] = await Promise.all([
    getTrackDiagnostics(), getUnlinkedItems(), getEvidencePayload(), computeLearningGaps(), buildUserContext(), storage.getJobs(), storage.getRecommendations(),
  ]);
  const rejected = jobs.filter((j) => j.status === "rejected" && j.rejectReason);
  const currentHash = contextFingerprint(userCtx);
  const staleCount = recs.filter((r) => r.status === "accepted" && r.contextHash && r.contextHash !== currentHash).length;
  return {
    tracks,
    topThree: tracks.slice(0, 3),
    insights: deriveInsights(tracks, userCtx.activitySignal, rejected),
    unlinked,
    evidence,
    learningGap: topLearningGapSignal(learningGaps.tracks),
    staleRecommendations: staleCount,
    contextHash: currentHash,
  };
}

export type OwnershipPriority = "now" | "later" | "parked" | "stop";

export type OwnershipSuggestion = {
  action: "assign_to_track" | "park" | "stop";
  trackId: number | null;
  trackName: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  priority: OwnershipPriority;
  priorityReason: string;
  nextAction: string;
};

export type UnlinkedItem = {
  entity: "jobs" | "learn" | "contacts" | "hustles";
  id: number;
  title: string;
  status: string;
  suggestion: OwnershipSuggestion;
};

type OwnershipEvidence = {
  titleText: string;
  objectText: string;
  sourceText: string;
  allText: string;
};

type OwnershipMatch = {
  score: number;
  objectScore: number;
  sourceScore: number;
};

type TrackOwnershipContext = {
  status: string;
  priority: number;
  liveJobs: number;
  activeLearn: number;
  activeContacts: number;
  liveProof: number;
  liveObjects: number;
};

type OwnershipFeedbackAdjustment = {
  delta: number;
  positive: number;
  negative: number;
};

type OwnershipFeedbackModel = Map<string, OwnershipFeedbackAdjustment>;

const UNLINKED_OBJECT_TYPE: Record<UnlinkedItem["entity"], StrategicObjectType> = {
  jobs: "job",
  learn: "learn",
  contacts: "contact",
  hustles: "hustle",
};

const RESOLVED_MANUAL_STATES = new Set(["unclassified_capture", "parked", "stopped"]);
const TOKEN_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "about", "role", "roles", "lead", "manager", "senior", "associate",
  "director", "head", "jobs", "job", "contact", "learning", "resource", "project", "proof", "asset", "example", "open", "ai",
  "http", "https", "www", "com", "org", "edu", "net", "careers", "apply", "application", "profile", "source", "title",
]);

function compactText(...values: unknown[]) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(value: unknown) {
  return new Set(normalized(value).split(" ").filter((token) => token.length > 2 && !TOKEN_STOPWORDS.has(token)));
}

function flattenJsonValue(value: unknown, depth = 0): string {
  if (value == null || depth > 5) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return compactText(...value.map((item) => flattenJsonValue(item, depth + 1)));
  if (typeof value === "object") return compactText(...Object.values(value as Record<string, unknown>).map((item) => flattenJsonValue(item, depth + 1)));
  return "";
}

function jsonEvidence(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return flattenJsonValue(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function urlEvidence(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return compactText(
      parsed.hostname.replace(/^www\./, "").replace(/\./g, " "),
      parsed.pathname.replace(/[\/_-]+/g, " "),
    );
  } catch {
    return raw.replace(/https?:\/\//g, " ").replace(/[\/_:.-]+/g, " ");
  }
}

function makeOwnershipEvidence(input: { titleText: string; objectText?: string; sourceText?: string }): OwnershipEvidence {
  return {
    titleText: compactText(input.titleText),
    objectText: compactText(input.objectText),
    sourceText: compactText(input.sourceText),
    allText: compactText(input.titleText, input.objectText, input.sourceText),
  };
}

function trackEvidenceText(track: CareerTrack) {
  return compactText(track.name, track.slug, track.description, track.targetRoleArchetype, track.whyItFits, jsonEvidence(track.trackIntelligence));
}

function jobOwnershipEvidence(job: Job): OwnershipEvidence {
  return makeOwnershipEvidence({
    titleText: compactText(job.title, job.company),
    objectText: compactText(job.location, job.roleArchetype, job.note, job.nextStep, job.flag, job.narrativeAngle),
    sourceText: compactText(job.sourceType, job.sourceUrl, urlEvidence(job.sourceUrl), job.jdText, jsonEvidence(job.companyBrief), jsonEvidence(job.roleModel)),
  });
}

function learnOwnershipEvidence(item: Learn): OwnershipEvidence {
  return makeOwnershipEvidence({
    titleText: item.title,
    objectText: compactText(item.category, item.type, item.capabilityBuilt, item.requiredOutput, item.outputTitle),
    sourceText: compactText(item.sourceType, item.url, urlEvidence(item.url), item.note, item.outputEvidenceUrl, urlEvidence(item.outputEvidenceUrl)),
  });
}

function contactOwnershipEvidence(contact: Contact): OwnershipEvidence {
  return makeOwnershipEvidence({
    titleText: compactText(contact.who, contact.name),
    objectText: compactText(contact.sector, contact.why, contact.targetOrg, contact.targetRole, contact.askType, contact.referralPotential),
    sourceText: compactText(contact.sourceNetwork, contact.linkedinUrl, urlEvidence(contact.linkedinUrl), contact.note, contact.messageDraft, contact.lastMessage),
  });
}

function hustleOwnershipEvidence(hustle: Hustle): OwnershipEvidence {
  return makeOwnershipEvidence({
    titleText: hustle.title,
    objectText: compactText(hustle.audience, hustle.coreClaim, hustle.contentPillar, hustle.firstPostIdea),
    sourceText: compactText(hustle.note, hustle.nextStep),
  });
}

function trackMatchScore(track: CareerTrack, evidence: OwnershipEvidence): OwnershipMatch {
  const trackName = normalized(track.name);
  const source = normalized(evidence.sourceText);
  const object = normalized(compactText(evidence.titleText, evidence.objectText));
  const all = normalized(evidence.allText);
  let score = 0;
  let objectScore = 0;
  let sourceScore = 0;

  if (trackName && all.includes(trackName)) {
    score += 4;
    if (source.includes(trackName)) sourceScore += 4;
    else objectScore += 4;
  }

  const sourceTokens = tokenSet(evidence.sourceText);
  const objectTokens = tokenSet(compactText(evidence.titleText, evidence.objectText));
  const trackTokens = tokenSet(trackEvidenceText(track));
  for (const token of trackTokens) {
    if (objectTokens.has(token)) {
      score += 1;
      objectScore += 1;
    }
    if (sourceTokens.has(token)) {
      score += 1;
      sourceScore += 1;
    }
  }

  return { score, objectScore, sourceScore };
}

function feedbackKey(objectType: StrategicObjectType, trackId: number) {
  return `${objectType}:${trackId}`;
}

function addFeedbackAdjustment(model: OwnershipFeedbackModel, objectType: StrategicObjectType, trackId: number | null, amount: number) {
  if (!trackId) return;
  const key = feedbackKey(objectType, trackId);
  const current = model.get(key) || { delta: 0, positive: 0, negative: 0 };
  current.delta += amount;
  if (amount > 0) current.positive += amount;
  if (amount < 0) current.negative += Math.abs(amount);
  model.set(key, current);
}

function buildOwnershipFeedbackModel(feedback: OwnershipFeedback[]): OwnershipFeedbackModel {
  const model: OwnershipFeedbackModel = new Map();
  for (const row of feedback) {
    if (row.recommendedAction === "assign_to_track" && row.recommendedTrackId) {
      if (row.chosenAction === "assign_to_track" && row.chosenTrackId && row.chosenTrackId !== row.recommendedTrackId) {
        addFeedbackAdjustment(model, row.objectType, row.recommendedTrackId, -2);
        addFeedbackAdjustment(model, row.objectType, row.chosenTrackId, 2);
      } else if (row.chosenAction === "park" || row.chosenAction === "stop") {
        addFeedbackAdjustment(model, row.objectType, row.recommendedTrackId, -2);
      }
    } else if (row.recommendedAction === "park" && row.chosenAction === "assign_to_track" && row.chosenTrackId) {
      addFeedbackAdjustment(model, row.objectType, row.chosenTrackId, 2);
    }
  }
  return model;
}

function feedbackAdjustmentForTrack(entity: UnlinkedItem["entity"], track: CareerTrack, feedbackModel: OwnershipFeedbackModel): { delta: number; note: string } {
  const adjustment = feedbackModel.get(feedbackKey(UNLINKED_OBJECT_TYPE[entity], track.id));
  if (!adjustment) return { delta: 0, note: "" };
  const delta = Math.max(-2, Math.min(2, adjustment.delta));
  if (delta > 0) return { delta, note: `previous cleanup corrections moved similar ${entity} toward ${track.name}` };
  if (delta < 0) return { delta, note: `previous cleanup corrections moved similar ${entity} away from ${track.name}` };
  return { delta: 0, note: "" };
}

function buildTrackOwnershipContexts(
  tracks: CareerTrack[],
  jobs: Job[],
  learn: Learn[],
  contacts: Contact[],
  hustles: Hustle[],
) {
  const contexts = new Map<number, TrackOwnershipContext>();
  for (const track of tracks) {
    const liveJobs = jobs.filter((job) => getTrackId("jobs", job) === track.id && isOpportunityActionable(job)).length;
    const activeLearn = learn.filter((item) => getTrackId("learn", item) === track.id && !isLearnDone(item) && getLearnStatus(item) !== "closed" && isLearnActive(item)).length;
    const activeContacts = contacts.filter((contact) => {
      const status = normalized(contact.status);
      return getTrackId("contacts", contact) === track.id && ["to contact", "messaged", "replied"].includes(status);
    }).length;
    const liveProof = hustles.filter((hustle) => getTrackId("hustles", hustle) === track.id && isProofLive(hustle)).length;
    contexts.set(track.id, {
      status: track.status,
      priority: track.priority,
      liveJobs,
      activeLearn,
      activeContacts,
      liveProof,
      liveObjects: liveJobs + activeLearn + activeContacts + liveProof,
    });
  }
  return contexts;
}

function priorityForAssignment(entity: UnlinkedItem["entity"], track: CareerTrack, context: TrackOwnershipContext | undefined): Pick<OwnershipSuggestion, "priority" | "priorityReason" | "nextAction"> {
  const ctx = context || { status: track.status, priority: track.priority, liveJobs: 0, activeLearn: 0, activeContacts: 0, liveProof: 0, liveObjects: 0 };
  if (normalized(ctx.status) !== "active") {
    return {
      priority: "later",
      priorityReason: `${track.name} is not active right now, so this should be saved without entering execution.`,
      nextAction: "Assign it to preserve the evidence; do not create a Today task yet.",
    };
  }

  if (entity === "jobs" && ctx.liveJobs === 0) {
    return {
      priority: "now",
      priorityReason: `${track.name} has no live role signal yet, so this could make the direction concrete.`,
      nextAction: "Verify the source and decide whether this should become the first live role signal for the track.",
    };
  }

  if (entity === "contacts" && ctx.liveJobs > 0 && ctx.activeContacts === 0) {
    return {
      priority: "now",
      priorityReason: `${track.name} has live roles but no active contact path yet.`,
      nextAction: "Assign the contact, then decide the smallest useful outreach or advice ask.",
    };
  }

  if (ctx.liveObjects === 0 && ctx.priority >= 10) {
    return {
      priority: "now",
      priorityReason: `${track.name} is an active priority but has no live strategic objects yet.`,
      nextAction: "Assign it, then choose one verification step before adding any execution work.",
    };
  }

  return {
    priority: "later",
    priorityReason: `${track.name} already has live work, so this should not interrupt the current execution queue.`,
    nextAction: "Assign it to the track and keep it as saved context; only turn it into work when capacity opens.",
  };
}

function assignmentReason(params: { basis: string; trackName: string; direct: boolean; feedbackNote: string }) {
  const verb = params.direct && !params.feedbackNote ? "directly matches" : "overlaps most with";
  const learned = params.feedbackNote ? ` Prior cleanup feedback also points here: ${params.feedbackNote}.` : "";
  return `The ${params.basis} ${verb} ${params.trackName}.${learned}`;
}

function parkedSuggestion(reason: string, nextAction = "Leave it parked; revisit only when a matching active direction exists."): OwnershipSuggestion {
  return {
    action: "park",
    trackId: null,
    trackName: null,
    confidence: "low",
    reason,
    priority: "parked",
    priorityReason: "This does not deserve active attention until its direction is clearer.",
    nextAction,
  };
}

function suggestOwnership(
  entity: UnlinkedItem["entity"],
  status: string,
  evidence: OwnershipEvidence,
  tracks: CareerTrack[],
  trackContexts: Map<number, TrackOwnershipContext>,
  feedbackModel: OwnershipFeedbackModel,
): OwnershipSuggestion {
  const canonicalStatus = normalized(status);
  if (entity === "contacts" && canonicalStatus && !["to contact", "messaged", "replied"].includes(canonicalStatus)) {
    return {
      action: "stop",
      trackId: null,
      trackName: null,
      confidence: "high",
      reason: "This contact is already outside the active contact statuses, so Anchor should stop treating it as unresolved strategic work.",
      priority: "stop",
      priorityReason: "It is already inactive, so keeping it in Strategy would create false work.",
      nextAction: "Stop tracking it as active strategic work; no follow-up task should be created.",
    };
  }

  if (tracks.length === 0) {
    return parkedSuggestion(
      "There are no role types to assign this to yet, so keep it out of active execution until a direction exists.",
      "Create or choose a direction first; then reconsider this item.",
    );
  }

  const ranked = tracks
    .map((track) => {
      const baseMatch = trackMatchScore(track, evidence);
      const feedback = baseMatch.score > 0 ? feedbackAdjustmentForTrack(entity, track, feedbackModel) : { delta: 0, note: "" };
      return {
        track,
        baseScore: baseMatch.score,
        feedbackNote: feedback.delta > 0 ? feedback.note : "",
        match: { ...baseMatch, score: Math.max(0, baseMatch.score + feedback.delta) },
      };
    })
    .sort((a, b) => b.match.score - a.match.score);
  const best = ranked[0];
  const second = ranked[1];
  const secondScore = second?.match.score || 0;
  const basis = best && best.match.sourceScore >= Math.max(2, best.match.objectScore) ? "saved source evidence" : "item context";

  if (best && best.baseScore >= 2 && best.match.score >= 4 && best.match.score > secondScore) {
    return {
      action: "assign_to_track",
      trackId: best.track.id,
      trackName: best.track.name,
      confidence: "high",
      reason: assignmentReason({ basis, trackName: best.track.name, direct: best.baseScore >= 4, feedbackNote: best.feedbackNote }),
      ...priorityForAssignment(entity, best.track, trackContexts.get(best.track.id)),
    };
  }
  if (best && best.baseScore >= 1 && best.match.score >= 2 && best.match.score > secondScore) {
    return {
      action: "assign_to_track",
      trackId: best.track.id,
      trackName: best.track.name,
      confidence: "medium",
      reason: assignmentReason({ basis, trackName: best.track.name, direct: false, feedbackNote: best.feedbackNote }),
      ...priorityForAssignment(entity, best.track, trackContexts.get(best.track.id)),
    };
  }

  return parkedSuggestion("No role type clearly matches this item yet, so parking is safer than forcing it into the wrong direction.");
}

function shouldHideManuallyResolved(entity: UnlinkedItem["entity"], id: number, persistedOwnership: ReturnType<typeof getPersistedOwnership>) {
  const record = persistedOwnership.get(`${UNLINKED_OBJECT_TYPE[entity]}:${id}`);
  return record?.source === "manual" && RESOLVED_MANUAL_STATES.has(record.ownershipState);
}

function withSuggestion(
  item: Omit<UnlinkedItem, "suggestion">,
  evidence: OwnershipEvidence,
  tracks: CareerTrack[],
  trackContexts: Map<number, TrackOwnershipContext>,
  feedbackModel: OwnershipFeedbackModel,
): UnlinkedItem {
  return {
    ...item,
    suggestion: suggestOwnership(item.entity, item.status, evidence, tracks, trackContexts, feedbackModel),
  };
}

export async function getUnlinkedItems(): Promise<{ items: UnlinkedItem[]; counts: Record<string, number> }> {
  const [jobs, learn, contacts, hustles, tracks] = await Promise.all([
    storage.getJobs(), storage.getLearn(), storage.getContacts(), storage.getHustles(), storage.getCareerTracks(),
  ]);
  const persistedOwnership = getPersistedOwnership();
  const feedbackModel = buildOwnershipFeedbackModel(getOwnershipFeedback());
  const trackContexts = buildTrackOwnershipContexts(tracks, jobs, learn, contacts, hustles);
  const items: UnlinkedItem[] = [];

  for (const j of jobs) {
    if (isJobLive(j) && !getTrackId("jobs", j) && !shouldHideManuallyResolved("jobs", j.id, persistedOwnership)) {
      items.push(withSuggestion(
        { entity: "jobs", id: j.id, title: j.title, status: j.status },
        jobOwnershipEvidence(j),
        tracks,
        trackContexts,
        feedbackModel,
      ));
    }
  }
  for (const l of learn) {
    if (!isLearnDone(l) && getLearnStatus(l) !== "closed" && !getTrackId("learn", l) && !shouldHideManuallyResolved("learn", l.id, persistedOwnership)) {
      items.push(withSuggestion(
        { entity: "learn", id: l.id, title: l.title, status: l.learnStatus },
        learnOwnershipEvidence(l),
        tracks,
        trackContexts,
        feedbackModel,
      ));
    }
  }
  for (const c of contacts) {
    if (!getTrackId("contacts", c) && !shouldHideManuallyResolved("contacts", c.id, persistedOwnership)) {
      items.push(withSuggestion(
        { entity: "contacts", id: c.id, title: c.who || c.name || "contact", status: c.status },
        contactOwnershipEvidence(c),
        tracks,
        trackContexts,
        feedbackModel,
      ));
    }
  }
  for (const h of hustles) {
    if (!getTrackId("hustles", h) && !shouldHideManuallyResolved("hustles", h.id, persistedOwnership)) {
      items.push(withSuggestion(
        { entity: "hustles", id: h.id, title: h.title, status: h.stage },
        hustleOwnershipEvidence(h),
        tracks,
        trackContexts,
        feedbackModel,
      ));
    }
  }

  const counts: Record<string, number> = { jobs: 0, learn: 0, contacts: 0, hustles: 0 };
  for (const it of items) counts[it.entity]++;
  return { items, counts };
}
