import OpenAI from "openai";
import { USER_PROFILE } from "./userPromptProfile";
import type { CareerTrack, Contact, Job, NetworkGap } from "@shared/schema";

export type ArchetypeKey =
  | "recent_switcher"
  | "near_peer"
  | "recruiter"
  | "senior_decision_maker"
  | "connector"
  | "domain_expert";

export type MoveType =
  | "advice"
  | "intro"
  | "referral"
  | "follow_up"
  | "market_intelligence"
  | "reconnect";

export type AccessType =
  | "advice"
  | "intro"
  | "referral"
  | "market_intelligence"
  | "hiring_signal";

export const ARCHETYPE_META: Record<ArchetypeKey, { label: string; description: string }> = {
  recent_switcher: {
    label: "Recent switcher",
    description: "Someone who made a similar career transition in the last 2-3 years",
  },
  near_peer: {
    label: "Near-peer in target role",
    description: "Someone 1-2 levels above in a role you're targeting",
  },
  recruiter: {
    label: "Recruiter / headhunter",
    description: "Someone who places candidates in your target sector",
  },
  senior_decision_maker: {
    label: "Senior decision maker",
    description: "A senior person at a target org who makes or influences hiring",
  },
  connector: {
    label: "Warm connector",
    description: "A well-networked person who can introduce you to others",
  },
  domain_expert: {
    label: "Domain expert",
    description: "A practitioner with deep expertise in the subject area",
  },
};

export type NetworkGapResult = {
  archetype: ArchetypeKey;
  priority: "high" | "medium" | "low";
  reason: string;
  whyItMatters: string;
  whatToAsk: string;
  suggestedSearches: string[];
};

export type ContactClassificationResult = {
  trackId: number;
  archetype: ArchetypeKey;
  relevanceScore: number; // 1-5
  accessTypes: AccessType[];
  reasoning: string;
};

export type RecommendedMove = {
  moveType: MoveType;
  suggestedAsk: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  riskLevel: "low" | "medium" | "high";
};

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function liveJobsRelevantToContact(contact: Contact, track: CareerTrack | null, jobs: Job[]): Job[] {
  const liveJobs = jobs.filter((j) => j.status === "wishlist" || j.status === "applied" || j.status === "interviewing");
  if (liveJobs.length === 0) return [];

  if (track) {
    const trackJobs = liveJobs.filter((j) => j.relatedTrackId === track.id);
    if (trackJobs.length > 0) return trackJobs;
  }

  const targetOrg = normalizeText(contact.targetOrg);
  const targetRole = normalizeText(contact.targetRole);
  const contactMatchedJobs = liveJobs.filter((job) => {
    const company = normalizeText(job.company);
    const title = normalizeText(job.title);
    const archetype = normalizeText(job.roleArchetype);
    return (!!targetOrg && company === targetOrg)
      || (!!targetRole && (title.includes(targetRole) || archetype.includes(targetRole)));
  });
  if (contactMatchedJobs.length > 0) return contactMatchedJobs;

  return track ? [] : liveJobs;
}

function safeParseArray<T>(raw: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function extractJson(text: string): any {
  const clean = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(clean); } catch { return null; }
}

