import { createHash } from "node:crypto";
import type {
  DevelopmentMilestone,
  DevelopmentModule,
  DevelopmentModuleType,
  DevelopmentPlanModel,
  DevelopmentWorkstream,
} from "./trackResearchDevelopmentPlan";

export const EXECUTION_BLUEPRINT_VERSION = 1;

export type BlueprintExecutor = "system" | "user_learning" | "user_action";
export type BlueprintOwner = "anchor" | "user" | "shared";
export type BlueprintCondition = "always" | "if_needed";
export type BlueprintReadiness = "ready" | "depends_on_blueprint" | "conditional";
export type BlueprintEffort = "quick" | "medium" | "deep" | "project";
export type TaskBlueprintKind =
  | "research"
  | "learning"
  | "practice"
  | "experience"
  | "artifact"
  | "relationship"
  | "access"
  | "credential"
  | "verification"
  | "validation";

export type SubtaskBlueprint = {
  id: string;
  title: string;
  executor: BlueprintExecutor;
  condition: BlueprintCondition;
  outputSpec: string;
  doneWhen: string;
  dependsOnSubtaskIds: string[];
};

export type TaskMaterializationDraft = {
  category: "learning" | "hustle" | "job" | "admin";
  size: "quick" | "medium" | "deep";
  doneWhen: string;
  minimumOutcome: string;
  sourceType: "career_track";
  sourceStepType: "execution_blueprint_task";
};

export type TaskBlueprint = {
  id: string;
  key: string;
  workstreamId: string;
  moduleId: string;
  moduleTitle: string;
  milestoneIds: string[];
  requirementIds: string[];
  sequence: number;
  title: string;
  kind: TaskBlueprintKind;
  owner: BlueprintOwner;
  why: string;
  doneWhen: string;
  minimumOutcome: string;
  expectedEvidence: string;
  effort: BlueprintEffort;
  readiness: BlueprintReadiness;
  readinessReason: string;
  dependsOnTaskIds: string[];
  subtasks: SubtaskBlueprint[];
  materialization: {
    state: "blueprint_only";
    taskDraft: TaskMaterializationDraft;
  };
};

export type WorkstreamExecutionBlueprint = {
  workstreamId: string;
  title: string;
  objective: string;
  taskIds: string[];
  moduleIds: string[];
  milestoneIds: string[];
  completionTaskId: string | null;
};

export type ExecutionBlueprintModel = {
  mode: "execution_blueprint_model";
  version: number;
  targetLabel: string;
  developmentPlanVersion: number;
  developmentPlanFingerprint: string;
  sourceFingerprint: string;
  objective: string;
  principles: string[];
  workstreams: WorkstreamExecutionBlueprint[];
  tasks: TaskBlueprint[];
  summary: {
    workstreamCount: number;
    moduleCount: number;
    milestoneCount: number;
    taskCount: number;
    subtaskCount: number;
    anchorOwnedTaskCount: number;
    userOwnedTaskCount: number;
    sharedTaskCount: number;
    conditionalTaskCount: number;
  };
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    moduleCoverageRate: number;
    milestoneCoverageRate: number;
    requirementCoverageRate: number;
    orphanModuleIds: string[];
    orphanMilestoneIds: string[];
    orphanRequirementIds: string[];
    duplicateTaskKeys: string[];
    invalidDependencyIds: string[];
    cyclicTaskIds: string[];
    oversizedTaskIds: string[];
    caveats: string[];
  };
  materializationStatus: "blueprint_only";
  generatedAt: number;
};

type SubtaskTemplate = {
  key: string;
  title: string;
  executor: BlueprintExecutor;
  condition?: BlueprintCondition;
  outputSpec: string;
  doneWhen: string;
};

