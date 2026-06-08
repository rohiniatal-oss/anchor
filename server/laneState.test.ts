import assert from "node:assert/strict";
import test from "node:test";
import { buildLaneOperatingModel } from "./laneState";

function job(overrides: Record<string, any>) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Saved role",
    company: overrides.company ?? "Target org",
    location: overrides.location ?? "Remote",
    url: "",
    note: "",
    nextStep: "",
    status: overrides.status ?? "wishlist",
    deadline: "",
    flag: "",
    roleArchetype: overrides.roleArchetype ?? "strategy",
    opportunityKind: "job",
    fitScore: overrides.fitScore ?? 78,
    stretchScore: null,
    strategicValue: overrides.strategicValue ?? 72,
    frictionScore: overrides.frictionScore ?? 22,
    eligibilityRisk: "",
    warmPathScore: overrides.warmPathScore ?? 62,
    applicationReadiness: overrides.applicationReadiness ?? "questions",
    narrativeAngle: overrides.narrativeAngle ?? "",
    relatedTrackId: null,
    sourceUrl: "",
    sourceType: "posting",
    sourceCheckedAt: null,
    deadlineConfidence: overrides.deadlineConfidence ?? "high",
    applicationWindowStatus: overrides.applicationWindowStatus ?? "open",
    createdAt: Date.now(),
    ...overrides,
  } as any;
}

test("proof assets stay secondary to live applications and missing learning outputs", () => {
  const jobs = [job({ id: 1, title: "AI Strategy Associate" })];
  const learn = [{
    id: 2,
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
    outputEvidenceUrl: "",
  }] as any;
  const hustles = [{
    id: 3,
    title: "AI strategy memo series",
    note: "",
    nextStep: "",
    stage: "idea",
    coreClaim: "",
    firstPostIdea: "",
  }] as any;

  const laneModel = buildLaneOperatingModel([], jobs, learn, hustles, []);
  const proofLane = laneModel.lanes.find((lane) => lane.name === "Proof assets");
  const learningLane = laneModel.lanes.find((lane) => lane.name === "Learning");
  const applicationsLane = laneModel.lanes.find((lane) => lane.name === "Applications");

  assert.ok(proofLane);
  assert.ok(learningLane);
  assert.ok(applicationsLane);
  assert.equal(proofLane!.stage, "idea");
  assert.ok(proofLane!.priority < learningLane!.priority, "proof should not outrank learning output conversion");
  assert.ok(proofLane!.priority < applicationsLane!.priority, "proof should not outrank live application conversion");
  assert.notEqual(laneModel.bottleneckLane.name, "Proof assets");
});
