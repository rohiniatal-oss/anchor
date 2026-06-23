import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;
const DAY = "2026-06-04";

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

async function makePlanWithItem(opts: Partial<{
  sourceType: string; sourceId: number | null; taskId: number | null;
  title: string; doneWhen: string; slot: string; sourceNote: string; sourceStatus: string;
}> = {}) {
  const plan = await h.storage.createPlan({ date: DAY, status: "active" } as any);
  const item = await h.storage.createPlanItem({
    planId: plan.id,
    sequence: 0,
    slot: opts.slot ?? "now",
    sourceType: opts.sourceType ?? "task",
    sourceId: opts.sourceId ?? 1,
    taskId: opts.taskId ?? null,
    title: opts.title ?? "Task",
    whySelected: "Because",
    doneWhen: opts.doneWhen ?? "Done",
    sourceNote: opts.sourceNote ?? "",
    sourceStatus: opts.sourceStatus ?? "",
    status: "planned",
    plannedFor: DAY,
    createdAt: Date.now(),
  } as any);
  return { plan, item };
}

test("plan-item start seeds a starter step when a deep plain task becomes active", async () => {
  const existing = await h.storage.createTask({
    title: "Draft long memo",
    list: "inbox",
    status: "not_started",
    size: "deep",
    steps: "[]",
  } as any);
  const { item } = await makePlanWithItem({ taskId: existing.id, slot: "now" });
  const r = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(r.status, 200);
  const steps = JSON.parse(r.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "started deep tasks should not stay blank");
  assert.match(String(steps[0]?.text || ""), /open|start|sentence|timer|doc|note/i);
});

test("brain accept uses source-aware task creation so job candidates start with real steps", async () => {
  const job = await h.storage.createJob({
    title: "Policy role",
    company: "Org",
    status: "wishlist",
    nextStep: "Draft cover",
    applicationReadiness: "cv",
  } as any);
  const accepted = await api(h.base, "POST", "/api/brain/accept", {
    candidate: {
      source: "job",
      sourceId: job.id,
      title: "Advance application: Policy role @ Org",
      category: "job",
      size: "deep",
      doneWhen: "Application moved one step forward",
      block: "morning",
    },
  });
  assert.equal(accepted.status, 200);
  const steps = JSON.parse(accepted.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "source-backed accepted tasks should start with steps");
  assert.match(String(steps[0]?.text || ""), /open|write|draft|list|highlight|match|rewrite|read|note/i);
});

test("plan-item start turns a broad-pursuit goal item into a concrete role-pipeline task", async () => {
  const { item } = await makePlanWithItem({
    sourceType: "goal",
    sourceId: 1,
    taskId: null,
    title: "Add or apply to one credible role in each plausible role type that still looks real",
    doneWhen: "One concrete role or application move exists in each active role type",
    slot: "now",
  });

  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(started.status, 200);
  assert.equal(started.json.task.category, "job");
  const steps = JSON.parse(started.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "goal-derived strategic tasks should get concrete steps");
  assert.match(String(steps[0]?.text || ""), /open jobs|save the first real role|saved role|pipeline action|find one real role|missing path|still missing one/i);
});

test("plan-item start keeps broad-pursuit contact-support goal items as admin/network tasks", async () => {
  const { item } = await makePlanWithItem({
    sourceType: "goal",
    sourceId: 2,
    taskId: null,
    title: "Find one person at Frontier Lab or Model Lab to ask how teams hire for AI / technology strategy x Strategy / advisory",
    doneWhen: "One real person is saved with why they are worth messaging and the one question you would ask about AI / technology strategy x Strategy / advisory.",
    slot: "now",
  });

  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(started.status, 200);
  assert.equal(started.json.task.category, "admin");
  const steps = JSON.parse(started.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "contact-support goal tasks should get concrete steps");
  assert.match(String(steps[0]?.text || ""), /linkedin|real person|reality-check/i);
});

test("plan-item start keeps broad-pursuit prep-support goal items as learning tasks", async () => {
  const { item } = await makePlanWithItem({
    sourceType: "goal",
    sourceId: 3,
    taskId: null,
    title: "Use AI Chief of Staff at Model Lab for Anchor's first prep suggestion for AI / technology strategy x Ops / chief of staff",
    doneWhen: "Anchor's suggested requirement and the smallest prep move are saved for AI / technology strategy x Ops / chief of staff.",
    sourceStatus: "broad_parallel_pursuit_learning_support",
    sourceNote: "Anchor's working diagnosis: Product & Delivery may be the weakest skill gap from AI Chief of Staff at Model Lab. Confirm or edit that diagnosis, then use this prep move: do one short drill.",
    slot: "now",
  });

  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(started.status, 200);
  assert.equal(started.json.task.category, "learning");
  assert.equal(started.json.task.sourceStatus, "broad_parallel_pursuit_learning_support");
  assert.match(String(started.json.task.sourceNote || ""), /Product & Delivery|reference role|skill gap|matching prep move/i);
  const steps = JSON.parse(started.json.task.steps || "[]");
  assert.ok(steps.length >= 1, "prep-support goal tasks should get concrete steps");
  assert.match(String(steps[0]?.text || ""), /AI Chief of Staff at Model Lab|open one live role|saved role note|jd/i);
});