export async function generateNetworkGaps(
  track: CareerTrack,
  existingContacts: Contact[],
): Promise<NetworkGapResult[]> {
  const client = new OpenAI();

  const contactSummary = existingContacts.length > 0
    ? existingContacts.map((c) => `- ${c.who}${c.targetOrg ? ` @ ${c.targetOrg}` : ""}${c.sector ? ` (${c.sector})` : ""}`).join("\n")
    : "None yet";

  const prompt =
    `You are building a network strategy for ${USER_PROFILE}\n\n` +
    `CAREER TRACK: "${track.name}"\n` +
    (track.description ? `Description: ${track.description}\n` : "") +
    (track.whyItFits ? `Why it fits her: ${track.whyItFits}\n` : "") +
    `\nEXISTING CONTACTS IN HER NETWORK:\n${contactSummary}\n\n` +
    `Generate exactly 5-6 types of people she needs to build relationships with to break into "${track.name}" roles.\n` +
    `Use ONLY these archetype keys: recent_switcher, near_peer, recruiter, senior_decision_maker, connector, domain_expert\n\n` +
    `For each archetype, be specific to THIS track and HER background (ex-Bain, ex-TBI, targeting London/UAE).\n\n` +
    `Return ONLY a JSON array:\n` +
    `[\n` +
    `  {\n` +
    `    "archetype": "recent_switcher",\n` +
    `    "priority": "high",\n` +
    `    "reason": "why this archetype matters for THIS track specifically",\n` +
    `    "whyItMatters": "what Rohini gains from talking to this person",\n` +
    `    "whatToAsk": "the exact question or ask that works best",\n` +
    `    "suggestedSearches": ["search query 1", "search query 2", "search query 3"]\n` +
    `  }\n` +
    `]\n\n` +
    `Make suggested searches concrete: org names, alumni networks, LinkedIn keywords specific to her background and the track. No generic queries.`;

  try {
    const r = await client.responses.create({ model: "gpt-4.1", input: prompt });
    const raw = extractJson(r.output_text || "");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item: any) => typeof item?.archetype === "string" && item.archetype in ARCHETYPE_META)
      .map((item: any): NetworkGapResult => ({
        archetype: item.archetype as ArchetypeKey,
        priority: ["high", "medium", "low"].includes(item.priority) ? item.priority : "medium",
        reason: String(item.reason || "").slice(0, 300),
        whyItMatters: String(item.whyItMatters || "").slice(0, 300),
        whatToAsk: String(item.whatToAsk || "").slice(0, 200),
        suggestedSearches: Array.isArray(item.suggestedSearches)
          ? item.suggestedSearches.slice(0, 4).map((s: any) => String(s).slice(0, 80))
          : [],
      }));
  } catch {
    return [];
  }
}

export async function classifyContact(
  contact: Contact,
  tracks: CareerTrack[],
): Promise<ContactClassificationResult[]> {
  if (!contact.who && !contact.targetOrg && !contact.targetRole) return [];

  const client = new OpenAI();
  const archetypeKeys = Object.keys(ARCHETYPE_META).join("|");
  const archetypeDescriptions = Object.entries(ARCHETYPE_META)
    .map(([k, v]) => `- ${k}: ${v.description}`)
    .join("\n");

  const prompt =
    `You are classifying a contact for Rohini's career network.\n\n` +
    `ABOUT ROHINI: ${USER_PROFILE}\n\n` +
    `ACTIVE CAREER TRACKS:\n` +
    tracks.map((t) => `- ID ${t.id}: "${t.name}"${t.description ? ` — ${t.description}` : ""}`).join("\n") +
    `\n\nCONTACT:\n` +
    `Who/role: ${contact.who}\n` +
    (contact.name ? `Name: ${contact.name}\n` : "") +
    (contact.targetOrg ? `Organisation: ${contact.targetOrg}\n` : "") +
    (contact.targetRole ? `Their role: ${contact.targetRole}\n` : "") +
    (contact.sector ? `Sector: ${contact.sector}\n` : "") +
    (contact.sourceNetwork ? `Connected via: ${contact.sourceNetwork}\n` : "") +
    (contact.why ? `Why they matter: ${contact.why}\n` : "") +
    `Relationship warmth: ${contact.relationshipStrength}\n\n` +
    `ARCHETYPES:\n${archetypeDescriptions}\n\n` +
    `For each career track where this contact is relevant (relevance >= 2), classify them.\n` +
    `Only include tracks where this person genuinely helps with that specific track.\n\n` +
    `Return ONLY a JSON array:\n` +
    `[\n` +
    `  {\n` +
    `    "trackId": <number from the track list>,\n` +
    `    "archetype": "<one of: ${archetypeKeys}>",\n` +
    `    "relevanceScore": <1-5>,\n` +
    `    "accessTypes": ["advice"|"intro"|"referral"|"market_intelligence"|"hiring_signal"],\n` +
    `    "reasoning": "<one sentence on why this person matters for this track>"\n` +
    `  }\n` +
    `]\n\n` +
    `Return [] if this person has no relevant connection to any track.`;

  try {
    const r = await client.responses.create({ model: "gpt-4.1", input: prompt });
    const raw = extractJson(r.output_text || "");
    if (!Array.isArray(raw)) return [];
    const validTrackIds = new Set(tracks.map((t) => t.id));
    return raw
      .filter((item: any) =>
        typeof item?.trackId === "number" &&
        validTrackIds.has(item.trackId) &&
        typeof item?.archetype === "string" &&
        item.archetype in ARCHETYPE_META &&
        typeof item?.relevanceScore === "number"
      )
      .map((item: any): ContactClassificationResult => ({
        trackId: item.trackId,
        archetype: item.archetype as ArchetypeKey,
        relevanceScore: Math.min(5, Math.max(1, Math.round(item.relevanceScore))),
        accessTypes: Array.isArray(item.accessTypes)
          ? item.accessTypes.filter((t: any) =>
              ["advice", "intro", "referral", "market_intelligence", "hiring_signal"].includes(t)
            )
          : [],
        reasoning: String(item.reasoning || "").slice(0, 300),
      }));
  } catch {
    return [];
  }
}

