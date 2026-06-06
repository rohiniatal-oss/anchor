import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";

type WorkObject = "Artifact" | "Decision" | "Knowledge" | "Capability" | "Pipeline" | "Problem";
type WorkflowState = {
  workObject: WorkObject | string;
  workflow: string[];
  currentStage: string;
  stageOutput: string;
  advanceCondition: string;
  confidence?: string;
};
type BreakdownStep = { text: string; done: false; substeps?: string[]; workflowState?: WorkflowState };
type SourceBundle = {
  sourceContext: string;
  playbook: string;
  sourceKind: "job" | "learn" | "hustle" | "task";
  source: any;
};

const WORKFLOWS: Record<WorkObject, string[]> = {
  Artifact: ["Clarify purpose", "Gather inputs", "Structure", "Draft", "Refine", "QC", "Deliver"],
  Decision: ["Frame question", "Define criteria", "Generate options", "Evaluate", "Decide", "Commit"],
  Knowledge: ["Orient", "Scope useful slice", "Inspect", "Extract", "Synthesize", "Store"],
  Capability: ["Define capability", "Learn model", "Practise", "Apply in context", "Reflect", "Consolidate"],
  Pipeline: ["Define target", "Build list", "Prioritise", "Execute next batch", "Track", "Follow up", "Review conversion"],
  Problem: ["Define symptom", "Diagnose cause", "Choose fix options", "Test", "Implement", "Verify"],
};

function compact(value: unknown, max = 90) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanText(value: unknown, max = 140) {
  return compact(value, max).replace(/^[-*\d.)\s]+/, "").trim();
}
function keyword(text: string, re: RegExp) {
  return re.test(text.toLowerCase());
}
function normalizeWorkObject(value: unknown, fallback: WorkObject): WorkObject | string {
  const v = String(value || "").trim();
  return ["Artifact", "Decision", "Knowledge", "Capability", "Pipeline", "Problem"].includes(v) ? v : fallback;
}
function normalizeStep(raw: any): BreakdownStep | null {
  if (typeof raw === "string") {
    const text = cleanText(raw);
    return text ? { text, done: false } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const text = cleanText(raw.text || raw.step || raw.title || raw.name);
  if (!text) return null;
  const rawSubsteps = Array.isArray(raw.substeps) ? raw.substeps : Array.isArray(raw.subSteps) ? raw.subSteps : [];
  const substeps = rawSubsteps.map((s: unknown) => cleanText(s, 120)).filter(Boolean).slice(0, 4);
  return substeps.length ? { text, done: false, substeps } : { text, done: false };
}
function parseBreakdown(raw: string, fallbackObject: WorkObject): { question?: string; steps: BreakdownStep[]; workflowState?: WorkflowState } {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.question === "string") return { question: cleanText(parsed.question, 160), steps: [] };
    const rawSteps = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.steps) ? parsed.steps : [];
    const steps = rawSteps.map(normalizeStep).filter(Boolean).slice(0, 6) as BreakdownStep[];
    const workObject = normalizeWorkObject(parsed?.workObject, fallbackObject);
    const workflow = Array.isArray(parsed?.workflow) ? parsed.workflow.map((x: unknown) => cleanText(x, 80)).filter(Boolean) : WORKFLOWS[workObject as WorkObject] || WORKFLOWS[fallbackObject];
    const currentStage = cleanText(parsed?.currentStage || "", 80);
    const stageOutput = cleanText(parsed?.stageOutput || "", 140);
    const advanceCondition = cleanText(parsed?.advanceCondition || (stageOutput ? `Advance when: ${stageOutput}` : ""), 160);
    const workflowState = currentStage || stageOutput ? { workObject, workflow, currentStage, stageOutput, advanceCondition, confidence: cleanText(parsed?.confidence || "medium", 20) } : undefined;
    return { steps, workflowState };
  } catch {}
  const steps = text.split(/\n+/).map((s) => normalizeStep(s)).filter(Boolean).slice(0, 6) as BreakdownStep[];
  return { steps };
}

