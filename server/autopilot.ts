/**
 * autopilot.ts
 *
 * The "run everything for me" engine.
 *
 * Scans all live data every time Today loads and produces a ranked list
 * of ProposedActions — tasks Anchor *should have already put in front of
 * the user* but hasn't.  Highest-urgency proposal wins and gets surfaced
 * automatically on the Today view without the user navigating anywhere.
 *
 * Priority order (highest → lowest):
 *   1. Deadline-urgent job applications (deadline ≤ 3 days, not submitted)
 *   2. Warm contacts with no follow-up in 7+ days
 *   3. Open captures in Brain Dump never sorted
 *   4. Learn items active but no linked tasks this week
 *   5. Wishlist jobs with no tasks at all
 */

import { storage } from "./storage";
import { isJobLive, isContactWarm } from "@shared/domainState";

export type ProposedAction = {
  title: string;
  reason: string;
  sourceType: "job" | "contact" | "learn" | "capture" | "hustle";
  sourceId: number;
  urgency: "critical" | "high" | "normal";
  existingTaskId?: number;
};

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function formatDeadline(deadline: string): string {
  const d = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export async function computeAutopilotProposals(
  limit = 5,
): Promise<ProposedAction[]> {
  const now = new Date();
  const weekAgo = Date.now() - 7 * 86_400_000;
  const proposals: ProposedAction[] = [];

  const [jobs, contacts, tasks, captures, learns] = await Promise.all([
    storage.getJobs(),
    storage.getContacts(),
    storage.getTasks(),
    storage.getCaptures(),
    storage.getLearn(),
  ]);

  const openTaskIndex = new Map<string, number[]>();
  for (const t of tasks) {
    if (t.status === "done" || t.status === "archived") continue;
    if (!t.sourceType || !t.sourceId) continue;
    const key = `${t.sourceType}:${t.sourceId}`;
    const existing = openTaskIndex.get(key) ?? [];
    existing.push(t.id);
    openTaskIndex.set(key, existing);
  }

  // 1. Deadline-urgent jobs
  for (const job of jobs) {
    if (!isJobLive(job)) continue;
    if (!job.deadline) continue;
    if (job.applicationReadiness === "submitted") continue;
    const deadline = new Date(`${job.deadline}T00:00:00`);
    const daysLeft = daysBetween(now, deadline);
    if (daysLeft < 0 || daysLeft > 3) continue;
    const existingTasks = openTaskIndex.get(`job:${job.id}`) ?? [];
    proposals.push({
      title: `Apply to ${job.title} at ${job.company}`,
      reason: `Deadline ${formatDeadline(job.deadline)} — ${daysLeft === 0 ? "today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}. Readiness: ${job.applicationReadiness || "not started"}.`,
      sourceType: "job",
      sourceId: job.id,
      urgency: daysLeft <= 1 ? "critical" : "high",
      existingTaskId: existingTasks[0],
    });
  }

  // 2. Warm contacts, no recent follow-up
  for (const contact of contacts) {
    if (!isContactWarm(contact)) continue;
    const existingTasks = openTaskIndex.get(`contact:${contact.id}`) ?? [];
    if (existingTasks.length > 0) continue;
    const lastTouch = contact.lastMessageAt
      ? new Date(contact.lastMessageAt).getTime()
      : contact.updatedAt
        ? new Date(contact.updatedAt).getTime()
        : 0;
    if (lastTouch > weekAgo) continue;
    proposals.push({
      title: `Follow up with ${contact.name}`,
      reason: `Warm contact${contact.targetOrg ? ` at ${contact.targetOrg}` : ""} — no outreach in 7+ days, no open task.`,
      sourceType: "contact",
      sourceId: contact.id,
      urgency: "high",
    });
  }

  // 3. Unsorted brain dump captures
  const unsorted = captures.filter(
    (c: any) => c.status === "unsorted" || c.route === "inbox",
  );
  if (unsorted.length >= 3) {
    proposals.push({
      title: `Sort ${unsorted.length} Brain Dump item${unsorted.length === 1 ? "" : "s"}`,
      reason: `${unsorted.length} captured ideas waiting to be routed to Jobs, Learn, or Network.`,
      sourceType: "capture",
      sourceId: unsorted[0].id,
      urgency: "normal",
    });
  }

  // 4. Active learn items with no task this week
  for (const learn of learns) {
    if (!learn.active || (learn as any).learnStatus === "done") continue;
    const existingTasks = openTaskIndex.get(`learn:${learn.id}`) ?? [];
    const hasRecentTask = existingTasks.some((tid) => {
      const t = tasks.find((x) => x.id === tid);
      return t && (t.updatedAt ? new Date(t.updatedAt).getTime() > weekAgo : false);
    });
    if (hasRecentTask) continue;
    proposals.push({
      title: `Advance: ${learn.title}`,
      reason: `Active but no task this week.${learn.capabilityBuilt ? ` Builds: ${learn.capabilityBuilt}.` : ""} One step keeps momentum.`,
      sourceType: "learn",
      sourceId: learn.id,
      urgency: "normal",
      existingTaskId: existingTasks[0],
    });
  }

  // 5. Wishlist jobs with zero tasks
  for (const job of jobs) {
    if (job.status !== "wishlist") continue;
    if ((openTaskIndex.get(`job:${job.id}`) ?? []).length > 0) continue;
    proposals.push({
      title: `Start application: ${job.title} at ${job.company}`,
      reason: `On your wishlist with no tasks. One task turns a wish into a move.`,
      sourceType: "job",
      sourceId: job.id,
      urgency: "normal",
    });
    if (proposals.length >= limit) break;
  }

  const rank = { critical: 0, high: 1, normal: 2 };
  proposals.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
  return proposals.slice(0, limit);
}
