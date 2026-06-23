import type { CareerTrack } from "@shared/schema";
import { llmJSON, MODEL_PRIMARY } from "./llm";
import { storage } from "./storage";
import { buildUserContext, formatContextForPrompt } from "./userContext";
import { materializeTrackResearch } from "./trackResearchAgent";

type ResearchUse = "market_map" | "role_map" | "requirements" | "learning" | "network" | "proof";
type SourceType = "job_posting" | "employer" | "institution" | "course" | "article" | "report" | "profile" | "other";

type TrackResearchSearchPlan = {
  marketQueries: string[];
  roleQueries: string[];
  organizationQueries: string[];
  requirementQueries: string[];
  learningQueries: string[];
  networkQueries: string[];
  sourcePriorities: string[];
  ambiguityNotes: string[];
};

type EvidencePackItem = {
  sourceTitle: string;
  sourceUrl: string;
  sourceType: SourceType;
  claimSupported: string;
  usedFor: ResearchUse;
  confidence: "high" | "medium" | "low";
  whyReliable: string;
};

type FitGapDimension = {
  strengths: string[];
  gaps: string[];
  evidenceNeeded: string[];
};

type StructuredTrackBrief = {
  domain: string;
  trackName: string;
  trackThesis: string;
  targetRoleArchetype: string;
  summary: string;
  searchPlan: TrackResearchSearchPlan;
  evidencePack: EvidencePackItem[];
  researchEvidence: Array<{
    claim: string;
    sourceTitle: string;
    sourceUrl: string;
    usedFor: ResearchUse;
    confidence: "high" | "medium" | "low";
  }>;
  trackHypotheses: Array<{
    hypothesis: string;
    whyItMightBeTrue: string;
    howToTest: string;
    disconfirmingSignal: string;
    priority: number;
  }>;
  sectorMap: Array<{ sector: string; description: string; exampleOrgs: string[] }>;
  roleShapes: Array<{ title: string; what: string; typicalOrgs: string[]; seniority: string }>;
  requirementMap: {
    capabilities: string[];
    knowledge: string[];
    evidence: string[];
    narrative: string[];
  };
  fitGapMatrix: {
    technicalOrDomainKnowledge: FitGapDimension;
    roleSpecificSkills: FitGapDimension;
    sectorCredibility: FitGapDimension;
    networkAccess: FitGapDimension;
    narrativeFit: FitGapDimension;
  };
  gapAnalysis: { strengths: string[]; gaps: string[]; biggestGap: string };
  learningPaths: Array<{
    topic: string;
    why: string;
    resourceType: string;
    suggestedResource: string;
    output: string;
  }>;
  networkArchetypes: Array<{ who: string; why: string; searchTip: string }>;
  proofAssetIdeas: Array<{ title: string; why: string; format: string; firstStep: string }>;
  plan: {
    horizon: string;
    logic: string;
    lanes: Array<{
      lane: "market_map" | "role_map" | "fit_map" | "capability_build" | "proof_build" | "network_map" | "experiments" | "positioning";
      objective: string;
      whyNow: string;
      workstreams: Array<{
        title: string;
        action: string;
        doneWhen: string;
        evidence: string;
        priority: number;
      }>;
    }>;
  };
};

export type StructuredTrackResearchResult = {
  track: CareerTrack;
  brief: StructuredTrackBrief;
  materialized: { trackId: number; jobIds: number[]; learnIds: number[]; contactIds: number[]; hustleIds: number[] } | null;
};

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

function evidenceItem(text: string) {
  return {
    text,
    source: "inferred" as const,
    confidence: "medium" as const,
    frequency: 1,
    sourceRoles: [] as string[],
  };
}

function fitGap(raw: FitGapDimension | undefined | null): FitGapDimension {
  return {
    strengths: uniqueStrings(asArray(raw?.strengths)),
    gaps: uniqueStrings(asArray(raw?.gaps)),
    evidenceNeeded: uniqueStrings(asArray(raw?.evidenceNeeded)),
  };
}

