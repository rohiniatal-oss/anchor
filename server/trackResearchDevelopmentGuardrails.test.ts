import assert from "node:assert/strict";
import test from "node:test";
import type { RequirementCategory, RequirementConfidence, RequirementImportance, RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";
import type { CoverageModel, CoverageStatus, RequirementCoverage } from "./trackResearchCoverageModel";
import { buildDevelopmentPlanModel } from "./trackResearchDevelopmentPlan";
import { hardenDevelopmentPlan } from "./trackResearchDevelopmentGuardrails";

function requirement(
  id: string,
  category: RequirementCategory,
  label: string,
  options: {
    importance?: RequirementImportance;
    confidence?: RequirementConfidence;
    scope?: "shared" | "role_specific";
  } = {},
): TargetRequirement {
  const scope = options.scope || "shared";
  return {
    id,
    key: `${category}:${label.toLowerCase()}`,
    label,
    aliases: [],
    definition: `${label} for the selected target.`,
    group: category === "knowledge" || category === "skill"
      ? "perform_work"
      : category === "network" || category === "access" || category === "eligibility"
        ? "access_opportunity"
        : "demonstrate_credibility",
    category,
    importance: options.importance || "important",
    importanceReason: "Supported by the requirement model.",
    scope,
    roleFamilyIds: scope === "role_specific" ? ["role-a"] : [],
    successBar: `Can demonstrate ${label} to the target-role standard.`,
    evidenceClaimIds: [],
    confidence: options.confidence || "high",
    context: { seniority: [], geographies: [], employerTypes: [], notes: [] },
  };
}

function requirementModel(requirements: TargetRequirement[], roleFamilyCount = 2): RequirementModel {
  return {
    mode: "requirement_model",
    version: 2,
    sourceFingerprint: "market-source-fingerprint",
    sourceResearchAt: 1,
    target: { label: "Geopolitical strategy", definition: "Selected target", assumption: "Chosen" },
    marketSegments: [],
    roleFamilies: Array.from({ length: roleFamilyCount }, (_, index) => ({
      id: index === 0 ? "role-a" : `role-${index + 1}`,
      title: `Role family ${index + 1}`,
      description: "",
      typicalOrganizations: [],
      seniority: "mixed",
      marketSegmentIds: [],
      evidenceClaimIds: [],
    })),
    groups: [
      { id: "perform_work", label: "Perform the work", description: "", requirementIds: requirements.filter((item) => item.group === "perform_work").map((item) => item.id) },
      { id: "demonstrate_credibility", label: "Demonstrate credibility", description: "", requirementIds: requirements.filter((item) => item.group === "demonstrate_credibility").map((item) => item.id) },
      { id: "access_opportunity", label: "Access the opportunity", description: "", requirementIds: requirements.filter((item) => item.group === "access_opportunity").map((item) => item.id) },
    ],
    requirements,
    evidenceClaims: [],
    researchQuality: {
      status: "usable",
      sourceCount: 8,
      directSourceCount: 3,
      sourceTypeCount: 3,
      requirementEvidenceCoverage: 80,
      directRequirementCoverage: 40,
      caveats: [],
    },
    boundaries: { includes: [], excludes: [], openQuestions: [] },
    generatedAt: 1,
  };
}

function coverage(requirementId: string, status: CoverageStatus): RequirementCoverage {
  return {
    requirementId,
    status,
    confidence: status === "unknown" ? "low" : "medium",
    evidenceItemIds: status === "proven" || status === "partially_proven" ? [`evidence-${requirementId}`] : [],
    reason: `Coverage is ${status}.`,
    successBarAssessment: "Compared with the observable success bar.",
    evidenceStillNeeded: status === "proven" ? [] : ["Direct evidence against the success bar"],
    sourceBasis: "llm",
  };
}

function coverageModel(requirements: TargetRequirement[], statuses: Record<string, CoverageStatus>, quality: CoverageModel["quality"]["status"] = "usable"): CoverageModel {
  const rows = requirements.map((item) => coverage(item.id, statuses[item.id] || "unknown"));
  return {
    mode: "coverage_model",
    version: 1,
    targetLabel: "Geopolitical strategy",
    requirementModelVersion: 2,
    requirementModelFingerprint: "exact-requirement-fingerprint",
    userEvidenceFingerprint: "user-evidence-fingerprint",
    coverage: rows,
    evidenceItems: [],
    sourceInventory: { cv: 1, profile_summary: 0, win: 1, learning_output: 0, completed_learning: 0, proof_asset: 0, relationship: 0, interaction: 0 },
    groups: [],
    quality: {
      status: quality,
      assessedRequirementCount: rows.filter((row) => row.status !== "unknown").length,
      unknownRequirementCount: rows.filter((row) => row.status === "unknown").length,
      citedEvidenceCount: 2,
      directEvidenceCount: 0,
      assessmentCoverage: 70,
      caveats: [],
    },
    generatedAt: 1,
  };
}

test("unknown requirements remain verification even when LLM proposes learning", () => {
  const req = requirement("knowledge", "knowledge", "Political economy knowledge");
  const requirements = requirementModel([req]);
  const coverageData = coverageModel([req], { knowledge: "unknown" });
  const raw = buildDevelopmentPlanModel(requirements, coverageData, "context", {
    workstreams: [{
      title: "Learn political economy",
      objective: "Assume the capability is missing.",
      rationale: "LLM proposal",
      requirementIds: [req.id],
      methods: ["learn"],
      modules: [{
        title: "Political economy course",
        type: "syllabus",
        scope: "core",
        objective: "Learn the topic",
        requirementIds: [req.id],
        resources: [],
        activities: ["Take a course"],
        output: "Course completion",
        assessmentCriteria: [req.successBar],
      }],
      milestones: [],
      dependencyNotes: [],
      completionStandard: "Course completed",
    }],
  });
  const hardened = hardenDevelopmentPlan(raw, requirements, coverageData);

  assert.equal(hardened.decisions[0]?.action, "verify");
  assert.deepEqual(hardened.workstreams[0]?.methods, ["verify"]);
  assert.deepEqual(hardened.workstreams[0]?.modules.map((module) => module.type), ["verification"]);
});

test("low-confidence credentials are verified before costly development", () => {
  const req = requirement("credential", "credential", "Specialist certification", { confidence: "medium" });
  const requirements = requirementModel([req]);
  const coverageData = coverageModel([req], { credential: "unproven" });
  const raw = buildDevelopmentPlanModel(requirements, coverageData, "context");
  const hardened = hardenDevelopmentPlan(raw, requirements, coverageData);

  assert.equal(hardened.decisions[0]?.action, "verify");
  assert.deepEqual(hardened.workstreams[0]?.methods, ["verify"]);
  assert.equal(hardened.workstreams[0]?.modules[0]?.type, "verification");
});

test("LLM module types cannot override deterministic requirement methods", () => {
  const skill = requirement("skill", "skill", "Client-ready writing");
  const requirements = requirementModel([skill]);
  const coverageData = coverageModel([skill], { skill: "partially_proven" });
  const raw = buildDevelopmentPlanModel(requirements, coverageData, "context", {
    workstreams: [{
      title: "Positioning only",
      objective: "Incorrectly substitute narrative for skill development.",
      rationale: "LLM proposal",
      requirementIds: [skill.id],
      methods: ["position"],
      modules: [{
        title: "Rewrite the story",
        type: "narrative",
        scope: "core",
        objective: "Reframe the skill",
        requirementIds: [skill.id],
        resources: [],
        activities: ["Rewrite the narrative"],
        output: "A story",
        assessmentCriteria: [],
      }],
      milestones: [],
      dependencyNotes: [],
      completionStandard: "Story written",
    }],
  });
  const hardened = hardenDevelopmentPlan(raw, requirements, coverageData);

  assert.equal(hardened.decisions[0]?.action, "strengthen");
  assert.deepEqual(hardened.workstreams[0]?.methods, ["practice"]);
  assert.equal(hardened.workstreams[0]?.modules[0]?.type, "practice");
  assert.ok(hardened.workstreams[0]?.modules[0]?.assessmentCriteria.includes(skill.successBar));
});

test("every active requirement receives a module and milestone", () => {
  const knowledge = requirement("knowledge", "knowledge", "Political economy knowledge", { importance: "essential" });
  const skill = requirement("skill", "skill", "Client-ready writing");
  const access = requirement("access", "access", "Credible hiring access");
  const requirements = requirementModel([knowledge, skill, access]);
  const coverageData = coverageModel([knowledge, skill, access], { knowledge: "unproven", skill: "partially_proven", access: "unknown" });
  const raw = buildDevelopmentPlanModel(requirements, coverageData, "context", {
    workstreams: [{
      title: "Incomplete LLM workstream",
      objective: "Only names the requirements.",
      rationale: "Incomplete proposal",
      requirementIds: [knowledge.id, skill.id, access.id],
      methods: [],
      modules: [],
      milestones: [],
      dependencyNotes: [],
      completionStandard: "Incomplete",
    }],
  });
  const hardened = hardenDevelopmentPlan(raw, requirements, coverageData);
  const moduleIds = new Set(hardened.workstreams.flatMap((workstream) => workstream.modules.flatMap((module) => module.requirementIds)));
  const milestoneIds = new Set(hardened.workstreams.flatMap((workstream) => workstream.milestones.flatMap((milestone) => milestone.requirementIds)));

  for (const req of [knowledge, skill, access]) {
    assert.ok(moduleIds.has(req.id), `${req.id} should have a module`);
    assert.ok(milestoneIds.has(req.id), `${req.id} should have a milestone`);
  }
  assert.deepEqual(hardened.quality.unassignedRequirementIds, []);
  assert.equal(hardened.quality.coveredCoreRequirementCount, hardened.quality.coreRequirementCount);
});

test("duplicate primary workstream assignments are collapsed", () => {
  const req = requirement("skill", "skill", "Client-ready writing");
  const requirements = requirementModel([req]);
  const coverageData = coverageModel([req], { skill: "partially_proven" });
  const raw = buildDevelopmentPlanModel(requirements, coverageData, "context", {
    workstreams: [
      {
        title: "Practice writing",
        objective: "Develop the skill",
        rationale: "Primary",
        requirementIds: [req.id],
        methods: ["practice"],
        modules: [],
        milestones: [],
        dependencyNotes: [],
        completionStandard: "Meets the bar",
      },
      {
        title: "Second duplicate plan",
        objective: "Duplicate the same work",
        rationale: "Duplicate",
        requirementIds: [req.id],
        methods: ["practice"],
        modules: [],
        milestones: [],
        dependencyNotes: [],
        completionStandard: "Also meets the bar",
      },
    ],
  });
  const hardened = hardenDevelopmentPlan(raw, requirements, coverageData);
  const homes = hardened.workstreams.filter((workstream) => workstream.requirementIds.includes(req.id));

  assert.equal(homes.length, 1);
});

test("one proof module can intentionally support knowledge and evidence together", () => {
  const knowledge = requirement("knowledge", "knowledge", "Political economy knowledge");
  const proof = requirement("proof", "evidence", "Published geopolitical analysis");
  const requirements = requirementModel([knowledge, proof]);
  const coverageData = coverageModel([knowledge, proof], { knowledge: "partially_proven", proof: "unproven" });
  const raw = buildDevelopmentPlanModel(requirements, coverageData, "context", {
    workstreams: [{
      title: "Applied geopolitical analysis",
      objective: "Build and demonstrate judgement through one output.",
      rationale: "The same artifact serves both requirements.",
      requirementIds: [knowledge.id, proof.id],
      methods: ["learn", "create_proof"],
      modules: [{
        title: "Produce an applied analysis",
        type: "proof",
        scope: "core",
        objective: "Apply knowledge in an inspectable artifact.",
        requirementIds: [knowledge.id, proof.id],
        resources: [],
        activities: ["Apply the framework to a realistic case"],
        output: "An inspectable analysis",
        assessmentCriteria: [],
      }],
      milestones: [],
      dependencyNotes: [],
      completionStandard: "Both success bars are met",
    }],
  });
  const hardened = hardenDevelopmentPlan(raw, requirements, coverageData);
  const module = hardened.workstreams[0]?.modules[0];

  assert.equal(module?.type, "proof");
  assert.deepEqual(new Set(module?.requirementIds), new Set([knowledge.id, proof.id]));
  assert.ok(module?.assessmentCriteria.includes(knowledge.successBar));
  assert.ok(module?.assessmentCriteria.includes(proof.successBar));
});
