import { llmJSON, MODEL_PRIMARY } from "./llm";
import { storage } from "./storage";
import type {
  RequirementConfidence,
  RequirementModel,
  RequirementImportance,
  TargetRequirement,
} from "./trackResearchRequirementModel";

export const COVERAGE_MODEL_VERSION = 1;

export type CoverageState = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
export type UserEvidenceType = "experience" | "output" | "credential" | "relationship" | "market_signal" | "feedback" | "learning" | "self_report";
export type UserEvidenceStrength = "direct" | "supporting" | "contextual";
export type RawEvidenceKind = "cv" | "win" | "output" | "learning" | "proof_asset" | "relationship" | "market_signal" | "feedback";

export type RawUserEvidenceSource = {
  id: string;
  kind: RawEvidenceKind;
  title: string;
  detail: string;
  sourceUrl: string;
  sourceEntityType: string;
  sourceEntityId: number | null;
  trackId: number | null;
  observedAt: number;
};

export type UserEvidenceClaim = {
  id: string;
  key: string;
  sourceId: string;
  type: UserEvidenceType;
  claim: string;
  relevance: string;
  strength: UserEvidenceStrength;
  confidence: RequirementConfidence;
  sourceTitle: string;
  sourceUrl: string;
  sourceEntityType: string;
  sourceEntityId: number | null;
  observedAt: number;
};

export type RequirementCoverage = {
  requirementId: string;
  state: CoverageState;
  confidence: RequirementConfidence;
  reason: string;
  evidenceClaimIds: string[];
  missingEvidence: string;
  assessedAt: number;
};

export type CoverageModel = {
  mode: "coverage_model";
  version: number;
  requirementModelVersion: number;
  requirementFingerprint: string;
  evidenceFingerprint: string;
  targetLabel: string;
  evidenceClaims: UserEvidenceClaim[];
  coverage: RequirementCoverage[];
  summary: {
    counts: Record<CoverageState, number>;
    coreRequirementCount: number;
    coreCoverageRate: number;
    provenRequirementIds: string[];
    needsEvidenceRequirementIds: string[];
    unknownRequirementIds: string[];
  };
  evidenceQuality: {
    status: "strong" | "usable" | "thin";
    sourceCount: number;
    directClaimCount: number;
    sourceTypeCount: number;
    caveats: string[];
  };
  assessmentMethod: "llm_with_deterministic_guards" | "deterministic_fallback";
  generatedAt: number;
};

type CoverageSynthesis = {
  evidenceClaims?: Array<{
    key?: string;
    sourceId?: string;
    type?: UserEvidenceType;
    claim?: string;
    relevance?: string;
    strength?: UserEvidenceStrength;
    confidence?: RequirementConfidence;
  }>;
  assessments?: Array<{
    requirementId?: string;
    state?: CoverageState;
    confidence?: RequirementConfidence;
    evidenceKeys?: string[];
    reason?: string;
    missingEvidence?: string;
  }>;
  qualityNotes?: string[];
};

