import {
  buildCompetenceEcosystemsFromStorage,
  type CompetenceContributor,
  type CompetenceEcosystem,
  type ContributorKey,
  type DevelopmentExperience,
  type EstimateConfidence,
  type MaturityLevel,
  type RequiredCompetency,
} from "./competenceEcosystem";

export type DevelopmentObjective = "build_competence" | "reduce_uncertainty" | "create_signal" | "prepare_for_opportunity" | "test_fit";
export type TaskIntent = "learn" | "explore" | "decide" | "practice" | "produce" | "maintain" | "recover" | "connect" | "apply" | "verify" | "assess";
export type CompletionContractKind = "exposure" | "capture" | "comprehension" | "application" | "decision" | "practice" | "deliverable" | "conversation" | "maintenance" | "recovery" | "reflection";
export type ResidueLevel = "none" | "marker" | "one_line" | "question" | "decision" | "note" | "artifact" | "external_signal" | "rubric_score";
export type AssessmentMode = "none" | "binary" | "choice" | "self_rating" | "rubric";

export type CompletionContract = {
  intent: TaskIntent;
  contract: CompletionContractKind;
  residueLevel: ResidueLevel;
  requiresArtifact: boolean;
  assessmentMode: AssessmentMode;
  completionPrompt: string;
  afterActionOptions: string[];
};

export type AssessmentRubric = {
  weak: string;
  adequate: string;
  strong: string;
  evidenceRequired: string[];
  nextIfWeak: string;
  nextIfStrong: string;
};

export type SprintTaskBlueprint = {
  title: string;
  doneWhen: string;
  estimatedMinutes: number;
  sourceExperienceTitle: string;
  createsLiveTask: false;
  completionContract: CompletionContract;
};

export type SprintExperience = DevelopmentExperience & {
  assessmentRubric: AssessmentRubric;
  taskBlueprints: SprintTaskBlueprint[];
};

export type CompetenceDevelopmentSprint = {
  trackId: number;
  trackName: string;
  readOnlyPreview: true;
  noTasksGenerated: true;
  targetCompetencyKey: string;
  targetCompetencyName: string;
  targetCompetencyKind: RequiredCompetency["kind"];
  targetLevel: MaturityLevel;
  currentLevel: MaturityLevel;
  confidence: EstimateConfidence;
  developmentObjective: DevelopmentObjective;
  focusContributor: ContributorKey;
  thesis: string;
  rationale: string;
  experiences: SprintExperience[];
  sprintAssessment: AssessmentRubric;
  exitCriteria: string[];
};

export type CompetenceDevelopmentSprintPayload = {
  readOnlyPreview: true;
  generatedAt: number;
  sprints: CompetenceDevelopmentSprint[];
  summary: string;
};

const MATURITY_RANK: Record<MaturityLevel, number> = { none: 0, emerging: 1, working: 2, strong: 3, differentiated: 4 };
const IMPORTANCE_RANK: Record<RequiredCompetency["importance"], number> = { critical: 3, important: 2, useful: 1 };

function rankGap(competency: RequiredCompetency) {
  return Math.max(0, MATURITY_RANK[competency.targetLevel] - MATURITY_RANK[competency.currentLevel]);
}

function confidencePenalty(confidence: EstimateConfidence) {
  return confidence === "low" ? 2 : confidence === "medium" ? 1 : 0;
}

function selectTargetCompetency(ecosystem: CompetenceEcosystem): RequiredCompetency | null {
  return ecosystem.roleProfile.requiredCompetencies
    .slice()
    .sort((a, b) =>
      IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance]
      || rankGap(b) - rankGap(a)
      || confidencePenalty(b.confidence) - confidencePenalty(a.confidence)
      || a.name.localeCompare(b.name),
    )[0] || null;
}

