import type { Express } from "express";
import OpenAI from "openai";
import type { Hustle, Job, Learn, Task } from "@shared/schema";
import { storage } from "./storage";
import { deterministicUnstickStep } from "./planningFeedback";

type WorkObject = "Artifact" | "Decision" | "Knowledge" | "Capability" | "Pipeline" | "Problem";
type WorkflowKind = "finite" | "continuous";
type WorkflowState = {
  workObject: WorkObject | string;
  workflow: string[];
  workflowKind: WorkflowKind;
  currentStage: string;
  stageOutput: string;
  completionCriteria: string[];
  advanceCondition: string;
  nextStage?: string;
  confidence?: string;
  inheritedFrom?: string;
};
type BreakdownStep = { text: string; done: false; substeps?: string[]; workflowState?: WorkflowState };
type SourceRecord = Job | Learn | Hustle | null;
type SourceBundle = {
  sourceContext: string;
  playbook: string;
  sourceKind: "job" | "learn" | "hustle" | "goal" | "task";
  source: SourceRecord;
  parentContext: string;
  parentWorkflow?: WorkflowState;
};

function jobSource(bundle: SourceBundle): Job | null {
  return bundle.sourceKind === "job" ? bundle.source as Job | null : null;
}

function learnSource(bundle: SourceBundle): Learn | null {
  return bundle.sourceKind === "learn" ? bundle.source as Learn | null : null;
}

function hustleSource(bundle: SourceBundle): Hustle | null {
  return bundle.sourceKind === "hustle" ? bundle.source as Hustle | null : null;
}

const WORKFLOWS: Record<WorkObject, string[]> = {
  Artifact: ["Clarify purpose", "Gather inputs", "Structure", "Draft", "Refine", "QC", "Deliver"],
  Decision: ["Frame question", "Define criteria", "Generate options", "Evaluate", "Decide", "Commit"],
  Knowledge: ["Orient", "Scope useful slice", "Inspect", "Extract", "Synthesize", "Store"],
  Capability: ["Define capability", "Learn model", "Practise", "Apply in context", "Reflect", "Consolidate"],
  Pipeline: ["Define target", "Build list", "Prioritise", "Execute next batch", "Track", "Follow up", "Review conversion"],
  Problem: ["Define symptom", "Diagnose cause", "Choose fix options", "Test", "Implement", "Verify"],
};

const APPLICATION_WORKFLOW = ["Understand role", "Map evidence", "Handle gaps", "Build materials", "Submit", "Follow up"];
const PROOF_WORKFLOW = ["Define claim", "Choose audience", "Gather evidence", "Draft fragment", "Save for reuse"];

function compact(value: unknown, max = 90) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanText(value: unknown, max = 140) {
  return compact(value, max).replace(/^[-*\d.)\s]+/, "").trim();
}
function keyword(text: string, re: RegExp) {
  return re.test(text.toLowerCase());
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}
function workflowKindFor(workObject: WorkObject | string, sourceKind?: SourceBundle["sourceKind"]): WorkflowKind {
  if (workObject === "Pipeline") return "continuous";
  if (sourceKind === "learn" && workObject === "Capability") return "continuous";
  return "finite";
}
function normalizeWorkObject(value: unknown, fallback: WorkObject): WorkObject | string {
  const v = String(value || "").trim();
  return ["Artifact", "Decision", "Knowledge", "Capability", "Pipeline", "Problem"].includes(v) ? v : fallback;
}
function normalizeList(value: unknown, fallback: string[] = [], max = 6): string[] {
  return (Array.isArray(value) ? value : fallback).map((x) => cleanText(x, 120)).filter(Boolean).slice(0, max);
}
function nextStage(workflow: string[], currentStage: string, kind: WorkflowKind) {
  const ix = workflow.findIndex((s) => s.toLowerCase() === currentStage.toLowerCase());
  if (ix < 0) return workflow[0] || "";
  if (ix + 1 < workflow.length) return workflow[ix + 1];
  return kind === "continuous" ? workflow[0] : "Complete";
}
function defaultCriteria(stageOutput: string, currentStage: string) {
  const output = stageOutput || "The stage output exists";
  if (/map evidence/i.test(currentStage)) return ["Critical requirements are listed", "At least one credible example is mapped to each critical requirement"];
  if (/build materials|draft|structure/i.test(currentStage)) return [output, "One missing gap or next edit is recorded"];
  if (/follow up|execute next batch/i.test(currentStage)) return [output, "The action is sent or logged"];
  return [output];
}
function makeWorkflowState(input: {
  workObject: WorkObject | string;
  workflow: string[];
  currentStage: string;
  stageOutput: string;
  completionCriteria?: string[];
  advanceCondition?: string;
  confidence?: string;
  inheritedFrom?: string;
  sourceKind?: SourceBundle["sourceKind"];
}): WorkflowState {
  const kind = workflowKindFor(input.workObject, input.sourceKind);
  const workflow = input.workflow.length ? input.workflow : WORKFLOWS[input.workObject as WorkObject] || WORKFLOWS.Artifact;
  const currentStage = input.currentStage || workflow[0];
  const stageOutput = input.stageOutput || "One concrete stage output exists";
  const completionCriteria = input.completionCriteria?.length ? input.completionCriteria : defaultCriteria(stageOutput, currentStage);
  const next = nextStage(workflow, currentStage, kind);
  return {
    workObject: input.workObject,
    workflow,
    workflowKind: kind,
    currentStage,
    stageOutput,
    completionCriteria,
    nextStage: next,
    advanceCondition: input.advanceCondition || (kind === "continuous" ? `Loop to ${next} when criteria are met.` : `Advance to ${next} when criteria are met.`),
    confidence: input.confidence || "medium",
    inheritedFrom: input.inheritedFrom,
  };
}

