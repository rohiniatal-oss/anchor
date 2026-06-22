import { test } from "node:test";
import assert from "node:assert/strict";
import { isGenericContactPlaceholder, nextContactTaskTitle, normalizeContactWho } from "./taskPreview";

test("generic contact task previews ask you to identify the right person first", () => {
  assert.equal(
    nextContactTaskTitle({
      who: "Bain alum",
      name: "",
      askType: "soft",
      targetRole: "AI strategy roles",
      targetOrg: "",
      status: "to_contact",
      messageDraft: "",
    }),
    "Find one Bain alum to ask about AI strategy roles",
  );
});

test("contact task previews reflect relationship state", () => {
  assert.equal(
    nextContactTaskTitle({
      who: "Priya",
      name: "",
      askType: "follow_up",
      targetRole: "AI governance",
      targetOrg: "Ofcom",
      status: "messaged",
      messageDraft: "",
    }),
    "Follow up with Priya about AI governance at Ofcom",
  );
});

test("generic contact placeholder detection distinguishes archetypes from named people", () => {
  assert.equal(isGenericContactPlaceholder({ name: "", who: "Bain alum" } as any), true);
  assert.equal(isGenericContactPlaceholder({ name: "", who: "Sarah Malik" } as any), false);
});

test("legacy raw outreach contact labels are normalized for display", () => {
  assert.equal(
    normalizeContactWho("Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat"),
    "a Bain alum",
  );
  assert.equal(
    nextContactTaskTitle({
      who: "Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat",
      name: "",
      askType: "soft",
      targetRole: "",
      targetOrg: "",
      status: "to_contact",
      messageDraft: "",
    }),
    "Find one Bain alum to ask about AI strategy roles",
  );
});
