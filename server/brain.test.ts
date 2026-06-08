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
