import type { Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { isOpportunityActionable } from "@shared/domainState";

export type LaneName = "Direction" | "Applications" | "Network" | "Proof assets" | "Learning" | "Stability";
export type LaneStage =
  | "empty"
  | "exploring"
  | "narrowing"
  | "chosen"
  | "premature"
  | "ready"
  | "active"
  | "stalled"
  | "waiting"
  | "idea"
  | "outlined"
  | "drafted"
  | "packaged"
  | "queued"
  | "output_missing"
  | "converted"
  | "steady";

export type LaneState = {
  name: LaneName;
  stage: LaneStage;
  priority: number;
  bottleneck: string;
  unlockMove: string;
  stopRule: string;
  evidence: string[];
};

export type LaneOperatingModel = {
  lanes: LaneState[];
  bottleneckLane: LaneState;
  summary: string;
  trace: string[];
};

function text(...parts: unknown[]) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function hasTask(tasks: Task[], re: RegExp) {
  return tasks.some((t) => !t.done && re.test(text(t.title, t.category, t.doneWhen, t.sourceType, t.sourceNote, t.blockerReason)));
}

function activeTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && ["today", "this_week", "later", "inbox"].includes(t.list));
}

function actionableJobs(jobs: Job[]) {
  return jobs.filter((j) => isOpportunityActionable(j));
}

function directionLane(tasks: Task[], jobs: Job[]): LaneState {
  const openJobs = actionableJobs(jobs);
  const roleSignals = openJobs.length;
  const archetypes = new Set(openJobs.map((j) => j.roleArchetype || j.opportunityKind || "unknown").filter(Boolean));
  const hasDirectionTask = hasTask(tasks, /direction|role family|career|inspect|signal|attribute|explore|market map|pattern/i);
  const hasChosenTrack = openJobs.some((j) => j.relatedTrackId || j.narrativeAngle || (j.fitScore ?? 0) >= 75);

  let stage: LaneStage = "empty";
  if (hasChosenTrack) stage = "chosen";
  else if (roleSignals >= 8 || archetypes.size >= 3) stage = "narrowing";
  else if (roleSignals > 0 || hasDirectionTask) stage = "exploring";

  return {
    name: "Direction",
    stage,
    priority: stage === "empty" ? 100 : stage === "exploring" ? 92 : stage === "narrowing" ? 65 : 25,
    bottleneck:
      stage === "empty" ? "no role-family signal yet" :
      stage === "exploring" ? "not enough comparable role examples" :
      stage === "narrowing" ? "signals need synthesis into a sharper lane" :
      "direction is good enough for selective execution",
    unlockMove:
      stage === "empty" ? "Inspect one asset-backed role family" :
      stage === "exploring" ? "Save or inspect one more real role and note useful attributes" :
      stage === "narrowing" ? "Summarise the strongest role patterns and choose the next lane to test" :
      "Use the chosen direction to select one high-fit application or proof asset",
    stopRule: "Stop after one useful signal or one explicit lane decision.",
    evidence: [`${roleSignals} actionable saved roles`, `${archetypes.size} role archetypes`, hasDirectionTask ? "direction task exists" : "no direction task"],
  };
}

function applicationsLane(tasks: Task[], jobs: Job[], direction: LaneState): LaneState {
  const openJobs = actionableJobs(jobs);
  const applied = openJobs.filter((j) => j.status === "applied" || j.status === "interviewing").length;
  const ready = openJobs.filter((j) => (j.fitScore ?? 0) >= 70 || ["cv", "cover", "questions", "sample", "referral"].includes(j.applicationReadiness || "")).length;
  const hasApplicationTask = hasTask(tasks, /apply|application|cv|cover|interview|submit|follow up|follow-up/i);
  const stalled = hasApplicationTask && applied === 0 && direction.stage !== "empty" && direction.stage !== "exploring";
  // Applications are premature when direction is too vague. Proof is a long-term
  // compounding lane, not a hard gate for applying unless a specific role requires it.
  const premature = ["empty", "exploring"].includes(direction.stage) && ready === 0;

  let stage: LaneStage = premature ? "premature" : "ready";
  if (!premature && applied > 0) stage = "active";
  if (!premature && stalled) stage = "stalled";

  return {
    name: "Applications",
    stage,
    priority:
      premature ? 18 :
      stalled ? 82 :
      ready > 0 ? 78 :
      applied > 0 ? 68 : 55,
    bottleneck:
      premature ? "direction is not clear enough for selective applications" :
      stalled ? "application work exists but is not converting into submitted/followed-up roles" :
      ready > 0 ? "one high-fit role needs conversion" :
      "no high-fit application has been selected yet",
    unlockMove:
      premature ? "Build one role signal before applying" :
      stalled ? "Convert one existing application task into a submitted or followed-up outcome" :
      ready > 0 ? "Tailor one strong application step for the highest-fit role" :
      "Choose one role worth converting and define its application requirements",
    stopRule: "Stop after one concrete conversion step, not after browsing roles.",
    evidence: [`${openJobs.length} actionable roles`, `${ready} roles appear ready/high-fit`, `${applied} applied/interviewing`],
  };
}

