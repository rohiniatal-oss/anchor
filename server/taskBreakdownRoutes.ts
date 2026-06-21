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
  if (keyword(text, /learn|read|understand|research|report|guide|resource|synthesize|synthesize/)) return "Knowledge";
  if (keyword(text, /pipeline|outreach|network|search|batch|apply to multiple|generate list|all.*roles/)) return "Pipeline";
  if (bundle.sourceKind === "job") return "Artifact";
  if (bundle.sourceKind === "contact") return "Pipeline";
  if (bundle.sourceKind === "learn") return "Capability";
  if (bundle.sourceKind === "hustle") return "Artifact";
  return "Artifact";
}

function parentWorkflowFor(task: Task, bundle: SourceBundle): WorkflowState | undefined {
  if (!task.parentId) return undefined;
  const parentStepsRaw = (task as any).parentSteps;
  if (!parentStepsRaw) return undefined;
  try {
    const steps = JSON.parse(parentStepsRaw);
    const last = Array.isArray(steps) ? steps[steps.length - 1] : null;
    if (last?.workflowState) {
      return { ...last.workflowState, inheritedFrom: (task as any).parentTitle || "parent task" };
    }
  } catch {}
  return undefined;
}

function attachWorkflowState(steps: BreakdownStep[], workflowState?: WorkflowState): BreakdownStep[] {
  if (!workflowState || !steps.length) return steps;
  return steps.map((s, i) => i === steps.length - 1 ? { ...s, workflowState } : s);
}

