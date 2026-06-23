import type { CareerTrack } from "@shared/schema";
import {
  getContactStatus,
  getLearnOutputState,
  getLearnStatus,
  getProofStage,
  getRelationshipStrength,
  getTrackId,
} from "@shared/domainState";
import { llmJSON, MODEL_PRIMARY } from "./llm";
import { storage } from "./storage";
import { USER_PROFILE } from "./userPromptProfile";
import type { RequirementCategory, RequirementConfidence, RequirementModel, TargetRequirement } from "./trackResearchRequirementModel";

export const COVERAGE_MODEL_VERSION = 1;

export type CoverageState = "evidenced" | "partially_evidenced" | "not_evidenced" | "unknown" | "below_bar";
export type UserEvidenceType = "cv" | "profile_summary" | "win" | "learning_output" | "proof_asset" | "relationship" | "feedback";
export type EvidenceStrength = "strong" | "medium" | "weak";

export type UserEvidenceItem = {
  id: string;
  type: UserEvidenceType;
  title: string;
  content: string;
  sourceType: string;
  sourceId: number | null;
  sourceUrl: string;
  trackIds: number[];
  strength: EvidenceStrength;
  createdAt: number | null;
};

export type RequirementCoverage = {
  requirementId: string;
  state: CoverageState;
  confidence: RequirementConfidence;
  evidenceItemIds: string[];
  rationale: string;
  coveredAspects: string[];
  missingAspects: string[];
  verificationNeed: string;
  assessmentSource: "deterministic" | "llm";
};

export type CoverageModel = {
  mode: "coverage_model";
  version: number;
  requirementFingerprint: string;
  userEvidenceFingerprint: string;
  target: { label: string };
  evidenceItems: UserEvidenceItem[];
  coverage: RequirementCoverage[];
  summary: Record<CoverageState, number>;
  quality: {
    status: "strong" | "usable" | "provisional";
    cvAvailable: boolean;
    evidenceItemCount: number;
    evidenceTypeCount: number;
    artifactCount: number;
    relationshipCount: number;
    limitations: string[];
  };
  generatedAt: number;
};

