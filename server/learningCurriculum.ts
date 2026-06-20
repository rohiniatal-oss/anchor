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

export type LearnItemEnrichment = {
  capabilityBuilt: string;
  outputNote: string;
  suggestedResource: string;
  estimatedHours: number;
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

function compactList(arr: string[], max = 5): string {
  return arr
    .filter(Boolean)
    .slice(0, max)
    .map((s) => `- ${s.trim()}`)
    .join("\n");
}

// ─── generateContactArchetypes ────────────────────────────────────────────────

export async function generateContactArchetypes(track: CareerTrack): Promise<void> {
  const existing = (track as any).contactArchetypes;
  if (Array.isArray(existing) && existing.length > 0) return;

  const profile = await storage.getProfile();
  const cv = profile?.cvText || "";
  const keywords = [track.name, ...(track.description || "").split(" ").slice(0, 6)];
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  // Pull live jobs linked to this track so archetypes reflect real organisations.
  const jobs = await storage.getJobs();
  const trackJobs = jobs
    .filter((j) => (j as any).relatedTrackId === track.id && j.status !== "closed")
    .slice(0, 4)
    .map((j) => `${j.title} at ${j.company}`);

  const prompt =
    COACH_PREAMBLE +
    `Career track: "${track.name}".\n` +
    `Track description: ${track.description || "(none)"}.\n` +
    (cvExcerpt ? `Candidate background (excerpt):\n${cvExcerpt}\n\n` : "") +
    (trackJobs.length ? `Live roles being pursued on this track:\n${compactList(trackJobs)}\n\n` : "") +
    `List the 6 most strategically valuable contact archetypes for someone targeting this track. ` +
    `Each archetype = a short, specific noun phrase naming the person's actual role and organisation type ` +
    `(e.g. "Senior policy adviser at UK AI Safety Institute", "Chief of Staff at Series B fintech"). ` +
    `Ground the archetypes in the live roles and candidate background above — ` +
    `not generic networking advice. ` +
    `Return JSON: { archetypes: string[] }`;

  try {
    const result = await llmJSON<{ archetypes: string[] }>(prompt);
    const archetypes = result?.archetypes;
    if (Array.isArray(archetypes) && archetypes.length > 0) {
      await storage.updateCareerTrack(track.id, { contactArchetypes: archetypes.slice(0, 6) } as any);
    } else {
      console.warn(`generateContactArchetypes: empty result for track ${track.id}`);
    }
  } catch (err) {
    console.warn(`generateContactArchetypes failed for track ${track.id}:`, err);
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

  // Pull gap domains and live jobs for this track to ground curriculum in reality.
  const [jobs, learn] = await Promise.all([storage.getJobs(), storage.getLearn()]);
  const trackJobs = jobs
    .filter((j) => (j as any).relatedTrackId === track.id && j.status !== "closed")
    .slice(0, 4)
    .map((j) => `${j.title} at ${j.company}${j.jdText ? " (has JD)" : ""}`);
  const existingLearnTitles = learn
    .filter((l) => (l as any).relatedTrackId === track.id && !l.done)
    .slice(0, 6)
    .map((l) => l.title);
  const gapDomains: string[] = (track as any).gapDomains || [];

  const prompt =
    COACH_PREAMBLE +
    `Career track: "${track.name}".\n` +
    `Track description: ${track.description || "(none)"}.\n` +
    (gapDomains.length ? `Capability gaps to address: ${gapDomains.join(", ")}.\n` : "") +
    (trackJobs.length ? `Live roles being pursued on this track:\n${compactList(trackJobs)}\n\n` : "") +
    (existingLearnTitles.length
      ? `Learning already in progress (do not duplicate these):\n${compactList(existingLearnTitles)}\n\n`
      : "") +
    (cvExcerpt ? `Candidate background (excerpt):\n${cvExcerpt}\n\n` : "") +
    `Design a ${MAX_CURRICULUM_ITEMS}-item learning curriculum that builds real, demonstrable credibility for this track. ` +
    `Phases to use (at least once each): orient, mechanism, synthesise, position, transfer, artifact. ` +
    `Rules:\n` +
    `- Ground every item in the gap domains and live roles above — no generic advice.\n` +
    `- Sequence items so earlier phases unblock later ones.\n` +
    `- Each item must produce a concrete output the candidate can cite or show.\n` +
    `- suggestedResource must be a real, specific book title, URL, or named course — not "various resources".\n` +
    `Each item fields: title (action phrase starting with a verb), rationale (1 sentence tying to a gap or role), ` +
    `phase, format (reading/watching/doing/writing/connecting/reflecting), estimatedHours (integer 1-8), ` +
    `outputNote (what the candidate produces — be specific), capabilityBuilt (skill or domain label), ` +
    `suggestedResource (specific real resource).\n` +
    `Return JSON: { items: LearningCurriculumItem[] }`;

  try {
    const result = await llmJSON<{ items: LearningCurriculumItem[] }>(prompt);
    const items = result?.items;
    if (Array.isArray(items) && items.length > 0) {
      const valid = items.slice(0, MAX_CURRICULUM_ITEMS);
      await storage.updateCareerTrack(track.id, { curriculumItems: valid } as any);
      return valid;
    } else {
      console.warn(`generateLearningCurriculum: empty result for track ${track.id}`);
    }
  } catch (err) {
    console.warn(`generateLearningCurriculum failed for track ${track.id}:`, err);
  }
  return [];
}

// ─── generateJobPrepArc ───────────────────────────────────────────────────────

export async function generateJobPrepArc(job: Job, force = false): Promise<void> {
  const existing = (job as any).prepArc;
  if (!force && Array.isArray(existing) && existing.length > 0) return;

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
    (job.narrativeAngle ? `Candidate narrative angle for this role: ${job.narrativeAngle}\n` : "") +
    `JD (excerpt):\n${jd.slice(0, 1500)}\n\n` +
    (cvExcerpt ? `Candidate CV (excerpt):\n${cvExcerpt}\n\n` : "") +
    `Generate a ${MAX_PREP_ARC_ITEMS}-step prep arc for this specific role and this specific candidate. ` +
    `Phases in order: understand → evidence → materials → network → interview. ` +
    `Rules:\n` +
    `- Every step must reference this specific role and this candidate's actual background — no generic advice.\n` +
    `- stepsHint items must be concrete actions (open X, write Y, send Z) — not summaries.\n` +
    `- The materials step must name the specific documents this role requires.\n` +
    `- The network step must name a realistic contact type or organisation the candidate could reach.\n` +
    `Each step: title (action phrase), rationale (1 sentence), phase, stepsHint (2-3 concrete sub-actions).\n` +
    `Return JSON: { arc: JobPrepArcItem[] }`;

  try {
    const result = await llmJSON<{ arc: JobPrepArcItem[] }>(prompt);
    const arc = result?.arc;
    if (Array.isArray(arc) && arc.length > 0) {
      await storage.updateJob(job.id, { prepArc: arc.slice(0, MAX_PREP_ARC_ITEMS) } as any);
    } else {
      console.warn(`generateJobPrepArc: empty result for job ${job.id}`);
    }
  } catch (err) {
    console.warn(`generateJobPrepArc failed for job ${job.id}:`, err);
  }
}

// ─── generateNarrativeAngle ───────────────────────────────────────────────────

/**
 * Auto-generate a one-sentence narrative angle for a job on save.
 * Pass { ...job, narrativeAngle: "" } to force a refresh even when one exists.
 * Non-fatal — errors are logged, not thrown.
 */
export async function generateNarrativeAngle(job: Job): Promise<void> {
  if ((job.narrativeAngle || "").trim().length > 0) return;

  const jd = (job.jdText || "").trim();
  const profile = await storage.getProfile();
  const cv = (profile?.cvText || "").trim();
  if (!jd && !cv) return;

  const keywords = [job.title, job.roleArchetype || "", job.company].filter(Boolean);
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  // Pull the track name if linked, to sharpen the angle.
  let trackName = "";
  const trackId = (job as any).relatedTrackId;
  if (trackId) {
    const tracks = await storage.getCareerTracks();
    trackName = tracks.find((t) => t.id === trackId)?.name || "";
  }

  const prompt =
    COACH_PREAMBLE +
    `Role: ${job.title} at ${job.company}${job.roleArchetype ? ` (${job.roleArchetype})` : ""}.\n` +
    (trackName ? `Career track this role supports: ${trackName}.\n` : "") +
    (jd ? `Job description (excerpt):\n${jd.slice(0, 1000)}\n\n` : "") +
    (cvExcerpt ? `Candidate background (excerpt):\n${cvExcerpt}\n\n` : "") +
    `Write ONE sentence (under 25 words) explaining why this specific candidate is credible for this specific role. ` +
    `The sentence must name at least one concrete overlap — a past employer, a named capability, a specific domain, or a measurable result. ` +
    `Do NOT use phrases like "strong background", "extensive experience", "well-positioned", or "valuable skills". ` +
    `The sentence should sound like something a hiring manager who read their CV would actually say. ` +
    `Return ONLY the sentence text, no quotes, no preamble.`;

  try {
    const result = (await llm(prompt, { maxTokens: 80 }))?.trim();
    if (result && result.length > 10 && result.length < 300) {
      await storage.updateJob(job.id, { narrativeAngle: result } as any);
    } else {
      console.warn(`generateNarrativeAngle: empty or too-long result for job ${job.id}`);
    }
  } catch (err) {
    console.warn(`generateNarrativeAngle failed for job ${job.id}:`, err);
  }
}

// ─── generateHustleArc ────────────────────────────────────────────────────────

export async function generateHustleArc(hustle: Hustle, force = false): Promise<void> {
  const existing = (hustle as any).hustleArc;
  if (!force && Array.isArray(existing) && existing.length > 0) return;

  const profile = await storage.getProfile();
  const cv = profile?.cvText || "";
  const keywords = [hustle.title, hustle.coreClaim || ""].filter(Boolean);
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  // Pull linked track for audience context.
  let trackName = "";
  const trackId = (hustle as any).proofAssetForTrack;
  if (trackId) {
    const tracks = await storage.getCareerTracks();
    trackName = tracks.find((t) => t.id === trackId)?.name || "";
  }

  const prompt =
    COACH_PREAMBLE +
    `Proof project: "${hustle.title}".\n` +
    `Core claim: ${hustle.coreClaim || "(not yet defined)"}.\n` +
    `Description: ${hustle.description || "(none)"}.\n` +
    (hustle.contentPillar ? `Content pillar: ${hustle.contentPillar}.\n` : "") +
    (trackName ? `Target track this proof asset supports: ${trackName}.\n` : "") +
    (cvExcerpt ? `Candidate background (excerpt):\n${cvExcerpt}\n\n` : "") +
    `Generate a 5-step arc to turn this proof project into a live, shareable asset that directly strengthens the candidate's credibility for the target track. ` +
    `Phases in order: frame → research → draft → refine → publish. ` +
    `Rules:\n` +
    `- Each step must produce something concrete (a note, a draft, a published URL).\n` +
    `- stepsHint must be specific actions, not summaries (write X, open Y, post to Z).\n` +
    `- The publish step must name a specific channel or platform appropriate for this kind of asset.\n` +
    `Each step: title (action phrase), rationale (1 sentence), stageTag (frame/research/draft/refine/publish), stepsHint (2-3 sub-actions).\n` +
    `Return JSON: { arc: Array<{ title, rationale, stageTag, stepsHint }> }`;

  try {
    const result = await llmJSON<{ arc: Array<{ title: string; rationale: string; stageTag: string; stepsHint: string[] }> }>(prompt);
    const arc = result?.arc;
    if (Array.isArray(arc) && arc.length > 0) {
      await storage.updateHustle(hustle.id, { hustleArc: arc.slice(0, 5) } as any);
    } else {
      console.warn(`generateHustleArc: empty result for hustle ${hustle.id}`);
    }
  } catch (err) {
    console.warn(`generateHustleArc failed for hustle ${hustle.id}:`, err);
  }
}

// ─── generateLearnItemEnrichment ─────────────────────────────────────────────

/**
 * Auto-populate capabilityBuilt, outputNote, suggestedResource, and
 * estimatedHours for a new Learn item on save. Fires asynchronously —
 * never blocks the POST response. Skips if fields are already set.
 */
export async function generateLearnItemEnrichment(learn: Learn): Promise<void> {
  const alreadyEnriched =
    (learn.capabilityBuilt || "").trim().length > 0 &&
    (learn.outputNote || "").trim().length > 0;
  if (alreadyEnriched) return;

  const profile = await storage.getProfile();
  const cv = (profile?.cvText || "").trim();
  const keywords = [learn.title, learn.category || ""].filter(Boolean);
  const cvExcerpt = cvExcerptForKeywords(cv, keywords);

  // Pull track name if linked.
  let trackName = "";
  const trackId = (learn as any).relatedTrackId;
  if (trackId) {
    const tracks = await storage.getCareerTracks();
    trackName = tracks.find((t) => t.id === trackId)?.name || "";
  }

  const prompt =
    COACH_PREAMBLE +
    `Learning item: "${learn.title}".\n` +
    (learn.category ? `Category / domain: ${learn.category}.\n` : "") +
    (learn.url ? `Resource URL: ${learn.url}.\n` : "") +
    (learn.note ? `Notes: ${learn.note.slice(0, 300)}.\n` : "") +
    (trackName ? `Career track this learning supports: ${trackName}.\n` : "") +
    (cvExcerpt ? `Candidate background (excerpt):\n${cvExcerpt}\n\n` : "") +
    `Enrich this learning item with four fields that help the candidate understand exactly what doing this item will produce.\n` +
    `Rules:\n` +
    `- capabilityBuilt: the specific, nameable skill or domain this item builds (e.g. "AI governance policy analysis", "executive stakeholder briefing"). One phrase, under 10 words.\n` +
    `- outputNote: the concrete thing the candidate will produce or be able to do after completing this item. One sentence, specific. Not "understand X" — name the actual output.\n` +
    `- suggestedResource: if the item has no URL, suggest a single real, specific resource (book title + author, named course, or real URL). If a URL is already provided, return "".\n` +
    `- estimatedHours: realistic integer hours to complete this item (1-20).\n` +
    `Return JSON: { capabilityBuilt: string, outputNote: string, suggestedResource: string, estimatedHours: number }`;

  try {
    const result = await llmJSON<LearnItemEnrichment>(prompt);
    if (!result) {
      console.warn(`generateLearnItemEnrichment: empty result for learn ${learn.id}`);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (!learn.capabilityBuilt && result.capabilityBuilt?.trim()) patch.capabilityBuilt = result.capabilityBuilt.trim().slice(0, 180);
    if (!(learn as any).outputNote && result.outputNote?.trim()) patch.outputNote = result.outputNote.trim().slice(0, 300);
    if (!learn.url && result.suggestedResource?.trim()) patch.suggestedResource = result.suggestedResource.trim().slice(0, 500);
    if (!(learn as any).estimatedHours && Number.isFinite(result.estimatedHours) && result.estimatedHours > 0) {
      patch.estimatedHours = Math.min(Math.max(Math.round(result.estimatedHours), 1), 40);
    }
    if (Object.keys(patch).length > 0) {
      await storage.updateLearn(learn.id, patch as any);
    }
  } catch (err) {
    console.warn(`generateLearnItemEnrichment failed for learn ${learn.id}:`, err);
  }
}
