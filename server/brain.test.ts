import assert from "node:assert/strict";
import test from "node:test";
import { planDay, recommend } from "./brain";

function task(overrides: Record<string, any>) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Task",
    list: overrides.list ?? "today",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: overrides.category ?? "admin",
    deadline: overrides.deadline ?? "",
    size: overrides.size ?? "medium",
    status: overrides.status ?? "not_started",
    skipped: overrides.skipped ?? 0,
    doneWhen: overrides.doneWhen ?? "",
    source: "",
    sourceType: overrides.sourceType ?? "",
    sourceId: overrides.sourceId,
    sourceUrl: "",
    sourceNote: overrides.sourceNote ?? "",
    sourceStatus: "",
    planItemId: null,
    relatedTrackId: null,
    relatedOpportunityId: null,
    parentTaskId: null,
    dependsOn: "[]",
    blocks: "[]",
    blockedBy: "",
    blockerReason: overrides.blockerReason ?? "",
    readiness: overrides.readiness ?? "ready",
    minimumOutcome: overrides.minimumOutcome ?? "",
    stretchOutcome: "",
    estimateMinutes: null,
    estimateConfidence: "",
    estimateReason: "",
    actualMinutes: null,
    createdAt: Date.now(),
    ...overrides,
  } as any;
}

function job(overrides: Record<string, any>) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Saved role",
    company: overrides.company ?? "Target org",
    location: "",
    url: "",
    note: overrides.note ?? "",
    nextStep: overrides.nextStep ?? "",
    status: overrides.status ?? "wishlist",
    deadline: overrides.deadline ?? "",
    flag: "",
    roleArchetype: "",
    opportunityKind: "job",
    fitScore: overrides.fitScore,
    stretchScore: null,
    strategicValue: null,
    frictionScore: null,
    eligibilityRisk: overrides.eligibilityRisk ?? "",
    warmPathScore: null,
    applicationReadiness: overrides.applicationReadiness ?? "none",
    narrativeAngle: "",
    relatedTrackId: null,
    sourceUrl: "",
    sourceType: "posting",
    sourceCheckedAt: null,
    deadlineConfidence: "",
    applicationWindowStatus: overrides.applicationWindowStatus ?? "open",
    createdAt: Date.now(),
    ...overrides,
  } as any;
}

function contact(overrides: Record<string, any>) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Ally",
    who: overrides.who ?? "Ally at Target Org",
    sector: overrides.sector ?? "",
    why: overrides.why ?? "",
    status: overrides.status ?? "to_contact",
    note: overrides.note ?? "",
    relationshipStrength: overrides.relationshipStrength ?? "cold",
    sourceNetwork: overrides.sourceNetwork ?? "",
    targetOrg: overrides.targetOrg ?? "",
    targetRole: overrides.targetRole ?? "",
    askType: overrides.askType ?? "soft",
    messageDraft: overrides.messageDraft ?? "",
    lastMessage: overrides.lastMessage ?? "",
    nextFollowUpDate: overrides.nextFollowUpDate ?? "",
    referralPotential: overrides.referralPotential ?? "",
    warmthScore: overrides.warmthScore ?? null,
    relatedTrackId: overrides.relatedTrackId ?? null,
    createdAt: Date.now(),
    ...overrides,
  } as any;
}

test("planner favours direction signal before premature application work", () => {
  const tasks = [
    task({ id: 1, title: "Apply to several saved roles", category: "job" }),
    task({ id: 2, title: "Inspect one role family and note useful attributes", category: "learning", size: "quick" }),
  ];
  const result = planDay(tasks, [], [], [], "medium", { remainingMinutes: 240 });
  assert.equal(result.plan[0].candidate.sourceId, 2);
  assert.match(result.plan[0].why, /Direction|direction|bottleneck/i);
});

test("planner collapses to one item when the remaining day is small", () => {
  const tasks = [
    task({ id: 1, title: "Inspect one role family", category: "learning", size: "quick" }),
    task({ id: 2, title: "Draft a proof memo", category: "hustle", size: "deep" }),
    task({ id: 3, title: "Send one networking message", category: "admin", size: "quick" }),
  ];
  const result = planDay(tasks, [], [], [], "medium", { remainingMinutes: 30 });
  assert.equal(result.plan.length, 1);
  assert.match(result.note, /little day|One useful thing/i);
});

test("urgent real deadlines still lead", () => {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = [
    task({ id: 1, title: "Low urgency direction note", category: "learning", size: "quick" }),
  ];
  const jobs = [job({ id: 2, title: "Deadline role", deadline: today, fitScore: 30 })];
  const result = planDay(tasks, jobs, [], [], "medium", { remainingMinutes: 240 });
  assert.equal(result.plan[0].candidate.source, "job");
  assert.match(result.note, /deadline/i);
});

test("brain prefers the more gettable role across flexible target locations", () => {
  const jobs = [
    job({
      id: 1,
      title: "Strategy Associate",
      company: "Cold Coast",
      location: "New York",
      fitScore: 86,
      warmPathScore: 10,
      frictionScore: 80,
      applicationReadiness: "none",
      deadlineConfidence: "",
    }),
    job({
      id: 2,
      title: "AI Strategy Manager",
      company: "Dubai Lab",
      location: "Dubai, UAE",
      fitScore: 68,
      warmPathScore: 82,
      frictionScore: 15,
      applicationReadiness: "questions",
      deadlineConfidence: "high",
      narrativeAngle: "Strong AI strategy and policy bridge",
    }),
  ];

  const result = recommend([], jobs, [], [], "medium");
  assert.equal(result.pick?.source, "job");
  assert.equal(result.pick?.sourceId, 2);
  assert.ok(result.trace?.some((line: string) => /location|warm path|submittable/i.test(line)));
  assert.match(result.explanation.summary, /strongest conversion move|Applications|bottleneck/i);
  assert.ok(Array.isArray(result.explanation.supportingReasons) && result.explanation.supportingReasons.length >= 2);
  assert.match(result.explanation.firstStep, /Open the role|application materials/i);
});

