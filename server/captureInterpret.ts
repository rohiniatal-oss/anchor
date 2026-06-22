import { llmJSON, MODEL_LIGHT } from "./llm";
import { storage } from "./storage";
import { buildUserContext, formatContextForPrompt } from "./userContext";

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE INTERPRETATION LAYER
//
// Before creating any object, Anchor asks: "what kind of thing IS this?"
// The answer determines which intelligence flow runs and what objects get
// created. A task is often the downstream output of intelligence — not the
// first object created.
//
// Operating modes:
//   action     → atomic, do-it-now (create a task, done)
//   research   → understand a domain/field/topic before creating objects
//   workflow   → a specific opportunity/role that needs a full pipeline
//   decision   → weigh options, compare, choose
//   planning   → look across existing state and prioritise
//   ambiguous  → not enough signal, ask one question
// ─────────────────────────────────────────────────────────────────────────────

export type CaptureMode =
  | "action"
  | "research"
  | "workflow"
  | "decision"
  | "planning"
  | "ambiguous";

export interface CaptureInterpretation {
  mode: CaptureMode;
  confidence: "high" | "medium" | "low";
  reason: string;
  domain?: string;
  clarifyingQuestion?: string;
}

const ACTION_VERBS = /^(send|email|reply|forward|pay|book|cancel|confirm|check|open|call|text|message|sign|renew|submit|post|share|download|upload|print|return|schedule|update|finish|clean|organise|organize)\b/i;

const RESEARCH_SIGNALS = /\b(explore|get into|break into|understand|what is|how does|landscape|map out|look into|research|investigate|learn about the field|learn about the space|learn about the industry)\b/i;

const WORKFLOW_SIGNALS = /\b(apply to|prepare for|get ready for|interview at|submit to|tailor .+ for|cover letter for|cv for|application for)\b/i;

const DECISION_SIGNALS = /\b(should i|decide|choose|compare|pros and cons|trade-?off|whether|which one|figure out if|weigh|is it worth|better to)\b/i;

const PLANNING_SIGNALS = /\b(what should i do|plan my|prioriti[sz]e|figure out .+ today|what.?s next|what matters most|where should i focus)\b/i;

const DOMAIN_PATTERN = /(?:explore|get into|break into|understand|look into|learn about)\s+(.+?)(?:\s+roles?|\s+careers?|\s+jobs?|\s+field|\s+space|\s+industry|\s+sector)?$/i;

function containsAny(text: string, terms: string[]) {
  const t = text.toLowerCase();
  return terms.some((term) => t.includes(term));
}

function hasExplicitTarget(text: string): boolean {
  return /\b(at|for|to)\s+[A-Z]/.test(text);
}

