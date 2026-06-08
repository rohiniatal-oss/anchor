import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { attributeFeedbackFromActivity, attributeFeedbackSummary, careerAssetsFromActivity, deconstructRole, generateCandidateUniverse, starterDirections } from "./candidates";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("starter directions are grounded in real assets and warm networks", () => {
  const directions = starterDirections();
  assert.ok(directions.length >= 5);
  assert.ok(directions.some((d) => d.warmNetworks.includes("Bain")));
  assert.ok(directions.some((d) => d.warmNetworks.includes("SIPA")));
  assert.ok(directions.some((d) => d.warmNetworks.includes("TBI")));
  assert.ok(directions.some((d) => d.warmNetworks.includes("Worldpay/FIS")));
});

test("candidate universe builds directions, activities, and one recommendation", () => {
  const universe = generateCandidateUniverse([], []);
  assert.ok(universe.directions.length >= 5);
  assert.ok(universe.activities.length >= 1);
  assert.ok(universe.recommended);
  assert.ok(universe.grounding.includes("Bain"));
  assert.match(universe.recommended.firstStep, /Search|Look|Write|Open/i);
});

test("career assets can be reconstructed from activity log", () => {
  const now = Date.now();
  const assets = careerAssetsFromActivity([
    { id: 1, eventType: "career_asset_upsert", sourceType: "career_asset", sourceId: null, taskId: null, planItemId: null, metadata: JSON.stringify({ key: "net-test", kind: "network", label: "Test Network", strength: 9 }), timestamp: now } as any,
  ]);
  assert.ok(assets.some((a) => a.label === "Test Network"));
});

test("career asset API adds custom assets used by candidates", async () => {
  const create = await api(h.base, "POST", "/api/career-assets", { kind: "network", label: "Oxford network", note: "test asset", strength: 9 });
  assert.equal(create.status, 200);
  assert.ok(create.json.assets.some((a: any) => a.label === "Oxford network"));

  const candidates = await api(h.base, "GET", "/api/candidates");
  assert.equal(candidates.status, 200);
  assert.ok(candidates.json.grounding.includes("Oxford network"));
});

test("role deconstruction extracts attributes and capability gaps instead of whole-role reactions", () => {
  const role = {
    id: 1,
    title: "AI Policy Strategy Manager",
    company: "Example Org",
    location: "London",
    note: "Lead AI policy strategy, stakeholder engagement, public sector briefings and responsible AI roadmap development.",
    nextStep: "",
    roleArchetype: "policy",
    narrativeAngle: "TBI and Worldpay/FIS experience",
  } as any;
  const d = deconstructRole(role);
  assert.ok(d.attributes.workContent.includes("strategy"));
  assert.ok(d.attributes.topicAreas.includes("AI or technology"));
  assert.ok(d.attributes.environment.includes("government or public sector"));
  assert.ok(d.nextSignalAction.title.includes("AI Policy Strategy Manager"));
  assert.ok(d.capabilityGaps.length >= 1);
  assert.match(d.nextSignalAction.title, /capability gap/i);
});

test("attribute feedback is reconstructed and grouped", () => {
  const now = Date.now();
  const feedback = attributeFeedbackFromActivity([
    { id: 1, eventType: "role_attribute_feedback", sourceType: "role_attribute", sourceId: null, taskId: null, planItemId: null, metadata: JSON.stringify({ attributeType: "workContent", attribute: "strategy", reaction: "energising" }), timestamp: now } as any,
    { id: 2, eventType: "role_attribute_feedback", sourceType: "role_attribute", sourceId: null, taskId: null, planItemId: null, metadata: JSON.stringify({ attributeType: "mechanics", attribute: "delivery heavy", reaction: "draining" }), timestamp: now + 1 } as any,
  ]);
  const summary = attributeFeedbackSummary(feedback);
  assert.ok(summary.energising.includes("strategy"));
  assert.ok(summary.draining.includes("delivery heavy"));
});

test("role attribute feedback API stores signals and exposes them through candidates", async () => {
  const r = await api(h.base, "POST", "/api/role-attributes", { attributeType: "workContent", attribute: "strategy", reaction: "energising", note: "good signal" });
  assert.equal(r.status, 200);
  assert.ok(r.json.summary.energising.includes("strategy"));

  const attrs = await api(h.base, "GET", "/api/role-attributes");
  assert.equal(attrs.status, 200);
  assert.ok(attrs.json.energising.includes("strategy"));

  const candidates = await api(h.base, "GET", "/api/candidates");
  assert.equal(candidates.status, 200);
  assert.ok(candidates.json.attributeFeedback.energising.includes("strategy"));
});

test("role deconstruction route can commit one Today capability-gap task", async () => {
  const job = await h.storage.createJob({
    title: "Investment Attraction Strategy Lead",
    company: "Example Org",
    location: "Dubai",
    status: "wishlist",
    applicationWindowStatus: "open",
    note: "Lead investment attraction strategy, stakeholder engagement, FDI pipeline analysis and economic development advisory.",
    roleArchetype: "advisory",
  } as any);

  const d = await api(h.base, "GET", `/api/jobs/${job.id}/deconstruct`);
  assert.equal(d.status, 200);
  assert.equal(d.json.jobId, job.id);
  assert.ok(d.json.attributes.workContent.length >= 1);

  const r = await api(h.base, "POST", `/api/jobs/${job.id}/deconstruct/commit`);
  assert.equal(r.status, 200);
  assert.ok(r.json.task?.id);
  assert.equal(r.json.task.sourceType, "role_deconstruction");
  assert.match(r.json.task.title, /capability gap/i);
  const steps = JSON.parse(r.json.task.steps);
  assert.ok(steps.length >= 1);

  const log = await h.storage.getActivityLog();
  assert.ok(log.some((a) => a.eventType === "role_deconstruction_committed" && a.taskId === r.json.task.id));
});

test("candidate commit creates one Today task with a first step", async () => {
  const r = await api(h.base, "POST", "/api/candidates/commit");
  assert.equal(r.status, 200);
  assert.ok(r.json.task?.id);
  assert.equal(r.json.task.list, "today");
  assert.equal(r.json.task.category, "job");
  const steps = JSON.parse(r.json.task.steps);
  assert.ok(steps.length >= 1);
  assert.equal(steps[0].done, false);

  const log = await h.storage.getActivityLog();
  assert.ok(log.some((a) => a.eventType === "candidate_committed" && a.taskId === r.json.task.id));
});