const COVERAGE_STATES: CoverageState[] = ["proven", "partially_proven", "unproven", "unknown", "below_bar"];
const EVIDENCE_TYPES: UserEvidenceType[] = ["experience", "output", "credential", "relationship", "market_signal", "feedback", "learning", "self_report"];
const EVIDENCE_STRENGTHS: UserEvidenceStrength[] = ["direct", "supporting", "contextual"];
const CONFIDENCE: RequirementConfidence[] = ["high", "medium", "low"];

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function trimText(value: unknown, max = 700): string {
  const text = compact(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalize(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(compact).filter(Boolean)) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}-${stableHash(parts.map(normalize).filter(Boolean).join("|") || prefix)}`;
}

function parseConfidence(value: unknown, fallback: RequirementConfidence = "medium"): RequirementConfidence {
  const parsed = normalize(value) as RequirementConfidence;
  return CONFIDENCE.includes(parsed) ? parsed : fallback;
}

function parseCoverageState(value: unknown): CoverageState {
  const parsed = normalize(value).replace(/ /g, "_") as CoverageState;
  return COVERAGE_STATES.includes(parsed) ? parsed : "unknown";
}

function parseEvidenceType(value: unknown): UserEvidenceType {
  const parsed = normalize(value).replace(/ /g, "_") as UserEvidenceType;
  return EVIDENCE_TYPES.includes(parsed) ? parsed : "self_report";
}

function parseEvidenceStrength(value: unknown): UserEvidenceStrength {
  const parsed = normalize(value) as UserEvidenceStrength;
  return EVIDENCE_STRENGTHS.includes(parsed) ? parsed : "contextual";
}

function strengthRank(value: UserEvidenceStrength): number {
  return value === "direct" ? 3 : value === "supporting" ? 2 : 1;
}

function capStrength(source: RawUserEvidenceSource, type: UserEvidenceType, requested: UserEvidenceStrength): UserEvidenceStrength {
  let ceiling: UserEvidenceStrength = "contextual";
  if (source.kind === "output" || source.kind === "feedback") ceiling = "direct";
  else if (source.kind === "relationship" && (type === "relationship" || type === "market_signal")) ceiling = "direct";
  else if (source.kind === "cv" && (type === "experience" || type === "credential")) ceiling = "direct";
  else if (["cv", "win", "learning", "proof_asset"].includes(source.kind)) ceiling = "supporting";
  else if (source.kind === "market_signal") ceiling = "supporting";
  return strengthRank(requested) <= strengthRank(ceiling) ? requested : ceiling;
}

function sourcePriority(source: RawUserEvidenceSource, trackId: number): number {
  const kindScore: Record<RawEvidenceKind, number> = {
    cv: 100,
    output: 96,
    feedback: 94,
    relationship: 88,
    win: 82,
    proof_asset: 78,
    learning: 72,
    market_signal: 68,
  };
  return kindScore[source.kind] + (source.trackId === trackId ? 12 : 0) + Math.min(10, Math.floor((source.observedAt || 0) / 1_000_000_000_000));
}

export async function collectCoverageEvidenceSources(trackId: number): Promise<RawUserEvidenceSource[]> {
  const [profile, wins, learns, hustles, contacts, jobs] = await Promise.all([
    storage.getProfile(),
    storage.getWins(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getJobs(),
  ]);

  const cvSource: RawUserEvidenceSource[] = profile?.cvText?.trim() ? [{
    id: "profile-cv",
    kind: "cv",
    title: "Current CV and profile",
    detail: trimText(profile.cvText, 6500),
    sourceUrl: "",
    sourceEntityType: "profile",
    sourceEntityId: profile.id,
    trackId: null,
    observedAt: profile.updatedAt || 0,
  }] : [];

  const otherSources: RawUserEvidenceSource[] = [];

  for (const win of [...wins].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12)) {
    otherSources.push({
      id: `win-${win.id}`,
      kind: win.kind === "feedback" ? "feedback" : "win",
      title: trimText(win.text, 140),
      detail: trimText([win.text, win.takeaway].filter(Boolean).join(". "), 500),
      sourceUrl: "",
      sourceEntityType: "win",
      sourceEntityId: win.id,
      trackId: win.trackId ?? null,
      observedAt: win.createdAt || 0,
    });
  }

  for (const item of learns.filter((learn) => learn.done || learn.outputEvidenceUrl || learn.outputStatus === "published")) {
    const hasOutput = Boolean(item.outputEvidenceUrl || item.outputStatus === "published" || item.outputTitle);
    otherSources.push({
      id: `learn-${item.id}`,
      kind: hasOutput ? "output" : "learning",
      title: trimText(item.outputTitle || item.title, 160),
      detail: trimText([
        item.title,
        item.capabilityBuilt ? `Capability: ${item.capabilityBuilt}` : "",
        item.requiredOutput ? `Expected output: ${item.requiredOutput}` : "",
        item.outputTitle ? `Produced output: ${item.outputTitle}` : "",
        item.note,
      ].filter(Boolean).join(". "), 650),
      sourceUrl: item.outputEvidenceUrl || item.url || "",
      sourceEntityType: "learn",
      sourceEntityId: item.id,
      trackId: item.relatedTrackId ?? null,
      observedAt: item.createdAt || 0,
    });
  }

  for (const hustle of hustles.filter((item) => ["testing", "earning", "done"].includes(item.stage) || Boolean(item.coreClaim))) {
    otherSources.push({
      id: `hustle-${hustle.id}`,
      kind: "proof_asset",
      title: trimText(hustle.title, 160),
      detail: trimText([
        hustle.title,
        hustle.coreClaim ? `Core claim: ${hustle.coreClaim}` : "",
        hustle.contentPillar ? `Content area: ${hustle.contentPillar}` : "",
        hustle.firstPostIdea ? `Output idea: ${hustle.firstPostIdea}` : "",
        hustle.note,
        `Stage: ${hustle.stage}`,
      ].filter(Boolean).join(". "), 650),
      sourceUrl: "",
      sourceEntityType: "hustle",
      sourceEntityId: hustle.id,
      trackId: hustle.proofAssetForTrack ?? null,
      observedAt: hustle.createdAt || 0,
    });
  }

  for (const contact of contacts.filter((item) => Boolean(item.name) || item.status === "replied" || ["warm", "strong"].includes(item.relationshipStrength))) {
    otherSources.push({
      id: `contact-${contact.id}`,
      kind: "relationship",
      title: trimText(contact.name || contact.who || "Professional relationship", 160),
      detail: trimText([
        contact.name,
        contact.who,
        contact.targetRole ? `Role: ${contact.targetRole}` : "",
        contact.targetOrg ? `Organization: ${contact.targetOrg}` : "",
        contact.sourceNetwork ? `Source network: ${contact.sourceNetwork}` : "",
        `Relationship: ${contact.relationshipStrength}`,
        `Status: ${contact.status}`,
        contact.why,
      ].filter(Boolean).join(". "), 500),
      sourceUrl: contact.linkedinUrl || "",
      sourceEntityType: "contact",
      sourceEntityId: contact.id,
      trackId: contact.relatedTrackId ?? null,
      observedAt: contact.createdAt || 0,
    });
  }

  for (const job of jobs.filter((item) => item.status === "interviewing").slice(0, 8)) {
    otherSources.push({
      id: `job-${job.id}`,
      kind: "market_signal",
      title: trimText(`${job.title}${job.company ? ` at ${job.company}` : ""}`, 160),
      detail: trimText([
        `Interview-stage market signal for ${job.title}`,
        job.company ? `Organization: ${job.company}` : "",
        job.narrativeAngle,
      ].filter(Boolean).join(". "), 450),
      sourceUrl: job.url || job.sourceUrl || "",
      sourceEntityType: "job",
      sourceEntityId: job.id,
      trackId: job.relatedTrackId ?? null,
      observedAt: job.createdAt || 0,
    });
  }

  const selected = otherSources
    .filter((source) => source.title && source.detail)
    .sort((left, right) => sourcePriority(right, trackId) - sourcePriority(left, trackId))
    .slice(0, 30);

  return [...cvSource, ...selected];
}

export function coverageEvidenceFingerprint(requirementModel: RequirementModel, sources: RawUserEvidenceSource[]): string {
  const sourceKey = sources
    .map((source) => `${source.id}|${source.kind}|${source.title}|${source.detail}|${source.sourceUrl}|${source.observedAt}`)
    .sort()
    .join("||");
  return stableHash(`${requirementModel.sourceFingerprint}|${requirementModel.version}|${sourceKey}`);
}

function tokenSet(value: unknown): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 3));
}

function overlapScore(left: unknown, right: unknown): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function evidenceTypeForSource(source: RawUserEvidenceSource): UserEvidenceType {
  if (source.kind === "output" || source.kind === "proof_asset") return "output";
  if (source.kind === "relationship") return "relationship";
  if (source.kind === "market_signal") return "market_signal";
  if (source.kind === "feedback") return "feedback";
  if (source.kind === "learning") return "learning";
  if (source.kind === "cv") return "self_report";
  return "experience";
}

function fallbackSynthesis(requirementModel: RequirementModel, sources: RawUserEvidenceSource[]): CoverageSynthesis {
  const evidenceClaims: NonNullable<CoverageSynthesis["evidenceClaims"]> = [];
  const assessments: NonNullable<CoverageSynthesis["assessments"]> = [];

  for (const requirement of requirementModel.requirements) {
    const matches = sources
      .map((source) => ({ source, score: overlapScore(`${requirement.label} ${requirement.definition}`, `${source.title} ${source.detail}`) }))
      .filter((item) => item.score >= 0.24)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    const evidenceKeys: string[] = [];
    for (const match of matches) {
      const key = `fallback-${requirement.id}-${match.source.id}`;
      evidenceKeys.push(key);
      evidenceClaims.push({
        key,
        sourceId: match.source.id,
        type: evidenceTypeForSource(match.source),
        claim: trimText(match.source.detail, 360),
        relevance: `Potentially supports ${requirement.label}`,
        strength: match.source.kind === "output" || match.source.kind === "relationship" ? "direct" : "supporting",
        confidence: "low",
      });
    }
    assessments.push({
      requirementId: requirement.id,
      state: evidenceKeys.length ? "partially_proven" : "unknown",
      confidence: "low",
      evidenceKeys,
      reason: evidenceKeys.length
        ? "Anchor found related evidence, but the deterministic fallback cannot confirm that it fully meets the success bar."
        : "Anchor could not confidently map the available evidence to this requirement.",
      missingEvidence: requirement.successBar,
    });
  }

  return { evidenceClaims, assessments, qualityNotes: ["Coverage used a conservative deterministic fallback because the evidence synthesis model was unavailable."] };
}

function buildEvidenceClaims(synthesis: CoverageSynthesis, sources: RawUserEvidenceSource[]): UserEvidenceClaim[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seenKeys = new Set<string>();
  const claims: UserEvidenceClaim[] = [];

  for (const raw of asArray(synthesis.evidenceClaims)) {
    const sourceId = compact(raw.sourceId);
    const source = sourceById.get(sourceId);
    const key = compact(raw.key);
    const claim = compact(raw.claim);
    if (!source || !key || !claim || seenKeys.has(normalize(key))) continue;
    seenKeys.add(normalize(key));
    const type = parseEvidenceType(raw.type);
    const requestedStrength = parseEvidenceStrength(raw.strength);
    claims.push({
      id: stableId("user-evidence", sourceId, key, claim),
      key,
      sourceId,
      type,
      claim,
      relevance: compact(raw.relevance),
      strength: capStrength(source, type, requestedStrength),
      confidence: parseConfidence(raw.confidence),
      sourceTitle: source.title,
      sourceUrl: source.sourceUrl,
      sourceEntityType: source.sourceEntityType,
      sourceEntityId: source.sourceEntityId,
      observedAt: source.observedAt,
    });
  }

  return claims.slice(0, 80);
}

function distinctSourceCount(claims: UserEvidenceClaim[]): number {
  return new Set(claims.map((claim) => claim.sourceId)).size;
}

function hasNegativeFeedback(claims: UserEvidenceClaim[]): boolean {
  return claims.some((claim) => claim.type === "feedback" && ["weak", "below", "failed", "lacked", "missing", "not enough", "needs improvement"].some((term) => normalize(claim.claim).includes(term)));
}

function canProve(requirement: TargetRequirement, claims: UserEvidenceClaim[]): boolean {
  const direct = claims.filter((claim) => claim.strength === "direct");
  const supportingSources = distinctSourceCount(claims.filter((claim) => claim.strength === "supporting" || claim.strength === "direct"));
  if (requirement.category === "evidence") return direct.some((claim) => claim.type === "output");
  if (requirement.category === "experience") return direct.some((claim) => claim.type === "experience" || claim.type === "self_report");
  if (requirement.category === "credential" || requirement.category === "eligibility") return direct.some((claim) => claim.type === "credential" || claim.type === "self_report");
  if (requirement.category === "network" || requirement.category === "access") return direct.some((claim) => claim.type === "relationship" || claim.type === "market_signal");
  if (requirement.category === "knowledge" || requirement.category === "skill") return direct.some((claim) => claim.type === "output") || supportingSources >= 2;
  if (requirement.category === "narrative") return direct.some((claim) => claim.type === "market_signal" || claim.type === "output") || supportingSources >= 2;
  return direct.length > 0;
}

function guardedState(requirement: TargetRequirement, requested: CoverageState, claims: UserEvidenceClaim[]): CoverageState {
  if (requested === "proven" && !canProve(requirement, claims)) return claims.length ? "partially_proven" : "unknown";
  if (requested === "partially_proven" && claims.length === 0) return "unknown";
  if (requested === "below_bar" && !hasNegativeFeedback(claims)) return claims.length ? "partially_proven" : "unknown";
  return requested;
}

function coverageForRequirement(
  requirement: TargetRequirement,
  synthesis: CoverageSynthesis,
  evidenceClaims: UserEvidenceClaim[],
  assessedAt: number,
): RequirementCoverage {
  const raw = asArray(synthesis.assessments).find((assessment) => assessment.requirementId === requirement.id);
  const claimByKey = new Map(evidenceClaims.map((claim) => [claim.key, claim]));
  const linkedClaims = uniqueStrings(asArray(raw?.evidenceKeys))
    .map((key) => claimByKey.get(key))
    .filter(Boolean) as UserEvidenceClaim[];
  const requested = parseCoverageState(raw?.state);
  const state = guardedState(requirement, requested, linkedClaims);
  const confidence = state === "unknown"
    ? "low"
    : state === "proven" && canProve(requirement, linkedClaims)
      ? parseConfidence(raw?.confidence, "high")
      : parseConfidence(raw?.confidence, "medium") === "high" ? "medium" : parseConfidence(raw?.confidence, "medium");
  const fallbackReason = state === "unknown"
    ? "Anchor does not have enough evidence to assess this requirement yet."
    : state === "unproven"
      ? "Anchor searched the available evidence but did not find proof that meets the success bar. This is not a judgement that the capability is absent."
      : state === "partially_proven"
        ? "Some relevant evidence exists, but it does not yet fully meet the success bar."
        : state === "below_bar"
          ? "Explicit feedback indicates current evidence is below the target standard."
          : "The available evidence meets the current success bar.";
  return {
    requirementId: requirement.id,
    state,
    confidence,
    reason: compact(raw?.reason) || fallbackReason,
    evidenceClaimIds: linkedClaims.map((claim) => claim.id),
    missingEvidence: compact(raw?.missingEvidence) || (state === "proven" ? "" : requirement.successBar),
    assessedAt,
  };
}

function importanceRank(value: RequirementImportance): number {
  return value === "essential" ? 0 : value === "important" ? 1 : value === "differentiator" ? 2 : 3;
}

function buildSummary(requirementModel: RequirementModel, coverage: RequirementCoverage[]): CoverageModel["summary"] {
  const counts: Record<CoverageState, number> = {
    proven: 0,
    partially_proven: 0,
    unproven: 0,
    unknown: 0,
    below_bar: 0,
  };
  for (const item of coverage) counts[item.state] += 1;
  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const core = coverage.filter((item) => {
    const importance = requirementById.get(item.requirementId)?.importance;
    return importance === "essential" || importance === "important";
  });
  const points = core.reduce((sum, item) => sum + (item.state === "proven" ? 1 : item.state === "partially_proven" ? 0.5 : 0), 0);
  const sorted = [...coverage].sort((left, right) => {
    const leftRequirement = requirementById.get(left.requirementId);
    const rightRequirement = requirementById.get(right.requirementId);
    return importanceRank(leftRequirement?.importance || "contextual") - importanceRank(rightRequirement?.importance || "contextual");
  });
  return {
    counts,
    coreRequirementCount: core.length,
    coreCoverageRate: core.length ? Math.round((points / core.length) * 100) : 0,
    provenRequirementIds: sorted.filter((item) => item.state === "proven").map((item) => item.requirementId).slice(0, 8),
    needsEvidenceRequirementIds: sorted.filter((item) => ["partially_proven", "unproven", "below_bar"].includes(item.state)).map((item) => item.requirementId).slice(0, 10),
    unknownRequirementIds: sorted.filter((item) => item.state === "unknown").map((item) => item.requirementId).slice(0, 10),
  };
}

function buildEvidenceQuality(sources: RawUserEvidenceSource[], claims: UserEvidenceClaim[], method: CoverageModel["assessmentMethod"], qualityNotes: string[]): CoverageModel["evidenceQuality"] {
  const sourceTypeCount = new Set(sources.map((source) => source.kind)).size;
  const directClaimCount = claims.filter((claim) => claim.strength === "direct").length;
  const caveats = [...qualityNotes];
  if (!sources.some((source) => source.kind === "cv")) caveats.push("No CV or profile evidence was available, so experience and credential coverage will remain uncertain.");
  if (!sources.some((source) => source.kind === "output")) caveats.push("No linked completed outputs were available, so skill and proof coverage may be understated.");
  if (!sources.some((source) => source.kind === "relationship")) caveats.push("No established relationship evidence was available, so network and access coverage may remain unknown.");
  if (method === "deterministic_fallback") caveats.push("The LLM evidence mapper was unavailable; Anchor used conservative text matching instead.");
  const status: CoverageModel["evidenceQuality"]["status"] = sources.length >= 8 && directClaimCount >= 3 && sourceTypeCount >= 3
    ? "strong"
    : sources.length >= 3 && claims.length >= 3
      ? "usable"
      : "thin";
  return { status, sourceCount: sources.length, directClaimCount, sourceTypeCount, caveats: uniqueStrings(caveats) };
}

export function buildCoverageModelFromSynthesis(
  requirementModel: RequirementModel,
  sources: RawUserEvidenceSource[],
  synthesis: CoverageSynthesis | null,
  generatedAt = Date.now(),
): CoverageModel {
  const method: CoverageModel["assessmentMethod"] = synthesis ? "llm_with_deterministic_guards" : "deterministic_fallback";
  const safeSynthesis = synthesis || fallbackSynthesis(requirementModel, sources);
  const evidenceClaims = buildEvidenceClaims(safeSynthesis, sources);
  const coverage = requirementModel.requirements.map((requirement) => coverageForRequirement(requirement, safeSynthesis, evidenceClaims, generatedAt));
  return {
    mode: "coverage_model",
    version: COVERAGE_MODEL_VERSION,
    requirementModelVersion: requirementModel.version,
    requirementFingerprint: requirementModel.sourceFingerprint,
    evidenceFingerprint: coverageEvidenceFingerprint(requirementModel, sources),
    targetLabel: requirementModel.target.label,
    evidenceClaims,
    coverage,
    summary: buildSummary(requirementModel, coverage),
    evidenceQuality: buildEvidenceQuality(sources, evidenceClaims, method, uniqueStrings(asArray(safeSynthesis.qualityNotes))),
    assessmentMethod: method,
    generatedAt,
  };
}

async function synthesizeCoverage(requirementModel: RequirementModel, sources: RawUserEvidenceSource[]): Promise<CoverageSynthesis | null> {
  const prompt = `You are Anchor's evidence-mapping agent. The user has already chosen the target. Assess only what the available user evidence proves against the supplied requirements.

TARGET:
${requirementModel.target.label}

REQUIREMENTS WITH STABLE IDS:
${JSON.stringify(requirementModel.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    definition: requirement.definition,
    category: requirement.category,
    importance: requirement.importance,
    successBar: requirement.successBar,
    roleFamilyIds: requirement.roleFamilyIds,
    context: requirement.context,
  })), null, 2)}