function normalizeStep(raw: unknown): BreakdownStep | null {
  if (typeof raw === "string") {
    const text = cleanText(raw);
    return text ? { text, done: false } : null;
  }
  const record = asRecord(raw);
  if (!record) return null;
  const text = cleanText(record.text || record.step || record.title || record.name);
  if (!text) return null;
  const substeps = normalizeList(Array.isArray(record.substeps) ? record.substeps : record.subSteps, [], 4);
  return substeps.length ? { text, done: false, substeps } : { text, done: false };
}
function parseBreakdown(raw: string, fallbackObject: WorkObject, inheritedWorkflow?: WorkflowState): { question?: string; steps: BreakdownStep[]; workflowState?: WorkflowState } {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed: unknown = JSON.parse(text);
    const record = asRecord(parsed);
    if (typeof record?.question === "string") return { question: cleanText(record.question, 160), steps: [] };
    const rawSteps = Array.isArray(parsed) ? parsed : Array.isArray(record?.steps) ? record.steps : [];
    const steps = rawSteps.map(normalizeStep).filter(Boolean).slice(0, 6) as BreakdownStep[];
    const workObject = normalizeWorkObject(record?.workObject, fallbackObject);
    const workflow = normalizeList(record?.workflow, inheritedWorkflow?.workflow || WORKFLOWS[workObject as WorkObject] || WORKFLOWS[fallbackObject], 8);
    const currentStage = cleanText(record?.currentStage || inheritedWorkflow?.currentStage || "", 80);
    const stageOutput = cleanText(record?.stageOutput || inheritedWorkflow?.stageOutput || "", 140);
    const completionCriteria = normalizeList(record?.completionCriteria, inheritedWorkflow?.completionCriteria || [], 5);
    const workflowKind = record?.workflowKind === "continuous" ? "continuous" : record?.workflowKind === "finite" ? "finite" : inheritedWorkflow?.workflowKind;
    const workflowState = currentStage || stageOutput ? makeWorkflowState({
      workObject,
      workflow,
      currentStage,
      stageOutput,
      completionCriteria,
      advanceCondition: cleanText(record?.advanceCondition || inheritedWorkflow?.advanceCondition || "", 160),
      confidence: cleanText(record?.confidence || inheritedWorkflow?.confidence || "medium", 20),
      inheritedFrom: inheritedWorkflow?.inheritedFrom,
      sourceKind: workflowKind === "continuous" && workObject === "Capability" ? "learn" : undefined,
    }) : undefined;
    if (workflowState && workflowKind) workflowState.workflowKind = workflowKind;
    return { steps, workflowState };
  } catch {}
  const steps = text.split(/\n+/).map((s) => normalizeStep(s)).filter(Boolean).slice(0, 6) as BreakdownStep[];
  return { steps };
}

