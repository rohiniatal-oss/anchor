import type { Contact, Hustle, Job, Learn } from "./schema";

export function nextJobTaskTitle(j: Pick<Job, "title" | "company" | "nextStep">): string {
  return j.nextStep?.trim() || `Advance application: ${j.title}${j.company ? ` @ ${j.company}` : ""}`;
}

export function nextLearnTaskTitle(l: Pick<Learn, "title" | "requiredOutput">): string {
  const reusable = String(l.requiredOutput || "").trim();
  return reusable ? `Create reusable result: ${reusable}` : `Work through: ${l.title}`;
}

export function nextContactTaskTitle(c: Pick<Contact, "who" | "name" | "askType" | "targetOrg" | "targetRole" | "status" | "messageDraft">): string {
  const target = c.who || c.name || "contact";
  const orgRole = [c.targetRole, c.targetOrg].filter(Boolean).join(" at ");
  const about = orgRole ? ` about ${orgRole}` : "";
  if (c.status === "replied" || c.status === "in_conversation") return `Reply to ${target}${about}`;
  if (c.status === "messaged") return `Follow up with ${target}${about}`;
  if (c.messageDraft?.trim()) return `Send the drafted message to ${target}${about}`;
  if (c.askType === "referral") return `Draft a referral ask to ${target}${about}`;
  if (c.askType === "follow_up") return `Draft a follow-up note to ${target}${about}`;
  if (c.askType === "reconnect") return `Draft a reconnect note to ${target}${about}`;
  return `Draft a 15-minute chat ask to ${target}${about}`;
}

export function nextHustleTaskTitle(h: Pick<Hustle, "title" | "nextStep">): string {
  return h.nextStep?.trim() || `Advance project/public work: ${h.title}`;
}

export function materializedJobStepTaskTitle(
  stepLabel: string,
  j?: Pick<Job, "title" | "company"> | null,
): string {
  const suffix = j ? `: ${j.title}${j.company ? ` @ ${j.company}` : ""}` : "";
  return `${stepLabel.trim()}${suffix}`;
}

export function materializedProofStepTaskTitle(
  stepLabel: string,
  h?: Pick<Hustle, "title"> | null,
): string {
  return `${stepLabel.trim()}${h ? `: ${h.title}` : ""}`;
}