AVAILABLE USER EVIDENCE SOURCES WITH STABLE IDS:
${JSON.stringify(sources, null, 2)}

Return ONLY valid JSON:
{
  "evidenceClaims": [{
    "key": "short unique key",
    "sourceId": "existing source id only",
    "type": "experience|output|credential|relationship|market_signal|feedback|learning|self_report",
    "claim": "specific fact supported by that source",
    "relevance": "which requirement it helps assess and why",
    "strength": "direct|supporting|contextual",
    "confidence": "high|medium|low"
  }],
  "assessments": [{
    "requirementId": "existing requirement id only",
    "state": "proven|partially_proven|unproven|unknown|below_bar",
    "confidence": "high|medium|low",
    "evidenceKeys": ["keys from evidenceClaims only"],
    "reason": "plain-language explanation of the coverage judgement",
    "missingEvidence": "what evidence would be needed to meet the success bar; not a development task"
  }],
  "qualityNotes": ["limitations in the available user evidence"]
}

Rules:
- Market sources are not user evidence. Use only the supplied user evidence sources.
- Extract specific claims from sources; do not invent achievements, credentials, relationships, outputs, or feedback.
- A CV can directly evidence experience or a credential, but normally only supports skill or knowledge coverage unless a concrete output is also available.
- Completing a course does not by itself prove job-ready skill. A linked output is stronger evidence.
- A saved contact archetype is not a relationship. Only the supplied relationship sources may support network or access coverage.
- Proven means the evidence meets the supplied success bar. Partially proven means relevant evidence exists but does not fully meet it.
- Unproven means Anchor inspected the available evidence and did not find adequate proof. It does not mean the user lacks the capability.
- Unknown means the available information cannot support an assessment.
- Below bar requires explicit negative feedback; never infer it from missing evidence.
- Assess every requirement exactly once.
- Do not recommend learning, networking, projects, tasks, or prioritization in this stage.`;

  try {
    return await llmJSON<CoverageSynthesis>(prompt, { model: MODEL_PRIMARY, retries: 1 });
  } catch {
    return null;
  }
}

export async function buildCoverageModel(
  trackId: number,
  requirementModel: RequirementModel,
  suppliedSources?: RawUserEvidenceSource[],
): Promise<CoverageModel> {
  const sources = suppliedSources || await collectCoverageEvidenceSources(trackId);
  const synthesis = await synthesizeCoverage(requirementModel, sources);
  return buildCoverageModelFromSynthesis(requirementModel, sources, synthesis);
}
