import assert from "node:assert/strict";
import test from "node:test";
import { inputForTaskResearch } from "./index";

function input(title: string) {
  return {
    task: {
      title,
      category: "thinking",
      doneWhen: "",
      minimumOutcome: "",
      sourceUrl: "",
      sourceNote: "",
      sourceType: "task",
    },
    sourceBundle: {
      sourceContext: "",
      playbook: "",
      sourceKind: "task" as const,
      source: null,
      parentContext: "",
    },
  };
}

test("broad research queries isolate the target for public evidence lookup", () => {
  const adapted = inputForTaskResearch(input("Research TBI so I can decide whether it matters to my search"));
  assert.equal(adapted.task.title, "TBI");
  assert.match(adapted.task.doneWhen || "", /public entity or topic/i);
  assert.match(adapted.task.doneWhen || "", /current landscape/i);
});

test("non-research tasks keep their original provider input", () => {
  const original = input("Send Sarah the deck");
  assert.equal(inputForTaskResearch(original), original);
});
