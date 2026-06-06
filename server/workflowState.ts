export type WorkObject = "Artifact" | "Decision" | "Knowledge" | "Capability" | "Pipeline" | "Problem";
export type WorkflowKind = "finite" | "continuous";

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
