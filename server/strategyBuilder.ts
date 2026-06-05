import type { Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { buildLaneOperatingModel, type LaneOperatingModel } from "./laneState";
import OpenAI from "openai";

export type RoleArchetypeRecommendation = {
  archetype: string;
  priority: "explore" | "convert" | "watch" | "pause";
  fitLogic: string;
  credibilityGap: string;
  proofNeeded: string;
  peopleToFind: string[];
  resourceNeed: string;
  nextExperiment: string;
  marketSignal?: string;
  source?: "market" | "fallback" | "saved-system";
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
  marketGroundedAt?: number;
  marketGroundingStatus?: "fresh" | "fallback";
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
    source: "fallback",
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
    source: "fallback",
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
    source: "fallback",
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
    source: "fallback",
  },
];

function includesAny(hay: string, needles: RegExp[]) { return needles.some((n) => n.test(hay)); }

function corpus(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[]) {
  return [
    ...tasks.map((t) => `${t.title} ${t.category} ${t.sourceNote}`),
    ...jobs.map((j) => `${j.title} ${j.company} ${j.roleArchetype} ${j.note} ${j.narrativeAngle}`),
    ...learn.map((l) => `${l.title} ${l.category} ${l.capabilityBuilt} ${l.requiredOutput}`),
    ...hustles.map((h) => `${h.title} ${h.note} ${h.coreClaim} ${h.contentPillar}`),
    ...contacts.map((c) => `${c.who} ${c.targetOrg} ${c.targetRole} ${c.why}`),
  ].join(" ").toLowerCase();
}

function sanitizeRole(raw: any): RoleArchetypeRecommendation | null {
  if (!raw || typeof raw !== "object" || typeof raw.archetype !== "string") return null;
  const priority = ["explore", "convert", "watch", "pause"].includes(raw.priority) ? raw.priority : "explore";
  return {
    archetype: String(raw.archetype).slice(0, 140),
    priority,
    fitLogic: String(raw.fitLogic || "Market-grounded role lane that appears adjacent to the profile.").slice(0, 320),
    credibilityGap: String(raw.credibilityGap || "Needs stronger evidence before conversion.").slice(0, 240),
    proofNeeded: String(raw.proofNeeded || "One reusable proof asset tied to this lane.").slice(0, 220),
    peopleToFind: Array.isArray(raw.peopleToFind) ? raw.peopleToFind.slice(0, 4).map((x: any) => String(x).slice(0, 90)) : ["role insider", "hiring manager or talent partner"],
    resourceNeed: String(raw.resourceNeed || "One current market/resource primer with a concrete output.").slice(0, 220),
    nextExperiment: String(raw.nextExperiment || `Inspect three ${raw.archetype} roles and capture repeated requirements.`).slice(0, 220),
    marketSignal: String(raw.marketSignal || "").slice(0, 280),
    source: "market",
  };
}

