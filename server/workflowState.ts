export type WorkObject = "Artifact" | "Decision" | "Knowledge" | "Capability" | "Pipeline" | "Problem";
export type WorkflowKind = "finite" | "continuous";
export type SourceKind = "job" | "learn" | "hustle" | "task";

export type WorkflowState = {
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

export type WorkflowSourceBundle = {
  sourceContext: string;
  playbook: string;
  sourceKind: SourceKind;
  source: any;
  parentContext: string;
  parentWorkflow?: WorkflowState;
};

export const WORKFLOWS: Record<WorkObject, string[]> = {
  Artifact: ["Clarify purpose", "Gather inputs", "Structure", "Draft", "Refine", "QC", "Deliver"],
  Decision: ["Frame question", "Define criteria", "Generate options", "Evaluate", "Decide", "Commit"],
  Knowledge: ["Orient", "Scope useful slice", "Inspect", "Extract", "Synthesize", "Store"],
  Capability: ["Define capability", "Learn model", "Practise", "Apply in context", "Reflect", "Consolidate"],
  Pipeline: ["Define target", "Build list", "Prioritise", "Execute next batch", "Track", "Follow up", "Review conversion"],
  Problem: ["Define symptom