function contributorForTarget(ecosystem: CompetenceEcosystem, target: RequiredCompetency): CompetenceContributor | null {
  const byKey = new Map(ecosystem.contributors.map((item) => [item.key, item]));
  const required = target.contributorKeys
    .map((key) => byKey.get(key))
    .filter((item): item is CompetenceContributor => Boolean(item));
  return required
    .sort((a, b) => a.evidenceScore - b.evidenceScore || a.signalCount - b.signalCount)[0]
    || ecosystem.weakestContributor;
}

function developmentObjective(target: RequiredCompetency, focus: ContributorKey): DevelopmentObjective {
  if (target.kind === "evidence" || focus === "evidence") return "create_signal";
  if (target.kind === "experience" || focus === "network") return target.confidence === "low" ? "reduce_uncertainty" : "test_fit";
  if (["practice", "feedback", "reflection"].includes(focus)) return "build_competence";
  if (target.kind === "professional" || target.kind === "domain") return "build_competence";
  if (target.confidence === "low" && ["none", "emerging"].includes(target.currentLevel)) return "reduce_uncertainty";
  return "build_competence";
}

function outputName(experience: DevelopmentExperience) {
  return experience.outputs[0] || "development output";
}

function rubricFor(experience: DevelopmentExperience, target: RequiredCompetency): AssessmentRubric {
  const output = outputName(experience);
  if (experience.contributor === "knowledge") {
    return {
      weak: `The ${output} lists facts but does not identify subdomains, uncertainties, or role relevance.`,
      adequate: `The ${output} maps the main subdomains, names sources, and identifies the biggest uncertainty.`,
      strong: `The ${output} explains competing views, role implications, and what must be tested next.`,
      evidenceRequired: [output, "source-backed questions", "uncertainty list"],
      nextIfWeak: "Repeat the terrain map with fewer sources and sharper questions.",
      nextIfStrong: "Move into case application or practitioner feedback.",
    };
  }
  if (experience.contributor === "practice") {
    return {
      weak: `The ${output} summarizes a framework without applying it to a decision.`,
      adequate: `The ${output} applies the framework, names assumptions, and reaches a provisional conclusion.`,
      strong: `The ${output} compares alternatives, explains trade-offs, and defends a judgement with uncertainty stated.`,
      evidenceRequired: [output, "assumption list", "current conclusion"],
      nextIfWeak: "Add a real case and force a decision recommendation.",
      nextIfStrong: "Seek critique or turn the case note into a proof fragment.",
    };
  }
  if (experience.contributor === "feedback") {
    return {
      weak: "The user asks for vague advice and receives no correction to the work.",
      adequate: "A practitioner or informed peer gives two concrete corrections, questions, or examples.",
      strong: "The feedback changes the user's model and creates a sharper next test or output.",
      evidenceRequired: ["reviewed output", "two corrections", "updated judgement"],
      nextIfWeak: "Rewrite the ask around one specific output and one decision.",
      nextIfStrong: "Update the competence estimate and progress to judgement or signal work.",
    };
  }
  if (experience.contributor === "reflection") {
    return {
      weak: "The reflection says what happened but not what changed in the user's judgement.",
      adequate: "The reflection records claim, evidence, counterargument, uncertainty, and next test.",
      strong: "The reflection exposes a reusable mental model or original point of view.",
      evidenceRequired: ["judgement log", "counterargument", "next test"],
      nextIfWeak: "Rewrite the reflection around a single claim and counterargument.",
      nextIfStrong: "Use the judgement log as the basis for a proof fragment or expert conversation.",
    };
  }
  if (experience.contributor === "network") {
    return {
      weak: "The conversation is generic and does not change the user's understanding of the role.",
      adequate: "The conversation produces three role realities and one development implication.",
      strong: "The conversation reveals a hidden requirement, access path, or fit/non-fit signal.",
      evidenceRequired: ["role realities", "transferability note", "development implication"],
      nextIfWeak: "Ask a narrower reality-check question with one role-specific hypothesis.",
      nextIfStrong: "Update the role profile or activate a targeted follow-up move.",
    };
  }
  if (experience.contributor === "evidence") {
    return {
      weak: `The ${output} is a generic summary and cannot be reused in a career conversation.`,
      adequate: `The ${output} is original, small, and reusable in outreach, applications, or interviews.`,
      strong: `The ${output} demonstrates judgement, relevance to ${target.name}, and a credible point of view.`,
      evidenceRequired: [output, "reuse note", "next proof step"],
      nextIfWeak: "Shrink the artifact and tie it to one role requirement.",
      nextIfStrong: "Consider sharing, saving as proof, or building the next proof asset slice.",
    };
  }
  return {
    weak: "The experience remains theoretical and does not resemble the role context.",
    adequate: "The experience produces a decision, simulation, or role-context output.",
    strong: "The experience reveals what the role actually demands and produces reusable evidence.",
    evidenceRequired: [output, "decision recommendation", "reflection"],
    nextIfWeak: "Make the simulation more concrete with constraints, audience, and trade-offs.",
    nextIfStrong: "Seek feedback or turn the simulation into a proof fragment.",
  };
}