function networkLane(tasks: Task[], contacts: Contact[]): LaneState {
  const openContacts = contacts.filter((c) => c.status !== "closed");
  const drafted = openContacts.filter((c) => c.messageDraft || c.lastMessage).length;
  const sent = openContacts.filter((c) => c.status === "messaged" || c.status === "replied").length;
  const waiting = openContacts.filter((c) => c.status === "messaged" && c.nextFollowUpDate).length;
  const hasNetworkTask = hasTask(tasks, /network|contact|message|coffee|intro|referral|follow up|follow-up|whatsapp|email/i);

  let stage: LaneStage = "empty";
  if (sent > 0) stage = waiting > 0 ? "waiting" : "active";
  else if (drafted > 0 || hasNetworkTask) stage = "active";

  return {
    name: "Network",
    stage,
    priority: stage === "empty" ? 58 : stage === "active" ? 72 : stage === "waiting" ? 42 : 55,
    bottleneck:
      stage === "empty" ? "no warm conversation path is active" :
      stage === "waiting" ? "waiting for replies or follow-up dates" :
      "outreach needs one sent message or follow-up",
    unlockMove:
      stage === "empty" ? "Identify one warm person or person-type for a reality-check message" :
      stage === "waiting" ? "Only follow up if a follow-up date is due" :
      "Send or follow up on one specific message",
    stopRule: "Stop after one sent/saved message or one clearly parked contact.",
    evidence: [`${openContacts.length} contacts`, `${drafted} drafted/message-bearing`, `${sent} messaged/replied`],
  };
}

function proofLane(tasks: Task[], hustles: Hustle[], learn: Learn[]): LaneState {
  const proofTasks = activeTasks(tasks).filter((t) => /proof|substack|memo|essay|article|portfolio|forecast|case study|story bank|cv bullet/i.test(text(t.title, t.category, t.sourceNote)));
  const proofAssets = hustles.filter((h) => h.stage !== "earning");
  const outlined = proofAssets.filter((h) => h.coreClaim || h.firstPostIdea || h.nextStep).length;
  const packagedLearning = learn.filter((l) => l.outputEvidenceUrl || (l.done && l.requiredOutput)).length;

  let stage: LaneStage = "empty";
  if (packagedLearning > 0 || proofAssets.some((h) => h.stage === "testing" && (h.coreClaim || h.firstPostIdea))) stage = "packaged";
  else if (outlined > 0 || proofTasks.length > 0) stage = "outlined";
  else if (proofAssets.length > 0) stage = "idea";

  return {
    name: "Proof assets",
    stage,
    // Proof is valuable but should not routinely outrank conversion work.
    priority: stage === "empty" ? 48 : stage === "idea" ? 52 : stage === "outlined" ? 58 : stage === "packaged" ? 34 : 45,
    bottleneck:
      stage === "empty" ? "no reusable evidence asset exists yet" :
      stage === "idea" ? "proof asset exists only as an idea" :
      stage === "outlined" ? "proof asset can be made more reusable over time" :
      "proof exists and can be reused in applications/networking",
    unlockMove:
      stage === "empty" ? "Define one lightweight proof idea when capacity allows" :
      stage === "idea" ? "Turn one proof idea into a claim and outline" :
      stage === "outlined" ? "Package one proof asset into a reusable paragraph, link, or bullet" :
      "Reuse one packaged proof asset in an application or message",
    stopRule: "Stop after one asset becomes more reusable than it was before.",
    evidence: [`${proofAssets.length} proof assets`, `${proofTasks.length} proof-like tasks`, `${packagedLearning} packaged learning outputs`],
  };
}