type TaskTemplate = {
  key: string;
  title: string;
  kind: TaskBlueprintKind;
  why: string;
  doneWhen: string;
  minimumOutcome: string;
  expectedEvidence: string;
  effort: BlueprintEffort;
  subtasks: SubtaskTemplate[];
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}-${hash(parts.map(normalize)).slice(0, 16)}`;
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(compact).filter(Boolean)) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function moduleLabel(module: DevelopmentModule): string {
  return compact(module.title) || compact(module.objective) || "development module";
}

function successStandard(module: DevelopmentModule): string {
  return uniqueStrings(module.assessmentCriteria).join("; ") || compact(module.output) || `The intended output for ${moduleLabel(module)} exists.`;
}

function taskTemplates(module: DevelopmentModule): TaskTemplate[] {
  const label = moduleLabel(module);
  const output = compact(module.output) || `A usable output for ${label}`;
  const standard = successStandard(module);
  const resources = module.resources.map((resource) => resource.title).filter(Boolean).slice(0, 4);
  const resourceContext = resources.length ? ` using ${resources.join(", ")}` : "";

  if (module.type === "verification") {
    return [{
      key: "resolve-current-state",
      title: `Verify the current position on ${label}`,
      kind: "verification",
      why: "Resolve uncertainty before Anchor creates avoidable development work.",
      doneWhen: `The available evidence supports a defensible coverage decision against: ${standard}`,
      minimumOutcome: "Anchor has inspected the existing record and identified the single material evidence question that remains.",
      expectedEvidence: `A coverage-ready evidence decision for ${label}`,
      effort: "medium",
      subtasks: [
        {
          key: "inspect-record",
          title: "Inspect the existing CV, outputs, outcomes and relationship evidence",
          executor: "system",
          outputSpec: "A concise inventory of evidence relevant to this requirement.",
          doneWhen: "Relevant stored evidence is identified or explicitly ruled absent.",
        },
        {
          key: "ask-one-question",
          title: "Answer one focused evidence question only where the record remains ambiguous",
          executor: "user_action",
          condition: "if_needed",
          outputSpec: "One factual example, correction or confirmation that materially changes the assessment.",
          doneWhen: "The unresolved evidence ambiguity is answered without requiring a full questionnaire.",
        },
        {
          key: "record-decision",
          title: "Record the updated coverage decision and supporting evidence",
          executor: "system",
          outputSpec: "An updated coverage state with evidence links and remaining uncertainty.",
          doneWhen: "The requirement is classified as proven, partial, unproven or below bar with a defensible basis.",
        },
      ],
    }];
  }

  if (module.type === "syllabus") {
    return [
      {
        key: "build-learning-pack",
        title: `Build the focused learning pack for ${label}`,
        kind: "research",
        why: "Use a compact, requirement-linked syllabus rather than an open-ended reading list.",
        doneWhen: `A small learning pack covers the concepts needed to produce ${output}.`,
        minimumOutcome: "A sequenced concept map and the first authoritative resource are ready.",
        expectedEvidence: `A structured learning pack for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "map-concepts",
            title: "Map the concepts directly required by the success bar",
            executor: "system",
            outputSpec: "A short concept sequence linked to the module objective.",
            doneWhen: "Every concept has a clear reason for inclusion and no generic filler remains.",
          },
          {
            key: "select-resources",
            title: `Select the smallest credible resource set${resourceContext}`,
            executor: "system",
            outputSpec: "A complementary set of authoritative resources with a purpose for each.",
            doneWhen: "The resources collectively cover the concept sequence without unnecessary duplication.",
          },
          {
            key: "set-application-question",
            title: "Set the applied question that will guide the learning",
            executor: "system",
            outputSpec: "One realistic target-role question to answer through the module.",
            doneWhen: "The question makes passive consumption insufficient.",
          },
        ],
      },
      {
        key: "apply-learning",
        title: `Work through and apply ${label}`,
        kind: "learning",
        why: "The value is in the user understanding, judging and applying the material.",
        doneWhen: `The user can apply the module concepts to a realistic case and explain the reasoning.`,
        minimumOutcome: "The first concept is applied to the target-role question and the useful insight is saved.",
        expectedEvidence: `Applied notes and reasoning for ${label}`,
        effort: "deep",
        subtasks: [
          {
            key: "learn-core",
            title: "Study the core material with the applied question in view",
            executor: "user_learning",
            outputSpec: "Concise notes containing only concepts that change the answer to the applied question.",
            doneWhen: "The key concepts can be explained without copying the source.",
          },
          {
            key: "apply-case",
            title: "Apply the concepts to a realistic target-role case",
            executor: "user_learning",
            outputSpec: "A worked application showing assumptions, judgement and implications.",
            doneWhen: "The reasoning is specific enough to be assessed against the module standard.",
          },
          {
            key: "capture-gaps",
            title: "Capture only the remaining concept or judgement gaps",
            executor: "system",
            outputSpec: "A short gap list grounded in the attempted application.",
            doneWhen: "The next learning need is evidence-based rather than speculative.",
          },
        ],
      },
      {
        key: "produce-synthesis",
        title: `Produce and assess the applied synthesis for ${label}`,
        kind: "artifact",
        why: "Learning becomes career capital only when it produces a reusable, assessable output.",
        doneWhen: standard,
        minimumOutcome: `A usable first version of ${output} exists.`,
        expectedEvidence: output,
        effort: "deep",
        subtasks: [
          {
            key: "draft-synthesis",
            title: "Turn the applied reasoning into a concise synthesis",
            executor: "system",
            outputSpec: output,
            doneWhen: "A complete first version exists and answers the applied question.",
          },
          {
            key: "review-judgement",
            title: "Review the synthesis for accuracy, judgement and clarity",
            executor: "user_learning",
            outputSpec: "Targeted revisions based on the assessment criteria.",
            doneWhen: "The user can defend the reasoning and has corrected material weaknesses.",
          },
          {
            key: "retain-evidence",
            title: "Save the final synthesis as reusable evidence",
            executor: "system",
            outputSpec: "A final, retrievable artifact linked to the served requirements.",
            doneWhen: "The artifact and its requirement links are stored.",
          },
        ],
      },
    ];
  }

  if (module.type === "practice") {
    return [
      {
        key: "set-practice-standard",
        title: `Set the practice standard for ${label}`,
        kind: "research",
        why: "Practice needs representative cases and an observable quality bar.",
        doneWhen: "The practice cases and rubric directly reflect the target success bar.",
        minimumOutcome: "One representative case and a concise assessment rubric are ready.",
        expectedEvidence: `A practice rubric and case set for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "define-rubric",
            title: "Translate the success bar into a short scoring rubric",
            executor: "system",
            outputSpec: "Three to five observable criteria.",
            doneWhen: "The rubric distinguishes weak, acceptable and strong performance.",
          },
          {
            key: "create-cases",
            title: "Create representative practice cases",
            executor: "system",
            outputSpec: "Two or three cases that resemble the target work.",
            doneWhen: "Each case tests a different material part of the skill.",
          },
        ],
      },
      {
        key: "complete-practice-rounds",
        title: `Complete assessed practice rounds for ${label}`,
        kind: "practice",
        why: "The user must perform the skill; Anchor cannot substitute an explanation for practice.",
        doneWhen: "Repeated attempts show reliable performance against the rubric.",
        minimumOutcome: "One complete attempt is produced and assessed.",
        expectedEvidence: `Practice attempts and feedback for ${label}`,
        effort: "deep",
        subtasks: [
          {
            key: "attempt-one",
            title: "Complete the first representative attempt",
            executor: "user_learning",
            outputSpec: "A complete response or work sample without hidden assistance.",
            doneWhen: "The attempt is complete enough to score against every rubric criterion.",
          },
          {
            key: "score-attempt",
            title: "Score the attempt and identify the highest-leverage correction",
            executor: "system",
            outputSpec: "Criterion-level feedback and one priority correction.",
            doneWhen: "The feedback is specific to the produced attempt.",
          },
          {
            key: "repeat-and-revise",
            title: "Repeat the practice with the correction applied",
            executor: "user_learning",
            outputSpec: "A revised or second attempt showing the correction in use.",
            doneWhen: "The material weakness improves or is explicitly isolated for further practice.",
          },
        ],
      },
      {
        key: "retain-best-work-sample",
        title: `Retain the strongest work sample for ${label}`,
        kind: "validation",
        why: "Coverage should update from inspectable evidence, not a claim that practice occurred.",
        doneWhen: standard,
        minimumOutcome: "The strongest attempt is selected and its remaining caveats are documented.",
        expectedEvidence: output,
        effort: "medium",
        subtasks: [
          {
            key: "select-sample",
            title: "Select the strongest attempt and explain why it is strongest",
            executor: "user_learning",
            outputSpec: "A chosen work sample with a brief evidence-based rationale.",
            doneWhen: "The selection is tied to the rubric rather than preference alone.",
          },
          {
            key: "final-quality-check",
            title: "Check the sample against the target success bar",
            executor: "system",
            outputSpec: "A final criterion-level assessment and any unresolved caveat.",
            doneWhen: "The evidence can be classified fairly for coverage.",
          },
          {
            key: "store-sample",
            title: "Store the sample and feedback as reusable evidence",
            executor: "system",
            outputSpec: output,
            doneWhen: "The sample is retrievable and linked to the requirements it supports.",
          },
        ],
      },
    ];
  }

  if (module.type === "experience") {
    return [
      {
        key: "choose-applied-context",
        title: `Choose a credible applied context for ${label}`,
        kind: "experience",
        why: "Experience requires responsibility in a context that resembles the target work.",
        doneWhen: "A realistic context, responsibility and intended outcome are defined.",
        minimumOutcome: "One feasible context and the target responsibility are selected.",
        expectedEvidence: `An applied-experience brief for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "identify-contexts",
            title: "Identify real, simulated or adjacent contexts that reproduce the target responsibility",
            executor: "system",
            outputSpec: "A short set of feasible contexts with trade-offs.",
            doneWhen: "Each option would create genuine responsibility rather than observation only.",
          },
          {
            key: "select-context",
            title: "Select the context with the strongest evidence potential",
            executor: "user_action",
            outputSpec: "A chosen context, owner, responsibility and intended outcome.",
            doneWhen: "The user can realistically begin or secure the experience.",
          },
        ],
      },
      {
        key: "execute-applied-work",
        title: `Carry out the target-like responsibility for ${label}`,
        kind: "experience",
        why: "The market signal comes from doing the work and owning an outcome.",
        doneWhen: "The responsibility is completed or has produced a meaningful observable outcome.",
        minimumOutcome: "The first real decision, deliverable or responsibility is completed.",
        expectedEvidence: `A completed applied experience demonstrating ${label}`,
        effort: "project",
        subtasks: [
          {
            key: "confirm-scope",
            title: "Confirm the responsibility, stakeholders and evidence to retain",
            executor: "user_action",
            outputSpec: "A clear applied-work scope and evidence plan.",
            doneWhen: "Success and ownership are unambiguous.",
          },
          {
            key: "perform-work",
            title: "Perform the target-like work and make the material decisions",
            executor: "user_action",
            outputSpec: "The real or simulated work product and decision record.",
            doneWhen: "The defined responsibility has been carried through to a meaningful result.",
          },
          {
            key: "capture-feedback",
            title: "Capture outcome evidence or feedback",
            executor: "user_action",
            condition: "if_needed",
            outputSpec: "A result, stakeholder signal or explicit feedback note.",
            doneWhen: "The experience has an observable external or work-product signal where available.",
          },
        ],
      },
      {
        key: "document-experience",
        title: `Document the evidence from ${label}`,
        kind: "artifact",
        why: "Experience only improves market coverage when the contribution and result can be understood.",
        doneWhen: standard,
        minimumOutcome: "A factual situation-action-result record exists.",
        expectedEvidence: output,
        effort: "medium",
        subtasks: [
          {
            key: "extract-facts",
            title: "Extract the context, responsibility, decisions and result",
            executor: "system",
            outputSpec: "A factual evidence record with no inflated claims.",
            doneWhen: "The record distinguishes the user's contribution from the wider project.",
          },
          {
            key: "validate-account",
            title: "Validate that the account is accurate and defensible",
            executor: "user_action",
            outputSpec: "A confirmed evidence narrative and any confidentiality limits.",
            doneWhen: "Every claim can be defended in an interview or application.",
          },
          {
            key: "store-experience",
            title: "Store the evidence in reusable formats",
            executor: "system",
            outputSpec: "A CV-ready bullet, interview story and detailed evidence note.",
            doneWhen: "The evidence is linked to the requirements it demonstrates.",
          },
        ],
      },
    ];
  }

  if (module.type === "proof") {
    return [
      {
        key: "define-proof-brief",
        title: `Define the proof brief for ${label}`,
        kind: "artifact",
        why: "A focused artifact can demonstrate several requirements without creating multiple disconnected projects.",
        doneWhen: "The claim, audience, format, source needs and assessment criteria are explicit.",
        minimumOutcome: "The artifact's claim, audience and done condition are defined.",
        expectedEvidence: `A proof-asset brief for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "set-claim",
            title: "Set the precise claim and audience",
            executor: "system",
            outputSpec: "One defensible claim and the decision-maker or market audience it serves.",
            doneWhen: "The artifact has a specific purpose beyond generic content creation.",
          },
          {
            key: "set-format",
            title: "Choose the smallest credible format",
            executor: "system",
            outputSpec: "A format and scope proportionate to the evidence required.",
            doneWhen: "The output can meet the success bar without unnecessary breadth.",
          },
          {
            key: "set-rubric",
            title: "Translate the linked success bars into an artifact rubric",
            executor: "system",
            outputSpec: "Observable quality criteria for the finished proof.",
            doneWhen: "The rubric can be used to accept or reject the output.",
          },
        ],
      },
      {
        key: "produce-proof",
        title: `Produce the proof asset for ${label}`,
        kind: "artifact",
        why: "The central value is an inspectable artifact, so Anchor should handle scaffolding while the user retains judgement.",
        doneWhen: `A complete artifact exists and addresses the linked requirements.`,
        minimumOutcome: "A complete first version exists, even if it still needs refinement.",
        expectedEvidence: output,
        effort: "project",
        subtasks: [
          {
            key: "assemble-inputs",
            title: "Assemble the source material and existing evidence",
            executor: "system",
            outputSpec: "A source pack and evidence inventory relevant to the artifact.",
            doneWhen: "The draft can proceed without generic research loops.",
          },
          {
            key: "create-structure",
            title: "Create the artifact structure and argument",
            executor: "system",
            outputSpec: "A complete outline or production structure tied to the rubric.",
            doneWhen: "Every section has a clear role in proving the linked requirements.",
          },
          {
            key: "apply-judgement",
            title: "Apply the user's judgement to the substantive choices",
            executor: "user_learning",
            outputSpec: "Confirmed analysis, choices and implications that reflect the user's reasoning.",
            doneWhen: "The artifact is not merely a system-generated shell.",
          },
          {
            key: "complete-draft",
            title: "Complete the full first version",
            executor: "system",
            outputSpec: output,
            doneWhen: "The artifact is complete enough for a full quality review.",
          },
        ],
      },
      {
        key: "validate-proof",
        title: `Validate and retain the proof for ${label}`,
        kind: "validation",
        why: "The artifact should update coverage only after it meets the stated bar.",
        doneWhen: standard,
        minimumOutcome: "The artifact is scored and the one material revision is identified.",
        expectedEvidence: output,
        effort: "medium",
        subtasks: [
          {
            key: "score-artifact",
            title: "Score the artifact against every linked success bar",
            executor: "system",
            outputSpec: "Criterion-level assessment with evidence for each judgement.",
            doneWhen: "Every linked requirement has a clear assessment.",
          },
          {
            key: "make-revisions",
            title: "Make the material revisions",
            executor: "user_learning",
            outputSpec: "A revised final artifact that resolves the substantive weaknesses.",
            doneWhen: "The artifact meets the acceptance threshold or remaining caveats are explicit.",
          },
          {
            key: "publish-or-store",
            title: "Publish or store the final artifact in an inspectable location",
            executor: "user_action",
            outputSpec: "A stable artifact or evidence URL where appropriate.",
            doneWhen: "The artifact is retrievable and linked to the target requirements.",
          },
        ],
      },
    ];
  }

  if (module.type === "narrative") {
    return [
      {
        key: "assemble-positioning-evidence",
        title: `Assemble the evidence for ${label}`,
        kind: "research",
        why: "Positioning should be built from defensible evidence rather than unsupported claims.",
        doneWhen: "The strongest relevant evidence and remaining narrative gaps are explicit.",
        minimumOutcome: "The three strongest evidence points are selected.",
        expectedEvidence: `An evidence inventory for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "collect-evidence",
            title: "Collect the strongest existing outputs, outcomes and experience examples",
            executor: "system",
            outputSpec: "A ranked evidence set tied to the narrative requirement.",
            doneWhen: "Only defensible, relevant evidence remains.",
          },
          {
            key: "identify-bridge",
            title: "Identify the credible bridge from past experience to the target",
            executor: "system",
            outputSpec: "A concise bridge logic grounded in the evidence set.",
            doneWhen: "The transition is explained without relying on aspiration alone.",
          },
        ],
      },
      {
        key: "build-positioning-assets",
        title: `Build the positioning assets for ${label}`,
        kind: "artifact",
        why: "One evidence-backed core narrative should be adapted rather than reinvented across channels.",
        doneWhen: "The core narrative works consistently across CV, outreach, application and interview contexts.",
        minimumOutcome: "A concise core narrative and one channel-specific version exist.",
        expectedEvidence: output,
        effort: "deep",
        subtasks: [
          {
            key: "draft-core-story",
            title: "Draft the core evidence-backed transition story",
            executor: "system",
            outputSpec: "A concise narrative covering motivation, relevant evidence and target value.",
            doneWhen: "Every claim is supported by a cited example.",
          },
          {
            key: "adapt-assets",
            title: "Adapt the story to the relevant career materials",
            executor: "system",
            outputSpec: "Channel-specific versions that preserve the same evidence logic.",
            doneWhen: "The versions are consistent without sounding copied or generic.",
          },
          {
            key: "confirm-voice",
            title: "Confirm the narrative sounds accurate and natural",
            executor: "user_action",
            outputSpec: "User-approved language and corrections.",
            doneWhen: "The user can say the narrative credibly in their own words.",
          },
        ],
      },
      {
        key: "test-positioning",
        title: `Test and refine ${label}`,
        kind: "validation",
        why: "Narrative coverage improves when the market understands and responds to the positioning.",
        doneWhen: standard,
        minimumOutcome: "One realistic test produces specific feedback.",
        expectedEvidence: `Positioning feedback or a credible market signal for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "run-test",
            title: "Use the narrative in one realistic conversation, application or mock setting",
            executor: "user_action",
            outputSpec: "A real or simulated market test of the narrative.",
            doneWhen: "The narrative has been used with an appropriate audience.",
          },
          {
            key: "capture-response",
            title: "Capture what was clear, doubted or missing",
            executor: "user_action",
            outputSpec: "Specific response evidence rather than a general impression.",
            doneWhen: "The feedback can guide a targeted revision.",
          },
          {
            key: "refine-story",
            title: "Refine the narrative using the response evidence",
            executor: "system",
            outputSpec: "A revised positioning package and documented change rationale.",
            doneWhen: "The material point of confusion or doubt is resolved.",
          },
        ],
      },
    ];
  }

  if (module.type === "relationships") {
    return [
      {
        key: "map-relationship-needs",
        title: `Map the relationship needs for ${label}`,
        kind: "relationship",
        why: "The plan should identify the few relationship types that provide distinct insight or access, not create a large contact list.",
        doneWhen: "The required archetypes, value exchange and conversation objectives are explicit.",
        minimumOutcome: "The first high-value archetype and why it matters are defined.",
        expectedEvidence: `A focused relationship map for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "define-archetypes",
            title: "Define the small set of relationship archetypes required",
            executor: "system",
            outputSpec: "A MECE archetype map with a distinct reason for each type.",
            doneWhen: "No archetype is included only for volume or prestige.",
          },
          {
            key: "identify-candidates",
            title: "Identify credible candidates from existing and public networks",
            executor: "system",
            outputSpec: "A short candidate set with relevance and path-to-contact evidence.",
            doneWhen: "Each candidate fits a defined archetype and is a real person.",
          },
        ],
      },
      {
        key: "prepare-relationship-moves",
        title: `Prepare the first relationship moves for ${label}`,
        kind: "relationship",
        why: "Anchor can reduce friction by preparing specific outreach without sending it automatically.",
        doneWhen: "The first outreach or reconnection moves are ready and tailored.",
        minimumOutcome: "One worthwhile person and one low-friction message are ready.",
        expectedEvidence: `Prepared outreach for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "select-people",
            title: "Select the smallest useful first set of people",
            executor: "user_action",
            outputSpec: "A confirmed shortlist of people the user is comfortable contacting.",
            doneWhen: "The shortlist is realistic and aligned with the relationship objectives.",
          },
          {
            key: "draft-messages",
            title: "Draft specific messages and asks",
            executor: "system",
            outputSpec: "Short messages with a credible why-them line and a proportionate ask.",
            doneWhen: "Each message is specific enough to send with minimal editing.",
          },
          {
            key: "prepare-conversations",
            title: "Prepare the questions and contribution for each conversation",
            executor: "system",
            outputSpec: "A short conversation brief that creates mutual value.",
            doneWhen: "The user knows what to learn, ask and offer.",
          },
        ],
      },
      {
        key: "conduct-and-capture",
        title: `Conduct substantive interactions for ${label}`,
        kind: "relationship",
        why: "A saved contact is not evidence; the value comes from real interaction and retained learning.",
        doneWhen: standard,
        minimumOutcome: "One substantive message is sent or one conversation is completed and logged.",
        expectedEvidence: output,
        effort: "project",
        subtasks: [
          {
            key: "send-or-schedule",
            title: "Send the outreach or schedule the conversation",
            executor: "user_action",
            outputSpec: "A sent message or confirmed conversation.",
            doneWhen: "The external relationship move has actually occurred.",
          },
          {
            key: "hold-conversation",
            title: "Hold the substantive interaction",
            executor: "user_action",
            condition: "if_needed",
            outputSpec: "A real exchange that produces insight, feedback or access.",
            doneWhen: "The interaction has occurred and served its defined purpose.",
          },
          {
            key: "capture-insight",
            title: "Capture the learning, follow-up and relationship signal",
            executor: "system",
            outputSpec: "Structured notes and the next relationship condition.",
            doneWhen: "The interaction changes the market map, coverage or next relationship move.",
          },
        ],
      },
    ];
  }

  if (module.type === "access") {
    return [
      {
        key: "map-entry-routes",
        title: `Map the credible entry routes for ${label}`,
        kind: "access",
        why: "Access must be based on real hiring routes rather than generic networking activity.",
        doneWhen: "The viable routes, prerequisites and route evidence are explicit.",
        minimumOutcome: "One credible route and its next test are identified.",
        expectedEvidence: `An entry-route map for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "identify-routes",
            title: "Identify direct, referral, fellowship, project and adjacent entry routes",
            executor: "system",
            outputSpec: "A route set grounded in the target market and role families.",
            doneWhen: "Each route has a real mechanism and not just a label.",
          },
          {
            key: "assess-routes",
            title: "Assess the evidence, prerequisites and friction for each route",
            executor: "system",
            outputSpec: "A factual route comparison without selecting a daily priority.",
            doneWhen: "The user can see which routes are viable, conditional or blocked.",
          },
        ],
      },
      {
        key: "test-entry-route",
        title: `Test a credible entry route for ${label}`,
        kind: "access",
        why: "The route becomes evidence only when the user takes a real market action.",
        doneWhen: "A live route has been tested and produced an observable signal.",
        minimumOutcome: "One real opportunity, introduction or process is entered or tested.",
        expectedEvidence: `A hiring-access signal for ${label}`,
        effort: "deep",
        subtasks: [
          {
            key: "prepare-route",
            title: "Prepare the route-specific material or introduction request",
            executor: "system",
            outputSpec: "A tailored route packet, message or application asset.",
            doneWhen: "The material addresses the actual route conditions.",
          },
          {
            key: "take-market-action",
            title: "Take the external route action",
            executor: "user_action",
            outputSpec: "A submitted, sent, scheduled or otherwise live market action.",
            doneWhen: "The route has moved from planning into the real market.",
          },
          {
            key: "record-signal",
            title: "Record the response and what it says about access",
            executor: "system",
            outputSpec: "A structured access signal and any updated route constraint.",
            doneWhen: "The result can update coverage or the route map.",
          },
        ],
      },
    ];
  }

  if (module.type === "credential") {
    return [
      {
        key: "verify-credential",
        title: `Verify the formal requirement for ${label}`,
        kind: "credential",
        why: "Credentials can consume substantial time and money, so their materiality must be confirmed first.",
        doneWhen: "The requirement, applicable contexts and accepted alternatives are source-backed.",
        minimumOutcome: "One direct source confirms whether the credential is required, preferred or unnecessary.",
        expectedEvidence: `A verified credential decision for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "check-direct-sources",
            title: "Check direct employer, regulator or institution sources",
            executor: "system",
            outputSpec: "Source-backed evidence of the credential's actual status.",
            doneWhen: "The requirement is not based on generic career advice.",
          },
          {
            key: "check-alternatives",
            title: "Identify accepted alternatives and context limits",
            executor: "system",
            outputSpec: "A clear list of equivalent evidence and where it applies.",
            doneWhen: "The user can avoid unnecessary qualification work where alternatives exist.",
          },
        ],
      },
      {
        key: "select-credential-route",
        title: `Select the proportionate route for ${label}`,
        kind: "credential",
        why: "Only a verified requirement should become a qualification route.",
        doneWhen: "The route, cost, effort, evidence and decision rationale are documented.",
        minimumOutcome: "The user has a go, no-go or defer decision with a reason.",
        expectedEvidence: `A credential route decision for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "compare-options",
            title: "Compare credible qualification and alternative-evidence routes",
            executor: "system",
            outputSpec: "A compact comparison of credibility, cost, time and evidence produced.",
            doneWhen: "The options are comparable and unsupported providers are excluded.",
          },
          {
            key: "make-decision",
            title: "Confirm the route decision",
            executor: "user_action",
            outputSpec: "A user-approved go, no-go or defer decision.",
            doneWhen: "No financial or enrollment action occurs without explicit user confirmation.",
          },
        ],
      },
      {
        key: "complete-credential",
        title: `Complete and retain the evidence for ${label}`,
        kind: "credential",
        why: "Where the route is approved, the user must complete the learning or formal action and retain proof.",
        doneWhen: standard,
        minimumOutcome: "The first approved enrollment, assessment or evidence step is complete.",
        expectedEvidence: output,
        effort: "project",
        subtasks: [
          {
            key: "complete-route",
            title: "Complete the approved qualification or alternative-evidence route",
            executor: "user_learning",
            outputSpec: "The required assessment, qualification or equivalent evidence.",
            doneWhen: "The approved route's formal completion condition is met.",
          },
          {
            key: "perform-external-actions",
            title: "Complete any required enrollment, submission or verification actions",
            executor: "user_action",
            condition: "if_needed",
            outputSpec: "Confirmed external actions and receipts where appropriate.",
            doneWhen: "All required real-world actions are complete.",
          },
          {
            key: "store-proof",
            title: "Store the final formal evidence",
            executor: "system",
            outputSpec: "A retrievable credential or accepted-alternative evidence record.",
            doneWhen: "The evidence can be reused in applications and coverage assessment.",
          },
        ],
      },
    ];
  }

  if (module.type === "eligibility") {
    return [
      {
        key: "verify-eligibility",
        title: `Verify the eligibility condition for ${label}`,
        kind: "credential",
        why: "Eligibility can be a hard gate, a resolvable constraint or an employer-specific preference.",
        doneWhen: "The exact condition, scope and accepted evidence are confirmed from direct sources.",
        minimumOutcome: "The condition is classified as applicable, conditional or non-applicable.",
        expectedEvidence: `A verified eligibility decision for ${label}`,
        effort: "medium",
        subtasks: [
          {
            key: "check-condition",
            title: "Check the formal condition and where it applies",
            executor: "system",
            outputSpec: "Direct-source evidence of the eligibility rule and context.",
            doneWhen: "The condition is not generalized beyond the evidence.",
          },
          {
            key: "identify-resolution",
            title: "Identify accepted evidence, alternatives or resolution routes",
            executor: "system",
            outputSpec: "A factual resolution map with unresolved constraints.",
            doneWhen: "The next formal action, if any, is clear.",
          },
        ],
      },
      {
        key: "resolve-eligibility",
        title: `Resolve or document ${label}`,
        kind: "credential",
        why: "The user must control any document, legal, relocation or authorization action.",
        doneWhen: standard,
        minimumOutcome: "The first required evidence or formal action is complete.",
        expectedEvidence: output,
        effort: "project",
        subtasks: [
          {
            key: "gather-evidence",
            title: "Gather the required personal evidence or documentation",
            executor: "user_action",
            outputSpec: "The documents or factual status needed to establish eligibility.",
            doneWhen: "The necessary evidence is complete and accurate.",
          },
          {
            key: "complete-formal-action",
            title: "Complete the external resolution action",
            executor: "user_action",
            condition: "if_needed",
            outputSpec: "A submitted application, verification or other formal action.",
            doneWhen: "The required real-world action is completed or a blocker is explicitly recorded.",
          },
          {
            key: "record-status",
            title: "Record the resolved status and reusable evidence",
            executor: "system",
            outputSpec: "A current eligibility record and evidence links.",
            doneWhen: "The status can be assessed without repeating the research.",
          },
        ],
      },
    ];
  }

  return [{
    key: "resolve-module",
    title: `Complete ${label}`,
    kind: "validation",
    why: compact(module.objective),
    doneWhen: standard,
    minimumOutcome: `A usable first output exists for ${label}.`,
    expectedEvidence: output,
    effort: "deep",
    subtasks: uniqueStrings(module.activities).slice(0, 5).map((activity, index) => ({
      key: `activity-${index + 1}`,
      title: activity,
      executor: "user_learning" as const,
      outputSpec: index === module.activities.length - 1 ? output : "Observable progress toward the module output.",
      doneWhen: "The activity's intended output exists.",
    })),
  }];
}

