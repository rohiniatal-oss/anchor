import test from "node:test";
import assert from "node:assert/strict";

import { goalMorningBriefWithExecution } from "./goalSpine";

test("pinned focus brief avoids repeating the task title", () => {
  const brief = goalMorningBriefWithExecution(null, {
    hasPinnedFocus: true,
    pinnedTitle: "Save one real AI governance strategy posting with JD text for Anchor to compare",
  });

  assert.equal(brief.eyebrow, "Current focus");
  assert.equal(brief.bestUseLabel, "How to use this");
  assert.equal(brief.bestUseText, "Use the card below: finish the visible step, then stop or move to the next one.");
  assert.doesNotMatch(brief.bestUseText, /Save one real/i);
  assert.doesNotMatch(brief.bestUseText, /^Stay with/i);
});