async function getMarketGroundedArchetypes(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[]): Promise<RoleArchetypeRecommendation[] | null> {
  try {
    const client = new OpenAI();
    const systemSnapshot = {
      savedRoles: jobs.slice(0, 25).map((j) => ({ title: j.title, company: j.company, location: j.location, note: j.note, fitScore: j.fitScore, status: j.status })),
      learning: learn.slice(0, 20).map((l) => ({ title: l.title, capabilityBuilt: l.capabilityBuilt, requiredOutput: l.requiredOutput, status: l.learnStatus })),
      proofAssets: hustles.slice(0, 20).map((h) => ({ title: h.title, stage: h.stage, claim: h.coreClaim, note: h.note })),
      contacts: contacts.slice(0, 20).map((c) => ({ who: c.who, targetRole: c.targetRole, why: c.why, status: c.status })),
      tasks: tasks.filter((t) => !t.done).slice(0, 25).map((t) => ({ title: t.title, category: t.category, sourceNote: t.sourceNote })),
    };
    const r = await client.responses.create({
      model: "gpt_5_1",
      // The model should use its current market knowledge plus the user's saved
      // system state. No fake employers/URLs; role archetypes and people types only.
      input:
        `You are the market-grounding strategy engine for a job-search operating system. ` +
        `User profile: ex-Bain, ex-Tony Blair Institute, Abraaj/private equity, public-sector strategy, KSA/Africa investment work; targeting London/UAE/remote roles around AI governance, geopolitical/strategic advisory, chief-of-staff/founder office, development/philanthropy strategy. ` +
        `Using current labour-market patterns and the saved system snapshot, recommend 3-5 role archetypes to explore/convert/watch. ` +
        `For each, return: archetype, priority (explore|convert|watch|pause), fitLogic, credibilityGap, proofNeeded, peopleToFind (2-4 person TYPES, not names), resourceNeed, nextExperiment, marketSignal. ` +
        `MarketSignal should summarize why this lane exists now, not cite URLs. Do not invent specific open roles or specific people. ` +
        `Return ONLY JSON: {"roleArchetypes":[...]}. Snapshot: ${JSON.stringify(systemSnapshot)}`,
    });
    const text = (r.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let parsed: any = {}; try { parsed = JSON.parse(text); } catch { parsed = {}; }
    const arr = Array.isArray(parsed?.roleArchetypes) ? parsed.roleArchetypes : [];
    const clean = arr.map(sanitizeRole).filter(Boolean) as RoleArchetypeRecommendation[];
    return clean.length ? clean : null;
  } catch {
    return null;
  }
}

function scoreArchetype(base: RoleArchetypeRecommendation, allText: string, jobs: Job[], contacts: Contact[], hustles: Hustle[]): RoleArchetypeRecommendation {
  const a = base.archetype.toLowerCase();
  const signal =
    (a.includes("ai") && includesAny(allText, [/ai governance|frontier ai|ai safety|policy|technology governance/]) ? 2 : 0) +
    (a.includes("geopolitical") && includesAny(allText, [/geo|sovereign|advisory|diplomacy|africa|ksa|investment/]) ? 2 : 0) +
    (a.includes("chief") && includesAny(allText, [/chief of staff|founder|operator|startup|operating/]) ? 2 : 0) +
    (a.includes("development") && includesAny(allText, [/development|philanthropy|foundation|dfi|aid|global/]) ? 2 : 0);
  const first = a.split(" ")[0];
  const roleSignal = jobs.filter((j) => `${j.title} ${j.roleArchetype} ${j.note}`.toLowerCase().includes(first)).length;
  const peopleSignal = contacts.filter((c) => `${c.who} ${c.targetRole} ${c.why}`.toLowerCase().includes(first)).length;
  const proofSignal = hustles.filter((h) => `${h.title} ${h.note} ${h.coreClaim}`.toLowerCase().includes(first)).length;
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
      why: `This closes the current credibility or judgement gap for ${r.archetype}.${r.marketSignal ? " Market signal: " + r.marketSignal : ""}`,
      output: `A one-page note or proof bullet that can be reused in outreach/applications.`,
    }));
}

function buildProofGaps(roleArchetypes: RoleArchetypeRecommendation[], hustles: Hustle[], learn: Learn[]): ProofGapRecommendation[] {
  const existingProof = [...hustles.map((h) => `${h.title} ${h.coreClaim} ${h.note}`), ...learn.map((l) => `${l.requiredOutput} ${l.outputEvidenceUrl}`)].join(" ").toLowerCase();
  return roleArchetypes
    .filter((r) => r.priority === "explore" || r.priority === "convert")
    .filter((r) => !existingProof.includes(r.proofNeeded.toLowerCase().split(" ")[0]))
    .slice(0, 3)
    .map((r) => ({ gap: r.credibilityGap, asset: r.proofNeeded, doneWhen: "There is a reusable paragraph, link, or bullet that proves the claim.", linkedArchetype: r.archetype }));
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

function buildFromArchetypes(roleArchetypes: RoleArchetypeRecommendation[], laneModel: LaneOperatingModel, learn: Learn[], hustles: Hustle[], contacts: Contact[], status: "fresh" | "fallback"): StrategyBuild {
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
    marketGroundedAt: Date.now(),
    marketGroundingStatus: status,
  };
}

export function buildStrategyBuilder(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[] = []): StrategyBuild {
  const laneModel = buildLaneOperatingModel(tasks, jobs, learn, hustles, contacts);
  const allText = corpus(tasks, jobs, learn, hustles, contacts);
  const roleArchetypes = BASE_ARCHETYPES.map((r) => scoreArchetype(r, allText, jobs, contacts, hustles)).sort((a, b) => {
    const rank = { convert: 4, explore: 3, watch: 2, pause: 1 } as const;
    return rank[b.priority] - rank[a.priority];
  });
  return buildFromArchetypes(roleArchetypes, laneModel, learn, hustles, contacts, "fallback");
}

export async function buildMarketGroundedStrategyBuilder(tasks: Task[], jobs: Job[], learn: Learn[], hustles: Hustle[], contacts: Contact[] = []): Promise<StrategyBuild> {
  const laneModel = buildLaneOperatingModel(tasks, jobs, learn, hustles, contacts);
  const market = await getMarketGroundedArchetypes(tasks, jobs, learn, hustles, contacts);
  if (market?.length) return buildFromArchetypes(market, laneModel, learn, hustles, contacts, "fresh");
  return buildStrategyBuilder(tasks, jobs, learn, hustles, contacts);
}