function classifyWorkObject(task: any, bundle: SourceBundle): WorkObject {
  const text = `${task?.title || ""} ${task?.category || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${task?.sourceNote || ""} ${bundle.sourceContext}`.toLowerCase();

  if (keyword(text, /fix|blocked|bug|confus|stuck|messy|unblock|not working|error|broken/)) return "Problem";
  if (keyword(text, /decide|choose|prioriti|pick|whether|option|trade[ -]?off|select/)) return "Decision";
  if (keyword(text, /practice|drill|improve|skill|interviewing|storylining|excel|capability|development|mock/)) return "Capability";
  if (keyword(text, /learn|read|understand|research|report|guide|resource|synthesize|synthesise|market scan|role requirements|inspect/)) return "Knowledge";
  if (keyword(text, /job search|pipeline|networking campaign|network|outreach list|follow up|follow-up|shortlist|list of people|crm|tracker/)) return "Pipeline";
  if (bundle.sourceKind === "learn") return keyword(text, /practice|drill|mock/) ? "Capability" : "Knowledge";
  if (bundle.sourceKind === "job") {
    // A linked job is not automatically a Pipeline. A CV, cover letter, answer,
    // submission, or application material is an Artifact. A role-market scan is
    // Knowledge. Only multi-item job-search/networking work is Pipeline.
    if (keyword(text, /cv|resume|cover|answer|application material|submit|submission|draft|tailor|rewrite|portfolio|sample/)) return "Artifact";
    if (keyword(text, /requirements|research|understand role|posting|company|market|inspect/)) return "Knowledge";
    return "Artifact";
  }
  if (bundle.sourceKind === "hustle") return "Artifact";
  return "Artifact";
}

function inferConcreteNoun(task: any, bundle: SourceBundle) {
  const title = compact(task?.title, 120);
  if (bundle.sourceKind === "job") return compact(`${bundle.source?.title || "role"}${bundle.source?.company ? " at " + bundle.source.company : ""}`, 120);
  if (bundle.sourceKind === "learn") return compact(bundle.source?.title || title, 120);
  if (bundle.sourceKind === "hustle") return compact(bundle.source?.title || title, 120);
  return title || "this task";
}
function makeSteps(defs: Array<[string, string[]?]>): BreakdownStep[] {
  return defs.map(([text, substeps]) => ({ text, done: false as const, ...(substeps?.length ? { substeps } : {}) }));
}
function attachWorkflowState(steps: BreakdownStep[], workflowState?: WorkflowState): BreakdownStep[] {
  if (!workflowState || !steps.length) return steps;
  const [first, ...rest] = steps;
  return [{ ...first, workflowState }, ...rest];
}