export async function computeRecommendedMove(
  contact: Contact,
  classification: { archetype: ArchetypeKey; relevanceScore: number; accessTypes: AccessType[]; reasoning: string } | null,
  track: CareerTrack | null,
  jobs: Job[],
): Promise<RecommendedMove> {
  // Deterministic defaults when no AI needed
  const warmth = contact.relationshipStrength || "cold";
  const arch = classification?.archetype;
  // Use outreachedAt/repliedAt timestamps (not lastMessage which is free text)
  const lastActivityMs = (contact as any).repliedAt || (contact as any).outreachedAt || null;
  const daysSinceMessage = lastActivityMs
    ? Math.floor((Date.now() - lastActivityMs) / 86400000)
    : null;
  const hasReplied = contact.status === "replied";
  const hasMessaged = contact.status === "messaged" || contact.status === "replied";
  const isOverdue = contact.nextFollowUpDate
    ? new Date(contact.nextFollowUpDate + "T00:00:00") < new Date()
    : false;

  // Decision defaults (deterministic, no AI needed for most cases)
  if (isOverdue && hasMessaged) {
    return {
      moveType: "follow_up",
      suggestedAsk: "Follow up on your last message — keep the door open with a specific question or update.",
      reason: "Follow-up is overdue. A timely follow-up significantly increases response rates.",
      confidence: "high",
      riskLevel: "low",
    };
  }

  if (warmth === "warm" || warmth === "strong") {
    if (daysSinceMessage && daysSinceMessage > 60) {
      return {
        moveType: "reconnect",
        suggestedAsk: "Reconnect before making any ask — catch up first, then mention what you're working on.",
        reason: "You were warm but it's been a while. Reconnect before asking for anything.",
        confidence: "high",
        riskLevel: "low",
      };
    }
  }

  // Archetype-based defaults
  if (arch === "connector" && warmth !== "cold") {
    return {
      moveType: "intro",
      suggestedAsk: "Ask for one specific introduction — name the type of person, not a specific name.",
      reason: "Connectors have wide networks. One targeted intro request is their most natural ask.",
      confidence: "high",
      riskLevel: "low",
    };
  }

  if (arch === "recruiter") {
    return {
      moveType: "market_intelligence",
      suggestedAsk: "Ask what they're seeing in the market for your profile — not for a role, for insight.",
      reason: "Recruiters respond well to market intelligence conversations, not direct job asks.",
      confidence: "high",
      riskLevel: "low",
    };
  }

  if (arch === "senior_decision_maker") {
    return {
      moveType: "advice",
      suggestedAsk: "Ask for their perspective on what makes a compelling candidate — not for a job.",
      reason: "Senior people respond to genuine curiosity, not asks. Perspective is safe; job requests are not.",
      confidence: "high",
      riskLevel: "low",
    };
  }

  if (arch === "recent_switcher") {
    return {
      moveType: "advice",
      suggestedAsk: "Ask how they made the transition from consulting — what worked, what they'd do differently.",
      reason: "They've done exactly what you're trying to do. Their path is the most useful intelligence.",
      confidence: "high",
      riskLevel: "low",
    };
  }

  if (arch === "near_peer") {
    const relevantLiveJobs = liveJobsRelevantToContact(contact, track, jobs);
    if (relevantLiveJobs.length > 0 && (warmth === "warm" || warmth === "strong")) {
      return {
        moveType: "referral",
        suggestedAsk: "Ask if they'd be willing to put in a word, given the role is a good fit.",
        reason: "You have a live relevant role and a warm relationship — this is the right moment for a referral-style ask.",
        confidence: "medium",
        riskLevel: "medium",
      };
    }
    return {
      moveType: "advice",
      suggestedAsk: "Ask what the role actually looks like day-to-day and how to prepare.",
      reason: "Near-peers can give you the ground truth about what the role really involves.",
      confidence: "high",
      riskLevel: "low",
    };
  }

  // Generic fallback
  return {
    moveType: warmth === "cold" ? "advice" : "follow_up",
    suggestedAsk:
      warmth === "cold"
        ? "Ask for a 20-minute perspective on the sector — low pressure, high value."
        : "Follow up with a specific question or update on what you're working on.",
    reason: "Starting with advice or perspective is the lowest-risk, highest-response approach.",
    confidence: "medium",
    riskLevel: "low",
  };
}

