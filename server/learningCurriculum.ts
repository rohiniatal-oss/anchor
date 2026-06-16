/**
 * LLM-powered learning curriculum generator.
 *
 * When a learning-theme recommendation is created for a capability gap, this
 * module generates a full study plan: subtopics with specific resources
 * (books, courses, newsletters) and ordered checkpoints with "done when" criteria.
 *
 * Called fire-and-forget from syncGapRecommendations so it never blocks the
 * GET /api/recommendations response. If the LLM call fails, the recommendation
 * still exists — just without the expanded curriculum.
 */

import OpenAI from "openai";
import { storage } from "./storage";

// Hardcoded profile context matching the user's background. Keeps prompts tight
// without requiring a separate profile API call on every curriculum generation.
const USER_PROFILE =
  "ex-Bain consultant, ex-Tony Blair Institute, Abraaj/private equity, public-sector strategy, KSA/Africa investment work. " +
  "Targeting London/UAE/remote roles in AI governance, geopolitical advisory, chief-of-staff/founder office, development/philanthropy strategy. " +
  "Strong on strategy and written communication; building depth in technical governance areas.";

function clean(value: unknown, max = 280): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanList(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((x) => clean(x, 120)).filter(Boolean);
}

type RawSubdivision = { label?: unknown; whyItMatters?: unknown; suggestedMaterials?: unknown };
type RawMilestone = { label?: unknown; doneWhen?: unknown; suggestedTaskTitle?: unknown; subdivisionKey?: unknown };

function parseSubdivisions(arr: unknown[]): RawSubdivision[] {
  return arr.slice(0, 5).filter((x) => x && typeof x === "object") as RawSubdivision[];
}
function parseMilestones(arr: unknown[]): RawMilestone[] {
  return arr.slice(0, 7).filter((x) => x && typeof x === "object") as RawMilestone[];
}

/**
 * Generate and save 2-3 specific contact archetypes for a network-targets
 * recommendation. Replaces the generic "someone who can open doors" with
 * specific person types, why they matter, and a concrete outreach angle.
 * Updates the recommendation's title and acceptanceDraft with the top result.
 */
export async function generateContactArchetypes(
  recommendationId: number,
  trackName: string,
  trackArchetype: string,
): Promise<void> {
  const existing = await storage.getRecommendationSubdivisions(recommendationId);
  if (existing.length > 0) return;

  const client = new OpenAI();
  const prompt =
    `You are a networking strategist for a job-search tool. ` +
    `User profile: ${USER_PROFILE}\n\n` +
    `The user is pursuing a "${trackName}" role path (archetype: ${trackArchetype || "advisory/strategy"}) ` +
    `and has live job roles saved but no contacts yet.\n\n` +
    `Generate 2-3 specific person types they should reach out to. ` +
    `For each: label (the person type, <70 chars, e.g. "Former civil servant turned tech policy advisor"), ` +
    `whyItMatters (one sentence, <160 chars — why THIS person type would help), ` +
    `suggestedMaterials (1-2 strings: a specific outreach angle or ask, e.g. "Ask how they made the transition from government to advisory work"). ` +
    `Also generate 2-3 milestones: ` +
    `label (<80 chars), doneWhen (one testable sentence), suggestedTaskTitle (starts with a verb, <80 chars), subdivisionKey (slug).\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"subdivisions":[{"label":"...","whyItMatters":"...","suggestedMaterials":["..."]}],"milestones":[{"label":"...","doneWhen":"...","suggestedTaskTitle":"...","subdivisionKey":"..."}],"topContactTitle":"...","topContactWhy":"...","topAsk":"..."}`;

  let parsed: { subdivisions?: unknown[]; milestones?: unknown[]; topContactTitle?: unknown; topContactWhy?: unknown; topAsk?: unknown } = {};
  try {
    const r = await client.responses.create({ model: "gpt_5_1", input: prompt });
    const text = (r.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { parsed = JSON.parse(text); } catch { return; }
  } catch {
    return;
  }

  const rawSubs = Array.isArray(parsed.subdivisions) ? parseSubdivisions(parsed.subdivisions) : [];
  const rawMilestones = Array.isArray(parsed.milestones) ? parseMilestones(parsed.milestones) : [];

  const subdivisionKeyMap = new Map<string, string>();
  for (let i = 0; i < rawSubs.length; i++) {
    const sub = rawSubs[i];
    const label = clean(sub.label, 120);
    if (!label) continue;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    subdivisionKeyMap.set(label, key);
    const materials = cleanList(sub.suggestedMaterials, 3);
    await storage.createRecommendationSubdivision({
      recommendationId,
      subdivisionKey: key,
      label,
      whyItMatters: clean(sub.whyItMatters, 240),
      suggestedMaterials: JSON.stringify(materials),
      sequence: i,
    });
  }

  for (let i = 0; i < rawMilestones.length; i++) {
    const m = rawMilestones[i];
    const label = clean(m.label, 120);
    if (!label) continue;
    const rawSubKey = clean(m.subdivisionKey, 80);
    const subdivisionKey = [...subdivisionKeyMap.values()].find((v) => v === rawSubKey) || rawSubKey;
    await storage.createRecommendationMilestone({
      recommendationId,
      milestoneKey: `m${i + 1}`,
      label,
      doneWhen: clean(m.doneWhen, 240),
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 120),
      subdivisionKey,
      status: i === 0 ? "active" : "todo",
      sequence: i,
    });
  }

  // Update the recommendation's title and acceptanceDraft with the top archetype
  const topTitle = clean(parsed.topContactTitle, 120);
  const topWhy = clean(parsed.topContactWhy, 240);
  const topAsk = clean(parsed.topAsk, 200);
  if (topTitle) {
    const rec = await storage.getRecommendation(recommendationId);
    if (rec) {
      const draft = (() => { try { return JSON.parse(rec.acceptanceDraft || "{}"); } catch { return {}; } })();
      await storage.updateRecommendation(recommendationId, {
        title: topTitle,
        whySuggested: topWhy || rec.whySuggested,
        acceptanceDraft: JSON.stringify({
          ...draft,
          who: topTitle,
          why: topWhy || draft.why,
          messageDraft: topAsk ? `Hi — I'm exploring ${rec.linkedCombination || "this area"} and came across your work. Would you have 15 minutes for a quick call? ${topAsk}` : draft.messageDraft,
        }),
      });
    }
  }
}

