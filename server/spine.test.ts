// ─────────────────────────────────────────────────────────────────────────
// SPINE TESTS (P4.6a #8) — the execution-integrity contract:
// PLAN ITEM → TASK → COMPLETION → SOURCE UPDATE → WIN/ACTIVITY → EVIDENCE.
// Run with `npm test` (node:test via tsx). Each test resets the shared DB.
// ─────────────────────────────────────────────────────────────────────────
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";
import { isSubmitStep } from "@shared/jobTemplates";
import { isFellowshipOpportunity } from "@shared/fellowshipLane";
import { isOpportunityActionable, getLearnOutputState, learnNeedsOutputNudge } from "@shared/domainState";
import { requiredDomainsForTrack } from "@shared/capabilityTargets";

let h: Harness;
const DAY = "2026-06-02";
// Imported dynamically AFTER the harness sets ANCHOR_DB_PATH — a static import
// would pull in ./storage (which opens its db handle at module load) before the
// harness points it at the throwaway DB. learningStrategy/evidence transitively
// import ./storage, so they MUST be loaded dynamically here for the same reason.
let migrateFellowshipLearnRows: typeof import("./fellowshipMigration").migrateFellowshipLearnRows;
let computeLearningGaps: typeof import("./learningStrategy").computeLearningGaps;
let computeEvidence: typeof import("./evidence").computeEvidence;

before(async () => {
  h = await makeHarness();
  ({ migrateFellowshipLearnRows } = await import("./fellowshipMigration"));
  ({ computeLearningGaps } = await import("./learningStrategy"));
  ({ computeEvidence } = await import("./evidence"));
});
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

// helper: a plan + one item, returning ids
async function makePlanWithItem(opts: Partial<{
  sourceType: string; sourceId: number | null; taskId: number | null;
  title: string; doneWhen: string; slot: string; isMvd: boolean;
}> = {}) {
  const plan = await h.storage.createPlan({ date: DAY, status: "active" } as any);
  const item = await h.storage.createPlanItem({
    planId: plan.id, sequence: 0, slot: opts.slot ?? "now",
    sourceType: opts.sourceType ?? "task", sourceId: opts.sourceId ?? null,
    taskId: opts.taskId ?? null, title: opts.title ?? "Do the thing",
    whySelected: "because", doneWhen: opts.doneWhen ?? "", status: "planned",
    plannedFor: DAY,
  } as any);
  if (opts.isMvd) await h.storage.updatePlan(plan.id, { minimumViableItemId: item.id } as any);
  return { plan, item };
}

// 1) PLAN-ITEM START — creates/links a backing task, pins it, preserves identity,
//    derives block from slot, writes the both-way link, marks the item started.
test("plan-item start creates a backing task and writes the both-way link", async () => {
  const { item } = await makePlanWithItem({ slot: "next", title: "Free-text item", doneWhen: "it's drafted" });
  const r = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(r.status, 200);
  const task = r.json.task;
  assert.ok(task && task.id, "a task is returned");
  assert.equal(task.planItemId, item.id, "task links back to the plan item");
  assert.equal(task.pinned, true, "task is pinned as Right Now");
  assert.equal(task.list, "today");
  assert.equal(task.status, "in_progress");
  assert.equal(task.block, "afternoon", "block derived from slot 'next', not hardcoded morning");
  assert.equal(task.doneWhen, "it's drafted", "doneWhen preserved from the plan item");

  const refreshed = await h.storage.getPlanItem(item.id);
  assert.equal(refreshed!.taskId, task.id, "plan item points at the task");
  assert.equal(refreshed!.status, "started");
  assert.ok(refreshed!.startedAt, "startedAt stamped");
});

test("plan-item start reuses the existing taskId instead of duplicating", async () => {
  const existing = await h.storage.createTask({ title: "Already backing", list: "inbox", status: "not_started" } as any);
  const { item } = await makePlanWithItem({ taskId: existing.id, slot: "now" });
  const r = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(r.json.task.id, existing.id, "the same task is reused");
  assert.equal((await h.storage.getTasks()).length, 1, "no duplicate task created");
});

