import assert from "node:assert/strict";
import test from "node:test";
import type { UserEvidenceItem } from "./trackResearchCoverageEvidence";
import { coverageCorpusInternals } from "./trackResearchCoverageCorpus";

function evidence(overrides: Partial<UserEvidenceItem> = {}): UserEvidenceItem {
  return {
    id: "evidence-1",
    sourceType: "win",
    label: "Relevant outcome",
    detail: "Delivered a target-relevant outcome.",
    sourceUrl: "",
    strength: "supporting",
    state: "completed",
    usableForCoverage: true,
    sourceEntityType: "win",
    sourceEntityId: 1,
    trackIds: [1],
    observedAt: 1,
    ...overrides,
  };
}

test("canonical learnStatus done is collected as completed learning", () => {
  const item = coverageCorpusInternals.canonicalLearnEvidence({
    id: 7,
    title: "Political economy course",
    learnStatus: "done",
    done: false,
    active: false,
    relatedTrackId: 3,
    url: "https://example.com/course",
  });

  assert.ok(item);
  assert.equal(item?.state, "completed");
  assert.equal(item?.strength, "supporting");
  assert.equal(item?.usableForCoverage, true);
  assert.deepEqual(item?.trackIds, [3]);
});

test("canonical learnStatus active remains visible but cannot prove coverage", () => {
  const item = coverageCorpusInternals.canonicalLearnEvidence({
    id: 8,
    title: "Forecasting practice",
    learnStatus: "active",
    done: false,
    active: false,
  });

  assert.ok(item);
  assert.equal(item?.state, "active");
  assert.equal(item?.strength, "planned");
  assert.equal(item?.usableForCoverage, false);
});

test("published output status is treated as verified even without legacy done flags", () => {
  const item = coverageCorpusInternals.canonicalLearnEvidence({
    id: 9,
    title: "Geopolitical analysis",
    outputTitle: "Country risk memo",
    outputStatus: "published",
    outputEvidenceUrl: "https://example.com/memo",
    learnStatus: "active",
  });

  assert.ok(item);
  assert.equal(item?.sourceType, "learning_output");
  assert.equal(item?.state, "published");
  assert.equal(item?.strength, "verified");
  assert.equal(item?.sourceUrl, "https://example.com/memo");
});

test("unsafe external URL schemes are removed", () => {
  assert.equal(coverageCorpusInternals.safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(coverageCorpusInternals.safeExternalUrl("data:text/html,hello"), "");
  assert.equal(coverageCorpusInternals.safeExternalUrl("https://example.com/path"), "https://example.com/path");
});

test("evidence fingerprint changes when track association changes", () => {
  const first = evidence({ trackIds: [1] });
  const relinked = evidence({ trackIds: [2] });
  const firstFingerprint = coverageCorpusInternals.corpusFingerprint([first], 1);
  const secondFingerprint = coverageCorpusInternals.corpusFingerprint([relinked], 1);

  assert.notEqual(firstFingerprint, secondFingerprint);
});

test("planned evidence does not invalidate coverage until it becomes usable", () => {
  const stable = evidence();
  const plannedA = evidence({
    id: "planned-1",
    sourceType: "completed_learning",
    sourceEntityType: "learn",
    sourceEntityId: 2,
    strength: "planned",
    state: "active",
    usableForCoverage: false,
    detail: "Initial active learning note",
  });
  const plannedB = { ...plannedA, detail: "Updated active learning note" };

  assert.equal(
    coverageCorpusInternals.corpusFingerprint([stable, plannedA], 1),
    coverageCorpusInternals.corpusFingerprint([stable, plannedB], 1),
  );
});
