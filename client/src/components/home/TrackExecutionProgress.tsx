import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  FileCheck2,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
type ExecutionOutcomeRecord = {
  id: string;
  liveTaskId: number;
  taskTitle: string;
  expectedEvidence: string;
  status: "pending_confirmation" | "accepted" | "rejected" | "superseded" | "failed";
  summary: string;
  detail: string;
  sourceUrl: string;
  strength: "verified" | "direct" | "supporting" | "planned";
  confirmationRequired: boolean;
  confirmationQuestion: string;
  confirmationAnswer: string;
  updatedAt: number;
};

type CoverageDeltaItem = {
  requirementId: string;
  label: string;
  beforeStatus: CoverageStatus;
  afterStatus: CoverageStatus;
  changed: boolean;
  improved: boolean;
  evidenceAddedIds: string[];
};

type ExecutionFeedbackRun = {
  id: string;
  outcomeId: string;
  coverageChanges: CoverageDeltaItem[];
  changedRequirementCount: number;
  improvedRequirementCount: number;
  developmentPlanChanged: boolean;
  executionBlueprintChanged: boolean;
  executionPriorityChanged: boolean;
  materializedLiveTaskIds: number[];
  warnings: string[];
  generatedAt: number;
};

type MilestoneProgress = {
  milestoneId: string;
  label: string;
  status: "achieved" | "progressing" | "not_started" | "needs_confirmation";
  provenRequirementCount: number;
  partiallyProvenRequirementCount: number;
  totalRequirementCount: number;
};

type FeedbackModel = {
  mode: "execution_feedback_model";
  outcomes: ExecutionOutcomeRecord[];
  runs: ExecutionFeedbackRun[];
  milestones: MilestoneProgress[];
  pendingConfirmationCount: number;
};

type FeedbackResponse = {
  executionFeedbackModel?: FeedbackModel | null;
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  proven: "Evidenced",
  partially_proven: "Partly evidenced",
  unproven: "Not yet evidenced",
  unknown: "Not assessed