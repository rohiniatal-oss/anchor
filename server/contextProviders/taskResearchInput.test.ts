import assert from "node:assert/strict";
import test from "node:test";
import { inputForTaskResearch, inputForTaskSearch } from "./index";

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
  const adapted = inputForTaskSearch(input("Research TBI so I can decide whether it matters to my search"));
  assert.equal(adapted.task.title, "TBI");
  assert.match(adapted.task.doneWhen || "", /public entity/i);
  assert.match(adapted.task.doneWhen || "", /current landscape/i);
});

test("search, find, and shortlist commands also isolate the public lookup target", () => {
  assert.equal(inputForTaskSearch(input("Find three AI governance roles")).task.title, "three AI governance roles");
  assert.equal(inputForTaskSearch(input("Search for Bain alumni in AI strategy")).task.title, "Bain alumni in AI strategy");
  assert.equal(inputForTaskSearch(input("Shortlist courses on AI safety")).task.title, "courses on AI safety");
});

test("legacy inputForTaskResearch export remains compatible", () => {
  assert.equal(inputForTaskResearch(input("Look up OpenAI policy roles")).task.title, "OpenAI policy roles");
});

test("non-search tasks keep their original provider input", () => {
  const original = input("Send Sarah the deck");
  assert.equal(inputForTaskSearch(original), original);
});
