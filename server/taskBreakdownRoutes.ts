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
  cvText?: string;
  jdText?: string;
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

const APPLICATION_WORKFLOW = ["Understand role", "Match examples", "Handle gaps", "Build materials", "Submit", "Follow up"];
const PROOF_WORKFLOW = ["Define claim", "Choose audience", "Collect examples", "Draft fragment", "Save useful version"];

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
  const output = stageOutput || "The stage result exists";
  if (/match examples|map evidence/i.test(currentStage)) return ["Critical requirements are listed", "At least one concrete example is matched to each critical requirement"];
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
  const stageOutput = input.stageOutput || "One concrete next-step result exists";
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

function laneSpecificSearchMove(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("ai / technology strategy x strategy / advisory")) {
    return "Open Jobs and save one AI strategy or advisory role with clear strategic scope";
  }
  if (lower.includes("ai / technology strategy x ops / chief of staff")) {
    return "Open Jobs and save one AI chief-of-staff or operating role with execution ownership";
  }
  if (lower.includes("geopolitics / geopolitical advisory x strategy / advisory")) {
    return "Open Jobs and save one geopolitical advisory or strategy role with substantive regional or policy scope";
  }
  if (lower.includes("geopolitics / geopolitical advisory x ops / chief of staff")) {
    return "Open Jobs and save one geopolitical or policy-adjacent chief-of-staff or operations role";
  }
  return null;
}

function goalNeedsNetworkSupport(text: string) {
  return /\b(contact|outreach|reach out|network|message|referral|advice ask|reconnect)\b/i.test(text);
}

function goalNeedsPrepSupport(text: string) {
  return /\b(prep item|prep support|learning support|learn|learning|study|read|resource)\b/i.test(text);
}

function looksMetaStep(text: string) {
  return /^(use the|locate the|define this stage output|check completion criteria|break this stage into actions|execute until|identify the stage|review the workflow)/i.test(text.trim());
}

function looksActionable(text: string) {
  return /^(open|write|draft|list|choose|mark|highlight|copy|paste|find|send|ask|save|start|set|create|name|pick|read|scan|skim|note|pull|collect|gather|match|rewrite|outline|reply|message|email|book|review|map|flag|compare|decide|record|log|paste|extract|inspect)\b/i.test(text.trim());
}

function sharpenLegacyTaskTitle(task: Task) {
  const title = String(task.title || "").trim();
  if (task.sourceType === "goal" && /^review\b/i.test(title) && /\brole/.test(title.toLowerCase())) {
    return title.replace(/^review\b/i, "Inspect");
  }
  return title;
}

