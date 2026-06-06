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
  inheritedFrom?: string