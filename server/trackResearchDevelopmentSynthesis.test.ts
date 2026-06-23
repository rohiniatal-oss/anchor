import assert from "node:assert/strict";
import test from "node:test";
import { developmentSynthesisInternals } from "./trackResearchDevelopmentSynthesis";

test("malformed collection fields are coerced to empty arrays", () => {
  const sanitized = developmentSynthesisInternals.sanitizeDevelopmentPlanSynthesis({
    planSummary: "A plan",
    qualityNotes: "not an array",
    workstreams: [{
      title: "Capability",
      requirementIds: "requirement-1",
      methods: "learn",
      modules: [{
        title: "Module",
        requirementIds: "requirement-1",
        resources: "resource",
        activities: "activity",
        assessmentCriteria: "criterion",
      }],
      milestones: [{
        label: "Milestone",
        requirementIds: "requirement-1",
      }],
      dependencyNotes: "dependency",
    }],
  });

  assert.ok(sanitized);
  assert.deepEqual(sanitized?.qualityNotes, []);
  assert.deepEqual(sanitized?.workstreams?.[0]?.requirementIds, []);
  assert.deepEqual(sanitized?.workstreams?.[0]?.methods, []);
  assert.deepEqual(sanitized?.workstreams?.[0]?.modules?.[0]?.activities, []);
  assert.deepEqual(sanitized?.workstreams?.[0]?.modules?.[0]?.resources, []);
  assert.deepEqual(sanitized?.workstreams?.[0]?.milestones?.[0]?.requirementIds, []);
  assert.deepEqual(sanitized?.workstreams?.[0]?.dependencyNotes, []);
});

test("non-object synthesis is rejected", () => {
  assert.equal(developmentSynthesisInternals.sanitizeDevelopmentPlanSynthesis("not an object"), null);
  assert.equal(developmentSynthesisInternals.sanitizeDevelopmentPlanSynthesis([]), null);
});

test("well-shaped arrays are preserved for deterministic validation", () => {
  const sanitized = developmentSynthesisInternals.sanitizeDevelopmentPlanSynthesis({
    qualityNotes: ["Caveat"],
    workstreams: [{
      title: "Capability",
      requirementIds: ["requirement-1"],
      methods: ["learn"],
      modules: [{
        title: "Module",
        requirementIds: ["requirement-1"],
        resources: [],
        activities: ["Apply the concept"],
        assessmentCriteria: ["Meets the success bar"],
      }],
      milestones: [],
      dependencyNotes: [],
    }],
  });

  assert.deepEqual(sanitized?.workstreams?.[0]?.requirementIds, ["requirement-1"]);
  assert.deepEqual(sanitized?.workstreams?.[0]?.methods, ["learn"]);
  assert.deepEqual(sanitized?.qualityNotes, ["Caveat"]);
});
