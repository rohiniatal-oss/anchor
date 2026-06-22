import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptureTaskPatch } from "./captureTaskRouting";

function baseTask(title: string) {
  return {
    id: 1,
    title,
    list: "inbox",
    block: null,
    done: false,
    pinned: false,
    steps: "[]",
    sort: 0,
    category: "",
    size: "",
    status: "",
    doneWhen: "",
    minimumOutcome: "",
    estimateMinutes: null,
    estimateConfidence: "",
    estimateReason: "",
    readiness: "",
    blockerReason: "",
    sourceType: "",
    sourceId: null,
    sourceStatus: "",
    sourceNote: "",
    skipped: 0,
    planItemId: null,
    relatedTrackId: null,
    createdAt: Date.now(),
  } as any;
}

test("today capture patch adds a starter step without inventing a block", () => {
  const patch = buildCaptureTaskPatch(baseTask("Finish the policy memo edits"), {
    list: "today",
    block: null,
    sourceStatus: "routed:today:task",
  });
  assert.equal(patch.list, "today");
  assert.equal(patch.block, null);
  assert.match(String(patch.steps), /open the draft, project, or blank note/i);
  assert.equal(patch.minimumOutcome, patch.doneWhen);
});

test("decision capture patch keeps decision-specific outcome while adding a starter step", () => {
  const patch = buildCaptureTaskPatch(baseTask("Figure out if AI governance is right for me"), {
    list: "inbox",
    category: "admin",
    doneWhen: "A clear decision or next action is written down",
    minimumOutcome: "A clear decision or next action is written down",
    sourceStatus: "routed:decision:task",
  });
  assert.equal(patch.category, "admin");
  assert.match(String(patch.steps), /exact question/i);
  assert.equal(patch.minimumOutcome, "A clear decision or next action is written down");
});

test("blocker capture patch keeps blocked readiness and adds an unblock-oriented starter step", () => {
  const patch = buildCaptureTaskPatch(baseTask("Blocked waiting on Farah for the org chart"), {
    readiness: "blocked",
    blockerReason: "Blocked waiting on Farah for the org chart",
    doneWhen: "The blocker is attached to the right item or resolved",
    minimumOutcome: "The blocker is attached to the right item or resolved",
    sourceStatus: "blocker_update",
  });
  assert.equal(patch.readiness, "blocked");
  assert.match(String(patch.steps), /what is blocked and what would unblock it/i);
  assert.equal(patch.minimumOutcome, "The blocker is attached to the right item or resolved");
});
