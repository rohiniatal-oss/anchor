import type { CareerTrack } from "@shared/schema";
import { llmJSON, MODEL_PRIMARY } from "./llm";
import { storage } from "./storage";
import { buildUserContext, formatContextForPrompt } from "./userContext";

export type TrackPlanLaneName =
  | "landscape"
  | "roles"
  | "capability"
  | "network"
  | "proof"
  | "experiments"
  | "positioning";

export interface TrackPlanWorkstream {
  title: string;
  action: string;
  doneWhen: string;
  evidence: string;
  priority: number;
}

export interface TrackPlanLane {
  lane: TrackPlanLaneName;
  objective: string;
  whyNow: string;
  workstreams: TrackPlanWorkstream[];
}

export interface TrackResearchBrief {
  domain: string;
  trackName: string;
  trackThesis: string;
  targetRoleArchetype: string;
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
  requirementMap: {
    capabilities: string[];
    knowledge: string[];
    evidence: string[];
    narrative: string[];
  };
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
    output: string;
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
    firstStep: string;
  }>;
  plan: {
    horizon: string;
    logic: string;
    lanes: TrackPlanLane[];
  };
}

export interface MaterializedTrackResearch {
  trackId: number;
  jobIds: number[];
  learnIds: number[];
  contactIds: number[];
  hustleIds: number[];
}

