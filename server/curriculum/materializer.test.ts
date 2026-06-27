import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, type Harness } from "../spine.harness";
import { persistComposedCurriculum, getCurriculum, getCurriculumEvents } from "./repository";
import { completeDay, skipDay } from "./materializer";
import { exportCurriculumMarkdown } from "./exporter";
import { addDays } from "./dates";
import type { ComposedCurriculum, ComposeInput } from "./types";

let h: Harness;
const START = "2026-01-01";

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

function canned(): ComposedCurriculum {
  const day = (n: number) => ({ title: `Day ${n}`, focus: "f", activity: `act ${n}`, doneWhen: "done", hours: 5 });
  return {
    theme: "Test theme",
    summary: "summary",
    weeks: 2,
    hoursPerDay: 5,
    capstone: { shape: "interview_ready", title: "Cap", description: "desc", doneWhen: "ready" },
    modules: [
      { weekNumber: 1, title: "M1", focus: "focus1", objective: "obj1",
        sources: [{ tier: "spine", title: "S1", author: "A", url: "http://x", why: "core" },
                  { tier: "secondary", title: "S2", author: "", url: "", why: "" }],
        days: [day(1), day(2), day(3)] },
      { weekNumber: 2, title: "M2", focus: "focus2", objective: "obj2",
        sources: [], days: [day(4), day(5), day(6)] },
    ],
  };
}

async function seed(): Promise<number> {
  const track = await h.storage.createCareerTrack({
    slug: "t", name: "Track", description: "", targetRoleArchetype: "", priority: 10, status: "active", whyItFits: "", trackIntelligence: "",
  } as any);
  const input: ComposeInput = { trackId: track.id, weeks: 2, hoursPerDay: 5, capstoneShape: "interview_ready", startDate: START };
  return persistComposedCurriculum(track.id, input, canned());
}

test("persist materialises consecutive planned dates and two-tier sources", async () => {
  const id = await seed();
  const c = getCurriculum(id)!;
  assert.equal(c.modules.length, 2);
  const days = c.modules.flatMap((m) => m.days);
  assert.equal(days.length, 6);
  assert.equal(days[0].plannedDate, START);
  assert.equal(days[1].plannedDate, addDays(START, 1));
  assert.equal(days[5].plannedDate, addDays(START, 5));

  const sources = c.modules[0].sources;
  const spine = sources.find((s) => s.tier === "spine")!;
  const secondary = sources.find((s) => s.tier === "secondary")!;
  assert.equal(spine.verificationStatus, "pending");
  assert.equal(secondary.verificationStatus, "unverified");
});

test("completing a day does not shift the schedule", async () => {
  const id = await seed();
  const before = getCurriculum(id)!;
  const day1 = before.modules[0].days[0];
  const after = completeDay(id, day1.id);
  const days = after.modules.flatMap((m) => m.days);
  assert.equal(days[0].status, "completed");
  assert.equal(days[1].plannedDate, addDays(START, 1));
  assert.equal(days[5].plannedDate, addDays(START, 5));
});

test("skipping a day shifts every later planned day by one", async () => {
  const id = await seed();
  const c = getCurriculum(id)!;
  const allDays = c.modules.flatMap((m) => m.days);
  completeDay(id, allDays[0].id);
  const afterSkip = skipDay(id, allDays[1].id);
  const days = afterSkip.modules.flatMap((m) => m.days);
  assert.equal(days[1].status, "skipped");
  // days after the skipped one slide out by 1 calendar day
  assert.equal(days[2].plannedDate, addDays(START, 3));
  assert.equal(days[5].plannedDate, addDays(START, 6));
});

test("three skips inside the 7-day window fire a slip intervention", async () => {
  const id = await seed();
  const allDays = getCurriculum(id)!.modules.flatMap((m) => m.days);
  skipDay(id, allDays[1].id);
  assert.equal(getCurriculumEvents(id, "slip_intervention").length, 0);
  skipDay(id, allDays[2].id);
  skipDay(id, allDays[3].id);
  const interventions = getCurriculumEvents(id, "slip_intervention");
  assert.equal(interventions.length, 1);
  assert.equal((interventions[0].payload as any).skipsInWindow, 3);
});

test("markdown export contains the expected study-plan structure", async () => {
  const id = await seed();
  const md = exportCurriculumMarkdown(getCurriculum(id)!);
  assert.match(md, /^# Test theme/m);
  assert.match(md, /## Capstone/);
  assert.match(md, /## Week 1 — M1/);
  assert.match(md, /### Spine sources/);
  assert.match(md, /### Daily plan/);
  assert.match(md, /\| ✓ \| Date \| Day \| Focus \| Activity \| Done when \|/);
});