function tinyStarterStep(task: Task, bundle: SourceBundle, workflowState?: WorkflowState) {
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();
  if (bundle.sourceKind === "goal") {
    if (goalNeedsNetworkSupport(text)) return "Open Network and add one person you could realistically reach out to for this path";
    if (goalNeedsPrepSupport(text)) return "Open Learn and add one prep item, note, or resource for this path";
    if (workflowState?.currentStage === "Define target") return "Open Jobs and look at the first path that still has no saved role";
    if (workflowState?.currentStage === "Build list") return laneSpecificSearchMove(text) || "Open Jobs and save the first real role for one path that is still missing one";
    if (workflowState?.currentStage === "Execute next batch") return "Open the saved role and take the next concrete pipeline action";
    return laneSpecificSearchMove(text) || "Open Jobs and save the first real role for one path that is still missing one";
  }
  if (bundle.sourceKind === "job") {
    if (workflowState?.currentStage === "Understand role") return "Open the role posting and highlight the first must-have requirement";
    if (workflowState?.currentStage === "Match examples" || workflowState?.currentStage === "Map evidence") return "Open a blank note and list the top 3 role requirements";
    if (workflowState?.currentStage === "Handle gaps") return "Write down the single biggest gap in one sentence";
    if (workflowState?.currentStage === "Build materials") {
      const j = jobSource(bundle);
      const readiness = j?.applicationReadiness || "none";
      if (readiness === "cv") return `Open the ${j?.title || "role"} cover note and write the opening line`;
      if (readiness === "cover") return `Open the application questions and paste the first one into a blank doc`;
      if (readiness === "questions") return `Check the ${j?.title || "role"} application for any remaining required materials`;
      if (readiness === "sample") return `Open the ${j?.title || "role"} submission checklist and confirm everything is complete`;
      return keyword(text, /cv|resume|tailor|rewrite/) ? "Open your CV and the role posting side by side" : "Open the application material and draft the first useful line";
    }
    if (workflowState?.currentStage === "Follow up") return "Open the application thread and find the next follow-up action";
  }
  if (bundle.sourceKind === "learn") {
    if (workflowState?.workObject === "Capability" || keyword(text, /practice|drill|mock/)) return "Open a blank practice note and do one 5-minute attempt";
    if (task.sourceUrl) return "Open the prep item and read only the first heading";
    return "Open the learning note and write one useful note, brief, or practice result";
  }
  if (bundle.sourceKind === "hustle") {
    if (workflowState?.currentStage === "Collect examples" || workflowState?.currentStage === "Gather evidence") return "Open a note and paste the 3 strongest examples or proof points";
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

  // ── Job application ────────────────────────────────────────────────────────
  if (bundle.sourceKind === "job") {
    const j = jobSource(bundle);
    const roleLabel = j ? `${j.title}${j.company ? " @ " + j.company : ""}` : "the role";
    const nextStepNote = j?.nextStep?.trim();
    const hasNarrative = !!(j?.narrativeAngle?.trim());

    if (currentStage === "Understand role") return [
      `Read the ${roleLabel} posting and note what they are actually looking for`,
      `List the top 3 must-have requirements and honestly rate your fit on each`,
      `Note the biggest gap or risk and how you would handle it`,
      `Write one sentence on your angle for this specific role${hasNarrative ? ` (your narrative: ${j!.narrativeAngle})` : ""}`,
    ];
    if (currentStage === "Match examples" || currentStage === "Map evidence") return [
      `List the top 3 requirements for ${roleLabel}`,
      `Write one concrete example from your background for each requirement`,
      `Mark the weakest match and decide: explain, reframe, or offset`,
      `Note any missing example, practice, or fact you still need to pull together`,
    ];
    if (currentStage === "Handle gaps") return [
      `Write the main eligibility or fit concern for ${roleLabel} in one sentence`,
      `Draft one mitigation line: reframe, offset, or explain the gap`,
      `Decide whether this concern blocks the application or you proceed`,
    ];
    if (currentStage === "Build materials") {
      const readiness = j?.applicationReadiness || "none";
      // nextStep note on the job card overrides everything when set.
      if (nextStepNote) return [
        nextStepNote,
        `Review that against the ${roleLabel} requirements`,
        `Note what still needs work`,
      ];
      // Branch on what's already done — never repeat completed material.
      if (readiness === "cv") return [
        `Write the cover note for ${roleLabel} — lead with your specific angle, not a generic summary`,
        `Mirror 2-3 key phrases from the job posting in the cover note`,
        `Keep to the required format or one tight page if unspecified`,
        `Check: does it say something only you could say for this role?`,
      ];
      if (readiness === "cover") return [
        `Open the ${roleLabel} application and paste the first question`,
        `Draft your answer — lead with the concrete example, not the context`,
        `Match the word limit exactly, then cut 10%`,
        `Note which remaining questions still need answers`,
      ];
      if (readiness === "questions") return [
        `Check whether ${roleLabel} asks for a writing sample, public post, or portfolio piece`,
        `If yes: identify the strongest existing piece and confirm it fits their format`,
        `If no: review all materials for completeness before submitting`,
        `Confirm everything required is ready`,
      ];
      if (readiness === "sample") return [
        `Review all materials for ${roleLabel} one final time`,
        `Check submission requirements — format, attachments, word limits`,
        `Consider whether a referral would strengthen this application`,
        `Note the submission steps so you can move quickly`,
      ];
      // CV not yet started — use keyword or default.
      return keyword(text, /cv|resume|tailor|rewrite/) ? [
        `Open your CV and the ${roleLabel} posting side by side`,
        `Rewrite the two bullets most relevant to this role`,
        `Check the headline and summary line against the role requirements`,
        `Note what is still missing`,
      ] : [
        `Open the application for ${roleLabel} and draft your answer to the first prompt`,
        `Write the key example or point you will use in the cover note or answer`,
        `Check the required format and any word limits`,
        `Note what still needs work`,
      ];
    }
    if (currentStage === "Submit") return [
      `Open the application form for ${roleLabel} and check all materials are complete`,
      `Submit and note the confirmation or reference number`,
      `Log the submission date and set a follow-up reminder`,
    ];
    // Follow up
    return [
      `Find the last contact point or submission thread for ${roleLabel}`,
      `Draft a short follow-up and decide whether to send now or wait`,
      `Send it or save it ready to send`,
      `Log the next action on this role`,
    ];
  }

  // ── Learning / capability ──────────────────────────────────────────────────
  if (bundle.sourceKind === "learn") {
    const l = learnSource(bundle);
    const prepLabel = l?.title || "this prep item";
    const requiredOutput = l?.requiredOutput?.trim();
    const capabilityBuilt = l?.capabilityBuilt?.trim();

    if (object === "Capability") return [
      `Start a practice attempt: open a blank doc and work through one example of ${capabilityBuilt || prepLabel}`,
      `Note the weakest part of that attempt`,
      `Write an improved version of just the weakest part`,
      requiredOutput ? `Draft the useful output you planned: ${requiredOutput}` : `Write one useful note or practice result from this session`,
    ];
    return [
      l?.url ? `Open ${prepLabel} and read the most relevant section` : `Read your notes on ${prepLabel} and find the most relevant part`,
      `Write the key insight in your own words`,
      requiredOutput ? `Draft: ${requiredOutput}` : `Draft a short summary, note, or interview prep note`,
      `Note what you still need or what to do with this next`,
    ];
  }

  // ── Proof asset / hustle ───────────────────────────────────────────────────
  if (bundle.sourceKind === "hustle") {
    const h = hustleSource(bundle);
    const assetLabel = h?.title || "this project or public-work item";
    const coreClaim = h?.coreClaim?.trim();
    const nextStepNote = h?.nextStep?.trim();

    if (nextStepNote) return [
      nextStepNote,
      `Open the draft for ${assetLabel} and see what it still needs`,
      `Note what is missing or needs strengthening`,
      `Record the next concrete step for the following session`,
    ];
    if (currentStage === "Define claim") return [
      `Write the one claim ${assetLabel} should prove, in one sentence`,
      `Name the specific audience this is for`,
      `List 3 concrete examples or proof points that support the claim`,
    ];
    if (currentStage === "Collect examples" || currentStage === "Gather evidence") return [
      `List the 3 strongest examples or proof points for: ${coreClaim || assetLabel}`,
      `Note where each one comes from`,
      `Flag anything you still need to support the claim`,
    ];
    return [
      `Open the draft for ${assetLabel}`,
      `Write the next section or complete the current one`,
      `Note what is still missing`,
      `Record the next concrete step for the following session`,
    ];
  }

  // ── Goal / pipeline ────────────────────────────────────────────────────────
  if (bundle.sourceKind === "goal") {
    const laneSpecific = laneSpecificSearchMove(text);
    if (goalNeedsNetworkSupport(text)) return [
      `Open Network and add one useful contact or outreach path for this live role path`,
      `Write the exact ask: advice, referral, reconnect, or warm intro`,
      `Draft the message or save who you should contact next`,
      `Note which live path still lacks outreach support after this`,
    ];
    if (goalNeedsPrepSupport(text)) return [
      `Open Learn and add one prep item, note, or resource for this live role path`,
      `Pick the one note, brief, or example that would help this path most`,
      `Write a short note on how you would use that prep later`,
      `Note which live path still lacks prep support after this`,
    ];
    if (currentStage === "Define target") return [
      `Open Jobs and find which path still has no saved role`,
      `Name that path and write what a credible role looks like for it`,
      `Save one role to fill that gap`,
    ];
    if (currentStage === "Build list") return [
      laneSpecific || `Find one real role for the most important path that is still missing one`,
      `Save it and mark the next action: apply, reach out first, or clarify`,
      `Note if any other paths still need a first role`,
    ];
    return [
      `Open the most promising saved role and take the next concrete action`,
      `Draft the application move, outreach message, or clarification note`,
      `Send it or save it ready to send`,
      `Log which path still needs movement next`,
    ];
  }

  // ── Generic work object fallbacks ─────────────────────────────────────────
  if (object === "Decision") return [
    `Write the decision question clearly in one sentence`,
    `List the real options on the table`,
    `Map the top 2-3 criteria that matter most`,
    `Decide on a provisional choice and note what would change it`,
  ];
  if (object === "Problem") return [
    `Write one sentence describing what is not working`,
    `List the 2-3 most likely causes`,
    `Choose the most likely cause and decide how to test it`,
    `Write the fix or the next diagnostic action`,
  ];
  if (object === "Knowledge") return [
    task.sourceUrl ? `Open the source and read the most relevant section` : `Read your notes or open the source`,
    `Write the key insight in your own words`,
    `Draft one concrete output or decision this learning helps with`,
    `Note what you still need or what to do with this next`,
  ];
  if (object === "Capability") return [
    `Start a practice attempt and work through one example`,
    `Note the weakest part`,
    `Write an improved version of just that part`,
    `Write one concrete improvement note for next time`,
  ];

  const taskTitle = task?.title || "this task";
  const doneCondition = task?.doneWhen || task?.minimumOutcome || "smallest useful version exists";
  return [
    `Open what you have so far on: ${taskTitle}`,
    `Draft the main content`,
    `Compare it against the done condition: ${doneCondition}`,
    `Note what is still needed`,
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
  return ordered.slice(0, 5).map((text) => ({ text, done: false as const }));
}

export async function normalizeExistingTaskBreakdown(task: Task) {
  const raw = String(task.steps || "[]");
  let parsed: BreakdownStep[] = [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      parsed = arr.map((step) => normalizeStep(step)).filter(Boolean) as BreakdownStep[];
    }
  } catch {
    parsed = [];
  }

  if (!parsed.length) return { changed: false as const };

  const flattened = parsed.flatMap((step) => step.substeps?.length ? step.substeps : [step.text]);
  const needsRepair = flattened.some((text) => looksMetaStep(text));
  if (!needsRepair) return { changed: false as const };

  const bundle = await buildSourceContext(task);
  const fallback = fallbackStagePlan(task, bundle);
  const repaired = attachWorkflowState(
    coerceTaskBreakdownSteps(task, bundle, fallback.workflowState, parsed),
    fallback.workflowState,
  );
  const steps = JSON.stringify(repaired);
  if (steps === raw && (fallback.workflowState.stageOutput || "") === String(task.minimumOutcome || "")) {
    return { changed: false as const };
  }
  return {
    changed: true as const,
    steps,
    minimumOutcome: fallback.workflowState.stageOutput || task.minimumOutcome,
    title: sharpenLegacyTaskTitle(task),
  };
}

export function attachWorkflowState(steps: BreakdownStep[], workflowState?: WorkflowState): BreakdownStep[] {
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
    // Map applicationReadiness → APPLICATION_WORKFLOW stage.
    // submitted/follow_up = already past the gate → Follow up.
    // referral = all materials ready, just needs submitting → Submit.
    // cv/cover/questions/sample = materials in progress → Build materials.
    // none + text hints → earlier stages.
    const currentStage =
      status === "applied" || readiness === "submitted" || readiness === "follow_up" ? "Follow up"
      : status === "interviewing" ? "Build materials"
      : readiness === "referral" ? "Submit"
      : readiness === "cv" || readiness === "cover" || readiness === "questions" || readiness === "sample"
        ? "Build materials"
      : keyword(text, /cv|cover|answer|question|material|sample|draft|tailor|submit/) ? "Build materials"
      : keyword(text, /gap|eligibility|visa|constraint/) ? "Handle gaps"
      : keyword(text, /evidence|story|experience|proof/) ? "Match examples"
      : "Understand role";
    // Stage output is specific to what materials still need doing.
    const stageOutput = currentStage === "Understand role" ? "Role requirements and hidden asks are captured"
      : currentStage === "Match examples" ? "Requirements are matched to concrete examples"
      : currentStage === "Handle gaps" ? "Gaps and constraints have mitigation lines"
      : currentStage === "Build materials"
        ? (readiness === "cv" ? "Cover letter is drafted and matches the role's language"
          : readiness === "cover" ? "Application questions are answered with concrete examples"
          : readiness === "questions" ? "Writing sample or remaining materials are ready"
          : "The next application material is drafted or improved")
      : currentStage === "Submit" ? "Application is submitted with required materials"
      : "Follow-up action is sent or logged";
    return makeWorkflowState({ workObject: "Artifact", workflow: APPLICATION_WORKFLOW, currentStage, stageOutput, inheritedFrom: `job:${source?.id || task.sourceId || "unknown"}`, confidence: "parent", sourceKind: "job" });
  }
  if (bundle.sourceKind === "learn") {
    const source = learnSource(bundle);
    const workObject: WorkObject = keyword(text, /practice|drill|mock/) ? "Capability" : "Knowledge";
    const currentStage = workObject === "Capability" ? "Practise" : "Orient";
    const stageOutput = source?.requiredOutput || (workObject === "Capability" ? "One short practice attempt exists" : "One useful slice is chosen and one note is captured");
    return makeWorkflowState({ workObject, workflow: WORKFLOWS[workObject], currentStage, stageOutput, inheritedFrom: `learn:${source?.id || task.sourceId || "unknown"}`, confidence: "parent", sourceKind: "learn" });
  }
  if (bundle.sourceKind === "hustle") {
    const source = hustleSource(bundle);
    const currentStage = source?.coreClaim ? "Collect examples" : "Define claim";
    const stageOutput = currentStage === "Define claim" ? "One clear claim exists" : "The strongest examples for the claim are selected";
    return makeWorkflowState({ workObject: "Artifact", workflow: PROOF_WORKFLOW, currentStage, stageOutput, inheritedFrom: `hustle:${source?.id || task.sourceId || "unknown"}`, confidence: "parent", sourceKind: "hustle" });
  }
  if (bundle.sourceKind === "goal") {
    const currentStage = keyword(text, /still-empty combination|still-empty lane|credible role|plausible lane|plausible role type|fill the lane|missing path|missing role type|real role/) ? "Build list"
      : keyword(text, /saved role|application move|live role|pipeline action/) ? "Execute next batch"
      : keyword(text, /lane|pipeline/) ? "Build list"
      : "Define target";
    const stageOutput = currentStage === "Define target"
      ? "The next missing path is chosen"
      : currentStage === "Build list"
        ? "One real role exists for at least one missing path"
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
  const stageOutput = inherited?.stageOutput || task?.doneWhen || task?.minimumOutcome || "One concrete next-step result exists";
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
    sourceContext = `This is a STRATEGIC GOAL / broad-pursuit item. Title: ${task.title}. Done when: ${task.doneWhen || task.minimumOutcome || "one real role-opening move exists"}. ${task.sourceNote ? "Goal note: " + task.sourceNote + ". " : ""}${activeTrackNames.length ? "Active tracks: " + activeTrackNames.join("; ") + ". " : ""}`;
    playbook = "Use the parent pipeline workflow first. The goal is not abstract comparison; it is to turn each plausible path into one real role or application move. Prefer filling missing paths with concrete pipeline actions over reflection.";
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
      sourceContext = `This is a LEARNING / DEVELOPMENT item. Title: ${l.title}. Type: ${l.type}. ${l.url ? "URL: " + l.url + ". " : ""}${l.note ? "Notes: " + l.note + ". " : ""}${l.capabilityBuilt ? "Capability: " + l.capabilityBuilt + ". " : ""}Optional useful result: ${l.requiredOutput || "none defined yet"}.`;
      playbook = "Use the parent learning/capability workflow first. Do not just read; locate the stage and produce a useful note, practice step, or useful output if one is defined. Never auto-change learnStatus.";
    }
  } else if (task.sourceType === "hustle" && task.sourceId) {
    const h = (await storage.getHustles()).find((x) => x.id === task.sourceId);
    if (h) {
      source = h;
      sourceKind = "hustle";
      sourceContext = `This is a PROOF-ASSET / project step. Title: ${h.title}. Stage: ${h.stage}. Content pillar: ${h.contentPillar || "unset"}. Core claim: ${h.coreClaim || "unset"}. ${h.note ? "Notes: " + h.note : ""}`;
      playbook = "Use the parent output workflow first: claim -> audience -> examples -> draft -> save. Never auto-change the stage automatically.";
    }
  } else if (task.sourceUrl || task.sourceNote) {
    sourceContext = `${task.sourceNote ? "Context: " + task.sourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
  }
  const tempBundle: SourceBundle = { sourceContext, playbook, sourceKind, source, parentContext: "" };
  const parentWorkflow = parentWorkflowFor(task, tempBundle);
  const parentContext = parentWorkflow ? `Inherited workflow from parent ${parentWorkflow.inheritedFrom}: ${parentWorkflow.workflow.join(" → ")}. Kind: ${parentWorkflow.workflowKind}. Current stage: ${parentWorkflow.currentStage}. Stage output: ${parentWorkflow.stageOutput}. Completion criteria: ${parentWorkflow.completionCriteria.join("; ")}.` : "";

  let cvText = "";
  let jdText = "";
  try {
    const profile = await storage.getProfile();
    cvText = profile?.cvText?.trim() || "";
  } catch { /* non-fatal */ }
  if (sourceKind === "job" && source) {
    jdText = ((source as any).jdText as string | undefined)?.trim() || "";
  }

  return { sourceContext, playbook, sourceKind, source, parentContext, parentWorkflow, cvText, jdText };
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
          `${context ? `User context: ${context}\n` : ""}` +
          `${bundle.cvText && bundle.jdText ? (
            `\nCANDIDATE CV (use this to identify specific bullets):\n${bundle.cvText.slice(0, 3000)}\n\n` +
            `JOB DESCRIPTION:\n${bundle.jdText.slice(0, 3000)}\n\n` +
            `IMPORTANT: For Build materials steps, quote the 2-3 most relevant existing CV bullets exactly, ` +
            `then write a specific improved version using the job's language. ` +
            `Step format: "Rewrite: \\"[exact existing bullet]\\" → \\"[improved version]\\"". ` +
            `Steps must reference real content from the CV and JD above, not generic advice.\n`
          ) : ""}`,
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