export interface RunTrackResearchResult {
  track: CareerTrack;
  brief: TrackResearchBrief;
  materialized: MaterializedTrackResearch | null;
}

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return normalize(value).replace(/\s+/g, "-").slice(0, 80) || "track";
}

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items.map(compact).filter(Boolean)) {
    const key = normalize(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function jsonObject(raw: string): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function item(text: string, frequency = 1) {
  return {
    text,
    source: "inferred" as const,
    confidence: "medium" as const,
    frequency,
    sourceRoles: [] as string[],
  };
}

function validateBrief(domain: string, raw: TrackResearchBrief | null): TrackResearchBrief | null {
  if (!raw || !compact(raw.summary)) return null;
  const trackName = compact(raw.trackName) || compact(raw.domain) || domain;
  return {
    domain: compact(raw.domain) || domain,
    trackName,
    trackThesis: compact(raw.trackThesis) || compact(raw.summary),
    targetRoleArchetype: compact(raw.targetRoleArchetype) || trackName,
    summary: compact(raw.summary),
    sectorMap: asArray(raw.sectorMap).map((s) => ({
      sector: compact(s.sector),
      description: compact(s.description),
      exampleOrgs: uniqueStrings(asArray(s.exampleOrgs)),
    })).filter((s) => s.sector),
    roleShapes: asArray(raw.roleShapes).map((r) => ({
      title: compact(r.title),
      what: compact(r.what),
      typicalOrgs: uniqueStrings(asArray(r.typicalOrgs)),
      seniority: compact(r.seniority) || "mixed",
    })).filter((r) => r.title),
    requirementMap: {
      capabilities: uniqueStrings(asArray(raw.requirementMap?.capabilities)),
      knowledge: uniqueStrings(asArray(raw.requirementMap?.knowledge)),
      evidence: uniqueStrings(asArray(raw.requirementMap?.evidence)),
      narrative: uniqueStrings(asArray(raw.requirementMap?.narrative)),
    },
    gapAnalysis: {
      strengths: uniqueStrings(asArray(raw.gapAnalysis?.strengths)),
      gaps: uniqueStrings(asArray(raw.gapAnalysis?.gaps)),
      biggestGap: compact(raw.gapAnalysis?.biggestGap),
    },
    learningPaths: asArray(raw.learningPaths).map((p) => ({
      topic: compact(p.topic),
      why: compact(p.why),
      resourceType: compact(p.resourceType) || "resource",
      suggestedResource: compact(p.suggestedResource),
      output: compact(p.output),
    })).filter((p) => p.topic),
    networkArchetypes: asArray(raw.networkArchetypes).map((n) => ({
      who: compact(n.who),
      why: compact(n.why),
      searchTip: compact(n.searchTip),
    })).filter((n) => n.who),
    proofAssetIdeas: asArray(raw.proofAssetIdeas).map((p) => ({
      title: compact(p.title),
      why: compact(p.why),
      format: compact(p.format),
      firstStep: compact(p.firstStep),
    })).filter((p) => p.title),
    plan: {
      horizon: compact(raw.plan?.horizon) || "2-4 weeks",
      logic: compact(raw.plan?.logic) || "Build enough domain understanding, evidence, people access, and role signal to decide whether this track is worth pursuing.",
      lanes: asArray(raw.plan?.lanes).map((lane) => ({
        lane: lane.lane,
        objective: compact(lane.objective),
        whyNow: compact(lane.whyNow),
        workstreams: asArray(lane.workstreams).map((w) => ({
          title: compact(w.title),
          action: compact(w.action),
          doneWhen: compact(w.doneWhen),
          evidence: compact(w.evidence),
          priority: Number.isFinite(Number(w.priority)) ? Number(w.priority) : 3,
        })).filter((w) => w.title && w.action),
      })).filter((lane) => lane.lane && lane.objective),
    },
  };
}

async function researchFocusArea(domain: string): Promise<TrackResearchBrief | null> {
  const userContext = await buildUserContext();
  const contextText = formatContextForPrompt(userContext);
  const cv = userContext.cv?.trim() || "";
  const tracks = await storage.getCareerTracks();
  const activeTrackNames = tracks.filter((t) => t.status === "active").map((t) => t.name).slice(0, 6);
  const jobs = await storage.getJobs();
  const existingCompanies = uniqueStrings(jobs.map((j) => j.company).filter(Boolean)).slice(0, 12);
  const contacts = await storage.getContacts();
  const networks = uniqueStrings(contacts.map((c) => c.sourceNetwork).filter(Boolean)).slice(0, 12);

  const prompt = `You are the research and strategy layer for Anchor, a career operating system. The user has entered an area of focus. Your job is not to pick one next move. Your job is to research the space and create a cohesive, structured, multi-lane plan that Anchor can execute over time.

${contextText}

AREA OF FOCUS: ${domain}
${activeTrackNames.length ? `EXISTING TRACKS: ${activeTrackNames.join(", ")}` : ""}
${existingCompanies.length ? `COMPANIES ALREADY SAVED: ${existingCompanies.join(", ")}` : ""}
${networks.length ? `KNOWN NETWORKS: ${networks.join(", ")}` : ""}
${cv ? `CV EXCERPT:\n${cv.slice(0, 2600)}` : "NO CV PROVIDED - be explicit where fit/gap confidence is lower."}

Search the web for current, real organisations, role titles, resources, and market language. Then return ONLY valid JSON with this exact shape:
{
  "domain": "${domain}",
  "trackName": "short track name",
  "trackThesis": "why this track could make sense for this person, with caveats",
  "targetRoleArchetype": "the broad role family this track points toward",
  "summary": "2-3 sentences on what this area means across the market now",
  "sectorMap": [{ "sector": "sector name", "description": "what work looks like here", "exampleOrgs": ["real org 1", "real org 2", "real org 3"] }],
  "roleShapes": [{ "title": "realistic job title", "what": "what this person actually does", "typicalOrgs": ["real org 1", "real org 2"], "seniority": "junior|mid|senior|mixed" }],
  "requirementMap": {
    "capabilities": ["skills and methods repeatedly required"],
    "knowledge": ["domain knowledge repeatedly required"],
    "evidence": ["proof hiring managers expect"],
    "narrative": ["fit or positioning questions the user must answer"]
  },
  "gapAnalysis": {
    "strengths": ["specific transferable strengths from the user's background"],
    "gaps": ["specific missing skills, knowledge, evidence, or network gaps"],
    "biggestGap": "the highest leverage gap to close first"
  },
  "learningPaths": [{ "topic": "specific learning target", "why": "why it matters", "resourceType": "course|book|article|practice|certification", "suggestedResource": "real resource or precise search query", "output": "artifact or note this learning should produce" }],
  "networkArchetypes": [{ "who": "specific person type", "why": "what they uniquely provide", "searchTip": "exact LinkedIn or network search" }],
  "proofAssetIdeas": [{ "title": "specific artifact to write or build", "why": "why it proves credibility", "format": "memo|deck|analysis|blog post|portfolio", "firstStep": "first concrete creation step" }],
  "plan": {
    "horizon": "2-4 weeks or 4-6 weeks",
    "logic": "how the lanes work together as a coherent strategy",
    "lanes": [
      {
        "lane": "landscape|roles|capability|network|proof|experiments|positioning",
        "objective": "what this lane must accomplish",
        "whyNow": "why this lane belongs in the first plan",
        "workstreams": [{ "title": "workstream name", "action": "concrete action Anchor can seed", "doneWhen": "observable completion bar", "evidence": "what this creates or reveals", "priority": 1 }]
      }
    ]
  }
}

Rules:
- The plan must be multifaceted, not a single next move.
- Include 5-7 lanes, covering at minimum roles, capability, network, proof, and positioning.
- Each lane should have 1-3 workstreams. Workstreams must be specific enough to become tasks later.
- The plan should explain how to understand the role market, close gaps, build proof, meet people, and test whether the track is worth pursuing.
- Do not give generic advice like "research AI strategy". Anchor is doing the research.
- Do not invent organisations, resources, or role titles. Use real market examples.`;

  const brief = await llmJSON<TrackResearchBrief>(prompt, {
    model: MODEL_PRIMARY,
    tools: [{ type: "web_search_preview" }],
  });
  return validateBrief(domain, brief);
}

async function ensureTrackForBrief(brief: TrackResearchBrief): Promise<CareerTrack> {
  const tracks = await storage.getCareerTracks();
  const domainKey = normalize(brief.domain);
  const nameKey = normalize(brief.trackName);
  const existing = tracks.find((track) => {
    const trackName = normalize(track.name);
    const trackSlug = normalize(track.slug);
    return trackName === nameKey || trackName === domainKey || trackName.includes(domainKey) || domainKey.includes(trackName) || trackSlug === slugify(brief.trackName);
  });

  if (existing) {
    const updated = await storage.updateCareerTrack(existing.id, {
      name: existing.name || brief.trackName,
      description: brief.summary || existing.description,
      targetRoleArchetype: brief.targetRoleArchetype || existing.targetRoleArchetype,
      whyItFits: brief.trackThesis || existing.whyItFits,
      status: existing.status || "active",
      priority: Math.max(existing.priority || 0, 70),
    } as any);
    return updated || existing;
  }

  return storage.createCareerTrack({
    slug: slugify(brief.trackName || brief.domain),
    name: brief.trackName || brief.domain,
    description: brief.summary,
    targetRoleArchetype: brief.targetRoleArchetype,
    priority: 70,
    status: "active",
    whyItFits: brief.trackThesis,
    trackIntelligence: "",
  } as any);
}

async function persistTrackPlan(track: CareerTrack, brief: TrackResearchBrief): Promise<CareerTrack> {
  const targetOrganizations = uniqueStrings([
    ...brief.sectorMap.flatMap((s) => s.exampleOrgs || []),
    ...brief.roleShapes.flatMap((r) => r.typicalOrgs || []),
  ]);
  const roleFamilies = uniqueStrings(brief.roleShapes.map((r) => r.title));
  const previous = jsonObject(track.trackIntelligence || "");

  const next = {
    ...previous,
    thesis: brief.trackThesis || brief.summary,
    roleFamilies,
    targetOrganizations,
    recurringCapabilities: brief.requirementMap.capabilities.map((text) => item(text)),
    recurringKnowledgeNeeds: brief.requirementMap.knowledge.map((text) => item(text)),
    recurringEvidenceBar: brief.requirementMap.evidence.map((text) => item(text)),
    recurringNarrativeChallenges: brief.requirementMap.narrative.map((text) => item(text)),
    requirementBriefs: Array.isArray(previous.requirementBriefs) ? previous.requirementBriefs : [],
    learningPriorities: uniqueStrings(brief.learningPaths.map((p) => p.topic)),
    proofAssetsToBuild: uniqueStrings(brief.proofAssetIdeas.map((p) => p.title)),
    networkingTargets: uniqueStrings(brief.networkArchetypes.map((n) => n.who)),
    activeOpportunityCount: Number(previous.activeOpportunityCount || 0),
    roleModelsAnalyzed: Number(previous.roleModelsAnalyzed || 0),
    sourceDomain: brief.domain,
    researchSummary: brief.summary,
    sectorMap: brief.sectorMap,
    roleShapes: brief.roleShapes,
    requirementMap: brief.requirementMap,
    gapAnalysis: brief.gapAnalysis,
    trackPlan: brief.plan,
    researchedAt: Date.now(),
    lastUpdated: Date.now(),
  };

  const updated = await storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(next) } as any);
  return updated || track;
}

