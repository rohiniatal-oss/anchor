import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretCapture } from "./captureInterpret";

test("action mode for concrete verbs", () => {
  const r = interpretCapture("Send Sarah the McKinsey referral email");
  assert.equal(r.mode, "action");
  assert.equal(r.confidence, "high");
});

test("research mode for explore + domain", () => {
  const r = interpretCapture("Explore AI strategy roles");
  assert.equal(r.mode, "research");
  assert.equal(r.domain, "AI strategy");
});

test("research mode for get into + field", () => {
  const r = interpretCapture("Get into climate finance");
  assert.equal(r.mode, "research");
  assert.equal(r.domain, "climate finance");
});

test("research mode for break into + industry", () => {
  const r = interpretCapture("Break into public sector AI");
  assert.equal(r.mode, "research");
  assert.equal(r.domain, "public sector AI");
});

test("research mode for look into", () => {
  const r = interpretCapture("Look into AI governance careers");
  assert.equal(r.mode, "research");
});

test("workflow mode for apply to specific org", () => {
  const r = interpretCapture("Apply to RAND AI policy role");
  assert.equal(r.mode, "workflow");
  assert.equal(r.confidence, "high");
});

test("workflow mode for prepare for specific interview", () => {
  const r = interpretCapture("Prepare for Cabinet Office interview");
  assert.equal(r.mode, "workflow");
});

test("decision mode for should-I questions", () => {
  const r = interpretCapture("Should I apply to this fellowship?");
  assert.equal(r.mode, "decision");
});

test("decision mode for compare/choose", () => {
  const r = interpretCapture("Compare consulting vs in-house strategy");
  assert.equal(r.mode, "decision");
});

test("planning mode for what-should-I-do", () => {
  const r = interpretCapture("What should I do today?");
  assert.equal(r.mode, "planning");
});

test("planning mode for prioritise", () => {
  const r = interpretCapture("Prioritise my job search tasks");
  assert.equal(r.mode, "planning");
});

test("ambiguous mode for very short input", () => {
  const r = interpretCapture("AI");
  assert.equal(r.mode, "ambiguous");
  assert.ok(r.clarifyingQuestion);
});

test("ambiguous mode for vague short phrase without domain signal", () => {
  const r = interpretCapture("Maybe something else?");
  assert.equal(r.mode, "ambiguous");
});

test("action mode for simple do-it-now tasks", () => {
  assert.equal(interpretCapture("Pay the course deposit").mode, "action");
  assert.equal(interpretCapture("Book a call with recruiter").mode, "action");
  assert.equal(interpretCapture("Cancel the Zoom subscription").mode, "action");
});

test("research mode takes priority over job for explore + roles", () => {
  const r = interpretCapture("Explore fintech roles in London");
  assert.equal(r.mode, "research");
});

test("workflow mode takes priority for specific apply-to targets", () => {
  const r = interpretCapture("Apply to McKinsey strategy analyst role");
  assert.equal(r.mode, "workflow");
});
