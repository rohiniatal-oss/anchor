import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { computeRecommendedMove } from "./networkStrategy";
import { api, makeHarness, type Harness } from "./spine.harness";

let h: Harness;

before(async () => { h = await makeHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

function contact(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Ally",
    who: overrides.who ?? "Ally at Example",
    sector: overrides.sector ?? "",
    why: overrides.why ?? "",
    status: overrides.status ?? "to_contact",
    note: overrides.note ?? "",
    relationshipStrength: overrides.relationshipStrength ?? "cold",
    sourceNetwork: overrides.sourceNetwork ?? "",
    targetOrg: overrides.targetOrg ?? "",
    targetRole: overrides.targetRole ?? "",
    askType: overrides.askType ?? "soft",
    messageDraft: overrides.messageDraft ?? "",
    lastMessage: overrides.lastMessage ?? "",
    nextFollowUpDate: overrides.nextFollowUpDate ?? "",
    referralPotential: overrides.referralPotential ?? "",
    warmthScore: overrides.warmthScore ?? null,
    relatedTrackId: overrides.relatedTrackId ?? null,
    outreachedAt: overrides.outreachedAt ?? null,
    repliedAt: overrides.repliedAt ?? null,
    nextActionType: overrides.nextActionType ?? "",
    nextActionDue: overrides.nextActionDue ?? null,
    nextActionDesc: overrides.nextActionDesc ?? "",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  } as any;
}

function job(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Role",
    company: overrides.company ?? "Example",
    location: overrides.location ?? "",
    url: overrides.url ?? "",
    note: overrides.note ?? "",
    nextStep: overrides.nextStep ?? "",
    status: overrides.status ?? "wishlist",
    deadline: overrides.deadline ?? "",
    flag: overrides.flag ?? "",
    roleArchetype: overrides.roleArchetype ?? "",
    opportunityKind: overrides.opportunityKind ?? "job",
    fitScore: overrides.fitScore ?? null,
    stretchScore: overrides.stretchScore ?? null,
    strategicValue: overrides.strategicValue ?? null,
    frictionScore: overrides.frictionScore ?? null,
    eligibilityRisk: overrides.eligibilityRisk ?? "",
    warmPathScore: overrides.warmPathScore ?? null,
    applicationReadiness: overrides.applicationReadiness ?? "none",
    narrativeAngle: overrides.narrativeAngle ?? "",
    relatedTrackId: overrides.relatedTrackId ?? null,
    sourceUrl: overrides.sourceUrl ?? "",
    sourceType: overrides.sourceType ?? "posting",
    sourceCheckedAt: overrides.sourceCheckedAt ?? null,
    deadlineConfidence: overrides.deadlineConfidence ?? "",
    applicationWindowStatus: overrides.applicationWindowStatus ?? "open",
    jdText: overrides.jdText ?? "",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  } as any;
}

function track(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    slug: overrides.slug ?? "ai-strategy",
    name: overrides.name ?? "AI strategy",
    description: overrides.description ?? "",
    targetRoleArchetype: overrides.targetRoleArchetype ?? "",
    priority: overrides.priority ?? 0,
    status: overrides.status ?? "active",
    whyItFits: overrides.whyItFits ?? "",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  } as any;
}

test("near-peer contact does not trigger referral ask from unrelated live job", async () => {
  const move = await computeRecommendedMove(
    contact({
      relationshipStrength: "warm",
      targetOrg: "Palantir",
      targetRole: "AI strategy",
      relatedTrackId: 1,
    }),
    {
      archetype: "near_peer",
      relevanceScore: 5,
      accessTypes: ["advice"],
      reasoning: "Relevant near-peer",
    },
    track({ id: 1, name: "AI strategy" }),
    [
      job({
        id: 7,
        title: "Geopolitics advisor",
        company: "Chatham House",
        relatedTrackId: 2,
        status: "applied",
      }),
    ],
  );

  assert.equal(move.moveType, "advice");
  assert.match(move.reason, /ground truth/i);
});

test("near-peer contact can trigger referral ask when a relevant live job exists", async () => {
  const move = await computeRecommendedMove(
    contact({
      relationshipStrength: "warm",
      targetOrg: "Palantir",
      targetRole: "AI strategy",
      relatedTrackId: 1,
    }),
    {
      archetype: "near_peer",
      relevanceScore: 5,
      accessTypes: ["advice", "referral"],
      reasoning: "Relevant near-peer",
    },
    track({ id: 1, name: "AI strategy" }),
    [
      job({
        id: 8,
        title: "AI strategy manager",
        company: "Palantir",
        relatedTrackId: 1,
        status: "applied",
      }),
    ],
  );

  assert.equal(move.moveType, "referral");
  assert.match(move.reason, /live relevant role/i);
});

