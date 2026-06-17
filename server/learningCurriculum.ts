/**
 * LLM-powered learning curriculum generator.
 *
 * Produces a structured learning arc: orient → mechanism → synthesise →
 * position → transfer → artifact. Content milestones include scaffolding
 * questions to guide active reading. Synthesis milestones prompt reflection
 * rather than new reading. The final milestone always produces a reusable
 * artifact (cover-letter framing, interview answer).
 *
 * Also generates per-job prep arcs: orient → research → synthesise → artifact.
 */

import { llmJSON } from "./llm";
import { storage } from "./storage";
import type { Job, Hustle } from "@shared/schema";
import { USER_PROFILE } from "./userPromptProfile";

function clean(value: unknown, max = 280): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanList(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((x) => clean(x, 120)).filter(Boolean);
}

type RawSubdivision = { label?: unknown; whyItMatters?: unknown; suggestedMaterials?: unknown };
type RawMilestone = {
  label?: unknown;
  doneWhen?: unknown;
  suggestedTaskTitle?: unknown;
  subdivisionKey?: unknown;
  milestoneType?: unknown;
  scaffolding?: unknown;
};

function parseSubdivisions(arr: unknown[]): RawSubdivision[] {
  return arr.slice(0, 5).filter((x) => x && typeof x === "object") as RawSubdivision[];
}
function parseMilestones(arr: unknown[]): RawMilestone[] {
  return arr.slice(0, 10).filter((x) => x && typeof x === "object") as RawMilestone[];
}

function scaffoldingText(value: unknown): string {
  if (Array.isArray(value)) return value.map((s) => clean(s, 200)).filter(Boolean).join(" | ");
  return clean(value, 600);
}

