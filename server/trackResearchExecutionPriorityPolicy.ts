import type { ExecutionBlueprintModel } from "./trackResearchExecutionBlueprint";
import type {
  ExecutionPriorityContext,
  ExecutionPriorityModel,
  PrioritySlot,
} from "./trackResearchExecutionPriority";

export const MAX_ACTIVE_SLICE_WORKSTREAMS = 2;

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

function enforceWorkstreamLimit(
  selectedIds: string[],
  candidateById: Map<string, ExecutionPriorityModel["candidates"][number]>,
): { selectedIds: string[]; preservedWorkstreamOverflow: number; removedTaskIds: string[] } {
  const preserved = selectedIds.filter((id) => candidateById.get(id)?.liveState === "open");
  const preservedWorkstreams = new Set(preserved.map((id) => candidateById.get(id)?.workstreamId).filter(Boolean));
  const allowedWorkstreams = new Set(preservedWorkstreams);
  const kept = new Set(preserved);
  const removedTaskIds: string[] = [];

  for (const id of selectedIds) {
    if (kept.has(id)) continue;
    const candidate = candidateById.get(id);
    if (!candidate) continue;
    if (allowedWorkstreams.has(candidate.workstreamId)) {
      kept.add(id);
      continue;
    }
    if (allowedWorkstreams.size < MAX_ACTIVE_SLICE_WORKSTREAMS) {
      allowedWorkstreams.add(candidate.workstreamId);
      kept.add(id);
      continue;
    }
    removedTaskIds.push(id);
  }

  return {
    selectedIds: selectedIds.filter((id) => kept.has(id)),
    preservedWorkstreamOverflow: Math.max(0, preservedWorkstreams.size - MAX_ACTIVE_SLICE_WORKSTREAMS),
    removedTaskIds,
  };
}

export function hardenExecutionPriorityModel(
  model: ExecutionPriorityModel,
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
): ExecutionPriorityModel {
  const taskIds = new Set(blueprint.tasks.map((task) => task.id));
  const rawSelectedIds = Array.isArray(model.activeSlice.selectedTaskIds)
    ? model.activeSlice.selectedTaskIds.map((id) => String(id || "").trim()).filter((id) => taskIds.has(id))
    : [];
  const duplicateSelectedTaskIds = rawSelectedIds.filter((id, index, all) => all.indexOf(id) !== index);
  const requestedSelectedIds = uniqueStrings(rawSelectedIds);
  const candidateById = new Map(model.candidates.filter((candidate) => taskIds.has(candidate.taskId)).map((candidate) => [candidate.taskId, candidate]));
  const structurallySelectedIds = requestedSelectedIds.filter((id) => candidateById.get(id)?.selected);
  const workstreamPolicy = enforceWorkstreamLimit(structurallySelectedIds, candidateById);
  const selectedIds = workstreamPolicy.selectedIds;
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
        notNowReason: selected
          ? ""
          : workstreamPolicy.removedTaskIds.includes(candidate.taskId)
            ? "Deferred to keep the active slice within two workstreams and reduce context switching."
            : candidate.notNowReason,
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
  const overCapacityBy = Math.max(0, selectedCandidates.length - context.capacity.maxSelectedTasks);
  const caveats = model.quality.caveats.filter((caveat) => !/selected task has|role-specific task entered|duplicate blueprint task|preferred active-slice capacity|workstream/i.test(caveat));
  if (overCapacityBy > 0) caveats.push(`${overCapacityBy} existing active blueprint task${overCapacityBy === 1 ? " exceeds" : "s exceed"} the preferred active-slice capacity; Anchor preserved them rather than silently parking user work.`);
  if (workstreamPolicy.preservedWorkstreamOverflow > 0) caveats.push("Existing active work spans more than two workstreams. Anchor preserved it but will not add another workstream until the active set narrows.");
  if (workstreamPolicy.removedTaskIds.length) caveats.push(`${workstreamPolicy.removedTaskIds.length} ready task${workstreamPolicy.removedTaskIds.length === 1 ? " was" : "s were"} deferred to keep the active slice within two workstreams.`);
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
      duplicateSelectedTaskIds: uniqueStrings(duplicateSelectedTaskIds),
      overCapacityBy,
      caveats: [...new Set(caveats)],
    },
  };
}

export const executionPriorityPolicyInternals = {
  enforceWorkstreamLimit,
};