function classifyWorkObject(task: Task, bundle: SourceBundle): WorkObject {
  const text = `${task?.title || ""} ${task?.category || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${task?.sourceNote || ""} ${bundle.sourceContext}`.toLowerCase();
  if (keyword(text, /fix|blocked|bug|confus|stuck|messy|unblock|not working|error|broken/)) return "Problem";
  if (keyword(text, /decide|choose|prioriti|pick|whether|option|trade[ -]?off|select/)) return "Decision";
  if (keyword(text, /practice|drill|improve|skill|interviewing|storylining|excel|capability|development|mock/)) return "Capability";
  if (keyword(text, /learn|read|understand|research|report|guide|resource|synthesize|synthesise|market scan|role requirements|inspect/)) return "Knowledge";
  if (keyword(text, /job search|pipeline|networking campaign|network|outreach list|follow up|follow-up|shortlist|list of people|crm|tracker/)) return "Pipeline";
  if (bundle.sourceKind === "learn") return keyword(text, /practice|drill|mock/) ? "Capability" : "Knowledge";
  if (bundle.sourceKind === "job") {
    if (keyword(text, /cv|resume|cover|answer|application material|submit|submission|draft|tailor|rewrite|portfolio|sample/)) return "Artifact";
    if (keyword(text, /requirements|research|understand role|posting|company|market|inspect/)) return "Knowledge";
    return "Artifact";
  }
  if (bundle.sourceKind === "hustle") return "Artifact";
  return "Artifact";
}

function makeSteps(defs: Array<[string, string[]?]>): BreakdownStep[] {
  return defs.map(([text, substeps]) => ({ text, done: false as const, ...(substeps?.length ? { substeps } : {}) }));
}

function dedupeTexts(texts: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts.map((x) => cleanText(x, 140)).filter(Boolean)) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function looksMetaStep(text: string) {
  return /^(use the|locate the|define this stage output|check completion criteria|break this stage into actions|execute until|identify the stage|review the workflow)/i.test(text.trim());
}

function looksActionable(text: string) {
  return /^(open|write|draft|list|choose|mark|highlight|copy|paste|find|send|ask|save|start|set|create|name|pick|read|scan|skim|note|pull|collect|gather|match|rewrite|outline|reply|message|email|book|review|map|flag|compare|decide|record|log|paste|extract|inspect)\b/i.test(text.trim());
}

function tinyStarterStep(task: Task, bundle: SourceBundle, workflowState?: WorkflowState) {
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();
  if (bundle.sourceKind === "goal") {
    if (workflowState?.currentStage === "Define target") return "Open Jobs and look at the first still-empty lane";
    if (workflowState?.currentStage === "Build list") return "Open Jobs and save the first credible role for one still-empty lane";
    if (workflowState?.currentStage === "Execute next batch") return "Open the saved role and take the next concrete pipeline action";
    return "Open Jobs and save the first credible role for one still-empty lane";
  }
  if (bundle.sourceKind === "job") {
    if (workflowState?.currentStage === "Understand role") return "Open the role posting and highlight the first must-have requirement";
    if (workflowState?.currentStage === "Map evidence") return "Open a blank note and list the top 3 role requirements";
    if (workflowState?.currentStage === "Handle gaps") return "Write down the single biggest gap in one sentence";
    if (workflowState?.currentStage === "Build materials") {
      return keyword(text, /cv|resume|tailor|rewrite/) ? "Open your CV and the role posting side by side" : "Open the application material and draft the first useful line";
    }
    if (workflowState?.currentStage === "Follow up") return "Open the application thread and find the next follow-up action";
  }
  if (bundle.sourceKind === "learn") {
    if (workflowState?.workObject === "Capability" || keyword(text, /practice|drill|mock/)) return "Open a blank practice note and do one 5-minute attempt";
    if (task.sourceUrl) return "Open the resource and read only the first heading";
    return "Open the resource note and write one useful takeaway";
  }
  if (bundle.sourceKind === "hustle") {
    if (workflowState?.currentStage === "Gather evidence") return "Open a note and paste the 3 strongest proof points";
    return "Open a blank draft and write the one claim this piece should make";
  }
  if (workflowState?.workObject === "Decision") return "Open a note and write the decision question in one line";
  if (workflowState?.workObject === "Problem") return "Write one sentence describing what is not working";
  if (workflowState?.workObject === "Knowledge") return task.sourceUrl ? "Open the source and read only the first relevant section" : "Open a note and list the first thing you need to understand";
  if (workflowState?.workObject === "Capability") return "Open a blank note and do one small practice attempt";
  return deterministicUnstickStep(task);
}