// 2) COMPLETION SYNC — completing the backing task flips the plan item to
//    completed via the EXPLICIT planItemId link (works for any source type),
//    logs a completed activity, and records a win.
test("completing a started task flips its plan item to completed (id-link)", async () => {
  const { item } = await makePlanWithItem({ title: "Ship it" });
  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  const taskId = started.json.task.id;

  const c = await api(h.base, "POST", `/api/tasks/${taskId}/complete`, { day: DAY });
  assert.equal(c.status, 200);

  const pi = await h.storage.getPlanItem(item.id);
  assert.equal(pi!.status, "completed", "plan item marked completed");
  assert.ok(pi!.completedAt, "completedAt stamped");

  const wins = await h.storage.getWins();
  assert.equal(wins.length, 1, "a win was recorded");
  const acts = await h.storage.getActivityLog();
  assert.ok(acts.some((a) => a.eventType === "completed" && a.planItemId === item.id), "completed activity carries planItemId");
});

// MVD / done-enough — completing the day's minimum-viable item marks the plan
// done_enough off the same completion link.
// Skip sync â€” skipping a task must feed the persisted day-plan memory so
// avoidance shows up in both plan-item state and activity evidence.
test("skipping a started task marks its plan item skipped and logs the avoidance", async () => {
  const { item } = await makePlanWithItem({ title: "Avoided thing" });
  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  const taskId = started.json.task.id;

  const skipped = await api(h.base, "POST", `/api/tasks/${taskId}/skip`, { day: DAY });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.json.pinned, false, "skipped task is no longer pinned as the current task");
  assert.equal(skipped.json.status, "not_started", "skipping resets the task out of active execution state");

  const pi = await h.storage.getPlanItem(item.id);
  assert.equal(pi!.status, "skipped", "plan item marked skipped");
  assert.ok(pi!.skippedAt, "skippedAt stamped");

  const acts = await h.storage.getActivityLog();
  assert.ok(acts.some((a) => a.eventType === "skipped" && a.planItemId === item.id), "skip activity carries planItemId");
});

// MVD / done-enough â€” completing the day's minimum-viable item marks the plan
// done_enough off the same completion link.
test("completing the MVD item marks the day done_enough", async () => {
  const { plan, item } = await makePlanWithItem({ title: "The one must-do", isMvd: true });
  const started = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  await api(h.base, "POST", `/api/tasks/${started.json.task.id}/complete`, { day: DAY });

  const refreshed = await h.storage.getPlanByDate(DAY);
  assert.equal(refreshed!.enoughForToday, true, "enoughForToday set");
  assert.equal(refreshed!.status, "done_enough");
});

// 3) SAFER JOB STATUS — a wishlist job advances to applied ONLY via the submit
//    pipeline step or the explicit button. A generic job-linked task completion
//    must NEVER change job status (it only logs activity).
test("isSubmitStep distinguishes the submit step from follow-up/others", () => {
  assert.equal(isSubmitStep("Submit"), true);
  assert.equal(isSubmitStep("Submit application"), true);
  assert.equal(isSubmitStep("Application submitted"), true);
  assert.equal(isSubmitStep("Follow up"), false, "follow-up is not submit");
  assert.equal(isSubmitStep("Tailor CV"), false);
  assert.equal(isSubmitStep(""), false);
  assert.equal(isSubmitStep(null), false);
});

test("marking the submit step done advances a wishlist job to applied", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist", roleArchetype: "ops" } as any);
  const step = await h.storage.createJobStep(job.id, { stepLabel: "Submit" });
  const r = await api(h.base, "PATCH", `/api/steps/${step.id}`, { status: "done" });
  assert.equal(r.status, 200);
  const updated = (await h.storage.getJobs()).find((j) => j.id === job.id)!;
  assert.equal(updated.status, "applied");
  assert.equal(updated.applicationReadiness, "submitted");
});

test("marking a NON-submit step done does NOT advance job status", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist", roleArchetype: "ops" } as any);
  const step = await h.storage.createJobStep(job.id, { stepLabel: "Tailor CV" });
  await api(h.base, "PATCH", `/api/steps/${step.id}`, { status: "done" });
  const updated = (await h.storage.getJobs()).find((j) => j.id === job.id)!;
  assert.equal(updated.status, "wishlist", "non-submit step leaves job in wishlist");
});

