import type { Express } from "express";
import { llm, llmJSON, LLM_MODELS } from "./llm";
import type { Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { storage } from "./storage";
import { deterministicUnstickStep } from "./planningFeedback";
import { COACH_PREAMBLE } from "./userPromptProfile";
import { buildUserContext, formatContextForPrompt, type UserContext } from "./userContext";
import { isJobLive, isContactWarm, getTrackId } from "@shared/domainState";
import { computeLearningGaps } from "./learningStrategy";
import {
  collectTaskBreakdownContext,
  formatContextBlocksForPrompt,
  type ContextBlock,
} from "./contextProviders";

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
type SourceRecord = Job | Learn | Hustle | Contact | null;
type SourceBundle = {
  sourceContext: string;
  playbook: string;
  sourceKind: "job" | "learn" | "hustle" | "contact" | "goal" | "task";
  source: SourceRecord;
  parentContext: string;
  parentWorkflow?: WorkflowState;
  cvText?: string;
  jdText?: string;
  crossEngineContext?: string;
  contactName?: string;
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

function contactSource(bundle: SourceBundle): Contact | null {
  return bundle.sourceKind === "contact" ? bundle.source as Contact | null : null;
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
const CONTACT_WORKFLOW = ["Choose ask", "Draft outreach", "Send", "Prepare conversation", "Track follow-up", "Deepen relationship"];
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
  if (bundle.sourceKind === "contact") return "Pipeline";
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

function jobSignalThemes(job: Job | null | undefined) {
  const noteBits = String(job?.note || "")
    .split(/[.;\n]+/)
    .map((part) => cleanText(part, 120))
    .filter((part) => !!part && part.length >= 12);
  const jdBits = String(job?.jdText || "")
    .split(/[.;\n]+/)
    .map((part) => cleanText(part.replace(/^(the role|candidates should|the job|this role)\s+/i, ""), 120))
    .filter((part) => !!part && part.length >= 18)
    .filter((part) => /\b(require|translat|stakeholder|analysis|policy|regulation|implementation|technology|safety)\b/i.test(part));
  return cleanList([
    job?.narrativeAngle,
    ...noteBits,
    ...jdBits,
  ], 3);
}

function personalizeDeterministicSteps(task: Task, bundle: SourceBundle, workflowState: WorkflowState, steps: BreakdownStep[]) {
  if (bundle.sourceKind !== "job" || workflowState.currentStage !== "Build materials") return steps;
  const job = jobSource(bundle);
  if (!job || (job.applicationReadiness || "none") !== "cv") return steps;

  const roleLabel = `${job.title}${job.company ? ` @ ${job.company}` : ""}` || "the role";
  const signalThemes = jobSignalThemes(job);
  if (!signalThemes.length) return steps;

  const leadTheme = signalThemes[0];
  const proofThemes = signalThemes.slice(1, 3);
  return [
    {
      text: leadTheme
        ? `Open a blank cover note for ${roleLabel} and sketch 3 beats: opening angle, strongest example, closing fit. Lead beat 1 with: ${leadTheme}`
        : `Open a blank cover note for ${roleLabel} and sketch 3 beats: opening angle, strongest example, closing fit`,
      done: false as const,
    },
    {
      text: leadTheme
        ? `Write the opening paragraph for ${roleLabel} and lead with this angle: ${leadTheme}`
        : `Write the opening paragraph for ${roleLabel} and lead with your specific angle, not a generic summary`,
      done: false as const,
    },
    {
      text: proofThemes.length
        ? `Choose 1-2 concrete examples that prove these role signals where they are genuinely true: ${proofThemes.join("; ")}`
        : `Mirror 2-3 key phrases from the job posting in the cover note`,
      done: false as const,
    },
    {
      text: `Keep to the required format or one tight page if unspecified`,
      done: false as const,
    },
    {
      text: `Check: does it say something only you could say for this role?`,
      done: false as const,
    },
  ];
}

function goalNeedsNetworkSupport(text: string) {
  return /\b(contact|outreach|reach out|network|message|referral|advice ask|reconnect)\b/i.test(text);
}

function goalNeedsLearningSupport(text: string) {
  return /\b(learning focus|learning support|support item|learn|learning|study|read|resource)\b/i.test(text);
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
    if (goalNeedsLearningSupport(text)) return "Use Jobs or Learn to start learning about this path";
    if (workflowState?.currentStage === "Define target") return "Open Jobs and look at the first path that still has no saved role";
    if (workflowState?.currentStage === "Build list") return laneSpecificSearchMove(text) || "Open Jobs and save the first real role for one path that is still missing one";
    if (workflowState?.currentStage === "Execute next batch") return "Open the saved role and take the next concrete pipeline action";
    return laneSpecificSearchMove(text) || "Open Jobs and save the first real role for one path that is still missing one";
  }
  if (bundle.sourceKind === "job") {
    const j = jobSource(bundle);
    const roleLabel = j ? `${j.title}${j.company ? " @ " + j.company : ""}` : "the role";
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
    if (workflowState?.currentStage === "Follow up") {
      if (bundle.contactName) return `Check with ${bundle.contactName} for any update on your ${roleLabel} application`;
      return "Open the application thread and find the next follow-up action";
    }
  }
  if (bundle.sourceKind === "learn") {
    const source = learnSource(bundle);
    const { sourceStep } = buildKnowledgeExtractionSteps(task, bundle, source);
    if (workflowState?.workObject === "Capability" || keyword(text, /practice|drill|mock/)) return "Open a blank practice note and do one 5-minute attempt";
    return sourceStep;
  }
  if (bundle.sourceKind === "contact") {
    const contact = contactSource(bundle);
    const person = contactDisplayName(contact);
    if (workflowState?.currentStage === "Prepare conversation") {
      return `Open a prep note for ${person} and write the 3 questions you most need answered`;
    }
    if (workflowState?.currentStage === "Track follow-up" || workflowState?.currentStage === "Deepen relationship") {
      return `Open your last exchange with ${person} and draft the next message`;
    }
    return `Open a draft to ${person} and write the first useful line`;
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
    const deadlineLabel = j?.deadline ? formatDeadlineLabel(j.deadline) : "";
    const nextStepNote = j?.nextStep?.trim();
    const hasNarrative = !!(j?.narrativeAngle?.trim());
    const signalThemes = jobSignalThemes(j);

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
        `Note any remaining gaps`,
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
        `Note any remaining gaps`,
      ];
    }
    if (currentStage === "Submit") return [
      `Open the application form for ${roleLabel} and check all materials are complete`,
      `Submit and note the confirmation or reference number`,
      bundle.contactName ? `Ask ${bundle.contactName} to flag your application or put in a referral` : `Consider whether someone in your network could flag this application internally`,
      `Log the submission date and set a follow-up reminder`,
    ];
    // Follow up
    return [
      bundle.contactName ? `Check with ${bundle.contactName} for any update on your ${roleLabel} application` : `Find the last contact point or submission thread for ${roleLabel}`,
      deadlineLabel ? `Make sure the follow-up goes out while ${roleLabel} is still live before ${deadlineLabel}` : `Check whether the role is still live before you follow up`,
      `Draft a short follow-up and decide whether to send now or wait`,
      `Send it or save it ready to send`,
      `Log the next action on this role so the follow-up is fully tracked`,
    ];
  }

  // ── Learning / capability ──────────────────────────────────────────────────
  if (bundle.sourceKind === "learn") {
    const l = learnSource(bundle);
    const prepLabel = l?.title || "this learning item";
    const requiredOutput = l?.requiredOutput?.trim();
    const capabilityBuilt = l?.capabilityBuilt?.trim();
    const knowledgeSteps = buildKnowledgeExtractionSteps(task, bundle, l);

    if (object === "Capability") return [
      `Start a practice attempt: open a blank doc and work through one example of ${capabilityBuilt || prepLabel}`,
      `Note the weakest part of that attempt`,
      `Write an improved version of just the weakest part`,
      requiredOutput ? `Draft the useful output you planned: ${requiredOutput}` : `Write one useful note or practice result from this session`,
    ];
    return [knowledgeSteps.sourceStep, knowledgeSteps.extractStep, knowledgeSteps.draftStep, knowledgeSteps.stopStep];
  }

  // ── Proof asset / hustle ───────────────────────────────────────────────────
  if (bundle.sourceKind === "hustle") {
    const h = hustleSource(bundle);
    const assetLabel = h?.title || "this project or public-work item";
    const coreClaim = h?.coreClaim?.trim();
    const nextStepNote = h?.nextStep?.trim();

    if (nextStepNote) return [
      nextStepNote,
      `Open the draft for ${assetLabel} and review the current state`,
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
  if (bundle.sourceKind === "contact") {
    const c = contactSource(bundle);
    const person = contactDisplayName(c);
    const target = contactTargetLabel(c);
    const ask = cleanText(c?.askType?.replace(/_/g, " "), 40) || "outreach";
    const angle = contactAngleSuggestion(c);
    const askSuggestion = contactAskSuggestion(task, c);
    const lastExchange = cleanText(c?.lastMessage, 140);
    const prepTopics = contactPrepTopics(task, c);
    const whyNow = contactPrepWhyNow(task, c);

    if (currentStage === "Prepare conversation") return [
      `Open a short prep note for ${person}${target ? ` about ${target}` : ""}`,
      `Write one line on why this conversation matters now: ${whyNow}`,
      prepTopics.length
        ? `Turn these into 3 specific questions for ${person}: ${prepTopics.join("; ")}`
        : `Write 3 specific questions you want ${person} to answer`,
      `Add one short update or credibility point you want ${person} to leave with`,
      `Stop when the prep note is short enough to glance at right before the conversation`,
    ];
    if (currentStage === "Choose ask") return [
      `Use this outreach angle for ${person}${target ? ` about ${target}` : ""}: ${angle}`,
      `Choose the smallest realistic ask for ${person}: ${askSuggestion}`,
      `Stop when you can explain why them and the ask in 2 short lines`,
    ];
    if (currentStage === "Track follow-up") return [
      `Open a blank message to ${person}${target ? ` about ${target}` : ""}`,
      lastExchange
        ? `Use this follow-up context in one line: ${lastExchange}`
        : `Use this follow-up angle: ${angle}`,
      `Give one clear ${ask} update or next step: ${askSuggestion}`,
      `Keep it short and easy to reply to, then save it ready to send`,
    ];
    if (currentStage === "Deepen relationship") return [
      `Choose one useful reason to contact ${person} now${target ? ` about ${target}` : ""}`,
      `Draft a short note that shares a real update, thanks them, or offers something relevant`,
      `End with one light next step rather than a heavy ask`,
      `Stop when the note feels warm, specific, and easy to reply to`,
    ];
    return [
      `Open a draft to ${person}${target ? ` about ${target}` : ""}`,
      `Use this opener angle: ${angle}`,
      `Make the ask small and specific: ${askSuggestion}`,
      `Keep it to 4-5 lines and stop when the reply path is obvious`,
    ];
  }

  if (bundle.sourceKind === "goal") {
    const laneSpecific = laneSpecificSearchMove(text);
    const focusLabel = relevantFocusFromContext(bundle.crossEngineContext) || "this focus area";
    if (goalNeedsNetworkSupport(text)) return [
      bundle.contactName
        ? `Draft a message to ${bundle.contactName} about this path — advice, referral, or warm intro`
        : `Open Network and add one useful contact or outreach path for this live role path`,
      `Write the exact ask: advice, referral, reconnect, or warm intro`,
      `Draft the message or save who you should contact next`,
      `Note which live path still lacks outreach support after this`,
    ];
    if (goalNeedsLearningSupport(text)) return [
      `Use Jobs or Learn to start learning about this live role path`,
      `Pick the one note, brief, or example that would help this path most`,
      `Write a short note on how you would use that learning later`,
      `Note which live path still lacks focused learning support after this`,
    ];
    if (keyword(text, /what kinds of|actually out there|what roles|which roles|role pattern|role patterns/)) return [
      `Open Jobs and search for 3 real ${focusLabel} roles using concrete title keywords`,
      `Save the first credible roles that actually fit what you mean by ${focusLabel}`,
      `Extract the recurring title words, team names, and must-have requirements into one note`,
    ];
    if (currentStage === "Define target") return [
      `Open Jobs and find which path still has no saved role`,
      `Name that path and write what a credible role looks like for it`,
      `Save one role to fill that gap`,
    ];
    if (currentStage === "Build list") return [
      laneSpecific || `Find one real role for the most important path that is still missing one`,
      `Save it and mark the next action: apply, reach out first, or clarify`,
      `Check which other paths could use a first role`,
    ];
    return [
      `Open the most promising saved role and take the next concrete action`,
      `Draft the application move, outreach message, or clarification note`,
      `Send it or save it ready to send`,
      `Pick the next path to move forward`,
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
  if (object === "Knowledge") {
    const steps = buildKnowledgeExtractionSteps(task, bundle);
    return [steps.sourceStep, steps.extractStep, steps.draftStep, steps.stopStep];
  }
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
  if (bundle.sourceKind === "contact") {
    const source = contactSource(bundle);
    const status = String(source?.status || "to_contact");
    const askType = String(source?.askType || "");
    const isMessageTask = /\b(draft|write|send|message|email|reply|follow up|follow-up|thank)\b/.test(text);
    const conversationPrepTask = isConversationPrepTask(task, bundle);
    const currentStage =
      conversationPrepTask ? "Prepare conversation"
      : isMessageTask && (status === "replied" || status === "messaged" || askType === "follow_up") ? "Track follow-up"
      : isMessageTask ? "Draft outreach"
      : status === "replied" ? "Deepen relationship"
      : status === "messaged" || askType === "follow_up" ? "Track follow-up"
      : keyword(text, /who is|why this person|which ask|angle|research/) ? "Choose ask"
      : "Draft outreach";
    const stageOutput =
      currentStage === "Prepare conversation" ? "A short prep note with specific questions is ready"
      : currentStage === "Choose ask" ? "The outreach angle and ask are clear"
      : currentStage === "Track follow-up" ? "The next follow-up move is drafted or logged"
      : currentStage === "Deepen relationship" ? "The next relationship-building move is clear"
      : "A message draft exists";
    return makeWorkflowState({
      workObject: "Pipeline",
      workflow: CONTACT_WORKFLOW,
      currentStage,
      stageOutput,
      inheritedFrom: `contact:${source?.id || task.sourceId || "unknown"}`,
      confidence: "parent",
      sourceKind: "contact",
    });
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
  const rawSteps = coerceTaskBreakdownSteps(task, bundle, workflowState, stageActions(task, bundle, workflowState).map((text) => ({ text, done: false as const })));
  const steps = personalizeDeterministicSteps(task, bundle, workflowState, rawSteps);
  return { workflowState, steps };
}

function resolveTrackId(task: Task, source: SourceRecord): number | null {
  if (task.relatedTrackId) return task.relatedTrackId;
  if (source && "relatedTrackId" in source) return (source as any).relatedTrackId ?? null;
  if (source && "proofAssetForTrack" in source) return (source as any).proofAssetForTrack ?? null;
  return null;
}

function formatDeadlineLabel(deadline: string) {
  const raw = String(deadline || "").trim();
  if (!raw) return "";
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function cleanList(values: Array<string | null | undefined>, max = 4) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value || "", 140);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function contactDisplayName(contact: Contact | null | undefined) {
  return cleanText(contact?.name || contact?.who || "this person", 80) || "this person";
}

function contactTargetLabel(contact: Contact | null | undefined) {
  return cleanText([contact?.targetRole, contact?.targetOrg].filter(Boolean).join(" at "), 120);
}

function contactAngleSuggestion(contact: Contact | null | undefined) {
  const why = cleanText(contact?.why, 140);
  if (why) return why;
  const target = contactTargetLabel(contact);
  if (target) return `They can help you reality-check ${target}`;
  const who = cleanText(contact?.who, 100);
  if (who) return `They are relevant because they are a ${who}`;
  return "Why this person is relevant now";
}

function contactAskSuggestion(task: Task, contact: Contact | null | undefined) {
  const title = `${task?.title || ""}`.toLowerCase();
  const target = contactTargetLabel(contact);
  if (/\b15[ -]?minute\b|\b15 min\b|\bquick chat\b|\bcoffee chat\b/.test(title)) {
    return target
      ? `Ask for a 15-minute chat about ${target}, or the clearest steer if they are short on time`
      : "Ask for a 15-minute chat, or the clearest steer if they are short on time";
  }
  const askType = cleanText(contact?.askType?.replace(/_/g, " "), 40).toLowerCase();
  if (askType === "referral") {
    return target
      ? `Ask whether they would point you to the right team or person for ${target}`
      : "Ask whether they would point you to the right team or person";
  }
  if (askType === "follow up") return "Ask whether now is a good time to continue the conversation and what the best next step is";
  if (askType === "reconnect") {
    return target
      ? `Ask for a quick reconnect and their latest steer on ${target}`
      : "Ask for a quick reconnect and the clearest steer";
  }
  if (askType === "advice") {
    return target
      ? `Ask for the clearest steer on ${target}, ideally via a short chat`
      : "Ask for quick advice or the clearest steer";
  }
  return target
    ? `Ask for one small next step on ${target}: a steer, quick reply, or short chat`
    : "Ask for one small next step: a steer, quick reply, or short chat";
}

function isOutreachOrMessageTask(task: Task, bundle: SourceBundle) {
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext || ""}`.toLowerCase();
  return bundle.sourceKind === "contact"
    || /\b(reach out|outreach|follow up|follow-up|message|email|reply|coffee chat|chat|intro|referral|reconnect|contact)\b/.test(text);
}

function isConversationPrepTask(task: Task, bundle: SourceBundle) {
  if (bundle.sourceKind !== "contact") return false;
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${task?.sourceNote || ""} ${bundle.sourceContext || ""}`.toLowerCase();
  const prepSignal = /\b(prepare|prep|questions?|talking points?|conversation prep)\b/.test(text);
  const conversationSignal = /\b(coffee|coffee chat|chat|call|meeting|conversation)\b/.test(text);
  const draftingSignal = /\b(draft|write|send|message|email|reply|follow up|follow-up|thank)\b/.test(text);
  return prepSignal && conversationSignal && !draftingSignal;
}

function taskSpecificPromptGuidance(task: Task, bundle: SourceBundle) {
  if (isConversationPrepTask(task, bundle)) {
    return (
      `For contact conversation prep:\n` +
      `- Anchor remains the planner; prepare a short prep note, not an outreach draft.\n` +
      `- Turn the facts already provided into 3-5 specific questions, one why-now line, and one short update or credibility point to share.\n` +
      `- If a referral path, target role, hiring question, or team context already exists, use it directly instead of telling the user to research or think from scratch.\n` +
      `- Keep the output glanceable enough to use right before the conversation.\n` +
      `- Use public evidence only if it changes what they should ask right now.\n`
    );
  }
  if (isOutreachOrMessageTask(task, bundle)) {
    return (
      `For outreach, follow-up, or message work:\n` +
      `- Anchor remains the planner; your job is to personalize the move using only the facts provided.\n` +
      `- Do not tell the user to review notes, research the person, or figure out why they are reaching out if a reason, target, prior thread, or relationship signal already exists.\n` +
      `- Convert available context into a suggested outreach angle, a smallest credible ask, and a clear stop condition.\n` +
      `- If current public information about the person, team, or organization is already provided, use at most 1-2 relevant signals to sharpen why now, the angle, or the ask.\n` +
      `- Do not turn the task into open-ended research. Use public evidence only when it materially improves relevance for this specific message.\n` +
      `- For simple follow-ups, thank-yous, or status updates, keep public research silent unless a current fact clearly changes what should be sent.\n` +
      `- If a prior exchange, draft, or warm relationship exists, continue from it instead of starting cold.\n` +
      `- If context is weak, stay honest, keep the ask soft, and do not invent shared history or certainty.\n` +
      `- Steps should reduce thinking load and move toward a sendable message in 3-5 concrete actions.\n`
    );
  }
  return "";
}

function providerEvidencePromptGuidance(contextBlocks?: {
  userAuthored?: ContextBlock[];
  externalResearch?: ContextBlock[];
}) {
  const hasEvidence = !!(contextBlocks?.userAuthored?.length || contextBlocks?.externalResearch?.length);
  if (!hasEvidence) return "";
  return (
    `When optional notes or evidence are present:\n` +
    `- Treat them as bounded context that sharpens the current task, not as the task itself.\n` +
    `- If they already contain specific facts, sections, deadlines, names, or draft material, use those directly instead of telling the user to review notes or re-research from scratch.\n` +
    `- Do not expose internal mechanics like provider names, note systems, retrieval steps, or evidence labels in the user-facing task steps.\n` +
    `- If the evidence reflects current public facts that could have changed, use cautious wording like check or verify rather than asserting certainty.\n`
  );
}

function sparseContextPromptGuidance(
  task: Task,
  _bundle: SourceBundle,
  contextBlocks?: {
    userAuthored?: ContextBlock[];
    externalResearch?: ContextBlock[];
  },
) {
  const hasProviderEvidence = !!(contextBlocks?.userAuthored?.length || contextBlocks?.externalResearch?.length);
  const hasMeaningfulTaskNote = !!meaningfulTaskContextText(task.sourceNote);
  if (hasProviderEvidence || hasMeaningfulTaskNote) return "";
  return (
    `If user-authored notes are weak or absent:\n` +
    `- Do not pretend there is hidden note value.\n` +
    `- Rely on the structured Anchor context already provided: linked source record, deadlines, readiness, connected jobs, contacts, active tracks, recent progress, and done-when.\n` +
    `- Produce a specific next move from that structured context rather than generic advice.\n`
  );
}

function globalBreakdownQualityGuidance() {
  return (
    `Quality bar for every breakdown:\n` +
    `- The first step must be immediately startable and produce a visible result.\n` +
    `- Use available context to create specific actions, not generic advice or a restatement of the context.\n` +
    `- Avoid filler like review notes, do research, take notes, or summarize unless the task is genuinely research-heavy and that is the shortest useful move.\n` +
    `- Prefer 3-5 concrete actions that end in a clear stop condition for this stage.\n`
  );
}

function firstLiveRoleLabelFromContext(text: string | undefined) {
  const match = String(text || "").match(/Live roles nearby:\s*([^;(]+ at [^(;\n]+)/i);
  return cleanText(match?.[1] || "", 160);
}

function relevantFocusFromContext(text: string | undefined) {
  const match = String(text || "").match(/Relevant career focus:\s*([^.\n]+)/i);
  return cleanText(match?.[1] || "", 80);
}

function contactPrepWhyNow(task: Task, contact: Contact | null | undefined) {
  const note = meaningfulTaskContextText(task.sourceNote);
  const fromNote = cleanText((note.match(/^(.*?)(?:\bi want to ask about\b|$)/i)?.[1] || ""), 120);
  if (fromNote) return fromNote;
  if (contact?.sourceNetwork) {
    return `${cleanText(contact.sourceNetwork, 40)} referred me${contact?.why ? ` and ${cleanText(contact.why, 120)}` : ""}`;
  }
  return cleanText(contact?.why, 160) || contactAngleSuggestion(contact);
}

function contactPrepTopics(task: Task, contact: Contact | null | undefined) {
  const note = meaningfulTaskContextText(task.sourceNote);
  const askSlice = note.match(/\bi want to ask about\s+(.+)$/i)?.[1]
    || note.match(/\bask about\s+(.+)$/i)?.[1]
    || "";
  const raw = askSlice || note || cleanText(contact?.why, 220) || contactTargetLabel(contact) || "";
  const normalized = raw
    .replace(/^i want to ask about\s+/i, "")
    .replace(/^ask about\s+/i, "")
    .replace(/^i want to\s+/i, "");
  return cleanList(normalized.split(/;|,|\band\b/), 3);
}

function titleFocusLabel(text: string | undefined) {
  return cleanText(
    String(text || "")
      .replace(/\b(working|synthesis|summary|notes?|memo|brief|guide|resource|course|reading|readings|practice|article)\b/gi, " ")
      .replace(/\s+/g, " "),
    120,
  );
}

function stripOutputScaffold(text: string | undefined) {
  return cleanText(
    String(text || "")
      .replace(/^(a|an|the)\s+(short|brief|tight|one-page|one page|usable)?\s*(note|memo|brief|summary|write-up|writeup|draft|analysis|synthesis)\s+(on|about)\s+/i, "")
      .replace(/^(draft|write|create|turn this into)\s*:?/i, "")
      .replace(/\s+/g, " "),
    140,
  );
}

function isWeakOutputTarget(text: string | undefined) {
  const value = String(text || "").trim().toLowerCase();
  return !value || /\b(application prep|prep|usable note exists|short prep note exists|short note exists|usable output|note exists)\b/.test(value);
}

function formatConceptList(values: string[]) {
  const parts = cleanList(values, 3);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
}

function isGenericNoteFragment(text: string) {
  const value = cleanText(text, 120).toLowerCase();
  if (!value) return true;
  if (value.length < 12) return true;
  return /\b(working note|note from|notes from|draft from|research note|study note|june|july|august|september|october|november|december|january|february|march|april|may)\b/.test(value)
    && !/\b(high-risk|risk tier|transparency|gpai|obligation|requirement|deadline|interview|application|case|framework|market|company|role|policy|strategy)\b/.test(value);
}

function isWeakTaskContextText(text: string | undefined) {
  const value = cleanText(text, 140).toLowerCase();
  if (!value) return true;
  if (/^(from brain dump|from strategy builder|this is a relationship or outreach action)$/.test(value)) return true;
  if (/^(working note|working note from [a-z0-9 -]+|note from [a-z0-9 -]+|notes from [a-z0-9 -]+)$/.test(value)) return true;
  return false;
}

function meaningfulTaskContextText(text: string | undefined) {
  return isWeakTaskContextText(text) ? "" : cleanText(text, 240);
}

function buildExtractionFocus(task: Task, bundle: SourceBundle, source?: Learn | null) {
  const noteBits = String(source?.note || "")
    .split(/[.;\n]+/)
    .map((part) => cleanText(part.replace(/^focus on\s+/i, ""), 120))
    .filter((part) => !!part && !isGenericNoteFragment(part))
    .slice(0, 3);
  const sourceNoteBits = String(task.sourceNote || "")
    .split(/[.;\n]+/)
    .map((part) => cleanText(part, 120))
    .filter((part) => !!part && !isGenericNoteFragment(part))
    .slice(0, 2);

  const outputTarget =
    stripOutputScaffold(source?.requiredOutput)
    || titleFocusLabel(source?.capabilityBuilt)
    || stripOutputScaffold(task.doneWhen || task.minimumOutcome)
    || titleFocusLabel(source?.title || task.title)
    || "the useful points you need";
  const weakOutputTarget = isWeakOutputTarget(outputTarget);
  const titleFocus = titleFocusLabel(source?.title || task.title);
  const capabilityFocus = titleFocusLabel(source?.capabilityBuilt);
  const hasStrongOutputHint = !!stripOutputScaffold(source?.requiredOutput) || !!capabilityFocus;

  const focusTerms = cleanList([
    ...noteBits,
    ...sourceNoteBits,
    weakOutputTarget ? "" : outputTarget,
    capabilityFocus,
    noteBits.length || hasStrongOutputHint ? "" : titleFocus,
    noteBits.length || hasStrongOutputHint ? "" : stripOutputScaffold(task.doneWhen || task.minimumOutcome),
  ], 4);

  const focusLabel = focusTerms.join("; ");
  const conceptLabel = formatConceptList(noteBits.length ? noteBits : focusTerms);

  return { focusLabel, outputTarget, weakOutputTarget, conceptLabel, noteBits };
}

function buildKnowledgeExtractionSteps(task: Task, bundle: SourceBundle, source?: Learn | null) {
  const itemLabel = titleFocusLabel(source?.title || task.title) || source?.title || task.title || "this source";
  const liveRoleLabel = firstLiveRoleLabelFromContext(bundle.crossEngineContext);
  const { focusLabel, outputTarget, weakOutputTarget, conceptLabel, noteBits } = buildExtractionFocus(task, bundle, source);
  const searchTerms = focusLabel || outputTarget;
  const hasStoredNotes = noteBits.length > 0;
  const hasSourceLink = !!(source?.url?.trim() || task.sourceUrl?.trim());

  const sourceStep = hasStoredNotes
    ? noteBits.length
      ? `Use your notes on ${itemLabel}. Go straight to the parts on ${conceptLabel}`
      : `Use your notes on ${itemLabel}. Search for sections covering: ${searchTerms}`
    : hasSourceLink
      ? `Open ${itemLabel} and scan headings or summary for: ${searchTerms}`
      : `Search your source or notes for: ${searchTerms}`;
  const extractTail = liveRoleLabel ? ` for ${liveRoleLabel}` : "";
  const extractStep = weakOutputTarget
    ? conceptLabel
      ? `Extract 3 points from ${conceptLabel}: what each one is, who it affects, and why it matters${extractTail}`
      : `Extract 3 points: what each one is, why it matters, and how you would use it${extractTail}`
    : `Pull the 3 points most relevant to ${outputTarget}${extractTail}`;
  const draftStep = source?.requiredOutput?.trim()
    ? `Turn those points into: ${source.requiredOutput.trim()}`
    : `Turn those points into one usable note, answer, or brief`;
  const stopStep = liveRoleLabel
    ? `Stop when the output is usable for ${liveRoleLabel}, not just interesting in theory`
    : `Stop when you have 3 concrete points and one usable output`;

  return { sourceStep, extractStep, draftStep, stopStep };
}

async function buildCrossEngineContext(
  task: Task,
  sourceKind: SourceBundle["sourceKind"],
  source: SourceRecord,
  userContext: UserContext,
): Promise<{ text: string; contactName?: string }> {
  const trackId = resolveTrackId(task, source);
  const parts: string[] = [];
  let bestContactName: string | undefined;

  const needsTrackContext = trackId != null;
  const needsJobs = sourceKind === "job" || sourceKind === "contact" || needsTrackContext;
  const needsContacts = sourceKind === "job" || sourceKind === "contact" || needsTrackContext;
  const needsLearn = sourceKind === "learn" || sourceKind === "hustle" || sourceKind === "goal" || needsTrackContext;

  const [tracks, jobs, contacts, learns, learningGapResult] = await Promise.all([
    needsTrackContext ? storage.getCareerTracks() : Promise.resolve([]),
    needsJobs ? storage.getJobs() : Promise.resolve([]),
    needsContacts ? storage.getContacts() : Promise.resolve([]),
    needsLearn ? storage.getLearn() : Promise.resolve([]),
    needsTrackContext ? computeLearningGaps() : Promise.resolve({ tracks: [] }),
  ]);

  const track = trackId != null ? tracks.find((entry) => entry.id === trackId) : undefined;
  if (track?.name) parts.push(`Relevant career focus: ${track.name}.`);

  if (sourceKind === "job" && source) {
    const job = source as Job;
    if (job.deadline) parts.push(`This role is still live until ${formatDeadlineLabel(job.deadline)}.`);
    const linkedContactIds = await storage.getJobContactLinks((source as Job).id);
    const linkedContacts = linkedContactIds
      .map((contactId) => contacts.find((contact) => contact.id === contactId))
      .filter((contact): contact is Contact => !!contact);
    if (linkedContacts.length) {
      parts.push(`People already linked to this role: ${linkedContacts
        .slice(0, 3)
        .map((contact) => `${contact.name} (${contact.relationshipStrength || "cold"}${contact.targetOrg ? `, ${contact.targetOrg}` : ""})`)
        .join("; ")}.`);
      bestContactName = linkedContacts[0]?.name;
    }
  }

  const trackJobs = trackId != null
    ? jobs.filter((job) => getTrackId("jobs", job) === trackId && isJobLive(job))
    : [];
  if (sourceKind !== "job" && trackJobs.length) {
    const liveRoleLines = trackJobs
      .slice()
      .sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return String(a.deadline).localeCompare(String(b.deadline));
      })
      .slice(0, 3)
      .map((job) => `${job.title} at ${job.company} (${job.status}${job.applicationReadiness ? `, ${job.applicationReadiness}` : ""}${job.deadline ? `, due ${formatDeadlineLabel(job.deadline)}` : ""})`);
    if (liveRoleLines.length) parts.push(`Live roles nearby: ${liveRoleLines.join("; ")}.`);
  }

  if (sourceKind === "contact" && source) {
    const contact = source as Contact;
    const relatedJobs = cleanList(
      jobs
        .filter((job) =>
          isJobLive(job)
          && (
            (trackId != null && getTrackId("jobs", job) === trackId)
            || (!!contact.targetOrg && job.company.toLowerCase() === contact.targetOrg.toLowerCase())
            || (!!contact.targetRole && job.title.toLowerCase().includes(contact.targetRole.toLowerCase()))
          ))
        .map((job) => `${job.title} at ${job.company}${job.deadline ? ` (due ${formatDeadlineLabel(job.deadline)})` : ""}`),
      3,
    );
    if (relatedJobs.length) parts.push(`Roles this contact could help with: ${relatedJobs.join("; ")}.`);
    bestContactName = contact.name || bestContactName;
  }

  if (trackId != null) {
    const warmContacts = contacts
      .filter((contact) => getTrackId("contacts", contact) === trackId && isContactWarm(contact))
      .slice(0, 3);
    if (warmContacts.length && sourceKind !== "contact") {
      parts.push(`Warm people already in reach: ${warmContacts
        .map((contact) => `${contact.name} (${contact.relationshipStrength}${contact.targetOrg ? `, ${contact.targetOrg}` : ""})`)
        .join("; ")}.`);
      bestContactName = bestContactName || warmContacts[0]?.name;
    }

    const trackLearn = learns.filter((learnItem) => getTrackId("learn", learnItem) === trackId);
    const evidencedCapabilities = cleanList(
      trackLearn
        .filter((learnItem) => learnItem.capabilityBuilt && (learnItem.learnStatus === "done" || !!learnItem.outputEvidenceUrl))
        .map((learnItem) => learnItem.capabilityBuilt),
      5,
    );
    const activeLearning = cleanList(
      trackLearn
        .filter((learnItem) => learnItem.active && learnItem.learnStatus !== "done")
        .map((learnItem) => learnItem.capabilityBuilt ? `${learnItem.title} (${learnItem.capabilityBuilt})` : learnItem.title),
      4,
    );
    if (activeLearning.length) parts.push(`Learning already in progress: ${activeLearning.join("; ")}.`);
    if (evidencedCapabilities.length) parts.push(`Capabilities already evidenced: ${evidencedCapabilities.join(", ")}.`);

    const gap = learningGapResult.tracks.find((entry) => entry.trackId === trackId);
    if (gap?.rankedGaps.length) {
      const gapLabels = cleanList(gap.rankedGaps.map((entry) => entry.label), 3);
      if (gapLabels.length) parts.push(`Capability areas still worth strengthening: ${gapLabels.join(", ")}.`);
    }

    try {
      const activity = await storage.getActivityLog();
      const recentCompletedTaskIds = activity
        .filter((entry) => entry.timestamp > Date.now() - 7 * 24 * 60 * 60 * 1000 && entry.eventType === "completed" && entry.taskId)
        .map((entry) => entry.taskId as number);
      if (recentCompletedTaskIds.length) {
        const allTasks = await storage.getTasks();
        const recentTaskTitles = cleanList(
          allTasks
            .filter((entry) => recentCompletedTaskIds.includes(entry.id) && resolveTrackId(entry, null) === trackId)
            .map((entry) => entry.title),
          4,
        );
        if (recentTaskTitles.length) parts.push(`Recently completed work: ${recentTaskTitles.join("; ")}.`);
      } else if (userContext.recentWins) {
        parts.push(`Recent progress to build on: ${userContext.recentWins}.`);
      }
    } catch {
      if (userContext.recentWins) parts.push(`Recent progress to build on: ${userContext.recentWins}.`);
    }
  }

  return { text: parts.join("\n"), contactName: bestContactName };
}

export async function buildSourceContext(task: Task, userContext?: UserContext): Promise<SourceBundle> {
  const sharedUserContext = userContext || await buildUserContext();
  const taskSourceNote = meaningfulTaskContextText(task.sourceNote);
  let sourceContext = "";
  let playbook = "";
  let sourceKind: SourceBundle["sourceKind"] = "task";
  let source: SourceRecord = null;
  if (task.sourceType === "goal") {
    sourceKind = "goal";
    const tracks = await storage.getCareerTracks();
    const activeTrackNames = tracks.filter((track) => track.status !== "archived").map((track) => track.name).slice(0, 6);
    sourceContext = `This is a STRATEGIC GOAL / broad-pursuit item. Title: ${task.title}. Done when: ${task.doneWhen || task.minimumOutcome || "one real role-opening move exists"}. ${taskSourceNote ? "Goal note: " + taskSourceNote + ". " : ""}${activeTrackNames.length ? "Active tracks: " + activeTrackNames.join("; ") + ". " : ""}`;
    playbook = "Use the parent pipeline workflow first. The goal is not abstract comparison; it is to turn each plausible path into one real role or application move. Prefer filling missing paths with concrete pipeline actions over reflection.";
  } else if (task.sourceType === "job" && task.sourceId) {
    const j = (await storage.getJobs()).find((x) => x.id === task.sourceId);
    if (j) {
      source = j;
      sourceKind = "job";
      sourceContext = `This is a JOB / OPPORTUNITY item. Role: ${j.title} at ${j.company}. Status: ${j.status}. Readiness: ${j.applicationReadiness}. ${j.deadline ? `Deadline: ${formatDeadlineLabel(j.deadline)}. ` : ""}Fit score: ${j.fitScore ?? "unknown"}. Archetype: ${j.roleArchetype || "unknown"}. Narrative angle: ${j.narrativeAngle || "unset"}. ${j.note ? "Posting notes: " + j.note : ""} ${j.url ? "URL: " + j.url : ""}`;
      playbook = "Use the parent application workflow first. CV/cover/answers/submission are Artifact; role research is Knowledge; multi-role search or networking is Pipeline. Never auto-change job status.";
    }
  } else if (task.sourceType === "learn" && task.sourceId) {
    const l = (await storage.getLearn()).find((x) => x.id === task.sourceId);
    if (l) {
      source = l;
      sourceKind = "learn";
      const learnParts = [
        `This is a LEARNING / DEVELOPMENT item. Title: ${l.title}.`,
        `Type: ${l.type}.`,
        l.url ? `URL: ${l.url}.` : "",
        l.note ? `Notes: ${l.note}.` : "",
        l.capabilityBuilt ? `Capability: ${l.capabilityBuilt}.` : "",
        `Optional useful result: ${l.requiredOutput || "none defined yet"}.`,
        l.outputTitle ? `Current saved output title: ${l.outputTitle}.` : "",
        l.outputStatus ? `Current output state: ${l.outputStatus}.` : "",
        l.outputEvidenceUrl ? `Existing saved output link: ${l.outputEvidenceUrl}.` : "",
      ];
      if (l.sourceType === "recommendation" && l.sourceId) {
        try {
          const [subdivisions, milestones] = await Promise.all([
            storage.getRecommendationSubdivisions(l.sourceId),
            storage.getRecommendationMilestones(l.sourceId),
          ]);
          const topicLabels = cleanList(subdivisions.map((subdivision) => subdivision.label), 4);
          const milestoneLabels = cleanList(
            milestones.map((milestone) => milestone.label || milestone.suggestedTaskTitle || milestone.doneWhen),
            4,
          );
          if (topicLabels.length) learnParts.push(`Stored topic breakdown: ${topicLabels.join("; ")}.`);
          if (milestoneLabels.length) learnParts.push(`Stored checkpoints: ${milestoneLabels.join("; ")}.`);
        } catch {
          // Non-fatal: breakdown still works without recommendation detail.
        }
      }
      sourceContext = learnParts.filter(Boolean).join(" ");
      playbook = "Use the parent learning/capability workflow first. Do not just read; locate the stage and produce a useful note, practice step, or useful output if one is defined. Never auto-change learnStatus.";
    }
  } else if (task.sourceType === "contact" && task.sourceId) {
    const c = (await storage.getContacts()).find((x) => x.id === task.sourceId);
    if (c) {
      source = c;
      sourceKind = "contact";
      sourceContext = `This is a CONTACT / NETWORKING item. Person: ${contactDisplayName(c)}. Status: ${c.status}. Relationship strength: ${c.relationshipStrength}. Ask type: ${c.askType || "unspecified"}. ${c.who ? "Who they are: " + c.who + ". " : ""}${c.sourceNetwork ? "Shared network: " + c.sourceNetwork + ". " : ""}${c.why ? "Why they matter: " + c.why + ". " : ""}${c.targetOrg ? "Target company: " + c.targetOrg + ". " : ""}${c.targetRole ? "Target role: " + c.targetRole + ". " : ""}${c.messageDraft ? "Existing draft: " + c.messageDraft + ". " : ""}${c.lastMessage ? "Last message: " + c.lastMessage + ". " : ""}${c.nextFollowUpDate ? "Next follow-up: " + c.nextFollowUpDate + ". " : ""}${c.referralPotential ? "Referral potential: " + c.referralPotential + ". " : ""}`;
      playbook = "Use the parent networking workflow first. Turn this into one specific outreach, follow-up, referral ask, or relationship move. Never auto-change contact status.";
    }
  } else if (task.sourceType === "hustle" && task.sourceId) {
    const h = (await storage.getHustles()).find((x) => x.id === task.sourceId);
    if (h) {
      source = h;
      sourceKind = "hustle";
      sourceContext = `This is a PROOF-ASSET / project step. Title: ${h.title}. Stage: ${h.stage}. Content pillar: ${h.contentPillar || "unset"}. Core claim: ${h.coreClaim || "unset"}. ${h.note ? "Notes: " + h.note : ""}`;
      playbook = "Use the parent output workflow first: claim -> audience -> examples -> draft -> save. Never auto-change the stage automatically.";
    }
  } else if (task.sourceUrl || taskSourceNote) {
    sourceContext = `${taskSourceNote ? "Context: " + taskSourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
  }
  const tempBundle: SourceBundle = { sourceContext, playbook, sourceKind, source, parentContext: "" };
  const parentWorkflow = parentWorkflowFor(task, tempBundle);
  const parentContext = parentWorkflow ? `Inherited workflow from parent ${parentWorkflow.inheritedFrom}: ${parentWorkflow.workflow.join(" → ")}. Kind: ${parentWorkflow.workflowKind}. Current stage: ${parentWorkflow.currentStage}. Stage output: ${parentWorkflow.stageOutput}. Completion criteria: ${parentWorkflow.completionCriteria.join("; ")}.` : "";

  let cvText = "";
  let jdText = "";
  cvText = sharedUserContext.cv?.trim() || "";
  if (sourceKind === "job" && source) {
    jdText = ((source as any).jdText as string | undefined)?.trim() || "";
  }

  let crossEngineContext = "";
  let contactName: string | undefined;
  try {
    const ce = await buildCrossEngineContext(task, sourceKind, source, sharedUserContext);
    crossEngineContext = ce.text;
    contactName = ce.contactName;
  } catch { /* non-fatal — breakdown works without cross-engine context */ }

  return { sourceContext, playbook, sourceKind, source, parentContext, parentWorkflow, cvText, jdText, crossEngineContext, contactName };
}

export async function buildDeterministicTaskBreakdown(task: Task) {
  const bundle = await buildSourceContext(task);
  const fallback = fallbackStagePlan(task, bundle);
  return { bundle, workflowState: fallback.workflowState, steps: fallback.steps };
}

export function buildTaskBreakdownPrompt(input: {
  task: Task;
  bundle: SourceBundle;
  fallbackObject: WorkObject;
  userContextText?: string;
  contextBlocks?: {
    userAuthored?: ContextBlock[];
    externalResearch?: ContextBlock[];
  };
}) {
  const { task, bundle, fallbackObject, userContextText, contextBlocks } = input;
  const globalGuidance = globalBreakdownQualityGuidance();
  const taskGuidance = taskSpecificPromptGuidance(task, bundle);
  const providerGuidance = providerEvidencePromptGuidance(contextBlocks);
  const sparseContextGuidance = sparseContextPromptGuidance(task, bundle, contextBlocks);
  const providerContext = formatContextBlocksForPrompt(contextBlocks || {});
  return (
    `${COACH_PREAMBLE}You are Anchor's workflow-state decomposition engine. Do not jump from task title to steps.\n\n` +
    `${userContextText ? `${userContextText}\n\n` : ""}` +
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
    `Use user-authored context ahead of external public evidence. Use external public evidence only to sharpen public facts and current constraints. Do not mention provider mechanics or invent sources not shown in the prompt. ` +
    `Return ONLY JSON: {"workObject":"...","workflow":["..."],"workflowKind":"finite|continuous","currentStage":"...","stageOutput":"...","completionCriteria":["..."],"confidence":"high|medium|low","steps":[{"text":"...","substeps":["..."]}],"advanceCondition":"..."} or {"question":"..."}.\n\n` +
    `${globalGuidance}\n` +
    `For learning or research work: if stored notes, topic breakdown, checkpoints, links, prior outputs, live role context, or user-authored note excerpts are present, use them directly. Name the actual section, concept, checkpoint, deadline, company, role, or prior output when available. Do not assume page content beyond what is shown. If the context is sparse or partial, tell the user exactly what to search for, what to extract, and what output to produce.\n\n` +
    `${taskGuidance ? `${taskGuidance}\n` : ""}` +
    `${providerGuidance ? `${providerGuidance}\n` : ""}` +
    `${sparseContextGuidance ? `${sparseContextGuidance}\n` : ""}` +
    `${bundle.playbook ? `Relevant playbook: ${bundle.playbook}\n` : ""}` +
    `${bundle.parentContext ? `Parent workflow context: ${bundle.parentContext}\n` : ""}` +
    `Source context: ${bundle.sourceContext || "none beyond the title"}\n` +
    `${bundle.crossEngineContext ? (
      `\nCONNECTED CONTEXT - use this to make steps specific. Name real people, reference real deadlines, ` +
      `build on completed work, and connect steps to live opportunities. Do not repeat work listed as already done.\n` +
      `${bundle.crossEngineContext}\n\n`
    ) : ""}` +
    `${providerContext ? `\n${providerContext}\n\n` : ""}` +
    `Default work object if uncertain: ${fallbackObject}\n` +
    `Task: ${task.title}\nCategory: ${task.category}\nDone when: ${task.doneWhen || task.minimumOutcome || "smallest useful outcome is complete"}\n` +
    `${bundle.cvText && bundle.jdText ? (
      `\nCANDIDATE CV (use this to identify specific bullets):\n${bundle.cvText.slice(0, 3000)}\n\n` +
      `JOB DESCRIPTION:\n${bundle.jdText.slice(0, 3000)}\n\n` +
      `IMPORTANT: For Build materials steps, quote the 2-3 most relevant existing CV bullets exactly, ` +
      `then write a specific improved version using the job's language. ` +
      `Step format: "Rewrite: \\"[exact existing bullet]\\" -> \\"[improved version]\\"". ` +
      `Steps must reference real content from the CV and JD above, not generic advice.\n`
    ) : ""}`
  );
}

export function registerTaskBreakdownRoutes(app: Express) {
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const context = String(req.body?.context || "").slice(0, 500);
    const sharedUserContext = await buildUserContext();
    const bundle = await buildSourceContext(task, sharedUserContext);
    const fallbackObject = (bundle.parentWorkflow?.workObject as WorkObject) || classifyWorkObject(task, bundle);
    const userCtx = formatContextForPrompt(sharedUserContext);
    const collectedContext = await collectTaskBreakdownContext({
      task,
      sourceBundle: bundle,
      userAuthoredContext: context,
      mockMode: req.body?.externalResearchMockMode,
    });

    let question = "";
    let steps: BreakdownStep[] = [];
    let workflowState: WorkflowState | undefined;
    try {
      const raw = await llm(buildTaskBreakdownPrompt({
        task,
        bundle,
        fallbackObject,
        userContextText: context ? `${userCtx}\nUser context: ${context}` : userCtx,
        contextBlocks: collectedContext.blocks,
      }), { model: LLM_MODELS.breakdown });
      const parsed = parseBreakdown(raw, fallbackObject, bundle.parentWorkflow);
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