test("planner keeps job pursuit and capability-building in parallel when time allows", () => {
  const jobs = [
    job({
      id: 1,
      title: "Geopolitical Risk Analyst",
      company: "Advisory Group",
      location: "Remote",
      fitScore: 72,
      warmPathScore: 60,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
    }),
  ];
  const learn = [{
    id: 1,
    title: "AI strategy memo drill",
    requiredOutput: "one memo paragraph",
    active: true,
    proofIntent: true,
    done: false,
    learnStatus: "active",
    applicationDeadline: "",
    url: "",
    note: "",
    relatedTrackId: null,
  }] as any;

  const result = planDay([], jobs, learn, [], "medium", { remainingMinutes: 240 });
  assert.ok(result.plan.some((item) => item.candidate.source === "job"), "live role stays in the plan");
  assert.ok(result.plan.some((item) => item.candidate.source === "learn"), "capability-building stays in parallel");
});

test("brain can recommend a warm networking move as a first-class candidate", () => {
  const today = new Date().toISOString().slice(0, 10);
  const contacts = [
    contact({
      id: 1,
      who: "Hiring manager at Frontier Lab",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "referral",
      messageDraft: "Checking in on the role and asking for a quick steer.",
      nextFollowUpDate: today,
      targetRole: "AI strategy manager",
      targetOrg: "Frontier Lab",
    }),
  ];

  const result = recommend([], [], [], [], "medium", contacts);
  assert.equal(result.pick?.source, "contact");
  assert.equal(result.pick?.sourceId, 1);
  assert.ok(result.trace?.some((line: string) => /warm|referral|draft/i.test(line)));
  assert.match(result.explanation.summary, /networking move/i);
  assert.match(result.explanation.stopRule, /message/i);
});

test("brain prioritizes target-role insiders over broader alumni contacts", () => {
  const today = new Date().toISOString().slice(0, 10);
  const contacts = [
    contact({
      id: 10,
      who: "SIPA alum in policy",
      status: "to_contact",
      relationshipStrength: "cold",
      askType: "advice",
      sourceNetwork: "SIPA",
      why: "Can share a general perspective on policy careers",
      nextFollowUpDate: today,
    }),
    contact({
      id: 11,
      who: "Strategy manager at Frontier Lab",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "referral",
      targetOrg: "Frontier Lab",
      targetRole: "AI Strategy Associate",
      messageDraft: "Following up on the AI Strategy Associate role.",
      nextFollowUpDate: today,
    }),
  ];

  const result = recommend([], [], [], [], "medium", contacts);
  assert.equal(result.pick?.source, "contact");
  assert.equal(result.pick?.sourceId, 11);
  assert.ok(result.trace?.some((line: string) => /specific target role or org/i.test(line)));
});

test("brain prioritizes contacts tied to a live role over unrelated good contacts", () => {
  const today = new Date().toISOString().slice(0, 10);
  const jobs = [
    job({
      id: 21,
      title: "AI Strategy Associate",
      company: "GovAI",
      location: "Remote",
      fitScore: 76,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
    }),
  ];
  const contacts = [
    contact({
      id: 22,
      who: "Warm alum in policy",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "advice",
      sourceNetwork: "SIPA",
      messageDraft: "Would love your view on AI policy roles.",
      nextFollowUpDate: today,
    }),
    contact({
      id: 23,
      who: "Operator at GovAI",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "referral",
      targetOrg: "GovAI",
      targetRole: "AI Strategy Associate",
      messageDraft: "Following up on the AI Strategy Associate role at GovAI.",
      nextFollowUpDate: today,
    }),
  ];

  const result = recommend([], jobs, [], [], "medium", contacts);
  assert.equal(result.pick?.source, "contact");
  assert.equal(result.pick?.sourceId, 23);
  assert.ok(result.trace?.some((line: string) => /live role|target org/i.test(line)));
});

test("planner can keep job pursuit and networking in parallel when both are live", () => {
  const today = new Date().toISOString().slice(0, 10);
  const jobs = [
    job({
      id: 1,
      title: "AI Strategy Associate",
      company: "Frontier Lab",
      location: "Remote",
      fitScore: 74,
      warmPathScore: 65,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
    }),
  ];
  const contacts = [
    contact({
      id: 2,
      who: "Ally at Frontier Lab",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "referral",
      nextFollowUpDate: today,
      targetRole: "AI Strategy Associate",
      targetOrg: "Frontier Lab",
    }),
  ];

  const result = planDay([], jobs, [], [], "medium", { remainingMinutes: 240 }, contacts);
  assert.ok(result.plan.some((item) => item.candidate.source === "job"), "live role stays in the plan");
  assert.ok(result.plan.some((item) => item.candidate.source === "contact"), "networking stays in parallel");
});

test("planner ignores contacts with no actionable networking move", () => {
  const contacts = [
    contact({
      id: 3,
      who: "Vague person",
      status: "to_contact",
      relationshipStrength: "cold",
      askType: "",
      why: "",
      targetOrg: "",
      targetRole: "",
      messageDraft: "",
      nextFollowUpDate: "",
    }),
  ];

  const result = recommend([], [], [], [], "medium", contacts);
  assert.equal(result.pick, null);
});