test("completing a generic job-linked task NEVER changes job status (logs only)", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist" } as any);
  const task = await h.storage.createTask({
    title: "Tailor CV for Analyst", list: "today", status: "in_progress",
    sourceType: "job", sourceId: job.id, doneWhen: "Submitted the application",
  } as any);
  await api(h.base, "POST", `/api/tasks/${task.id}/complete`, { day: DAY });
  const updated = (await h.storage.getJobs()).find((j) => j.id === job.id)!;
  assert.equal(updated.status, "wishlist", "fuzzy doneWhen text must not auto-advance the job");
  const acts = await h.storage.getActivityLog();
  assert.ok(acts.some((a) => a.eventType === "completed" && a.sourceType === "job" && a.sourceId === job.id), "completion still logged against the job");
});

test("explicit mark-submitted advances a wishlist job once and is idempotent", async () => {
  const job = await h.storage.createJob({ title: "Analyst", company: "Org", status: "wishlist" } as any);
  const r1 = await api(h.base, "POST", `/api/jobs/${job.id}/mark-submitted`, {});
  assert.equal(r1.json.job.status, "applied");
  const r2 = await api(h.base, "POST", `/api/jobs/${job.id}/mark-submitted`, {});
  assert.equal(r2.json.job.status, "applied", "second call stays applied, does not regress");
});

// create-next-task dedupe — one OPEN task per source.
test("create-next-task dedupe keeps a single open task per source", async () => {
  const job = await h.storage.createJob({ title: "Role", company: "Org", status: "wishlist", nextStep: "Draft cover" } as any);
  const a = await api(h.base, "POST", `/api/jobs/${job.id}/steps`, { stepLabel: "Write cover" });
  const stepA = a.json;
  await api(h.base, "POST", `/api/steps/${stepA.id}/materialize`, {});
  const b = await api(h.base, "POST", `/api/jobs/${job.id}/steps`, { stepLabel: "Tailor CV" });
  await api(h.base, "POST", `/api/steps/${b.json.id}/materialize`, {});
  const jobTasks = (await h.storage.getTasks()).filter((t) => t.sourceType === "job" && t.sourceId === job.id && !t.done);
  assert.equal(jobTasks.length, 1, "two materializations reuse one open task");
});

test("materializing a job step marks it done and clears the rail stall signal", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ops", name: "Ops", status: "active", priority: 5 } as any);
  const job = await h.storage.createJob({
    title: "Role",
    company: "Org",
    status: "wishlist",
    relatedTrackId: track.id,
    applicationReadiness: "questions",
    warmPathScore: 80,
  } as any);
  await h.storage.createContact({ name: "Ally", who: "Ally", status: "replied", relatedTrackId: track.id } as any);
  const created = await api(h.base, "POST", `/api/jobs/${job.id}/steps`, { stepLabel: "Write cover" });

  const materialized = await api(h.base, "POST", `/api/steps/${created.json.id}/materialize`, {});
  assert.equal(materialized.status, 200);

  const step = await h.storage.getJobStep(created.json.id);
  assert.equal(step!.status, "done", "materialized step counts as progress on the rail");
  assert.ok(step!.taskId, "materialized step stores the linked task id");

  const fd = await api(h.base, "GET", "/api/strategy/front-door");
  const diag = fd.json.tracks.find((x: any) => x.id === track.id)!;
  assert.equal(diag.signals.readinessGap, 0, "a fully materialized single-step rail is not scored as stalled");
});

test("materializing a proof step marks it done and clears the proof stall signal", async () => {
  const track = await h.storage.createCareerTrack({ slug: "proof", name: "Proof", status: "active", priority: 5 } as any);
  const hustle = await h.storage.createHustle({
    title: "Memo series",
    stage: "earning",
    proofAssetForTrack: track.id,
  } as any);
  const created = await api(h.base, "POST", `/api/hustles/${hustle.id}/steps`, { stepLabel: "Draft memo" });

  const materialized = await api(h.base, "POST", `/api/proof-steps/${created.json.id}/materialize`, {});
  assert.equal(materialized.status, 200);

  const step = await h.storage.getProofAssetStep(created.json.id);
  assert.equal(step!.status, "done", "materialized proof step counts as progress on the rail");
  assert.ok(step!.taskId, "materialized proof step stores the linked task id");

  const fd = await api(h.base, "GET", "/api/strategy/front-door");
  const diag = fd.json.tracks.find((x: any) => x.id === track.id)!;
  assert.equal(diag.signals.proofGap, 0, "a fully materialized single-step proof rail is not scored as stalled");
});