export async function draftOutreachMessage(
  contact: Contact,
  move: RecommendedMove,
  track: CareerTrack | null,
  userContext: string,
): Promise<string> {
  const client = new OpenAI();
  const hasName = !!(contact.name || "").trim();
  const nameOrg = [contact.name, contact.targetOrg].filter(Boolean).join(" at ");

  const systemPrompt =
    `You are helping Rohini Atal draft a professional outreach message.\n\n` +
    `ABOUT ROHINI: ${USER_PROFILE}\n` +
    (track ? `She is pursuing: ${track.name}.\n` : "") +
    `\nABOUT THE CONTACT:\n` +
    `Who/role: ${contact.who}\n` +
    (contact.name ? `Name: ${contact.name}\n` : "") +
    (contact.targetOrg ? `Organisation: ${contact.targetOrg}\n` : "") +
    (contact.targetRole ? `Their role: ${contact.targetRole}\n` : "") +
    (contact.sourceNetwork ? `Connection context: ${contact.sourceNetwork}\n` : "") +
    `Relationship warmth: ${contact.relationshipStrength}\n` +
    (contact.why ? `Why this person matters: ${contact.why}\n` : "") +
    `\nRECOMMENDED MOVE: ${move.moveType}\n` +
    `Suggested ask: ${move.suggestedAsk}\n` +
    `Why this ask: ${move.reason}\n` +
    (userContext ? `\nADDITIONAL CONTEXT: ${userContext}\n` : "") +
    (hasName ? `\nSearch for "${nameOrg}" to find what they are currently working on. Use that to open with something specific.\n` : "") +
    `\nTHINK BEFORE WRITING:\n` +
    `1. What is the most credible opening given Rohini's background and this connection?\n` +
    `2. What's genuinely interesting to this person about hearing from Rohini?\n` +
    `3. How does the ask (${move.moveType}) land naturally given the relationship warmth (${contact.relationshipStrength})?\n` +
    `4. What specific detail makes this feel researched, not templated?\n\n` +
    `WRITE THE MESSAGE:\n` +
    `- 100-140 words maximum\n` +
    `- First person as Rohini\n` +
    `- No salutation (no "Hi [Name]") — just the body text\n` +
    `- No sign-off — just the body\n` +
    `- Open with something specific and real (NOT "I hope you're well")\n` +
    `- State the ask (${move.moveType}) clearly but naturally\n` +
    `- End with a low-pressure, concrete call to action\n` +
    `- If you have no specific knowledge of their current work, do NOT invent it — find another hook\n\n` +
    `Return ONLY the message body text. No preamble, no labels.`;

  try {
    const tools: any[] = hasName ? [{ type: "web_search_preview" }] : [];
    let r: any;
    try {
      r = await client.responses.create({
        model: "gpt-4.1",
        input: systemPrompt,
        ...(tools.length > 0 ? { tools } : {}),
      });
    } catch {
      // web_search_preview not available — retry without tools
      r = await client.responses.create({ model: "gpt-4.1", input: systemPrompt });
    }
    return (r.output_text || "").trim();
  } catch {
    return "";
  }
}

