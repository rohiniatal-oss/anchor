import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveEvidenceCorpusInternals } from "./trackResearchAdaptiveEvidenceCorpus";
import type { ExecutionOutcome } from "./trackResearchExecutionOutcome";

function outcome(overrides: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
  return {
    id: "outcome-1",
    trackId: 7,
    blueprintFingerprint: "blueprint",
    blueprintTaskId: "task-1",
    liveTaskId: 91,
    workstreamId: "workstream-1",
    moduleId: "module-1",
    milestoneIds: ["milestone-1"],
    requirementIds: ["requirement-1"],
    taskKind: "artifact",
    outcomeType: "artifact",
    status: "accepted",
    title: "Published policy memo",
    summary: "Produced a decision-ready memo.",
    expectedEvidence: "An inspectable memo",
    evidenceStrength: "verified",
    evidenceUrl: "https://example.com/memo",
    evidenceDetail: "A decision-ready policy memo.",
    completedSubtaskIds: [],
    completionBasis: {
      taskDone: true,
      allAlwaysSubtasksDone: true,
      sourceUrlPresent: true,
      actualMinutes: 60,
    },
    focusedQuestion: "",
    userAnswer: "",
    acceptedAt: 100,
    rejectedAt: null,
    generatedAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test("accepted artifact outcomes become verified proof assets", () => {
  const item = adaptiveEvidenceCorpusInternals.outcomeEvidenceItem(outcome());

  assert.equal(item.sourceType, "proof_asset");
  assert.equal(item.strength, "verified");
  assert.equal(item.usableForCoverage, true);
  assert.deepEqual(item.trackIds, [7]);
  assert.equal(item.sourceEntityId, 91);
});

test("applied experience maps to a win rather than a generic proof asset", () => {
  const item = adaptiveEvidenceCorpusInternals.outcomeEvidenceItem(outcome({
    taskKind: "experience",
    outcomeType: "applied_experience",
    evidenceStrength: "direct",
    evidenceUrl: "",
  }));

  assert.equal(item.sourceType, "win");
  assert.equal(item.strength, "direct");
});

test("relationship and access outcomes map to substantive interactions", () => {
  assert.equal(adaptiveEvidenceCorpusInternals.sourceTypeFor(outcome({ outcomeType: "relationship_signal" })), "interaction");
  assert.equal(adaptiveEvidenceCorpusInternals.sourceTypeFor(outcome({ outcomeType: "access_signal" })), "interaction");
});

test("learning without an inspectable output remains completed learning", () => {
  const item = adaptiveEvidenceCorpusInternals.outcomeEvidenceItem(outcome({
    taskKind: "learning",
    outcomeType: "learning_application",
    evidenceStrength: "supporting",
    evidenceUrl: "",
  }));

  assert.equal(item.sourceType, "completed_learning");
  assert.equal(item.strength, "supporting");
});

test("rejected outcomes are not usable even when converted defensively", () => {
  const item = adaptiveEvidenceCorpusInternals.outcomeEvidenceItem(outcome({ status: "rejected" }));
  assert.equal(item.usableForCoverage, false);
});
