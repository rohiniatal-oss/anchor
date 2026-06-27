import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeSignals } from "./signals";
import type { ActivityLog, Learn, UpskillCheckin } from "@shared/schema";

const now = Date.now();
const DAY = 86_400_000;

function ev(eventType: string, ageDays: number): ActivityLog {
  return { id: 1, eventType, sourceType: "", sourceId: null, taskId: null, planItemId: null, metadata: "{}", timestamp: now - ageDays * DAY } as ActivityLog;
}
function learn(over: Partial<Learn>): Learn {
  return { id: 1, title: "L", active: false, done: false, outputStatus: "", outputTitle: "" } as Learn;
}

test("summarizeSignals reports recent completions and skips", () => {
  const bullets = summarizeSignals({
    activityLog: [ev("completed", 1), ev("completed", 2), ev("skipped", 3)],
    learn: [], dayPlans: [], checkins: [],
  });
  assert.match(bullets[0], /2 item\(s\) completed, 1 skipped/);
});

test("summarizeSignals notes nothing logged when activity is old or empty", () => {
  const bullets = summarizeSignals({ activityLog: [ev("completed", 30)], learn: [], dayPlans: [], checkins: [] });
  assert.match(bullets[0], /No completions or skips/);
});

test("summarizeSignals surfaces stalled items, active learning, and the latest check-in", () => {
  const checkins: UpskillCheckin[] = [
    { id: 1, createdAt: now - DAY, trackId: 1, whatsWorking: "", whatsNot: "old", wantToDrop: "", wantToAdd: "", energy: "normal", rawNote: "" },
    { id: 2, createdAt: now, trackId: 1, whatsWorking: "flow", whatsNot: "", wantToDrop: "", wantToAdd: "more writing", energy: "high", rawNote: "" },
  ];
  const bullets = summarizeSignals({
    activityLog: [ev("blocked", 1), ev("parked", 2)],
    learn: [{ ...learn({}), active: true, done: false, title: "EU AI Act" } as Learn],
    dayPlans: [],
    checkins,
  });
  assert.ok(bullets.some((b) => /stalled/.test(b)));
  assert.ok(bullets.some((b) => /EU AI Act/.test(b)));
  const checkinBullet = bullets.find((b) => /check-in/.test(b))!;
  assert.match(checkinBullet, /energy=high/);
  assert.match(checkinBullet, /working: flow/);
});

test("summarizeSignals caps at 5 bullets", () => {
  const bullets = summarizeSignals({
    activityLog: [ev("completed", 1), ev("blocked", 1)],
    learn: [
      { ...learn({}), active: true, title: "A" } as Learn,
      { ...learn({}), outputStatus: "drafting", outputTitle: "Memo" } as Learn,
    ],
    dayPlans: [],
    checkins: [{ id: 1, createdAt: now, trackId: 1, whatsWorking: "x", whatsNot: "", wantToDrop: "", wantToAdd: "", energy: "low", rawNote: "" }],
  });
  assert.ok(bullets.length <= 5);
});
