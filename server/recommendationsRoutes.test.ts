import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test("recommendation detail and accept preserve a broad learning theme as a durable learn item", async () => {
  const track = await h.storage.createCareerTrack({
    name: "AI strategy",
    slug: "ai-strategy",
    description: "",
    targetRoleArchetype: "ai-strategy",
    priority: 80,
    status: "active",
    whyItFits: "",
  } as any);

  const created = await api(h.base, "POST", "/api/recommendations", {
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "saved",
    source: "llm",
    title: "AI governance foundations",
    whySuggested: "This would tighten your AI strategy baseline.",
    linkedTrackId: track.id,
    executionShape: "ongoing-program",
    acceptanceDraft: JSON.stringify({
      capabilityBuilt: "AI governance",
      note: "Accepted from the learning corpus.",
    }),
  });
  assert.equal(created.status, 200);

  const recommendationId = created.json.id;
  await api(h.base, "POST", `/api/recommendations/${recommendationId}/subdivisions`, {
    subdivisionKey: "model-governance",
    label: "Model governance",
    whyItMatters: "Core policy lever",
    suggestedMaterials: JSON.stringify(["OECD overview"]),
    sequence: 0,
  });
  await api(h.base, "POST", `/api/recommendations/${recommendationId}/subdivisions`, {
    subdivisionKey: "eu-ai-act",
    label: "EU AI Act",
    whyItMatters: "Regulatory fluency",
    suggestedMaterials: JSON.stringify(["Commission explainer"]),
    sequence: 1,
  });
  await api(h.base, "POST", `/api/recommendations/${recommendationId}/milestones`, {
    milestoneKey: "skim",
    label: "Skim the landscape",
    doneWhen: "You can explain the major buckets",
    status: "todo",
    sequence: 0,
    suggestedTaskTitle: "Skim AI governance landscape",
    subdivisionKey: "model-governance",
  });
  await api(h.base, "POST", `/api/recommendations/${recommendationId}/milestones`, {
    milestoneKey: "compare",
    label: "Compare regimes",
    doneWhen: "You can contrast two approaches",
    status: "todo",
    sequence: 1,
    suggestedTaskTitle: "Compare two AI governance approaches",
    subdivisionKey: "eu-ai-act",
  });

  const detail = await api(h.base, "GET", `/api/recommendations/${recommendationId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.subdivisions.length, 2);
  assert.equal(detail.json.milestones.length, 2);

  const accepted = await api(h.base, "POST", `/api/recommendations/${recommendationId}/accept`, {
    entityType: "learn",
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.entityType, "learn");
  assert.equal(accepted.json.created.title, "AI governance foundations");
  assert.equal(accepted.json.created.relatedTrackId, track.id);
  assert.equal(accepted.json.created.sourceType, "recommendation");
  assert.equal(accepted.json.created.sourceId, recommendationId);
  assert.match(String(accepted.json.created.note || ""), /2 subtopics, 2 checkpoints/i);

  const nextTask = await api(h.base, "POST", `/api/learn/${accepted.json.created.id}/create-next-task`, {});
  assert.equal(nextTask.status, 200);
  assert.equal(nextTask.json.title, "Skim AI governance landscape");
  assert.equal(nextTask.json.doneWhen, "You can explain the major buckets");
  assert.equal(nextTask.json.sourceType, "learn");
  assert.equal(nextTask.json.sourceId, accepted.json.created.id);
  assert.equal(nextTask.json.sourceStepType, "recommendation_milestone");
  assert.equal(nextTask.json.sourceStepId, detail.json.milestones[0].id);

  const savedRecommendation = await h.storage.getRecommendation(recommendationId);
  assert.equal(savedRecommendation?.status, "accepted");
  assert.equal(savedRecommendation?.acceptanceEntityType, "learn");
});

test("recommendation accept infers a contact when the inventory item is a network target", async () => {
  const created = await api(h.base, "POST", "/api/recommendations", {
    collection: "network-targets",
    kind: "contact-person-type",
    status: "saved",
    source: "llm",
    title: "AI policy alumni in think tanks",
    whySuggested: "Warm-ish people who may clarify hiring patterns.",
    acceptanceDraft: JSON.stringify({
      sector: "AI policy",
      askType: "advice",
    }),
  });
  assert.equal(created.status, 200);

  const accepted = await api(h.base, "POST", `/api/recommendations/${created.json.id}/accept`, {});
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.entityType, "contact");
  assert.equal(accepted.json.created.who, "AI policy alumni in think tanks");
  assert.equal(accepted.json.created.status, "to_contact");
});

test("recommendation milestones keep a single active checkpoint and auto-advance", async () => {
  const created = await api(h.base, "POST", "/api/recommendations", {
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "saved",
    source: "manual",
    title: "AI policy foundations",
    whySuggested: "A structured theme with multiple checkpoints.",
    executionShape: "ongoing-program",
  });
  assert.equal(created.status, 200);

  const first = await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "scan",
    label: "Scan the landscape",
    doneWhen: "You can name the main pieces",
    status: "todo",
    sequence: 0,
    suggestedTaskTitle: "Scan AI policy landscape",
    subdivisionKey: "",
  });
  const second = await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "compare",
    label: "Compare two approaches",
    doneWhen: "You can explain one real tradeoff",
    status: "todo",
    sequence: 1,
    suggestedTaskTitle: "Compare two AI policy approaches",
    subdivisionKey: "",
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.json.status, "active");
  assert.equal(second.json.status, "todo");

  const makeSecondActive = await api(h.base, "PATCH", `/api/recommendation-milestones/${second.json.id}`, {
    status: "active",
  });
  assert.equal(makeSecondActive.status, 200);
  assert.equal(makeSecondActive.json.status, "active");

  const afterActive = await api(h.base, "GET", `/api/recommendations/${created.json.id}/milestones`);
  assert.equal(afterActive.status, 200);
  assert.equal(afterActive.json[0].status, "todo");
  assert.equal(afterActive.json[1].status, "active");

  const markDone = await api(h.base, "PATCH", `/api/recommendation-milestones/${second.json.id}`, {
    status: "done",
  });
  assert.equal(markDone.status, 200);
  assert.equal(markDone.json.status, "done");
  assert.ok(markDone.json.completedAt);

  const afterDone = await api(h.base, "GET", `/api/recommendations/${created.json.id}/milestones`);
  assert.equal(afterDone.status, 200);
  assert.equal(afterDone.json[0].status, "active");
  assert.equal(afterDone.json[1].status, "done");
});

test("completing a learn task advances the linked recommendation checkpoint", async () => {
  const created = await api(h.base, "POST", "/api/recommendations", {
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "saved",
    source: "manual",
    title: "AI strategy foundations",
    whySuggested: "A learning theme that should stay in sync with tasks.",
    executionShape: "ongoing-program",
    acceptanceDraft: JSON.stringify({
      capabilityBuilt: "AI strategy",
      note: "Accepted from structured theme.",
    }),
  });
  assert.equal(created.status, 200);

  await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "scan",
    label: "Scan the field",
    doneWhen: "You can explain the main players",
    status: "todo",
    sequence: 0,
    suggestedTaskTitle: "Scan AI strategy field",
    subdivisionKey: "",
  });
  await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "compare",
    label: "Compare two role shapes",
    doneWhen: "You can explain one meaningful difference",
    status: "todo",
    sequence: 1,
    suggestedTaskTitle: "Compare two AI strategy role shapes",
    subdivisionKey: "",
  });

  const accepted = await api(h.base, "POST", `/api/recommendations/${created.json.id}/accept`, {
    entityType: "learn",
  });
  assert.equal(accepted.status, 200);

  const task = await api(h.base, "POST", `/api/learn/${accepted.json.created.id}/create-next-task`, {});
  assert.equal(task.status, 200);
  assert.equal(task.json.title, "Scan AI strategy field");
  assert.equal(task.json.sourceStepType, "recommendation_milestone");
  assert.ok(task.json.sourceStepId);

  const completed = await api(h.base, "POST", `/api/tasks/${task.json.id}/complete`, {});
  assert.equal(completed.status, 200);

  const milestones = await api(h.base, "GET", `/api/recommendations/${created.json.id}/milestones`);
  assert.equal(milestones.status, 200);
  assert.equal(milestones.json[0].status, "done");
  assert.ok(milestones.json[0].completedAt);
  assert.equal(milestones.json[1].status, "active");
});

test("blocking and parking a learn task syncs blocked and active milestone state", async () => {
  const created = await api(h.base, "POST", "/api/recommendations", {
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "saved",
    source: "manual",
    title: "AI governance drills",
    whySuggested: "A theme that should reflect task block and park state.",
    executionShape: "ongoing-program",
    acceptanceDraft: JSON.stringify({
      capabilityBuilt: "AI governance",
      note: "Accepted from structured theme.",
    }),
  });
  assert.equal(created.status, 200);

  await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "scan",
    label: "Scan one current source",
    doneWhen: "You can explain the current source clearly",
    status: "todo",
    sequence: 0,
    suggestedTaskTitle: "Scan one current AI governance source",
    subdivisionKey: "",
  });
  await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "compare",
    label: "Compare one tradeoff",
    doneWhen: "You can explain one tradeoff",
    status: "todo",
    sequence: 1,
    suggestedTaskTitle: "Compare one AI governance tradeoff",
    subdivisionKey: "",
  });

  const accepted = await api(h.base, "POST", `/api/recommendations/${created.json.id}/accept`, {
    entityType: "learn",
  });
  assert.equal(accepted.status, 200);

  const task = await api(h.base, "POST", `/api/learn/${accepted.json.created.id}/create-next-task`, {});
  assert.equal(task.status, 200);
  assert.equal(task.json.sourceStepType, "recommendation_milestone");
  const milestoneId = task.json.sourceStepId;
  assert.ok(milestoneId);

  const blocked = await api(h.base, "POST", `/api/tasks/${task.json.id}/block`, {
    reason: "Need a better source first",
  });
  assert.equal(blocked.status, 200);

  const afterBlock = await api(h.base, "GET", `/api/recommendations/${created.json.id}/milestones`);
  assert.equal(afterBlock.status, 200);
  assert.equal(afterBlock.json[0].id, milestoneId);
  assert.equal(afterBlock.json[0].status, "blocked");
  assert.equal(afterBlock.json[1].status, "todo");

  const parked = await api(h.base, "POST", `/api/tasks/${task.json.id}/park`, {});
  assert.equal(parked.status, 200);

  const afterPark = await api(h.base, "GET", `/api/recommendations/${created.json.id}/milestones`);
  assert.equal(afterPark.status, 200);
  assert.equal(afterPark.json[0].id, milestoneId);
  assert.equal(afterPark.json[0].status, "active");
  assert.equal(afterPark.json[1].status, "todo");
});

test("marking a milestone done directly closes its linked open task and plan item", async () => {
  const day = "2026-06-16";
  const created = await api(h.base, "POST", "/api/recommendations", {
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "saved",
    source: "manual",
    title: "AI strategy foundations",
    whySuggested: "A theme that should keep Learn and Today in sync.",
    executionShape: "ongoing-program",
    acceptanceDraft: JSON.stringify({
      capabilityBuilt: "AI strategy",
      note: "Accepted from structured theme.",
    }),
  });
  assert.equal(created.status, 200);

  const milestone = await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "scan",
    label: "Scan the field",
    doneWhen: "You can explain the main players",
    status: "todo",
    sequence: 0,
    suggestedTaskTitle: "Scan AI strategy field",
    subdivisionKey: "",
  });
  assert.equal(milestone.status, 200);

  const accepted = await api(h.base, "POST", `/api/recommendations/${created.json.id}/accept`, {
    entityType: "learn",
  });
  assert.equal(accepted.status, 200);

  const task = await api(h.base, "POST", `/api/learn/${accepted.json.created.id}/create-next-task`, {});
  assert.equal(task.status, 200);
  assert.equal(task.json.sourceStepType, "recommendation_milestone");
  assert.equal(task.json.sourceStepId, milestone.json.id);

  const plan = await h.storage.createPlan({ date: day, status: "active" } as any);
  const planItem = await h.storage.createPlanItem({
    planId: plan.id,
    sequence: 0,
    slot: "now",
    sourceType: "learn",
    sourceId: accepted.json.created.id,
    taskId: task.json.id,
    title: task.json.title,
    whySelected: "This is the current learning checkpoint",
    doneWhen: task.json.doneWhen,
    status: "started",
    plannedFor: day,
  } as any);
  await h.storage.updatePlan(plan.id, { minimumViableItemId: planItem.id } as any);
  await h.storage.updateTask(task.json.id, { planItemId: planItem.id, status: "in_progress", list: "today" } as any);

  const markedDone = await api(h.base, "PATCH", `/api/recommendation-milestones/${milestone.json.id}`, {
    status: "done",
  });
  assert.equal(markedDone.status, 200);
  assert.equal(markedDone.json.status, "done");

  const updatedTask = (await h.storage.getTasks()).find((item) => item.id === task.json.id)!;
  assert.equal(updatedTask.done, true);
  assert.equal(updatedTask.status, "done");
  assert.equal(updatedTask.pinned, false);

  const updatedPlanItem = await h.storage.getPlanItem(planItem.id);
  assert.equal(updatedPlanItem?.status, "completed");
  assert.ok(updatedPlanItem?.completedAt);
  const updatedPlan = await h.storage.getPlan(plan.id);
  assert.equal(updatedPlan?.enoughForToday, true);

  const wins = await h.storage.getWins();
  assert.equal(wins.length, 1);
  assert.equal(wins[0].text, task.json.title);

  const activity = await h.storage.getActivityLog();
  assert.ok(activity.some((entry) =>
    entry.eventType === "completed"
    && entry.taskId === task.json.id
    && entry.planItemId === planItem.id,
  ));
});

test("synthesis helper routes return fallback text with an error marker when the model is unavailable", async () => {
  const created = await api(h.base, "POST", "/api/recommendations", {
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "saved",
    source: "manual",
    title: "AI governance foundations",
    whySuggested: "Structured prep theme.",
    executionShape: "ongoing-program",
  });
  assert.equal(created.status, 200);

  const milestone = await api(h.base, "POST", `/api/recommendations/${created.json.id}/milestones`, {
    milestoneKey: "synth",
    label: "Make sense of what you learned",
    doneWhen: "You can explain the most useful insight clearly",
    status: "todo",
    sequence: 0,
    suggestedTaskTitle: "Write three bullets on what matters most",
    subdivisionKey: "",
    milestoneType: "synthesis",
    scaffolding: "What changed your view? | What still feels fuzzy?",
  });
  assert.equal(milestone.status, 200);

  const starter = await api(h.base, "POST", `/api/recommendation-milestones/${milestone.json.id}/synthesis-starter`, {});
  assert.equal(starter.status, 200);
  assert.ok(String(starter.json.draft || "").trim().length > 0);
  assert.match(String(starter.json.error || ""), /AI helper unavailable/i);

  const critique = await api(h.base, "POST", `/api/recommendation-milestones/${milestone.json.id}/critique`, {
    draft: starter.json.draft,
  });
  assert.equal(critique.status, 200);
  assert.ok(String(critique.json.critique || "").trim().length > 0);
  assert.match(String(critique.json.error || ""), /AI helper unavailable/i);
});

test("saving a job keeps the role lightweight and does not auto-create a learn prep arc", async () => {
  const track = await h.storage.createCareerTrack({
    name: "AI strategy",
    slug: "ai-strategy-job-arc",
    description: "",
    targetRoleArchetype: "ai-strategy",
    priority: 80,
    status: "active",
    whyItFits: "",
  } as any);

  const created = await api(h.base, "POST", "/api/jobs", {
    title: "AI Strategy Lead",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: track.id,
  });
  assert.equal(created.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const recs = await h.storage.getRecommendations();
  const learns = await h.storage.getLearn();
  assert.equal(recs.some((item) => item.linkedGapKey === `job-prep-${created.json.id}`), false);
  assert.equal(learns.some((item) => item.title === "Prep: AI Strategy Lead at Acme"), false);
});

test("adding a JD to a saved job still keeps the role lightweight until the process is live", async () => {
  const track = await h.storage.createCareerTrack({
    name: "AI strategy",
    slug: "ai-strategy-job-jd",
    description: "",
    targetRoleArchetype: "ai-strategy",
    priority: 80,
    status: "active",
    whyItFits: "",
  } as any);

  const created = await api(h.base, "POST", "/api/jobs", {
    title: "AI Strategy Lead",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: track.id,
  });
  assert.equal(created.status, 200);

  const updated = await api(h.base, "PATCH", `/api/jobs/${created.json.id}`, {
    jdText: "Lead the AI strategy agenda across product, operations, and external partnerships. Build trusted executive narratives, shape cross-functional priorities, and drive interview loops with senior stakeholders.",
  });
  assert.equal(updated.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const recs = await h.storage.getRecommendations();
  const learns = await h.storage.getLearn();
  assert.equal(recs.some((item) => item.linkedGapKey === `job-prep-${created.json.id}`), false);
  assert.equal(learns.some((item) => item.title === "Application learning: AI Strategy Lead at Acme"), false);
});

test("moving a job into interviewing creates a role-specific prep arc", async () => {
  const track = await h.storage.createCareerTrack({
    name: "AI strategy",
    slug: "ai-strategy-job-interviewing",
    description: "",
    targetRoleArchetype: "ai-strategy",
    priority: 80,
    status: "active",
    whyItFits: "",
  } as any);

  const created = await api(h.base, "POST", "/api/jobs", {
    title: "AI Strategy Lead",
    company: "Acme",
    status: "wishlist",
    relatedTrackId: track.id,
    jdText: "Lead the AI strategy agenda across product, operations, and external partnerships. Build trusted executive narratives, shape cross-functional priorities, and drive interview loops with senior stakeholders.",
  });
  assert.equal(created.status, 200);

  const moved = await api(h.base, "PATCH", `/api/jobs/${created.json.id}`, {
    status: "interviewing",
  });
  assert.equal(moved.status, 200);

  const rec = await waitFor("job prep recommendation", async () => {
    const recs = await h.storage.getRecommendations();
    return recs.find((item) => item.linkedGapKey === `job-prep-${created.json.id}`) || null;
  });
  assert.equal(rec.collection, "job-prep-arc");
  assert.equal(rec.kind, "job-prep");
  assert.equal(rec.status, "accepted");

  const learn = await waitFor("job prep learn item", async () => {
    const learns = await h.storage.getLearn();
    return learns.find((item) => item.sourceType === "recommendation" && item.sourceId === rec.id) || null;
  });
  assert.equal(learn.title, "Application learning: AI Strategy Lead at Acme");
  assert.equal(learn.learnStatus, "active");
  assert.equal(learn.active, true);
});

test("accepting a job recommendation creates the role without auto-creating a learn prep arc", async () => {
  const track = await h.storage.createCareerTrack({
    name: "AI strategy",
    slug: "ai-strategy-job-rec",
    description: "",
    targetRoleArchetype: "ai-strategy",
    priority: 80,
    status: "active",
    whyItFits: "",
  } as any);

  const rec = await api(h.base, "POST", "/api/recommendations", {
    collection: "role-opportunities",
    kind: "job-opportunity",
    status: "saved",
    source: "llm",
    title: "AI Strategy Lead",
    whySuggested: "Strong fit.",
    linkedTrackId: track.id,
    sourceUrl: "https://example.com/job",
    acceptanceDraft: JSON.stringify({
      company: "Acme",
      roleArchetype: "ai-strategy",
      nextStep: "Review fit and decide whether to pursue",
    }),
  });
  assert.equal(rec.status, 200);

  const accepted = await api(h.base, "POST", `/api/recommendations/${rec.json.id}/accept`, {
    entityType: "job",
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.entityType, "job");
  assert.equal(accepted.json.created.title, "AI Strategy Lead");

  await new Promise((resolve) => setTimeout(resolve, 100));
  const recs = await h.storage.getRecommendations();
  const learns = await h.storage.getLearn();
  assert.equal(recs.some((item) => item.linkedGapKey === `job-prep-${accepted.json.created.id}`), false);
  assert.equal(learns.some((item) => item.title === "Prep: AI Strategy Lead at Acme"), false);
});

test("saving a hustle auto-creates an accepted execution arc and linked learn item", async () => {
  const created = await api(h.base, "POST", "/api/hustles", {
    title: "AI policy Substack",
    note: "Weekly essay idea",
    coreClaim: "The policy conversation is too abstract",
    contentPillar: "AI policy",
    stage: "idea",
  });
  assert.equal(created.status, 200);

  const rec = await waitFor("hustle arc recommendation", async () => {
    const recs = await h.storage.getRecommendations();
    return recs.find((item) => item.linkedGapKey === `hustle-arc-${created.json.id}`) || null;
  });
  assert.equal(rec.collection, "hustle-arc");
  assert.equal(rec.kind, "hustle-arc");
  assert.equal(rec.status, "accepted");
  assert.equal(rec.executionShape, "milestone-arc");
  assert.equal(rec.acceptanceEntityType, "learn");

  const learn = await waitFor("hustle arc learn item", async () => {
    const learns = await h.storage.getLearn();
    return learns.find((item) => item.sourceType === "recommendation" && item.sourceId === rec.id) || null;
  });
  assert.equal(learn.title, "Build: AI policy Substack");
  assert.equal(learn.learnStatus, "active");
  assert.equal(learn.active, true);
});