test("recommend-move route ignores unrelated live jobs for a contact", async () => {
  const aiTrack = await h.storage.createCareerTrack({
    slug: "ai-strategy",
    name: "AI strategy",
    description: "",
    targetRoleArchetype: "",
    priority: 0,
    status: "active",
    whyItFits: "",
  } as any);
  const geoTrack = await h.storage.createCareerTrack({
    slug: "geopolitics",
    name: "Geopolitics",
    description: "",
    targetRoleArchetype: "",
    priority: 0,
    status: "active",
    whyItFits: "",
  } as any);

  const created = await h.storage.createContact({
    name: "Ally",
    who: "AI strategy operator at Palantir",
    sector: "",
    why: "",
    status: "to_contact",
    note: "",
    relationshipStrength: "warm",
    sourceNetwork: "",
    targetOrg: "Palantir",
    targetRole: "AI strategy",
    askType: "soft",
    messageDraft: "",
    lastMessage: "",
    nextFollowUpDate: "",
    referralPotential: "",
    warmthScore: null,
    relatedTrackId: aiTrack.id,
  } as any);

  await h.storage.upsertContactClassifications(created.id, [{
    contactId: created.id,
    trackId: aiTrack.id,
    archetype: "near_peer",
    relevanceScore: 5,
    accessTypes: "[]",
    reasoning: "Relevant near-peer",
  } as any]);

  await h.storage.createJob(job({
    title: "Geopolitics advisor",
    company: "Chatham House",
    relatedTrackId: geoTrack.id,
    status: "applied",
  }) as any);

  const result = await api(h.base, "POST", `/api/contacts/${created.id}/recommend-move`, {});
  assert.equal(result.status, 200);
  assert.equal(result.json.move.moveType, "advice");
});

test("contact deletion removes networking side tables too", async () => {
  const created = await h.storage.createContact({
    name: "Ally",
    who: "Ally at Example",
    sector: "",
    why: "",
    status: "to_contact",
    note: "",
    relationshipStrength: "warm",
    sourceNetwork: "",
    targetOrg: "",
    targetRole: "",
    askType: "soft",
    messageDraft: "",
    lastMessage: "",
    nextFollowUpDate: "",
    referralPotential: "",
    warmthScore: null,
    relatedTrackId: 1,
  } as any);

  await h.storage.upsertContactClassifications(created.id, [{
    contactId: created.id,
    trackId: 1,
    archetype: "near_peer",
    relevanceScore: 4,
    accessTypes: "[]",
    reasoning: "Useful contact",
  } as any]);
  await h.storage.createContactInteraction({ contactId: created.id, type: "outreach", note: "" } as any);

  await h.storage.deleteContact(created.id);

  assert.equal((await h.storage.getContacts()).length, 0);
  assert.equal((await h.storage.getContactClassifications(created.id)).length, 0);
  assert.equal((await h.storage.getContactInteractions(created.id)).length, 0);
});

test("contact status transitions stamp outreach and reply timestamps", async () => {
  const created = await h.storage.createContact({
    name: "Ally",
    who: "Ally at Example",
    sector: "",
    why: "",
    status: "to_contact",
    note: "",
    relationshipStrength: "warm",
    sourceNetwork: "",
    targetOrg: "",
    targetRole: "",
    askType: "soft",
    messageDraft: "",
    lastMessage: "",
    nextFollowUpDate: "",
    referralPotential: "",
    warmthScore: null,
    relatedTrackId: 1,
  } as any);

  const messaged = await h.storage.updateContact(created.id, { status: "messaged" } as any);
  assert.equal(messaged?.status, "messaged");
  assert.ok(messaged?.outreachedAt);

  const replied = await h.storage.updateContact(created.id, { status: "replied" } as any);
  assert.equal(replied?.status, "replied");
  assert.equal(replied?.outreachedAt, messaged?.outreachedAt);
  assert.ok(replied?.repliedAt);
});

test("logging a note does not wipe the active follow-up state", async () => {
  const created = await h.storage.createContact({
    name: "Ally",
    who: "Ally at Example",
    sector: "",
    why: "",
    status: "to_contact",
    note: "",
    relationshipStrength: "warm",
    sourceNetwork: "",
    targetOrg: "",
    targetRole: "",
    askType: "soft",
    messageDraft: "",
    lastMessage: "",
    nextFollowUpDate: "",
    referralPotential: "",
    warmthScore: null,
    relatedTrackId: 1,
  } as any);

  const outreach = await api(h.base, "POST", `/api/contacts/${created.id}/log-interaction`, { type: "outreach" });
  assert.equal(outreach.status, 200);
  assert.equal(outreach.json.contact.status, "messaged");
  assert.equal(outreach.json.contact.nextActionType, "follow_up");
  assert.ok(outreach.json.contact.nextFollowUpDate);

  const noted = await api(h.base, "POST", `/api/contacts/${created.id}/log-interaction`, { type: "note", note: "Met via alumni event" });
  assert.equal(noted.status, 200);
  assert.equal(noted.json.contact.status, "messaged");
  assert.equal(noted.json.contact.nextActionType, "follow_up");
  assert.equal(noted.json.contact.nextFollowUpDate, outreach.json.contact.nextFollowUpDate);
});