test("task breakdown updates only the task and does not rewrite parent source fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (/api\.openai\.com/i.test(url)) {
      throw new Error("OpenAI disabled in tests");
    }
    return originalFetch(input as any, init);
  }) as typeof fetch;

  try {
    const job = await h.storage.createJob({
      title: "Policy role",
      company: "Org",
      status: "wishlist",
      nextStep: "User-curated job next step",
      applicationReadiness: "cv",
    } as any);
    const learn = await h.storage.createLearn({
      title: "AI governance course",
      type: "course",
      requiredOutput: "",
      learnStatus: "open",
    } as any);
    const hustle = await h.storage.createHustle({
      title: "Memo series",
      nextStep: "User-curated hustle next step",
      stage: "testing",
    } as any);

    const jobTask = await h.storage.createTask({ title: "Tailor CV", sourceType: "job", sourceId: job.id, category: "job" } as any);
    const learnTask = await h.storage.createTask({ title: "Read module one", sourceType: "learn", sourceId: learn.id, category: "learning" } as any);
    const hustleTask = await h.storage.createTask({ title: "Draft outline", sourceType: "hustle", sourceId: hustle.id, category: "hustle" } as any);

    const jobRes = await api(h.base, "POST", `/api/tasks/${jobTask.id}/breakdown`, {});
    const learnRes = await api(h.base, "POST", `/api/tasks/${learnTask.id}/breakdown`, {});
    const hustleRes = await api(h.base, "POST", `/api/tasks/${hustleTask.id}/breakdown`, {});
    assert.equal(jobRes.status, 200);
    assert.equal(learnRes.status, 200);
    assert.equal(hustleRes.status, 200);

    const jobAfter = (await h.storage.getJobs()).find((x) => x.id === job.id)!;
    const learnAfter = (await h.storage.getLearn()).find((x) => x.id === learn.id)!;
    const hustleAfter = (await h.storage.getHustles()).find((x) => x.id === hustle.id)!;
    assert.equal(jobAfter.nextStep, "User-curated job next step", "breakdown must not rewrite job.nextStep");
    assert.equal(learnAfter.requiredOutput, "", "breakdown must not invent a required output on the learn item");
    assert.equal(hustleAfter.nextStep, "User-curated hustle next step", "breakdown must not rewrite hustle.nextStep");

    const updatedJobTask = (await h.storage.getTasks()).find((x) => x.id === jobTask.id)!;
    assert.notEqual(updatedJobTask.steps, "[]", "breakdown still writes steps onto the task itself");
    assert.ok(updatedJobTask.minimumOutcome, "breakdown still updates the task's stage outcome");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// P4.6a #5 — the unified front-door is the ONE strategy payload, and the legacy
// /api/strategy delegates to the same engine (no parallel computation).
test("strategy front-door returns the unified payload off one engine", async () => {
  await h.storage.createCareerTrack({ slug: "ai-gov", name: "AI Gov", status: "active", priority: 5 } as any);
  await h.storage.createJob({ title: "Policy lead", company: "Org", status: "wishlist", roleArchetype: "policy" } as any);
  const fd = await api(h.base, "GET", "/api/strategy/front-door");
  assert.equal(fd.status, 200);
  assert.ok(Array.isArray(fd.json.tracks), "tracks present");
  assert.ok(Array.isArray(fd.json.topThree), "topThree present");
  assert.ok(Array.isArray(fd.json.insights), "insights present");
  assert.ok(fd.json.unlinked && Array.isArray(fd.json.unlinked.items), "unlinked present");
  assert.ok(fd.json.evidence, "evidence present");
  assert.ok(fd.json.topThree.length <= 3, "topThree capped at 3");

  // legacy endpoint delegates to the same engine -> same track ids, in order.
  const legacy = await api(h.base, "GET", "/api/strategy");
  assert.deepEqual(legacy.json.tracks.map((t: any) => t.id), fd.json.tracks.map((t: any) => t.id));
});

// The brain SELECTS the single highest-leverage move deterministically.
test("brain recommends a deterministically-selected move", async () => {
  await h.storage.createJob({ title: "Policy lead", company: "GovAI", status: "wishlist", roleArchetype: "policy" } as any);
  const r = await api(h.base, "POST", "/api/brain/recommend", { energy: "medium" });
  assert.equal(r.status, 200);
  assert.ok(r.json.pick, "a pick is returned");
  assert.ok(typeof r.json.pick.title === "string" && r.json.pick.title.length > 0, "move has a brain-derived title");
  assert.equal(r.json.pick.source, "job", "move carries its brain source type");
});

// ─────────────────────────────────────────────────────────────────────────
// FELLOWSHIP MECE FIX — a fellowship is an OPPORTUNITY YOU APPLY TO, not a
// resource you consume. Legacy `learn` rows that are really fellowships migrate
// into the jobs/opportunity pipeline (opportunityKind="fellowship"), get the
// application step rail (eligibility FIRST, no proof/output workflow), and a
// gated/closed 2026 cycle reads as watch/closed — monitored, not actionable.
// ─────────────────────────────────────────────────────────────────────────

test("fellowship learn row migrates into jobs and disappears from Learn", async () => {
  await h.storage.createLearn({
    title: "Talos Fellowship", type: "fellowship", category: "Fellowship · WATCH",
    note: "EU citizenship required; closed for 2026, reopens next cycle.",
    url: "https://talos.example", applicationDeadline: "", learnStatus: "watch",
  } as any);

  const r = migrateFellowshipLearnRows();
  assert.equal(r.migrated, 1, "one fellowship moved");

  const learnAfter = await h.storage.getLearn();
  assert.equal(learnAfter.length, 0, "originating learn row removed");

  const jobsAfter = await h.storage.getJobs();
  assert.equal(jobsAfter.length, 1, "fellowship now an opportunity");
  const f = jobsAfter[0];
  assert.equal(f.opportunityKind, "fellowship");
  assert.equal(f.roleArchetype, "fellowship", "carries the fellowship archetype for its rail");
  assert.ok(isFellowshipOpportunity(f), "recognised as a fellowship opportunity");
  assert.equal(f.url, "https://talos.example", "url carried over");
});

test("a course is NEVER misclassified as a fellowship (stays in Learn)", async () => {
  await h.storage.createLearn({
    title: "BlueDot AI Governance course", type: "course", category: "Course",
    note: "AI governance fundamentals.", learnStatus: "active",
  } as any);

  const r = migrateFellowshipLearnRows();
  assert.equal(r.migrated, 0, "course must not migrate");

  const learnAfter = await h.storage.getLearn();
  assert.equal(learnAfter.length, 1, "course stays in Learn");
  assert.equal((await h.storage.getJobs()).length, 0, "no opportunity created from a course");
});

test("a migrated fellowship gets the application step rail, eligibility FIRST", async () => {
  await h.storage.createLearn({
    title: "Impact Accelerator", type: "fellowship", category: "Fellowship · OPEN",
    note: "Open cohort.", applicationDeadline: "2026-06-07", learnStatus: "open",
  } as any);
  migrateFellowshipLearnRows();
  const f = (await h.storage.getJobs())[0];

  const steps = await h.storage.seedJobSteps(f.id);
  const labels = steps.map((s) => s.stepLabel);
  assert.deepEqual(labels, [
    "Confirm eligibility", "Check/confirm deadline", "Prepare materials",
    "Submit application", "Follow up",
  ], "fellowship rail with eligibility first — not a proof/output workflow");
});

test("an open fellowship is actionable; a gated/closed 2026 one is watch/closed", async () => {
  await h.storage.createLearn({
    title: "Impact Accelerator", type: "fellowship", category: "Fellowship · OPEN",
    note: "Open cohort.", applicationDeadline: "2026-06-07", learnStatus: "open",
  } as any);
  await h.storage.createLearn({
    title: "Horizon Fellowship", type: "fellowship", category: "Fellowship · WATCH",
    note: "Requires US work eligibility; closed for 2026.", learnStatus: "watch",
  } as any);
  migrateFellowshipLearnRows();

  const all = await h.storage.getJobs();
  const open = all.find((j) => j.title === "Impact Accelerator")!;
  const watch = all.find((j) => j.title === "Horizon Fellowship")!;

  assert.equal(open.applicationWindowStatus, "open");
  assert.equal(open.eligibilityRisk, "", "open one carries no eligibility risk");
  assert.ok(isOpportunityActionable(open), "open fellowship is actionable now");

  assert.equal(watch.applicationWindowStatus, "closed", "gated 2026 one is window-closed");
  assert.ok(watch.eligibilityRisk, "carries an eligibility-risk chip");
  assert.equal(watch.status, "wishlist", "still a tracked opportunity, not deleted");
  assert.equal(isOpportunityActionable(watch), false, "closed window is monitored, not actionable");
});

test("a watch/closed fellowship is not surfaced by the brain", async () => {
  await h.storage.createLearn({
    title: "IAPS Fellowship", type: "fellowship", category: "Fellowship · WATCH",
    note: "US work authorisation required; closed for 2026.", learnStatus: "watch",
  } as any);
  migrateFellowshipLearnRows();

  const r = await api(h.base, "POST", "/api/brain/recommend", { energy: "medium" });
  assert.equal(r.status, 200);
  // Only a watch/closed fellowship exists — nothing actionable, so the brain has
  // no live move to surface from it.
  if (r.json.pick) {
    assert.notEqual(r.json.pick.title, "IAPS Fellowship", "closed fellowship is not recommended");
  }
});

test("migration is idempotent — re-running produces no duplicate opportunities", async () => {
  await h.storage.createLearn({
    title: "MATS", type: "fellowship", category: "Fellowship · WATCH",
    note: "Closed for 2026.", learnStatus: "watch",
  } as any);
  const first = migrateFellowshipLearnRows();
  assert.equal(first.migrated, 1);
  const second = migrateFellowshipLearnRows();
  assert.equal(second.migrated, 0, "second run migrates nothing new");
  assert.equal((await h.storage.getJobs()).length, 1, "no duplicate opportunity");
});

// ─────────────────────────────────────────────────────────────────────────
// PHASE 5 — LEARNING STRATEGY: capability-gap detection (5.1), sequencing (5.3),
// strategy ordering (5.4), the wins.trackId attribution debt, and the proofIntent
// opt-in. The Afterline rule is the spine: a domain is credited only from a source
// whose OWN text normalizes to it — the geopolitics proof asset never evidences
// (nor is demanded to fill) an AI gap.
// ─────────────────────────────────────────────────────────────────────────

// 5.1 — required domains are DATA-DRIVEN from the track archetype; the geopolitics
// (advisory) lane deliberately does NOT require ai-gov.
test("required domains are data-driven and keep AI out of the geopolitics lane", () => {
  assert.deepEqual(requiredDomainsForTrack({ targetRoleArchetype: "policy" }), ["ai-gov", "policy", "quant"]);
  const advisory = requiredDomainsForTrack({ targetRoleArchetype: "advisory" });
  assert.deepEqual(advisory, ["geo", "comms"]);
  assert.ok(!advisory.includes("ai-gov"), "AFTERLINE: geopolitics/advisory must never require AI governance");
  // fallback by slug/name when no archetype.
  assert.deepEqual(requiredDomainsForTrack({ slug: "ai-gov-ops", name: "AI Gov Ops" }), ["ai-gov", "policy", "quant"]);
  assert.deepEqual(requiredDomainsForTrack({ slug: "unknown", name: "Mystery" }), [], "no profile -> no gaps, never a false alarm");
});

// 5.1 — a gap is required-minus-evidenced; an evidenced Learn item closes its own
// domain. Items whose text doesn't normalize to a required domain don't help.
test("gap detection: an evidenced Learn item closes only the domain its text normalizes to", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5, targetRoleArchetype: "policy" } as any);
  // ai-gov evidenced via an evidenced learn item (has outputEvidenceUrl -> evidenced).
  await h.storage.createLearn({
    title: "AI governance course", category: "AI governance", capabilityBuilt: "ai safety",
    relatedTrackId: track.id, learnStatus: "active", outputEvidenceUrl: "https://proof.example/memo",
  } as any);

  const r = await computeLearningGaps();
  const t = r.tracks.find((x) => x.trackId === track.id)!;
  assert.deepEqual(t.requiredDomains, ["ai-gov", "policy", "quant"]);
  assert.ok(t.evidencedDomains.includes("ai-gov"), "the AI governance item evidences ai-gov");
  assert.deepEqual(t.gapDomains, ["policy", "quant"], "policy + quant remain open gaps");
});