function coerceTaskBreakdownSteps(task: Task, bundle: SourceBundle, workflowState: WorkflowState, steps: BreakdownStep[]): BreakdownStep[] {
  const titles = steps.map((s) => s.text);
  const unique = new Set(titles.map((t) => t.toLowerCase()));
  if (unique.size < titles.length) {
    const seen = new Set<string>();
    return steps.filter((s) => {
      const key = s.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return steps;
}

function fallbackStagePlan(task: Task, bundle: SourceBundle): { workflowState: WorkflowState; steps: BreakdownStep[] } {
  const workObject = classifyWorkObject(task, bundle);
  const workflow = bundle.sourceKind === "job" ? APPLICATION_WORKFLOW
    : bundle.sourceKind === "contact" ? CONTACT_WORKFLOW
    : bundle.sourceKind === "hustle" ? PROOF_WORKFLOW
    : WORKFLOWS[workObject] || WORKFLOWS.Artifact;
  const currentStage = workflow[0];
  const stageOutput = `${currentStage} is complete`;
  const workflowState = makeWorkflowState({ workObject, workflow, currentStage, stageOutput, sourceKind: bundle.sourceKind });
  const steps: BreakdownStep[] = [
    { text: `Review: ${bundle.sourceContext ? bundle.sourceContext.slice(0, 60) : task.title}`, done: false },
    { text: `Complete: ${currentStage}`, done: false },
    { text: `Output: ${stageOutput}`, done: false },
  ];
  return { workflowState, steps };
}

function meaningfulTaskContextText(note: unknown): string {
  const text = String(note || "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 8) return "";
  if (/^task(ed)?$/i.test(text)) return "";
  return text;
}

function contactDisplayName(c: Contact): string {
  return [c.name, c.linkedinUrl ? `(${c.linkedinUrl})` : ""].filter(Boolean).join(" ").trim() || "Unknown contact";
}

function relevantFocusFromContext(crossEngineContext?: string): string {
  if (!crossEngineContext) return "";
  const match = crossEngineContext.match(/Relevant career focus:\s*([^.]+)/);
  return match?.[1]?.trim() || "";
}

function firstLiveRoleLabelFromContext(crossEngineContext?: string): string {
  if (!crossEngineContext) return "";
  const match = crossEngineContext.match(/Live roles nearby:\s*([^.]+)/);
  const first = match?.[1]?.split(";")[0]?.trim();
  return first || "";
}

function globalBreakdownQualityGuidance(): string {
  return [
    "STEP QUALITY RULES:",
    "- Each step must describe ONE concrete action with a clear result.",
    "- Never write steps that only say 'research X' without specifying what to find or produce.",
    "- If context is sparse, tell the user exactly what to search for and what output to produce.",
    "- Steps must use real content from context above — names, deadlines, existing drafts, capabilities.",
    "- The final step must produce or verify the stage output defined in the workflow.",
    "- Maximum 5 steps. If fewer suffice, use fewer.",
  ].join("\n");
}

function taskSpecificPromptGuidance(task: Task, bundle: SourceBundle): string {
  const lines: string[] = [];
  const sourceKind = bundle.sourceKind;

  if (sourceKind === "job") {
    const j = bundle.source as Job | null;
    const readiness = j?.applicationReadiness || "none";
    const status = j?.status || "wishlist";
    const stage = readiness === "none" ? "Understand role"
      : readiness === "cv" ? "Match examples"
      : readiness === "cover" ? "Handle gaps"
      : readiness === "questions" ? "Build materials"
      : readiness === "sample" ? "Build materials"
      : readiness === "referral" ? "Handle gaps"
      : readiness === "submitted" ? "Follow up"
      : readiness === "follow_up" ? "Follow up"
      : "Understand role";
    lines.push(`APPLICATION WORKFLOW GUIDANCE:`);
    lines.push(`Current readiness stage: ${stage} (readiness=${readiness}, status=${status}).`);
    lines.push(`Use the APPLICATION_WORKFLOW: ${APPLICATION_WORKFLOW.join(" → ")}.`);
    lines.push(`Do NOT recommend submitting or changing status. Focus on the current stage output only.`);
    if (j?.narrativeAngle) lines.push(`Narrative angle to use: ${j.narrativeAngle}.`);
    if (j?.roleArchetype) lines.push(`Role archetype: ${j.roleArchetype} — align step framing to this archetype.`);
  }

  if (sourceKind === "contact") {
    const c = bundle.source as Contact | null;
    const askType = c?.askType || "unspecified";
    const strength = c?.relationshipStrength || "cold";
    lines.push(`NETWORKING WORKFLOW GUIDANCE:`);
    lines.push(`Ask type: ${askType}. Relationship strength: ${strength}.`);
    lines.push(`Use the CONTACT_WORKFLOW: ${CONTACT_WORKFLOW.join(" → ")}.`);
    lines.push(`Make steps specific to the actual ask and relationship stage. Do not write generic 'send a message' steps.`);
  }

  if (sourceKind === "learn") {
    const l = bundle.source as Learn | null;
    lines.push(`LEARNING WORKFLOW GUIDANCE:`);
    if (l?.requiredOutput) lines.push(`Required output: ${l.requiredOutput}.`);
    if (l?.capabilityBuilt) lines.push(`Capability being built: ${l.capabilityBuilt}.`);
    if (l?.outputStatus) lines.push(`Current output status: ${l.outputStatus}.`);
    lines.push(`Steps must produce a tangible output or checkpoint — not just 'read the material'.`);
  }

  if (sourceKind === "hustle") {
    lines.push(`PROOF ASSET WORKFLOW GUIDANCE:`);
    lines.push(`Use the PROOF_WORKFLOW: ${PROOF_WORKFLOW.join(" → ")}.`);
    lines.push(`Each step must move the proof asset one stage forward. The output must be saveable.`);
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
    lines.push("- External research is supporting only — use it to sharpen public facts.");
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

  const lines = ["SPARSE CONTEXT — the task has minimal context. Use these rules:"];
  if (bundle.sourceKind === "job") {
    lines.push("- Ask what stage of the application the user is at (no CV? no JD? no draft?).");
    lines.push("- Do not invent role requirements. Steps must be generic but actionable.");
  } else if (bundle.sourceKind === "learn") {
    lines.push("- Ask what the user wants to be able to DO after this — not just 'understand it'.");
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