export async function materializeTrackResearch(track: CareerTrack, brief: TrackResearchBrief): Promise<MaterializedTrackResearch> {
  const result: MaterializedTrackResearch = { trackId: track.id, jobIds: [], learnIds: [], contactIds: [], hustleIds: [] };

  const existingJobs = await storage.getJobs();
  const jobKeys = new Set(existingJobs.map((j) => `${normalize(j.title)}|${normalize(j.company)}`));
  for (const role of brief.roleShapes.slice(0, 5)) {
    const org = role.typicalOrgs[0] || "";
    const key = `${normalize(role.title)}|${normalize(org)}`;
    if (jobKeys.has(key)) continue;
    try {
      const job = await storage.createJob({
        title: role.title,
        company: org,
        status: "wishlist",
        note: `${role.what} Discovered through ${brief.domain} track research.`,
        nextStep: "Review the role shape and decide whether this is a target example.",
        roleArchetype: role.title,
        relatedTrackId: track.id,
        sourceType: "track_research",
      } as any);
      result.jobIds.push(job.id);
      jobKeys.add(key);
    } catch {}
  }

  const existingLearn = await storage.getLearn();
  const learnKeys = new Set(existingLearn.map((l) => normalize(l.title)));
  for (const path of brief.learningPaths.slice(0, 5)) {
    const key = normalize(path.topic);
    if (learnKeys.has(key)) continue;
    try {
      const learn = await storage.createLearn({
        title: path.topic,
        type: path.resourceType || "resource",
        learnStatus: "open",
        note: `${path.why}${path.suggestedResource ? ` Suggested resource: ${path.suggestedResource}.` : ""}`,
        capabilityBuilt: path.topic,
        requiredOutput: path.output || `A reusable note or artifact on ${path.topic}`,
        relatedTrackId: track.id,
        sourceType: "track_research",
        proofIntent: true,
      } as any);
      result.learnIds.push(learn.id);
      learnKeys.add(key);
    } catch {}
  }

  const existingContacts = await storage.getContacts();
  const contactKeys = new Set(existingContacts.map((c) => normalize(c.who || c.name)));
  for (const archetype of brief.networkArchetypes.slice(0, 5)) {
    const key = normalize(archetype.who);
    if (contactKeys.has(key)) continue;
    try {
      const contact = await storage.createContact({
        name: "",
        who: archetype.who,
        why: archetype.why,
        status: "to_contact",
        relationshipStrength: "cold",
        askType: "advice",
        note: archetype.searchTip,
        relatedTrackId: track.id,
      } as any);
      result.contactIds.push(contact.id);
      contactKeys.add(key);
    } catch {}
  }

  const existingHustles = await storage.getHustles();
  const hustleKeys = new Set(existingHustles.map((h) => normalize(h.title)));
  for (const idea of brief.proofAssetIdeas.slice(0, 3)) {
    const key = normalize(idea.title);
    if (hustleKeys.has(key)) continue;
    try {
      const hustle = await storage.createHustle({
        title: idea.title,
        note: `${idea.why}${idea.format ? ` Format: ${idea.format}.` : ""}`,
        nextStep: idea.firstStep || "Define the first useful artifact outline.",
        stage: "idea",
        proofAssetForTrack: track.id,
      } as any);
      result.hustleIds.push(hustle.id);
      hustleKeys.add(key);
    } catch {}
  }

  return result;
}

export async function runTrackResearch(domain: string, options: { materialize?: boolean } = {}): Promise<RunTrackResearchResult | null> {
  const cleaned = compact(domain);
  if (!cleaned) return null;
  const brief = await researchFocusArea(cleaned);
  if (!brief) return null;
  const initialTrack = await ensureTrackForBrief(brief);
  const track = await persistTrackPlan(initialTrack, brief);
  const materialized = options.materialize === false ? null : await materializeTrackResearch(track, brief);
  return { track, brief, materialized };
}
