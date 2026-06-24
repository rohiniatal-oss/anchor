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

function boundedSelectedIds(
  requestedSelectedIds: string[],
  candidateById: Map<string, ExecutionPriorityModel["candidates"][number]>,
  context: ExecutionPriorityContext,
): { selectedIds: string[]; deferredReasonById: Map<string, string> } {
  const deferredReasonById = new Map<string, string>();
  const selectedIds: string[] = [];
  const selectedSet = new Set<string>();
  const workstreamIds = new Set<string>();

  // Work already in motion is preserved even if it exceeds the preferred
  // capacity. Guardrails apply to newly selected work, not to silent parking.
  for (const id of requestedSelectedIds) {
    const candidate = candidateById.get(id);
    if (!candidate?.selected || candidate.liveState !== "open") continue;
    selectedIds.push(id);
    selectedSet.add(id);
    workstreamIds.add(candidate.workstreamId);
  }

  for (const id of requestedSelectedIds) {
    if (selectedSet.has(id)) continue;
    const candidate = candidateById.get(id);
    if (!candidate?.selected) continue;
    if (selectedIds.length >= context.capacity.maxSelectedTasks) {
      deferredReasonById.set(id, "Deferred because the current active slice is already at its safe task capacity.");
      continue;
    }
    const addsWorkstream = !workstreamIds.has(candidate.workstreamId);
    if (addsWorkstream && workstreamIds.size >= MAX_ACTIVE_SLICE_WORKSTREAMS) {
      deferredReasonById.set(id, "Deferred to keep the active slice focused across no more than two workstreams.");
      continue;
    }
    selectedIds.push(id);
    selectedSet.add(id);
    workstreamIds.add(candidate.workstreamId);
  }

  // If a newly selected task lost a prerequisite because of a policy cap, defer
  // it as well. Existing open work remains visible and is flagged as a caveat.
  let changed = true;
  while (changed) {
    changed = false;
    const currentSet = new Set(selectedIds);
    for (const id of [...selectedIds]) {
      const candidate = candidateById.get(id);
      if (!candidate || candidate.liveState === "open") continue;
      const missing = candidate.dependencyTaskIds.filter((dependencyId) => {
        const dependency = candidateById.get(dependencyId);
        return !currentSet.has(dependencyId) && dependency?.liveState !== "open" && dependency?.liveState !== "completed";
      });
      if (!missing.length) continue;
      const index = selectedIds.indexOf(id);
      if (index >= 0) selectedIds.splice(index, 1);
      deferredReasonById.set(id, "Deferred because a prerequisite is not active, completed or included in the bounded slice.");
      changed = true;
    }
  }

  return { selectedIds, deferredReasonById };
}

export function hardenExecutionPriorityModel(
  model: ExecutionPriorityModel,
  blueprint: ExecutionBlueprintModel,
  context: ExecutionPriorityContext,
): ExecutionPriorityModel {
  const taskIds = new Set(blueprint.tasks.map((task) => task.id));
  const requestedSelectedIds = uniqueStrings(model.activeSlice.selectedTaskIds).filter((id) => taskIds.has(id));
  const candidateById = new Map(model.candidates.filter((candidate) => taskIds.has(candidate.taskId)).map((candidate) => [candidate.taskId, candidate]));
  const bounded = boundedSelectedIds(requestedSelectedIds, candidateById, context);
  const selectedIds = bounded.selectedIds;
  const selectedSet = new Set(selectedIds);
  const preferredNowId = selectedSet.has(model.activeSlice.nowTaskId || "") ? model.activeSlice.nowTaskId : null;
  const nowTaskId = preferredNowId
    || selectedIds.find((id) => candidateById.get(id)?.liveState === "open")
    || selectedIds[0]
    || null;
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
          : bounded.deferredReasonById.get(candidate.taskId)
            || candidate.notNowReason
            || "Deferred after applying readiness, evidence value and active-load guardrails.",
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
  const selectedWorkstreamIds = uniqueStrings(selectedCandidates.map((candidate) => candidate.workstreamId));
  const newSelectedWorkstreamIds = uniqueStrings(selectedCandidates.filter((candidate) => candidate.liveState !== "open").map((candidate) => candidate.workstreamId));
  const workstreamLimitExceeded = newSelectedWorkstreamIds.length > MAX_ACTIVE_SLICE_WORKSTREAMS;
  const caveats = model.quality.caveats.filter((caveat) => !/selected task has|role-specific task entered|duplicate blueprint task|preferred active-slice capacity|workstreams/i.test(caveat));
  if (overCapacityBy > 0) caveats.push(`${overCapacityBy} existing active blueprint task${overCapacityBy === 1 ? " exceeds" : "s exceed"} the preferred active-slice capacity; Anchor preserved them rather than silently parking user work.`);
  if (selectedWorkstreamIds.length > MAX_ACTIVE_SLICE_WORKSTREAMS && selectedCandidates.some((candidate) => candidate.liveState === "open")) caveats.push("Existing work spans more than two workstreams; Anchor preserved it but selected no additional workstream beyond the focused limit.");
  if (workstreamLimitExceeded) caveats.push("Newly selected work exceeded the two-workstream focus limit.");
  if (blockedSelectedTaskIds.length) caveats.push("A selected task has an unmet prerequisite and cannot be materialized.");
  if (conditionalSelectedTaskIds.length) caveats.push("A role-specific task remains active from prior user action but will not be newly materialized into the shared slice.");
  if (duplicateSelectedTaskIds.length) caveats.push("The selected slice contained duplicate task references and was deduplicated.");
  const selectedDependencyCoverage = selectedCandidates.length
    ? Math.round((selectedCandidates.filter((candidate) => candidate.dependencyState !== "unmet").length / selectedCandidates.length) * 100)
    : 100;
  const qualityStatus: ExecutionPriorityModel["quality"]["status"] = blockedSelectedTaskIds.length || duplicateSelectedTaskIds.length || workstreamLimitExceeded
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
      workstreamIds: selectedWorkstreamIds,
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