function normalizeSearchPlan(raw: TrackResearchSearchPlan | null | undefined, domain: string): TrackResearchSearchPlan {
  return {
    marketQueries: uniqueStrings(asArray(raw?.marketQueries)).slice(0, 5),
    roleQueries: uniqueStrings(asArray(raw?.roleQueries)).slice(0, 5),
    organizationQueries: uniqueStrings(asArray(raw?.organizationQueries)).slice(0, 5),
    requirementQueries: uniqueStrings(asArray(raw?.requirementQueries)).slice(0, 5),
    learningQueries: uniqueStrings(asArray(raw?.learningQueries)).slice(0, 4),
    networkQueries: uniqueStrings(asArray(raw?.networkQueries)).slice(0, 4),
    sourcePriorities: uniqueStrings(asArray(raw?.sourcePriorities)).slice(0, 8),
    ambiguityNotes: uniqueStrings(asArray(raw?.ambiguityNotes)).slice(0, 6),
  };
}

function normalizeEvidence(raw: EvidencePackItem[] | null | undefined): EvidencePackItem[] {
  return asArray(raw).map((item) => ({
    sourceTitle: compact(item.sourceTitle),
    sourceUrl: compact(item.sourceUrl),
    sourceType: item.sourceType || "other",
    claimSupported: compact(item.claimSupported),
    usedFor: item.usedFor || "market_map",
    confidence: item.confidence || "medium",
    whyReliable: compact(item.whyReliable),
  })).filter((item) => item.sourceTitle && item.claimSupported).slice(0, 18);
}

