import type { Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { getLearnOutputState, getProofStage, isOpportunityActionable } from "@shared/domainState";
import { LANE_NAME } from "./lanes";

export const OPERATING_LANE_NAME = {
  DIRECTION: LANE_NAME.DIRECTION,
  APPLICATIONS: LANE_NAME.APPLICATIONS,
  NETWORK: LANE_NAME.NETWORK,
  PROOF_ASSETS: LANE_NAME.PROOF_ASSETS,
  LEARNING: "Learning",
  STABILITY: LANE_NAME.STABILITY,
} as const;

export type LaneName = typeof OPERATING_LANE_NAME[keyof typeof OPERATING_LANE_NAME];
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
    name: OPERATING_LANE_NAME.DIRECTION,
    stage,
    priority: stage === "empty" ? 100 : stage === "exploring" ? 92 : stage === "narrowing" ? 65 : 25,
    bottleneck:
      stage === "empty" ? "no real role examples yet" :
      stage === "exploring" ? "not enough comparable role examples" :
      stage === "narrowing" ? "the patterns still need synthesising into a sharper path" :
      "direction is good enough for selective execution",
    unlockMove:
      stage === "empty" ? "Inspect one asset-backed role family" :
      stage === "exploring" ? "Save or inspect one more real role and note useful attributes" :
      stage === "narrowing" ? "Summarise the strongest role patterns and choose the next path to test" :
      "Use the chosen direction to select one high-fit application or project/public-work item",
    stopRule: "Stop after one useful data point or one explicit path decision.",
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
    name: OPERATING_LANE_NAME.APPLICATIONS,
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
      premature ? "Build one real role example before applying" :
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
    name: OPERATING_LANE_NAME.NETWORK,
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
  const proofAssets = hustles.filter((h) => getProofStage(h) !== "earning");
  const liveProofAssets = proofAssets.filter((h) => getProofStage(h) === "testing");
  const outlined = proofAssets.filter((h) => h.coreClaim || h.firstPostIdea || h.nextStep).length;
  const packagedLearning = learn.filter((l) => getLearnOutputState(l) === "evidenced").length;

  let stage: LaneStage = "empty";
  if (liveProofAssets.some((h) => h.coreClaim || h.firstPostIdea || h.nextStep)) stage = "packaged";
  else if (outlined > 0 || proofTasks.length > 0) stage = "outlined";
  else if (proofAssets.length > 0) stage = "idea";

  return {
    name: OPERATING_LANE_NAME.PROOF_ASSETS,
    stage,
    // Proof is a compounding capability layer, not a routine bottleneck.
    priority: stage === "empty" ? 16 : stage === "idea" ? 22 : stage === "outlined" ? 30 : stage === "packaged" ? 26 : 18,
    bottleneck:
      stage === "empty" ? "no project or public-work item exists yet, which is fine until upskilling needs one" :
      stage === "idea" ? "a project or public-work item exists only as an optional idea" :
      stage === "outlined" ? "the project or public-work item can be made more reusable when capacity allows" :
      "an existing project or public-work item can now be reused as evidence",
    unlockMove:
      stage === "empty" ? "Only define a lightweight project or public-work idea if it supports current upskilling" :
      stage === "idea" ? "Turn one idea into a small claim and outline" :
      stage === "outlined" ? "Package one project or public-work item into a reusable paragraph, link, or bullet" :
      "Reuse one live project or public-work item where it strengthens your profile",
    stopRule: "Stop after one asset becomes more reusable than it was before.",
    evidence: [`${proofAssets.length} project/public-work item(s)`, `${liveProofAssets.length} live project/public-work item(s)`, `${packagedLearning} learning output(s) linked back`, `${proofTasks.length} output-related tasks`],
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
    name: OPERATING_LANE_NAME.LEARNING,
    stage,
    priority: stage === "output_missing" ? 58 : stage === "active" ? 46 : stage === "queued" ? 34 : stage === "converted" ? 28 : 25,
    bottleneck:
      stage === "output_missing" ? "learning has not yet turned into something you can use later" :
      stage === "active" ? "active learning needs one concrete note, brief, or practice attempt" :
      stage === "queued" ? "prep items are queued but not yet selected for use" :
      stage === "converted" ? "learning is already turning into something reusable" :
      "no active learning lane",
    unlockMove:
      stage === "output_missing" ? "Turn one learning item into notes, bullets, or a reusable example" :
      stage === "active" ? "Finish the smallest useful note, brief, or practice attempt from one active prep item" :
      stage === "queued" ? "Choose one prep item only if it supports the current bottleneck" :
      "Do not add learning unless it helps with direction, writing/projects, or applications",
    stopRule: "Stop after one useful note, brief, or practice attempt exists; do not keep consuming.",
    evidence: [`${open.length} open learning items`, `${active.length} active`, `${outputMissing.length} still need notes or a brief`],
  };
}

function stabilityLane(tasks: Task[]): LaneState {
  const blocked = tasks.filter((t) => !t.done && (t.readiness === "blocked" || t.blockerReason)).length;
  const tooManyToday = tasks.filter((t) => !t.done && t.list === "today").length;
  return {
    name: OPERATING_LANE_NAME.STABILITY,
    stage: blocked > 0 || tooManyToday > 5 ? "stalled" : "steady",
    priority: blocked > 0 ? 86 : tooManyToday > 5 ? 62 : 20,
    bottleneck: blocked > 0 ? "blocked tasks are creating drag" : tooManyToday > 5 ? "too many live tasks are competing" : "execution base is stable enough",
    unlockMove: blocked > 0 ? "Unblock or park one stuck item" : tooManyToday > 5 ? "Reduce today to the real sequence" : "Keep the plan small enough to start",
    stopRule: "Stop once the system is calmer, not once everything is solved.",
    evidence: [`${blocked} blocked tasks`, `${tooManyToday} tasks on today`],
  };
}

function chooseBottleneck(lanes: LaneState[]) {
  const hardGate = lanes.find((l) => l.name === OPERATING_LANE_NAME.DIRECTION && ["empty", "exploring"].includes(l.stage));
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
