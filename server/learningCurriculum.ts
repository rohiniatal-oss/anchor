/**
 * LLM-powered learning curriculum generator.
 *
 * Produces a structured learning arc: orient → mechanism → synthesise →
 * position → transfer → artifact. Content must be grounded in job evidence
 * and track context.
 */

import { storage } from "./storage";
import { llm, llmJSON } from "./llm";
import { COACH_PREAMBLE } from "./coachPreamble";
import type { CareerTrack, Hustle, Job, Learn } from "@shared/schema";

type LearnPhase = "orient" | "mechanism" | "synthesise" | "position" | "transfer" | "artifact";

export type LearningCurriculumItem = {
  title: string;
  rationale: string;
  phase: LearnPhase;
  format: "reading" | "watching" | "doing" | "writing" | "connecting" | "reflecting";
  estimatedHours: number;
  outputNote: string;
  capabilityBuilt: string;
  suggestedResource?: string;
};

export type JobPrepArcItem = {
  title: string;
  rationale: string;
  phase: "understand" | "evidence" | "materials" | "network" | "interview";
  stepsHint: string[];
};

const MAX_CURRICULUM_ITEMS = 8;
const MAX_PREP_ARC_ITEMS = 5;

// ─── helpers ──────────────────────────────────────────────────────────────────

function cvExcerptForKeywords(cv: string, keywords: string[]): string {
  if (!cv.trim()) return "";
  const blocks = cv.split(/\n{2,}/).filter((b) => b.trim().length > 20);
  if (blocks.length <= 3) return cv.slice(0, 1200);
  const lower = keywords.map((k) => k.toLowerCase());
  const scored = blocks.map((block) => ({
    block,
    score: lower.reduce((n, k) => n + (block.toLowerCase().includes(k) ? 1 : 0), 0),
  }));
  const [first, ...rest] = scored;
  const sorted = rest.sort((a, b) => b.score - a.score);
  let result = first.block;
  for (const { block } of sorted) {
    if ((result + "\n\n" + block).length > 1200) break;
    result += "\n\n" + block;
  }
  return result.slice(0, 1200);
}

// ─── generateContactArchetypes ────────────────────────────────────────────────

export async function generateContactArchetypes(track: CareerTrack): Promise<void> {
  const existing = (track as any).contactArchetypes;
  if (Array.isArray(existing) && existing.length > 0) return;

  const prompt =
    COACH_PREAMBLE +
    `Track: "${track.name}".\n` +
    `Description: ${track.description || "(none)"}.\n\n` +
    `List the 6 most strategically valuable contact archetypes for someone targeting this track. ` +
    `Each archetype = a short noun phrase (e.g. "Former FCDO policy adviser", "AI product lead at scale-up"). ` +
    `Return JSON: { archetypes: string[] }`;

  try {
    const result = await llmJSON<{ archetypes: string[] }>(prompt);
    const archetypes = result?.archetypes;
    if (Array.isArray(archetypes) && archetypes.length > 0) {
      await storage.updateCareerTrack(track.id, { contactArchetypes: archetypes.slice(0, 6) } as any);
    }
  } catch {
    // non-fatal
  }
}

// ─── generateLearningCurriculum ───────────────────────────────────────────────

export async function generateLearningCurriculum(
  track: CareerTrack,
  force = false,
): Promise<LearningCurriculumItem[]> {
  const existing = (track as any).curriculumItems;
  if (!force && Array.isArray(existing) && existing.length > 0) return existing;

  const profile = await storage.getProfile();
  const cv = profile?.cvText || "";
  const keywords = [track.name, ...(track.description || "").split(" ").slice(0, 6)];
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  const prompt =
    COACH_PREAMBLE +
    `Career track: "${track.name}".\n` +
    `Track description: ${track.description || "(none)"}.\n` +
    (cvExcerpt ? `Candidate background:\n${cvExcerpt}\n\n` : "") +
    `Design a learning curriculum of ${MAX_CURRICULUM_ITEMS} items that builds real credibility for this track. ` +
    `Phases (use each at least once): orient, mechanism, synthesise, position, transfer, artifact. ` +
    `Each item: title (action phrase), rationale (1 sentence why this item), phase, ` +
    `format (reading/watching/doing/writing/connecting/reflecting), estimatedHours (integer), ` +
    `outputNote (what the learner produces), capabilityBuilt (skill gained), suggestedResource (optional URL or book). ` +
    `Return JSON: { items: LearningCurriculumItem[] }`;

  try {
    const result = await llmJSON<{ items: LearningCurriculumItem[] }>(prompt);
    const items = result?.items;
    if (Array.isArray(items) && items.length > 0) {
      const valid = items.slice(0, MAX_CURRICULUM_ITEMS);
      await storage.updateCareerTrack(track.id, { curriculumItems: valid } as any);
      return valid;
    }
  } catch {
    // non-fatal
  }
  return [];
}

