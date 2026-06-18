import test from "node:test";
import assert from "node:assert/strict";

import { buildLearnRecommendationDraft, deriveRecommendationStart } from "./recommendationStart";

test("buildLearnRecommendationDraft keeps the concrete recommendation title while preserving gap context", () => {
  const draft = buildLearnRecommendationDraft({
    title: "AI governance landscape brief",
    whySuggested: "This is the thinnest capability area right now.",
    linkedTrackId: 7,
    linkedGapKey: "ai-gov",
    sourceUrl: "https://example.com/brief",
  }, "AI Strategy");

  assert.equal(draft.title, "AI governance landscape brief");
  assert.equal(draft.relatedTrackId, 7);
  assert.equal(draft.url, "https://example.com/brief");
  assert.equal(draft.starterWhy, "This is the thinnest capability area right now.");
});

test("deriveRecommendationStart prefers the active milestone task over passive resource lists", () => {
  const start = deriveRecommendationStart({
    subdivisions: [{
      label: "Landscape",
      whyItMatters: "Useful context",
      suggestedMaterials: JSON.stringify(["Read summary deck"]),
    }],
    milestones: [{
      label: "Write the summary",
      suggestedTaskTitle: "Write a one-page summary of the current landscape",
      doneWhen: "You can explain the main actors and tradeoffs",
      status: "active",
    }],
  });

  assert.deepEqual(start, {
    title: "Write a one-page summary of the current landscape",
    note: "Done when: You can explain the main actors and tradeoffs",
  });
});