/**
 * Generate and persist subdivisions + milestones for a learning-theme
 * recommendation. Idempotent: if subdivisions already exist, does nothing.
 */
export async function generateLearningCurriculum(
  recommendationId: number,
  domainLabel: string,
  trackName: string,
  trackArchetype: string,
): Promise<void> {
  // Idempotency: skip if already expanded
  const existing = await storage.getRecommendationSubdivisions(recommendationId);
  if (existing.length > 0) return;

  const client = new OpenAI();
  const prompt =
    `You are a learning-path generator for a job-search tool. ` +
    `User profile: ${USER_PROFILE}\n\n` +
    `The user needs to build capability in "${domainLabel}" for a "${trackName}" role path (archetype: ${trackArchetype || "advisory/strategy"}).\n\n` +
    `Generate a practical study plan with:\n` +
    `- 3 to 4 subtopics that cover this domain from the angle most useful for the role. ` +
    `For each subtopic include: label (short, <60 chars), whyItMatters (<140 chars), suggestedMaterials (2-3 specific books, newsletters, courses, or podcasts by real name — no invented sources).\n` +
    `- 4 to 6 ordered checkpoints the user can tick off to prove progression. ` +
    `Each checkpoint: label (<80 chars), doneWhen (one specific, testable sentence — e.g. "Can explain X in 2 minutes without notes"), ` +
    `suggestedTaskTitle (<80 chars, starts with a verb), subdivisionKey (slug matching a subtopic label, lowercase-hyphenated).\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"subdivisions":[{"label":"...","whyItMatters":"...","suggestedMaterials":["..."]}],"milestones":[{"label":"...","doneWhen":"...","suggestedTaskTitle":"...","subdivisionKey":"..."}]}`;

  let parsed: { subdivisions?: unknown[]; milestones?: unknown[] } = {};
  try {
    const r = await client.responses.create({ model: "gpt_5_1", input: prompt });
    const text = (r.output_text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { parsed = JSON.parse(text); } catch { return; }
  } catch {
    return;
  }

  const rawSubs = Array.isArray(parsed.subdivisions) ? parseSubdivisions(parsed.subdivisions) : [];
  const rawMilestones = Array.isArray(parsed.milestones) ? parseMilestones(parsed.milestones) : [];

  if (!rawSubs.length && !rawMilestones.length) return;

  const subdivisionKeyMap = new Map<string, string>();
  for (let i = 0; i < rawSubs.length; i++) {
    const sub = rawSubs[i];
    const label = clean(sub.label, 120);
    if (!label) continue;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    subdivisionKeyMap.set(label, key);
    const materials = cleanList(sub.suggestedMaterials, 4);
    await storage.createRecommendationSubdivision({
      recommendationId,
      subdivisionKey: key,
      label,
      whyItMatters: clean(sub.whyItMatters, 240),
      suggestedMaterials: JSON.stringify(materials),
      sequence: i,
    });
  }

  for (let i = 0; i < rawMilestones.length; i++) {
    const m = rawMilestones[i];
    const label = clean(m.label, 120);
    if (!label) continue;
    const rawSubKey = clean(m.subdivisionKey, 80);
    const subdivisionKey = [...subdivisionKeyMap.values()].find((v) => v === rawSubKey) || rawSubKey;
    await storage.createRecommendationMilestone({
      recommendationId,
      milestoneKey: `m${i + 1}`,
      label,
      doneWhen: clean(m.doneWhen, 240),
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 120),
      subdivisionKey,
      status: i === 0 ? "active" : "todo",
      sequence: i,
    });
  }
}
