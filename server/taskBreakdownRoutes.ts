import type { Express } from "express";
import { llm, llmJSON, LLM_MODELS } from "./llm";
import type { Contact, Hustle, Job, Learn, Task } from "@shared/schema";
import { storage } from "./storage";
import { deterministicUnstickStep } from "./planningFeedback";
import { parseCompanyBrief, type CompanyBrief } from "./companyIntelligence";
import { computeJobTruthStrip } from "./jobTruth";
import { COACH_PREAMBLE } from "./userPromptProfile";
import { buildUserContext, formatContextForPrompt, type UserContext } from "./userContext";
import { isJobLive, isContactWarm, getTrackId } from "@shared/domainState";
import { contactTopicHint, isGenericContactPlaceholder, nextContactTaskTitle, normalizeContactWho } from "@shared/taskPreview";
import { computeLearningGaps } from "./learningStrategy";
import { executeSteps } from "./stepExecutors";
import { contractForTaskIntent, hasRoleMarketScanContract, isRoleMarketScanInput, likelyLearningGapPlan, roleMarketScanLabel } from "./taskIntent";
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
type StepExecutor = "system" | "user_action" | "user_learning";
type StepDisposition = "applied" | "saved" | "dismissed";
type BreakdownStep = { text: string; done: boolean; substeps?: string[]; workflowState?: WorkflowState; executor?: StepExecutor; outputSpec?: string; output?: string; gaps?: string; disposition?: StepDisposition; completedAt?: string };
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

type GoalTaskMode = "role_signal" | "network_support" | "learning_support" | "cleanup" | "general";

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
  Artifact: ["Understand what's needed", "Gather what you need", "Outline", "Draft", "Refine", "Check", "Deliver"],
  Decision: ["Frame the question", "Set criteria", "Explore options", "Weigh up", "Decide", "Commit"],
  Knowledge: ["Find out what's involved", "Focus on what matters", "Read / watch", "Pull out the key bits", "Make sense of it", "Save what's useful"],
  Capability: ["Understand the skill", "Learn the basics", "Practise", "Try it for real", "Reflect", "Lock it in"],
  Pipeline: ["Define your target", "Build a list", "Prioritise", "Work through the next batch", "Track progress", "Follow up", "Review what's working"],
  Problem: ["Describe what's wrong", "Find the cause", "Consider fixes", "Test", "Fix it", "Confirm it's working"],
};

const APPLICATION_WORKFLOW = ["Understand the role", "Match your experience", "Address gaps", "Build materials", "Submit", "Follow up"];
const CONTACT_WORKFLOW = ["Find the right person", "Decide what to ask", "Draft a message", "Send", "Prepare for the conversation", "Follow up", "Stay in touch"];
const PROOF_WORKFLOW = ["Define your angle", "Pick your audience", "Gather examples", "Write a draft", "Save a useful version"];

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
  const stageOutput = input.stageOutput || "Something visible has changed";
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

function normalizeExecutor(raw: unknown): StepExecutor | undefined {
  const v = String(raw || "").toLowerCase();
  if (v === "system" || v === "user_action" || v === "user_learning") return v;
  return undefined;
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
  const executor = normalizeExecutor(record.executor);
  const outputSpec = cleanText(record.outputSpec || record.output_spec, 200) || undefined;
  const step: BreakdownStep = { text, done: false };
  if (substeps.length) step.substeps = substeps;
  if (executor) step.executor = executor;
  if (outputSpec) step.outputSpec = outputSpec;
  return step;
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
  if (keyword(text, /decide|choose|prioriti|pick|whether|option|trade[ -]?off|select|weigh|think about|reflect|consider|figure out/)) return "Decision";
  if (keyword(text, /practice|drill|improve|skill|interviewing|storylining|excel|capability|development|mock/)) return "Capability";
  if (isRoleMarketScanTask(task, bundle)) return "Pipeline";
  if (keyword(text, /learn|read|understand|research|report|guide|resource|synthesize|synthesize/)) return "Knowledge";
  if (keyword(text, /pipeline|outreach|network|search|batch|apply to multiple|generate list|all.*roles|explore.*role/)) return "Pipeline";
  if (bundle.sourceKind === "job") return "Artifact";
  if (bundle.sourceKind === "contact") return "Pipeline";
  if (bundle.sourceKind === "learn") return "Capability";
  if (bundle.sourceKind === "hustle") return "Artifact";
  return "Artifact";
}