function ownerFromSubtasks(subtasks: SubtaskBlueprint[]): BlueprintOwner {
  const always = subtasks.filter((subtask) => subtask.condition === "always");
  const basis = always.length ? always : subtasks;
  const executors = new Set(basis.map((subtask) => subtask.executor));
  if (executors.size === 1 && executors.has("system")) return "anchor";
  if (!executors.has("system")) return "user";
  return "shared";
}

function categoryFor(kind: TaskBlueprintKind): TaskMaterializationDraft["category"] {
  if (kind === "learning" || kind === "practice") return "learning";
  if (kind === "artifact" || kind === "experience" || kind === "validation") return "hustle";
  if (kind === "relationship" || kind === "access") return "job";
  return "admin";
}

function taskSize(effort: BlueprintEffort): TaskMaterializationDraft["size"] {
  if (effort === "quick") return "quick";
  if (effort === "medium") return "medium";
  return "deep";
}

function buildSubtasks(taskId: string, templates: SubtaskTemplate[]): SubtaskBlueprint[] {
  const result: SubtaskBlueprint[] = [];
  for (const [index, template] of templates.slice(0, 5).entries()) {
    const id = stableId("subtask-blueprint", taskId, template.key, index + 1);
    result.push({
      id,
      title: compact(template.title),
      executor: template.executor,
      condition: template.condition || "always",
      outputSpec: compact(template.outputSpec),
      doneWhen: compact(template.doneWhen),
      dependsOnSubtaskIds: index > 0 ? [result[index - 1].id] : [],
    });
  }
  return result;
}

