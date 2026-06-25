import type { Task } from "@shared/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEADLINE_HORIZON_DAYS = 5;
const IGNORED_JOB_STATUSES = new Set(["archived", "rejected", "withdrawn", "offer_declined", "closed"]);

export type ProactiveSuggestionPreview = {
  signal: "deadline_job" | "overdue_contact" | "learn_for_deadline_job";
  sourceType: "job" | "contact" | "learn";
  sourceId: number;
  label: string;
  urgency: "high" | "medium";
  taskCreated: false;
  taskReused: boolean;
  taskId: number | null;
  requiresActivation: boolean;
};

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = new Date(String(value || "")).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function activeSourceTask(tasks: Task[], sourceType: string, sourceId: number) {
  return tasks.find((task) => !task.done && task.sourceType === sourceType && task.sourceId === sourceId) || null;
}

function preview(
  tasks: Task[],
  input: Omit<ProactiveSuggestionPreview, "taskCreated" | "taskReused" | "taskId" | "requiresActivation">,
): ProactiveSuggestionPreview {
  const existing = activeSourceTask(tasks, input.sourceType, input.sourceId);
  return {
    ...input,
    taskCreated: false,
    taskReused: Boolean(existing),
    taskId: existing?.id ?? null,
    requiresActivation: !existing,
  };
}

/**
 * Pure urgency scan. It deliberately returns previews rather than creating
 * tasks, so opening Today never changes the user's system.
 */
export function buildProactiveSuggestionPreviews(input: {
  tasks: Task[];
  jobs: any[];
  contacts: any[];
  learn: any[];
  nowMs?: number;
}): ProactiveSuggestionPreview[] {
  const nowMs = input.nowMs ?? Date.now();
  const suggestions: ProactiveSuggestionPreview[] = [];
  const deadlineJobIds = new Set<number>();

  for (const job of input.jobs) {
    if (!Number.isFinite(Number(job.id))) continue;
    if (IGNORED_JOB_STATUSES.has(String(job.status || "").toLowerCase())) continue;
    const deadlineMs = timestamp(job.deadline);
    if (deadlineMs == null) continue;
    const daysLeft = (deadlineMs - nowMs) / DAY_MS;
    if (daysLeft < 0 || daysLeft > DEADLINE_HORIZON_DAYS) continue;

    const sourceId = Number(job.id);
    deadlineJobIds.add(sourceId);
    suggestions.push(preview(input.tasks, {
      signal: "deadline_job",
      sourceType: "job",
      sourceId,
      label: `${job.title || "Role"} deadline ${daysLeft < 1 ? "today" : `in ${Math.ceil(daysLeft)}d`}`,
      urgency: daysLeft <= 1 ? "high" : "medium",
    }));
  }

  for (const contact of input.contacts) {
    if (!Number.isFinite(Number(contact.id))) continue;
    const followUpMs = timestamp(contact.nextFollowUpDate ?? contact.nextActionDue);
    if (followUpMs == null || followUpMs > nowMs) continue;
    const status = String(contact.status || "").toLowerCase();
    if (status === "cold" || status === "archived") continue;

    const sourceId = Number(contact.id);
    const daysOverdue = Math.max(0, Math.floor((nowMs - followUpMs) / DAY_MS));
    suggestions.push(preview(input.tasks, {
      signal: "overdue_contact",
      sourceType: "contact",
      sourceId,
      label: `Follow up with ${contact.name || contact.who || "contact"}${daysOverdue ? ` (${daysOverdue}d overdue)` : ""}`,
      urgency: daysOverdue >= 7 ? "high" : "medium",
    }));
  }

  for (const item of input.learn) {
    if (!Number.isFinite(Number(item.id))) continue;
    const linkedJobId = Number(item.relatedJobId ?? item.relatedOpportunityId);
    if (!Number.isFinite(linkedJobId) || !deadlineJobIds.has(linkedJobId)) continue;
    if (["done", "archived", "closed"].includes(String(item.learnStatus || "").toLowerCase())) continue;

    const sourceId = Number(item.id);
    suggestions.push(preview(input.tasks, {
      signal: "learn_for_deadline_job",
      sourceType: "learn",
      sourceId,
      label: `${item.title || "Learning item"} needed for deadline role`,
      urgency: "medium",
    }));
  }

  const signalOrder = { deadline_job: 0, overdue_contact: 1, learn_for_deadline_job: 2 } as const;
  return suggestions.sort((left, right) => {
    if (left.urgency !== right.urgency) return left.urgency === "high" ? -1 : 1;
    return signalOrder[left.signal] - signalOrder[right.signal];
  });
}
