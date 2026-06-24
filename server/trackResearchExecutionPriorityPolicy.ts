import type { ExecutionBlueprintModel } from "./trackResearchExecutionBlueprint";
import type {
  ExecutionPriorityContext,
  ExecutionPriorityModel,
  PrioritySlot,
} from "./trackResearchExecutionPriority";

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function correctedSlot(
  candidate: ExecutionPriorityModel["candidates"][number],
  nowTaskId: string | null,
): PrioritySlot {
  if (candidate.liveState === "completed") return "completed";
  if (!candidate.selected) {
    if (candidate.slot === "conditional" || candidate.dependencyState === "conditional") return "conditional";
    if (candidate.dependencyState === "unmet") return "blocked";
    return "later";
  }
  if (candidate.taskId === nowTaskId) return "now";
  if (candidate.liveState === "open") return "active";
  if (candidate.dependencyState === "selected_prerequisite" || candidate.dependencyState === "active_prerequisite") return "next";
  return "parallel";
}

export function hardenExecutionPriorityModel(
  model: ExecutionPriorityModel,
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
): ExecutionPriorityModel {
  const taskIds = new Set(blueprint.tasks.map((task) => task.id));
  const requestedSelectedIds = uniqueStrings(model.activeSlice.selectedTaskIds).filter((id) => taskIds.has(id));
  const candidateById = new Map(model.candidates.filter((candidate) => taskIds.has(candidate.taskId)).map((candidate) => [candidate.taskId, candidate]));
  const selectedIds = requestedSelectedIds.filter((id) => candidateById.get(id)?.selected);
  const selectedSet = new Set(selectedIds);
  const nowTaskId = selectedSet.has(model.activeSlice.nowTaskId || "") ? model.activeSlice.nowTaskId : selectedIds[0] || null;
  const candidates = model.candidates
    .filter((candidate) => taskIds.has(candidate.taskId))
    .map((candidate) => {
      const selected = selectedSet.has(candidate.taskId);
      const normalized = { ...candidate, selected };
      return {
        ...normalized,
        rank: selected ? selectedIds.indexOf(candidate.taskId) + 1 : 0,
        slot: correctedSlot(normalized, nowTaskId),
        whyNow: selected ? candidate.whyNow : "",
        notNowReason: selected ? "" : candidate.notNowReason,
      };
    })
    .sort((left, right) => {
      if (left.selected !== right.selected) return left.selected ? -1 : 1;
      if (left.selected && right.selected) return left.rank - right.rank;
      return right.score.total - left.score.total || left.title.localeCompare(right.title);
    });

  const selectedCandidates = candidates.filter((candidate) => candidate.selected);
  const blockedSelectedTaskIds = selectedCandidates.filter((candidate) => candidate.dependencyState === "unmet").map((candidate) => candidate.taskId);
  const conditionalSelectedTaskIds = selectedCandidates.filter((candidate) => candidate.dependencyState === "conditional" || candidate.slot === "conditional").map((candidate) => candidate.taskId);
  const duplicateSelectedTaskIds = requestedSelectedIds.filter((id, index, all) => all.indexOf(id) !== index);
  const overCapacityBy = Math.max(0, selectedCandidates.length - context.capacity.maxSelectedTasks);
  const caveats = model.quality.caveats.filter((caveat) => !/selected task has|role-specific task entered|duplicate blueprint task|preferred active-slice capacity/i.test(caveat));
  if (overCapacityBy > 0) caveats.push(`${overCapacityBy} existing active blueprint task${overCapacityBy === 1 ? " exceeds" : "s exceed"} the preferred active-slice capacity; Anchor preserved them rather than silently parking user work.`);
  if (blockedSelectedTaskIds.length) caveats.push("A selected task has an unmet prerequisite and cannot be materialized.");
  if (conditionalSelectedTaskIds.length) caveats.push("A role-specific task remains active from prior user action but will not be newly materialized into the shared slice.");
  if (duplicateSelectedTaskIds.length) caveats.push("The selected slice contained duplicate task references and was deduplicated.");
  const selectedDependencyCoverage = selectedCandidates.length
    ? Math.round((selectedCandidates.filter((candidate) => candidate.dependencyState !== "unmet").length / selectedCandidates.length) * 100)
    : 100;
  const qualityStatus: ExecutionPriorityModel["quality"]["status"] = blockedSelectedTaskIds.length || duplicateSelectedTaskIds.length
    ? selectedDependencyCoverage >= 80 ? "usable_with_caveats" : "provisional"
    : overCapacityBy > 0 || conditionalSelectedTaskIds.length || caveats.length > 0
      ? "usable_with_caveats"
      : "complete";
  const status: ExecutionPriorityModel["activeSlice"]["status"] = !blueprint.tasks.length
    ? "maintenance_only"
    : selectedCandidates.length === 0 && context.capacity.maxNewTasks === 0 && context.activeLoad.sameTrackOpen > 0
      ? "at_capacity"
      : selectedCandidates.length === 0
        ? "no_ready_work"
        : context.activeLoad.currentBlueprintOpen >= context.capacity.maxSelectedTasks && context.capacity.maxNewTasks === 0
          ? "at_capacity"
          : "ready";

  return {
    ...model,
    candidates,
    activeSlice: {
      ...model.activeSlice,
      status,
      maxTasks: context.capacity.maxSelectedTasks,
      selectedTaskIds: selectedIds,
      nowTaskId,
      activeTaskIds: candidates.filter((candidate) => candidate.selected && candidate.liveState === "open").map((candidate) => candidate.taskId),
      nextTaskIds: candidates.filter((candidate) => candidate.slot === "next").map((candidate) => candidate.taskId),
      parallelTaskIds: candidates.filter((candidate) => candidate.slot === "parallel").map((candidate) => candidate.taskId),
      newTaskIds: candidates.filter((candidate) => candidate.selected && candidate.liveState === "not_materialized").map((candidate) => candidate.taskId),
      existingActiveTaskIds: candidates.filter((candidate) => candidate.selected && candidate.liveState === "open").map((candidate) => candidate.taskId),
      deferredTaskCount: candidates.filter((candidate) => !candidate.selected && candidate.slot !== "completed").length,
      estimatedMinutes: selectedCandidates.reduce((sum, candidate) => sum + (candidate.effort === "quick" ? 15 : candidate.effort === "medium" ? 45 : candidate.effort === "deep" ? 90 : 180), 0),
      deepOrProjectTaskCount: selectedCandidates.filter((candidate) => candidate.effort === "deep" || candidate.effort === "project").length,
      userOwnedTaskCount: selectedCandidates.filter((candidate) => candidate.owner === "user").length,
      workstreamIds: uniqueStrings(selectedCandidates.map((candidate) => candidate.workstreamId)),
    },
    quality: {
      status: qualityStatus,
      selectedDependencyCoverage,
      blockedSelectedTaskIds,
      conditionalSelectedTaskIds,
      duplicateSelectedTaskIds,
      overCapacityBy,
      caveats: [...new Set(caveats)],
    },
  };
}