function moduleRank(type: DevelopmentModuleType): number {
  const rank: Record<DevelopmentModuleType, number> = {
    verification: 0,
    syllabus: 1,
    practice: 2,
    experience: 2,
    relationships: 2,
    access: 3,
    proof: 4,
    narrative: 5,
    credential: 2,
    eligibility: 2,
  };
  return rank[type];
}

function dependencyRelevant(current: DevelopmentModule, prior: DevelopmentModule): boolean {
  const overlap = current.requirementIds.some((id) => prior.requirementIds.includes(id));
  if (!overlap) return false;
  if (current.type === "proof") return ["syllabus", "practice", "experience"].includes(prior.type);
  if (current.type === "narrative") return ["experience", "proof"].includes(prior.type);
  if (current.type === "access") return prior.type === "relationships";
  return false;
}

function assignMilestones(
  tasks: TaskBlueprint[],
  workstream: DevelopmentWorkstream,
): TaskBlueprint[] {
  const assigned = new Set<string>();
  const result = tasks.map((task) => ({ ...task, milestoneIds: [...task.milestoneIds] }));
  for (const milestone of [...workstream.milestones].sort((left, right) => left.sequence - right.sequence)) {
    const candidates = result.filter((task) => task.requirementIds.some((id) => milestone.requirementIds.includes(id)));
    const target = candidates[candidates.length - 1] || result[result.length - 1];
    if (!target) continue;
    target.milestoneIds = uniqueStrings([...target.milestoneIds, milestone.id]);
    assigned.add(milestone.id);
  }
  return result;
}

