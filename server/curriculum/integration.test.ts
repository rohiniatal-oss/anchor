import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "../spine.harness";
import { __setCurriculumLlmForTest } from "./composer";
import { composedArtifactSchema } from "./types";
import { CANONICAL_TECHNIQUE_KEYS } from "./techniques";
import type { ComposedCurriculum } from "./types";

let h: Harness;
const TODAY = new Date().toISOString().slice(0, 10);

// 5-day canned curriculum; days carry technique-driven artifacts so the same
// fixture exercises Today-injection, artifact hydration, and the technique guard.
function canned5(): ComposedCurriculum {
  const day = (n: number, technique?: string) => ({
    title: `Day ${n} — topic ${n}`,
    focus: `focus ${n}`,
    activity: `do activity ${n}`,
    doneWhen: `done test ${n}`,
    hours: 5,
    artifacts: technique
      ? [{ techniqueKey: technique, title: `Artifact: ${technique} ${n}`, prompt: `Produce a ${technique}.`, wordTarget: 300, saveAs: `theme-${technique}-0${n}.md` }]
      : [],
  });
  return {
    theme: "AI strategy, governance, and policy",
    summary: "Interview-ready in one week.",
    weeks: 1,
    hoursPerDay: 5,
    rationale: "Foundations then synthesis.",
    capstone: { shape: "interview_ready", title: "Interview pack", description: "d", doneWhen: "ready" },
    modules: [
      { weekNumber: 1, phaseTitle: "Foundations", title: "Foundations", focus: "fo", objective: "ob", rationale: "frame first",
        sources: [{ tier: "spine", title: "EU AI Act", author: "EU Parliament", url: "search: EU AI Act text", why: "core" }],
        days: [day(1, "bluf"), day(2, "issue_map"), day(3, "comparison_table")] },
      { weekNumber: 1, phaseTitle: "Application", title: "Application", focus: "fa", objective: "oa", rationale: "apply",
        sources: [], days: [day(4, "synthesis_memo"), day(5)] },
    ],
  };
}

before(async () => {
  h = await makeHarness();
  __setCurriculumLlmForTest(async () => canned5());
});
after(async () => { __setCurriculumLlmForTest(null); await h.close(); });
beforeEach(() => { h.reset(); });

async function createTrack(): Promise<number> {
  const res = await api(h.base, "POST", "/api/career-tracks", {
    slug: "ai-strategy", name: "AI strategy, governance, and policy",
    description: "Advising on AI governance and policy", targetRoleArchetype: "AI policy advisor",
    priority: 80, status: "active", whyItFits: "Builds on strategy background",
  });
  assert.equal(res.status, 200);
  return res.json.id;
}

async function compose(trackId: number): Promise<any> {
  const res = await api(h.base, "POST", "/api/curricula/compose", {
    trackId, weeks: 1, hoursPerDay: 5, capstoneShape: "interview_ready", startDate: TODAY,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

test("an active curriculum injects its due day as the Today 'now' anchor", async () => {
  const trackId = await createTrack();
  const curriculum = await compose(trackId);
  const days = curriculum.modules.flatMap((m: any) => m.days);
  const day1Date = days[0].plannedDate; // a weekday on/after TODAY

  // Plan for the day Day 1 is scheduled → Day 1 is due and becomes the anchor.
  const plan = await api(h.base, "POST", "/api/plan/recompute", { day: day1Date });
  assert.equal(plan.status, 200);
  const anchor = plan.json.items.find((i: any) => i.sourceType === "curriculum_day" && i.slot === "now");
  assert.ok(anchor, "expected a curriculum_day anchor in the 'now' slot");
  assert.equal(anchor.title, days[0].title);

  // The link is written back onto the curriculum day.
  const refreshed = await api(h.base, "GET", `/api/curricula/${curriculum.id}`);
  const refreshedDay1 = refreshed.json.modules.flatMap((m: any) => m.days)[0];
  assert.equal(refreshedDay1.dayPlanItemId ?? null, anchor.id);

  // Complete Day 1, then the next weekday should surface Day 2 as the anchor.
  await api(h.base, "POST", `/api/curricula/${curriculum.id}/days/${days[0].id}/complete`, {});
  const day2Date = days[1].plannedDate;
  const plan2 = await api(h.base, "POST", "/api/plan/recompute", { day: day2Date });
  const anchor2 = plan2.json.items.find((i: any) => i.sourceType === "curriculum_day" && i.slot === "now");
  assert.ok(anchor2);
  assert.equal(anchor2.title, days[1].title);
});

test("a track with NO curriculum produces no curriculum injection (unchanged Today)", async () => {
  await createTrack(); // track only, no compose
  const plan = await api(h.base, "POST", "/api/plan/recompute", { day: TODAY });
  assert.equal(plan.status, 200);
  const injected = plan.json.items.filter((i: any) => i.sourceType === "curriculum_day");
  assert.equal(injected.length, 0);
  // Snapshot: the baseline plan for an empty track stays small and curriculum-free.
  const baselineCount = plan.json.items.length;
  const again = await api(h.base, "POST", "/api/plan/recompute", { day: TODAY });
  assert.equal(again.json.items.length, baselineCount);
  assert.equal(again.json.items.filter((i: any) => i.sourceType === "curriculum_day").length, 0);
});

test("getCurriculum hydrates artifacts with global numbering under each day", async () => {
  const trackId = await createTrack();
  const curriculum = await compose(trackId);
  const days = curriculum.modules.flatMap((m: any) => m.days);
  // Days 1-4 carry one artifact each (bluf, issue_map, comparison_table, synthesis_memo); day 5 none.
  assert.equal(days[0].artifacts.length, 1);
  assert.equal(days[4].artifacts.length, 0);
  assert.equal(days[0].artifacts[0].techniqueKey, "bluf");
  assert.equal(days[0].artifacts[0].artifactNumber, 1);
  assert.equal(days[3].artifacts[0].artifactNumber, 4); // numbered globally across the curriculum
  assert.equal(days[0].artifacts[0].status, "pending");
});

test("composedArtifactSchema accepts a well-formed artifact and rejects a malformed one", () => {
  const ok = composedArtifactSchema.safeParse({
    techniqueKey: "bluf", title: "Artifact 1: BLUF", prompt: "Write a BLUF.", wordTarget: 300, saveAs: "x-01.md",
  });
  assert.equal(ok.success, true);
  const bad = composedArtifactSchema.safeParse({ techniqueKey: "bluf", title: "x" }); // missing prompt + saveAs
  assert.equal(bad.success, false);
});

test("every artifact technique_key references a canonical technique (no typos)", async () => {
  const trackId = await createTrack();
  const curriculum = await compose(trackId);
  const days = curriculum.modules.flatMap((m: any) => m.days);
  const keys = days.flatMap((d: any) => d.artifacts.map((a: any) => a.techniqueKey));
  assert.ok(keys.length >= 4);
  for (const k of keys) assert.ok(CANONICAL_TECHNIQUE_KEYS.includes(k), `unknown technique_key: ${k}`);
});