test("broad-pursuit adaptive plan names missing paths when some lanes already have live roles", async () => {
  await h.storage.createCareerTrack({
    name: "AI strategy",
    slug: "ai-strategy",
    status: "active",
    targetRoleArchetype: "AI strategy / advisory",
    whyItFits: "Technology strategy and advisory fit",
    description: "Explore AI strategy roles in parallel with geopolitical lanes",
  } as any);
  await h.storage.createCareerTrack({
    name: "Geopolitical advisory",
    slug: "geopolitical-advisory",
    status: "active",
    targetRoleArchetype: "geopolitical advisory",
    whyItFits: "Strong geopolitical and advisory fit",
    description: "Parallel geopolitical advisory lane",
  } as any);
  await h.storage.createCareerTrack({
    name: "Strategy / chief of staff / operations",
    slug: "strategy-chief-of-staff-operations",
    status: "active",
    targetRoleArchetype: "chief of staff / operations",
    whyItFits: "Execution-heavy strategy and operating roles are also plausible",
    description: "Parallel operating lane",
  } as any);

  await h.storage.createJob({
    title: "AI Strategy Associate",
    company: "Frontier Lab",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "Remote",
    roleArchetype: "strategy / advisory",
  } as any);
  await h.storage.createJob({
    title: "AI Chief of Staff",
    company: "Model Lab",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "Remote",
    roleArchetype: "chief of staff / operations",
  } as any);

  const recompute = await api(h.base, "POST", "/api/plan/recompute", { day: DAY, energy: "medium" });
  assert.equal(recompute.status, 200);
  const current = await api(h.base, "GET", `/api/plan/current?day=${DAY}`);
  assert.equal(current.status, 200);
  assert.match(current.json.plan.note, /missing path/i);
  assert.match(current.json.plan.note, /Geopolitics/i);
  assert.match(current.json.items[0].title, /missing path|real .*posting/i);
  assert.match(current.json.items[0].doneWhen, /posting is saved with enough JD text/i);
});

test("plan recompute preserves goal-source planner metadata on broad-pursuit support items", async () => {
  await h.storage.createCareerTrack({
    name: "AI strategy",
    slug: "ai-strategy",
    status: "active",
    targetRoleArchetype: "AI strategy / advisory",
    whyItFits: "Technology strategy and advisory fit",
    description: "Explore AI strategy roles in parallel",
  } as any);
  await h.storage.createCareerTrack({
    name: "AI operations",
    slug: "ai-operations",
    status: "active",
    targetRoleArchetype: "chief of staff / operations",
    whyItFits: "Operating roles are plausible",
    description: "Parallel operating lane",
  } as any);
  await h.storage.createCareerTrack({
    name: "Geopolitical advisory",
    slug: "geopolitical-advisory",
    status: "active",
    targetRoleArchetype: "geopolitical advisory",
    whyItFits: "Strong geopolitical and advisory fit",
    description: "Parallel geopolitical advisory lane",
  } as any);
  await h.storage.createCareerTrack({
    name: "Geopolitics operations",
    slug: "geopolitics-operations",
    status: "active",
    targetRoleArchetype: "geopolitics chief of staff operations",
    whyItFits: "Geopolitical operating roles are plausible",
    description: "Parallel geopolitical operating lane",
  } as any);

  await h.storage.createJob({
    title: "AI Strategy Associate",
    company: "Frontier Lab",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "Remote",
    roleArchetype: "strategy / advisory",
    relatedTrackId: 1,
  } as any);
  await h.storage.createJob({
    title: "AI Chief of Staff",
    company: "Model Lab",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "Remote",
    roleArchetype: "chief of staff / operations",
    relatedTrackId: 2,
  } as any);
  await h.storage.createJob({
    title: "Geopolitical Advisory Associate",
    company: "Risk Desk",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "Remote",
    roleArchetype: "strategy / advisory",
    relatedTrackId: 3,
  } as any);
  await h.storage.createJob({
    title: "Geopolitics Chief of Staff",
    company: "Policy Lab",
    status: "wishlist",
    applicationWindowStatus: "open",
    location: "Remote",
    roleArchetype: "chief of staff / operations",
    relatedTrackId: 4,
  } as any);
  await h.storage.createContact({
    name: "AI strategy operator",
    who: "AI strategy operator",
    status: "to_contact",
    relationshipStrength: "warm",
    askType: "advice",
    relatedTrackId: 1,
  } as any);
  await h.storage.createContact({
    name: "Chief of staff operator",
    who: "Chief of staff operator",
    status: "to_contact",
    relationshipStrength: "warm",
    askType: "advice",
    relatedTrackId: 2,
  } as any);
  await h.storage.createContact({
    name: "Geopolitical advisory operator",
    who: "Geopolitical advisory operator",
    status: "to_contact",
    relationshipStrength: "warm",
    askType: "advice",
    relatedTrackId: 3,
  } as any);
  await h.storage.createContact({
    name: "Geopolitics chief of staff operator",
    who: "Geopolitics chief of staff operator",
    status: "to_contact",
    relationshipStrength: "warm",
    askType: "advice",
    relatedTrackId: 4,
  } as any);

  const recompute = await api(h.base, "POST", "/api/plan/recompute", { day: DAY, energy: "medium" });
  assert.equal(recompute.status, 200);
  const current = await api(h.base, "GET", `/api/plan/current?day=${DAY}`);
  assert.equal(current.status, 200);

  const learningSupport = current.json.items.find((item: any) => item.sourceStatus === "broad_parallel_pursuit_learning_support");
  assert.ok(learningSupport, "expected a persisted learning-support goal item");
  assert.match(String(learningSupport.sourceNote || ""), /Anchor's working diagnosis|prep move|real role/i);
  assert.equal(learningSupport.sourceType, "goal");
});