// 5.1 AFTERLINE — the geopolitics proof asset normalizes to geo/comms; it can
// neither evidence an AI gap nor be demanded to carry AI content.
test("AFTERLINE: the geopolitics proof asset never evidences an AI gap", async () => {
  const aiTrack = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5, targetRoleArchetype: "policy" } as any);
  // A geopolitics Substack proof asset linked to the AI track. Its OWN text is geo —
  // so it credits geo (not a required AI domain), and the AI gaps stay open.
  await h.storage.createHustle({
    title: "Geopolitics Substack", contentPillar: "geopolitical forecasting",
    coreClaim: "weekly foreign policy analysis", note: "international relations essay",
    stage: "earning", proofAssetForTrack: aiTrack.id,
  } as any);

  const r = await computeLearningGaps();
  const t = r.tracks.find((x) => x.trackId === aiTrack.id)!;
  assert.ok(!t.evidencedDomains.includes("ai-gov"), "geopolitics asset must NOT evidence ai-gov");
  assert.ok(t.gapDomains.includes("ai-gov"), "ai-gov stays a gap — never filled by the geo asset");
});

// wins.trackId DEBT — evidence attribution PREFERS the explicit column.
test("wins.trackId column is preferred for evidence attribution", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5 } as any);
  await h.storage.createWin({ text: "shipped a memo", winCategory: "proof_asset", trackId: track.id } as any);

  const ev = await computeEvidence();
  const b = ev.byTrack.get(track.id)!;
  assert.equal(b.evidenceCount, 1, "the column-tagged win is attributed to the track directly");
  const untracked = ev.byTrack.get("untracked")!;
  assert.equal(untracked.evidenceCount, 0, "nothing leaks to untracked");
});

