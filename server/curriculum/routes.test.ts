import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "../spine.harness";
import { __setCurriculumLlmForTest } from "./composer";
import { addDays } from "./dates";
import type { ComposedCurriculum } from "./types";

let h: Harness;
const START = "2026-03-02";

function canned(): ComposedCurriculum {
  const day = (n: number) => ({ title: `Day ${n}`, focus: "f", activity: `act ${n}`, doneWhen: "done", hours: 5 });
  return {
    theme: "AI strategy, governance, and policy",
    summary: "Interview-ready in two weeks.",
    weeks: 2,
    hoursPerDay: 5,
    capstone: { shape: "interview_ready", title: "Interview pack", description: "d", doneWhen: "ready" },
    modules: [
      { weekNumber: 1, title: "Foundations", focus: "fo", objective: "ob",
        sources: [{ tier: "spine", title: "EU AI Act", author: "EU", url: "", why: "core" }],
        days: [day(1), day(2), day(3)] },
      { weekNumber: 2, title: "Application", focus: "fa", objective: "oa", sources: [],
        days: [day(4), day(5), day(6)] },
    ],
  };
}

before(async () => {
  h = await makeHarness();
  __setCurriculumLlmForTest(async () => canned());
});
after(async () => { __setCurriculumLlmForTest(null); await h.close(); });
beforeEach(() => { h.reset(); });

async function createTrack(): Promise<number> {
  const res = await api(h.base, "POST", "/api/career-tracks", {
    slug: "ai-strategy",
    name: "AI strategy, governance, and policy",
    description: "Advising on AI governance and policy",
    targetRoleArchetype: "AI policy advisor",
    priority: 80,
    status: "active",
    whyItFits: "Builds on strategy background",
  });
  assert.equal(res.status, 200);
  return res.json.id;
}

test("compose → fetch → complete → skip → slip intervention over HTTP", async () => {
  const trackId = await createTrack();

  const composeRes = await api(h.base, "POST", "/api/curricula/compose", {
    trackId, weeks: 2, hoursPerDay: 5, capstoneShape: "interview_ready", startDate: START,
  });
  assert.equal(composeRes.status, 201);
  const curriculumId = composeRes.json.id;
  assert.equal(composeRes.json.theme, "AI strategy, governance, and policy");

  const fetched = await api(h.base, "GET", `/api/curricula/${curriculumId}`);
  assert.equal(fetched.status, 200);
  const days = fetched.json.modules.flatMap((m: any) => m.days);
  assert.equal(days.length, 6);
  assert.equal(days[0].plannedDate, START);

  // complete day 1
  const c1 = await api(h.base, "POST", `/api/curricula/${curriculumId}/days/${days[0].id}/complete`, {});
  assert.equal(c1.status, 200);

  // skip day 2 → later planned dates shift by 1
  const s1 = await api(h.base, "POST", `/api/curricula/${curriculumId}/days/${days[1].id}/skip`, {});
  assert.equal(s1.status, 200);
  const afterSkipDays = s1.json.modules.flatMap((m: any) => m.days);
  assert.equal(afterSkipDays[1].status, "skipped");
  assert.equal(afterSkipDays[2].plannedDate, addDays(START, 3));
  assert.equal(afterSkipDays[5].plannedDate, addDays(START, 6));

  // no intervention yet
  let events = await api(h.base, "GET", `/api/curricula/${curriculumId}/events`);
  assert.equal(events.json.filter((e: any) => e.eventType === "slip_intervention").length, 0);

  // skip 2 more within the 7-day window → slip intervention fires
  await api(h.base, "POST", `/api/curricula/${curriculumId}/days/${days[2].id}/skip`, {});
  await api(h.base, "POST", `/api/curricula/${curriculumId}/days/${days[3].id}/skip`, {});

  events = await api(h.base, "GET", `/api/curricula/${curriculumId}/events`);
  const interventions = events.json.filter((e: any) => e.eventType === "slip_intervention");
  assert.equal(interventions.length, 1);
});

test("compose returns a clear error when the composer yields nothing", async () => {
  const trackId = await createTrack();
  __setCurriculumLlmForTest(async () => null);
  try {
    const res = await api(h.base, "POST", "/api/curricula/compose", {
      trackId, weeks: 2, hoursPerDay: 5, capstoneShape: "interview_ready",
    });
    assert.equal(res.status, 502);
    assert.equal(res.json.code, "empty_model_output");
  } finally {
    __setCurriculumLlmForTest(async () => canned());
  }
});

test("compose 404s for an unknown track", async () => {
  const res = await api(h.base, "POST", "/api/curricula/compose", {
    trackId: 999999, weeks: 2, hoursPerDay: 5, capstoneShape: "interview_ready",
  });
  assert.equal(res.status, 404);
});

test("export endpoint returns markdown", async () => {
  const trackId = await createTrack();
  const composeRes = await api(h.base, "POST", "/api/curricula/compose", {
    trackId, weeks: 2, hoursPerDay: 5, capstoneShape: "interview_ready", startDate: START,
  });
  const id = composeRes.json.id;
  const res = await fetch(`${h.base}/api/curricula/${id}/export`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(text, /# AI strategy, governance, and policy/);
  assert.match(text, /## Week 1 — Foundations/);
});