function fallbackStagePlan(task: any, bundle: SourceBundle): { workflowState: WorkflowState; steps: BreakdownStep[] } {
  const object = classifyWorkObject(task, bundle);
  const workflow = WORKFLOWS[object];
  const noun = inferConcreteNoun(task, bundle);
  const text = `${task?.title || ""} ${task?.doneWhen || ""} ${task?.minimumOutcome || ""} ${bundle.sourceContext}`.toLowerCase();

  let currentStage = workflow[0];
  let stageOutput = "One concrete stage output exists";
  let actions: string[] = [];

  if (bundle.sourceKind === "job" && object === "Artifact") {
    if (keyword(text, /cv|resume|tailor|rewrite/)) {
      currentStage = "Structure";
      stageOutput = "Three role-relevant CV bullets are selected and ready to rewrite";
      actions = ["Open CV and role posting", "Highlight repeated role keywords", "Choose three matching bullets", "Mark one missing proof point"];
    } else if (keyword(text, /cover|answer|question/)) {
      currentStage = "Structure";
      stageOutput = "One application answer outline exists";
      actions = ["Copy the exact question", "State the answer claim", "Pick supporting evidence", "Draft the outline only"];
    } else {
      currentStage = "Clarify purpose";
      stageOutput = "The strongest application angle is clear";
      actions = ["Open the role posting", "Name the role's real ask", "Map strongest evidence", "Choose next material"];
    }
  } else if (object === "Knowledge" && bundle.sourceKind === "job") {
    currentStage = "Orient";
    stageOutput = "Must-haves, nice-to-haves, and hidden asks are captured";
    actions = ["Open the role posting", "Extract must-have requirements", "Extract nice-to-haves", "Mark repeated themes"];
  } else if (object === "Pipeline") {
    currentStage = keyword(text, /follow|reply|message|outreach/) ? "Execute next batch" : "Define target";
    stageOutput = currentStage === "Define target" ? "Target group and success criteria are clear" : "One batch action is sent or logged";
    actions = currentStage === "Define target"
      ? ["Name the target group", "Define success criteria", "List the first batch", "Choose the top priority"]
      : ["Open the batch list", "Choose one target", "Draft the action", "Send or log it"];
  } else if (object === "Knowledge") {
    currentStage = "Orient";
    stageOutput = "One useful slice and output are chosen";
    actions = ["Open the resource", "Scan headings or summary", "Choose the useful slice", "Name the output to create"];
  } else if (object === "Capability") {
    currentStage = "Practise";
    stageOutput = "One practice output exists";
    actions = ["Open a blank practice note", "Pick the exact skill to drill", "Do one small attempt", "Write one improvement note"];
  } else if (object === "Decision") {
    currentStage = "Frame question";
    stageOutput = "The decision question and criteria are clear";
    actions = ["Write the decision question", "List the real options", "Choose three criteria", "Mark the current default"];
  } else if (object === "Problem") {
    currentStage = "Define symptom";
    stageOutput = "The blocker is stated clearly";
    actions = ["Describe what is not working", "Name when it happens", "List likely causes", "Choose the first cause to test"];
  } else {
    currentStage = keyword(text, /draft|write|build|create/) ? "Draft" : "Clarify purpose";
    stageOutput = task?.doneWhen || task?.minimumOutcome || "The current-stage artifact exists";
    actions = currentStage === "Draft"
      ? ["Open the working document", "Write the rough first section", "Add missing input notes", "Stop before refining"]
      : ["Open the task context", "Write the intended audience", "Name the final artifact", "List required inputs"];
  }

  const workflowState: WorkflowState = {
    workObject: object,
    workflow,
    currentStage,
    stageOutput,
    advanceCondition: `Advance when: ${stageOutput}`,
    confidence: "fallback",
  };
  const steps = makeSteps([
    [`Map the ${object.toLowerCase()} workflow`, workflow.slice(0, 5)],
    ["Locate the current stage", [currentStage]],
    ["Define this stage output", [stageOutput]],
    ["Break this stage into actions", actions],
    ["Execute until this output exists"],
  ]);
  return { workflowState, steps };
}