function stageActions(task: Task, bundle: SourceBundle, workflowState: WorkflowState): string[] {
  const object = workflowState.workObject;
  const currentStage = workflowState.currentStage;
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();

  if (bundle.sourceKind === "goal" || (object === "Pipeline" && keyword(text, /lane|role|pipeline|application/))) {
    if (currentStage === "Define target") return [
      "Open Jobs and look at the first still-empty lane",
      "Name the lane you are filling first",
      "Define what counts as a credible role for that lane",
      "Save the lane and move to role search",
    ];
    if (currentStage === "Build list") return [
      "Open Jobs and save the first credible role for one still-empty lane",
      "Record the company and role title",
      "Mark whether it needs apply, warm path, or clarify",
      "Repeat for the next still-empty lane only if there is still energy",
    ];
    return [
      "Open the saved role and take the next concrete pipeline action",
      "Draft the message, application, or clarification note",
      "Save or send that move",
      "Log what lane still needs a real role next",
    ];
  }

  if (bundle.sourceKind === "job" && object === "Artifact") {
    if (currentStage === "Understand role") return [
      "Open the role posting and highlight the first must-have requirement",
      "List the top 3 must-have requirements",
      "List the top 2 nice-to-have signals",
      "Write one sentence on what this role is really asking for",
    ];
    if (currentStage === "Map evidence") return [
      "Open a blank note and list the top 3 role requirements",
      "Match one concrete example to the first requirement",
      "Match one concrete example to the second requirement",
      "Mark the weakest proof gap",
    ];
    if (currentStage === "Handle gaps") return [
      "Write down the single biggest gap in one sentence",
      "Choose whether to explain, reframe, or offset it",
      "Draft one mitigation line",
      "Save that line in your role notes",
    ];
    if (currentStage === "Build materials") {
      return keyword(text, /cv|resume|tailor|rewrite/) ? [
        "Open your CV and the role posting side by side",
        "Highlight repeated role keywords",
        "Rewrite the first matching bullet",
        "Save the next bullet to update later",
      ] : [
        "Open the application material and draft the first useful line",
        "Answer the first prompt in rough notes",
        "Tighten one sentence so it sounds credible",
        "Save the next missing section",
      ];
    }
    return [
      "Open the application thread and find the next follow-up action",
      "Write the shortest acceptable follow-up",
      "Send it or save it ready to send",
      "Log the follow-up date",
    ];
  }

  if (object === "Pipeline") {
    return currentStage === "Define target" ? [
      "Write down the exact target lane",
      "List 3 live targets in that lane",
      "Mark the best one to act on first",
      "Save the first outreach or application move",
    ] : [
      "Open the live target list",
      "Pick one real target",
      "Draft the next message or application move",
      "Send it or save it ready to send",
    ];
  }

  if (object === "Knowledge") {
    return [
      task.sourceUrl ? "Open the source and read only the first relevant section" : "Open the source note and read only the first relevant section",
      "Write one useful takeaway in your own words",
      "Write the one output or decision this should support",
      "Stop once you have that one useful note",
    ];
  }

  if (object === "Capability") {
    return [
      "Open a blank practice note and do one 5-minute attempt",
      "Notice the weakest part of that attempt",
      "Redo just that part once",
      "Write one improvement note for next time",
    ];
  }

  if (object === "Decision") {
    return [
      "Open a note and write the decision question in one line",
      "List the real options",
      "Choose the top 3 criteria",
      "Mark the current default and why",
    ];
  }

  if (object === "Problem") {
    return [
      "Write one sentence describing what is not working",
      "Write when or where it shows up",
      "List 2 likely causes",
      "Choose the first cause to test",
    ];
  }

  return [
    "Open the task context",
    "Write the intended audience or use",
    "Name the smallest useful version",
    "Start the first rough line or note",
  ];
}