function goalTaskMode(task: Pick<Task, "title" | "doneWhen" | "minimumOutcome" | "sourceNote" | "sourceStatus">): GoalTaskMode {
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${task?.sourceNote || ""} ${task?.sourceStatus || ""}`.toLowerCase();
  if (/broad_parallel_pursuit_network_support/.test(text)) return "network_support";
  if (/broad_parallel_pursuit_learning_support/.test(text)) return "learning_support";
  if (/reduce .*next three|next three live moves|park the rest|cleanup/.test(text)) return "cleanup";
  if (/\b(contact|contacts|outreach|reach out|message|network|conversation|chat|insider|person)\b/.test(text)) return "network_support";
  if (/\b(learning|learn|practice|drill|resource|requirement gap|missing requirement|prep support|prep move|skill gap)\b/.test(text)) return "learning_support";
  if (/\b(role|application move|missing path|still-empty|still empty|credible role|live role)\b/.test(text)) return "role_signal";
  return "general";
}

function goalTargetLabel(task: Pick<Task, "title" | "doneWhen" | "minimumOutcome" | "sourceNote">): string {
  const title = compactText(task?.title || "");
  const exactTitlePatterns = [
    /^find one real (.+?) person(?: at .+?)? for a reality-check chat$/i,
    /^find one person(?: at .+?)? to ask how teams hire for (.+)$/i,
    /^pick the first requirement gap for (.+?) and save one learning move$/i,
    /^use one live (.+?) role to identify the first missing requirement$/i,
    /^use .+? to identify the first missing requirement for (.+)$/i,
    /^add one real role for (.+)$/i,
  ];
  for (const pattern of exactTitlePatterns) {
    const match = title.match(pattern);
    if (match?.[1]) return compactText(match[1]);
  }
  const candidates = [
    title.match(/:\s*(.+)$/)?.[1] || "",
    String(task?.doneWhen || task?.minimumOutcome || "").match(/\bfor\s+(.+?)(?:[.?!]|$)/i)?.[1] || "",
    String(task?.sourceNote || "").match(/\bfor\s+(.+?)(?:[.?!]|$)/i)?.[1] || "",
  ];
  for (const candidate of candidates) {
    const cleaned = compactText(candidate)
      .replace(/\band save one learning move$/i, "")
      .replace(/\band save why .*$/i, "")
      .replace(/\b(and|with)\s+one\s+(real\s+)?(person|contact|learning move|resource|role).*$/i, "")
      .replace(/\bfor\s+a\s+reality-check.*$/i, "")
      .replace(/\bfor\s+one\s+(real\s+)?role.*$/i, "")
      .replace(/[.?!]+$/g, "")
      .trim();
    if (cleaned) return cleaned;
  }
  return "this path";
}

function goalCompanyHint(task: Pick<Task, "sourceNote">): string {
  const note = compactText(task?.sourceNote || "");
  const hinted = note.match(/\bat\s+([A-Za-z0-9 ,/&-]+?)(?:\s+[—-]\s+|[.?!]|$)/);
  return compactText(hinted?.[1] || "").replace(/\s*,\s*/g, " or ");
}

function contextListFromCrossEngine(label: string, crossEngineContext?: string, max = 3): string[] {
  if (!crossEngineContext) return [];
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = crossEngineContext.match(new RegExp(`${escaped}\\s*:\\s*([^\\n]+)`));
  if (!match?.[1]) return [];
  return match[1]
    .split(/[;,]/)
    .map((entry) => compactText(entry).replace(/\s*\([^)]*\)\s*$/g, ""))
    .filter(Boolean)
    .slice(0, max);
}

function liveRoleCompanyHintFromContext(crossEngineContext?: string): string {
  const liveRole = firstLiveRoleLabelFromContext(crossEngineContext);
  const match = liveRole.match(/\bat\s+(.+)$/i);
  return compactText(match?.[1] || "");
}

function capabilityGapLabelsFromContext(crossEngineContext?: string): string[] {
  return contextListFromCrossEngine("Capability areas still worth strengthening", crossEngineContext);
}

function likelyLearningGapFromContext(rolePath: string, crossEngineContext?: string, preferredLabel?: string) {
  if (preferredLabel) return likelyLearningGapPlan({ rolePath, label: preferredLabel });
  const gapLabels = capabilityGapLabelsFromContext(crossEngineContext);
  return likelyLearningGapPlan({ rolePath, label: gapLabels[0] || "" });
}

function plannerLearningGapFromNote(sourceNote?: string | null): { label?: string; gapType?: "knowledge" | "skill" | "proof"; roleReference?: string } {
  const note = compactText(sourceNote || "");
  if (!note) return {};
  const explicit = note.match(/\bTreat\s+(.+?)\s+as\s+the\s+likely\s+first\s+(knowledge|skill|proof)\s+gap\b/i)
    || note.match(/\bTreat\s+(.+?)\s+as\s+the\s+likely\s+first\s+gap\s*\((knowledge|skill|proof)\)/i);
  const legacy = note.match(/\bStart\s+with\s+(.+?)\s+as\s+the\s+likely\s+first\s+(?:knowledge\s+|skill\s+|proof\s+)?gap\b/i);
  const label = compactText(explicit?.[1] || legacy?.[1] || "").replace(/[.?!]+$/g, "");
  const rawGapType = String(explicit?.[2] || "").toLowerCase();
  const gapType = rawGapType === "knowledge" || rawGapType === "skill" || rawGapType === "proof" ? rawGapType : undefined;
  const fromRole = note.match(/\bfrom\s+(.+?)(?:[.?!]|,\s*save\b|,\s*confirm\b|,\s*then\b|$)/i)?.[1] || "";
  const useRole = note.match(/\bUse\s+(.+?)\s+as\s+the\s+reference\s+role\b/i)?.[1] || "";
  return {
    label: label || undefined,
    gapType,
    roleReference: compactText(fromRole || useRole || "").replace(/[.?!]+$/g, "") || undefined,
  };
}

function goalNetworkSupportSteps(task: Pick<Task, "title" | "doneWhen" | "minimumOutcome" | "sourceNote">, bundle?: SourceBundle): string[] {
  const label = goalTargetLabel(task);
  const focus = relevantFocusFromContext(bundle?.crossEngineContext) || label;
  const companyHint = goalCompanyHint(task) || liveRoleCompanyHintFromContext(bundle?.crossEngineContext);
  const searchTarget = [label, companyHint].filter(Boolean).join(" at ");
  const liveRole = firstLiveRoleLabelFromContext(bundle?.crossEngineContext);
  return [
    `Open LinkedIn and search for someone already doing ${searchTarget || focus}`,
    liveRole
      ? `Save the person whose path is closest to ${liveRole}`
      : `Save the person whose path is closest to ${focus}`,
    `Write why this person is a credible reality-check for ${label} right now`,
    `Draft a soft ask about how teams hire for ${label}`,
  ];
}

function goalLearningSupportSteps(task: Pick<Task, "title" | "doneWhen" | "minimumOutcome" | "sourceNote">, bundle?: SourceBundle): string[] {
  const label = goalTargetLabel(task);
  const plannedGap = plannerLearningGapFromNote(task.sourceNote);
  const liveRole = plannedGap.roleReference || firstLiveRoleLabelFromContext(bundle?.crossEngineContext);
  const rolePathForGap = plannedGap.label ? liveRole || label : label;
  const likelyGap = likelyLearningGapFromContext(rolePathForGap, bundle?.crossEngineContext, plannedGap.label);
  const gapTypeLabel = plannedGap.gapType ? `${plannedGap.gapType} gap` : likelyGap.gapTypeLabel;
  return [
    liveRole
      ? `Open ${liveRole} and use it as the reference role for ${label}`
      : `Open one live role, saved role note, or JD for ${label}`,
    `Treat ${likelyGap.label} as the likely first ${gapTypeLabel} for ${label}; use the role only to confirm or disprove that diagnosis`,
    `Save one sentence on why ${likelyGap.label} looks like the first ${gapTypeLabel}: what this path asks for and what you cannot yet prove, do, or explain clearly`,
    likelyGap.learningMoveStep
      .replace(/^Use this matching next learning move if that gap holds:\s*/i, "Use this matching next learning move if that gap holds: ")
      .replace(/, then stop once one real role, one repeated requirements pattern, and one next learning move are captured$/i, ""),
  ];
}

function goalCleanupSteps(task: Pick<Task, "title" | "doneWhen" | "minimumOutcome" | "sourceNote">): string[] {
  const label = goalTargetLabel(task);
  return [
    `Open the live task list for ${label === "this path" ? "your active path" : label}`,
    "Keep only the next 3 moves that could change an application, conversation, or proof outcome",
    "Park or later the rest",
    "Save the trimmed list so today has a clear front door",
  ];
}

export function parentWorkflowFor(task: Task | Record<string, any>, bundle: SourceBundle): WorkflowState | undefined {
  if ((task as any).parentId) {
    const parentStepsRaw = (task as any).parentSteps;
    if (parentStepsRaw) {
      try {
        const steps = JSON.parse(parentStepsRaw);
        const last = Array.isArray(steps) ? steps[steps.length - 1] : null;
        if (last?.workflowState) {
          return { ...last.workflowState, inheritedFrom: (task as any).parentTitle || "parent task" };
        }
      } catch {}
    }
  }
  const text = `${task?.title || ""} ${(task as any)?.category || ""} ${(task as any)?.doneWhen || ""} ${(task as any)?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();
  if (bundle.sourceKind === "job") {
    const source = jobSource(bundle);
    const readiness = String(source?.applicationReadiness || "none");
    const status = String(source?.status || "wishlist");
    const truth = source ? computeJobTruthStrip(source) : null;
    const truthAction = truth?.action;
    const currentStage = truthAction === "follow_up" ? "Follow up"
      : truthAction === "prepare" ? "Build materials"
      : truthAction === "warm" ? "Match your experience"
      : truthAction === "reject" ? "Understand the role"
      : status === "applied" ? "Follow up"
      : status === "interviewing" ? "Build materials"
      : readiness === "submitted" ? "Follow up"
      : readiness === "follow_up" ? "Follow up"
      : readiness === "referral" ? "Submit"
      : keyword(text, /cv|cover|answer|question|material|sample|draft|tailor|submit/) || readiness !== "none" ? "Build materials"
      : keyword(text, /gap|eligibility|visa|constraint/) ? "Address gaps"
      : keyword(text, /evidence|story|experience|proof/) ? "Match your experience"
      : "Understand the role";
    const stageOutput = currentStage === "Understand the role" ? "Role requirements and hidden asks are captured"
      : currentStage === "Match your experience" ? "Requirements are matched to credible evidence"
      : currentStage === "Address gaps" ? "Gaps and constraints have mitigation lines"
      : currentStage === "Build materials" ? "The next application material is drafted or improved"
      : currentStage === "Submit" ? "Application is submitted with required materials"
      : "Follow-up action is sent or logged";
    return makeWorkflowState({ workObject: "Artifact", workflow: APPLICATION_WORKFLOW, currentStage, stageOutput, inheritedFrom: `job:${source?.id || (task as any).sourceId || "unknown"}`, confidence: "parent", sourceKind: "job" });
  }
  if (bundle.sourceKind === "learn") {
    const source = learnSource(bundle);
    const workObject: WorkObject = keyword(text, /practice|drill|mock/) ? "Capability" : "Knowledge";
    const currentStage = workObject === "Capability" ? "Practise" : "Find out what's involved";
    const stageOutput = source?.requiredOutput || (workObject === "Capability" ? "You've practised it at least once" : "You know what to focus on and have one useful note");
    return makeWorkflowState({ workObject, workflow: WORKFLOWS[workObject], currentStage, stageOutput, inheritedFrom: `learn:${source?.id || (task as any).sourceId || "unknown"}`, confidence: "parent", sourceKind: "learn" });
  }
  if (bundle.sourceKind === "hustle") {
    const source = hustleSource(bundle);
    const currentStage = source?.coreClaim ? "Gather examples" : "Define your angle";
    const stageOutput = currentStage === "Define your angle" ? "One clear proof claim exists" : "Evidence for the proof claim is selected";
    return makeWorkflowState({ workObject: "Artifact", workflow: PROOF_WORKFLOW, currentStage, stageOutput, inheritedFrom: `hustle:${source?.id || (task as any).sourceId || "unknown"}`, confidence: "parent", sourceKind: "hustle" });
  }
  if (bundle.sourceKind === "contact") {
    const source = contactSource(bundle);
    const status = source?.status || "to_contact";
    const askType = source?.askType || "unspecified";
    const genericPlaceholder = !!source && isGenericContactPlaceholder(source);
    const currentStage = genericPlaceholder && status !== "messaged" && status !== "replied" && status !== "in_conversation"
      ? "Find the right person"
      : keyword(text, /follow.?up|check.?in|reply/) ? "Follow up"
      : keyword(text, /draft|outreach|reach out|message|email/) ? "Draft a message"
      : keyword(text, /prep|prepare|conversation/) ? "Prepare for the conversation"
      : status === "replied" || status === "in_conversation" ? "Prepare for the conversation"
      : status === "messaged" ? "Follow up"
      : askType === "referral" ? "Draft a message"
      : askType === "follow_up" ? "Follow up"
      : "Decide what to ask";
    const stageOutput = currentStage === "Find the right person" ? "One real person is identified and the outreach angle is ready"
      : currentStage === "Decide what to ask" ? "The ask is clear and specific"
      : currentStage === "Draft a message" ? "A personalised outreach draft exists"
      : currentStage === "Follow up" ? "Follow-up action is sent or logged"
      : currentStage === "Prepare for the conversation" ? "Conversation prep notes are ready"
      : "The next relationship action is chosen";
    return makeWorkflowState({ workObject: "Artifact", workflow: CONTACT_WORKFLOW, currentStage, stageOutput, inheritedFrom: `contact:${source?.id || (task as any).sourceId || "unknown"}`, confidence: "parent", sourceKind: "contact" });
  }
  if (bundle.sourceKind === "goal") {
    const mode = goalTaskMode(task as Task);
    if (mode === "network_support") {
      return makeWorkflowState({
        workObject: "Pipeline",
        workflow: CONTACT_WORKFLOW,
        currentStage: "Find the right person",
        stageOutput: "One real person is identified with a credible ask",
        inheritedFrom: `goal:${(task as any).sourceId || "parallel-pursuit-network"}`,
        confidence: "parent",
        sourceKind: "goal",
      });
    }
    if (mode === "learning_support") {
      return makeWorkflowState({
        workObject: "Knowledge",
        workflow: WORKFLOWS.Knowledge,
        currentStage: "Focus on what matters",
        stageOutput: "One missing requirement and one smallest prep move are saved",
        inheritedFrom: `goal:${(task as any).sourceId || "parallel-pursuit-learning"}`,
        confidence: "parent",
        sourceKind: "goal",
      });
    }
    if (mode === "cleanup") {
      return makeWorkflowState({
        workObject: "Pipeline",
        workflow: WORKFLOWS.Pipeline,
        currentStage: "Review what's working",
        stageOutput: "Only the next three live moves remain",
        inheritedFrom: `goal:${(task as any).sourceId || "parallel-pursuit-cleanup"}`,
        confidence: "parent",
        sourceKind: "goal",
      });
    }
    const currentStage = keyword(text, /still-empty combination|still-empty lane|credible role|plausible lane|fill the lane/) ? "Build a list"
      : keyword(text, /saved role|application move|live role|pipeline action/) ? "Work through the next batch"
      : keyword(text, /lane|pipeline/) ? "Build a list"
      : "Define your target";
    const stageOutput = currentStage === "Define your target"
      ? "The next role type to fill is chosen"
      : currentStage === "Build a list"
        ? "One credible role exists for at least one role type still missing one"
        : "One concrete pipeline action has been taken on a saved role";
    return makeWorkflowState({
      workObject: "Pipeline",
      workflow: WORKFLOWS.Pipeline,
      currentStage,
      stageOutput,
      inheritedFrom: `goal:${(task as any).sourceId || "parallel-pursuit"}`,
      confidence: "parent",
      sourceKind: "goal",
    });
  }
  return undefined;
}

export async function normalizeExistingTaskBreakdown(task: Task) {
  const repairedTaskShape = await normalizeExistingTaskShape(task);
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
  if (!parsed.length) {
    if (!repairedTaskShape.changed) return { changed: false as const };
    return {
      changed: true as const,
      title: repairedTaskShape.title,
      doneWhen: repairedTaskShape.doneWhen,
      minimumOutcome: repairedTaskShape.minimumOutcome,
      steps: raw,
    };
  }

  const bundle = await buildSourceContext(task);
  const fallback = fallbackStagePlan(task, bundle);
  const repaired = attachWorkflowState(
    coerceTaskBreakdownSteps(task, bundle, fallback.workflowState, parsed),
    fallback.workflowState,
  );
  const steps = JSON.stringify(repaired);
  const nextTitle = repairedTaskShape.title;
  const nextDoneWhen = repairedTaskShape.doneWhen;
  const nextMinimumOutcome = repairedTaskShape.minimumOutcome || fallback.workflowState.stageOutput || task.minimumOutcome;
  if (
    steps === raw
    && nextTitle === task.title
    && nextDoneWhen === String(task.doneWhen || "")
    && nextMinimumOutcome === String(task.minimumOutcome || "")
  ) {
    return { changed: false as const };
  }
  return {
    changed: true as const,
    steps,
    title: nextTitle,
    doneWhen: nextDoneWhen,
    minimumOutcome: nextMinimumOutcome,
  };
}

async function normalizeExistingTaskShape(task: Task) {
  let title = String(task.title || "");
  let doneWhen = String(task.doneWhen || "");
  let minimumOutcome = String(task.minimumOutcome || "");

  if (task.sourceType === "contact" && task.sourceId) {
    const contact = (await storage.getContacts()).find((entry) => entry.id === task.sourceId);
    if (contact && shouldRepairLegacyContactTask(task, contact)) {
      const repairedTitle = nextContactTaskTitle(contact);
      const intent = contractForTaskIntent({
        title: repairedTitle,
        sourceType: "contact",
        sourceNote: `${task.sourceNote || ""} ${contact.why || contact.note || ""} ${contact.targetOrg || ""} ${contact.targetRole || ""}`,
      });
      title = repairedTitle;
      doneWhen = intent.doneWhen || doneWhen;
      minimumOutcome = intent.doneWhen || minimumOutcome;
    }
  }

  return {
    changed: title !== String(task.title || "")
      || doneWhen !== String(task.doneWhen || "")
      || minimumOutcome !== String(task.minimumOutcome || ""),
    title,
    doneWhen,
    minimumOutcome,
  };
}

function shouldRepairLegacyContactTask(task: Task, contact: Contact) {
  if (!isGenericContactPlaceholder(contact)) return false;
  const title = compactText(task.title).toLowerCase();
  if (!title) return false;
  if (title === nextContactTaskTitle(contact).toLowerCase()) return false;
  if (/^draft\b.*\b(outreach|message|chat ask|follow-up|follow up|reconnect|referral)\b/.test(title)) return true;
  if (/^(reach out to|message|email|reply to|follow up with|follow-up with)\b/.test(title)) return true;
  const rawWho = normalizeContactWho(contact.who).toLowerCase();
  return !!rawWho && title.includes(rawWho) && /\b(draft|outreach|message|chat|reach out)\b/.test(title);
}

export function attachWorkflowState(steps: BreakdownStep[], workflowState?: WorkflowState): BreakdownStep[] {
  if (!workflowState || !steps.length) return steps;
  return steps.map((s, i) => i === steps.length - 1 ? { ...s, workflowState } : s);
}

function looksMetaStep(text: string) {
  return /^(use the|locate the|define this stage output|check completion criteria|break this stage into actions|execute until|identify the stage|review the workflow)/i.test(text.trim());
}

function looksActionable(text: string) {
  return /^(open|write|draft|list|choose|mark|highlight|copy|paste|find|search|send|ask|save|start|set|create|name|pick|read|scan|skim|note|pull|collect|gather|match|rewrite|outline|reply|message|email|book|review|map|flag|compare|decide|record|log|extract|inspect)\b/i.test(text.trim());
}

function looksUnstartablePlaceholder(text: string) {
  const t = text.trim();
  if (/^(get ready|think about|organize (your )?thoughts|do (some )?research|prepare yourself|gather (your )?thoughts|brainstorm|consider|reflect on|take (some )?time|plan (your )?approach|make a plan|set (up )?a plan|familiarize|orient yourself|explore the landscape|understand the context|assess the situation|identify key|determine the best|evaluate your|establish a)\b/i.test(t)) return true;
  if (/^(review your (notes|progress|goals|strategy)|ensure you have|make sure you|verify that|confirm your|revisit your)\b/i.test(t)) return true;
  return false;
}

function laneSpecificSearchMove(text: string): string | undefined {
  if (keyword(text, /still-empty combination|still-empty lane/)) return "Open Jobs and find one real role for the first role type still missing one";
  if (keyword(text, /credible role|plausible lane/)) return "Open Jobs and save the first real role you find";
  if (keyword(text, /fill the lane|pipeline action/)) return "Open the most promising saved role and take one pipeline action";
  return undefined;
}

function isRoleMarketScanTask(task: Task, bundle: SourceBundle): boolean {
  return isRoleMarketScanInput({
    title: task?.title,
    category: task?.category,
    sourceType: task?.sourceType,
    sourceKind: bundle.sourceKind,
    sourceNote: `${task?.sourceNote || ""} ${bundle.sourceContext || ""}`,
    doneWhen: task?.doneWhen,
    minimumOutcome: task?.minimumOutcome,
  });
}

function roleMarketScanSteps(task: Task, bundle: SourceBundle): string[] {
  const rolePath = roleMarketScanLabel(task.title || "");
  const likelyGap = likelyLearningGapFromContext(rolePath, bundle?.crossEngineContext);
  return [
    `Open LinkedIn or the target job board and search "${rolePath}"`,
    "Save the first real posting that matches the path closely enough to learn from",
    "Extract the 3 repeated requirements or background signals from that posting",
    likelyGap.assessmentStep,
    likelyGap.learningMoveStep,
  ];
}

function taskIntentContract(task: Task, bundle: SourceBundle) {
  return contractForTaskIntent({
    title: task?.title,
    category: task?.category,
    sourceType: task?.sourceType,
    sourceKind: bundle.sourceKind,
    sourceNote: `${task?.sourceNote || ""} ${bundle.sourceContext || ""}`,
    doneWhen: task?.doneWhen,
    minimumOutcome: task?.minimumOutcome,
    blockerReason: task?.blockerReason,
  });
}

function shouldUsePlainTaskIntent(task: Task, bundle: SourceBundle): boolean {
  const contract = taskIntentContract(task, bundle);
  return bundle.sourceKind === "task" && contract.intent !== "admin_action";
}

function tinyStarterStep(task: Task, bundle: SourceBundle, workflowState?: WorkflowState) {
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();
  const intentContract = taskIntentContract(task, bundle);
  if (isRoleMarketScanTask(task, bundle)) {
    return roleMarketScanSteps(task, bundle)[0];
  }
  if (shouldUsePlainTaskIntent(task, bundle)) {
    return intentContract.firstStep;
  }
  if (bundle.sourceKind === "goal") {
    const mode = goalTaskMode(task);
    if (mode === "network_support") return goalNetworkSupportSteps(task, bundle)[0];
    if (mode === "learning_support") return goalLearningSupportSteps(task, bundle)[0];
    if (mode === "cleanup") return goalCleanupSteps(task)[0];
    if (workflowState?.currentStage === "Define your target") return "Open Jobs and look at the first role type still missing a real role";
    if (workflowState?.currentStage === "Build a list") return laneSpecificSearchMove(text) || "Open Jobs and save the first credible role for one role type still missing one";
    if (workflowState?.currentStage === "Work through the next batch") return "Open the saved role and take the next concrete pipeline action";
    return laneSpecificSearchMove(text) || "Open Jobs and save the first credible role for one role type still missing one";
  }
  if (bundle.sourceKind === "job") {
    if (workflowState?.currentStage === "Understand the role") return "Open the role posting and highlight the first must-have requirement";
    if (workflowState?.currentStage === "Match your experience") return "Open a blank note and list the top 3 role requirements";
    if (workflowState?.currentStage === "Address gaps") return "Write down the single biggest gap in one sentence";
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
    if (workflowState?.currentStage === "Gather examples") return "Open a note and paste the 3 strongest proof points";
    return "Open a blank draft and write the one claim this piece should make";
  }
  if (bundle.sourceKind === "contact" && workflowState?.currentStage === "Find the right person") {
    return `Open LinkedIn and search for ${contactSearchQuery(contactSource(bundle), bundle)}`;
  }
  if (workflowState?.workObject === "Decision") return "Open a note and write the decision question in one line";
  if (workflowState?.workObject === "Problem") return "Write one sentence describing what is not working";
  if (workflowState?.workObject === "Knowledge") return task.sourceUrl ? "Open the source and read only the first relevant section" : "Open a note and list the first thing you need to understand";
  if (workflowState?.workObject === "Capability") return "Open a blank note and do one small practice attempt";
  return deterministicUnstickStep(task);
}

function compactText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function contactFallbackName(contact: Contact | null, bundle: SourceBundle): string {
  return compactText(contact?.name) || normalizeContactWho(String(contact?.who || "")) || compactText(bundle.contactName) || "the contact";
}

function genericContactLabel(contact: Contact | null, bundle: SourceBundle): string {
  return contactFallbackName(contact, bundle).replace(/^(a|an)\s+/i, "").trim() || "relevant contact";
}

function contactOpportunityLabel(contact: Contact | null): string {
  const org = compactText((contact as any)?.targetOrg);
  const role = contact ? contactTopicHint(contact) : "";
  return [role, org].filter(Boolean).join(" at ") || "the opportunity";
}

function contactOutreachAngle(contact: Contact | null, orgRole: string): string {
  const why = compactText((contact as any)?.why);
  if (why) return `Draft around this angle: ${why}`;
  const network = compactText((contact as any)?.sourceNetwork);
  if (network) return `Draft around this angle: your ${network} connection makes a short, specific ask credible`;
  return `Draft around this angle: you are exploring ${orgRole} and want one practical steer`;
}

function contactAskLine(task: Task, contact: Contact | null, orgRole: string): string {
  const askType = compactText((contact as any)?.askType).toLowerCase();
  const title = compactText(task.title).toLowerCase();
  if (/15|fifteen|chat|coffee/.test(title)) return `Ask for a 15-minute chat or quick steer on ${orgRole}`;
  if (askType === "referral") return `Ask whether they can suggest the right person or referral path for ${orgRole}`;
  if (askType === "follow_up") return `Ask for the clearest next steer on ${orgRole}`;
  if (askType === "reconnect") return `Ask for a low-pressure catch-up and one current steer on ${orgRole}`;
  return `Ask for quick advice on ${orgRole}`;
}

function contactNeedsIdentification(contact: Contact | null) {
  return !!contact && isGenericContactPlaceholder(contact);
}

function contactSearchQuery(contact: Contact | null, bundle: SourceBundle) {
  const label = genericContactLabel(contact, bundle);
  const targetOrg = compactText((contact as any)?.targetOrg);
  const targetRole = compactText((contact as any)?.targetRole);
  return [label, targetRole, targetOrg]
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index)
    .join(" ");
}