function tasksForWorkstream(workstream: DevelopmentWorkstream): TaskBlueprint[] {
  const modules = [...workstream.modules].sort((left, right) => moduleRank(left.type) - moduleRank(right.type));
  const tasks: TaskBlueprint[] = [];
  const lastTaskByModule = new Map<string, string>();

  for (const module of modules) {
    const templates = taskTemplates(module);
    let previousTaskId: string | null = null;
    const priorDependencies = modules
      .filter((prior) => moduleRank(prior.type) < moduleRank(module.type) && dependencyRelevant(module, prior))
      .map((prior) => lastTaskByModule.get(prior.id))
      .filter((id): id is string => Boolean(id));

    for (const [index, template] of templates.entries()) {
      const id = stableId("task-blueprint", workstream.id, module.id, template.key);
      const subtasks = buildSubtasks(id, template.subtasks);
      const dependsOnTaskIds = index === 0
        ? uniqueStrings(priorDependencies)
        : previousTaskId ? [previousTaskId] : [];
      const readiness: BlueprintReadiness = module.scope === "conditional"
        ? "conditional"
        : dependsOnTaskIds.length ? "depends_on_blueprint" : "ready";
      const task: TaskBlueprint = {
        id,
        key: `${workstream.id}:${module.id}:${template.key}`,
        workstreamId: workstream.id,
        moduleId: module.id,
        moduleTitle: module.title,
        milestoneIds: [],
        requirementIds: [...module.requirementIds],
        sequence: tasks.length + 1,
        title: template.title,
        kind: template.kind,
        owner: ownerFromSubtasks(subtasks),
        why: template.why,
        doneWhen: template.doneWhen,
        minimumOutcome: template.minimumOutcome,
        expectedEvidence: template.expectedEvidence,
        effort: template.effort,
        readiness,
        readinessReason: module.scope === "conditional"
          ? "This task belongs to a role-specific or contextual module and should activate only when that route is selected."
          : dependsOnTaskIds.length
            ? "A logically required blueprint task must complete first."
            : "No blueprint dependency prevents this task from starting.",
        dependsOnTaskIds,
        subtasks,
        materialization: {
          state: "blueprint_only",
          taskDraft: {
            category: categoryFor(template.kind),
            size: taskSize(template.effort),
            doneWhen: template.doneWhen,
            minimumOutcome: template.minimumOutcome,
            sourceType: "career_track",
            sourceStepType: "execution_blueprint_task",
          },
        },
      };
      tasks.push(task);
      previousTaskId = id;
    }
    if (previousTaskId) lastTaskByModule.set(module.id, previousTaskId);
  }

  return assignMilestones(tasks, workstream);
}

