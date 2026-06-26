import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "@shared/schema";
import { assessExistingTasks } from "./anchorToday";
import { LANE_NAME } from "./lanes";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Assess AI Governance Lead application requirements",
    list: "inbox",
    done: false,
    category: "job",
    doneWhen: "A pursue or stop decision is recorded for this role signal.",
    sourceType: "discovery_option",
    sourceNote: "Role signal with application requirements.",
    blockerReason: "",
    steps: JSON.stringify([{ text: "Open the source link", done: false }]),
    readiness: "ready",
    relatedTrackId: null,
    ...overrides,
  } as Task;
}

test("Today shrinks unassigned discovery tasks to an ownership decision", () => {
  const [assessed] = assessExistingTasks([task()], {
    title: "Apply to AI Governance Lead application requirements",
    lane: LANE_NAME.APPLICATIONS,
  });

  assert.equal(assessed.action, "shrink");
  assert.match(assessed.reason, /direction assignment or parking/);
  assert.equal(assessed.firstStep, "Assign this discovery result to a career direction, intentionally park it, or stop it.");
});

test("Today can use track-linked discovery tasks normally", () => {
  const [assessed] = assessExistingTasks([task({ id: 2, relatedTrackId: 7 })], {
    title: "Apply to AI Governance Lead application requirements",
    lane: LANE_NAME.APPLICATIONS,
  });

  assert.equal(assessed.action, "use");
  assert.equal(assessed.reason, "This already lines up with the best next move right now.");
  assert.equal(assessed.firstStep, "Open the source link");
});