export async function computeBestNetworkingMove(
  contacts: Contact[],
  classifications: Array<{ contactId: number; trackId: number; archetype: ArchetypeKey; relevanceScore: number; reasoning: string }>,
  jobs: Job[],
  tracks: CareerTrack[],
): Promise<{ contact: Contact; move: RecommendedMove; track: CareerTrack | null; reason: string } | null> {
  if (contacts.length === 0) return null;

  // Score each contact for "best move today"
  const scored = contacts.map((c) => {
    const cls = classifications
      .filter((cl) => cl.contactId === c.id)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)[0];
    const track = cls ? tracks.find((t) => t.id === cls.trackId) ?? null : null;

    let score = 0;
    // Overdue follow-up is urgent
    if (c.nextFollowUpDate && new Date(c.nextFollowUpDate + "T00:00:00") < new Date()) score += 50;
    // Replied but no follow-up
    if (c.status === "replied" && !c.nextFollowUpDate) score += 40;
    // High relevance classification
    if (cls) score += cls.relevanceScore * 8;
    // Warm/strong relationship
    if (c.relationshipStrength === "warm") score += 10;
    if (c.relationshipStrength === "strong") score += 20;
    // Not yet contacted
    if (c.status === "to_contact") score += 15;

    return { contact: c, cls, track, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;

  const move = await computeRecommendedMove(
    best.contact,
    best.cls ? { ...best.cls, accessTypes: [] as AccessType[] } : null,
    best.track,
    jobs,
  );

  const reason = best.cls?.reasoning || move.reason;
  return { contact: best.contact, move, track: best.track, reason };
}

// ─────────────────────────────────────────────────────────────────────────
// NEXT ACTION ENGINE — computes the follow-up action after each interaction.
// Used by the response tracking feature (log-interaction endpoint).
// ─────────────────────────────────────────────────────────────────────────

const FOLLOW_UP_DAYS_BY_ARCHETYPE: Record<ArchetypeKey, number> = {
  recruiter: 3,
  near_peer: 4,
  recent_switcher: 4,
  connector: 5,
  domain_expert: 5,
  senior_decision_maker: 8,
};

export function computeNextAction(
  interactionType: "outreach" | "response" | "meeting" | "intro" | "referral" | "declined" | "note",
  archetype: ArchetypeKey | null,
  now: number = Date.now(),
): { type: string; dueMs: number; desc: string } | null {
  const days = archetype ? (FOLLOW_UP_DAYS_BY_ARCHETYPE[archetype] ?? 5) : 5;
  const dayMs = 24 * 60 * 60 * 1000;

  switch (interactionType) {
    case "outreach":
      return {
        type: "follow_up",
        dueMs: now + days * dayMs,
        desc: `Follow up if no reply (${days} days)`,
      };
    case "response":
      if (archetype === "recruiter") {
        return { type: "send_cv", dueMs: now + dayMs, desc: "Send CV and availability" };
      }
      return { type: "book_call", dueMs: now + 2 * dayMs, desc: "Reply to book a call or coffee chat" };
    case "meeting":
      if (archetype === "recruiter") {
        return { type: "send_thankyou", dueMs: now + dayMs, desc: "Send thank-you note with CV" };
      }
      if (archetype === "senior_decision_maker") {
        return { type: "send_followup", dueMs: now + dayMs, desc: "Send follow-up email within 24h" };
      }
      return { type: "keep_warm", dueMs: now + 14 * dayMs, desc: "Keep warm — check in within 2 weeks" };
    case "intro":
      return { type: "follow_intro", dueMs: now + dayMs, desc: "Follow up on the intro within 24h" };
    case "referral":
      return { type: "send_thankyou", dueMs: now + dayMs, desc: "Send thank-you and keep them updated on application" };
    case "declined":
      return null; // no next action
    default:
      return null;
  }
}