export function interpretCapture(text: string): CaptureInterpretation {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (!t || t.split(" ").length <= 1) {
    return { mode: "ambiguous", confidence: "low", reason: "Too short to interpret", clarifyingQuestion: "What did you mean by this?" };
  }

  if (ACTION_VERBS.test(t) && t.split(" ").length <= 10) {
    return { mode: "action", confidence: "high", reason: "Concrete action verb with a clear target" };
  }

  if (PLANNING_SIGNALS.test(lower)) {
    return { mode: "planning", confidence: "high", reason: "Asking about priorities or what to do next" };
  }

  if (DECISION_SIGNALS.test(lower)) {
    return { mode: "decision", confidence: "high", reason: "Weighing options or making a choice" };
  }

  if (WORKFLOW_SIGNALS.test(lower) && hasExplicitTarget(t)) {
    return { mode: "workflow", confidence: "high", reason: "Specific opportunity that needs a full pipeline" };
  }

  if (RESEARCH_SIGNALS.test(lower)) {
    const domainMatch = t.match(DOMAIN_PATTERN);
    const domain = domainMatch?.[1]?.trim() || undefined;
    return { mode: "research", confidence: "high", reason: "Needs to understand the space before taking action", domain };
  }

  if (containsAny(lower, ["role", "roles", "career", "field", "industry", "sector"]) && !WORKFLOW_SIGNALS.test(lower)) {
    const domainMatch = t.match(DOMAIN_PATTERN);
    return { mode: "research", confidence: "medium", reason: "Mentions a field or role type without a specific target", domain: domainMatch?.[1]?.trim() };
  }

  if (WORKFLOW_SIGNALS.test(lower)) {
    return { mode: "workflow", confidence: "medium", reason: "Looks like an opportunity but target is unclear" };
  }

  if (ACTION_VERBS.test(t)) {
    return { mode: "action", confidence: "medium", reason: "Starts with an action verb" };
  }

  if (t.split(" ").length <= 4) {
    return { mode: "ambiguous", confidence: "low", reason: "Too vague to route confidently", clarifyingQuestion: "Is this something to explore, a specific opportunity, or a task?" };
  }

  return { mode: "ambiguous", confidence: "low", reason: "Could not determine intent", clarifyingQuestion: "What would you like to do with this?" };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN BRIEF — the research-mode intelligence object
//
// Structured understanding of a field/domain that seeds downstream objects:
// career tracks, role types, target orgs, learning items, contact archetypes.
// ─────────────────────────────────────────────────────────────────────────────

export interface DomainBrief {
  domain: string;
  summary: string;
  sectorMap: Array<{
    sector: string;
    description: string;
    exampleOrgs: string[];
  }>;
  roleShapes: Array<{
    title: string;
    what: string;
    typicalOrgs: string[];
    seniority: string;
  }>;
  gapAnalysis: {
    strengths: string[];
    gaps: string[];
    biggestGap: string;
  };
  learningPaths: Array<{
    topic: string;
    why: string;
    resourceType: string;
    suggestedResource: string;
  }>;
  networkArchetypes: Array<{
    who: string;
    why: string;
    searchTip: string;
  }>;
  proofAssetIdeas: Array<{
    title: string;
    why: string;
    format: string;
  }>;
}

export async function generateDomainBrief(domain: string): Promise<DomainBrief | null> {
  const userContext = await buildUserContext();
  const contextText = formatContextForPrompt(userContext);
  const cv = userContext.cv?.trim() || "";

  const tracks = await storage.getCareerTracks();
  const activeTrackNames = tracks.filter((t) => t.status === "active").map((t) => t.name).slice(0, 4);

  const contacts = await storage.getContacts();
  const networks = [...new Set(contacts.map((c) => (c as any).sourceNetwork).filter(Boolean))];

  const jobs = await storage.getJobs();
  const existingCompanies = [...new Set(jobs.map((j) => j.company).filter(Boolean))].slice(0, 10);

  const prompt = `You are a career strategist helping someone explore a new domain. Your job is to give them a structured understanding of the space so they can make informed moves — not generic advice.

${contextText}

DOMAIN TO EXPLORE: ${domain}
${activeTrackNames.length ? `EXISTING CAREER TRACKS: ${activeTrackNames.join(", ")}` : ""}
${existingCompanies.length ? `COMPANIES ALREADY SAVED: ${existingCompanies.join(", ")}` : ""}
${networks.length ? `THEIR NETWORKS: ${networks.join(", ")}` : ""}
${cv ? `CV (first 2000 chars):\n${cv.slice(0, 2000)}` : "NO CV PROVIDED — gap analysis should note this."}

Return JSON:
{
  "domain": "${domain}",
  "summary": "2-3 sentences: what IS this field, what's happening in it right now, and why it could fit this person",
  "sectorMap": [
    {
      "sector": "Name of sector (e.g. 'Big Tech', 'Government / Public Sector', 'Consulting', 'Think Tanks / Research')",
      "description": "1 sentence on what roles in this sector actually do",
      "exampleOrgs": ["3-5 specific real organisations actively hiring or known for this work"]
    }
  ],
  "roleShapes": [
    {
      "title": "Actual job title you'd see on LinkedIn (e.g. 'AI Strategy Lead', not 'Strategy Person')",
      "what": "1 sentence: what this person would spend their days doing",
      "typicalOrgs": ["2-3 orgs that hire this exact title"],
      "seniority": "junior|mid|senior|mixed"
    }
  ],
  "gapAnalysis": {
    "strengths": ["2-4 specific things from their CV/profile that transfer directly to this domain"],
    "gaps": ["2-4 specific skills, knowledge areas, or credentials they're likely missing"],
    "biggestGap": "The single most important gap to close first and why"
  },
  "learningPaths": [
    {
      "topic": "Specific thing to learn (e.g. 'GPAI regulation framework', not 'AI governance')",
      "why": "Why this matters for the roles above",
      "resourceType": "course|book|article|practice|certification",
      "suggestedResource": "A specific real resource if you know one, or a clear search query if not"
    }
  ],
  "networkArchetypes": [
    {
      "who": "A specific type of person to find (e.g. 'SIPA alum now at DeepMind policy team', not 'someone in AI')",
      "why": "What they could uniquely provide — referral, advice, insider view",
      "searchTip": "Exactly how to find them on LinkedIn"
    }
  ],
  "proofAssetIdeas": [
    {
      "title": "A concrete thing to write or build that would demonstrate credibility in this space",
      "why": "Why this specific piece would matter to hiring managers in this domain",
      "format": "blog post|memo|analysis|portfolio piece|presentation"
    }
  ]
}

RULES:
- 3-5 sectors. Include at least one non-obvious sector the person might not have considered.
- 3-5 role shapes. Include at least one that's more accessible / entry-level.
- Gap analysis must reference THIS person's actual background, not generic gaps.
- 3-4 learning paths, ordered by impact. First one should be closable in under a week.
- 3-4 network archetypes. Use their actual networks (${networks.join(", ") || "unknown"}) to make suggestions specific.
- 1-2 proof asset ideas — things that would SHOW capability, not just tell.
- Every organisation and resource name must be REAL. Do not invent.
- Be specific to the DOMAIN and THIS PERSON. No generic career advice.`;

  const brief = await llmJSON<DomainBrief>(prompt, { model: MODEL_LIGHT });
  if (!brief || !brief.summary) return null;
  brief.domain = domain;
  return brief;
}

export async function materializeDomainBrief(brief: DomainBrief): Promise<{
  trackId?: number;
  jobIds: number[];
  learnIds: number[];
  contactIds: number[];
  hustleIds: number[];
}> {
  const result = { trackId: undefined as number | undefined, jobIds: [] as number[], learnIds: [] as number[], contactIds: [] as number[], hustleIds: [] as number[] };

  const tracks = await storage.getCareerTracks();
  const existingTrack = tracks.find((t) =>
    t.name.toLowerCase().includes(brief.domain.toLowerCase()) ||
    brief.domain.toLowerCase().includes(t.name.toLowerCase())
  );
  const trackId = existingTrack?.id;
  result.trackId = trackId;

  const existingJobs = await storage.getJobs();
  const existingCompanies = new Set(existingJobs.map((j) => j.company.toLowerCase()));

  for (const role of brief.roleShapes.slice(0, 4)) {
    for (const org of role.typicalOrgs.slice(0, 1)) {
      if (existingCompanies.has(org.toLowerCase())) continue;
      try {
        const job = await storage.createJob({
          title: role.title,
          company: org,
          status: "wishlist",
          note: `${role.what} (discovered via ${brief.domain} exploration)`,
          roleArchetype: role.title,
          relatedTrackId: trackId ?? null,
        } as any);
        result.jobIds.push(job.id);
        existingCompanies.add(org.toLowerCase());
      } catch {}
    }
  }

  const existingLearn = await storage.getLearn();
  const existingLearnTitles = new Set(existingLearn.map((l) => l.title.toLowerCase()));

  for (const path of brief.learningPaths.slice(0, 3)) {
    if (existingLearnTitles.has(path.topic.toLowerCase())) continue;
    try {
      const learn = await storage.createLearn({
        title: path.topic,
        type: path.resourceType || "resource",
        note: `${path.why}${path.suggestedResource ? ` — Try: ${path.suggestedResource}` : ""}`,
        capabilityBuilt: path.topic,
        requiredOutput: `A useful note on ${path.topic} that could inform applications or conversations`,
        relatedTrackId: trackId ?? null,
        learnStatus: "open",
      } as any);
      result.learnIds.push(learn.id);
    } catch {}
  }

  const existingContacts = await storage.getContacts();
  const existingContactWhos = new Set(existingContacts.map((c) => (c.who || "").toLowerCase()));

  for (const archetype of brief.networkArchetypes.slice(0, 3)) {
    if (existingContactWhos.has(archetype.who.toLowerCase())) continue;
    try {
      const contact = await storage.createContact({
        name: "",
        who: archetype.who,
        why: archetype.why,
        status: "to_contact",
        relationshipStrength: "cold",
        askType: "advice",
        note: archetype.searchTip,
        relatedTrackId: trackId ?? null,
      } as any);
      result.contactIds.push(contact.id);
    } catch {}
  }

  for (const idea of brief.proofAssetIdeas.slice(0, 1)) {
    try {
      const hustle = await storage.createHustle({
        title: idea.title,
        note: `${idea.why} (Format: ${idea.format})`,
        stage: "idea",
      } as any);
      result.hustleIds.push(hustle.id);
    } catch {}
  }

  return result;
}
