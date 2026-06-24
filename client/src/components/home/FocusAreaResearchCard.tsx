import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Compass, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateAndInvalidate } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";
import { TrackResearchReview } from "@/components/home/TrackResearchReview";
import { TrackDevelopmentPlan } from "@/components/home/TrackDevelopmentPlan";
import { TrackExecutionPriority } from "@/components/home/TrackExecutionPriority";
import { TrackExecutionEvidence } from "@/components/home/TrackExecutionEvidence";
import { TrackExecutionBlueprint } from "@/components/home/TrackExecutionBlueprint";

type FocusAreaResearchCardProps = {
  onResearched?: (trackId?: number) => void;
};

type CareerTrackSummary = {
  id: number;
  name: string;
  description: string;
  priority: number;
  status: string;
  trackIntelligence: string;
  createdAt: number;
};

type SelectedTrackSummary = {
  id: number;
  name: string;
  summary: string;
  evidenceCount?: number;
};

type ActivationNotice = {
  state: "idle" | "pending" | "success" | "error";
  message: string;
};

const EXAMPLES = ["AI strategy", "geopolitical risk advisory", "government delivery roles"];
const ACTIVE_TARGET_STORAGE_KEY = "anchor.activeTargetTrackId";

function parseIntelligence(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hasTargetResearch(track: CareerTrackSummary): boolean {
  const intelligence = parseIntelligence(track.trackIntelligence);
  return intelligence.requirementModel?.mode === "requirement_model"
    || intelligence.coverageModel?.mode === "coverage_model"
    || intelligence.developmentPlanModel?.mode === "development_plan_model"
    || intelligence.executionBlueprintModel?.mode === "execution_blueprint_model";
}

function readStoredTargetId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const value = Number(window.localStorage.getItem(ACTIVE_TARGET_STORAGE_KEY));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function activationMessage(result: any): string {
  const materialization = result?.materializationResult;
  const created = Array.isArray(materialization?.created) ? materialization.created.length : 0;
  const reused = Array.isArray(materialization?.reused) ? materialization.reused.length : 0;
  const skipped = Array.isArray(materialization?.skipped) ? materialization.skipped : [];
  if (created) return `Anchor activated ${created} task${created === 1 ? "" : "s"} in This Week. Today will choose from them using your available time and energy.`;
  if (reused) return "The recommended work was already active, so Anchor created no duplicates.";
  if (skipped.length) return skipped[0]?.reason || "Anchor kept the plan but did not activate work because a safety condition changed.";
  return "The active slice is current and no additional live task was needed.";
}

async function invalidateTrackResearchModels(trackId?: number) {
  if (!trackId) return;
  await