type CoverageSynthesis = {
  assessments?: Array<{
    requirementId?: string;
    state?: CoverageState;
    confidence?: RequirementConfidence;
    evidenceItemIds?: string[];
    rationale?: string;
    coveredAspects?: string[];
    missingAspects?: string[];
    verificationNeed?: string;
  }>;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
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

function evidenceId(type: UserEvidenceType, sourceKey: unknown, content: unknown) {
  return `user-evidence-${type}-${stableHash(`${normalize(sourceKey)}|${normalize(content)}`)}`;
}

function splitLongText(text: string, maxLength = 520): string[] {
  const clean = compact(text);
  if (!clean) return [];
  if (clean.length <= maxLength) return [clean];
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [clean.slice(0, maxLength)];
}

function cvEvidence(cv: string | null): UserEvidenceItem[] {
  if (!cv?.trim()) return [];
  const rawSections = cv.split(/\n+/).map(compact).filter((line) => line.length >= 25);
  const sections = rawSections.length > 1 ? rawSections : splitLongText(cv, 500);
  return sections.flatMap((section) => splitLongText(section, 520)).slice(0, 40).map((content, index) => ({
    id: evidenceId("cv", index, content),
    type: "cv" as const,
    title: `CV evidence ${index + 1}`,
    content,
    sourceType: "user_profile.cvText",
    sourceId: null,
    sourceUrl: "",
    trackIds: [],
    strength: "medium" as const,
    createdAt: null,
  }));
}

function evidenceStrengthRank(value: EvidenceStrength) {
  return value === "strong" ? 3 : value === "medium" ? 2 : 1;
}

function orderEvidence(items: UserEvidenceItem[], trackId: number): UserEvidenceItem[] {
  return [...items].sort((left, right) => {
    const targetDiff = Number(right.trackIds.includes(trackId)) - Number(left.trackIds.includes(trackId));
    if (targetDiff) return targetDiff;
    const strengthDiff = evidenceStrengthRank(right.strength) - evidenceStrengthRank(left.strength);
    if (strengthDiff) return strengthDiff;
    return Number(right.createdAt || 0) - Number(left.createdAt || 0);
  }).slice(0, 80);
}

export async function collectUserEvidence(trackId: number): Promise<UserEvidenceItem[]> {
  const [profile, wins, learns, hustles, contacts, learnProofIds] = await Promise.all([
    storage.getProfile(),
    storage.getWins(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getLearnProofLinkIds(),
  ]);

  const items: UserEvidenceItem[] = [...cvEvidence(profile?.cvText || null)];
  if (compact(USER_PROFILE)) {
    items.push({
      id: evidenceId("profile_summary", "profile", USER_PROFILE),
      type: "profile_summary",
      title: "Anchor profile summary",
      content: USER_PROFILE,
      sourceType: "userPromptProfile",
      sourceId: null,
      sourceUrl: "",
      trackIds: [],
      strength: "weak",
      createdAt: profile?.updatedAt || null,
    });
  }

  for (const win of [...wins].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 30)) {
    const content = uniqueStrings([win.text, win.takeaway]).join(". ");
    if (!content) continue;
    items.push({
      id: evidenceId("win", win.id, content),
      type: "win",
      title: compact(win.text) || "Recorded result",
      content,
      sourceType: "wins",
      sourceId: win.id,
      sourceUrl: "",
      trackIds: win.trackId != null ? [Number(win.trackId)] : [],
      strength: win.sourceEntityType ? "medium" : "weak",
      createdAt: win.createdAt || null,
    });
  }

  for (const item of learns) {
    const hasProofLink = learnProofIds.has(item.id);
    const outputState = getLearnOutputState(item, hasProofLink);
    const done = getLearnStatus(item) === "done";
    if (outputState !== "evidenced" && !done) continue;
    const content = uniqueStrings([
      item.title,
      item.capabilityBuilt,
      item.requiredOutput,
      item.outputTitle,
      item.note,
    ]).join(". ");
    items.push({
      id: evidenceId("learning_output", item.id, content),
      type: "learning_output",
      title: compact(item.outputTitle) || compact(item.title) || "Learning output",
      content,
      sourceType: "learn",
      sourceId: item.id,
      sourceUrl: compact(item.outputEvidenceUrl || item.url),
      trackIds: getTrackId("learn", item) != null ? [Number(getTrackId("learn", item))] : [],
      strength: outputState === "evidenced" ? "strong" : "medium",
      createdAt: item.createdAt || null,
    });
  }

  for (const hustle of hustles) {
    if (getProofStage(hustle) === "idea") continue;
    const content = uniqueStrings([hustle.title, hustle.coreClaim, hustle.contentPillar, hustle.firstPostIdea, hustle.note]).join(". ");
    if (!content) continue;
    items.push({
      id: evidenceId("proof_asset", hustle.id, content),
      type: "proof_asset",
      title: compact(hustle.title) || "Proof asset",
      content,
      sourceType: "hustles",
      sourceId: hustle.id,
      sourceUrl: "",
      trackIds: getTrackId("hustles", hustle) != null ? [Number(getTrackId("hustles", hustle))] : [],
      strength: getProofStage(hustle) === "earning" ? "strong" : "medium",
      createdAt: hustle.createdAt || null,
    });
  }

  const relationshipContacts = contacts.filter((contact) => {
    const strength = getRelationshipStrength(contact);
    return strength === "warm" || strength === "strong" || getContactStatus(contact) === "replied";
  }).slice(0, 24);
  const interactions = await Promise.all(relationshipContacts.map(async (contact) => ({
    contact,
    interactions: await storage.getContactInteractions(contact.id),
  })));

  for (const entry of interactions) {
    const meaningful = entry.interactions.filter((interaction) => ["response", "meeting", "intro", "referral", "note"].includes(interaction.type));
    const content = uniqueStrings([
      entry.contact.name,
      entry.contact.who,
      entry.contact.sector,
      entry.contact.targetOrg,
      entry.contact.targetRole,
      entry.contact.why,
      entry.contact.sourceNetwork,
      ...meaningful.map((interaction) => `${interaction.type}: ${interaction.note}`),
    ]).join(". ");
    if (!content) continue;
    const strength = getRelationshipStrength(entry.contact);
    const hasStrongInteraction = meaningful.some((interaction) => ["meeting", "intro", "referral"].includes(interaction.type));
    items.push({
      id: evidenceId("relationship", entry.contact.id, content),
      type: "relationship",
      title: compact(entry.contact.name) || compact(entry.contact.who) || compact(entry.contact.targetRole) || "Relevant relationship",
      content,
      sourceType: "contacts",
      sourceId: entry.contact.id,
      sourceUrl: compact(entry.contact.linkedinUrl),
      trackIds: getTrackId("contacts", entry.contact) != null ? [Number(getTrackId("contacts", entry.contact))] : [],
      strength: strength === "strong" || hasStrongInteraction ? "strong" : "medium",
      createdAt: Math.max(entry.contact.createdAt || 0, ...meaningful.map((interaction) => interaction.createdAt || 0)) || null,
    });
  }

  return orderEvidence(items, trackId);
}

function tokenSet(value: unknown): Set<string> {
  const ignored = new Set(["and", "the", "for", "with", "from", "into", "that", "this", "role", "work", "ability", "requirement"]);
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 3 && !ignored.has(token)));
}