function completionContract(input: CompletionContract): CompletionContract {
  return input;
}

function primaryCompletionContract(experience: DevelopmentExperience): CompletionContract {
  if (experience.contributor === "knowledge") {
    return completionContract({
      intent: "learn",
      contract: "comprehension",
      residueLevel: "one_line",
      requiresArtifact: false,
      assessmentMode: "self_rating",
      completionPrompt: "Can you explain the main idea simply enough to decide whether to continue?",
      afterActionOptions: ["continue", "stop", "save_for_later", "turn_into_application"],
    });
  }
  if (experience.contributor === "network" || experience.contributor === "feedback") {
    return completionContract({
      intent: experience.contributor === "network" ? "connect" : "verify",
      contract: "conversation",
      residueLevel: "external_signal",
      requiresArtifact: false,
      assessmentMode: "choice",
      completionPrompt: "What signal did the conversation or feedback create?",
      afterActionOptions: ["useful_signal", "needs_follow_up", "not_useful", "revise_ask"],
    });
  }
  if (experience.contributor === "reflection") {
    return completionContract({
      intent: "assess",
      contract: "reflection",
      residueLevel: "note",
      requiresArtifact: false,
      assessmentMode: "self_rating",
      completionPrompt: "What changed in your judgement, confidence, or uncertainty?",
      afterActionOptions: ["clearer", "still_unclear", "needs_feedback", "turn_into_output"],
    });
  }
  if (experience.contributor === "evidence") {
    return completionContract({
      intent: "produce",
      contract: "deliverable",
      residueLevel: "artifact",
      requiresArtifact: true,
      assessmentMode: "rubric",
      completionPrompt: "Does the artifact demonstrate a specific claim, judgement, or reusable proof point?",
      afterActionOptions: ["share", "revise", "save_as_proof", "get_feedback"],
    });
  }
  return completionContract({
    intent: "apply",
    contract: "application",
    residueLevel: "note",
    requiresArtifact: false,
    assessmentMode: "rubric",
    completionPrompt: "Did you apply the idea to a real or simulated context and make a judgement?",
    afterActionOptions: ["adequate", "needs_feedback", "repeat_narrower", "turn_into_proof"],
  });
}

