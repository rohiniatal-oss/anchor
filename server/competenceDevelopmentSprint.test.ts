import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetenceEcosystems } from "./competenceEcosystem";
import { buildCompetenceDevelopmentSprints } from "./competenceDevelopmentSprint";

function track(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "ai-governance",
    name: "AI Governance",
    description: "AI governance and frontier model risk work",
    targetRoleArchetype: "AI governance strategy roles",
    priority: 90,
    status: "active",
    whyItFits: "Builds on strategy and delivery experience",
    trackIntelligence: JSON.stringify({ domains: ["risk frameworks", "model governance", "AI regulation"] }),
    createdAt: 1,
    ...overrides,
  } as any;
}

const emptyInput = {
  tracks: [],
  jobs: [],
  learn: [],
  contacts: [],
  hustles: [],
  tasks: [],
  wins: [],
};

function ecosystemsFor(input: Partial<typeof emptyInput> = {}) {
  return buildCompetenceEcosystems({ ...emptyInput, ...input } as any).ecosystems;
}

test("development sprints are read-only and start from the role competency target", () => {
  const ecosystems = ecosystemsFor({
    tracks: [track()],
    learn: [
      { id: 1, title: "AI governance primer", learnStatus: "open", done: false, relatedTrackId: 1, requiredOutput: "terrain map", type: "resource" } as any,
    ],
  });
  const payload = buildCompetenceDevelopmentSprints(ecosystems);
  const sprint = payload.sprints[0];

  assert.equal(payload.readOnlyPreview, true);
  assert.equal(sprint.readOnlyPreview, true);
  assert.equal(sprint.noTasksGenerated, true);
  assert.equal(sprint.targetCompetencyKey, "domain_judgement");
  assert.equal(sprint.targetCompetencyKind, "domain");
  assert.equal(sprint.focusContributor, "practice");
  assert.equal(sprint.developmentObjective, "build_competence");
  assert.match(sprint.thesis, /domain judgement|practice/i);
  assert.match(sprint.rationale, /Practice|Reflection|domain-specific/i);
});

test("each sprint experience has an assessment rubric and task blueprints that do not create live tasks", () => {
  const payload = buildCompetenceDevelopmentSprints(ecosystemsFor({ tracks: [track()] }));
  const sprint = payload.sprints[0];

  assert.ok(sprint.experiences.length >= 1);
  for (const experience of sprint.experiences) {
    assert.ok(experience.assessmentRubric.weak);
    assert.ok(experience.assessmentRubric.adequate);
    assert.ok(experience.assessmentRubric.strong);
    assert.ok(experience.assessmentRubric.evidenceRequired.length >= 1);
    assert.equal(experience.taskBlueprints.length, 3);
    assert.equal(experience.taskBlueprints.every((task) => task.createsLiveTask === false), true);
    for (const task of experience.taskBlueprints) {
      assert.ok(task.completionContract.intent);
      assert.ok(task.completionContract.contract);
      assert.ok(task.completionContract.residueLevel);
      assert.ok(task.completionContract.completionPrompt);
      assert.ok(task.completionContract.afterActionOptions.length >= 1);
    }
  }
});

test("sprint task contracts separate low-residue preparation from rubric-assessed output", () => {
  const sprint = buildCompetenceDevelopmentSprints(ecosystemsFor({ tracks: [track()] })).sprints[0];
  const [prepare, produce, assess] = sprint.experiences[0].taskBlueprints;

  assert.equal(prepare.completionContract.contract, "capture");
  assert.equal(prepare.completionContract.residueLevel, "decision");
  assert.equal(prepare.completionContract.requiresArtifact, false);
  assert.equal(prepare.completionContract.assessmentMode, "choice");

  assert.equal(produce.completionContract.contract, "application");
  assert.equal(produce.completionContract.residueLevel, "note");
  assert.equal(produce.completionContract.assessmentMode, "rubric");

  assert.equal(assess.completionContract.contract, "reflection");
  assert.equal(assess.completionContract.residueLevel, "rubric_score");
});

test("evidence gaps generate create-signal sprints when competence exists but proof is weak", () => {
  const ecosystems = ecosystemsFor({
    tracks: [track()],
    learn: [
      { id: 1, title: "AI governance case analysis", learnStatus: "done", done: true, relatedTrackId: 1, type: "practice", outputTitle: "AI governance case note", outputEvidenceUrl: "https://example.com/case-note" } as any,
    ],
    tasks: [
      { id: 1, title: "Apply AI governance framework to frontier model release", done: true, status: "done", relatedTrackId: 1, sourceNote: "practice case", createdAt: Date.now() } as any,
      { id: 2, title: "Write AI governance judgement log", done: true, status: "done", relatedTrackId: 1, sourceNote: "reflection", createdAt: Date.now() } as any,
    ],
    contacts: [
      { id: 1, who: "AI governance operator", why: "feedback on memo", status: "replied", relatedTrackId: 1, askType: "advice" } as any,
    ],
  });
  const sprint = buildCompetenceDevelopmentSprints(ecosystems).sprints[0];

  assert.ok(["market_signal", "role_context_experience", "professional_operating_capability", "domain_judgement"].includes(sprint.targetCompetencyKey));
  if (sprint.targetCompetencyKind === "evidence") {
    assert.equal(sprint.developmentObjective, "create_signal");
    assert.match(sprint.sprintAssessment.nextIfStrong, /Update the competence ecosystem/i);
  } else {
    assert.notEqual(sprint.developmentObjective, "create_signal", "non-evidence targets should not pretend to be signal sprints");
  }
});

test("empty ecosystem list returns no sprint and a clear summary", () => {
  const payload = buildCompetenceDevelopmentSprints([]);

  assert.equal(payload.sprints.length, 0);
  assert.match(payload.summary, /No active competence ecosystems/i);
});
