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

test("job recommendations use recruiting truth for warm-path roles", () => {
  const jobs = [
    job({
      id: 70,
      title: "AI Strategy Associate",
      company: "GovAI",
      location: "Remote",
      fitScore: 78,
      warmPathScore: 82,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
      sourceUrl: "https://example.com/job",
    }),
  ];

  const result = recommend([], jobs, [], [], "medium");
  assert.equal(result.pick?.source, "job");
  assert.equal(result.pick?.jobTruthAction, "warm");
  assert.match(result.pick?.title || "", /warm-path message|referral ask/i);
  assert.match(result.explanation.summary, /warm path/i);
  assert.match(result.explanation.firstStep, /warm-path message|referral ask/i);
});

test("job recommendations use recruiting truth for prove-fit roles", () => {
  const jobs = [
    job({
      id: 71,
      title: "AI Strategy Associate",
      company: "GovAI",
      location: "Remote",
      fitScore: 84,
      strategicValue: 80,
      warmPathScore: 20,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
      narrativeAngle: "",
      sourceUrl: "https://example.com/job",
    }),
  ];

  const result = recommend([], jobs, [], [], "medium");
  assert.equal(result.pick?.source, "job");
  assert.equal(result.pick?.jobTruthAction, "prove");
  assert.match(result.pick?.title || "", /capability signal/i);
  assert.match(result.explanation.summary, /capability evidence/i);
  assert.match(result.explanation.firstStep, /learning or proof asset|capability signal/i);
});

test("planner surfaces the still-empty broad-pursuit combinations when some lanes already have live roles", () => {
  const jobs = [
    job({
      id: 80,
      title: "AI Strategy Associate",
      company: "Frontier Lab",
      location: "Remote",
      roleArchetype: "strategy / advisory",
    }),
    job({
      id: 81,
      title: "AI Chief of Staff",
      company: "Model Lab",
      location: "Remote",
      roleArchetype: "chief of staff / operations",
    }),
  ];
  const tracks = [
    {
      id: 1,
      name: "AI strategy",
      slug: "ai-strategy",
      status: "active",
      targetRoleArchetype: "AI strategy / advisory",
      whyItFits: "Technology strategy and advisory fit",
      description: "Explore AI strategy roles in parallel with geopolitical lanes",
    },
    {
      id: 2,
      name: "Geopolitical advisory",
      slug: "geopolitical-advisory",
      status: "active",
      targetRoleArchetype: "geopolitical advisory",
      whyItFits: "Strong geopolitical and advisory fit",
      description: "Parallel geopolitical advisory lane",
    },
    {
      id: 3,
      name: "Strategy / chief of staff / operations",
      slug: "strategy-chief-of-staff-operations",
      status: "active",
      targetRoleArchetype: "chief of staff / operations",
      whyItFits: "Execution-heavy strategy and operating roles are also plausible",
      description: "Parallel operating lane",
    },
  ] as any;

  const result = planDay([], jobs as any, [], [], "medium", { remainingMinutes: 240 }, [], tracks);
  assert.equal(result.plan[0].candidate.source, "goal");
  assert.match(result.plan[0].candidate.title, /still-empty lane/i);
  assert.match(result.plan[0].candidate.sourceNote || "", /Geopolitics \/ geopolitical advisory/i);
  assert.match(result.note, /Broad pursuit is active/i);
  assert.match(result.plan[0].explanation.firstStep, /Open your job sources/i);
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
  assert.ok(result.plan.every((item) => item.explanation && item.explanation.summary && item.explanation.firstStep), "plan items carry structured explanations");
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
  assert.match(result.explanation.summary, /contact|network/i);
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
  assert.match(result.explanation.summary, /converting a live role/i);
  assert.match(result.explanation.firstStep, /advances the live role/i);
  assert.match(result.explanation.stopRule, /live-role message/i);
});

