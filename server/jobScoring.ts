import type { Contact, Job } from "@shared/schema";
import { llmJSON, MODEL_LIGHT } from "./llm";
import { storage } from "./storage";
import { buildUserContext, formatContextForPrompt, type UserContext } from "./userContext";

export type JobScorePatch = {
  fitScore?: number | null;
  strategicValue?: number | null;
  frictionScore?: number | null;
  warmPathScore?: number | null;
  narrativeAngle?: string;
  eligibilityRisk?: string;
};

type LlmJobScore = {
  fitScore?: unknown;
  strategicValue?: unknown;
  frictionScore?: unknown;
  narrativeAngle?: unknown;
  eligibilityRisk?: unknown;
};

const SCORE_RELEVANT_FIELDS = [
  "title",
  "company",
  "location",
  "note",
  "jdText",
  "roleArchetype",
  "eligibilityRisk",
  "relatedTrackId",
] as const;

const SCORE_FIELDS = ["fitScore", "strategicValue", "frictionScore", "warmPathScore", "narrativeAngle", "eligibilityRisk"] as const;

function norm(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function words(value: unknown) {
  return norm(value).split(" ").filter((word) => word.length >= 4);
}

function clampScore(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanText(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function hasCompanyMatch(job: Job, contact: Contact) {
  const company = norm(job.company);
  const targetOrg = norm(contact.targetOrg);
  if (!company || !targetOrg) return false;
  return company.includes(targetOrg) || targetOrg.includes(company);
}

function roleOverlapScore(job: Job, contact: Contact) {
  const roleWords = new Set(words(`${job.title} ${job.roleArchetype}`));
  const contactWords = words(`${contact.targetRole} ${contact.sector} ${contact.why}`);
  const overlap = contactWords.filter((word) => roleWords.has(word)).length;
  return Math.min(20, overlap * 7);
}

export function computeWarmPathScore(job: Job, contacts: Contact[]): number {
  let best = 0;
  for (const contact of contacts) {
    let score = 0;
    if (hasCompanyMatch(job, contact)) score += 45;
    if (job.relatedTrackId && contact.relatedTrackId === job.relatedTrackId) score += 25;
    score += roleOverlapScore(job, contact);
    if (score === 0) continue;

    if (contact.relationshipStrength === "strong") score += 25;
    else if (contact.relationshipStrength === "warm") score += 18;
    else if (contact.relationshipStrength === "cold") score += 5;

    if (contact.status === "replied") score += 15;
    else if (contact.status === "messaged") score += 10;
    if ((contact.messageDraft || "").trim()) score += 5;
    if (/referral|intro|introduc/i.test(`${contact.askType} ${contact.referralPotential} ${contact.why}`)) score += 8;

    best = Math.max(best, Math.min(100, score));
  }
  return best;
}

export function shouldRefreshJobScore(patch: Record<string, unknown>) {
  const changedFacts = SCORE_RELEVANT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
  const explicitScoreEdit = SCORE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
  return changedFacts && !explicitScoreEdit;
}

function shouldCallLlm(job: Job, force: boolean) {
  if (!process.env.OPENAI_API_KEY) return false;
  if (force) return true;
  return job.fitScore == null || job.strategicValue == null || job.frictionScore == null || !(job.narrativeAngle || "").trim();
}

export function buildJobScoringPrompt(job: Job, userContext: UserContext) {
  const roleFacts = {
    title: job.title,
    company: job.company,
    location: job.location,
    roleArchetype: job.roleArchetype,
    currentEligibilityRisk: job.eligibilityRisk,
    deadline: job.deadline,
    applicationReadiness: job.applicationReadiness,
    note: cleanText(job.note, 900),
    jdText: cleanText(job.jdText, 2200),
  };

  return [
    "You are scoring one saved job for a job-search planning system.",
    "Anchor remains the planner. Your job is bounded scoring evidence, not task planning.",
    "Use only the user/profile context and role facts below. Do not invent unstated job facts.",
    "",
    "Score definitions:",
    "- fitScore: 0-100. How credible is the user's background for this role based on evidence?",
    "- strategicValue: 0-100. How valuable is this role for the user's career direction, learning, access, geography, and narrative?",
    "- frictionScore: 0-100. How hard or costly is this application likely to be because of eligibility, location, seniority gap, unclear fit, missing materials, or effort?",
    "- narrativeAngle: one sentence, under 35 words, naming the strongest evidence bridge. Empty string if no credible bridge.",
    "- eligibilityRisk: keep current value if already meaningful; otherwise use \"\", \"likely_ineligible\", \"visa\", \"citizenship\", or \"phd\" only.",
    "",
    "Return ONLY JSON:",
    `{"fitScore":0,"strategicValue":0,"frictionScore":0,"narrativeAngle":"","eligibilityRisk":""}`,
    "",
    "USER CONTEXT:",
    formatContextForPrompt(userContext),
    "",
    "ROLE FACTS:",
    JSON.stringify(roleFacts),
  ].join("\n");
}

export function sanitizeJobScore(raw: LlmJobScore | null, job: Job): JobScorePatch {
  if (!raw || typeof raw !== "object") return {};
  const patch: JobScorePatch = {};
  const fitScore = clampScore(raw.fitScore);
  const strategicValue = clampScore(raw.strategicValue);
  const frictionScore = clampScore(raw.frictionScore);
  if (fitScore != null) patch.fitScore = fitScore;
  if (strategicValue != null) patch.strategicValue = strategicValue;
  if (frictionScore != null) patch.frictionScore = frictionScore;

  const narrativeAngle = cleanText(raw.narrativeAngle, 220);
  if (narrativeAngle) patch.narrativeAngle = narrativeAngle;

  const risk = cleanText(raw.eligibilityRisk, 40).toLowerCase();
  const allowed = new Set(["", "likely_ineligible", "visa", "citizenship", "phd"]);
  if (!(job.eligibilityRisk || "").trim() && allowed.has(risk)) patch.eligibilityRisk = risk;
  return patch;
}

export async function scoreJobNow(job: Job, opts: { forceLlm?: boolean } = {}): Promise<JobScorePatch> {
  const contacts = await storage.getContacts();
  const warmPathScore = computeWarmPathScore(job, contacts);
  const patch: JobScorePatch = { warmPathScore };

  if (shouldCallLlm(job, !!opts.forceLlm)) {
    const userContext = await buildUserContext();
    const prompt = buildJobScoringPrompt(job, userContext);
    const scored = await llmJSON<LlmJobScore>(prompt, { model: MODEL_LIGHT });
    Object.assign(patch, sanitizeJobScore(scored, job));
  }

  return patch;
}

export async function refreshJobScores(jobId: number, opts: { forceLlm?: boolean } = {}) {
  const job = await storage.getJob(jobId);
  if (!job) return null;
  const patch = await scoreJobNow(job, opts);
  if (!Object.keys(patch).length) return job;
  return storage.updateJob(job.id, patch as any);
}

export function refreshJobScoresInBackground(jobId: number, opts: { forceLlm?: boolean } = {}) {
  refreshJobScores(jobId, opts).catch((error) => {
    console.error("Job scoring skipped:", error);
  });
}