function learningLane(tasks: Task[], learn: Learn[]): LaneState {
  const open = learn.filter((l) => !l.done && l.learnStatus !== "closed");
  const active = open.filter((l) => l.active || l.learnStatus === "active" || l.learnStatus === "enrolled");
  const outputMissing = open.filter((l) => (l.requiredOutput || l.proofIntent) && !l.outputEvidenceUrl && !l.done);
  const converted = learn.filter((l) => l.done || l.outputEvidenceUrl).length;
  const hasLearningTask = hasTask(tasks, /learn|read|course|resource|podcast|book|study|output/i);

  let stage: LaneStage = "empty";
  if (converted > 0) stage = "converted";
  if (open.length > 0) stage = active.length > 0 || hasLearningTask ? "active" : "queued";
  if (outputMissing.length > 0) stage = "output_missing";

  return {
    name: "Learning",
    stage,
    priority: stage === "output_missing" ? 58 : stage === "active" ? 46 : stage === "queued" ? 34 : stage === "converted" ? 28 : 25,
    bottleneck:
      stage === "output_missing" ? "learning has not been converted into usable output" :
      stage === "active" ? "active learning needs a concrete output" :
      stage === "queued" ? "resources are queued but not yet selected for use" :
      stage === "converted" ? "learning is already producing evidence" :
      "no active learning lane",
    unlockMove:
      stage === "output_missing" ? "Convert one learning item into a note, bullet, or proof output" :
      stage === "active" ? "Finish the smallest useful output from one active resource" :
      stage === "queued" ? "Choose one resource only if it supports the current bottleneck" :
      "Do not add learning unless it unlocks Direction, Proof, or Applications",
    stopRule: "Stop after one output exists; do not keep consuming.",
    evidence: [`${open.length} open learning items`, `${active.length} active`, `${outputMissing.length} missing output`],
  };
}

function stabilityLane(tasks: Task[]): LaneState {
  const blocked = tasks.filter((t) => !t.done && (t.readiness === "blocked" || t.blockerReason)).length;
  const tooManyToday = tasks.filter((t) => !t.done && t.list === "today").length;
  return {
    name: "Stability",
    stage: blocked > 0 || tooManyToday > 5 ? "stalled" : "steady",
    priority: blocked > 0 ? 86 : tooManyToday > 5 ? 62 : 20,
    bottleneck: blocked > 0 ? "blocked tasks are creating drag" : tooManyToday > 5 ? "too many live tasks are competing" : "execution base is stable enough",
    unlockMove: blocked > 0 ? "Unblock or park one stuck item" : tooManyToday > 5 ? "Reduce today to the real sequence" : "Keep the plan small enough to start",
    stopRule: "Stop once the system is calmer, not once everything is solved.",
    evidence: [`${blocked} blocked tasks`, `${tooManyToday} tasks on today`],
  };
}

function chooseBottleneck(lanes: LaneState[]) {
  const hardGate = lanes.find((l) => l.name === "Direction" && ["empty", "exploring"].includes(l.stage));
  if (hardGate) return hardGate;
  return [...lanes].sort((a, b) => b.priority - a.priority)[0];
}

export function buildLaneOperatingModel(
  tasks: Task[],
  jobs: Job[],
  learn: Learn[],
  hustles: Hustle[],
  contacts: Contact[] = [],
): LaneOperatingModel {
  const direction = directionLane(tasks, jobs);
  const proof = proofLane(tasks, hustles, learn);
  const applications = applicationsLane(tasks, jobs, direction);
  const network = networkLane(tasks, contacts);
  const learning = learningLane(tasks, learn);
  const stability = stabilityLane(tasks);
  const lanes = [direction, applications, network, proof, learning, stability];
  const bottleneckLane = chooseBottleneck(lanes);
  return {
    lanes,
    bottleneckLane,
    summary: `${bottleneckLane.name} is the current bottleneck: ${bottleneckLane.bottleneck}.`,
    trace: lanes.map((l) => `${l.name}: ${l.stage} — ${l.bottleneck}`),
  };
}
