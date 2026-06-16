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
    `Target role path: "${trackName}" (archetype: ${trackArchetype || "advisory/strategy"}).\n` +
    `The user has live job roles saved in this area but no contacts yet.\n\n` +
    `STEP 1 — Generate 2-3 specific person types to reach out to:\n` +
    `These must be SPECIFIC to ${trackName}, not generic networking advice. ` +
    `Think: who specifically in this space could give a referral, reality-check the path, or make an introduction? ` +
    `For each: label (the specific person type, <70 chars — e.g. "Former FCO diplomat now in AI governance advisory"), ` +
    `whyItMatters (one sentence, <160 chars — exactly how this person type helps for ${trackName}, ` +
    `not generic "they have connections"), ` +
    `suggestedMaterials (1-2 specific outreach angles, e.g. "Ask specifically how they moved from government to advisory, ` +
    `and whether their previous employer has a secondment programme").\n\n` +
    `STEP 2 — Generate 3 milestones for building this network:\n` +
    `Milestones should be a concrete progression: identify → message → conversation.\n` +
    `• Milestone 1: find specific people matching the top archetype (LinkedIn search, alumni network, specific event)\n` +
    `• Milestone 2: send a first message (suggest a specific hook or reason for reaching out given the user's background)\n` +
    `• Milestone 3: have one real conversation and extract a specific insight or next step\n` +
    `Each milestone: label (<80 chars), ` +
    `doneWhen (testable — e.g. "Has identified 3 real people matching this description by name and employer"), ` +
    `suggestedTaskTitle (action-verb start, <120 chars, specific — e.g. "Search LinkedIn for FCO alumni now in AI policy advisory roles"), ` +
    `subdivisionKey (slug of the contact archetype this falls under).\n\n` +
    `Also return topContactTitle (the single most useful person type, <80 chars), topContactWhy (<160 chars), ` +
    `topAsk (the exact opening line to use in a cold message, <200 chars).\n\n` +
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
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 160),
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
    `You are a learning-path designer for a job-search tool. ` +
    `User profile: ${USER_PROFILE}\n\n` +
    `Target role path: "${trackName}" (archetype: ${trackArchetype || "advisory/strategy"}).\n` +
    `Capability gap to close: "${domainLabel}".\n\n` +
    `IMPORTANT CALIBRATION:\n` +
    `- This user has strong strategy, analytical, and written-communication foundations from consulting and PE. ` +
    `Do NOT assign checkpoints for skills they already have (slide-writing, stakeholder communication, logical structuring, business-case thinking).\n` +
    `- Focus on what is GENUINELY NEW for someone with that background moving into ${trackName}: ` +
    `domain-specific vocabulary, regulatory landscape, key actors/institutions, live policy debates, and how the field actually works in practice.\n\n` +
    `STEP 1 — Generate 3 to 4 subtopics:\n` +
    `Each subtopic covers a distinct slice of "${domainLabel}" relevant to ${trackArchetype || "advisory/strategy"} roles. ` +
    `For each: label (<60 chars), whyItMatters (<140 chars — why this slice specifically matters for ${trackName}, not generically), ` +
    `suggestedMaterials (2-3 specific items by real name — books, newsletters, courses, or podcasts that actually exist; ` +
    `choose ones a busy practitioner would actually use, not entry-level Wikipedia alternatives).\n\n` +
    `STEP 2 — Generate 5 to 7 ordered checkpoints tied to those subtopics:\n` +
    `Each checkpoint advances the user through the materials above in a logical sequence. ` +
    `Rules for checkpoints:\n` +
    `• suggestedTaskTitle: name the specific source + what to extract from it. ` +
    `E.g. "Read Prisoners of Geography ch. 1-3 — note which geographic constraints matter most for KSA advisory work", ` +
    `"Listen to Lawfare podcast on AI governance — identify the 2 regulatory fault lines you'd need to know for a policy brief".\n` +
    `• doneWhen: a testable comprehension or application condition — NOT completion or word count. ` +
    `E.g. "Can name the three main governance frameworks and explain which one is most contested, without notes", ` +
    `"Can describe how this domain intersects with [specific aspect of ${trackName}] in one clear sentence".\n` +
    `• Bad doneWhen: "completed reading", "wrote a summary", "finished the course".\n` +
    `• Each checkpoint: label (<80 chars), doneWhen (<200 chars, testable), suggestedTaskTitle (<120 chars, names a real source), ` +
    `subdivisionKey (slug of the subtopic this falls under).\n\n` +
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
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 160),
      subdivisionKey,
      status: i === 0 ? "active" : "todo",
      sequence: i,
    });
  }
}
