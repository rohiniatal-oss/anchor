import assert from "node:assert/strict";
import test from "node:test";
import { completionContractForLearn, completionContractForTask } from "@shared/completionContracts";

test("pure reading learn items use low-residue exposure contracts", () => {
  const contract = completionContractForLearn({
    title: "Read AI governance primer",
    type: "resource",
    note: "Background reading",
    requiredOutput: "",
    outputTitle: "",
    outputStatus: "",
    outputEvidenceUrl: "",
    proofIntent: false,
    capabilityBuilt: "AI governance basics",
    learnStatus: "open",
  } as any);

  assert.equal(contract.contract, "exposure");
  assert.equal(contract.requiresArtifact, false);
  assert.equal(contract.residueLevel, "marker");
});

test("practice learn items use application contracts", () => {
  const contract = completionContractForLearn({
    title: "Apply one AI governance framework to a case",
    type: "practice",
    note: "Case application",
    requiredOutput: "",
    outputTitle: "",
    outputStatus: "",
    outputEvidenceUrl: "",
    proofIntent: false,
    capabilityBuilt: "framework application",
    learnStatus: "open",
  } as any);

  assert.equal(contract.contract, "application");
  assert.equal(contract.assessmentMode, "rubric");
});

test("proof-oriented learn items require deliverable artifacts", () => {
  const contract = completionContractForLearn({
    title: "Write AI governance memo",
    type: "resource",
    note: "",
    requiredOutput: "memo",
    outputTitle: "",
    outputStatus: "idea",
    outputEvidenceUrl: "",
    proofIntent: true,
    capabilityBuilt: "AI governance judgement",
    learnStatus: "open",
  } as any);

  assert.equal(contract.contract, "deliverable");
  assert.equal(contract.requiresArtifact, true);
  assert.equal(contract.residueLevel, "artifact");
});

test("task contracts preserve explicit competence sprint source context", () => {
  const contract = completionContractForTask({
    title: "Prepare the input",
    category: "learning",
    sourceType: "competence_development_sprint",
    sourceStepType: "first_experience_task",
    sourceNote: JSON.stringify({
      taskBlueprint: {
        completionContract: {
          intent: "decide",
          contract: "capture",
          residueLevel: "decision",
          requiresArtifact: false,
          assessmentMode: "choice",
          completionPrompt: "What did you select?",
          afterActionOptions: ["captured", "stop"],
        },
      },
    }),
    doneWhen: "Case selected",
    minimumOutcome: "Case selected",
    steps: "[]",
  } as any);

  assert.equal(contract.contract, "capture");
  assert.equal(contract.residueLevel, "decision");
  assert.equal(contract.requiresArtifact, false);
});

test("ordinary reading tasks do not masquerade as proof", () => {
  const contract = completionContractForTask({
    title: "Read 25 minutes of AI governance primer",
    category: "learning",
    sourceType: "task",
    sourceStepType: "",
    sourceNote: "",
    doneWhen: "Read for 25 minutes",
    minimumOutcome: "Read for 25 minutes",
    steps: "[]",
  } as any);

  assert.equal(contract.contract, "exposure");
  assert.equal(contract.requiresArtifact, false);
});