export function coerceTaskBreakdownSteps(task: Task, bundle: SourceBundle, workflowState: WorkflowState, rawSteps: BreakdownStep[]) {
  const flattened = rawSteps.flatMap((step) => {
    if (step.substeps?.length) return step.substeps;
    return [step.text];
  });
  const hadMeta = flattened.some((text) => looksMetaStep(text));
  const stripped = dedupeTexts((flattened.length ? flattened : stageActions(task, bundle, workflowState)).filter((text) => !looksMetaStep(text)));
  const baseActions = stripped.length ? stripped : stageActions(task, bundle, workflowState);
  const starter = tinyStarterStep(task, bundle, workflowState);
  const first = baseActions[0] || "";
  const ordered = dedupeTexts(
    hadMeta || !first || !looksActionable(first)
      ? [starter, ...baseActions]
      : baseActions,
  );
  return ordered.slice(0, 4).map((text) => ({ text, done: false as const }));
}

function attachWorkflowState(steps: BreakdownStep[], workflowState?: WorkflowState): BreakdownStep[] {
  if (!workflowState || !steps.length) return steps;
  const [first, ...rest] = steps;
  return [{ ...first, workflowState }, ...rest];
}

export function parentWorkflowFor(task: Task, bundle: SourceBundle): WorkflowState | undefined {
  const text = `${task?.title || ""} ${task?.category || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();
  if (bundle.sourceKind === "job") {
    const source = jobSource(bundle);
    const readiness = String(source?.applicationReadiness || "none");
    const status = String(source?.status || "wishlist");
    const currentStage = status === "applied" ? "Follow up"
      : status === "interviewing" ? "Build materials"
      : readiness === "submitted" ? "Submit"
      : keyword(text, /cv|cover|answer|question|material|sample|draft|tailor|submit/) || readiness !== "none" ? "Build materials"
      : keyword(text, /gap|eligibility|visa|constraint/) ? "Handle gaps"
      : keyword(text, /evidence|story|experience|proof/) ? "Map evidence"
      : "Understand role";
    const stageOutput = currentStage === "Understand role" ? "Role requirements and hidden asks are captured"
      : currentStage === "Map evidence" ? "Requirements are matched to credible evidence"
      : currentStage === "Handle gaps" ? "Gaps and constraints have mitigation lines"
      : currentStage === "Build materials" ? "The next application material is drafted or improved"
      : currentStage === "Submit" ? "Application is submitted with required materials"
      : "Follow-up action is sent or logged";
    return makeWorkflowState({ workObject: "Artifact", workflow: APPLICATION_WORKFLOW, currentStage, stageOutput, inheritedFrom: `job:${source?.id || task.sourceId || "unknown"}`, confidence: "parent", sourceKind: "job" });
  }
  if (bundle.sourceKind === "learn") {
    const source = learnSource(bundle);
    const workObject: WorkObject = keyword(text, /practice|drill|mock/) ? "Capability" : "Knowledge";
    const currentStage = workObject === "Capability" ? "Practise" : "Orient";
    const stageOutput = source?.requiredOutput || (workObject === "Capability" ? "One practice output exists" : "One useful slice and output are chosen");
    return makeWorkflowState({ workObject, workflow: WORKFLOWS[workObject], currentStage, stageOutput, inheritedFrom: `learn:${source?.id || task.sourceId || "unknown"}`, confidence: "parent", sourceKind: "learn" });
  }
  if (bundle.sourceKind === "hustle") {
    const source = hustleSource(bundle);
    const currentStage = source?.coreClaim ? "Gather evidence" : "Define claim";
    const stageOutput = currentStage === "Define claim" ? "One clear proof claim exists" : "Evidence for the proof claim is selected";
    return makeWorkflowState({ workObject: "Artifact", workflow: PROOF_WORKFLOW, currentStage, stageOutput, inheritedFrom: `hustle:${source?.id || task.sourceId || "unknown"}`, confidence: "parent", sourceKind: "hustle" });
  }
  if (bundle.sourceKind === "goal") {
    const currentStage = keyword(text, /saved role|application move|live role|pipeline action/) ? "Execute next batch"
      : keyword(text, /lane|credible role|plausible lane|pipeline/) ? "Build list"
      : "Define target";
    const stageOutput = currentStage === "Define target"
      ? "The next still-empty lane is chosen"
      : currentStage === "Build list"
        ? "One credible role exists for at least one active lane"
        : "One concrete pipeline action has been taken on a saved role";
    return makeWorkflowState({
      workObject: "Pipeline",
      workflow: WORKFLOWS.Pipeline,
      currentStage,
      stageOutput,
      inheritedFrom: `goal:${task.sourceId || "parallel-pursuit"}`,
      confidence: "parent",
      sourceKind: "goal",
    });
  }
  return undefined;
}

function fallbackStagePlan(task: Task, bundle: SourceBundle): { workflowState: WorkflowState; steps: BreakdownStep[] } {
  const inherited = bundle.parentWorkflow;
  const object = (inherited?.workObject as WorkObject) || classifyWorkObject(task, bundle);
  const workflow = inherited?.workflow || WORKFLOWS[object];
  const currentStage = inherited?.currentStage || workflow[0];
  const stageOutput = inherited?.stageOutput || task?.doneWhen || task?.minimumOutcome || "One concrete stage output exists";
  const workflowState = inherited || makeWorkflowState({ workObject: object, workflow, currentStage, stageOutput, confidence: "fallback", sourceKind: bundle.sourceKind });
  const steps = coerceTaskBreakdownSteps(task, bundle, workflowState, stageActions(task, bundle, workflowState).map((text) => ({ text, done: false as const })));
  return { workflowState, steps };
}

async function buildSourceContext(task: Task): Promise<SourceBundle> {
  let sourceContext = "";
  let playbook = "";
  let sourceKind: SourceBundle["sourceKind"] = "task";
  let source: SourceRecord = null;
  if (task.sourceType === "goal") {
    sourceKind = "goal";
    const tracks = await storage.getCareerTracks();
    const activeTrackNames = tracks.filter((track) => track.status !== "archived").map((track) => track.name).slice(0, 6);
    sourceContext = `This is a STRATEGIC GOAL / broad-pursuit item. Title: ${task.title}. Done when: ${task.doneWhen || task.minimumOutcome || "one real lane-opening move exists"}. ${task.sourceNote ? "Goal note: " + task.sourceNote + ". " : ""}${activeTrackNames.length ? "Active tracks: " + activeTrackNames.join("; ") + ". " : ""}`;
    playbook = "Use the parent pipeline workflow first. The goal is not abstract comparison; it is to turn each plausible lane into one real role or application move. Prefer lane-filling and concrete pipeline actions over reflection.";
  } else if (task.sourceType === "job" && task.sourceId) {
    const j = (await storage.getJobs()).find((x) => x.id === task.sourceId);
    if (j) {
      source = j;
      sourceKind = "job";
      sourceContext = `This is a JOB / OPPORTUNITY item. Role: ${j.title} at ${j.company}. Status: ${j.status}. Readiness: ${j.applicationReadiness}. Fit score: ${j.fitScore ?? "unknown"}. Archetype: ${j.roleArchetype || "unknown"}. Narrative angle: ${j.narrativeAngle || "unset"}. ${j.note ? "Posting notes: " + j.note : ""} ${j.url ? "URL: " + j.url : ""}`;
      playbook = "Use the parent application workflow first. CV/cover/answers/submission are Artifact; role research is Knowledge; multi-role search or networking is Pipeline. Never auto-change job status.";
    }
  } else if (task.sourceType === "learn" && task.sourceId) {
    const l = (await storage.getLearn()).find((x) => x.id === task.sourceId);
    if (l) {
      source = l;
      sourceKind = "learn";
      sourceContext = `This is a LEARNING / DEVELOPMENT item. Title: ${l.title}. Type: ${l.type}. ${l.url ? "URL: " + l.url + ". " : ""}${l.note ? "Notes: " + l.note + ". " : ""}${l.capabilityBuilt ? "Capability: " + l.capabilityBuilt + ". " : ""}Required output: ${l.requiredOutput || "a concrete reusable output"}.`;
      playbook = "Use the parent learning/capability workflow first. Do not just read; locate the stage and produce a reusable output. Never auto-change learnStatus.";
    }
  } else if (task.sourceType === "hustle" && task.sourceId) {
    const h = (await storage.getHustles()).find((x) => x.id === task.sourceId);
    if (h) {
      source = h;
      sourceKind = "hustle";
      sourceContext = `This is a PROOF-ASSET / project step. Title: ${h.title}. Stage: ${h.stage}. Content pillar: ${h.contentPillar || "unset"}. Core claim: ${h.coreClaim || "unset"}. ${h.note ? "Notes: " + h.note : ""}`;
      playbook = "Use the parent proof workflow first: claim → audience → evidence → draft → reuse. Never auto-change proof asset stage.";
    }
  } else if (task.sourceUrl || task.sourceNote) {
    sourceContext = `${task.sourceNote ? "Context: " + task.sourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
  }
  const tempBundle: SourceBundle = { sourceContext, playbook, sourceKind, source, parentContext: "" };
  const parentWorkflow = parentWorkflowFor(task, tempBundle);
  const parentContext = parentWorkflow ? `Inherited workflow from parent ${parentWorkflow.inheritedFrom}: ${parentWorkflow.workflow.join(" → ")}. Kind: ${parentWorkflow.workflowKind}. Current stage: ${parentWorkflow.currentStage}. Stage output: ${parentWorkflow.stageOutput}. Completion criteria: ${parentWorkflow.completionCriteria.join("; ")}.` : "";
  return { sourceContext, playbook, sourceKind, source, parentContext, parentWorkflow };
}