function taskBlueprintsFor(experience: DevelopmentExperience): SprintTaskBlueprint[] {
  const output = outputName(experience);
  return [
    {
      title: `Prepare the input for ${experience.title}`,
      doneWhen: `The case, source, person, or prompt needed for ${experience.title} is selected.`,
      estimatedMinutes: 25,
      sourceExperienceTitle: experience.title,
      createsLiveTask: false,
      completionContract: completionContract({
        intent: "decide",
        contract: "capture",
        residueLevel: "decision",
        requiresArtifact: false,
        assessmentMode: "choice",
        completionPrompt: "What did you select, and is it enough to proceed?",
        afterActionOptions: ["captured", "needs_more_input", "stop", "save_for_later"],
      }),
    },
    {
      title: `Produce the ${output}`,
      doneWhen: experience.doneWhen,
      estimatedMinutes: 60,
      sourceExperienceTitle: experience.title,
      createsLiveTask: false,
      completionContract: primaryCompletionContract(experience),
    },
    {
      title: `Assess the ${output}`,
      doneWhen: "The output is assessed using the right contract, with one next implication recorded.",
      estimatedMinutes: 20,
      sourceExperienceTitle: experience.title,
      createsLiveTask: false,
      completionContract: completionContract({
        intent: "assess",
        contract: "reflection",
        residueLevel: "rubric_score",
        requiresArtifact: false,
        assessmentMode: "rubric",
        completionPrompt: "Was the output weak, adequate, or strong against the sprint rubric?",
        afterActionOptions: ["weak", "adequate", "strong", "repeat_narrower"],
      }),
    },
  ];
}

function sprintRubricFor(target: RequiredCompetency): AssessmentRubric {
  return {
    weak: `The sprint creates activity but no usable evidence for ${target.name}.`,
    adequate: `The sprint produces at least one output that addresses ${target.evidenceGap}`,
    strong: `The sprint improves the estimate of ${target.name} and creates evidence that can support a career decision.`,
    evidenceRequired: target.evidenceRequired,
    nextIfWeak: "Do not progress stages. Repeat with a narrower experience and clearer assessment standard.",
    nextIfStrong: "Update the competence ecosystem and choose the next contributor or signal-building slice.",
  };
}

function buildSprint(ecosystem: CompetenceEcosystem): CompetenceDevelopmentSprint | null {
  const target = selectTargetCompetency(ecosystem);
  if (!target || !ecosystem.programSlice) return null;
  const focus = contributorForTarget(ecosystem, target) || ecosystem.weakestContributor;
  if (!focus) return null;
  const experiences = ecosystem.programSlice.experiences.map((experience) => ({
    ...experience,
    assessmentRubric: rubricFor(experience, target),
    taskBlueprints: taskBlueprintsFor(experience),
  }));
  return {
    trackId: ecosystem.trackId,
    trackName: ecosystem.trackName,
    readOnlyPreview: true,
    noTasksGenerated: true,
    targetCompetencyKey: target.key,
    targetCompetencyName: target.name,
    targetCompetencyKind: target.kind,
    targetLevel: target.targetLevel,
    currentLevel: target.currentLevel,
    confidence: target.confidence,
    developmentObjective: developmentObjective(target, focus.key),
    focusContributor: focus.key,
    thesis: ecosystem.programSlice.thesis,
    rationale: `${target.evidenceGap} ${target.transferNotes}`,
    experiences,
    sprintAssessment: sprintRubricFor(target),
    exitCriteria: ecosystem.programSlice.exitCriteria,
  };
}

export function buildCompetenceDevelopmentSprints(ecosystems: CompetenceEcosystem[]): CompetenceDevelopmentSprintPayload {
  const sprints = ecosystems.map(buildSprint).filter((item): item is CompetenceDevelopmentSprint => Boolean(item));
  return {
    readOnlyPreview: true,
    generatedAt: Date.now(),
    sprints,
    summary: sprints.length
      ? `Anchor generated ${sprints.length} read-only development sprint${sprints.length === 1 ? "" : "s"}. Each sprint starts from a role competency target and ends in assessment, not automatic task creation.`
      : "No active competence ecosystems are ready for development sprint generation.",
  };
}

export async function buildCompetenceDevelopmentSprintsFromStorage(): Promise<CompetenceDevelopmentSprintPayload> {
  const ecosystems = await buildCompetenceEcosystemsFromStorage();
  return buildCompetenceDevelopmentSprints(ecosystems.ecosystems);
}