// wins.trackId DEBT — a legacy win with NO trackId still attributes via the
// completed-event text-match fallback (column-null stays valid, not lost).
test("legacy win with null trackId falls back to the completed-event text match", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5 } as any);
  const task = await h.storage.createTask({ title: "Publish forecast", list: "today", status: "in_progress", relatedTrackId: track.id } as any);
  // complete via the route so a completed activity event + a win (with trackId) are
  // created — then strip the win's trackId to simulate a legacy row.
  await api(h.base, "POST", `/api/tasks/${task.id}/complete`, { day: DAY });
  const win = (await h.storage.getWins())[0];
  h.sqlite.prepare(`UPDATE wins SET track_id = NULL WHERE id = ?`).run(win.id);

  const ev = await computeEvidence();
  const b = ev.byTrack.get(track.id)!;
  assert.equal(b.evidenceCount, 1, "legacy win still lands on the track via text-match fallback");
});

// 5.3 — sequencing: an unmet prerequisite pushes its item AFTER the prereq.
test("sequencing orders an item with an unmet prerequisite after its dependency", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5, targetRoleArchetype: "policy" } as any);
  const prereq = await h.storage.createLearn({
    title: "Intro to policy", category: "policy frameworks", relatedTrackId: track.id, learnStatus: "open",
  } as any);
  await h.storage.createLearn({
    title: "Advanced policy", category: "policy frameworks", relatedTrackId: track.id,
    learnStatus: "open", prerequisites: JSON.stringify([prereq.id]),
  } as any);

  const r = await computeLearningGaps();
  const t = r.tracks.find((x) => x.trackId === track.id)!;
  const policySteps = t.sequence.filter((s) => s.gapDomain === "policy" && s.learnId !== null);
  assert.equal(policySteps[0].title, "Intro to policy", "prereq sequenced first");
  assert.equal(policySteps[1].title, "Advanced policy", "dependent item comes after");
  assert.equal(policySteps[1].hasUnmetPrereq, true, "the dependent item flags its unmet prereq");
});