function normalizeBrief(domain: string, raw: StructuredTrackBrief | null, searchPlan: TrackResearchSearchPlan, evidencePack: EvidencePackItem[]): StructuredTrackBrief | null {
  if (!raw || !compact(raw.summary)) return null;
  const trackName = compact(raw.trackName) || compact(raw.domain) || domain;
  const researchEvidence = asArray(raw.researchEvidence).map((e) => ({
    claim: compact(e.claim),
    sourceTitle: compact(e.sourceTitle),
    sourceUrl: compact(e.sourceUrl),
    usedFor: e.usedFor || "market_map",
    confidence: e.confidence || "medium",
  })).filter((e) => e.claim && e.sourceTitle);

  return {
    domain: compact(raw.domain) || domain,
    trackName,
    trackThesis: compact(raw.trackThesis) || compact(raw.summary),
    targetRoleArchetype: compact(raw.targetRoleArchetype) || trackName,
    summary: compact(raw.summary),
    searchPlan,
    evidencePack,
    researchEvidence: researchEvidence.length ? researchEvidence : evidencePack.map((e) => ({
      claim: e.claimSupported,
      sourceTitle: e.sourceTitle,
      sourceUrl: e.sourceUrl,
      usedFor: e.usedFor,
      confidence: e.confidence,
    })),
    trackHypotheses: asArray(raw.trackHypotheses).map((h) => ({
      hypothesis: compact(h.hypothesis),
      whyItMightBeTrue: compact(h.whyItMightBeTrue),
      howToTest: compact(h.howToTest),
      disconfirmingSignal: compact(h.disconfirmingSignal),
      priority: Number.isFinite(Number(h.priority)) ? Number(h.priority) : 3,
    })).filter((h) => h.hypothesis && h.howToTest),
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
    fitGapMatrix: {
      technicalOrDomainKnowledge: fitGap(raw.fitGapMatrix?.technicalOrDomainKnowledge),
      roleSpecificSkills: fitGap(raw.fitGapMatrix?.roleSpecificSkills),
      sectorCredibility: fitGap(raw.fitGapMatrix?.sectorCredibility),
      networkAccess: fitGap(raw.fitGapMatrix?.networkAccess),
      narrativeFit: fitGap(raw.fitGapMatrix?.narrativeFit),
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
      logic: compact(raw.plan?.logic) || "Build enough evidence to decide whether this track deserves more investment.",
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

async function buildResearchInputs() {
  const userContext = await buildUserContext();
  const contextText = formatContextForPrompt(userContext);
  const cv = userContext.cv?.trim() || "";
  const tracks = await storage.getCareerTracks();
  const activeTrackNames = tracks.filter((t) => t.status === "active").map((t) => t.name).slice(0, 6);
  const jobs = await storage.getJobs();
  const existingCompanies = uniqueStrings(jobs.map((j) => j.company).filter(Boolean)).slice(0, 12);
  const contacts = await storage.getContacts();
  const networks = uniqueStrings(contacts.map((c) => c.sourceNetwork).filter(Boolean)).slice(0, 12);
  return { contextText, cv, activeTrackNames, existingCompanies, networks };
}

async function generateSearchPlan(domain: string, inputs: Awaited<ReturnType<typeof buildResearchInputs>>): Promise<TrackResearchSearchPlan> {
  const prompt = `You are designing a search plan for Anchor's career research agent.

AREA OF FOCUS: ${domain}
${inputs.activeTrackNames.length ? `EXISTING TRACKS: ${inputs.activeTrackNames.join(", ")}` : ""}
${inputs.existingCompanies.length ? `COMPANIES ALREADY SAVED: ${inputs.existingCompanies.join(", ")}` : ""}
${inputs.networks.length ? `KNOWN NETWORKS: ${inputs.networks.join(", ")}` : ""}

Create a MECE search plan. Do not answer the research question yet. Return ONLY JSON:
{
  "marketQueries": ["queries that define the market and sub-sectors"],
  "roleQueries": ["queries that find real role titles and role families"],
  "organizationQueries": ["queries that find employers and institutions"],
  "requirementQueries": ["queries that find job requirements from postings or careers pages"],
  "learningQueries": ["queries that find resources, courses, frameworks, or proof-building references"],
  "networkQueries": ["queries for finding people archetypes on LinkedIn or alumni networks"],
  "sourcePriorities": ["types of sources to prefer, in priority order"],
  "ambiguityNotes": ["different meanings this focus area could have and how the search should disambiguate"]
}

Rules:
- Include 3-5 queries per major bucket.
- Prefer queries likely to surface job postings, employer pages, credible institutions, and current market language.
- For broad terms, include adjacent terms and synonyms.`;

  const raw = await llmJSON<TrackResearchSearchPlan>(prompt, { model: MODEL_PRIMARY });
  return normalizeSearchPlan(raw, domain);
}

async function gatherEvidencePack(domain: string, inputs: Awaited<ReturnType<typeof buildResearchInputs>>, searchPlan: TrackResearchSearchPlan): Promise<EvidencePackItem[]> {
  const prompt = `You are Anchor's evidence collection agent. Use web search to execute this search plan and build a compact evidence pack. Do not create the strategy plan yet.

AREA OF FOCUS: ${domain}

SEARCH PLAN:
${JSON.stringify(searchPlan, null, 2)}

USER CONTEXT SUMMARY:
${inputs.contextText}
${inputs.cv ? `CV EXCERPT:\n${inputs.cv.slice(0, 2200)}` : "NO CV PROVIDED."}

Return ONLY JSON array items with this shape:
[
  {
    "sourceTitle": "source title",
    "sourceUrl": "source URL if available",
    "sourceType": "job_posting|employer|institution|course|article|report|profile|other",
    "claimSupported": "specific claim this source supports",
    "usedFor": "market_map|role_map|requirements|learning|network|proof",
    "confidence": "high|medium|low",
    "whyReliable": "why this source should be trusted or how to interpret it"
  }
]

Evidence requirements:
- 10-15 total evidence items.
- At least 3 job posting or employer/careers-page items if available.
- At least 2 role/requirement evidence items.
- At least 2 market/sector evidence items.
- At least 1 learning/proof-building evidence item.
- Prioritize current, primary, and employer/institutional sources over generic blogs.
- Do not invent URLs. If a URL is unavailable, leave sourceUrl empty and set confidence lower.`;

  const raw = await llmJSON<EvidencePackItem[]>(prompt, {
    model: MODEL_PRIMARY,
    tools: [{ type: "web_search_preview" }],
  });
  return normalizeEvidence(raw);
}

async function synthesizeBrief(domain: string, inputs: Awaited<ReturnType<typeof buildResearchInputs>>, searchPlan: TrackResearchSearchPlan, evidencePack: EvidencePackItem[]): Promise<StructuredTrackBrief | null> {
  const prompt = `You are Anchor's career strategy synthesis agent. Build the final track plan using ONLY the evidence pack, the search plan, and the user context below. If evidence is thin, say so in hypotheses and confidence rather than filling gaps with generic advice.

${inputs.contextText}

AREA OF FOCUS: ${domain}
${inputs.activeTrackNames.length ? `EXISTING TRACKS: ${inputs.activeTrackNames.join(", ")}` : ""}
${inputs.existingCompanies.length ? `COMPANIES ALREADY SAVED: ${inputs.existingCompanies.join(", ")}` : ""}
${inputs.networks.length ? `KNOWN NETWORKS: ${inputs.networks.join(", ")}` : ""}
${inputs.cv ? `CV EXCERPT:\n${inputs.cv.slice(0, 2600)}` : "NO CV PROVIDED - be explicit where fit/gap confidence is lower."}

SEARCH PLAN:
${JSON.stringify(searchPlan, null, 2)}

EVIDENCE PACK:
${JSON.stringify(evidencePack, null, 2)}

Return ONLY valid JSON with this exact shape:
{
  "domain": "${domain}",
  "trackName": "short track name",
  "trackThesis": "why this track could make sense for this person, with caveats",
  "targetRoleArchetype": "the broad role family this track points toward",
  "summary": "2-3 sentences on what this area means across the market now",
  "researchEvidence": [{ "claim": "claim from evidence pack", "sourceTitle": "source title", "sourceUrl": "source URL", "usedFor": "market_map|role_map|requirements|learning|network|proof", "confidence": "high|medium|low" }],
  "trackHypotheses": [{ "hypothesis": "testable belief about the best sub-path", "whyItMightBeTrue": "why it fits the user or market", "howToTest": "specific experiment or evidence to collect", "disconfirmingSignal": "what would make Anchor deprioritize this path", "priority": 1 }],
  "sectorMap": [{ "sector": "sector name", "description": "what work looks like here", "exampleOrgs": ["real org 1", "real org 2", "real org 3"] }],
  "roleShapes": [{ "title": "realistic job title", "what": "what this person actually does", "typicalOrgs": ["real org 1", "real org 2"], "seniority": "junior|mid|senior|mixed" }],
  "requirementMap": {
    "capabilities": ["skills and methods repeatedly required"],
    "knowledge": ["domain knowledge repeatedly required"],
    "evidence": ["proof hiring managers expect"],
    "narrative": ["fit or positioning questions the user must answer"]
  },
  "fitGapMatrix": {
    "technicalOrDomainKnowledge": { "strengths": [], "gaps": [], "evidenceNeeded": [] },
    "roleSpecificSkills": { "strengths": [], "gaps": [], "evidenceNeeded": [] },
    "sectorCredibility": { "strengths": [], "gaps": [], "evidenceNeeded": [] },
    "networkAccess": { "strengths": [], "gaps": [], "evidenceNeeded": [] },
    "narrativeFit": { "strengths": [], "gaps": [], "evidenceNeeded": [] }
  },
  "gapAnalysis": { "strengths": [], "gaps": [], "biggestGap": "" },
  "learningPaths": [{ "topic": "specific learning target", "why": "why it matters", "resourceType": "course|book|article|practice|certification", "suggestedResource": "real resource or precise search query", "output": "artifact or note this learning should produce" }],
  "networkArchetypes": [{ "who": "specific person type", "why": "what they uniquely provide", "searchTip": "exact LinkedIn or network search" }],
  "proofAssetIdeas": [{ "title": "specific artifact to write or build", "why": "why it proves credibility", "format": "memo|deck|analysis|blog post|portfolio", "firstStep": "first concrete creation step" }],
  "plan": {
    "horizon": "2-4 weeks or 4-6 weeks",
    "logic": "how the lanes work together as a coherent strategy",
    "lanes": [{ "lane": "market_map|role_map|fit_map|capability_build|proof_build|network_map|experiments|positioning", "objective": "what this lane must accomplish", "whyNow": "why this lane belongs in the first plan", "workstreams": [{ "title": "workstream name", "action": "concrete action Anchor can seed later", "doneWhen": "observable completion bar", "evidence": "what this creates or reveals", "priority": 1 }] }]
  }
}

Rules:
- The plan must be multifaceted and MECE, not a single next move.
- Include 6-8 lanes, covering market_map, role_map, fit_map, capability_build, proof_build, network_map, and positioning.
- Include at least 3 testable hypotheses.
- Every claim in researchEvidence must map to an evidencePack item.
- Do not invent organisations, resources, role titles, or source URLs beyond the evidence pack.`;

  const raw = await llmJSON<StructuredTrackBrief>(prompt, { model: MODEL_PRIMARY });
  return normalizeBrief(domain, raw, searchPlan, evidencePack);
}

async function ensureTrackForBrief(brief: StructuredTrackBrief): Promise<CareerTrack> {
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

async function persistStructuredTrackPlan(track: CareerTrack, brief: StructuredTrackBrief): Promise<CareerTrack> {
  const previous = jsonObject(track.trackIntelligence || "");
  const targetOrganizations = uniqueStrings([
    ...brief.sectorMap.flatMap((s) => s.exampleOrgs || []),
    ...brief.roleShapes.flatMap((r) => r.typicalOrgs || []),
  ]);
  const roleFamilies = uniqueStrings(brief.roleShapes.map((r) => r.title));
  const next = {
    ...previous,
    thesis: brief.trackThesis || brief.summary,
    roleFamilies,
    targetOrganizations,
    recurringCapabilities: brief.requirementMap.capabilities.map((text) => evidenceItem(text)),
    recurringKnowledgeNeeds: brief.requirementMap.knowledge.map((text) => evidenceItem(text)),
    recurringEvidenceBar: brief.requirementMap.evidence.map((text) => evidenceItem(text)),
    recurringNarrativeChallenges: brief.requirementMap.narrative.map((text) => evidenceItem(text)),
    requirementBriefs: Array.isArray(previous.requirementBriefs) ? previous.requirementBriefs : [],
    learningPriorities: uniqueStrings(brief.learningPaths.map((p) => p.topic)),
    proofAssetsToBuild: uniqueStrings(brief.proofAssetIdeas.map((p) => p.title)),
    networkingTargets: uniqueStrings(brief.networkArchetypes.map((n) => n.who)),
    activeOpportunityCount: Number(previous.activeOpportunityCount || 0),
    roleModelsAnalyzed: Number(previous.roleModelsAnalyzed || 0),
    sourceDomain: brief.domain,
    researchSummary: brief.summary,
    searchPlan: brief.searchPlan,
    evidencePack: brief.evidencePack,
    researchEvidence: brief.researchEvidence,
    trackHypotheses: brief.trackHypotheses,
    sectorMap: brief.sectorMap,
    roleShapes: brief.roleShapes,
    requirementMap: brief.requirementMap,
    fitGapMatrix: brief.fitGapMatrix,
    gapAnalysis: brief.gapAnalysis,
    trackPlan: brief.plan,
    researchedAt: Date.now(),
    lastUpdated: Date.now(),
  };

  const updated = await storage.updateCareerTrack(track.id, { trackIntelligence: JSON.stringify(next) } as any);
  return updated || track;
}

export async function runStructuredTrackResearch(domain: string, options: { materialize?: boolean } = {}): Promise<StructuredTrackResearchResult | null> {
  const cleaned = compact(domain);
  if (!cleaned) return null;
  const inputs = await buildResearchInputs();
  const searchPlan = await generateSearchPlan(cleaned, inputs);
  const evidencePack = await gatherEvidencePack(cleaned, inputs, searchPlan);
  const brief = await synthesizeBrief(cleaned, inputs, searchPlan, evidencePack);
  if (!brief) return null;
  const initialTrack = await ensureTrackForBrief(brief);
  const track = await persistStructuredTrackPlan(initialTrack, brief);
  const materialized = options.materialize === true ? await materializeTrackResearch(track, brief as any) : null;
  return { track, brief, materialized };
}
