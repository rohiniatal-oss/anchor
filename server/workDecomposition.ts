import type {
  ActionStep,
  MilestoneProposal,
  ProjectDecomposition,
  TaskDecomposition,
  TaskProposal,
  WorkDecomposition,
  WorkDefinition,
} from "@shared/work";
import {
  projectDecompositionSchema,
  taskDecompositionSchema,
  workDecompositionSchema,
} from "@shared/work";
import { llmJSON, LLM_MODELS } from "./llm";

function compact(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slug(value: string) {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "milestone";
}

function categoryFor(definition: WorkDefinition) {
  const text = `${definition.title} ${definition.objective} ${definition.desiredOutcome}`.toLowerCase();
  if (/\b(role|job|application|interview|career|hiring)\b/.test(text)) return "job";
  if (/\b(learn|practice|capability|skill|course)\b/.test(text)) return "learning";
  if (/\b(write|memo|article|portfolio|publish|proof asset)\b/.test(text)) return "substack";
  if (/\b(contact|message|outreach|conversation|relationship|reconnect)\b/.test(text)) return "admin";
  return definition.workType === "decision" ? "thinking" : "admin";
}

function targetLabel(definition: WorkDefinition) {
  const source = compact(definition.sourceTitle);
  const stripped = source.replace(/^(?:please\s+)?(?:research|investigate|look\s+into|find\s+out\s+about|explore|understand|prepare|review|work\s+on|improve|fix|sort\s+out|think\s+about|plan|figure\s+out|develop|build|create|draft|write|organize|organise|update|launch|set\s+up)\s+(?:about\s+)?/i, "")
    .replace(/\s+(?:so\s+that|so\s+i\s+can|to\s+help\s+me|in\s+order\s+to)\s+.+$/i, "")
    .replace(/[.?!]+$/g, "")
    .trim();
  return stripped || definition.title;
}

function isResearch(definition: WorkDefinition) {
  return /\b(research|investigate|landscape|source|evidence|sourced|current developments|pursue)\b/i.test(`${definition.sourceTitle} ${definition.objective} ${definition.desiredOutcome}`);
}

function isCreation(definition: WorkDefinition) {
  return /\b(write|draft|create|build|develop|design|launch|memo|article|portfolio|product|plan)\b/i.test(`${definition.sourceTitle} ${definition.objective} ${definition.deliverables.join(" ")}`);
}

function isPreparation(definition: WorkDefinition) {
  return /\b(prepare|interview|meeting|conversation|presentation|assessment)\b/i.test(`${definition.sourceTitle} ${definition.objective}`);
}

function action(text: string, outputSpec: string, executor: ActionStep["executor"] = "user_action"): ActionStep {
  return { text, outputSpec, executor, done: false };
}

function task(
  input: Omit<TaskProposal, "category" | "estimateMinutes" | "whyNow"> & {
    category?: string;
    estimateMinutes?: number;
    whyNow?: string;
  },
  definition: WorkDefinition,
): TaskProposal {
  return {
    title: compact(input.title).slice(0, 180),
    objective: compact(input.objective).slice(0, 800),
    doneWhen: compact(input.doneWhen).slice(0, 800),
    output: compact(input.output).slice(0, 800),
    whyNow: compact(input.whyNow || definition.whyNow).slice(0, 800),
    estimateMinutes: input.estimateMinutes || 30,
    category: input.category || categoryFor(definition),
  };
}

function milestone(input: Omit<MilestoneProposal, "key" | "sequence"> & { key?: string }, sequence: number): MilestoneProposal {
  return {
    key: input.key || slug(input.title),
    title: compact(input.title).slice(0, 180),
    outcome: compact(input.outcome).slice(0, 800),
    doneWhen: compact(input.doneWhen).slice(0, 800),
    sequence,
  };
}

function researchProject(definition: WorkDefinition): ProjectDecomposition {
  const target = targetLabel(definition);
  const milestones = [
    milestone({
      key: "map-current-landscape",
      title: `Map the current ${target} landscape`,
      outcome: `A bounded map of the current parts of ${target} that could affect the project objective.`,
      doneWhen: "The most relevant current teams, roles, programmes, people, or signals are listed with primary-source links and an explanation of relevance.",
    }, 0),
    milestone({
      key: "identify-real-options",
      title: "Identify the realistic paths",
      outcome: "The plausible opportunity, relationship, learning, or no-action paths are explicit.",
      doneWhen: "Each realistic path has enough evidence to compare and obvious non-options are ruled out.",
    }, 1),
    milestone({
      key: "assess-fit-and-constraints",
      title: "Assess fit, evidence, and constraints",
      outcome: "The strongest fit, largest material gap, and important constraint are visible.",
      doneWhen: "The assessment uses the user's actual evidence and distinguishes fact, inference, and uncertainty.",
    }, 2),
    milestone({
      key: "test-access-or-action",
      title: "Test the strongest route",
      outcome: "One concrete application, conversation, verification, or evidence-building move tests the best path.",
      doneWhen: "The test produces new information or a usable artifact rather than more open-ended research.",
    }, 3),
    milestone({
      key: "make-decision",
      title: "Make and record the decision",
      outcome: definition.desiredOutcome,
      doneWhen: definition.successCriteria.join("; ") || "The pursue, change, monitor, or stop decision and next commitment are recorded.",
    }, 4),
  ];
  const currentTasks = [
    task({
      title: `Map three current ${target} signals relevant to the objective`,
      objective: `Find the smallest evidence set that shows which current parts of ${target} matter to this project.`,
      doneWhen: "Three current signals are saved from primary or authoritative sources, each with a link and one sentence explaining relevance.",
      output: `A three-item current-landscape map for ${target}.`,
      estimateMinutes: 35,
    }, definition),
    task({
      title: `Write the question each ${target} signal must answer`,
      objective: "Prevent broad browsing by defining the decision-relevant question for each signal.",
      doneWhen: "Each saved signal is tied to one question that could change the project decision.",
      output: "Three decision-relevant research questions.",
      estimateMinutes: 15,
      category: "thinking",
    }, definition),
  ];
  return projectDecompositionSchema.parse({
    version: 1,
    projectTitle: definition.title,
    milestones,
    currentMilestoneKey: milestones[0].key,
    currentTasks,
    activeTaskIndex: 0,
    activeTaskSteps: [
      action(`Open a primary or authoritative source for ${target} and save the first current page relevant to “${definition.objective}”`, "One saved source link"),
      action("Extract the specific team, role, programme, person, or change shown by the source", "One factual signal in plain language", "system"),
      action(`Write one sentence on how that signal could change the ${definition.title} decision`, "One relevance sentence", "user_learning"),
      action("Repeat until three distinct signals are saved, then mark the strongest one", "A three-item map with one priority signal"),
    ],
    rollingPlan: true,
    stopCondition: "Stop after the current milestone has enough evidence to choose the next realistic path; do not fully detail later milestones yet.",
  });
}

function creationProject(definition: WorkDefinition): ProjectDecomposition {
  const target = targetLabel(definition);
  const milestones = [
    milestone({ title: "Define the user, purpose, and quality bar", outcome: `The intended user, purpose, constraints, and success criteria for ${target} are explicit.`, doneWhen: "The required outcome and non-negotiable criteria are agreed." }, 0),
    milestone({ title: "Build the minimum viable structure", outcome: `The smallest complete structure for ${target} exists.`, doneWhen: "Every required section or component has a place and the largest unknown is marked." }, 1),
    milestone({ title: "Produce the first usable version", outcome: `A complete first version of ${target} exists.`, doneWhen: "The version can be reviewed or used end to end without placeholders that block its purpose." }, 2),
    milestone({ title: "Validate and improve", outcome: "The version is tested against the success criteria and the most material weakness is corrected.", doneWhen: "Evidence from review or use supports the main changes." }, 3),
    milestone({ title: "Deliver and record the result", outcome: definition.desiredOutcome, doneWhen: definition.successCriteria.join("; ") || "The final version is delivered and the result is recorded." }, 4),
  ];
  const currentTasks = [
    task({ title: `Define who ${target} is for and what it must enable`, objective: `Turn ${target} into a precise outcome before building it.`, doneWhen: "The primary user, job-to-be-done, and three success criteria are written.", output: `A one-page definition for ${target}.`, estimateMinutes: 25, category: "thinking" }, definition),
    task({ title: `List the minimum components of ${target}`, objective: "Create a bounded structure that can become a complete first version.", doneWhen: "The minimum component list is complete and optional items are separated.", output: `A minimum viable structure for ${target}.`, estimateMinutes: 20 }, definition),
  ];
  return projectDecompositionSchema.parse({
    version: 1,
    projectTitle: definition.title,
    milestones,
    currentMilestoneKey: milestones[0].key,
    currentTasks,
    activeTaskIndex: 0,
    activeTaskSteps: [
      action(`Open a note titled “${target}: definition”`, "A named working note"),
      action(`Write the one person or group who will use ${target}`, "A primary user statement"),
      action("Write the change or decision the finished work must enable", "A one-sentence purpose"),
      action("Add three observable success criteria and save the definition", "Three testable success criteria"),
    ],
    rollingPlan: true,
    stopCondition: "Stop after the outcome and minimum structure are clear; detail the build milestone only after this definition is accepted.",
  });
}

function generalProject(definition: WorkDefinition): ProjectDecomposition {
  const target = targetLabel(definition);
  const milestones = [
    milestone({ title: "Define the outcome and constraints", outcome: `The exact outcome, boundaries, and success criteria for ${target} are explicit.`, doneWhen: "The project can be explained in one outcome sentence and tested against visible criteria." }, 0),
    milestone({ title: "Gather the essential inputs", outcome: "The evidence, people, materials, and dependencies needed for the next phase are available.", doneWhen: "Missing inputs are resolved, assigned, or explicitly accepted as constraints." }, 1),
    milestone({ title: "Produce the first complete result", outcome: `A complete, usable version of ${target} exists.`, doneWhen: "The result works end to end at the minimum acceptable quality." }, 2),
    milestone({ title: "Test and correct the highest-risk issue", outcome: "The result is checked against the success criteria and the largest risk is addressed.", doneWhen: "The test evidence and resulting correction are recorded." }, 3),
    milestone({ title: "Finish and close the project", outcome: definition.desiredOutcome, doneWhen: definition.successCriteria.join("; ") || "The final outcome is delivered and the next commitment is clear." }, 4),
  ];
  const currentTasks = [
    task({ title: `Define the completed outcome for ${target}`, objective: "Replace the broad intention with an observable end state.", doneWhen: "The outcome, user or beneficiary, boundaries, and three success criteria are recorded.", output: `A project definition for ${target}.`, estimateMinutes: 25, category: "thinking" }, definition),
    task({ title: `List the inputs and constraints for ${target}`, objective: "Expose the smallest set of dependencies that could block progress.", doneWhen: "Essential inputs, owners, constraints, and unresolved questions are listed.", output: `An input-and-constraint map for ${target}.`, estimateMinutes: 20 }, definition),
  ];
  return projectDecompositionSchema.parse({
    version: 1,
    projectTitle: definition.title,
    milestones,
    currentMilestoneKey: milestones[0].key,
    currentTasks,
    activeTaskIndex: 0,
    activeTaskSteps: [
      action(`Open a note titled “${target}: project definition”`, "A named working note"),
      action("Write the observable state that will be true when the project is complete", "A one-sentence desired outcome"),
      action("Name the user or beneficiary and the boundary of what is not included", "A user statement and scope boundary"),
      action("Add three testable success criteria and save the definition", "Three success criteria"),
    ],
    rollingPlan: true,
    stopCondition: "Stop after the first milestone is defined and its active task is ready; defer detailed later tasks until new evidence exists.",
  });
}

function taskDecomposition(definition: WorkDefinition): TaskDecomposition {
  const target = targetLabel(definition);
  const category = categoryFor(definition);
  const proposal = task({
    title: definition.sourceTitle || definition.title,
    objective: definition.objective,
    doneWhen: definition.successCriteria.join("; ") || definition.desiredOutcome,
    output: definition.deliverables[0] || definition.desiredOutcome,
    whyNow: definition.whyNow,
    estimateMinutes: definition.estimatedScope === "single_action" ? 10 : 30,
    category,
  }, definition);
  let steps: ActionStep[];
  if (isResearch(definition)) {
    steps = [
      action(`Open one primary or authoritative source for ${target} and save the link`, "One source link"),
      action(`Extract only the facts needed to answer “${definition.objective}”`, "A short set of decisive facts", "system"),
      action(`Write what the evidence means for ${definition.whyNow || "the current goal"}, including the main uncertainty`, "An implication and uncertainty", "user_learning"),
      action("Save the answer with one decision or next action, then stop", proposal.output),
    ];
  } else if (definition.workType === "decision") {
    steps = [
      action(`Write the exact decision about ${target} in one line`, "A decision question"),
      action("List the real options and the three criteria that matter", "Options and criteria", "system"),
      action("Mark the evidence for and against each option", "A comparison against the criteria", "user_learning"),
      action("Record the current choice and next test or action", proposal.output),
    ];
  } else if (isPreparation(definition)) {
    steps = [
      action(`Open the invitation, brief, source, or notes for ${target}`, "The preparation source"),
      action("Extract the format, likely asks, and highest-risk point", "A preparation checklist", "system"),
      action("Match the strongest available evidence to the highest-risk ask", "One usable response or talking point", "user_learning"),
      action("Save the brief and mark the first thing to rehearse or verify", proposal.output),
    ];
  } else {
    steps = [
      action(`Open the object or source for ${target}`, "The working object is open"),
      action(`Make the smallest complete change that produces ${proposal.output}`, proposal.output),
      action(`Check the result against: ${definition.successCriteria[0] || proposal.doneWhen}`, "A pass, fail, or correction note", "user_learning"),
      action("Save the result and record the next action only if one remains", proposal.output),
    ];
  }
  return taskDecompositionSchema.parse({ version: 1, task: proposal, steps, rollingPlan: false });
}

export function decomposeWorkDeterministically(definition: WorkDefinition): WorkDecomposition {
  if (definition.workType === "project") {
    const project = isResearch(definition)
      ? researchProject(definition)
      : isCreation(definition)
        ? creationProject(definition)
        : generalProject(definition);
    return { kind: "project", project };
  }
  return { kind: "task", task: taskDecomposition(definition) };
}

export async function decomposeWork(definition: WorkDefinition, context = ""): Promise<WorkDecomposition> {
  const fallback = decomposeWorkDeterministically(definition);
  const prompt = `You are Anchor's work-decomposition engine. The work has already been interpreted. Do not reclassify it.\n\nWORK DEFINITION\n${JSON.stringify(definition)}\n\nAVAILABLE CONTEXT\n${context.slice(0, 9000)}\n\nDETERMINISTIC PLAN\n${JSON.stringify(fallback)}\n\nReturn only JSON matching the deterministic plan's shape.\nRules:\n- A project has 3-6 outcome milestones. Milestones are not actions.\n- Detail only the current milestone. Propose at most three independently useful tasks.\n- Provide action steps only for the selected active task.\n- Each task must produce an output useful even if the project stops afterwards.\n- Do not invent current facts, names, links, deadlines, or requirements.\n- Use supplied evidence and distinguish facts from assumptions.\n- Keep the plan rolling: later milestones remain high level until earlier work produces evidence.\n- A task plan has at most six immediately startable actions, each with a visible output.\n- Never use filler such as 'make progress', 'do something concrete', or 'write a rough sentence'.`;
  const result = await llmJSON<Record<string, unknown>>(prompt, { model: LLM_MODELS.breakdown, retries: 1 });
  const parsed = workDecompositionSchema.safeParse(result);
  return parsed.success ? parsed.data : fallback;
}