// 5.3 — a gap domain with no matching live Learn item becomes an unfilled-gap slot
// (the attach point for later out-of-scope discovered resources).
test("a gap with no Learn item produces an unfilled-gap slot", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5, targetRoleArchetype: "policy" } as any);
  const r = await computeLearningGaps();
  const t = r.tracks.find((x) => x.trackId === track.id)!;
  assert.ok(t.unfilledGapCount >= 1, "no Learn items -> unfilled-gap slots exist");
  assert.ok(t.sequence.some((s) => s.learnId === null), "an unfilled slot is present in the sequence");
});

// 5.4 — strategy ordering: the learning gap is a STRUCTURAL bottleneck but ranks
// BELOW readiness. With proof/warmth cleared, a live-but-unready application
// surfaces readiness, not the (also-open) capability gap, as the primary move.
test("strategy ranks the learning gap below readiness", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5, targetRoleArchetype: "policy" } as any);
  // Live proof asset normalizing to ai-gov clears proofGap (and evidences ai-gov).
  await h.storage.createHustle({ title: "AI governance memo series", contentPillar: "ai safety", coreClaim: "frontier ai policy", note: "responsible ai", stage: "earning", proofAssetForTrack: track.id } as any);
  // A live, low-readiness job creates the readiness gap; warm contact clears warmth.
  await h.storage.createJob({ title: "Policy analyst", company: "Org", status: "applied", relatedTrackId: track.id, applicationReadiness: "none", warmPathScore: 80 } as any);
  await h.storage.createContact({ name: "Ally", who: "Ally", status: "replied", relatedTrackId: track.id } as any);

  const fd = await api(h.base, "GET", "/api/strategy/front-door");
  const t = fd.json.tracks.find((x: any) => x.id === track.id)!;
  assert.equal(t.bottleneck, "readiness", "readiness outranks the capability gap");
  assert.ok(t.learningGap && t.learningGap.gapCount > 0, "the capability gap is still reported alongside");
  assert.ok(fd.json.learningGap, "the front-door exposes the top learning-gap signal");
});

