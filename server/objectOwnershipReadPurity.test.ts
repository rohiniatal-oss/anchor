import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeHarness, type Harness } from "./spine.harness";
import { ensureObjectOwnershipSchema, getPersistedOwnership } from "./objectOwnership";
import { installReadPurityGuard, runWithRequestMethod } from "./requestMutationGuard";

let h: Harness;

before(async () => {
  h = await makeHarness();
  // Boot-time schema ensure (as index.ts does, before the guard is installed).
  ensureObjectOwnershipSchema();
  installReadPurityGuard(express(), h.storage, h.sqlite);
});
after(async () => { await h.close(); });

test("getPersistedOwnership is a pure read under a GET request context", () => {
  // Before the module-level guard fix, ensureObjectOwnershipSchema() re-ran DDL on
  // every call, so a GET-path read tripped the read-purity guard with a 405. With
  // the guard, the DDL only runs once (at boot) and the read stays pure.
  const result = runWithRequestMethod("GET", "/api/ownership/strategic-objects", () => getPersistedOwnership());
  assert.ok(result instanceof Map);
});
