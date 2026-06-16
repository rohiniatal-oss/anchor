import type { Task } from "@shared/schema";

export function useLinkedTaskCount(tasks: Task[], sourceType: string, sourceId: number) {
  return tasks.filter((t) => t.sourceType === sourceType && t.sourceId === sourceId && !t.done).length;
}

export function findOpenLinkedTask(tasks: Task[], sourceType: string, sourceId: number) {
  return tasks.find((t) => t.sourceType === sourceType && t.sourceId === sourceId && !t.done);
}