function stageActions(task: Task, bundle: SourceBundle, workflowState: WorkflowState): string[] {
  const object = workflowState.workObject;
  const currentStage = workflowState.currentStage;
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();

  const intentContract = taskIntentContract(task, bundle);
  if (isRoleMarketScanTask(task, bundle)) {
    return roleMarketScanSteps(task, bundle);
  }
  if (shouldUsePlainTaskIntent(task, bundle)) {
    return intentContract.steps;
  }

  if (bundle.sourceKind === "goal") {
    const mode = goalTaskMode(task);
    if (mode === "network_support") return goalNetworkSupportSteps(task, bundle);
    if (mode === "learning_support") return goalLearningSupportSteps(task, bundle);
    if (mode === "cleanup") return goalCleanupSteps(task);
  }

  if (bundle.sourceKind === "goal" || (object === "Pipeline" && keyword(text, /lane|role|pipeline|application/))) {
    const laneSpecific = laneSpecificSearchMove(text);
    if (currentStage === "Define your target") return [
      "Open Jobs and look at the first role type still missing a real role",
      "Name the role type you are filling first",
      "Define what counts as a credible role for that type",
      "Save it and move to role search",
    ];
    if (currentStage === "Build a list") return [
      laneSpecific || "Open Jobs and save the first credible role for one role type still missing one",
      "Record the company and role title",
      "Mark whether it needs apply, warm path, or clarify",
      "Repeat for the next role type only if there is still energy",
    ];
    return [
      "Open the saved role and take the next concrete pipeline action",
      "Draft the message, application, or clarification note",
      "Save or send that move",
      "Log which role type still needs a real role next",
    ];
  }

  if (bundle.sourceKind === "job" && object === "Artifact") {
    const jobSource = bundle.source as Job | null;
    const brief = jobSource ? parseCompanyBrief(jobSource.companyBrief || "") : null;
    const company = jobSource?.company || "the company";

    if (currentStage === "Understand the role") {
      const steps = [
        "Open the role posting and highlight the first must-have requirement",
        "List the top 3 must-have requirements",
      ];
      if (brief?.relevantTeam) {
        steps.push(`Note: this sits in ${brief.relevantTeam} - check how that shapes the requirements`);
      } else {
        steps.push("List the top 2 nice-to-have signals");
      }
      steps.push("Write one sentence on what this role is really asking for");
      return steps;
    }
    if (currentStage === "Match your experience") {
      const steps = [
        "Open a blank note and list the top 3 role requirements",
        "Match one concrete example to the first requirement",
        "Match one concrete example to the second requirement",
      ];
      if (brief?.whyYouFit) {
        steps.push(`Use this fit insight: ${brief.whyYouFit}`);
      } else {
        steps.push("Mark the weakest proof gap");
      }
      return steps;
    }
    if (currentStage === "Address gaps") return [
      "Write down the single biggest gap in one sentence",
      "Choose whether to explain, reframe, or offset it",
      "Draft one mitigation line",
      "Save that line in your role notes",
    ];
    if (currentStage === "Build materials") {
      if (keyword(text, /cv|resume|tailor|rewrite/)) {
        const steps = [
          "Open your CV and the role posting side by side",
          "Highlight repeated role keywords",
          "Rewrite the first matching bullet",
        ];
        if (brief?.landscape?.competitors?.length) {
          steps.push(`Position against ${brief.landscape.competitors.slice(0, 2).join(" and ")} - use their language where it fits`);
        } else {
          steps.push("Save the next bullet to update later");
        }
        return steps;
      }
      const steps = [
        "Open the application material and draft the first useful line",
      ];
      if (brief?.prepAngle) {
        steps.push(`Use this angle: ${brief.prepAngle}`);
      } else {
        steps.push("Answer the first prompt in rough notes");
      }
      steps.push("Tighten one sentence so it sounds credible");
      steps.push("Save the next missing section");
      return steps;
    }
    return [
      "Open the application thread and find the next follow-up action",
      "Write the shortest acceptable follow-up",
      "Send it or save it ready to send",
      "Log the follow-up date",
    ];
  }

  if (bundle.sourceKind === "contact") {
    const c = contactSource(bundle);
    const name = contactFallbackName(c, bundle);
    const orgRole = contactOpportunityLabel(c);
    const angle = contactOutreachAngle(c, orgRole);
    const ask = contactAskLine(task, c, orgRole);
    const lastMessage = compactText((c as any)?.lastMessage);
    if (currentStage === "Find the right person") return [
      `Open LinkedIn and search for ${contactSearchQuery(c, bundle)}`,
      `Save one real person who fits ${genericContactLabel(c, bundle)}`,
      orgRole !== "the opportunity" ? `Write why this person is a credible ask for ${orgRole}` : "Write why this person is a credible ask right now",
      ask,
      "Draft the message only if this person looks worth contacting",
    ];
    if (currentStage === "Decide what to ask") return [
      `Open ${name}'s contact card`,
      angle,
      ask,
      `Save the ask in the contact notes`,
    ];
    if (currentStage === "Draft a message") return [
      `Open a draft message to ${name}`,
      angle,
      ask,
      `Keep it under 4 sentences - mention why you're reaching out and what you'd value`,
      `Save or send the draft`,
    ];
    if (currentStage === "Follow up") return [
      lastMessage ? `Open the last exchange with ${name}: ${lastMessage}` : `Open ${name}'s contact card and check the last exchange`,
      angle,
      ask,
      `Save or send the draft`,
    ];
    if (currentStage === "Prepare for the conversation") return [
      `Review ${name}'s background and the ${orgRole} context`,
      `Write 2-3 specific questions to ask ${name}`,
      `Note one thing you can offer or share in return`,
      `Save conversation prep notes`,
    ];
    return [
      `Open ${name}'s contact card`,
      angle,
      ask,
      `Save the next follow-up date`,
    ];
  }

  if (object === "Pipeline") {
    return currentStage === "Define your target" ? [
      "Write down the exact role type you are targeting",
      "List 3 live targets for that type",
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
      task.sourceUrl ? "Open the source and read only the first relevant section" : `Search for or open the most relevant resource on "${task.title.slice(0, 60)}"`,
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

  if (/strategy_builder|career_track|marketability/i.test(task.sourceType || "")) {
    const roleSlice = task.title.replace(/^(save|find|review|explore|research|identify)\s+(one|two|three|a|an|the)?\s*(real\s+)?/i, "").replace(/\s+(role|roles)\b.*$/i, "").slice(0, 60).trim();
    const gap = task.sourceNote?.replace(/^(From Strategy Builder|Credibility gap:\s*)/i, "").trim();
    return [
      `Open LinkedIn or Indeed and search for "${roleSlice}" roles`,
      "Save one posting that looks like a real match",
      gap ? `Check the requirements against your gap: ${gap.slice(0, 80)}` : "List the top 3 requirements and mark which ones you can already back up",
      "Note the single biggest gap you'd need to close to be credible",
    ];
  }

  return [
    `Open "${task.title.slice(0, 50).trim()}" and find the first thing to act on`,
    "Write down what the end result should look like",
    "Do the smallest piece that moves it forward",
    "Save what you produced",
  ];
}

function dedupeTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  return texts.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function coerceTaskBreakdownSteps(task: Task, bundle: SourceBundle, workflowState: WorkflowState, rawSteps: BreakdownStep[]): BreakdownStep[] {
  const flattened = rawSteps.flatMap((step) => {
    if (step.substeps?.length) return step.substeps;
    return [step.text];
  });
  const hadMeta = flattened.some((text) => looksMetaStep(text));
  const stripped = dedupeTexts((flattened.length ? flattened : stageActions(task, bundle, workflowState)).filter((text) => !looksMetaStep(text) && !looksUnstartablePlaceholder(text)));
  const fallbackActions = stageActions(task, bundle, workflowState);
  const baseActions = isRoleMarketScanTask(task, bundle) && !hasRoleMarketScanContract(stripped)
    ? fallbackActions
    : stripped.length ? stripped : fallbackActions;
  const starter = tinyStarterStep(task, bundle, workflowState);
  const first = baseActions[0] || "";
  const ordered = dedupeTexts(
    hadMeta || !first || !looksActionable(first)
      ? [starter, ...baseActions]
      : baseActions,
  );
  const maxSteps = isRoleMarketScanTask(task, bundle)
    || (bundle.sourceKind === "contact" && workflowState?.currentStage === "Find the right person")
    ? 5
    : 4;
  return ordered.slice(0, maxSteps).map((text) => ({ text, done: false as const }));
}

function fallbackStagePlan(task: Task, bundle: SourceBundle): { workflowState: WorkflowState; steps: BreakdownStep[] } {
  const inherited = bundle.parentWorkflow;
  const object = (inherited?.workObject as WorkObject) || classifyWorkObject(task, bundle);
  const workflow = inherited?.workflow
    || (bundle.sourceKind === "job" ? APPLICATION_WORKFLOW
      : bundle.sourceKind === "contact" ? CONTACT_WORKFLOW
      : bundle.sourceKind === "hustle" ? PROOF_WORKFLOW
      : WORKFLOWS[object] || WORKFLOWS.Artifact);
  const currentStage = inherited?.currentStage || workflow[0];
  const stageOutput = inherited?.stageOutput || task?.doneWhen || task?.minimumOutcome || "Something visible has changed";
  const workflowState = inherited || makeWorkflowState({ workObject: object, workflow, currentStage, stageOutput, confidence: "fallback", sourceKind: bundle.sourceKind });
  const steps = coerceTaskBreakdownSteps(task, bundle, workflowState, stageActions(task, bundle, workflowState).map((text) => ({ text, done: false as const })));
  return { workflowState, steps };
}

function meaningfulTaskContextText(note: unknown): string {
  const text = String(note || "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 8) return "";
  if (/^task(ed)?$/i.test(text)) return "";
  return text;
}

function contactDisplayName(c: Contact): string {
  return [compactText(c.name) || normalizeContactWho(c.who), (c as any).linkedinUrl ? `(${(c as any).linkedinUrl})` : ""].filter(Boolean).join(" ").trim() || "Unknown contact";
}

function relevantFocusFromContext(crossEngineContext?: string): string {
  if (!crossEngineContext) return "";
  const match = crossEngineContext.match(/Relevant career focus:\s*([^.]+)/);
  return match?.[1]?.trim() || "";
}

function firstLiveRoleLabelFromContext(crossEngineContext?: string): string {
  if (!crossEngineContext) return "";
  const match = crossEngineContext.match(/Live roles nearby:\s*([^.]+)/);
  const first = match?.[1]?.split(";")[0]?.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  return first || "";
}

function globalBreakdownQualityGuidance(): string {
  return (
    `Quality bar for every breakdown:\n` +
    `- The first step must be immediately startable and produce a visible result.\n` +
    `- Use available context to create specific actions, not advice or a restatement of the context.\n` +
    `- A useful step names three things: the object to open or edit, the action to take, and the output that will exist afterwards.\n` +
    `- Product test: after each step, one visible object should be different: a saved role, highlighted JD, drafted paragraph, chosen gap, sent message, or logged decision.\n` +
    `- Research, review, reading, and summarising are valid only when the step names what to look for and what decision, draft, list, or note it should produce.\n` +
    `- Each step must describe ONE concrete action with a clear result.\n` +
    `- Steps must use real content from context above - names, deadlines, existing drafts, capabilities.\n` +
    `- The final step must produce or verify the stage output defined in the workflow.\n` +
    `- Maximum 5 steps. If fewer suffice, use fewer.\n` +
    `- If a step mostly asks the user to think, convert it into a visible move: write the decision question, mark the strongest option, draft the paragraph, or choose the next action.\n` +
    `- Use this check before returning: could the user start this step in under 30 seconds, and would they know when it is done?`
  );
}

function isOutreachOrMessageTask(task: Task, bundle: SourceBundle) {
  if (bundle.sourceKind !== "contact") return false;
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext || ""}`.toLowerCase();
  return /\b(outreach|follow.?up|message|draft|email|reply|thank|coffee chat|intro|referral|reach out)\b/.test(text)
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

function taskSpecificPromptGuidance(task: Task, bundle: SourceBundle): string {
  const goalMode = bundle.sourceKind === "goal" ? goalTaskMode(task) : null;
  if (goalMode === "network_support") {
    const liveRole = firstLiveRoleLabelFromContext(bundle.crossEngineContext);
    return (
      `For goal-backed contact support:\n` +
      `- This is not generic networking and not a blank search. Pre-structure the move around one likely person archetype, one reason they matter now, and one smallest credible ask.\n` +
      `- Do not tell the user to figure out who to contact from scratch if the target path is already known.\n` +
      `${liveRole ? `- Use ${liveRole} as the closest live reference point when choosing who counts as the right person.\n` : ""}` +
      `- Make the first step identify the most relevant person type or company path, not "find someone in the field".\n` +
      `- End with a saved why-them line and a draftable soft ask, not open-ended networking homework.\n`
    );
  }
  if (goalMode === "learning_support") {
    const liveRole = firstLiveRoleLabelFromContext(bundle.crossEngineContext);
    const gapLabels = capabilityGapLabelsFromContext(bundle.crossEngineContext);
    const plannedGap = plannerLearningGapFromNote(task.sourceNote);
    return (
      `For goal-backed learning support:\n` +
      `- Do the assessment for the user. Do not ask them to invent the gap from scratch; infer the most likely first gap from the role/path context already provided.\n` +
      `${plannedGap.label ? `- The goal note already names the likely gap: ${plannedGap.label}${plannedGap.gapType ? ` (${plannedGap.gapType} gap)` : ""}. Preserve that diagnosis unless the provided role context clearly contradicts it.\n` : ""}` +
      `${plannedGap.roleReference ? `- Start from ${plannedGap.roleReference} as the reference role.\n` : liveRole ? `- Start from ${liveRole} as the reference role.\n` : `- Start from one real role, JD, or saved role note for the target path.\n`}` +
      `${gapLabels.length ? `- If the context suggests likely weak spots, name them directly: ${gapLabels.join(", ")}.\n` : ""}` +
      `- State the likely gap, why it is likely, and the matching learn/practice/proof move. The user should mostly confirm that diagnosis, not discover it from scratch.\n` +
      `- Name the likely first gap and the matching learning move directly in the steps instead of asking the user to choose both.\n` +
      `- Tell the user what to learn, practice, or draft next if that likely gap holds.\n` +
      `- Distinguish between a knowledge gap, a skill gap, and a proof/evidence gap, then choose the matching next move.\n` +
      `- Prefer the smallest move that could make the path more credible this week: a targeted resource, a short drill, or one proof example.\n` +
      `- If the move involves learning or review, name the target concept, the source or role evidence to inspect, and the output to save.\n`
    );
  }
  if (isRoleMarketScanTask(task, bundle)) {
    const gapLabels = capabilityGapLabelsFromContext(bundle.crossEngineContext);
    return (
      `For role exploration and market-scan work:\n` +
      `- The point is not just to collect roles. Use the first credible posting to infer what this path is actually asking for.\n` +
      `- Do the assessment for the user. After extracting the repeated requirements, suggest the likely first requirement they cannot clearly evidence today instead of asking them to invent the gap from scratch.\n` +
      `${gapLabels.length ? `- If the connected context already suggests likely weak spots, start with them directly: ${gapLabels.join(", ")}.\n` : ""}` +
      `- State the likely gap, why it is likely, and the matching learn/practice/proof move. The user should mostly confirm that diagnosis, not invent it.\n` +
      `- Name the likely first gap and the matching learning move directly in the steps instead of asking the user to pick what to learn.\n` +
      `- Distinguish whether that likely gap is mainly knowledge, skill, or proof/evidence, then recommend the matching next learning move.\n` +
      `- Phrase uncertain diagnoses cautiously as a likely first gap or a requirement to verify, not as a certainty.\n` +
      `- If the move involves research or summarising, name the exact evidence to extract and the output it should produce.\n`
    );
  }
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
    const genericContact = bundle.sourceKind === "contact" && contactNeedsIdentification(contactSource(bundle));
    return (
      `For outreach, follow-up, or message work:\n` +
      `- Anchor remains the planner; your job is to personalize the move using only the facts provided.\n` +
      `- Do not tell the user to review notes, research the person, or figure out why they are reaching out if a reason, target, prior thread, or relationship signal already exists.\n` +
      `- Convert available context into a suggested outreach angle, a smallest credible ask, and a clear stop condition.\n` +
      (genericContact ? `- If the "contact" is only an archetype and no real person is identified yet, first identify one plausible real person before drafting outreach.\n` : "") +
      `- If current public information about the person, team, or organization is already provided, use at most 1-2 relevant signals to sharpen why now, the angle, or the ask.\n` +
      `- Do not turn the task into open-ended research. Use public evidence only when it materially improves relevance for this specific message.\n` +
      `- For simple follow-ups, thank-yous, or status updates, keep public research silent unless a current fact clearly changes what should be sent.\n` +
      `- If a prior exchange, draft, or warm relationship exists, continue from it instead of starting cold.\n` +
      `- If context is weak, stay honest, keep the ask soft, and do not invent shared history or certainty.\n` +
      `- Steps should reduce thinking load and move toward a sendable message in 3-5 concrete actions.\n`
    );
  }

  const lines: string[] = [];
  const sourceKind = bundle.sourceKind;

  if (sourceKind === "job") {
    const j = bundle.source as Job | null;
    const readiness = j?.applicationReadiness || "none";
    const status = j?.status || "wishlist";
    const stage = readiness === "none" ? "Understand the role"
      : readiness === "cv" ? "Match your experience"
      : readiness === "cover" ? "Address gaps"
      : readiness === "questions" ? "Build materials"
      : readiness === "sample" ? "Build materials"
      : readiness === "referral" ? "Address gaps"
      : readiness === "submitted" ? "Follow up"
      : readiness === "follow_up" ? "Follow up"
      : "Understand the role";
    lines.push(`APPLICATION WORKFLOW GUIDANCE:`);
    lines.push(`Current readiness stage: ${stage} (readiness=${readiness}, status=${status}).`);
    lines.push(`Use the APPLICATION_WORKFLOW: ${APPLICATION_WORKFLOW.join(" -> ")}.`);
    lines.push(`Do NOT recommend submitting or changing status. Focus on the current stage output only.`);
    if (j?.deadline) {
      const deadlineDays = deadlineDaysFromNow(j.deadline);
      if (deadlineDays !== null && deadlineDays <= 3) {
        lines.push(`DEADLINE URGENCY: This role closes in ${deadlineDays <= 0 ? "TODAY or already overdue" : deadlineDays === 1 ? "1 day" : `${deadlineDays} days`}. Every step must move toward a submittable application. Cut anything exploratory - no "research the company culture" or "reflect on fit". Focus on producing the next required material. If the CV is ready, draft the cover letter. If materials are ready, submit.`);
      }
    }
    if (j?.narrativeAngle) lines.push(`Narrative angle to use: ${j.narrativeAngle}.`);
    if (j?.roleArchetype) lines.push(`Role archetype: ${j.roleArchetype} - align step framing to this archetype.`);
  }

  if (sourceKind === "learn") {
    const l = bundle.source as Learn | null;
    lines.push(`LEARNING WORKFLOW GUIDANCE:`);
    if (l?.requiredOutput) lines.push(`Required output: ${l.requiredOutput}.`);
    if (l?.capabilityBuilt) lines.push(`Capability being built: ${l.capabilityBuilt}.`);
    if (l?.outputStatus) lines.push(`Current output status: ${l.outputStatus}.`);
    lines.push(`Steps must produce a tangible output or checkpoint - not just 'read the material'.`);
  }

  if (sourceKind === "hustle") {
    lines.push(`PROOF ASSET WORKFLOW GUIDANCE:`);
    lines.push(`Use the PROOF_WORKFLOW: ${PROOF_WORKFLOW.join(" -> ")}.`);
    lines.push(`Each step must move the proof asset one stage forward. The output must be saveable.`);
  }

  if (!lines.length && /strategy_builder|career_track|marketability/i.test(task.sourceType || "")) {
    lines.push(`STRATEGY / ROLE EXPLORATION GUIDANCE:`);
    lines.push(`The user is deciding whether a role type is real and reachable - not just browsing.`);
    lines.push(`Step 1: search a real platform (LinkedIn, Indeed) for the specific role type.`);
    lines.push(`Step 2: save one real posting.`);
    lines.push(`Step 3: compare its requirements to the user's background - what can they already prove, what's the gap?`);
    lines.push(`Step 4: decide the single biggest gap to close or person to contact next.`);
    lines.push(`Do NOT produce generic "note requirements" or "write a summary" steps. Every step must move toward a decision: pursue, park, or close a specific gap.`);
    if (task.sourceNote && !/^From Strategy Builder$/i.test(task.sourceNote)) {
      lines.push(`Context from strategy: ${task.sourceNote}`);
    }
  }

  return lines.join("\n");
}

function providerEvidencePromptGuidance(contextBlocks?: {
  userAuthored?: ContextBlock[];
  externalResearch?: ContextBlock[];
}): string {
  const hasEvidence = !!(contextBlocks?.userAuthored?.length || contextBlocks?.externalResearch?.length);
  if (!hasEvidence) return "";
  const lines: string[] = ["CONTEXT EVIDENCE RULES:"];
  if (contextBlocks?.userAuthored?.length) {
    lines.push("- User-authored context above has highest priority. Use it directly in step text.");
  }
  if (contextBlocks?.externalResearch?.length) {
    lines.push("- External research is supporting only - use it to sharpen public facts.");
    lines.push("- Do not cite source IDs or mention provider mechanics in step text.");
  }
  return lines.join("\n");
}

function sparseContextPromptGuidance(
  task: Task,
  bundle: SourceBundle,
  contextBlocks?: {
    userAuthored?: ContextBlock[];
    externalResearch?: ContextBlock[];
  },
): string {
  const hasProviderEvidence = !!(contextBlocks?.userAuthored?.length || contextBlocks?.externalResearch?.length);
  const hasSourceContext = !!(bundle.sourceContext && bundle.sourceContext.length > 20);
  const hasCvOrJd = !!(bundle.cvText || bundle.jdText);

  if (hasProviderEvidence || hasSourceContext || hasCvOrJd) return "";

  const lines = ["SPARSE CONTEXT - the task has minimal context. Use these rules:"];
  if (bundle.sourceKind === "job") {
    lines.push("- Ask what stage of the application the user is at (no CV? no JD? no draft?).");
    lines.push("- Do not invent role requirements. Steps must be generic but actionable.");
  } else if (bundle.sourceKind === "learn") {
    lines.push("- Ask what the user wants to be able to DO after this - not just 'understand it'.");
    lines.push("- Steps must still produce something: a note, a practice rep, a saved output.");
  } else {
    lines.push("- Use the task title alone. Steps must still produce a concrete result.");
    lines.push("- If the task is truly ambiguous, ask ONE short clarifying question instead of guessing.");
  }
  return lines.join("\n");
}

function resolveTrackId(task: Task, source: SourceRecord): number | null {
  if (task.relatedTrackId) return task.relatedTrackId;
  if (source && "relatedTrackId" in source) return (source as any).relatedTrackId ?? null;
  if (source && "proofAssetForTrack" in source) return (source as any).proofAssetForTrack ?? null;
  return null;
}

// Returns the track ID when the entity is linked to one, or null if not.
// Used to decide whether to load full cross-engine data (track-scoped) vs
// sourceKind-only data (unlinked entities).
function hasTrackLink(task: Task, source: SourceRecord): boolean {
  return resolveTrackId(task, source) != null;
}

function formatDeadlineLabel(deadline: string) {
  const raw = String(deadline || "").trim();
  if (!raw) return "";
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function deadlineDaysFromNow(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T23:59:59");
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
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
  // Always load entity data for the source kind so unlinked entities (no relatedTrackId)
  // still get contacts-for-job, jobs-for-contact, and learn-for-source context.
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

  // When no track is linked, surface any warm contacts at the same company (job tasks)
  // or any contacts linked to the same org (contact tasks) even without a track filter.
  if (!needsTrackContext && sourceKind === "job" && source) {
    const job = source as any;
    const sameCompanyContacts = contacts.filter(
      (c) => c.targetOrg && job.company && c.targetOrg.toLowerCase() === job.company.toLowerCase()
    ).slice(0, 3);
    if (sameCompanyContacts.length) {
      parts.push(
        `People who may help with this role (same company): ${sameCompanyContacts
          .map((c) => `${c.name} (${c.relationshipStrength || "cold"})`)
          .join("; ")}.`
      );
      bestContactName = bestContactName || sameCompanyContacts[0]?.name;
    }
    // Surface any recent completed learn items whose capabilityBuilt overlaps the JD
    const jdText: string = (job.jdText || "").toLowerCase();
    if (jdText) {
      const relevantLearn = cleanList(
        learns
          .filter((l) => l.capabilityBuilt && jdText.includes(l.capabilityBuilt.toLowerCase().split(" ")[0]) && (l.learnStatus === "done" || !!l.outputEvidenceUrl))
          .map((l) => l.capabilityBuilt),
        4,
      );
      if (relevantLearn.length) parts.push(`Capabilities already evidenced (relevant to this role): ${relevantLearn.join(", ")}.`);
    }
    const brief = parseCompanyBrief(job.companyBrief || "");
    if (brief?.outreachSuggestions?.length) {
      const suggestions = brief.outreachSuggestions.slice(0, 3)
        .map((s) => `${s.archetype} - ${s.why}`)
        .join("; ");
      parts.push(`Outreach suggestions from company research: ${suggestions}.`);
    }
    if (brief?.landscape?.alsoConsider?.length) {
      parts.push(`Also consider these companies for similar roles: ${brief.landscape.alsoConsider.join(", ")}.`);
    }
  }

  if (!needsTrackContext && sourceKind === "learn" && source) {
    const learnItem = source as any;
    // Surface live jobs this learn item's capability could help with
    const capability: string = (learnItem.capabilityBuilt || "").toLowerCase();
    if (capability) {
      const relevantJobs = cleanList(
        jobs
          .filter((j) => isJobLive(j) && (j.title.toLowerCase().includes(capability.split(" ")[0]) || (j.note || "").toLowerCase().includes(capability.split(" ")[0])))
          .map((j) => `${j.title} at ${j.company}${j.deadline ? ` (due ${formatDeadlineLabel(j.deadline)})` : ""}`),
        3,
      );
      if (relevantJobs.length) parts.push(`Live roles this capability could unlock: ${relevantJobs.join("; ")}.`);
    }
  }

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
    const trackBrief = parseCompanyBrief(job.companyBrief || "");
    if (trackBrief?.outreachSuggestions?.length && !linkedContacts.length) {
      const suggestions = trackBrief.outreachSuggestions.slice(0, 3)
        .map((s) => `${s.archetype} - ${s.why}`)
        .join("; ");
      parts.push(`Outreach suggestions from company research: ${suggestions}.`);
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

function parseStepOutputs(stepsJson: string): Array<{ text: string; output: string; disposition?: StepDisposition }> {
  try {
    const arr = JSON.parse(stepsJson || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s: any) => s && s.done && s.output && typeof s.output === "string")
      .map((s: any) => ({ text: s.text || "", output: s.output, disposition: s.disposition }));
  } catch { return []; }
}
async function collectPriorStepOutputs(task: Task): Promise<string[]> {
  const outputs: string[] = [];
  const thisSteps = parseStepOutputs(task.steps);
  for (const s of thisSteps) {
    outputs.push(`[This task, ${s.disposition || "completed"}] ${s.text}: ${s.output}`);
  }

  const trackId = task.relatedTrackId;
  if (!trackId) return outputs;

  try {
    const allTasks = await storage.getTasks();
    const siblings = allTasks.filter((t) =>
      t.id !== task.id && t.relatedTrackId === trackId && t.done
    ).slice(-5);

    for (const sibling of siblings) {
      const siblingOutputs = parseStepOutputs(sibling.steps);
      for (const s of siblingOutputs) {
        if (s.disposition === "dismissed") continue;
        outputs.push(`[${sibling.title}, ${s.disposition || "completed"}] ${s.text}: ${s.output}`);
      }
    }
  } catch {}

  return outputs;
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
    const mode = goalTaskMode(task);
    if (mode === "network_support") {
      sourceContext = `This is a STRATEGIC GOAL / contact-support item. Title: ${task.title}. Done when: ${task.doneWhen || task.minimumOutcome || "one real person and a credible ask exist"}. ${taskSourceNote ? "Goal note: " + taskSourceNote + ". " : ""}${activeTrackNames.length ? "Active tracks: " + activeTrackNames.join("; ") + ". " : ""}`;
      playbook = "Anchor remains the planner. This goal is not abstract networking; it is to identify one real person worth messaging, capture why them, and define the soft ask. Do not collapse into role search once the missing path is already known.";
    } else if (mode === "learning_support") {
      sourceContext = `This is a STRATEGIC GOAL / learning-support item. Title: ${task.title}. Done when: ${task.doneWhen || task.minimumOutcome || "one missing requirement and one smallest prep move are saved"}. ${taskSourceNote ? "Goal note: " + taskSourceNote + ". " : ""}${activeTrackNames.length ? "Active tracks: " + activeTrackNames.join("; ") + ". " : ""}`;
      playbook = "Anchor remains the planner. This goal is not generic reading; start from one real requirement gap, then choose one targeted resource, drill, or example-building move that would make the path more credible.";
    } else if (mode === "cleanup") {
      sourceContext = `This is a STRATEGIC GOAL / cleanup item. Title: ${task.title}. Done when: ${task.doneWhen || task.minimumOutcome || "only the next three live moves remain"}. ${taskSourceNote ? "Goal note: " + taskSourceNote + ". " : ""}${activeTrackNames.length ? "Active tracks: " + activeTrackNames.join("; ") + ". " : ""}`;
      playbook = "Anchor remains the planner. Reduce decision load by keeping only the next three live moves that could change an application, conversation, or proof outcome.";
    } else {
      sourceContext = `This is a STRATEGIC GOAL / broad-pursuit item. Title: ${task.title}. Done when: ${task.doneWhen || task.minimumOutcome || "one real role-opening move exists"}. ${taskSourceNote ? "Goal note: " + taskSourceNote + ". " : ""}${activeTrackNames.length ? "Active tracks: " + activeTrackNames.join("; ") + ". " : ""}`;
      playbook = "Use the parent pipeline workflow first. The goal is not abstract comparison; it is to turn each plausible path into one real role or application move. Prefer filling missing paths with concrete pipeline actions over reflection.";
    }
  } else if (task.sourceType === "job" && task.sourceId) {
    const j = (await storage.getJobs()).find((x) => x.id === task.sourceId);
    if (j) {
      source = j;
      sourceKind = "job";
      const briefParts: string[] = [];
      const brief = parseCompanyBrief(j.companyBrief || "");
      if (brief) {
        if (brief.whatTheyDo) briefParts.push(`What they do: ${brief.whatTheyDo}`);
        if (brief.relevantTeam) briefParts.push(`Team: ${brief.relevantTeam}`);
        if (brief.whyYouFit) briefParts.push(`Your fit: ${brief.whyYouFit}`);
        if (brief.prepAngle) briefParts.push(`Prep angle: ${brief.prepAngle}`);
        if (brief.landscape?.marketContext) briefParts.push(`Market context: ${brief.landscape.marketContext}`);
        if (brief.landscape?.competitors?.length) briefParts.push(`Competitors: ${brief.landscape.competitors.join(", ")}`);
      }
      sourceContext = `This is a JOB / OPPORTUNITY item. Role: ${j.title} at ${j.company}. Status: ${j.status}. Readiness: ${j.applicationReadiness}. ${j.deadline ? `Deadline: ${formatDeadlineLabel(j.deadline)}. ` : ""}Fit score: ${j.fitScore ?? "unknown"}. Archetype: ${j.roleArchetype || "unknown"}. Narrative angle: ${j.narrativeAngle || "unset"}. ${j.note ? "Posting notes: " + j.note : ""} ${j.url ? "URL: " + j.url : ""}${briefParts.length ? `\nCOMPANY INTELLIGENCE:\n${briefParts.join("\n")}` : ""}`;
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
      sourceContext = `This is a CONTACT / NETWORKING item. Person: ${contactDisplayName(c)}. Status: ${c.status}. Relationship strength: ${c.relationshipStrength}. Ask type: ${c.askType || "unspecified"}. ${contactNeedsIdentification(c) ? "This is a target archetype, not a named person yet. Identify one real person before drafting outreach. " : ""}${c.who ? "Who they are: " + normalizeContactWho(c.who) + ". " : ""}${c.sourceNetwork ? "Shared network: " + c.sourceNetwork + ". " : ""}${c.why ? "Why they matter: " + c.why + ". " : ""}${c.targetOrg ? "Target company: " + c.targetOrg + ". " : ""}${contactTopicHint(c) ? "Target role: " + contactTopicHint(c) + ". " : ""}${c.messageDraft ? "Existing draft: " + c.messageDraft + ". " : ""}${c.lastMessage ? "Last message: " + c.lastMessage + ". " : ""}${c.nextFollowUpDate ? "Next follow-up: " + c.nextFollowUpDate + ". " : ""}${c.referralPotential ? "Referral potential: " + c.referralPotential + ". " : ""}`;
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
  } else if (task.sourceType === "strategy_builder" || task.sourceType === "career_track" || task.sourceType === "marketability_engine") {
    sourceKind = "task";
    const trackId = task.relatedTrackId;
    let trackName = "";
    if (trackId) {
      const tracks = await storage.getCareerTracks();
      trackName = tracks.find((tr) => tr.id === trackId)?.name || "";
    }
    sourceContext = `This is a STRATEGY task - exploring or building a career path.${trackName ? ` Career track: ${trackName}.` : ""} Title: ${task.title}. ${task.doneWhen ? `Done when: ${task.doneWhen}. ` : ""}${taskSourceNote ? "Notes: " + taskSourceNote + ". " : ""}${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
    playbook = "The user is exploring role types or building strategy. Steps must be concrete actions on real job boards, LinkedIn, or saved notes - not abstract planning. Each step should produce something saved: a role link, a note about requirements, or a comparison.";
  } else if (task.sourceUrl || taskSourceNote) {
    sourceContext = `${taskSourceNote ? "Context: " + taskSourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
  }
  const tempBundle: SourceBundle = { sourceContext, playbook, sourceKind, source, parentContext: "" };
  const parentWorkflow = parentWorkflowFor(task, tempBundle);
  const parentContext = parentWorkflow ? `Inherited workflow from parent ${parentWorkflow.inheritedFrom}: ${parentWorkflow.workflow.join(" -> ")}. Kind: ${parentWorkflow.workflowKind}. Current stage: ${parentWorkflow.currentStage}. Stage output: ${parentWorkflow.stageOutput}. Completion criteria: ${parentWorkflow.completionCriteria.join("; ")}.` : "";

  let cvText = "";
  let jdText = "";
  cvText = sharedUserContext.cv?.trim() || "";
  if (sourceKind === "job" && source) {
    jdText = ((source as any).jdText as string | undefined)?.trim() || "";
  }

  if (task.sourceType && task.sourceId) {
    try {
      const allTasks = await storage.getTasks();
      const doneSiblings = allTasks
        .filter((t) => t.id !== task.id && t.sourceType === task.sourceType && t.sourceId === task.sourceId && t.done)
        .slice(-5);
      if (doneSiblings.length) {
        const siblingDetails = doneSiblings.map((t) => {
          const outputs = parseStepOutputs(t.steps);
          const useful = outputs.filter((o) => o.disposition !== "dismissed").slice(0, 2);
          if (useful.length) return `${t.title} (produced: ${useful.map((o) => o.output.slice(0, 100)).join("; ")})`;
          return t.title;
        });
        sourceContext += ` Already completed for this ${sourceKind}: ${siblingDetails.join("; ")}.`;
      }
    } catch {}
  }

  let crossEngineContext = "";
  let contactName: string | undefined;
  try {
    const ce = await buildCrossEngineContext(task, sourceKind, source, sharedUserContext);
    crossEngineContext = ce.text;
    contactName = ce.contactName;
  } catch { /* non-fatal - breakdown works without cross-engine context */ }

  return { sourceContext, playbook, sourceKind, source, parentContext, parentWorkflow, cvText, jdText, crossEngineContext, contactName };
}

export async function buildDeterministicTaskBreakdown(task: Task, bundleOverride?: SourceBundle) {
  const bundle = bundleOverride || await buildSourceContext(task);
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
    `For each step, classify where the value lives:\n` +
    `- "system": the value is the artifact (a list of roles, extracted requirements, a draft). The system will execute it.\n` +
    `- "user_action": the value is an external act only the user can take (submit, send, save to their account, schedule).\n` +
    `- "user_learning": the value is in the user doing it - reading, practising, judging, absorbing. The system frames it: the resource, why it matters now, and the one question to hold.\n` +
    `Test: would doing this FOR the user destroy its value? If yes -> user_learning. If a tool can produce the artifact and handing it over loses nothing -> system.\n\n` +
    `Return ONLY JSON: {"workObject":"...","workflow":["..."],"workflowKind":"finite|continuous","currentStage":"...","stageOutput":"...","completionCriteria":["..."],"confidence":"high|medium|low","steps":[{"text":"...","executor":"system|user_action|user_learning","outputSpec":"what the output must contain"}],"advanceCondition":"..."} or {"question":"..."}.\n\n` +
    `${globalGuidance}\n` +
    `For learning or research work: if stored notes, topic breakdown, checkpoints, links, prior outputs, live role context, or user-authored note excerpts are present, use them directly. Name the actual section, concept, checkpoint, deadline, company, role, or prior output when available. Do not assume page content beyond what is shown. If the context is sparse or partial, tell the user exactly what to search for, what to extract, and what output to produce.\n\n` +
    `When COMPANY INTELLIGENCE is present in the source context, use it directly in steps. Never say "research the company" when you already have what they do, their team, and market context. Instead reference the specific insight: name competitors, quote the prep angle, use the fit analysis to sharpen CV bullets. When outreach suggestions are present, name the specific archetype in networking steps instead of generic "reach out to someone".\n\n` +
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
    `Task: ${task.title}\nCategory: ${task.category}\nDone when: ${task.doneWhen || task.minimumOutcome || `something about "${task.title.slice(0, 50)}" is visibly further along`}\n` +
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

export function isAtomicTask(task: Task): boolean {
  const t = task.title.toLowerCase();
  const atomicVerbs = /^(send|email|reply|forward|pay|book|cancel|confirm|check|open|read|skim|call|text|message|sign|renew|submit|post|share|download|upload|print|return)\b/;
  if (!atomicVerbs.test(t)) return false;
  if (task.sourceType === "job" || task.sourceType === "learn" || task.sourceType === "hustle") return false;
  if (task.size === "deep") return false;
  return true;
}

export function registerTaskBreakdownRoutes(app: Express) {
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const context = String(req.body?.context || "").slice(0, 500);

    if (isAtomicTask(task) && !context) {
      const stepText = task.doneWhen || task.title;
      const steps: BreakdownStep[] = [{ text: stepText, done: false }];
      const updated = await storage.updateTask(id, { steps: JSON.stringify(steps) });
      return res.json(updated);
    }

    const existingSteps = parseExistingSteps(task.steps);
    const completedSteps = existingSteps.filter((s) => s.done && s.output);
    const priorOutputs = await collectPriorStepOutputs(task);

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

    const priorOutputContext = priorOutputs.length
      ? `\nPRIOR COMPLETED OUTPUTS (do not repeat this work - build on it):\n${priorOutputs.map((o) => `- ${o}`).join("\n")}\n`
      : "";

    let question = "";
    let steps: BreakdownStep[] = [];
    let workflowState: WorkflowState | undefined;
    try {
      const raw = await llm(buildTaskBreakdownPrompt({
        task,
        bundle,
        fallbackObject,
        userContextText: context
          ? `${userCtx}\nUser context: ${context}${priorOutputContext}`
          : `${userCtx}${priorOutputContext}`,
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

    if (completedSteps.length) {
      steps = [...completedSteps, ...steps.filter((s) => !s.done)];
    }
    steps = attachWorkflowState(steps, workflowState);

    const hasTypedSteps = steps.some((s) => s.executor);
    if (hasTypedSteps) {
      const researchBlocks = [
        ...(collectedContext.blocks?.externalResearch || []),
        ...(collectedContext.blocks?.userAuthored || []),
      ];
      try {
        const executed = await executeSteps(steps, {
          taskTitle: task.title,
          sourceType: task.sourceType,
          sourceNote: task.sourceNote,
          doneWhen: task.doneWhen,
          userContext: userCtx,
          researchBlocks,
          priorCompletedOutputs: priorOutputs,
          sourceContext: bundle.sourceContext,
          crossEngineContext: bundle.crossEngineContext,
        });
        steps = executed.map((e) => ({
          text: e.text,
          done: e.done,
          executor: e.executor,
          outputSpec: e.outputSpec,
          output: e.output,
          gaps: e.gaps,
          disposition: e.disposition,
          completedAt: e.completedAt,
          ...(e.ready === false ? { ready: false, blocker: e.blocker } : {}),
        }));
      } catch {}
    }

    const updated = await storage.updateTask(id, {
      steps: JSON.stringify(steps),
      minimumOutcome: workflowState.stageOutput || task.minimumOutcome,
    });
    res.json(updated);
  });

  app.post("/api/tasks/:id/step-disposition", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });

    const stepIndex = Number(req.body?.stepIndex);
    const disposition = String(req.body?.disposition || "") as StepDisposition;
    if (!["applied", "saved", "dismissed"].includes(disposition)) {
      return res.status(400).json({ error: "Invalid disposition" });
    }
    if (isNaN(stepIndex) || stepIndex < 0) {
      return res.status(400).json({ error: "Invalid step index" });
    }

    const steps = parseExistingSteps(task.steps);
    if (stepIndex >= steps.length) {
      return res.status(400).json({ error: "Step index out of range" });
    }

    steps[stepIndex] = {
      ...steps[stepIndex],
      done: true,
      disposition,
      completedAt: new Date().toISOString(),
    };

    const updated = await storage.updateTask(id, { steps: JSON.stringify(steps) });
    const allDone = steps.every((s) => s.done);
    res.json({ ...updated, allStepsDone: allDone });
  });
}

function parseExistingSteps(stepsJson: string): BreakdownStep[] {
  try {
    const arr = JSON.parse(stepsJson || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter((s: any) => s && typeof s.text === "string");
  } catch { return []; }
}