test("conversion posture prefers a direct referral ask over advice for the same live role", () => {
  const today = new Date().toISOString().slice(0, 10);
  const jobs = [
    job({
      id: 25,
      title: "AI Strategy Associate",
      company: "GovAI",
      location: "Remote",
      fitScore: 76,
      applicationReadiness: "questions",
      deadlineConfidence: "high",
    }),
  ];
  const contacts = [
    contact({
      id: 26,
      who: "Advisor at GovAI",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "advice",
      targetOrg: "GovAI",
      targetRole: "AI Strategy Associate",
      messageDraft: "Would love your view on positioning for the AI Strategy Associate role.",
      nextFollowUpDate: today,
    }),
    contact({
      id: 27,
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
  assert.equal(result.pick?.sourceId, 27);
  assert.ok(result.trace?.some((line: string) => /directly advances a live role/i.test(line)));
});

test("brain explains exploratory networking as market discovery when no live role exists", () => {
  const today = new Date().toISOString().slice(0, 10);
  const contacts = [
    contact({
      id: 24,
      who: "SIPA alum in policy",
      status: "to_contact",
      relationshipStrength: "cold",
      askType: "advice",
      sourceNetwork: "SIPA",
      why: "Can reality-check possible role families",
      nextFollowUpDate: today,
    }),
  ];

  const result = recommend([], [], [], [], "medium", contacts);
  assert.equal(result.pick?.source, "contact");
  assert.match(result.explanation.summary, /reducing role uncertainty/i);
  assert.match(result.explanation.firstStep, /market reality-check/i);
  assert.match(result.explanation.stopRule, /market signal/i);
});

test("exploration posture prefers advice over referral when the lane is still unclear", () => {
  const today = new Date().toISOString().slice(0, 10);
  const contacts = [
    contact({
      id: 28,
      who: "SIPA alum in policy",
      status: "to_contact",
      relationshipStrength: "cold",
      askType: "advice",
      sourceNetwork: "SIPA",
      why: "Can reality-check possible role families",
      nextFollowUpDate: today,
    }),
    contact({
      id: 29,
      who: "Another SIPA alum in policy",
      status: "to_contact",
      relationshipStrength: "cold",
      askType: "referral",
      sourceNetwork: "SIPA",
      why: "Could maybe help someday",
      nextFollowUpDate: today,
    }),
  ];

  const result = recommend([], [], [], [], "medium", contacts);
  assert.equal(result.pick?.source, "contact");
  assert.equal(result.pick?.sourceId, 28);
  assert.ok(result.trace?.some((line: string) => /right ask while narrowing lanes/i.test(line)));
});

test("fit-discovery keeps exploratory networking ahead of pure capability drills", () => {
  const today = new Date().toISOString().slice(0, 10);
  const contacts = [
    contact({
      id: 30,
      who: "SIPA alum in policy",
      status: "to_contact",
      relationshipStrength: "cold",
      askType: "advice",
      sourceNetwork: "SIPA",
      why: "Can reality-check possible role families",
      nextFollowUpDate: today,
    }),
  ];
  const learn = [{
    id: 31,
    title: "Policy memo drill",
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

  const result = recommend([], [], learn, [], "medium", contacts);
  assert.equal(result.pick?.source, "contact");
  assert.equal(result.pick?.sourceId, 30);
  assert.match(result.explanation.summary, /reducing role uncertainty/i);
});

test("track-linked reference learning does not surface as a strategic candidate by itself", () => {
  const learn = [{
    id: 35,
    title: "Read background paper",
    requiredOutput: "",
    active: false,
    proofIntent: false,
    done: false,
    learnStatus: "open",
    applicationDeadline: "",
    url: "",
    note: "",
    relatedTrackId: 7,
    outputEvidenceUrl: "",
  }] as any;

  const result = recommend([], [], learn, [], "medium");
  assert.equal(result.pick, null);
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
  const contactItem = result.plan.find((item) => item.candidate.source === "contact");
  assert.ok(contactItem, "contact move exists in the plan");
  assert.match(contactItem!.explanation.summary, /Network is why this slot exists/i);
});

test("planner balances applications, networking, and learning when the day has room", () => {
  const today = new Date().toISOString().slice(0, 10);
  const jobs = [
    job({
      id: 31,
      title: "AI Strategy Associate",
      company: "Frontier Lab",
      location: "Remote",
      fitScore: 78,
      warmPathScore: 70,
      applicationReadiness: "questions",
      deadlineConfidence: "high",
    }),
    job({
      id: 32,
      title: "Policy Analyst",
      company: "Policy House",
      location: "London",
      fitScore: 72,
      warmPathScore: 58,
      applicationReadiness: "cv",
      deadlineConfidence: "high",
    }),
  ];
  const contacts = [
    contact({
      id: 33,
      who: "Insider at Frontier Lab",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "referral",
      targetOrg: "Frontier Lab",
      targetRole: "AI Strategy Associate",
      nextFollowUpDate: today,
      messageDraft: "Following up on the AI Strategy Associate role.",
    }),
  ];
  const learn = [{
    id: 34,
    title: "AI governance memo practice",
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

  const result = planDay([], jobs, learn, [], "medium", { remainingMinutes: 240 }, contacts);
  const sources = new Set(result.plan.map((item) => item.candidate.source));
  assert.ok(sources.has("job"), "applications lane is present");
  assert.ok(sources.has("contact"), "network lane is present");
  assert.ok(sources.has("learn"), "learning lane is present");
  assert.equal(result.plan.length, 3);
});

test("conversion posture prefers applications and networking before extra learning on a two-slot day", () => {
  const today = new Date().toISOString().slice(0, 10);
  const jobs = [
    job({
      id: 41,
      title: "AI Strategy Associate",
      company: "Frontier Lab",
      location: "Remote",
      fitScore: 79,
      warmPathScore: 74,
      applicationReadiness: "questions",
      deadlineConfidence: "high",
    }),
  ];
  const contacts = [
    contact({
      id: 42,
      who: "Insider at Frontier Lab",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "referral",
      targetOrg: "Frontier Lab",
      targetRole: "AI Strategy Associate",
      nextFollowUpDate: today,
      messageDraft: "Following up on the AI Strategy Associate role.",
    }),
  ];
  const learn = [{
    id: 43,
    title: "AI governance memo practice",
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

  const result = planDay([], jobs, learn, [], "medium", { remainingMinutes: 120 }, contacts);
  const sources = new Set(result.plan.map((item) => item.candidate.source));
  assert.equal(result.plan.length, 2);
  assert.ok(sources.has("job"), "applications lane stays primary in conversion posture");
  assert.ok(sources.has("contact"), "network lane stays primary in conversion posture");
  assert.ok(!sources.has("learn"), "learning is deferred when only two conversion slots fit");
});

test("conversion posture keeps learning ahead of optional proof assets", () => {
  const jobs = [
    job({
      id: 44,
      title: "AI Strategy Associate",
      company: "Frontier Lab",
      location: "Remote",
      fitScore: 79,
      warmPathScore: 74,
      applicationReadiness: "questions",
      deadlineConfidence: "high",
    }),
  ];
  const learn = [{
    id: 45,
    title: "AI governance memo practice",
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
  const hustles = [
    {
      id: 46,
      title: "AI strategy memo series",
      nextStep: "Draft an outline",
      stage: "idea",
      note: "",
      coreClaim: "",
      firstPostIdea: "",
    },
  ] as any;

  const result = planDay([], jobs, learn, hustles, "medium", { remainingMinutes: 120 });
  const sources = new Set(result.plan.map((item) => item.candidate.source));
  assert.equal(result.plan.length, 2);
  assert.ok(sources.has("job"), "conversion work stays primary");
  assert.ok(sources.has("learn"), "learning remains the main capability move");
  assert.ok(!sources.has("hustle"), "optional proof asset stays secondary on a tight conversion day");
});

test("exploration posture keeps direction-finding, networking, and learning ahead of proof", () => {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = [
    task({ id: 51, title: "Inspect one role family and note useful attributes", category: "learning", size: "quick" }),
  ];
  const contacts = [
    contact({
      id: 52,
      who: "SIPA alum in policy",
      status: "to_contact",
      relationshipStrength: "cold",
      askType: "advice",
      sourceNetwork: "SIPA",
      why: "Can reality-check possible role families",
      nextFollowUpDate: today,
    }),
  ];
  const learn = [{
    id: 53,
    title: "Policy memo drill",
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
  const hustles = [
    { id: 54, title: "Proof asset", nextStep: "Draft an outline", stage: "testing", note: "" },
  ] as any;

  const result = planDay(tasks, [], learn, hustles, "medium", { remainingMinutes: 240 }, contacts);
  const sources = new Set(result.plan.map((item) => item.candidate.source));
  assert.ok(sources.has("task"), "direction-finding task stays in the plan");
  assert.ok(sources.has("contact"), "network signal stays in the plan");
  assert.ok(sources.has("learn"), "learning stays in the plan");
  assert.ok(!sources.has("hustle"), "proof is deferred behind exploration-supporting moves");
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

test("planner ignores a follow-up contact when the follow-up date is still in the future", () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const contacts = [
    contact({
      id: 4,
      who: "Warm operator",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "follow_up",
      messageDraft: "Checking back in on our last conversation.",
      nextFollowUpDate: future,
    }),
  ];

  const result = recommend([], [], [], [], "medium", contacts);
  assert.equal(result.pick, null);
});

test("future contact follow-ups do not trigger deadline mode on the day plan", () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const tasks = [
    task({ id: 61, title: "Inspect one role family", category: "learning", size: "quick" }),
  ];
  const contacts = [
    contact({
      id: 62,
      who: "Warm operator",
      status: "messaged",
      relationshipStrength: "warm",
      askType: "follow_up",
      messageDraft: "Checking back in on our last conversation.",
      nextFollowUpDate: future,
    }),
  ];

  const result = planDay(tasks, [], [], [], "medium", { remainingMinutes: 120 }, contacts);
  assert.notEqual(result.mode, "deadline");
  assert.equal(result.plan[0].candidate.source, "task");
});
