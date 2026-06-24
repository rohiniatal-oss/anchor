import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  FileCheck2,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCw,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { mutateAndInvalidate } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";

type BlueprintOwner = "anchor" | "user" | "shared";
type PrioritySlot = "now" | "next" | "support";
type ActiveSliceAction = "continue_live_task" | "prepare_by_anchor" | "prepare_then_materialize" | "materialize_user_task";

type ActiveExecutionSliceItem = {
  rank: number;
  slot: PrioritySlot;
  blueprintTaskId: string;
  liveTaskId: number | null;
  action: ActiveSliceAction;
  score: number;
  reason: string;
  title: string;
  owner: BlueprintOwner;
  effort: "quick" | "medium" | "deep" | "project";
  expectedEvidence: string;
  workstreamId: string;
  moduleId: string;
};

type AnchorPreparationArtifact = {
  id: string;
  blueprintTaskId: string;
  title: string;
  summary: string;
  outputMarkdown: string;
  sources: Array<{ title: string; url: string }>;
  needsUserInput: boolean;
  focusedQuestion: string;
  confidence: "high" | "medium" | "low";
  generatedAt: number;
};

type ExecutionActivationRecord = {
  blueprintTaskId: string;
  status: "completed_by_anchor" | "prepared" | "materialized" | "completed" | "needs_user_input" | "failed";
  liveTaskId: number | null;
  preparation: AnchorPreparationArtifact | null;
  error: string;
  updatedAt: number;
};

type ExecutionPriorityModel = {
  mode: "execution_priority_model";
  targetLabel: string;
  objective: string;
  activeSlice: ActiveExecutionSliceItem[];
  completedBlueprintTaskIds: string[];
  summary: {
    totalBlueprintTasks: number;
    completedTasks: number;
    activeLiveTasks: number;
    eligibleTasks: number;
    blockedTasks: number;
    conditionalTasks: number;
    selectedTasks: number;
    selectedUserVisibleTasks: number;
    selectedAnchorTasks: number;
  };
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    caveats: string[];
  };
};

type PriorityResponse = {
  executionPriorityModel?: ExecutionPriorityModel | null;
  executionActivationState?: {
    records: ExecutionActivationRecord[];
  } | null;
  activation?: {
    createdTaskIds: number[];
    reusedTaskIds: number[];
    completedByAnchorTaskIds: string[];
    failedBlueprintTaskIds: string[];
  };
};

const OWNER_META: Record<BlueprintOwner, { label: string; detail: string; icon: typeof Bot; tone: string }> = {
  anchor: {
    label: "Anchor prepares",
    detail: "Anchor can do the analytical or drafting work without adding a user task.",
    icon: Bot,
    tone: "bg-primary/10 text-primary",
  },
  shared: {
    label: "Shared",
    detail: "Anchor prepares the structure; you provide judgement, learning or the real-world action.",
    icon: UsersRound,
    tone: "bg-sky-50 text-sky-700",
  },
  user: {
    label: "You do",
    detail: "The value depends on your learning, practice or external action.",
    icon: UserRound,
    tone: "bg-violet-50 text-violet-700",
  },
};

const SLOT_LABEL: Record<PrioritySlot, string> = {
  now: "Now",
  next: "Next",
  support: "Anchor support",
};

const EFFORT_LABEL = {
  quick: "Quick",
  medium: "Focused",
  deep: "Deep work",
  project: "Project",
} as const;

const QUALITY_META = {
  complete: { label: "Selection checks passed", tone: "bg-emerald-50 text-emerald-700" },
  usable_with_caveats: { label: "Conservative selection", tone: "bg-sky-50 text-sky-700" },
  provisional: { label: "Selection needs review", tone: "bg-amber-50 text-amber-800" },
} as const;

function list(values?: string[]) {
  return (values || []).map((value) => String(value || "").trim()).filter(Boolean);
}

function SliceItem({ item, record }: { item: ActiveExecutionSliceItem; record?: ExecutionActivationRecord }) {
  const owner = OWNER_META[item.owner];
  const OwnerIcon = owner.icon;
  const live = Boolean(item.liveTaskId || record?.liveTaskId);
  const completedByAnchor = record?.status === "completed_by_anchor";
  return (
    <div className={`rounded-xl border p-3 ${item.slot === "now" ? "border-primary/30 bg-primary/[0.04]" : "border-card-border bg-card"}`}>
      <