function normalizeSubdivisionToken(value: unknown): string {
  return clean(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/**
 * Generate and save 2-3 specific contact archetypes for a network-targets
 * recommendation. Replaces the generic "someone who can open doors" with
 * specific person types, why they matter, and a concrete outreach angle.
 */
export async function generateContactArchetypes(
  recommendationId: number,
  trackName: string,
  trackArchetype: string,
): Promise<void> {
  const existing = await storage.getRecommendationSubdivisions(recommendationId);
  if (existing.length > 0) return;

  const prompt =
    `You are a networking strategist for a job-search tool. ` +
    `User profile: ${USER_PROFILE}\n\n` +
    `Target role path: "${trackName}" (archetype: ${trackArchetype || "advisory/strategy"}).\n` +
    `The user has live job roles saved in this area but no contacts yet.\n\n` +
    `=== STEP 1: Contact archetypes ===\n` +
    `Generate 2-3 SPECIFIC person types — not generic "someone in the industry".\n` +
    `Think: who specifically in ${trackName} could give a referral, reality-check the path, or make an introduction?\n` +
    `For each: label (<70 chars, e.g. "Former FCO diplomat now in AI governance advisory"), ` +
    `whyItMatters (<160 chars — exactly how this specific person type helps, not "they have connections"), ` +
    `suggestedMaterials (1-2 specific angles for finding and approaching them — a real LinkedIn search query, ` +
    `a specific event, an alumni network, a publication where they'd write).\n\n` +
    `=== STEP 2: Milestone arc (4 milestones) ===\n` +
    `Follow this arc with the same rigour as a learning curriculum:\n\n` +
    `MILESTONE 1 — ORIENT (milestoneType: "content"):\n` +
    `Understand the landscape of who's actually in this space — not who should be contacted yet.\n` +
    `suggestedTaskTitle: a specific search or read to map the space, e.g. "Search LinkedIn for [specific title] + [geography] — note 5 real people and what they actually do".\n` +
    `scaffolding: 2-3 questions to guide the search, e.g. "What title do they actually use? | What's their typical career path — government then advisory, or the reverse? | Which organisations keep coming up?"\n` +
    `doneWhen: has mapped 5+ real people in this archetype by name, employer, and career path — enough to see a pattern.\n\n` +
    `MILESTONE 2 — IDENTIFY (milestoneType: "content"):\n` +
    `Narrow to 2-3 specific people worth contacting and research them individually.\n` +
    `suggestedTaskTitle: look up 2-3 specific individuals — their background, recent work, and one thing that connects to the user's own experience.\n` +
    `scaffolding: "What's the one thing they've done that's most relevant to what you're trying to do? | ` +
    `Is there any overlap with your work — same geography, same institution, same kind of deal? | ` +
    `What could you credibly ask them that they'd find worth answering?"\n` +
    `doneWhen: has 2-3 specific people selected, with a clear reason for each and one genuine connection point.\n\n` +
    `MILESTONE 3 — SYNTHESISE HOOK (milestoneType: "synthesis"):\n` +
    `No new research. Craft the specific reason to reach out — the hook from the user's background that makes this outreach credible.\n` +
    `suggestedTaskTitle: "Draft 2-3 versions of why YOU specifically are reaching out — what's the genuine connection between your work and theirs?"\n` +
    `scaffolding: "What's the one thing in your background that would make them willing to reply? | ` +
    `What's the specific thing you want from the conversation — one question you'd definitely want answered? | ` +
    `How is your background relevant to what they do — not 'I'm interested in your field' but a real overlap?"\n` +
    `doneWhen: has written a specific hook sentence that references something real in their background and something real in the contact's work.\n\n` +
    `MILESTONE 4 — ARTIFACT: THE MESSAGE (milestoneType: "artifact"):\n` +
    `Write the actual first message — not a template, a real draft.\n` +
    `suggestedTaskTitle: "Draft the first message to your top contact — subject line, 3-sentence body, specific ask".\n` +
    `scaffolding: "Line 1: one sentence showing you know something specific about their work. ` +
    `Line 2: one sentence on why YOUR background makes this a conversation worth having for them, not just you. ` +
    `Line 3: a specific, bounded ask (15-min call, one question by email, introduction to someone). ` +
    `Keep it under 100 words — shorter is better."\n` +
    `doneWhen: has a complete message she could send today — not a draft, a send-ready message.\n\n` +
    `Also return topContactTitle (<80 chars), topContactWhy (<160 chars), ` +
    `topAsk (exact opening line for a cold message, <200 chars).\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"subdivisions":[{"label":"...","whyItMatters":"...","suggestedMaterials":["..."]}],` +
    `"milestones":[{"label":"...","milestoneType":"content|synthesis|artifact","doneWhen":"...","suggestedTaskTitle":"...","scaffolding":["..."],"subdivisionKey":"..."}],` +
    `"topContactTitle":"...","topContactWhy":"...","topAsk":"..."}`;

  const parsed = await llmJSON<{ subdivisions?: unknown[]; milestones?: unknown[]; topContactTitle?: unknown; topContactWhy?: unknown; topAsk?: unknown }>(prompt);
  if (!parsed) return;

  const rawSubs = Array.isArray(parsed.subdivisions) ? parseSubdivisions(parsed.subdivisions) : [];
  const rawMilestones = Array.isArray(parsed.milestones) ? parseMilestones(parsed.milestones) : [];

  const subdivisionKeyMap = new Map<string, string>();
  for (let i = 0; i < rawSubs.length; i++) {
    const sub = rawSubs[i];
    const label = clean(sub.label, 120);
    if (!label) continue;
    const key = normalizeSubdivisionToken(label);
    subdivisionKeyMap.set(normalizeSubdivisionToken(label), key);
    subdivisionKeyMap.set(normalizeSubdivisionToken(key), key);
    await storage.createRecommendationSubdivision({
      recommendationId,
      subdivisionKey: key,
      label,
      whyItMatters: clean(sub.whyItMatters, 240),
      suggestedMaterials: JSON.stringify(cleanList(sub.suggestedMaterials, 3)),
      sequence: i,
    });
  }

  for (let i = 0; i < rawMilestones.length; i++) {
    const m = rawMilestones[i];
    const label = clean(m.label, 120);
    if (!label) continue;
    const rawSubKey = clean(m.subdivisionKey, 80);
    const normalizedSubKey = normalizeSubdivisionToken(rawSubKey);
    const subdivisionKey = subdivisionKeyMap.get(normalizedSubKey) || normalizedSubKey || rawSubKey;
    const milestoneType = ["content", "synthesis", "artifact"].includes(String(m.milestoneType))
      ? String(m.milestoneType) as "content" | "synthesis" | "artifact"
      : "content";
    await storage.createRecommendationMilestone({
      recommendationId,
      milestoneKey: `m${i + 1}`,
      label,
      doneWhen: clean(m.doneWhen, 240),
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 160),
      milestoneType,
      scaffolding: scaffoldingText(m.scaffolding),
      subdivisionKey,
      status: i === 0 ? "active" : "todo",
      sequence: i,
    } as any);
  }

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
 *
 * Milestone arc: orient → mechanism → SYNTHESISE → position → transfer → ARTIFACT
 * Content milestones include scaffolding questions for active reading.
 * Synthesis milestones prompt reflection. Artifact milestone produces something reusable.
 */
export async function generateLearningCurriculum(
  recommendationId: number,
  domainLabel: string,
  trackName: string,
  trackArchetype: string,
): Promise<void> {
  const existing = await storage.getRecommendationSubdivisions(recommendationId);
  if (existing.length > 0) return;

  const prompt =
    `You are a learning-path designer for a job-search tool. ` +
    `User profile: ${USER_PROFILE}\n\n` +
    `Target role path: "${trackName}" (archetype: ${trackArchetype || "advisory/strategy"}).\n` +
    `Capability gap to close: "${domainLabel}".\n\n` +
    `CALIBRATION — what NOT to assign:\n` +
    `This user already has: strategy frameworks, stakeholder comms, logical structuring, slide-writing, business-case thinking, ` +
    `emerging-market investment analysis. Skip these. Focus on what is genuinely new: domain vocabulary, ` +
    `regulatory landscape, key institutions and actors, live debates, and how the field works in practice.\n\n` +
    `=== STEP 1: Subtopics ===\n` +
    `Generate 3-4 subtopics covering "${domainLabel}" from the angle most useful for ${trackArchetype || "advisory/strategy"} roles.\n` +
    `For each: label (<60 chars), whyItMatters (<140 chars — specific to ${trackName}, not generic), ` +
    `suggestedMaterials (2-3 specific real items: books, newsletters, podcasts, courses a busy practitioner would actually use).\n\n` +
    `=== STEP 2: Milestone arc ===\n` +
    `Generate 6-8 milestones following this arc:\n\n` +
    `ARC STAGE 1 — ORIENT (1-2 milestones, milestoneType: "content"):\n` +
    `Goal: understand the landscape — who are the key actors, what's settled, what's contested.\n` +
    `suggestedTaskTitle: name a specific orientation resource (overview article, short book chapter, podcast episode).\n` +
    `scaffolding: 2-3 questions to hold in mind while reading, e.g. "Who are the main institutions? What's the biggest unresolved tension?"\n` +
    `doneWhen: can describe the landscape in 3 sentences — the main actors, the key debate, and one thing that surprises someone from outside the field.\n\n` +
    `ARC STAGE 2 — MECHANISM (1-2 milestones, milestoneType: "content"):\n` +
    `Goal: understand how it actually works in practice — the regulatory text, a real case, a primary source.\n` +
    `suggestedTaskTitle: name a specific primary or practitioner source.\n` +
    `scaffolding: 2-3 questions focused on mechanism, e.g. "How does this work in practice vs. in theory? Where does it break down?"\n` +
    `doneWhen: can explain the mechanism to someone with a consulting background without using jargon.\n\n` +
    `ARC STAGE 3 — SYNTHESISE (1 milestone, milestoneType: "synthesis"):\n` +
    `No new reading. Pure reflection. The task is to connect what's been read to the user's existing background.\n` +
    `suggestedTaskTitle: a specific reflection prompt, e.g. "Write 3 bullet points connecting [domain] to a deal or project you've worked on".\n` +
    `scaffolding: 3 prompts to help them draft the synthesis, e.g. ` +
    `"What's the closest equivalent dynamic you saw in PE or consulting? | What's genuinely new that you didn't expect? | ` +
    `What would you say if asked about this in an interview tomorrow?"\n` +
    `doneWhen: has written at least 3 bullets connecting this domain to their own experience, with at least one concrete example.\n\n` +
    `ARC STAGE 4 — POSITION (1 milestone, milestoneType: "content"):\n` +
    `Goal: go deeper on the main live debate in this field and form a genuine view.\n` +
    `suggestedTaskTitle: name a specific source representing a contested position (paper, debate, op-ed, policy document).\n` +
    `scaffolding: questions that push toward an opinion, e.g. "What's the strongest argument on each side? Which do you find more convincing and why?"\n` +
    `doneWhen: can state an actual position on the main debate and defend it with one specific piece of evidence.\n\n` +
    `ARC STAGE 5 — TRANSFER (1 milestone, milestoneType: "content"):\n` +
    `Goal: connect to her specific target context — a country, sector, or role she's actually pursuing.\n` +
    `suggestedTaskTitle: name a specific source about ${domainLabel} applied to a geography or sector relevant to the user (KSA, UAE, London, development finance, etc.).\n` +
    `scaffolding: questions grounding it in her context, e.g. "How does this play out differently in KSA vs. UK? What's the most relevant example for the roles you're pursuing?"\n` +
    `doneWhen: can give one specific example of how this domain plays out in a context directly relevant to her target roles.\n\n` +
    `ARC STAGE 6 — ARTIFACT (1 milestone, milestoneType: "artifact"):\n` +
    `Goal: produce something reusable she'll actually keep.\n` +
    `suggestedTaskTitle: a specific drafting task — e.g. "Draft the 2 sentences you'd use in a ${trackName} cover letter to show you understand ${domainLabel}", ` +
    `or "Write a 90-second verbal answer to: 'What's your take on [main debate in ${domainLabel}]?'".\n` +
    `scaffolding: a template + what makes a strong answer, e.g. "Start with your position, then one piece of evidence, then connect it to your background — ` +
    `what's the one thing from your Bain or PE work that makes your take distinctive?"\n` +
    `doneWhen: has a concrete piece of text she would actually use — a cover letter sentence, an interview answer, or a positioning statement.\n\n` +
    `=== OUTPUT FORMAT ===\n` +
    `Return ONLY valid JSON:\n` +
    `{"subdivisions":[{"label":"...","whyItMatters":"...","suggestedMaterials":["..."]}],` +
    `"milestones":[{"label":"...","milestoneType":"content|synthesis|artifact","doneWhen":"...","suggestedTaskTitle":"...","scaffolding":["question 1","question 2","question 3"],"subdivisionKey":"..."}]}`;

  const parsed = await llmJSON<{ subdivisions?: unknown[]; milestones?: unknown[] }>(prompt);
  if (!parsed) return;

  const rawSubs = Array.isArray(parsed.subdivisions) ? parseSubdivisions(parsed.subdivisions) : [];
  const rawMilestones = Array.isArray(parsed.milestones) ? parseMilestones(parsed.milestones) : [];

  if (!rawSubs.length && !rawMilestones.length) return;

  const subdivisionKeyMap = new Map<string, string>();
  for (let i = 0; i < rawSubs.length; i++) {
    const sub = rawSubs[i];
    const label = clean(sub.label, 120);
    if (!label) continue;
    const key = normalizeSubdivisionToken(label);
    subdivisionKeyMap.set(normalizeSubdivisionToken(label), key);
    subdivisionKeyMap.set(normalizeSubdivisionToken(key), key);
    await storage.createRecommendationSubdivision({
      recommendationId,
      subdivisionKey: key,
      label,
      whyItMatters: clean(sub.whyItMatters, 240),
      suggestedMaterials: JSON.stringify(cleanList(sub.suggestedMaterials, 4)),
      sequence: i,
    });
  }

  for (let i = 0; i < rawMilestones.length; i++) {
    const m = rawMilestones[i];
    const label = clean(m.label, 120);
    if (!label) continue;
    const rawSubKey = clean(m.subdivisionKey, 80);
    const normalizedSubKey = normalizeSubdivisionToken(rawSubKey);
    const subdivisionKey = subdivisionKeyMap.get(normalizedSubKey) || normalizedSubKey || rawSubKey;
    const milestoneType = ["content", "synthesis", "artifact"].includes(String(m.milestoneType))
      ? String(m.milestoneType) as "content" | "synthesis" | "artifact"
      : "content";
    await storage.createRecommendationMilestone({
      recommendationId,
      milestoneKey: `m${i + 1}`,
      label,
      doneWhen: clean(m.doneWhen, 300),
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 200),
      milestoneType,
      scaffolding: scaffoldingText(m.scaffolding),
      subdivisionKey,
      status: i === 0 ? "active" : "todo",
      sequence: i,
    } as any);
  }
}

/**
 * Generate and persist a structured prep arc for a single role.
 * Idempotent: skips if a job-prep recommendation already exists for this job.
 *
 * Arc: ORIENT → RESEARCH → SYNTHESISE → ARTIFACT
 * - ORIENT (content): Read the JD carefully; map where you're strongest/weakest
 * - RESEARCH (content): Company context, team, recent news, competitive landscape
 * - SYNTHESISE (synthesis): No new reading — write how your experience maps to their requirements
 * - ARTIFACT (artifact): Draft the opening narrative / "why me + why them" angle
 */
export async function generateJobPrepArc(job: Job): Promise<void> {
  const gapKey = `job-prep-${job.id}`;
  const existing = await storage.getRecommendations();
  if (existing.some((r) => r.linkedGapKey === gapKey)) return;

  const recTitle = `Prep: ${job.title}${job.company ? ` at ${job.company}` : ""}`;
  const rec = await storage.createRecommendation({
    collection: "job-prep-arc",
    kind: "job-prep",
    status: "accepted",
    source: "system",
    title: recTitle,
    whySuggested: `Structured prep arc for ${job.title}${job.company ? ` at ${job.company}` : ""}.`,
    linkedTrackId: job.relatedTrackId ?? null,
    linkedGapKey: gapKey,
    linkedCombination: "",
    freshnessLabel: "",
    sourceLabel: "Anchor",
    sourceUrl: job.url || job.sourceUrl || "",
    rankScore: 85,
    rankReason: "Direct application prep",
    executionShape: "milestone-arc",
    acceptanceEntityType: "learn",
    acceptanceDraft: JSON.stringify({ jobId: job.id }),
    confidenceScore: null,
    duplicateOfId: null,
  });

  await storage.createLearn({
    title: recTitle,
    category: "prep",
    type: "resource",
    learnStatus: "active",
    active: true,
    done: false,
    sourceType: "recommendation",
    sourceId: rec.id,
    relatedTrackId: job.relatedTrackId ?? undefined,
    capabilityBuilt: `Application prep for ${job.title}`,
    requiredOutput: `Application-ready narrative for ${job.title}`,
    note: job.url ? `Role URL: ${job.url}` : "",
  } as any);

  const hasJD = (job.jdText || "").trim().length > 40;
  const jobContext = [
    `Role: ${job.title}`,
    job.company ? `Company: ${job.company}` : "",
    job.location ? `Location: ${job.location}` : "",
    job.roleArchetype ? `Archetype: ${job.roleArchetype}` : "",
    hasJD ? `\nJob description:\n${job.jdText!.trim().slice(0, 1800)}` : "",
  ].filter(Boolean).join("\n");

  const prompt =
    `You are a job-application coach for a senior strategy professional. ` +
    `User profile: ${USER_PROFILE}\n\n` +
    `${jobContext}\n\n` +
    `Generate a 4-milestone prep arc for this specific role. ` +
    `Each milestone must be concrete and role-specific — not generic advice.\n\n` +
    `MILESTONE 1 — ORIENT (milestoneType: "content"):\n` +
    `Read and map the role. If a JD is provided, extract the 3 requirements where the user is STRONGEST and the 2 where she is WEAKEST. ` +
    `If no JD: research what this type of role typically requires at this company/organisation.\n` +
    `suggestedTaskTitle: a specific task, e.g. "Read the ${job.title} JD — highlight 3 strengths and 2 gaps"\n` +
    `scaffolding: 3 questions, e.g. "What are the 2-3 requirements where your Bain/PE background directly applies? | ` +
    `Where is the biggest gap — technical depth, sector knowledge, or seniority signal? | ` +
    `What's the one thing they seem to value most that you'll need to make credible?"\n` +
    `doneWhen: has identified 3 specific requirements she can speak to directly and 1-2 gaps she'll need to address.\n\n` +
    `MILESTONE 2 — RESEARCH (milestoneType: "content"):\n` +
    `Understand the employer — not just what they say on their website.\n` +
    `suggestedTaskTitle: a specific research task, e.g. "Look up ${job.company || "the organisation"}'s recent news, the team, and any relevant LinkedIn profiles"\n` +
    `scaffolding: "What have they actually been working on in the last 6-12 months — any news, hires, strategic announcements? | ` +
    `Who would be interviewing or managing this role — what's their background? | ` +
    `What does this company actually care about that the JD doesn't say explicitly?"\n` +
    `doneWhen: has 3 specific facts about the organisation that she could reference naturally in an interview.\n\n` +
    `MILESTONE 3 — SYNTHESISE (milestoneType: "synthesis"):\n` +
    `No new research. Map existing experience to requirements. Pure reflection.\n` +
    `suggestedTaskTitle: "Write how your 3 strongest experiences map to the 3 requirements you flagged — one sentence each"\n` +
    `scaffolding: "For each of the 3 requirements you flagged: what's the ONE story from your past that shows this most clearly? | ` +
    `What's the specific outcome or number you can cite? | ` +
    `What's the gap you'll need to address honestly — and what's the honest reframe (learning curve vs. irrelevant vs. actually covered)?"\n` +
    `doneWhen: has written 3 experience-to-requirement mappings, each with a specific example and outcome.\n\n` +
    `MILESTONE 4 — ARTIFACT (milestoneType: "artifact"):\n` +
    `Produce the opening narrative — the "why me, why them, why now" angle she'd actually use.\n` +
    `suggestedTaskTitle: "Draft the opening 2-3 sentences: why ${job.company || "this organisation"} now, and what specifically in your background makes you the right hire"\n` +
    `scaffolding: "Sentence 1: one thing specific about ${job.company || "them"} that you find genuinely compelling (not generic). ` +
    `Sentence 2: the one thread in your background — Bain, PE, TBI, or KSA work — that maps directly to what they need. ` +
    `Sentence 3: what you'd bring that someone with a purely academic or policy background wouldn't. ` +
    `Keep it under 80 words. Read it aloud — if it sounds like a template, rewrite it."\n` +
    `doneWhen: has a complete opening narrative she would actually use — not a draft, a real version she'd send.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"milestones":[{"label":"...","milestoneType":"content|synthesis|artifact","doneWhen":"...","suggestedTaskTitle":"...","scaffolding":["question 1","question 2","question 3"]}]}`;

  const parsed = await llmJSON<{ milestones?: unknown[] }>(prompt);
  if (!parsed) return;

  const rawMilestones = Array.isArray(parsed.milestones) ? parseMilestones(parsed.milestones) : [];
  if (!rawMilestones.length) return;

  for (let i = 0; i < rawMilestones.length; i++) {
    const m = rawMilestones[i];
    const label = clean(m.label, 120);
    if (!label) continue;
    const milestoneType = ["content", "synthesis", "artifact"].includes(String(m.milestoneType))
      ? String(m.milestoneType) as "content" | "synthesis" | "artifact"
      : "content";
    await storage.createRecommendationMilestone({
      recommendationId: rec.id,
      milestoneKey: `m${i + 1}`,
      label,
      doneWhen: clean(m.doneWhen, 300),
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 200),
      milestoneType,
      scaffolding: scaffoldingText(m.scaffolding),
      subdivisionKey: "",
      status: i === 0 ? "active" : "todo",
      sequence: i,
    } as any);
  }
}