export async function buildDeterministicTaskBreakdown(task: Task) {
  const bundle = await buildSourceContext(task);
  const fallback = fallbackStagePlan(task, bundle);
  return { bundle, workflowState: fallback.workflowState, steps: fallback.steps };
}

export function registerTaskBreakdownRoutes(app: Express) {
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const context = String(req.body?.context || "").slice(0, 500);
    const bundle = await buildSourceContext(task);
    const fallbackObject = (bundle.parentWorkflow?.workObject as WorkObject) || classifyWorkObject(task, bundle);

    let question = "";
    let steps: BreakdownStep[] = [];
    let workflowState: WorkflowState | undefined;
    try {
      const client = new OpenAI();
      const r = await client.responses.create({
        model: "gpt_5_1",
        input:
          `You are Anchor's workflow-state decomposition engine. Do not jump from task title to steps.\n\n` +
          `Use exactly this logic:\n` +
          `1. Read inherited parent workflow first, if present.\n` +
          `2. Classify the specific task intent as Artifact, Decision, Knowledge, Capability, Pipeline, or Problem.\n` +
          `3. Decide whether the workflow is finite or continuous.\n` +
          `4. Locate ONE current stage and define its output.\n` +
          `5. Define completion criteria for that stage.\n` +
          `6. Break down only the current stage into discrete actions.\n` +
          `7. Define the advance condition and next stage.\n\n` +
          `Prefer inherited workflow context over rediscovering from scratch, but let task intent refine the stage. Do not imply the parent has progressed; only provide the next workflow hint. ` +
          `Ask ONE short question only if classification or current stage would likely be wrong without it. Otherwise make sensible assumptions. ` +
          `Return ONLY JSON: {"workObject":"...","workflow":["..."],"workflowKind":"finite|continuous","currentStage":"...","stageOutput":"...","completionCriteria":["..."],"confidence":"high|medium|low","steps":[{"text":"...","substeps":["..."]}],"advanceCondition":"..."} or {"question":"..."}.\n\n` +
          `${bundle.playbook ? `Relevant playbook: ${bundle.playbook}\n` : ""}` +
          `${bundle.parentContext ? `Parent workflow context: ${bundle.parentContext}\n` : ""}` +
          `Default work object if uncertain: ${fallbackObject}\n` +
          `Task: ${task.title}\nCategory: ${task.category}\nDone when: ${task.doneWhen || task.minimumOutcome || "smallest useful outcome is complete"}\n` +
          `Source context: ${bundle.sourceContext || "none beyond the title"}\n` +
          `${context ? `User context: ${context}\n` : ""}`,
      });
      const parsed = parseBreakdown(r.output_text || "", fallbackObject, bundle.parentWorkflow);
      question = parsed.question || "";
      steps = parsed.steps;
      workflowState = parsed.workflowState;
    } catch {
      steps = [];
    }

    if (question && !context) return res.json({ question });
    if (!steps.length || !workflowState) {
      const fallback = await buildDeterministicTaskBreakdown(task);
      steps = fallback.steps;
      workflowState = fallback.workflowState;
    } else {
      steps = coerceTaskBreakdownSteps(task, bundle, workflowState, steps);
    }
    steps = attachWorkflowState(steps, workflowState);
    const updated = await storage.updateTask(id, {
      steps: JSON.stringify(steps),
      minimumOutcome: workflowState.stageOutput || task.minimumOutcome,
    });
    res.json(updated);
  });
}