// 5.4 — when no readiness/proof/warmth/execution blocker is louder, the learning
// gap surfaces as the primary structural move (above the calm evidence nudge).
test("learning gap is the move when no louder structural blocker exists", async () => {
  const track = await h.storage.createCareerTrack({ slug: "ai-gov-ops", name: "AI Gov Ops", status: "active", priority: 5, targetRoleArchetype: "policy" } as any);
  // A live proof asset normalizing to ai-gov: clears directionGap + proofGap and
  // evidences ai-gov, leaving policy + quant as the only open (capability) gaps.
  await h.storage.createHustle({ title: "AI governance memo series", contentPillar: "ai safety", coreClaim: "frontier ai policy", note: "responsible ai", stage: "earning", proofAssetForTrack: track.id } as any);
  // A warm contact clears the warmth signal; no live jobs -> no readiness/warmth-from-jobs.
  await h.storage.createContact({ name: "Ally", who: "Ally", status: "replied", relatedTrackId: track.id } as any);
  // Log a win so the evidence nudge can't be the bottleneck either.
  await h.storage.createWin({ text: "shipped a memo", winCategory: "proof_asset", trackId: track.id } as any);

  const fd = await api(h.base, "GET", "/api/strategy/front-door");
  const t = fd.json.tracks.find((x: any) => x.id === track.id)!;
  assert.equal(t.bottleneck, "learning", "capability gap surfaces once nothing structural is louder");
  assert.ok(/policy|quant/i.test(t.recommendedMove), "the move names an unmet capability domain");
});

// proofIntent — the opt-in lane. An item with proofIntent=0 and no requiredOutput
// is SILENT (reference); setting proofIntent moves it into the producing lane.
test("proofIntent: reference stays silent; opting in enters the producing lane", () => {
  const ref = { requiredOutput: "", proofIntent: false, outputEvidenceUrl: "" };
  assert.equal(getLearnOutputState(ref as any), "reference", "no output + no intent = silent reference");
  assert.equal(learnNeedsOutputNudge(ref as any), false, "reference is never nudged");

  const optedIn = { requiredOutput: "", proofIntent: true, outputEvidenceUrl: "" };
  assert.equal(getLearnOutputState(optedIn as any), "producing", "proofIntent alone enters the producing lane");
  assert.equal(learnNeedsOutputNudge(optedIn as any), true, "opted-in-without-output gets the soft nudge");
});

// proofIntent round-trips through the PATCH route and flips the derived state.
test("proofIntent round-trips via PATCH and flips the output state", async () => {
  const l = await h.storage.createLearn({ title: "A book", category: "geopolitics", learnStatus: "open" } as any);
  assert.equal(getLearnOutputState(l), "reference", "starts as silent reference");
  const r = await api(h.base, "PATCH", `/api/learn/${l.id}`, { proofIntent: true });
  assert.equal(r.status, 200);
  const after = (await h.storage.getLearn()).find((x) => x.id === l.id)!;
  assert.equal(getLearnOutputState(after), "producing", "opting in moves it to producing");
});

// plan recompute does not produce duplicate started/linked tasks — starting an
// item twice must not spawn a second backing task.
test("starting a plan item twice does not duplicate the backing task", async () => {
  const { item } = await makePlanWithItem({ title: "Repeatable" });
  const first = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  const second = await api(h.base, "POST", `/api/plan-items/${item.id}/start`, { day: DAY });
  assert.equal(first.json.task.id, second.json.task.id, "same task on re-start");
  assert.equal((await h.storage.getTasks()).length, 1, "no duplicate task");
});