/**
 * Generate and persist a structured execution arc for a proof-asset hustle.
 * Idempotent: skips if a hustle-arc recommendation already exists for this hustle.
 *
 * Arc: ORIENT → DRAFT → SYNTHESISE → ARTIFACT
 * - ORIENT (content): Research the space — what's already been written, what's missing
 * - DRAFT (content): Write a complete first version — done, not perfect
 * - SYNTHESISE (synthesis): Step back — what's actually strongest, what needs to go
 * - ARTIFACT (artifact): The publish-ready version + the one-line pitch for it
 */
export async function generateHustleArc(hustle: Hustle): Promise<void> {
  const gapKey = `hustle-arc-${hustle.id}`;
  const existing = await storage.getRecommendations();
  if (existing.some((r) => r.linkedGapKey === gapKey)) return;

  const recTitle = `Build: ${hustle.title}`;
  const rec = await storage.createRecommendation({
    collection: "hustle-arc",
    kind: "hustle-arc",
    status: "accepted",
    source: "system",
    title: recTitle,
    whySuggested: `Structured execution arc for "${hustle.title}".`,
    linkedTrackId: hustle.proofAssetForTrack ?? null,
    linkedGapKey: gapKey,
    linkedCombination: "",
    freshnessLabel: "",
    sourceLabel: "Anchor",
    sourceUrl: "",
    rankScore: 75,
    rankReason: "Proof asset execution",
    executionShape: "milestone-arc",
    acceptanceEntityType: "learn",
    acceptanceDraft: JSON.stringify({ hustleId: hustle.id }),
    confidenceScore: null,
    duplicateOfId: null,
  });

  await storage.createLearn({
    title: recTitle,
    category: "hustle",
    type: "resource",
    learnStatus: "active",
    active: true,
    done: false,
    sourceType: "recommendation",
    sourceId: rec.id,
    relatedTrackId: hustle.proofAssetForTrack ?? undefined,
    capabilityBuilt: `Proof asset: ${hustle.title}`,
    requiredOutput: hustle.coreClaim || `Published version of ${hustle.title}`,
    note: hustle.note || "",
  } as any);

  const context = [
    `Proof asset: "${hustle.title}"`,
    hustle.audience ? `Target audience: ${hustle.audience}` : "",
    hustle.coreClaim ? `Core claim: ${hustle.coreClaim}` : "",
    hustle.contentPillar ? `Content pillar: ${hustle.contentPillar}` : "",
    hustle.stage ? `Current stage: ${hustle.stage}` : "",
  ].filter(Boolean).join("\n");

  const prompt =
    `You are a writing coach for a strategy professional building public proof assets. ` +
    `User profile: ${USER_PROFILE}\n\n` +
    `${context}\n\n` +
    `Generate a 4-milestone execution arc to take this from idea to published proof asset. ` +
    `Be specific to THIS piece — not generic writing advice.\n\n` +
    `MILESTONE 1 — ORIENT (milestoneType: "content"):\n` +
    `Research the space before writing. Find 2-3 pieces already written on this topic.\n` +
    `suggestedTaskTitle: e.g. "Search for existing ${hustle.title.toLowerCase()} pieces — note what's missing"\n` +
    `scaffolding: "What's the best existing piece on this — and what's wrong with it or missing from it? | ` +
    `What's the ONE angle that nobody has taken? | ` +
    `What would make someone who already knows this topic share it anyway?"\n` +
    `doneWhen: has read 2-3 comparable pieces and can state the specific gap this piece fills.\n\n` +
    `MILESTONE 2 — DRAFT (milestoneType: "content"):\n` +
    `Write a complete first draft — done, not perfect. Get it out.\n` +
    `suggestedTaskTitle: "Write a full first draft of ${hustle.title} — aim for 80% there in one sitting"\n` +
    `scaffolding: ` +
    `"${hustle.coreClaim ? `Start from the core claim: ${hustle.coreClaim}. ` : "Start with the one thing you most want the reader to leave with. "}` +
    `Write the intro first, then the 3 most important points, then the outro. ` +
    `Don't edit as you go — just write. ` +
    `What's the one story or example that makes this real?"\n` +
    `doneWhen: has a complete first draft — every section exists, even if rough.\n\n` +
    `MILESTONE 3 — SYNTHESISE (milestoneType: "synthesis"):\n` +
    `No rewriting. Just read it and identify what's actually working.\n` +
    `suggestedTaskTitle: "Read the draft aloud — mark what lands and what feels forced"\n` +
    `scaffolding: "What's the ONE paragraph you'd save if you had to cut everything else? | ` +
    `What's the thing you're most embarrassed to have written — what does that reveal? | ` +
    `What do you actually believe that you're NOT saying directly?"\n` +
    `doneWhen: has annotated the draft with 3 things to keep and 2 things to cut or rewrite.\n\n` +
    `MILESTONE 4 — ARTIFACT (milestoneType: "artifact"):\n` +
    `Produce the publish-ready version and the pitch line.\n` +
    `suggestedTaskTitle: "Final edit of ${hustle.title} — and write the one-sentence pitch for it"\n` +
    `scaffolding: "Open with the strongest line you have — not a question, not a preamble, just the thing. ` +
    `Cut anything that doesn't earn its place. ` +
    `Pitch line: I wrote [title] because [specific reason]. It argues [specific claim]. It's for [specific reader].\n` +
    `doneWhen: has a version she'd actually publish today, and a one-sentence pitch she'd use to share it.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"milestones":[{"label":"...","milestoneType":"content|synthesis|artifact","doneWhen":"...","suggestedTaskTitle":"...","scaffolding":["question 1","question 2","question 3"]}]}`;

  const parsed = await llmJSON<{ milestones?: unknown[] }>(prompt);
  if (!parsed) return;

  const rawMilestones = Array.isArray(parsed.milestones) ? parseMilestones(parsed.milestones) : [];
  if (!rawMilestones.length) return;

  for (let i = 0; i < rawMilestones.length; i++) {
    const m = rawMilestones[i];
    const label = clean(m.label, 120);
    if (!label) continue;
    const milestoneType = ["content", "synthesis", "artifact"].includes(String(m.milestoneType))
      ? String(m.milestoneType) as "content" | "synthesis" | "artifact"
      : "content";
    await storage.createRecommendationMilestone({
      recommendationId: rec.id,
      milestoneKey: `m${i + 1}`,
      label,
      doneWhen: clean(m.doneWhen, 300),
      suggestedTaskTitle: clean(m.suggestedTaskTitle, 200),
      milestoneType,
      scaffolding: scaffoldingText(m.scaffolding),
      subdivisionKey: "",
      status: i === 0 ? "active" : "todo",
      sequence: i,
    } as any);
  }
}
