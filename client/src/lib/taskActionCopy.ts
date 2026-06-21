import type { TrackedEntity } from "@shared/domainState";

type TaskActionEntity = Exclude<TrackedEntity, "tasks">;

export function taskActionLabelForEntity(entity: TaskActionEntity): string {
  if (entity === "jobs") return "Plan next job step";
  if (entity === "learn") return "Plan next learning step";
  if (entity === "contacts") return "Plan outreach step";
  return "Plan project step";
}

export function taskCreatedLabelForEntity(entity: TaskActionEntity): string {
  if (entity === "jobs") return "Job step added.";
  if (entity === "learn") return "Learning step added.";
  if (entity === "contacts") return "Outreach step added.";
  return "Project step added.";
}

export function noLinkedTasksHelp(actionLabel: string): string {
  return `Use '${actionLabel}' to make one.`;
}

export function taskPreviewHint(previewTitle: string, openTaskTitle?: string | null): string {
  const openTitle = String(openTaskTitle || "").trim();
  if (openTitle) return `Open task: "${openTitle}"`;
  return `Likely next task: "${previewTitle}"`;
}

export function taskToastDescription(
  result: { title?: string | null; reused?: boolean } | null | undefined,
  fallbackExisting: string,
): string {
  const title = String(result?.title || "").trim();
  if (result?.reused) return title ? `Open task: "${title}".` : fallbackExisting;
  return title
    ? `Added "${title}". Find it in Capture, or in Today if it gets planned.`
    : "Find it in Capture, or in Today if it gets planned.";
}
