import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSeedInitialData } from "./seed";

test("example tracks are opt-in, not default first-run data", () => {
  assert.equal(shouldSeedInitialData({}), false);
  assert.equal(shouldSeedInitialData({ ANCHOR_ENABLE_EXAMPLE_TRACKS: "0" }), false);
  assert.equal(shouldSeedInitialData({ ANCHOR_ENABLE_EXAMPLE_TRACKS: "1" }), true);
});
