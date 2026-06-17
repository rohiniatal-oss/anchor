import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { api, makeHarness, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

async function makeTrack(name: string, extra: Record<string, unknown> = {}) {
  return h.storage.createCareerTrack({
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    description: "",
    targetRoleArchetype: name.toLowerCase(),
    priority: 80,
    status: "active",
    whyItFits: "",
    ...extra,
  } as any);
}

test("buildUserContext returns exploration phase when no tracks exist", async () => {
  const { buildUserContext } = await import("./userContext");
  const ctx = await buildUserContext();
  assert.equal(ctx.phase, "exploration");
  assert.ok(ctx.profile.length > 0, "profile should be non-empty");
});

test("buildUserContext returns fit-discovery when active tracks exist but no live jobs", async () => {
  await makeTrack("AI Policy");
  const { buildUserContext } = await import("./userContext");
  const ctx = await buildUserContext();
  assert.equal(ctx.phase, "fit-discovery");
  assert.ok(ctx.trackSummaries.includes("AI Policy"));
});

test("buildUserContext returns active-pursuit when active tracks have live jobs", async () => {
  const track = await makeTrack("Strategy Ops");
  await h.storage.createJob({
    title: "Strategy Analyst",
    company: "TestCorp",
    url: "",
    status: "applied",
    notes: "",
    excitement: 7,
    relatedTrackId: track.id,
  } as any);
  const { buildUserContext } = await import("./userContext");
  const ctx = await buildUserContext();
  assert.equal(ctx.phase, "active-pursuit");
});

test("phase ignores jobs on paused tracks", async () => {
  const paused = await makeTrack("Paused Track", { status: "paused" });
  await h.storage.createJob({
    title: "Some Role",
    company: "Corp",
    url: "",
    status: "applied",
    notes: "",
    excitement: 5,
    relatedTrackId: paused.id,
  } as any);
  const { buildUserContext } = await import("./userContext");
  const ctx = await buildUserContext();
  assert.equal(ctx.phase, "exploration");
});

test("trackSummaries includes only active tracks", async () => {
  await makeTrack("Active Track");
  await makeTrack("Paused Track", { status: "paused" });
  const { buildUserContext } = await import("./userContext");
  const ctx = await buildUserContext();
  assert.ok(ctx.trackSummaries.includes("Active Track"));
  assert.ok(!ctx.trackSummaries.includes("Paused Track"));
});

test("recentWins shows up to 5 most recent wins", async () => {
  for (let i = 0; i < 7; i++) {
    await h.storage.createWin({ text: `Win ${i}`, type: "progress" } as any);
  }
  const { buildUserContext } = await import("./userContext");
  const ctx = await buildUserContext();
  const winCount = ctx.recentWins.split(";").filter((s) => s.trim()).length;
  assert.ok(winCount <= 5, `should show at most 5 wins, got ${winCount}`);
});

test("formatContextForPrompt includes all context sections", async () => {
  await makeTrack("Test Track");
  const { buildUserContext, formatContextForPrompt } = await import("./userContext");
  const ctx = await buildUserContext();
  const prompt = formatContextForPrompt(ctx);
  assert.ok(prompt.includes("User profile:"));
  assert.ok(prompt.includes("Phase:"));
  assert.ok(prompt.includes("Active tracks:"));
  assert.ok(prompt.includes("Activity:"));
});

test("formatContextForPrompt includes CV mention when present", async () => {
  const { formatContextForPrompt } = await import("./userContext");
  const ctx: import("./userContext").UserContext = {
    profile: "Test user",
    cv: "Some CV text",
    phase: "exploration",
    trackSummaries: "",
    recentWins: "",
    activitySignal: "0 tracks producing, 0 planning, 0 idle",
  };
  const prompt = formatContextForPrompt(ctx);
  assert.ok(prompt.includes("CV summary available"));
});

test("formatContextForPrompt omits CV mention when null", async () => {
  const { formatContextForPrompt } = await import("./userContext");
  const ctx: import("./userContext").UserContext = {
    profile: "Test user",
    cv: null,
    phase: "exploration",
    trackSummaries: "",
    recentWins: "",
    activitySignal: "0 tracks producing, 0 planning, 0 idle",
  };
  const prompt = formatContextForPrompt(ctx);
  assert.ok(!prompt.includes("CV"));
});

test("activitySignal reports track activity breakdown", async () => {
  await makeTrack("Active Track");
  const { buildUserContext } = await import("./userContext");
  const ctx = await buildUserContext();
  assert.match(ctx.activitySignal, /\d+ tracks? producing, \d+ planning, \d+ idle/);
});
