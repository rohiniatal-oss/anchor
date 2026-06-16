import type { Contact, Hustle, Job, Learn } from "./schema";

export function nextJobTaskTitle(j: Pick<Job, "title" | "company" | "nextStep">): string {
  return j.nextStep?.trim() || `Advance application: ${j.title}${j.company ? ` @ ${j.company}` : ""}`;
}

export function nextLearnTaskTitle(l: Pick<Learn, "title" | "requiredOutput">): string {
  const reusable = String(l.requiredOutput || "").trim();
  return reusable ? `Create reusable result: ${reusable}` : `Work through: ${l.title}`;
}

export function nextContactTaskTitle(c: Pick<Contact, "who" | "name" | "askType">): string {
  const target = c.who || c.name || "contact";
  return `Draft ${c.askType || "soft"} outreach to ${target}`;
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
