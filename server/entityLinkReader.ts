/**
 * entityLinkReader.ts
 *
 * Makes the entityLinks graph READABLE.
 *
 * resolveTaskConnections(task) walks the graph both directions and returns:
 *   - relatedJobs:     live applications this task moves forward
 *   - relatedContacts: warm contacts relevant to this task
 *   - relatedLearn:    learn items that build needed capability
 *   - whyItMatters:    one human sentence tying it together
 *
 * Used by:
 *   - Task breakdown prompt (fixes context bug — pass connections as context)
 *   - Today view ("connects to" chip on each task card)
 *   - Autopilot engine (ranks proposals by connection density)
 */

import { storage } from "./storage";
import { isJobLive, isContactWarm, getTrackId } from "@shared/domainState";
import type { Task } from "@shared/schema";

export type TaskConnections = {
  relatedJobs: Array<{ id: number; title: string; company: string; status: string }>;
  relatedContacts: Array<{ id: number; name: string; targetOrg?: string; relationshipStrength?: string }>;
  relatedLearn: Array<{ id: number; title: string; capabilityBuilt?: string }>;
  whyItMatters: string;
};

export async function resolveTaskConnections(task: Task): Promise<TaskConnections> {
  const [jobs, contacts, learns, entityLinks] = await Promise.all([
    storage.getJobs(),
    storage.getContacts(),
    storage.getLearn(),
    typeof (storage as any).getEntityLinks === "function"
      ? (storage as any).getEntityLinks()
      : Promise.resolve([]),
  ]);

  const relatedJobs: TaskConnections["relatedJobs"] = [];
  const relatedContacts: TaskConnections["relatedContacts"] = [];
  const relatedLearn: TaskConnections["relatedLearn"] = [];

  const addJob = (id: number) => {
    if (relatedJobs.find((r) => r.id === id)) return;
    const job = jobs.find((j) => j.id === id);
    if (job && isJobLive(job)) relatedJobs.push({ id: job.id, title: job.title, company: job.company, status: job.status });
  };
  const addContact = (id: number) => {
    if (relatedContacts.find((r) => r.id === id)) return;
    const c = contacts.find((x) => x.id === id);
    if (c && isContactWarm(c)) relatedContacts.push({ id: c.id, name: c.name, targetOrg: c.targetOrg ?? undefined, relationshipStrength: c.relationshipStrength ?? undefined });
  };
  const addLearn = (id: number) => {
    if (relatedLearn.find((r) => r.id === id)) return;
    const l = learns.find((x) => x.id === id);
    if (l) relatedLearn.push({ id: l.id, title: l.title, capabilityBuilt: l.capabilityBuilt ?? undefined });
  };

  // Direct source
  if (task.sourceType === "job" && task.sourceId) addJob(task.sourceId);
  if (task.sourceType === "contact" && task.sourceId) addContact(task.sourceId);
  if (task.sourceType === "learn" && task.sourceId) addLearn(task.sourceId);

  // Walk entityLinks graph
  for (const link of entityLinks as any[]) {
    if (link.fromType === task.sourceType && link.fromId === task.sourceId) {
      if (link.toType === "job") addJob(link.toId);
      if (link.toType === "contact") addContact(link.toId);
      if (link.toType === "learn") addLearn(link.toId);
    }
    if (link.toType === task.sourceType && link.toId === task.sourceId) {
      if (link.fromType === "job") addJob(link.fromId);
      if (link.fromType === "contact") addContact(link.fromId);
    }
  }

  // Track-scoped fallback
  const trackId = (task as any).relatedTrackId ?? null;
  if (trackId != null && relatedJobs.length === 0) {
    jobs
      .filter((j) => isJobLive(j) && getTrackId("jobs", j) === trackId)
      .slice(0, 3)
      .forEach((j) => addJob(j.id));
  }

  // Build whyItMatters
  const parts: string[] = [];
  if (relatedJobs.length > 0) {
    parts.push(
      relatedJobs.length === 1
        ? `Moves your application to ${relatedJobs[0].title} at ${relatedJobs[0].company} forward.`
        : `Connects to ${relatedJobs.length} live applications.`,
    );
  }
  if (relatedContacts.length > 0) {
    const names = relatedContacts.slice(0, 2).map((c) => c.name).join(" and ");
    parts.push(`${names} ${relatedContacts.length === 1 ? "is" : "are"} a relevant warm contact.`);
  }
  if (relatedLearn.length > 0 && parts.length === 0) {
    parts.push(`Builds ${relatedLearn[0].capabilityBuilt || relatedLearn[0].title}.`);
  }

  return {
    relatedJobs: relatedJobs.slice(0, 3),
    relatedContacts: relatedContacts.slice(0, 3),
    relatedLearn: relatedLearn.slice(0, 3),
    whyItMatters: parts.join(" "),
  };
}