// ─── generateJobPrepArc ───────────────────────────────────────────────────────

export async function generateJobPrepArc(job: Job): Promise<void> {
  const existing = (job as any).prepArc;
  if (Array.isArray(existing) && existing.length > 0) return;

  const jd = (job.jdText || "").trim();
  if (!jd) return;

  const profile = await storage.getProfile();
  const cv = profile?.cvText || "";
  const keywords = [job.title, job.company, job.roleArchetype || ""].filter(Boolean);
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  const prompt =
    COACH_PREAMBLE +
    `Job: ${job.title} at ${job.company}.\n` +
    (job.roleArchetype ? `Role archetype: ${job.roleArchetype}.\n` : "") +
    `JD (excerpt):\n${jd.slice(0, 1500)}\n\n` +
    (cvExcerpt ? `Candidate CV (excerpt):\n${cvExcerpt}\n\n` : "") +
    `Generate a ${MAX_PREP_ARC_ITEMS}-step prep arc for this specific role. ` +
    `Phases in order: understand → evidence → materials → network → interview. ` +
    `Each step: title (action phrase), rationale (1 sentence), phase, stepsHint (2-3 concrete sub-actions). ` +
    `Return JSON: { arc: JobPrepArcItem[] }`;

  try {
    const result = await llmJSON<{ arc: JobPrepArcItem[] }>(prompt);
    const arc = result?.arc;
    if (Array.isArray(arc) && arc.length > 0) {
      await storage.updateJob(job.id, { prepArc: arc.slice(0, MAX_PREP_ARC_ITEMS) } as any);
    }
  } catch {
    // non-fatal
  }
}

// ─── generateNarrativeAngle ───────────────────────────────────────────────────

/**
 * Auto-generate a one-sentence narrative angle for a job on save.
 * Reads JD + a relevance-scored CV excerpt and writes back why this
 * candidate specifically is credible for the role.
 * Non-fatal — errors are swallowed. Skips if narrativeAngle already set.
 */
export async function generateNarrativeAngle(job: Job): Promise<void> {
  if ((job.narrativeAngle || "").trim().length > 0) return;

  const jd = (job.jdText || "").trim();
  const profile = await storage.getProfile();
  const cv = (profile?.cvText || "").trim();
  if (!jd && !cv) return;

  const keywords = [job.title, job.roleArchetype || "", job.company].filter(Boolean);
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  const prompt =
    COACH_PREAMBLE +
    `Role: ${job.title} at ${job.company}${job.roleArchetype ? ` (${job.roleArchetype})` : ""}.\n` +
    (jd ? `Job description (excerpt):\n${jd.slice(0, 800)}\n\n` : "") +
    (cvExcerpt ? `Candidate background (excerpt):\n${cvExcerpt}\n\n` : "") +
    `Write ONE sentence (under 25 words) explaining why this specific candidate is credible for this specific role. ` +
    `Name a concrete overlap — a past employer, a capability, or a domain. No generic claims. ` +
    `Return ONLY the sentence text, no quotes, no preamble.`;

  try {
    const result = (await llm(prompt, { maxTokens: 60 }))?.trim();
    if (result && result.length > 10 && result.length < 300) {
      await storage.updateJob(job.id, { narrativeAngle: result } as any);
    }
  } catch {
    // non-fatal
  }
}

// ─── generateHustleArc ────────────────────────────────────────────────────────

export async function generateHustleArc(hustle: Hustle): Promise<void> {
  const existing = (hustle as any).hustleArc;
  if (Array.isArray(existing) && existing.length > 0) return;

  const profile = await storage.getProfile();
  const cv = profile?.cvText || "";
  const keywords = [hustle.title, hustle.coreClaim || ""].filter(Boolean);
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  const prompt =
    COACH_PREAMBLE +
    `Proof project: "${hustle.title}".\n` +
    `Core claim: ${hustle.coreClaim || "(none)"}.\n` +
    `Description: ${hustle.description || "(none)"}.\n` +
    (cvExcerpt ? `Candidate background:\n${cvExcerpt}\n\n` : "") +
    `Generate a 5-step arc to turn this proof project into a live, shareable asset. ` +
    `Phases in order: frame → research → draft → refine → publish. ` +
    `Each step: title (action phrase), rationale (1 sentence), stageTag (frame/research/draft/refine/publish), stepsHint (2-3 sub-actions). ` +
    `Return JSON: { arc: Array<{ title, rationale, stageTag, stepsHint }> }`;

  try {
    const result = await llmJSON<{ arc: Array<{ title: string; rationale: string; stageTag: string; stepsHint: string[] }> }>(prompt);
    const arc = result?.arc;
    if (Array.isArray(arc) && arc.length > 0) {
      await storage.updateHustle(hustle.id, { hustleArc: arc.slice(0, 5) } as any);
    }
  } catch {
    // non-fatal
  }
}
