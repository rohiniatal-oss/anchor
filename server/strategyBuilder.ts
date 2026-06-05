import type { Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { buildLaneOperatingModel, type LaneOperatingModel } from "./laneState";

export type RoleArchetypeRecommendation = {
  archetype: string;
  priority: "explore" | "convert" | "watch" | "pause";
  fitLogic: string;
  credibilityGap: string;
  proofNeeded: string;
  peopleToFind: string[];
  resourceNeed: string;
  nextExperiment: string;
};

export type PeopleRecommendation = {
  category: string;
  why: string;
  ask: string;
  linkedArchetype: string;
};

export type ResourceRecommendation = {
  category: string;
  why: string;
  output: string;
  linkedArchetype: string;
};

export type ProofGapRecommendation = {
  gap: string;
  asset: string;
  doneWhen: string;
  linkedArchetype: string;
};

export type PlanShift = {
  action: "start" | "continue" | "pause" | "convert" | "reduce";
  target: string;
  reason: string;
};

export type StrategyBuild = {
  headline: string;
  laneModel: LaneOperatingModel;
  roleArchetypes: RoleArchetypeRecommendation[];
  peopleMap: PeopleRecommendation[];
  resourceMap: ResourceRecommendation[];
  proofGaps: ProofGapRecommendation[];
  planShifts: PlanShift[];
  weeklyShape: { direction: number; proof: number; network: number; applications: number; learning: number; stability: number };
  nextSystemMoves: string[];
};

const BASE_ARCHETYPES: RoleArchetypeRecommendation[] = [
  {
    archetype: "AI governance strategy and implementation",
    priority: "explore",
    fitLogic: "Combines public-sector strategy, geopolitical judgement, implementation, and frontier-tech interest.",
    credibilityGap: "Needs visible AI governance judgement beyond generic interest.",
    proofNeeded: "One short memo translating an AI governance problem into an implementation roadmap.",
    peopleToFind: ["AI governance strategy operator", "policy-to-implementation lead", "frontier AI safety/governance programme manager"],
    resourceNeed: "A current AI governance landscape primer plus one implementation case study.",
    nextExperiment: "Inspect three AI governance strategy roles and capture repeated requirements.",
  },
  {
    archetype: "Geopolitical and strategic advisory",
    priority: "explore",
    fitLogic: "Strong fit with TBI, Bain-style strategy, government advisory, and cross-border investment work.",
    credibilityGap: "Needs sharper sector/thematic wedge so it does not read as broad generalist advisory.",
    proofNeeded: "One briefing note on a geopolitical-commercial issue with a clear recommendation.",
    peopleToFind: ["geopolitical advisory principal", "commercial diplomacy operator", "sovereign advisory recruiter"],
    resourceNeed: "A recent market/geopolitical risk briefing source and one sample advisory memo format.",
    nextExperiment: "Compare three geopolitical advisory roles and identify the strongest wedge.",
  },
  {
    archetype: "Chief of staff or founder office in mission-driven tech",
    priority: "watch",
    fitLogic: "Uses structured problem-solving, executive leverage, stakeholder management, and operating cadence.",
    credibilityGap: "Needs evidence of operator ownership, not only advisory work.",
    proofNeeded: "One operating system or decision memo that shows founder-office leverage.",
    peopleToFind: ["current chief of staff", "founder-office operator", "startup talent partner"],
    resourceNeed: "Founder-office case studies and role scorecards.",
    nextExperiment: "Interview one chief of staff type to test what actually gets hired.",
  },
  {
    archetype: "Global development and philanthropy strategy",
    priority: "watch",
    fitLogic: "Connects government advisory, development themes, capital allocation, and strategy background.",
    credibilityGap: "Needs clarity on whether this is energising or simply familiar.",
    proofNeeded: "One strategy note on a funder/government priority area.",
    peopleToFind: ["foundation strategy lead", "development finance operator", "programme strategy director"],
    resourceNeed: "A funder landscape or development finance strategy primer.",
    nextExperiment: "Compare two philanthropy strategy roles with two AI governance roles for energy and fit.",
  },
];

function includesAny(hay: string, needles: RegExp[]) {
  return needles.some((n) => n.test(hay));
}

function corpus(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[]) {
  return [
    ...tasks.map((t) => `${t.title} ${t.category} ${t.sourceNote}`),
    ...jobs.map((j) => `${j.title} ${j.company} ${j.roleArchetype} ${j.note} ${j.narrativeAngle}`),
    ...learn.map((l) => `${l.title} ${l.category} ${l.capabilityBuilt} ${l.requiredOutput}`),
    ...hustles.map((h) => `${h.title} ${h.note} ${h.coreClaim} ${h.contentPillar}`),
    ...contacts.map((c) => `${c.who} ${c.targetOrg} ${c.targetRole} ${c.why}`),
  ].join(" ").toLowerCase();
}

function scoreArchetype(base: RoleArchetypeRecommendation, allText: string, jobs: Job[], contacts: Contact[], hustles: Hustle[]): RoleArchetypeRecommendation {
  const a = base.archetype.toLowerCase();
  const signal =
    (a.includes("ai") && includesAny(allText, [/ai governance|frontier ai|ai safety|policy|technology governance/]) ? 2 : 0) +
    (a.includes("geopolitical") && includesAny(allText, [/geo|sovereign|advisory|diplomacy|africa|ksa|investment/]) ? 2 : 0) +
    (a.includes("chief") && includesAny(allText, [/chief of staff|founder|operator|startup|operating/]) ? 2 : 0) +
    (a.includes("development") && includesAny(allText, [/development|philanthropy|foundation|dfi|aid|global/]) ? 2 : 0);
  const roleSignal = jobs.filter((j) => `${j.title} ${j.roleArchetype} ${j.note}`.toLowerCase().includes(a.split(" ")[0])).length;
  const peopleSignal = contacts.filter((c) => `${c.who} ${c.targetRole} ${c.why}`.toLowerCase().includes(a.split(" ")[0])).length;
  const proofSignal = hustles.filter((h) => `${h.title} ${h.note} ${h.coreClaim}`.toLowerCase().includes(a.split(" ")[0])).length;

  let priority: RoleArchetypeRecommendation["priority"] = base.priority;
  if (signal + roleSignal + peopleSignal + proofSignal >= 4) priority = proofSignal > 0 || roleSignal >= 2 ? "convert" : "explore";
  if (roleSignal === 0 && peopleSignal === 0 && proofSignal === 0 && base.priority === "watch") priority = "watch";

  return { ...base, priority };
}

function buildPeopleMap(roleArchetypes: RoleArchetypeRecommendation[], contacts: Contact[]): PeopleRecommendation[] {
  const existing = contacts.map((c) => `${c.who} ${c.targetRole} ${c.targetOrg}`.toLowerCase()).join(" ");
  const recs: PeopleRecommendation[] = [];
  for (const r of roleArchetypes.filter((x) => x.priority !== "pause").slice(0, 3)) {
    for (const personType of r.peopleToFind.slice(0, 2)) {
      if (!existing.includes(personType.toLowerCase().split(" ")[0])) {
        recs.push({
          category: personType,
          linkedArchetype: r.archetype,
          why: `Needed to test whether ${r.archetype} is real fit and what profiles get hired.`,
          ask: "Ask for a 15-minute reality check on what actually gets hired and what proof matters.",
        });
      }
    }
  }
  return recs.slice(0, 5);
}

function buildResourceMap(roleArchetypes: RoleArchetypeRecommendation[], learn: Learn[]): ResourceRecommendation[] {
  const existing = learn.map((l) => `${l.title} ${l.capabilityBuilt} ${l.requiredOutput}`.toLowerCase()).join(" ");
  return roleArchetypes
    .filter((r) => r.priority === "explore" || r.priority === "convert")
    .filter((r) => !existing.includes(r.archetype.toLowerCase().split(" ")[0]))
    .slice(0, 3)
    .map((r) => ({
      category: r.resourceNeed,
      linkedArchetype: r.archetype,
      why: `This closes the current credibility or judgement gap for ${r.archetype}.`,
      output: `A one-page note or proof bullet that can be reused in outreach/applications.`,
    }));
}

function buildProofGaps(roleArchetypes: RoleArchetypeRecommendation[], hustles: Hustle[], learn: Learn[]): ProofGapRecommendation[] {
  const existingProof = [
    ...hustles.map((h) => `${h.title} ${h.coreClaim} ${h.note}`),
    ...learn.map((l) => `${l.requiredOutput} ${l.outputEvidenceUrl}`),
  ].join(" ").toLowerCase();
  return roleArchetypes
    .filter((r) => r.priority === "explore" || r.priority === "convert")
    .filter((r) => !existingProof.includes(r.proofNeeded.toLowerCase().split(" ")[0]))
    .slice(0, 3)
    .map((r) => ({
      gap: r.credibilityGap,
      asset: r.proofNeeded,
      doneWhen: "There is a reusable paragraph, link, or bullet that proves the claim.",
      linkedArchetype: r.archetype,
    }));
}

function buildPlanShifts(laneModel: LaneOperatingModel, roleArchetypes: RoleArchetypeRecommendation[]): PlanShift[] {
  const shifts: PlanShift[] = [];
  const direction = laneModel.lanes.find((l) => l.name === "Direction");
  const applications = laneModel.lanes.find((l) => l.name === "Applications");
  const proof = laneModel.lanes.find((l) => l.name === "Proof assets");
  const network = laneModel.lanes.find((l) => l.name === "Network");
  const learning = laneModel.lanes.find((l) => l.name === "Learning");

  if (applications?.stage === "premature") shifts.push({ action: "pause", target: "mass applications", reason: "Applications are premature until direction and proof are stronger." });
  if (direction && ["empty", "exploring", "narrowing"].includes(direction.stage)) shifts.push({ action: "start", target: "role-family signal gathering", reason: direction.bottleneck });
  if (proof && ["empty", "idea", "outlined"].includes(proof.stage)) shifts.push({ action: "start", target: "one reusable proof asset", reason: proof.bottleneck });
  if (network && network.stage === "empty") shifts.push({ action: "start", target: "targeted people map", reason: network.bottleneck });
  if (learning && learning.stage === "output_missing") shifts.push({ action: "convert", target: "learning into proof", reason: learning.bottleneck });
  for (const r of roleArchetypes.filter((x) => x.priority === "convert").slice(0, 2)) shifts.push({ action: "convert", target: r.archetype, reason: "There is enough signal to move from exploration to selective conversion." });
  return shifts.slice(0, 6);
}

function weeklyShape(laneModel: LaneOperatingModel) {
  const b = laneModel.bottleneckLane.name;
  const base = { direction: 25, proof: 25, network: 20, applications: 15, learning: 10, stability: 5 };
  if (b === "Direction") return { direction: 40, proof: 20, network: 20, applications: 5, learning: 10, stability: 5 };
  if (b === "Proof assets") return { direction: 15, proof: 40, network: 15, applications: 15, learning: 10, stability: 5 };
  if (b === "Applications") return { direction: 10, proof: 20, network: 20, applications: 40, learning: 5, stability: 5 };
  if (b === "Network") return { direction: 20, proof: 20, network: 35, applications: 15, learning: 5, stability: 5 };
  if (b === "Learning") return { direction: 15, proof: 25, network: 15, applications: 15, learning: 25, stability: 5 };
  return base;
}

export function buildStrategyBuilder(
  tasks: Task[],
  jobs: Job[],
  learn: Learn[],
  hustles: Hustle[],
  contacts: Contact[] = [],
): StrategyBuild {
  const laneModel = buildLaneOperatingModel(tasks, jobs, learn, hustles, contacts);
  const allText = corpus(tasks, jobs, learn, hustles, contacts);
  const roleArchetypes = BASE_ARCHETYPES.map((r) => scoreArchetype(r, allText, jobs, contacts, hustles))
    .sort((a, b) => {
      const rank = { convert: 4, explore: 3, watch: 2, pause: 1 } as const;
      return rank[b.priority] - rank[a.priority];
    });
  const peopleMap = buildPeopleMap(roleArchetypes, contacts);
  const resourceMap = buildResourceMap(roleArchetypes, learn);
  const proofGaps = buildProofGaps(roleArchetypes, hustles, learn);
  const planShifts = buildPlanShifts(laneModel, roleArchetypes);
  const nextSystemMoves = [
    ...roleArchetypes.filter((r) => r.priority === "explore" || r.priority === "convert").slice(0, 2).map((r) => r.nextExperiment),
    ...peopleMap.slice(0, 2).map((p) => `Find: ${p.category}`),
    ...proofGaps.slice(0, 1).map((p) => `Create proof: ${p.asset}`),
  ].slice(0, 5);

  return {
    headline: `${laneModel.bottleneckLane.name} is the strategic bottleneck; the system should ${laneModel.bottleneckLane.unlockMove.toLowerCase()}.`,
    laneModel,
    roleArchetypes,
    peopleMap,
    resourceMap,
    proofGaps,
    planShifts,
    weeklyShape: weeklyShape(laneModel),
    nextSystemMoves,
  };
}
