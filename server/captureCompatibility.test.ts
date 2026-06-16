import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyCategoryToRoute } from "./captureCompatibility";

test("legacy capture category helper maps hustle to proof", () => {
  assert.equal(legacyCategoryToRoute("hustle"), "proof");
});

test("legacy capture category helper passes through supported deterministic routes", () => {
  assert.equal(legacyCategoryToRoute("today"), "today");
  assert.equal(legacyCategoryToRoute("learn"), "learn");
  assert.equal(legacyCategoryToRoute("keep"), "keep");
});

test("legacy capture category helper rejects unknown categories", () => {
  assert.equal(legacyCategoryToRoute("unknown"), "");
});