function overlapScore(left: unknown, right: unknown): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function evidenceSupportsCategory(category: RequirementCategory, item: UserEvidenceItem): boolean {
  if (category === "network" || category === "access") return item.type === "relationship";
  if (category === "evidence") return item.type === "proof_asset" || item.type === "learning_output" || item.type === "win" || item.type === "cv";
  if (category === "credential" || category === "eligibility") return item.type === "cv" || item.type === "profile_summary";
  if (category === "experience") return item.type === "cv" || item.type === "win";
  return item.type !== "relationship" || category === "narrative";
}

function requirementSearchText(requirement: TargetRequirement) {
  return [requirement.label, requirement.definition, requirement.successBar, ...requirement.aliases].join(" ");
}

function candidateEvidence(requirement: TargetRequirement, evidenceItems: UserEvidenceItem[], trackId: number) {
  return evidenceItems
    .filter((item) => evidenceSupportsCategory(requirement.category, item))
    .map((item) => {
      const similarity = overlapScore(requirementSearchText(requirement), `${item.title} ${item.content}`);
      const targetBonus = item.trackIds.includes(trackId) ? 0.12 : 0;
      const strengthBonus = item.strength === "strong" ? 0.08 : item.strength === "medium" ? 0.03 : 0;
      return { item, similarity, score: similarity + targetBonus + strengthBonus };
    })
    .filter((candidate) => candidate.similarity >= 0.14 && candidate.score >= 0.23)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function conservativeCoverage(requirement: TargetRequirement, evidenceItems: UserEvidenceItem[], trackId: number): RequirementCoverage {
  const matches = candidateEvidence(requirement, evidenceItems, trackId);
  if (!matches.length) {
    const state: CoverageState = requirement.confidence === "low" ? "unknown" : evidenceItems.length ? "not_evidenced" : "unknown";
    return {
      requirementId: requirement.id,
      state,
      confidence: "low",
      evidenceItemIds: [],
      rationale: state === "not_evidenced"
        ? "Anchor inspected the available records but did not find evidence that clearly maps to this requirement. This does not mean the user lacks the capability."
        : "The available information is not sufficient to assess this requirement reliably.",
      coveredAspects: [],
      missingAspects: [requirement.successBar],
      verificationNeed: `Evidence that demonstrates: ${requirement.successBar}`,
      assessmentSource: "deterministic",
    };
  }
  return {
    requirementId: requirement.id,
    state: "partially_evidenced",
    confidence: matches.some((match) => match.item.strength === "strong") ? "medium" : "low",
    evidenceItemIds: matches.map((match) => match.item.id),
    rationale: "Anchor found relevant evidence, but a semantic review is needed before treating the requirement as fully evidenced.",
    coveredAspects: [],
    missingAspects: [requirement.successBar],
    verificationNeed: "Confirm whether the cited evidence reaches the target success bar.",
    assessmentSource: "deterministic",
  };
}

function evidenceCanFullySatisfy(requirement: TargetRequirement, items: UserEvidenceItem[]) {
  if (!items.length || items.every((item) => item.strength === "weak")) return false;
  if (requirement.category === "network" || requirement.category === "access") return items.some((item) => item.type === "relationship" && item.strength !== "weak");
  if (requirement.category === "evidence") return items.some((item) => (item.type === "proof_asset" || item.type === "learning_output") && item.strength !== "weak");
  if (requirement.category === "credential" || requirement.category === "eligibility") return items.some((item) => item.type === "cv" && item.strength !== "weak");
  if (requirement.category === "experience") return items.some((item) => item.type === "cv" || item.type === "win");
  return items.some((item) => item.type !== "profile_summary" && item.strength !== "weak");
}

function parseState(value: unknown): CoverageState {
  return ["evidenced", "partially_evidenced", "not_evidenced", "unknown", "below_bar"].includes(String(value))
    ? value as CoverageState
    : "unknown";
}

function parseConfidence(value: unknown): RequirementConfidence {
  return value === "high" || value === "low" ? value : "medium";
}

function sanitizeAssessment(
  requirement: TargetRequirement,
  raw: NonNullable<CoverageSynthesis["assessments"]>[number] | undefined,
  draft: RequirementCoverage,
  evidenceById: Map<string, UserEvidenceItem>,
): RequirementCoverage {
  if (!raw) return draft;
  const evidenceItemIds = uniqueStrings(asArray(raw.evidenceItemIds)).filter((id) => evidenceById.has(id));
  const evidenceItems = evidenceItemIds.map((id) => evidenceById.get(id)).filter(Boolean) as UserEvidenceItem[];
  let state = parseState(raw.state);
  if ((state === "evidenced" || state === "partially_evidenced") && !evidenceItems.length) state = "unknown";
  if (state === "evidenced" && !evidenceCanFullySatisfy(requirement, evidenceItems)) state = "partially_evidenced";
  if (state === "below_bar" && !evidenceItems.some((item) => item.type === "feedback")) state = evidenceItems.length ? "partially_evidenced" : "unknown";
  let confidence = parseConfidence(raw.confidence);
  if (confidence === "high" && !evidenceItems.some((item) => item.strength === "strong")) confidence = "medium";
  if (!evidenceItems.length && state !== "not_evidenced") confidence = "low";
  return {
    requirementId: requirement.id,
    state,
    confidence,
    evidenceItemIds,
    rationale: compact(raw.rationale) || draft.rationale,
    coveredAspects: uniqueStrings(asArray(raw.coveredAspects)),
    missingAspects: uniqueStrings(asArray(raw.missingAspects)),
    verificationNeed: compact(raw.verificationNeed),
    assessmentSource: "llm",
  };
}

function summarize(coverage: RequirementCoverage[]): Record<CoverageState, number> {
  const result: Record<CoverageState, number> = { evidenced: 0, partially_evidenced: 0, not_evidenced: 0, unknown: 0, below_bar: 0 };
  for (const item of coverage) result[item.state] += 1;
  return result;
}

function evidenceFingerprint(items: UserEvidenceItem[]) {
  return stableHash(items.map((item) => `${item.id}:${item.strength}:${item.createdAt || 0}`).sort().join("|"));
}

function buildQuality(evidenceItems: UserEvidenceItem[]): CoverageModel["quality"] {
  const types = new Set(evidenceItems.map((item) => item.type));
  const artifactCount = evidenceItems.filter((item) => item.type === "proof_asset" || item.type === "learning_output").length;
  const relationshipCount = evidenceItems.filter((item) => item.type === "relationship").length;
  const cvAvailable = evidenceItems.some((item) => item.type === "cv");
  const limitations: string[] = [];
  if (!cvAvailable) limitations.push("No CV is stored, so experience, skills, credentials, and eligibility cannot be assessed reliably.");
  if (!artifactCount) limitations.push("No completed learning outputs or proof assets are stored, so visible proof requirements may remain unproven.");
  if (!relationshipCount) limitations.push("No warm or responsive relationships are stored, so network and access coverage may be understated.");
  limitations.push("Not evidenced means Anchor could not find proof in the available records; it does not mean the user lacks the capability.");
  const status = cvAvailable && evidenceItems.length >= 8 && types.size >= 3 ? "strong" : evidenceItems.length >= 3 ? "usable" : "provisional";
  return { status, cvAvailable, evidenceItemCount: evidenceItems.length, evidenceTypeCount: types.size, artifactCount, relationshipCount, limitations };
}

function draftCoverageModel(track: CareerTrack, requirementModel: RequirementModel, evidenceItems: UserEvidenceItem[]): CoverageModel {
  const coverage = requirementModel.requirements.map((requirement) => conservativeCoverage(requirement, evidenceItems, track.id));
  return {
    mode: "coverage_model",
    version: COVERAGE_MODEL_VERSION,
    requirementFingerprint: requirementModel.sourceFingerprint,
    userEvidenceFingerprint: evidenceFingerprint(evidenceItems),
    target: { label: requirementModel.target.label },
    evidenceItems,
    coverage,
    summary: summarize(coverage),
    quality: buildQuality(evidenceItems),
    generatedAt: Date.now(),
  };
}

async function enhanceCoverageWithLlm(requirementModel: RequirementModel, draft: CoverageModel): Promise<CoverageModel> {
  const prompt = `You are Anchor's user-evidence assessor. The user has chosen this target. Compare the supplied USER EVIDENCE only against the supplied REQUIREMENTS.

REQUIREMENTS WITH STABLE IDS:
${JSON.stringify(requirementModel.requirements, null, 2)}

USER EVIDENCE WITH STABLE IDS:
${JSON.stringify(draft.evidenceItems, null, 2)}

Return ONLY valid JSON:
{
  "assessments": [{
    "requirementId": "existing requirement id",
    "state": "evidenced|partially_evidenced|not_evidenced|unknown|below_bar",
    "confidence": "high|medium|low",
    "evidenceItemIds": ["existing user evidence ids only"],
    "rationale": "specific explanation tied to the success bar",
    "coveredAspects": ["what the evidence supports"],
    "missingAspects": ["what remains unsupported"],
    "verificationNeed": "one concise evidence need, or empty"
  }]
}

Rules:
- Assess every requirement exactly once.
- Market evidence explains why a requirement exists; it is not user evidence and cannot prove coverage.
- Do not infer capability from an employer or job title alone. Use the specific content of the cited user evidence.
- "not_evidenced" means no adequate evidence is stored in Anchor. It does not mean the user cannot do it.
- Use "unknown" when the available evidence lacks enough detail to assess the success bar.
- Use "below_bar" only when explicit negative feedback or performance evidence says the user is below the bar.
- A proof/output requirement needs an inspectable artifact or explicit completed output. A CV claim alone is at most partial.
- A network or access requirement needs a warm, responsive, or substantive relationship. A cold target does not count.
- A credential or eligibility requirement needs explicit CV evidence.
- The profile summary is supporting context only and cannot by itself produce "evidenced".
- Do not recommend learning, networking, projects, plans, or tasks. This stage only assesses coverage.
- Use only existing requirement IDs and user evidence IDs.`;
  const synthesis = await llmJSON<CoverageSynthesis>(prompt, { model: MODEL_PRIMARY, retries: 1 });
  if (!synthesis?.assessments?.length) return draft;
  const rawByRequirement = new Map(synthesis.assessments.filter((item) => item.requirementId).map((item) => [String(item.requirementId), item]));
  const evidenceById = new Map(draft.evidenceItems.map((item) => [item.id, item]));
  const draftByRequirement = new Map(draft.coverage.map((item) => [item.requirementId, item]));
  const coverage = requirementModel.requirements.map((requirement) => sanitizeAssessment(requirement, rawByRequirement.get(requirement.id), draftByRequirement.get(requirement.id)!, evidenceById));
  return { ...draft, coverage, summary: summarize(coverage), generatedAt: Date.now() };
}

export async function buildCoverageModel(
  track: CareerTrack,
  requirementModel: RequirementModel,
  options: { enhance?: boolean } = {},
): Promise<CoverageModel> {
  const evidenceItems = await collectUserEvidence(track.id);
  const draft = draftCoverageModel(track, requirementModel, evidenceItems);
  return options.enhance === false ? draft : enhanceCoverageWithLlm(requirementModel, draft);
}

export function isCoverageModelCurrent(stored: any, requirementModel: RequirementModel, userEvidenceFingerprint: string): stored is CoverageModel {
  return stored?.mode === "coverage_model"
    && stored?.version === COVERAGE_MODEL_VERSION
    && stored?.requirementFingerprint === requirementModel.sourceFingerprint
    && stored?.userEvidenceFingerprint === userEvidenceFingerprint
    && Array.isArray(stored.coverage);
}
