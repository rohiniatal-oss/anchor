import type { Contact, Hustle, Job, Learn } from "./schema";

function compactText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripLeadingArticle(value: string) {
  return compactText(value).replace(/^(a|an)\s+/i, "").trim();
}

export function normalizeContactWho(value: string | null | undefined) {
  return compactText(value)
    .replace(/^(draft\s+.*?\s+to|draft\s+.*?\s+for|reach out to|message|email|reply to|follow up with|follow-up with|reconnect with|contact)\s+/i, "")
    .replace(/\babout\b.*$/i, "")
    .replace(/\bregarding\b.*$/i, "")
    .replace(/\band ask\b.*$/i, "")
    .replace(/\bask for\b.*$/i, "")
    .trim();
}

function inferredContactTopic(value: string | null | undefined) {
  const text = compactText(value);
  const match = text.match(/\babout\s+(.+?)(?:\s+\band ask\b|\s+\bask for\b|\s+\bfor\b\s+(?:a|an)\s+\d+|\s+\bfor\b\s+15|\s+\bfor\b\s+fifteen|$)/i)
    || text.match(/\bregarding\s+(.+?)(?:\s+\band ask\b|\s+\bask for\b|$)/i);
  return compactText(match?.[1] || "");
}

const GENERIC_CONTACT_HINT = /\b(alum|alumni|alumna|alumnus|advisor|recruiter|hiring manager|manager|director|lead|team|person|people|founder|operator|investor|researcher|engineer|policy|strategy)\b/i;

export function isGenericContactPlaceholder(c: Pick<Contact, "name" | "who">) {
  const explicitName = compactText(c.name);
  if (explicitName) return false;
  const who = normalizeContactWho(c.who);
  if (!who) return true;
  if (/^(a|an|any|some|someone|somebody|one|the right)\b/i.test(who)) return true;
  return GENERIC_CONTACT_HINT.test(who);
}

export function contactTopicHint(c: Pick<Contact, "who" | "targetRole">) {
  return compactText(c.targetRole) || inferredContactTopic(c.who);
}

function placeholderContactLabel(c: Pick<Contact, "who" | "targetOrg" | "targetRole">) {
  return stripLeadingArticle(normalizeContactWho(c.who)) || stripLeadingArticle(contactTopicHint(c)) || stripLeadingArticle(c.targetOrg) || "relevant contact";
}

export function nextJobTaskTitle(j: Pick<Job, "title" | "company" | "nextStep">): string {
  return j.nextStep?.trim() || `Advance application: ${j.title}${j.company ? ` @ ${j.company}` : ""}`;
}

export function nextLearnTaskTitle(l: Pick<Learn, "title" | "requiredOutput">): string {
  const reusable = String(l.requiredOutput || "").trim();
  return reusable ? `Create reusable result: ${reusable}` : `Work through: ${l.title}`;
}

export function nextContactTaskTitle(c: Pick<Contact, "who" | "name" | "askType" | "targetOrg" | "targetRole" | "status" | "messageDraft">): string {
  const target = compactText(c.name) || normalizeContactWho(c.who) || "contact";
  const orgRole = [contactTopicHint(c), c.targetOrg].filter(Boolean).join(" at ");
  const about = orgRole ? ` about ${orgRole}` : "";
  if (isGenericContactPlaceholder(c)) {
    const label = placeholderContactLabel(c);
    return orgRole ? `Find one ${label} to ask about ${orgRole}` : `Find one ${label} to contact`;
  }
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
