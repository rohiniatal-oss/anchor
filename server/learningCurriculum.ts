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
import { COACH_PREAMBLE } from "./userPromptProfile";
import { buildUserContext, formatContextForPrompt } from "./userContext";

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

  const ctx = formatContextForPrompt(await buildUserContext());
  const prompt =
    `${COACH_PREAMBLE}You are designing a networking strategy for someone job-searching.\n\n` +
    `${ctx}\n\n` +
    `TARGET: "${trackName}" (archetype: ${trackArchetype || "advisory/strategy"}).\n` +
    `The user has job roles saved in this area but no contacts yet.\n\n` +
    `REASONING BEFORE YOU DESIGN (do this silently):\n` +
    `1. WHO ACTUALLY HIRES FOR ${trackArchetype || "advisory/strategy"} ROLES? Not "people in the industry" — the specific decision-makers, team leads, or internal advocates.\n` +
    `2. WHAT'S THE USER'S WARM PATH? Look at their background. What former employers, alumni networks, professional communities, or shared experiences could connect them to someone in "${trackName}"?\n` +
    `3. WHAT'S THE CREDIBLE ASK? Given their background, what could they genuinely offer in a conversation (not just "I'm interested in your field") that would make someone want to reply?\n\n` +
    `=== STEP 1: Contact archetypes (2-3) ===\n` +
    `Specific person types — described by role + where they'd be found.\n` +
    `For each:\n` +
    `- label (<70 chars — e.g. "Head of strategy at a target org who came from consulting")\n` +
    `- whyItMatters (<160 chars — not "they have connections" but exactly what this person can provide: a referral, an inside view of the hiring process, a reality check on the role)\n` +
    `- suggestedMaterials (1-2 concrete ways to find them: a LinkedIn search query with specific terms, an alumni directory, a professional event, a publication they'd contribute to)\n\n` +
    `=== STEP 2: Milestone arc (4 milestones) ===\n` +
    `MAP → RESEARCH → CRAFT HOOK → SEND MESSAGE\n\n` +
    `Milestone 1 — MAP (milestoneType: "content"): Search and list 5+ real people in this archetype. suggestedTaskTitle must be a specific search action. doneWhen: has a list of real names, not types.\n` +
    `Milestone 2 — RESEARCH (milestoneType: "content"): Pick 2-3 and learn what they're actually working on. doneWhen: can name one specific thing about each.\n` +
    `Milestone 3 — CRAFT HOOK (milestoneType: "synthesis"): No new research. Write the specific reason to reach out — the overlap between the user's work and the contact's. doneWhen: has a one-sentence hook that references something real on both sides.\n` +
    `Milestone 4 — SEND (milestoneType: "artifact"): Write the actual message. 3 sentences, under 100 words, specific ask. doneWhen: message is send-ready.\n\n` +
    `Each milestone needs: label, milestoneType, suggestedTaskTitle (concrete action), scaffolding (2-3 guiding questions), doneWhen (specific test).\n\n` +
    `Also return topContactTitle (<80 chars), topContactWhy (<160 chars), topAsk (opening line for a cold message, <200 chars).\n\n` +
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

  const ctx = formatContextForPrompt(await buildUserContext());
  const prompt =
    `${COACH_PREAMBLE}You are designing a learning path for someone job-searching.\n\n` +
    `${ctx}\n\n` +
    `TARGET: "${trackName}" (archetype: ${trackArchetype || "advisory/strategy"}).\n` +
    `CAPABILITY GAP: "${domainLabel}".\n\n` +
    `REASONING BEFORE YOU DESIGN (do this silently):\n` +
    `1. WHAT DOES THE USER ALREADY KNOW? Read their profile. What from their background already overlaps with "${domainLabel}"? What's adjacent? What's genuinely foreign?\n` +
    `2. WHAT KIND OF DOMAIN IS THIS?\n` +
    `   - Technical/regulatory (e.g. AI governance, tax law) → needs vocabulary + mechanisms + live debates\n` +
    `   - Skill/practice (e.g. interview prep, public speaking) → needs repetition + feedback + scenarios\n` +
    `   - Sector knowledge (e.g. fintech landscape, healthcare market) → needs actors + dynamics + recent developments\n` +
    `   - Craft (e.g. writing, data analysis) → needs doing, not reading\n` +
    `3. HOW WILL THEY USE THIS KNOWLEDGE? In interviews? In cover letters? To sound credible in a meeting? To actually do the job? This determines what the artifact should be.\n` +
    `4. WHAT CAN YOU SKIP? If their background already covers adjacent ground, start further along. A former consultant doesn't need "learn what a framework is." A former investor doesn't need "learn what due diligence means."\n\n` +
    `=== STEP 1: Subtopics (3-4) ===\n` +
    `Break "${domainLabel}" into the 3-4 angles most useful for someone pursuing ${trackArchetype || "advisory/strategy"} roles.\n` +
    `For each:\n` +
    `- label (<60 chars)\n` +
    `- whyItMatters (<140 chars — specific to ${trackName}. Not "this is important" but "without this you can't credibly discuss X in an interview")\n` +
    `- suggestedMaterials (2-3 items: real titles you're confident exist. If unsure of a title, give a search query instead — "search: [topic] [format]" — so they find the right thing rather than chasing a hallucinated title)\n\n` +
    `=== STEP 2: Milestone arc (5-7 milestones) ===\n` +
    `Design an arc adapted to the DOMAIN TYPE you identified above. Not every domain needs the same arc.\n\n` +
    `RULES:\n` +
    `- Each milestone has a milestoneType: "content" (read/watch/research), "synthesis" (no new input — reflect, connect, draft), or "artifact" (produce something reusable)\n` +
    `- At least one "synthesis" milestone where they stop consuming and connect to their own experience\n` +
    `- The FINAL milestone must be "artifact" — something they'd actually use (a cover letter sentence, an interview answer, a positioning statement, a framework they can reference)\n` +
    `- suggestedTaskTitle must be concrete and physically doable — "Read [specific thing]" or "Write [specific output]", never "Understand X" or "Explore Y"\n` +
    `- scaffolding: 2-3 questions that guide HOW to engage with the material (not what to think, but what to look for)\n` +
    `- doneWhen: a specific test — "can explain X without jargon" or "has written Y" — not "feels confident"\n` +
    `- Skip anything the user would already know from their background\n\n` +
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

  const recTitle = `Application learning: ${job.title}${job.company ? ` at ${job.company}` : ""}`;
  const rec = await storage.createRecommendation({
    collection: "job-prep-arc",
    kind: "job-prep",
    status: "accepted",
    source: "system",
    title: recTitle,
    whySuggested: `Structured learning arc for ${job.title}${job.company ? ` at ${job.company}` : ""}.`,
    linkedTrackId: job.relatedTrackId ?? null,
    linkedGapKey: gapKey,
    linkedCombination: "",
    freshnessLabel: "",
    sourceLabel: "Anchor",
    sourceUrl: job.url || job.sourceUrl || "",
    rankScore: 85,
    rankReason: "Direct application learning",
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
    capabilityBuilt: `Application learning for ${job.title}`,
    requiredOutput: `Application-ready narrative for ${job.title}`,
    note: job.url ? `Role URL: ${job.url}` : "",
  } as any);

  const hasJD = (job.jdText || "").trim().length > 40;

  const [contacts, wins] = await Promise.all([storage.getContacts(), storage.getWins()]);
  const relevantContacts = contacts.filter((c) =>
    (job.relatedTrackId && c.relatedTrackId === job.relatedTrackId) ||
    (job.company && c.targetOrg && c.targetOrg.toLowerCase().includes(job.company!.toLowerCase().slice(0, 30)))
  );
  const trackWins = job.relatedTrackId
    ? wins.filter((w) => (w as any).trackId === job.relatedTrackId).slice(0, 5)
    : [];

  const jobContext = [
    `Role: ${job.title}`,
    job.company ? `Company: ${job.company}` : "",
    job.location ? `Location: ${job.location}` : "",
    job.roleArchetype ? `Archetype: ${job.roleArchetype}` : "",
    hasJD ? `\nJob description:\n${job.jdText!.trim().slice(0, 1800)}` : "",
    relevantContacts.length > 0 ? `\nExisting contacts at or related to this company/track:\n${relevantContacts.slice(0, 5).map((c) => `- ${c.who || c.name}${c.targetOrg ? ` (${c.targetOrg})` : ""} — ${c.status}`).join("\n")}` : "",
    trackWins.length > 0 ? `\nRecent wins in this track:\n${trackWins.map((w) => `- ${w.text}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const ctx = formatContextForPrompt(await buildUserContext());
  const prompt =
    `${COACH_PREAMBLE}You are a job-application coach.\n\n` +
    `${ctx}\n\n` +
    `${jobContext}\n\n` +
    `REASONING BEFORE YOU DESIGN (do this silently):\n` +
    `1. WHAT KIND OF ROLE IS THIS? Entry-level execution, mid-level specialist, senior leadership, advisory? This determines what interviewers will probe — technical depth, stakeholder management, strategic vision, or cultural fit.\n` +
    `2. WHERE IS THE USER STRONGEST? Read their profile and the role requirements. Find the 2-3 specific overlaps where their past experience directly maps. These are the stories to build around.\n` +
    `3. WHERE IS THE REAL GAP? Not the cosmetic ones. What would make an interviewer pause — a sector they haven't worked in, a technical skill they claim but can't demonstrate, a seniority jump, a career-change narrative?\n` +
    `4. WHAT DOES THIS EMPLOYER ACTUALLY WANT? If a JD is provided, read between the lines: what's listed first, what's repeated, what's marked "preferred"? If no JD, reason from the company and role type.\n` +
    `5. WHAT'S THE APPLICATION ANGLE? Given the user's background, what's the unique value proposition that a standard candidate from within the industry wouldn't have?\n\n` +
    `Generate a 4-milestone learning arc for this specific role.\n` +
    `Each milestone must be concrete and role-specific — not generic career advice.\n\n` +
    `MILESTONE STRUCTURE:\n` +
    `1. ORIENT (milestoneType: "content") — Map the role to the user's profile. ${hasJD ? "Extract strengths and gaps from the JD." : "Research what this role typically requires at this type of organisation."} suggestedTaskTitle must be a specific action.\n` +
    `2. RESEARCH (milestoneType: "content") — Understand the employer beyond the careers page: recent activity, team composition, strategic direction, what they actually care about.\n` +
    `3. SYNTHESISE (milestoneType: "synthesis") — No new research. Map existing experience to requirements — one specific story per requirement, with concrete outcomes.\n` +
    `4. ARTIFACT (milestoneType: "artifact") — Produce the "why me + why them + why now" opening narrative. Under 80 words, specific enough that it couldn't apply to another company.\n\n` +
    `RULES:\n` +
    `- suggestedTaskTitle: physically doable action, not "Understand X" or "Explore Y"\n` +
    `- scaffolding: 2-3 guiding questions per milestone — what to look for, not what to think\n` +
    `- doneWhen: a specific test ("has written X", "can name 3 specific facts") — not "feels prepared"\n` +
    `- Reference the ACTUAL role title, company name, and user's real background in your output\n\n` +
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

  const ctx = formatContextForPrompt(await buildUserContext());
  const prompt =
    `${COACH_PREAMBLE}You are a writing and execution coach helping someone build a public proof asset.\n\n` +
    `${ctx}\n\n` +
    `${context}\n\n` +
    `REASONING BEFORE YOU DESIGN (do this silently):\n` +
    `1. WHAT KIND OF PROOF ASSET IS THIS? A written piece (article, case study, analysis)? A tool or template? A portfolio piece? A talk or presentation? The execution arc depends on the format.\n` +
    `2. WHAT'S THE USER'S CREDIBILITY ANGLE? Read their profile. What specific experience gives them the right to produce this? A proof asset without a credible author is noise.\n` +
    `3. WHO IS THE AUDIENCE — AND WHAT DO THEY ALREADY KNOW? ${hustle.audience ? `The intended audience is "${hustle.audience}". ` : ""}If the audience is hiring managers, the asset needs to demonstrate thinking. If it's peers, it needs to challenge conventional wisdom. If it's a broader public, it needs a hook.\n` +
    `4. WHAT EXISTS ALREADY? What comparable pieces, tools, or resources are out there? The asset needs a clear gap it fills — the user's unique take, not a rehash.\n` +
    `5. WHAT MAKES THIS PUBLISHABLE vs. A DRAFT? For this specific format, what's the minimum bar — is it length, polish, a specific structure, external validation, or just shipping it?\n\n` +
    `Generate a 4-milestone execution arc to take this from idea to published proof asset.\n` +
    `Be specific to THIS piece — not generic writing advice.\n\n` +
    `MILESTONE STRUCTURE:\n` +
    `1. ORIENT (milestoneType: "content") — Research what exists, find the gap. Not "brainstorm ideas" — find 2-3 comparable pieces and identify what's missing or wrong.\n` +
    `2. DRAFT (milestoneType: "content") — Produce a complete first version. Done, not perfect. The goal is getting it all down, not polishing.\n` +
    `3. SYNTHESISE (milestoneType: "synthesis") — No new work. Read what exists. Identify what's actually working and what needs to go. Pure editing judgment.\n` +
    `4. ARTIFACT (milestoneType: "artifact") — The publish-ready version + a one-sentence pitch: "I wrote [title] because [reason]. It argues [claim]. It's for [reader]."\n\n` +
    `RULES:\n` +
    `- suggestedTaskTitle: physically doable action — "Write the full first draft" not "Develop the concept"\n` +
    `- scaffolding: 2-3 guiding questions per milestone — what to look for or challenge, not instructions\n` +
    `- doneWhen: a specific test ("has a complete draft", "has annotated 3 keeps and 2 cuts") — not "feels good about it"\n` +
    `- Reference the ACTUAL asset title and the user's real background in your output\n\n` +
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
