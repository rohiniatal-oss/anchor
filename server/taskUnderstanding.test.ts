import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicTaskBrief,
  isWeakTaskStep,
  resolveTaskTarget,
  shouldUnderstandTask,
  taskPatchFromBrief,
} from "./taskUnderstanding";
import { normalizeContextForUnderstanding } from "./taskUnderstandingService";

const careerContext = normalizeContextForUnderstanding([
  "User profile: Rohini is an ex-Bain consultant and ex-Tony Blair Institute operator.",
  "Explicit goals/preferences: Target role types: AI governance, strategic advisory, and chief of staff.",
  "Active tracks: AI governance strategy; government delivery.",
].join("\n"));

function broadTask(title: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    category: "admin",
    sourceType: "task",
    sourceNote: "",
    doneWhen: "You've done something concrete, even if small",
    minimumOutcome: "You've done something concrete, even if small",
    steps: JSON.stringify([{ text: "Write one rough sentence to break the blank page", done: false }]),
    readiness: "ready",
    size: "deep",
    estimateMinutes: 90,
    ...extra,
  } as any;
}

test("relationship phrasing is normalized before semantic understanding", () => {
  assert.match(careerContext, /ex Tony Blair Institute/);
  assert.doesNotMatch(careerContext, /ex-Tony Blair Institute/);
});

test("acronyms resolve from user context without a target-specific alias table", () => {
  const resolved = resolveTaskTarget("TBI", careerContext);
  assert.equal(resolved.value, "Tony Blair Institute");
  assert.equal(resolved.confidence, "high");
});

test("research first understands target, relationship, goal and output", () => {
  const brief = buildDeterministicTaskBrief(broadTask("Research TBI"), careerContext);
  assert.ok(brief);
  assert.equal(brief.kind, "research");
  assert.equal(brief.resolvedTarget, "Tony Blair Institute");
  assert.equal(brief.needsClarification, false);
  assert.match(brief.objective, /prior experience|present goals/i);
  assert.match(brief.doneWhen, /sourced brief/i);
  assert.match(brief.steps.join(" "), /primary or authoritative source/i);
  assert.match(brief.steps.join(" "), /next action|decision/i);
  assert.doesNotMatch(brief.steps.join(" "), /rough sentence|blank page|something concrete/i);
});

test("unknown research purpose asks one useful question instead of inventing work", () => {
  const brief = buildDeterministicTaskBrief(broadTask("Research QZX"), "");
  assert.ok(brief);
  assert.equal(brief.kind, "research");
  assert.equal(brief.needsClarification, true);
  assert.equal(brief.steps.length, 0);
  assert.match(brief.clarifyingQuestion, /help you decide or do/i);
});

test("explicit research purpose produces a bounded source-led plan", () => {
  const brief = buildDeterministicTaskBrief(
    broadTask("Research Acme so I can decide whether to apply"),
    "Explicit goals/preferences: Target role types: operations leadership.",
  );
  assert.ok(brief);
  assert.equal(brief.needsClarification, false);
  assert.equal(brief.target, "Acme");
  assert.match(brief.objective, /decide whether to apply/i);
  assert.match(brief.doneWhen, /source links/i);
  assert.equal(brief.steps.length, 4);
});

test("decision tasks define options, criteria, choice and next action", () => {
  const brief = buildDeterministicTaskBrief(broadTask("Think about London vs Dubai"), careerContext);
  assert.ok(brief);
  assert.equal(brief.kind, "decision");
  assert.match(brief.doneWhen, /options, three decision criteria, current choice/i);
  assert.match(brief.steps.join(" "), /evidence for and against/i);
});

test("preparation tasks produce a usable brief rather than generic effort", () => {
  const brief = buildDeterministicTaskBrief(broadTask("Prepare for the policy interview"), careerContext);
  assert.ok(brief);
  assert.equal(brief.kind, "preparation");
  assert.equal(brief.needsClarification, false);
  assert.match(brief.desiredOutput, /preparation brief/i);
  assert.match(brief.steps.join(" "), /highest-risk point/i);
});

test("review, creation and improvement receive distinct output contracts", () => {
  const review = buildDeterministicTaskBrief(broadTask("Review my CV"), careerContext);
  const creation = buildDeterministicTaskBrief(broadTask("Draft the policy memo"), careerContext);
  const improvement = buildDeterministicTaskBrief(broadTask("Improve my portfolio"), careerContext);
  assert.equal(review?.kind, "review");
  assert.match(review?.doneWhen || "", /checked against explicit criteria/i);
  assert.equal(creation?.kind, "creation");
  assert.match(creation?.doneWhen || "", /saved first version/i);
  assert.equal(improvement?.kind, "improvement");
  assert.match(improvement?.doneWhen || "", /baseline problem/i);
});

test("vague organization work is clarified when no purpose can be grounded", () => {
  const brief = buildDeterministicTaskBrief(broadTask("Work on the project"), "");
  assert.ok(brief);
  assert.equal(brief.kind, "organization");
  assert.equal(brief.needsClarification, true);
  assert.match(brief.clarifyingQuestion, /what outcome/i);
});

test("precise atomic tasks bypass semantic replanning", () => {
  assert.equal(shouldUnderstandTask({
    title: "Send Sarah the deck",
    doneWhen: "The deck is sent to Sarah",
    steps: JSON.stringify([{ text: "Open the email thread and attach the deck", done: false }]),
  }), false);
});

test("task patch replaces only weak generated metadata", () => {
  const task = broadTask("Research TBI");
  const brief = buildDeterministicTaskBrief(task, careerContext);
  assert.ok(brief);
  const patch = taskPatchFromBrief(task, brief);
  const steps = JSON.parse(String(patch.steps));
  assert.match(String(patch.doneWhen), /sourced brief/i);
  assert.equal(patch.estimateReason, "task_brief_v1");
  assert.equal(steps.length, 4);
  assert.equal(steps.some((step: any) => isWeakTaskStep(step.text)), false);
});

test("task patch preserves a user-authored outcome and real steps", () => {
  const task = broadTask("Review the board pack", {
    doneWhen: "A one-page red-flag note is sent to the chair",
    minimumOutcome: "Three material red flags with page references",
    steps: JSON.stringify([{ text: "Open the board pack and mark the three pages with financial risk", done: false }]),
    estimateMinutes: 50,
  });
  const brief = buildDeterministicTaskBrief(task, "User context: prepare the chair for tomorrow's meeting.");
  assert.ok(brief);
  const patch = taskPatchFromBrief(task, brief);
  assert.equal("doneWhen" in patch, false);
  assert.equal("minimumOutcome" in patch, false);
  assert.equal("steps" in patch, false);
  assert.equal(patch.estimateMinutes, 50);
});
