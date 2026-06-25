import assert from "node:assert/strict";
import test from "node:test";
import {
  installReadPurityGuard,
  ReadPurityViolation,
  runWithRequestMethod,
} from "./requestMutationGuard";

class FakeStorage {
  updates = 0;

  async getTasks() {
    return [{ id: 1 }];
  }

  async updateTask() {
    this.updates += 1;
    return { id: 1 };
  }
}

function guardedStorage() {
  const storage = new FakeStorage();
  const app = { use: () => undefined } as any;
  installReadPurityGuard(app, storage);
  return storage;
}

test("GET requests can read without changing storage", async () => {
  const storage = guardedStorage();
  const tasks = await runWithRequestMethod("GET", "/api/tasks", () => storage.getTasks());
  assert.deepEqual(tasks, [{ id: 1 }]);
  assert.equal(storage.updates, 0);
});

test("GET requests fail closed when a storage write is attempted", () => {
  const storage = guardedStorage();
  assert.throws(
    () => runWithRequestMethod("GET", "/api/tasks", () => storage.updateTask()),
    (error: unknown) => error instanceof ReadPurityViolation && error.status === 405,
  );
  assert.equal(storage.updates, 0);
});

test("explicit command requests may write", async () => {
  const storage = guardedStorage();
  await runWithRequestMethod("POST", "/api/tasks/1/complete", () => storage.updateTask());
  assert.equal(storage.updates, 1);
});