function cycleIds(tasks: TaskBlueprint[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();

  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      for (const value of path.slice(Math.max(0, start))) cyclic.add(value);
      cyclic.add(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const task = byId.get(id);
    for (const dependencyId of task?.dependsOnTaskIds || []) visit(dependencyId, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };

  for (const task of tasks) visit(task.id, []);
  return [...cyclic];
}

function buildQuality(
  developmentPlan: DevelopmentPlanModel,
  tasks: TaskBlueprint[],
): ExecutionBlueprintModel["quality"] {
  const modules = developmentPlan.workstreams.flatMap((workstream) => workstream.modules);
  const milestones = developmentPlan.workstreams.flatMap((workstream) => workstream.milestones);
  const activeRequirementIds = uniqueStrings(developmentPlan.workstreams.flatMap((workstream) => workstream.requirementIds));
  const coveredModuleIds = new Set(tasks.map((task) => task.moduleId));
  const coveredMilestoneIds = new Set(tasks.flatMap((task) => task.milestoneIds));
  const coveredRequirementIds = new Set(tasks.flatMap((task) => task.requirementIds));
  const orphanModuleIds = modules.filter((module) => !coveredModuleIds.has(module.id)).map((module) => module.id);
  const orphanMilestoneIds = milestones.filter((milestone) => !coveredMilestoneIds.has(milestone.id)).map((milestone) => milestone.id);
  const orphanRequirementIds = activeRequirementIds.filter((id) => !coveredRequirementIds.has(id));
  const taskIds = new Set(tasks.map((task) => task.id));
  const invalidDependencyIds = uniqueStrings(tasks.flatMap((task) => task.dependsOnTaskIds).filter((id) => !taskIds.has(id)));
  const cyclicTaskIds = cycleIds(tasks);
  const keyCounts = new Map<string, number>();
  for (const task of tasks) keyCounts.set(task.key, (keyCounts.get(task.key) || 0) + 1);
  const duplicateTaskKeys = [...keyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const oversizedTaskIds = tasks.filter((task) => task.subtasks.length > 5 || !task.doneWhen || !task.expectedEvidence).map((task) => task.id);
  const rate = (covered: number, total: number) => total ? Math.round((covered / total) * 100) : 100;
  const moduleCoverageRate = rate(modules.length - orphanModuleIds.length, modules.length);
  const milestoneCoverageRate = rate(milestones.length - orphanMilestoneIds.length, milestones.length);
  const requirementCoverageRate = rate(activeRequirementIds.length - orphanRequirementIds.length, activeRequirementIds.length);
  const caveats: string[] = [];
  if (tasks.length > 36) caveats.push("The full blueprint contains more than 36 task blueprints; the review experience should keep all but one workstream collapsed.");
  if (orphanModuleIds.length) caveats.push(`${orphanModuleIds.length} development module${orphanModuleIds.length === 1 ? "" : "s"} lack task coverage.`);
  if (orphanMilestoneIds.length) caveats.push(`${orphanMilestoneIds.length} milestone${orphanMilestoneIds.length === 1 ? "" : "s"} lack a completion task.`);
  if (orphanRequirementIds.length) caveats.push(`${orphanRequirementIds.length} active requirement${orphanRequirementIds.length === 1 ? "" : "s"} lack execution coverage.`);
  if (invalidDependencyIds.length) caveats.push(`${invalidDependencyIds.length} task dependency reference${invalidDependencyIds.length === 1 ? " is" : "s are"} invalid.`);
  if (cyclicTaskIds.length) caveats.push("The task dependency graph contains a cycle.");
  if (duplicateTaskKeys.length) caveats.push("The blueprint contains duplicate stable task keys.");
  if (oversizedTaskIds.length) caveats.push(`${oversizedTaskIds.length} task blueprint${oversizedTaskIds.length === 1 ? "" : "s"} fail the atomicity or evidence contract.`);
  const complete = moduleCoverageRate === 100
    && milestoneCoverageRate === 100
    && requirementCoverageRate === 100
    && !invalidDependencyIds.length
    && !cyclicTaskIds.length
    && !duplicateTaskKeys.length
    && !oversizedTaskIds.length;
  const usable = moduleCoverageRate >= 90 && milestoneCoverageRate >= 90 && requirementCoverageRate >= 90;
  return {
    status: complete ? "complete" : usable ? "usable_with_caveats" : "provisional",
    moduleCoverageRate,
    milestoneCoverageRate,
    requirementCoverageRate,
    orphanModuleIds,
    orphanMilestoneIds,
    orphanRequirementIds,
    duplicateTaskKeys,
    invalidDependencyIds,
    cyclicTaskIds,
    oversizedTaskIds,
    caveats,
  };
}

export function executionBlueprintSourceFingerprint(developmentPlan: DevelopmentPlanModel): string {
  return hash({
    version: developmentPlan.version,
    targetLabel: developmentPlan.targetLabel,
    requirementModelFingerprint: developmentPlan.requirementModelFingerprint,
    coverageFingerprint: developmentPlan.coverageFingerprint,
    sourceContextFingerprint: developmentPlan.sourceContextFingerprint,
    decisions: developmentPlan.decisions,
    workstreams: developmentPlan.workstreams,
    maintenanceRequirementIds: developmentPlan.maintenanceRequirementIds,
  });
}

export function buildExecutionBlueprintDraft(developmentPlan: DevelopmentPlanModel): ExecutionBlueprintModel {
  const tasks = developmentPlan.workstreams.flatMap(tasksForWorkstream);
  const workstreams = developmentPlan.workstreams.map((workstream) => {
    const workstreamTasks = tasks.filter((task) => task.workstreamId === workstream.id);
    return {
      workstreamId: workstream.id,
      title: workstream.title,
      objective: workstream.objective,
      taskIds: workstreamTasks.map((task) => task.id),
      moduleIds: workstream.modules.map((module) => module.id),
      milestoneIds: workstream.milestones.map((milestone) => milestone.id),
      completionTaskId: workstreamTasks[workstreamTasks.length - 1]?.id || null,
    } satisfies WorkstreamExecutionBlueprint;
  });
  const subtaskCount = tasks.reduce((sum, task) => sum + task.subtasks.length, 0);
  const sourceFingerprint = executionBlueprintSourceFingerprint(developmentPlan);
  return {
    mode: "execution_blueprint_model",
    version: EXECUTION_BLUEPRINT_VERSION,
    targetLabel: developmentPlan.targetLabel,
    developmentPlanVersion: developmentPlan.version,
    developmentPlanFingerprint: sourceFingerprint,
    sourceFingerprint,
    objective: `Define the complete work hierarchy beneath the development plan for ${developmentPlan.targetLabel} without yet scheduling or materializing it.`,
    principles: [
      "The development plan determines the work hierarchy; the live task list does not determine strategy.",
      "Every task blueprint produces an observable output, state change or evidence signal.",
      "Anchor handles artifact generation where doing so does not destroy the value of user learning or real-world action.",
      "User input is conditional and focused; verification does not become a questionnaire.",
      "Dependencies express logical prerequisites only, not daily priority.",
      "Role-specific work remains conditional until that route is active.",
      "No blueprint task is added to Today or the live task list in this installment.",
    ],
    workstreams,
    tasks,
    summary: {
      workstreamCount: workstreams.length,
      moduleCount: developmentPlan.workstreams.reduce((sum, workstream) => sum + workstream.modules.length, 0),
      milestoneCount: developmentPlan.workstreams.reduce((sum, workstream) => sum + workstream.milestones.length, 0),
      taskCount: tasks.length,
      subtaskCount,
      anchorOwnedTaskCount: tasks.filter((task) => task.owner === "anchor").length,
      userOwnedTaskCount: tasks.filter((task) => task.owner === "user").length,
      sharedTaskCount: tasks.filter((task) => task.owner === "shared").length,
      conditionalTaskCount: tasks.filter((task) => task.readiness === "conditional").length,
    },
    quality: buildQuality(developmentPlan, tasks),
    materializationStatus: "blueprint_only",
    generatedAt: Date.now(),
  };
}
