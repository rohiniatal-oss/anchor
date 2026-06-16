import type { Task } from "@shared/schema";
import { buildTaskIntakeDefaults } from "./taskIntakeInference";

export function buildCaptureTaskPatch(task: Task, overrides: Record<string, unknown> = {}) {
  const inferred = buildTaskIntakeDefaults({
    title: task.title,
    category: task.category,
    size: task.size,
    estimateMinutes: task.estimateMinutes,
    estimateConfidence: task.estimateConfidence,
    estimateReason: task.estimateReason,
    doneWhen: task.doneWhen,
    steps: task.steps,
    minimumOutcome: task.minimumOutcome,
    readiness: task.readiness,
    blockerReason: task.blockerReason,
    status: task.status,
  });
  return {
    ...inferred,
    ...overrides,
  };
}
