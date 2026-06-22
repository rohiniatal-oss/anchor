import { test } from "node:test";
import assert from "node:assert/strict";
import { nextContactTaskTitle } from "./taskPreview";

test("contact task previews include the ask and opportunity context", () => {
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
    "Draft a 15-minute chat ask to Bain alum about AI strategy roles",
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
