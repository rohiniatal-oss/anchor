import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, api, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test("job truth strip rejects closed opportunities", async () => {
  const job = await h.storage.createJob({
    title: "Closed Fellowship",
    company: "Example Org",
    status: "wishlist",
    applicationWindowStatus: "closed",
    fitScore: 90,
    strategicValue: 80,
    deadlineConfidence: "high",
    note: "Saved posting",
  } as any);

  const r = await api(h.base, "GET", `/api/jobs/${job.id}/truth-strip`);
  assert.equal(r.status, 200);
  assert.equal(r.json.action, "reject");
  assert.match(r.json.headline, /closed/i);
});

test("job truth strip recommends a contact route when warm score is strong", async () => {
  const job = await h.storage.createJob({
    title: "Policy Advisor",
    company: "Think Tank",
    status: "wishlist",
    applicationWindowStatus: "open",
    fitScore: 76,
    strategicValue: 72,
    warmPathScore: 80,
    applicationReadiness: "cv",
    deadlineConfidence: "high",
    note: "Role details saved",
    narrativeAngle: "Public sector reform and investment strategy experience",
  } as any);

  const r = await api(h.base, "GET", `/api/jobs/${job.id}/truth-strip`);
  assert.equal(r.status, 200);
  assert.equal(r.json.action, "warm");
  assert.match(r.json.nextMove, /message|referral/i);
});

test("job truth strip recommends prove when role is strong but narrative is missing", async () => {
  const job = await h.storage.createJob({
    title: "AI Governance Fellow",
    company: "Policy Lab",
    status: "wishlist",
    applicationWindowStatus: "open",
    fitScore: 82,
    strategicValue: 85,
    warmPathScore: 20,
    applicationReadiness: "cv",
    deadlineConfidence: "high",
    note: "Role details saved",
  } as any);

  const r = await api(h.base, "GET", `/api/jobs/${job.id}/truth-strip`);
  assert.equal(r.status, 200);
  assert.equal(r.json.action, "prove");
  assert.match(r.json.headline, /clearer example|practice first/i);
  assert.match(r.json.nextMove, /Anchor name the weakest requirement/i);
  assert.doesNotMatch(r.json.nextMove, /pick one requirement.*feels weak/i);
});

test("job truth strip recommends apply when fit and readiness are sufficient", async () => {
  const job = await h.storage.createJob({
    title: "Strategy Manager",
    company: "GovTech",
    status: "wishlist",
    applicationWindowStatus: "open",
    fitScore: 72,
    strategicValue: 65,
    warmPathScore: 20,
    applicationReadiness: "cover",
    deadlineConfidence: "high",
    note: "Role details saved",
    narrativeAngle: "Strategy and government advisory overlap",
    relatedTrackId: 1,
  } as any);

  const r = await api(h.base, "GET", `/api/jobs/${job.id}/truth-strip`);
  assert.equal(r.status, 200);
  assert.equal(r.json.action, "apply");
  assert.match(r.json.nextMove, /cover/i);
});

test("job truth strip recommends clarify when source and facts are thin", async () => {
  const job = await h.storage.createJob({
    title: "Interesting Role",
    company: "Unknown",
    status: "wishlist",
    applicationWindowStatus: "open",
    fitScore: 70,
    applicationReadiness: "none",
  } as any);

  const r = await api(h.base, "GET", `/api/jobs/${job.id}/truth-strip`);
  assert.equal(r.status, 200);
  assert.equal(r.json.action, "clarify");
  assert.ok(r.json.risks.includes("Source details are thin"));
  assert.ok(r.json.risks.includes("Needs posting or JD text before Anchor can compare"));
  assert.match(r.json.nextMove, /Save the posting link or JD text/i);
});

test("job truth strips collection returns one strip per job", async () => {
  await h.storage.createJob({ title: "Role A", company: "A", note: "details", deadlineConfidence: "high", applicationReadiness: "cv", narrativeAngle: "A", fitScore: 65 } as any);
  await h.storage.createJob({ title: "Role B", company: "B", applicationWindowStatus: "closed" } as any);

  const r = await api(h.base, "GET", "/api/jobs/truth-strips");
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 2);
  assert.ok(r.json.every((x: any) => x.action && x.headline && x.nextMove));
});

test("job truth strip uses saved role text as analysis material instead of asking the user to list materials", async () => {
  const job = await h.storage.createJob({
    title: "AI Policy Advisor",
    company: "Regulator",
    status: "wishlist",
    applicationWindowStatus: "open",
    applicationReadiness: "none",
    deadlineConfidence: "high",
    jdText: "Application requires CV, cover letter, and answers on technical risk translation.",
    note: "Saved JD text",
    relatedTrackId: 1,
  } as any);

  const r = await api(h.base, "GET", `/api/jobs/${job.id}/truth-strip`);
  assert.equal(r.status, 200);
  assert.equal(r.json.action, "clarify");
  assert.match(r.json.reasons.join(" "), /Role text saved for analysis/i);
  assert.match(r.json.nextMove, /Anchor extract the required materials/i);
  assert.doesNotMatch(r.json.nextMove, /List the exact materials|note exactly what it asks|pick one requirement/i);
});