async function buildSourceContext(task: any): Promise<SourceBundle> {
  let sourceContext = "";
  let playbook = "";
  let sourceKind: SourceBundle["sourceKind"] = "task";
  let source: any = null;
  if (task.sourceType === "job" && task.sourceId) {
    const j = (await storage.getJobs()).find((x) => x.id === task.sourceId);
    if (j) {
      source = j;
      sourceKind = "job";
      sourceContext = `This is a JOB / OPPORTUNITY item. Role: ${j.title} at ${j.company}. Status: ${j.status}. Readiness: ${j.applicationReadiness}. Fit score: ${j.fitScore ?? "unknown"}. Archetype: ${j.roleArchetype || "unknown"}. Narrative angle: ${j.narrativeAngle || "unset"}. ${j.note ? "Posting notes: " + j.note : ""} ${j.url ? "URL: " + j.url : ""}`;
      playbook = "Classify by the task intent, not by job source. CV/cover/answers/submission are Artifact. Role research is Knowledge. Multi-role search or networking is Pipeline.";
    }
  } else if (task.sourceType === "learn" && task.sourceId) {
    const l = (await storage.getLearn()).find((x) => x.id === task.sourceId);
    if (l) {
      source = l;
      sourceKind = "learn";
      sourceContext = `This is a LEARNING / DEVELOPMENT item. Title: ${l.title}. Type: ${l.type}. ${l.url ? "URL: " + l.url + ". " : ""}${l.note ? "Notes: " + l.note + ". " : ""}${l.capabilityBuilt ? "Capability: " + l.capabilityBuilt + ". " : ""}Required output: ${l.requiredOutput || "a concrete reusable output"}.`;
      playbook = "Usually Knowledge or Capability. Do not just read; locate the stage and produce a reusable output.";
    }
  } else if (task.sourceType === "hustle" && task.sourceId) {
    const h = (await storage.getHustles()).find((x) => x.id === task.sourceId);
    if (h) {
      source = h;
      sourceKind = "hustle";
      sourceContext = `This is a PROOF-ASSET / project step. Title: ${h.title}. Stage: ${h.stage}. Content pillar: ${h.contentPillar || "unset"}. Core claim: ${h.coreClaim || "unset"}. ${h.note ? "Notes: " + h.note : ""}`;
      playbook = "Usually Artifact. Map claim → audience → evidence → draft → reuse, then break only the current stage.";
    }
  } else if (task.sourceUrl || task.sourceNote) {
    sourceContext = `${task.sourceNote ? "Context: " + task.sourceNote : ""} ${task.sourceUrl ? "URL: " + task.sourceUrl : ""}`;
  }
  return { sourceContext, playbook, sourceKind, source };
}

export function registerTaskBreakdownRoutes(app: Express) {
  app.post("/api/tasks/:id/breakdown", async (req, res) => {
    const id = Number(req.params.id);
    const task = (await storage.getTasks()).find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "Not found" });
    const context = String(req.body?.context || "").slice(0, 500);
    const bundle = await buildSourceContext(task);
    const fallbackObject = classifyWorkObject(task, bundle);

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
          `1. Classify the work object as one of: Artifact, Decision, Knowledge, Capability, Pipeline, Problem.\n` +
          `2. Select the matching workflow template.\n` +
          `3. Locate the single current stage. Only one stage may be active.\n` +
          `4. Define the output that completes this stage.\n` +
          `5. Break down only the current stage into discrete self-contained actions, with substeps if useful.\n` +
          `6. Define when to advance.\n\n` +
          `Classify by intent, not source type. A linked job task can be Artifact, Knowledge, Decision, Pipeline, Problem, or Capability. ` +
          `Ask ONE short question only if classification or current stage would likely be wrong without it. Otherwise make sensible assumptions. ` +
          `Return ONLY JSON: {"workObject":"...","workflow":["..."],"currentStage":"...","stageOutput":"...","confidence":"high|medium|low","steps":[{"text":"...","substeps":["..."]}],"advanceCondition":"..."} or {"question":"..."}.\n\n` +
          `${bundle.playbook ? `Relevant playbook: ${bundle.playbook}\n` : ""}` +
          `Default work object if uncertain: ${fallbackObject}\n` +
          `Task: ${task.title}\nCategory: ${task.category}\nDone when: ${task.doneWhen || task.minimumOutcome || "smallest useful outcome is complete"}\n` +
          `Source context: ${bundle.sourceContext || "none beyond the title"}\n` +
          `${context ? `User context: ${context}\n` : ""}`,
      });
      const parsed = parseBreakdown(r.output_text || "", fallbackObject);
      question = parsed.question || "";
      steps = parsed.steps;
      workflowState = parsed.workflowState;
    } catch {
      steps = [];
    }

    if (question && !context) return res.json({ question });
    if (!steps.length || !workflowState) {
      const fallback = fallbackStagePlan(task, bundle);
      steps = fallback.steps;
      workflowState = fallback.workflowState;
    }
    steps = attachWorkflowState(steps, workflowState);
    const updated = await storage.updateTask(id, {
      steps: JSON.stringify(steps),
      minimumOutcome: workflowState.stageOutput || task.minimumOutcome,
    });
    res.json(updated);
  });
}
