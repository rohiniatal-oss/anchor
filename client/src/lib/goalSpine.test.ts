import test from "node:test";
import assert from "node:assert/strict";

import { goalMorningBriefWithExecution } from "./goalSpine";

test("pinned focus brief uses natural task copy", () => {
  const brief = goalMorningBriefWithExecution(null, {
    hasPinnedFocus: true,
    pinnedTitle: "Save one real AI governance strategy role and write down the top 3 requirements you'd need to prove",
  });

  assert.equal(
    brief.bestUseText,
    "Continue this task: Save one real AI governance strategy role and write down the top 3 requirements you'd need to prove.",
  );
  assert.doesNotMatch(brief.bestUseText, /^Stay with Save/i);
});
