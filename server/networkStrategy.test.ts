import test from "node:test";
import assert from "node:assert/strict";
import { filterTrackRelevantContacts } from "./networkStrategy";

test("filterTrackRelevantContacts keeps explicit track-linked contacts", () => {
  const track = {
    id: 7,
    name: "AI strategy",
    targetRoleArchetype: "AI strategy / advisory",
    slug: "ai-strategy",
  } as any;

  const contacts = [
    { id: 1, who: "Operator", relatedTrackId: 7, targetRole: "", targetOrg: "", sector: "", why: "", sourceNetwork: "" },
    { id: 2, who: "Unrelated", relatedTrackId: 3, targetRole: "", targetOrg: "", sector: "", why: "", sourceNetwork: "" },
  ] as any[];

  const result = filterTrackRelevantContacts(track, contacts);
  assert.deepEqual(result.map((c) => c.id), [1]);
});

test("filterTrackRelevantContacts keeps text-relevant contacts even without explicit track link", () => {
  const track = {
    id: 7,
    name: "AI strategy",
    targetRoleArchetype: "AI strategy / advisory",
    slug: "ai-strategy",
  } as any;

  const contacts = [
    { id: 1, who: "AI strategy operator", relatedTrackId: null, targetRole: "AI strategy manager", targetOrg: "", sector: "AI", why: "Relevant to AI strategy roles", sourceNetwork: "" },
    { id: 2, who: "Healthcare investor", relatedTrackId: null, targetRole: "PE associate", targetOrg: "", sector: "healthcare", why: "Nothing to do with the track", sourceNetwork: "" },
  ] as any[];

  const result = filterTrackRelevantContacts(track, contacts);
  assert.deepEqual(result.map((c) => c.id), [1]);
});

test("filterTrackRelevantContacts does not fall back to the full contact book", () => {
  const track = {
    id: 11,
    name: "Geopolitical advisory",
    targetRoleArchetype: "geopolitical advisory",
    slug: "geopolitical-advisory",
  } as any;

  const contacts = [
    { id: 1, who: "AI strategy operator", relatedTrackId: null, targetRole: "AI strategy manager", targetOrg: "", sector: "AI", why: "AI strategy", sourceNetwork: "" },
    { id: 2, who: "General Bain alum", relatedTrackId: null, targetRole: "", targetOrg: "", sector: "", why: "Broad alumni connection only", sourceNetwork: "Bain" },
  ] as any[];

  const result = filterTrackRelevantContacts(track, contacts);
  assert.equal(result.length, 0);
});
