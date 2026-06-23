import { llmJSON, MODEL_PRIMARY } from "./llm";
import { storage } from "./storage";
import type {
  RequirementCategory,
  RequirementConfidence,
  RequirementImportance,
  RequirementModel,
  TargetRequirement,
} from "./trackResearchRequirementModel";

export const COVERAGE_MODEL_VERSION = 1;

export type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
export type CoverageConfidence = "high" | "medium" | "low";
export type UserEvidenceDirectness = "direct" | "supporting" | "self_reported";
export type UserEvidenceType = "experience" | "output" | "credential" | "relationship" | "access" | "outcome" | "feedback" | "eligibility" | "learning" | "narrative" | "other";

export type UserEvidenceItem = {
  id: string;
  sourceType: "cv" | "win" | "learn" | "proof_asset" | "contact" | "contact_interaction" | "job" | "other";
  sourceId: string;
  title: string;
  detail: string;
  url: string;
  evidenceType: UserEvidenceType;
  directness: UserEvidenceDirectness;
  polarity: "positive" | "neutral" | "negative";
  relatedTrackId: number | null;
  createdAt: number;
};

export type RequirementCoverage = {
  requirementId: string;
  status: CoverageStatus;
  confidence: CoverageConfidence;
  evidenceItemIds: string[];
  summary: string;
  rationale: string;
  missingEvidence: string;
  assessedAt: number;
};

export type RequirementCoverageModel = {
  mode: "requirement_coverage_model";
  version: number;
  sourceRequirementFingerprint: string;
  sourceRequirementVersion: number;
  userEvidenceFingerprint: string;
  targetLabel: string;
  evidenceItems: UserEvidenceItem[];
  coverage: RequirementCoverage[];
  summary: {
    proven: number;
    partiallyProven: number;
    unproven: number;
    unknown: number;
    belowBar: number;
    materialRequirementIdsNeedingCoverage: string[];
  };
  evidenceQuality: {
    status: "strong" | "usable" | "sparse";
    evidenceItemCount: number;
    directEvidenceCount: number;
    sourceTypeCount: number;
    coveredRequirementCount: number;
    caveats: string[];
  };
  generatedAt: number;
};

type CoverageAssessment = {
  requirementId?: string;
  status?: CoverageStatus;
  confidence?: CoverageConfidence;
  evidenceItemIds?: string[];
  summary?: string;
  rationale?: string;
  missingEvidence?: string;
};

type CoverageSynthesis = {
  assessments?: CoverageAssessment[];
  corpusNotes?: string[];
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

function evidenceId(sourceType: string, sourceId: unknown, detail: string): string {
  return `user-evidence-${stableHash(`${sourceType}|${sourceId}|${normalize(detail)}`)}`;
}

function parseConfidence(value: unknown): CoverageConfidence {
  const normalized = normalize(value);
  if (normalized === "high" || normalized === "low") return normalized;
  return "medium";
}

function parseStatus(value: unknown): CoverageStatus {
  const normalized = normalize(value).replace(/\s+/g, "_");
  if (normalized === "proven" || normalized === "partially_proven" || normalized === "unproven" || normalized === "unknown" || normalized === "below_bar") return normalized;
  return "unknown";
}

function inferEvidenceType(text: unknown, fallback: UserEvidenceType = "other"): UserEvidenceType {
  const normalized = normalize(text);
  if (normalized.includes("clearance") || normalized.includes("citizenship") || normalized.includes("work authorization") || normalized.includes("visa")) return "eligibility";
  if (normalized.includes("degree") || normalized.includes("master") || normalized.includes("bachelor") || normalized.includes("mba") || normalized.includes("certificate") || normalized.includes("certification")) return "credential";
  if (normalized.includes("referral") || normalized.includes("introduction") || normalized.includes("interview")) return "access";
  if (normalized.includes("published") || normalized.includes("portfolio") || normalized.includes("memo") || normalized.includes("brief") || normalized.includes("report") || normalized.includes("deck")) return "output";
  if (normalized.includes("feedback") || normalized.includes("reviewer") || normalized.includes("interviewer")) return "feedback";
  if (normalized.includes("relationship") || normalized.includes("contact") || normalized.includes("network")) return "relationship";
  return fallback;
}

function inferPolarity(text: unknown): UserEvidenceItem["polarity"] {
  const normalized = normalize(text);
  if (["failed", "weak", "insufficient", "not enough", "rejected because", "below standard", "needs improvement"].some((term) => normalized.includes(term))) return "negative";
  if (["completed", "published", "delivered", "led", "won", "promoted", "interviewing", "referred", "strong"].some((term) => normalized.includes(term))) return "positive";
  return "neutral";
}

function cvLines(cv: string): string[] {
  return uniqueStrings(cv
    .split(/\n+/)
    .flatMap((line) => line.split(/[•·]/g))
    .map((line) => line.replace(/^[-*–—]\s*/, "").trim())
    .filter((line) => line.length >= 18 && line.length <= 600))
    .slice(0, 45);
}

function makeEvidence(item: Omit<UserEvidenceItem, "id" | "polarity">): UserEvidenceItem {
  return {
    ...item,
    id: evidenceId(item.sourceType, item.sourceId, item.detail || item.title),
    polarity: inferPolarity(`${item.title} ${item.detail}`),
  };
}

function evidencePriority(item: UserEvidenceItem, trackId: number): number {
  const directness = item.directness === "direct" ? 5 : item.directness === "supporting" ? 3 : 1;
  const trackBonus = item.relatedTrackId === trackId ? 4 : item.relatedTrackId == null ? 1 : 0;
  const urlBonus = item.url ? 1 : 0;
  const recencyBonus = item.createdAt ? Math.min(2, Math.max(0, Math.round((item.createdAt - Date.now() + 365 * 24 * 60 * 60 * 1000) / (180 * 24 * 60 * 60 * 1000)))) : 0;
  return directness + trackBonus + urlBonus + recencyBonus;
}

export async function collectUserEvidence(trackId: number): Promise<UserEvidenceItem[]> {
  const [profile, wins, learns, hustles, contacts, jobs] = await Promise.all([
    storage.getProfile(),
    storage.getWins(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getJobs(),
  ]);

  const items: UserEvidenceItem[] = [];
  const cv = compact(profile?.cvText);
  cvLines(profile?.cvText || "").forEach((line, index) => {
    const evidenceType = inferEvidenceType(line, "experience");
    items.push(makeEvidence({
      sourceType: "cv",
      sourceId: `profile-${index}`,
      title: evidenceType === "credential" ? "CV credential" : evidenceType === "eligibility" ? "CV eligibility" : "CV experience",
      detail: line,
      url: "",
      evidenceType,
      directness: evidenceType === "experience" || evidenceType === "credential" || evidenceType === "eligibility" ? "direct" : "supporting",
      relatedTrackId: null,
      createdAt: Number(profile?.updatedAt || 0),
    }));
  });

  wins.slice(0, 30).forEach((win: any) => {
    const detail = compact(`${win.text || ""}${win.takeaway ? ` — ${win.takeaway}` : ""}`);
    if (!detail) return;
    items.push(makeEvidence({
      sourceType: "win",
      sourceId: String(win.id),
      title: "Recorded outcome",
      detail,
      url: "",
      evidenceType: inferEvidenceType(detail, "outcome"),
      directness: "supporting",
      relatedTrackId: Number.isFinite(Number(win.trackId)) ? Number(win.trackId) : null,
      createdAt: Number(win.createdAt || 0),
    }));
  });

  learns.forEach((learn: any) => {
    const hasArtifact = Boolean(compact(learn.outputEvidenceUrl)) || normalize(learn.outputStatus) === "published";
    if (!learn.done && !hasArtifact) return;
    const detail = compact([
      learn.title,
      learn.capabilityBuilt ? `Capability: ${learn.capabilityBuilt}` : "",
      learn.outputTitle ? `Output: ${learn.outputTitle}` : "",
      learn.requiredOutput ? `Required output: ${learn.requiredOutput}` : "",
      learn.note,
    ].filter(Boolean).join(" — "));
    items.push(makeEvidence({
      sourceType: "learn",
      sourceId: String(learn.id),
      title: hasArtifact ? "Learning output" : "Completed learning",
      detail,
      url: compact(learn.outputEvidenceUrl || learn.url),
      evidenceType: hasArtifact ? "output" : "learning",
      directness: hasArtifact ? "direct" : "supporting",
      relatedTrackId: Number.isFinite(Number(learn.relatedTrackId)) ? Number(learn.relatedTrackId) : null,
      createdAt: Number(learn.createdAt || 0),
    }));
  });

  hustles.forEach((hustle: any) => {
    const stage = normalize(hustle.stage);
    if (stage === "idea" || stage === "abandoned" || stage === "done") return;
    const detail = compact([
      hustle.title,
      hustle.coreClaim ? `Claim: ${hustle.coreClaim}` : "",
      hustle.note,
      hustle.audience ? `Audience: ${hustle.audience}` : "",
    ].filter(Boolean).join(" — "));
    items.push(makeEvidence({
      sourceType: "proof_asset",
      sourceId: String(hustle.id),
      title: stage === "earning" ? "Active proof with external signal" : "Proof asset in development",
      detail,
      url: "",
      evidenceType: stage === "earning" ? "outcome" : "output",
      directness: stage === "earning" ? "direct" : "supporting",
      relatedTrackId: Number.isFinite(Number(hustle.proofAssetForTrack)) ? Number(hustle.proofAssetForTrack) : null,
      createdAt: Number(hustle.createdAt || 0),
    }));
  });

  const interactionLists = await Promise.all(contacts.map((contact: any) => storage.getContactInteractions(contact.id)));
  contacts.forEach((contact: any, index) => {
    const interactions = interactionLists[index] || [];
    const relationshipStrength = normalize(contact.relationshipStrength);
    const replied = normalize(contact.status) === "replied";
    if (relationshipStrength === "warm" || relationshipStrength === "strong" || replied) {
      const detail = compact([
        contact.who || contact.name,
        contact.targetRole ? `Target role: ${contact.targetRole}` : "",
        contact.targetOrg ? `Target organization: ${contact.targetOrg}` : "",
        contact.sourceNetwork ? `Source network: ${contact.sourceNetwork}` : "",
        contact.why,
      ].filter(Boolean).join(" — "));
      items.push(makeEvidence({
        sourceType: "contact",
        sourceId: String(contact.id),
        title: "Relevant professional relationship",
        detail,
        url: compact(contact.linkedinUrl),
        evidenceType: contact.referralPotential ? "access" : "relationship",
        directness: "direct",
        relatedTrackId: Number.isFinite(Number(contact.relatedTrackId)) ? Number(contact.relatedTrackId) : null,
        createdAt: Number(contact.createdAt || 0),
      }));
    }

    interactions
      .filter((interaction: any) => ["response", "meeting", "intro", "referral"].includes(normalize(interaction.type)))
      .slice(-5)
      .forEach((interaction: any) => {
        const interactionType = normalize(interaction.type);
        const detail = compact(`${contact.who || contact.name || "Contact"} — ${interaction.type}${interaction.note ? ` — ${interaction.note}` : ""}`);
        items.push(makeEvidence({
          sourceType: "contact_interaction",
          sourceId: `${contact.id}-${interaction.id}`,
          title: interactionType === "intro" || interactionType === "referral" ? "Hiring access signal" : "Practitioner interaction",
          detail,
          url: compact(contact.linkedinUrl),
          evidenceType: interactionType === "intro" || interactionType === "referral" ? "access" : "relationship",
          directness: "direct",
          relatedTrackId: Number.isFinite(Number(contact.relatedTrackId)) ? Number(contact.relatedTrackId) : null,
          createdAt: Number(interaction.createdAt || 0),
        }));
      });
  });

  jobs.filter((job: any) => normalize(job.status) === "interviewing").forEach((job: any) => {
    const detail = compact(`${job.title} at ${job.company}${job.narrativeAngle ? ` — ${job.narrativeAngle}` : ""}`);
    items.push(makeEvidence({
      sourceType: "job",
      sourceId: String(job.id),
      title: "Interview progression",
      detail,
      url: compact(job.sourceUrl || job.url),
      evidenceType: "access",
      directness: "direct",
      relatedTrackId: Number.isFinite(Number(job.relatedTrackId)) ? Number(job.relatedTrackId) : null,
      createdAt: Number(job.createdAt || 0),
    }));
  });

  const byId = new Map<string, UserEvidenceItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || evidencePriority(item, trackId) > evidencePriority(existing, trackId)) byId.set(item.id, item);
  }

  return [...byId.values()]
    .sort((left, right) => evidencePriority(right, trackId) - evidencePriority(left, trackId) || right.createdAt - left.createdAt)
    .slice(0, 60);
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

const COMPATIBLE_EVIDENCE: Record<RequirementCategory, UserEvidenceType[]> = {
  knowledge: ["experience", "output", "credential", "learning", "feedback"],
  skill: ["experience", "output", "outcome", "feedback"],
  experience: ["experience", "outcome"],
  evidence: ["output", "outcome"],
  credential: ["credential"],
  narrative: ["narrative", "output", "feedback"],
  network: ["relationship"],
  access: ["access", "relationship", "outcome"],
  eligibility: ["eligibility", "credential"],
};

function evidenceCompatible(requirement: TargetRequirement, evidence: UserEvidenceItem): boolean {
  return COMPATIBLE_EVIDENCE[requirement.category].includes(evidence.evidenceType);
}

function deterministicEvidenceIds(requirement: TargetRequirement, evidenceItems: UserEvidenceItem[]): string[] {
  const searchText = `${requirement.label} ${requirement.definition} ${requirement.successBar} ${requirement.aliases.join(" ")}`;
  return evidenceItems
    .map((item) => {
      const similarity = overlapScore(searchText, `${item.title} ${item.detail}`);
      const compatibility = evidenceCompatible(requirement, item) ? 0.2 : 0;
      const directness = item.directness === "direct" ? 0.08 : item.directness === "supporting" ? 0.03 : 0;
      return { id: item.id, similarity, score: similarity + compatibility + directness };
    })
    .filter((item) => item.similarity >= 0.14 && item.score >= 0.3)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((item) => item.id);
}

function safeCoverageStatus(
  requirement: TargetRequirement,
  requested: CoverageStatus,
  evidence: UserEvidenceItem[],
  corpusSize: number,
): CoverageStatus {
  const compatible = evidence.filter((item) => evidenceCompatible(requirement, item));
  const directCompatible = compatible.filter((item) => item.directness === "direct");
  const negativeCompatible = compatible.filter((item) => item.polarity === "negative" && item.evidenceType === "feedback");

  if (requested === "below_bar") {
    if (negativeCompatible.length > 0) return "below_bar";
    return compatible.length > 0 ? "partially_proven" : corpusSize >= 6 ? "unproven" : "unknown";
  }
  if (requested === "proven") {
    if (directCompatible.length > 0) return "proven";
    return compatible.length > 0 ? "partially_proven" : corpusSize >= 6 ? "unproven" : "unknown";
  }
  if (requested === "partially_proven") return compatible.length > 0 ? "partially_proven" : corpusSize >= 6 ? "unproven" : "unknown";
  if (compatible.length > 0 && requested === "unknown") return "partially_proven";
  if (requested === "unproven") return corpusSize >= 6 ? "unproven" : "unknown";
  return compatible.length > 0 ? "partially_proven" : corpusSize >= 6 ? "unproven" : "unknown";
}

function coverageConfidence(status: CoverageStatus, requested: CoverageConfidence, evidence: UserEvidenceItem[]): CoverageConfidence {
  const direct = evidence.filter((item) => item.directness === "direct").length;
  if (status === "unknown") return "low";
  if (direct >= 2 || (direct >= 1 && requested === "high")) return "high";
  if (evidence.length > 0) return requested === "low" ? "medium" : requested;
  return "low";
}

function defaultSummary(requirement: TargetRequirement, status: CoverageStatus, evidence: UserEvidenceItem[]): string {
  if (status === "proven") return `Anchor found direct evidence that you meet the current bar for ${requirement.label}.`;
  if (status === "partially_proven") return `Anchor found relevant evidence for ${requirement.label}, but it does not yet fully demonstrate the target bar.`;
  if (status === "below_bar") return `Explicit feedback suggests the current evidence for ${requirement.label} is below the target bar.`;
  if (status === "unproven") return `Anchor could not find evidence in the current record that demonstrates ${requirement.label}.`;
  return evidence.length ? `Anchor found adjacent evidence but cannot assess ${requirement.label} reliably yet.` : `Anchor does not have enough information to assess ${requirement.label}.`;
}

function defaultMissingEvidence(requirement: TargetRequirement, status: CoverageStatus): string {
  if (status === "proven") return "No immediate evidence gap. Preserve and package the strongest example when needed.";
  if (status === "partially_proven") return `A stronger or more directly relevant example that meets this bar: ${requirement.successBar}`;
  if (status === "below_bar") return `New evidence showing the target bar has been reached: ${requirement.successBar}`;
  if (status === "unproven") return `An inspectable example or outcome demonstrating: ${requirement.successBar}`;
  return `More information about your experience or outputs relevant to: ${requirement.successBar}`;
}

function requirementPriority(requirement: TargetRequirement): number {
  const rank: Record<RequirementImportance, number> = { essential: 4, important: 3, differentiator: 2, contextual: 1 };
  return rank[requirement.importance];
}

function buildEvidenceQuality(requirements: TargetRequirement[], coverage: RequirementCoverage[], evidenceItems: UserEvidenceItem[]): RequirementCoverageModel["evidenceQuality"] {
  const directEvidenceCount = evidenceItems.filter((item) => item.directness === "direct").length;
  const sourceTypeCount = new Set(evidenceItems.map((item) => item.sourceType)).size;
  const coveredRequirementCount = coverage.filter((item) => item.status === "proven" || item.status === "partially_proven").length;
  const caveats: string[] = [];
  if (!evidenceItems.some((item) => item.sourceType === "cv")) caveats.push("No CV evidence was available, so experience and credential coverage may be understated.");
  if (!evidenceItems.some((item) => item.evidenceType === "output" || item.evidenceType === "outcome")) caveats.push("Few inspectable outputs or outcomes were available, so capability and proof coverage remains conservative.");
  if (!evidenceItems.some((item) => item.evidenceType === "relationship" || item.evidenceType === "access")) caveats.push("No relationship or hiring-access evidence was available in Anchor.");
  if (requirements.length && coveredRequirementCount / requirements.length < 0.3) caveats.push("Most requirements are not yet evidenced in Anchor; this does not mean the user lacks them.");
  const status: RequirementCoverageModel["evidenceQuality"]["status"] = evidenceItems.length >= 10 && directEvidenceCount >= 5 && sourceTypeCount >= 3
    ? "strong"
    : evidenceItems.length >= 4 && directEvidenceCount >= 1
      ? "usable"
      : "sparse";
  return {
    status,
    evidenceItemCount: evidenceItems.length,
    directEvidenceCount,
    sourceTypeCount,
    coveredRequirementCount,
    caveats: uniqueStrings(caveats),
  };
}

function evidenceFingerprint(evidenceItems: UserEvidenceItem[]): string {
  return stableHash(JSON.stringify(evidenceItems.map((item) => [item.id, item.detail, item.url, item.directness, item.evidenceType, item.createdAt])));
}

export function buildCoverageModelFromEvidence(
  requirementModel: RequirementModel,
  evidenceItems: UserEvidenceItem[],
  synthesis: CoverageSynthesis | null = null,
  generatedAt = Date.now(),
): RequirementCoverageModel {
  const requirementIds = new Set(requirementModel.requirements.map((requirement) => requirement.id));
  const evidenceById = new Map(evidenceItems.map((item) => [item.id, item]));
  const assessmentByRequirement = new Map(
    asArray(synthesis?.assessments)
      .filter((assessment) => requirementIds.has(compact(assessment.requirementId)))
      .map((assessment) => [compact(assessment.requirementId), assessment]),
  );

  const coverage = requirementModel.requirements.map((requirement) => {
    const assessment = assessmentByRequirement.get(requirement.id);
    const requestedEvidenceIds = uniqueStrings(asArray(assessment?.evidenceItemIds)).filter((id) => evidenceById.has(id));
    const matchedEvidenceIds = requestedEvidenceIds.length ? requestedEvidenceIds : deterministicEvidenceIds(requirement, evidenceItems);
    const matchedEvidence = matchedEvidenceIds.map((id) => evidenceById.get(id)).filter(Boolean) as UserEvidenceItem[];
    const requestedStatus = parseStatus(assessment?.status);
    const status = safeCoverageStatus(requirement, requestedStatus, matchedEvidence, evidenceItems.length);
    const confidence = coverageConfidence(status, parseConfidence(assessment?.confidence), matchedEvidence);
    return {
      requirementId: requirement.id,
      status,
      confidence,
      evidenceItemIds: matchedEvidenceIds,
      summary: compact(assessment?.summary) || defaultSummary(requirement, status, matchedEvidence),
      rationale: compact(assessment?.rationale) || (matchedEvidence.length
        ? `Assessment uses ${matchedEvidence.length} linked evidence item${matchedEvidence.length === 1 ? "" : "s"} and applies a conservative standard against the requirement success bar.`
        : "No sufficiently relevant evidence item was found in the current Anchor record."),
      missingEvidence: compact(assessment?.missingEvidence) || defaultMissingEvidence(requirement, status),
      assessedAt: generatedAt,
    } satisfies RequirementCoverage;
  });

  const statusCount = (status: CoverageStatus) => coverage.filter((item) => item.status === status).length;
  const materialRequirementIdsNeedingCoverage = requirementModel.requirements
    .filter((requirement) => requirementPriority(requirement) >= 3)
    .filter((requirement) => {
      const item = coverage.find((candidate) => candidate.requirementId === requirement.id);
      return item && item.status !== "proven";
    })
    .map((requirement) => requirement.id);

  return {
    mode: "requirement_coverage_model",
    version: COVERAGE_MODEL_VERSION,
    sourceRequirementFingerprint: requirementModel.sourceFingerprint,
    sourceRequirementVersion: requirementModel.version,
    userEvidenceFingerprint: evidenceFingerprint(evidenceItems),
    targetLabel: requirementModel.target.label,
    evidenceItems,
    coverage,
    summary: {
      proven: statusCount("proven"),
      partiallyProven: statusCount("partially_proven"),
      unproven: statusCount("unproven"),
      unknown: statusCount("unknown"),
      belowBar: statusCount("below_bar"),
      materialRequirementIdsNeedingCoverage,
    },
    evidenceQuality: buildEvidenceQuality(requirementModel.requirements, coverage, evidenceItems),
    generatedAt,
  };
}

async function synthesizeCoverage(requirementModel: RequirementModel, evidenceItems: UserEvidenceItem[]): Promise<CoverageSynthesis | null> {
  if (!requirementModel.requirements.length) return null;
  const prompt = `You are Anchor's requirement coverage assessor. The user has already chosen the target. Assess only whether the evidence currently stored in Anchor demonstrates each target requirement.

TARGET REQUIREMENTS:
${JSON.stringify(requirementModel.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    definition: requirement.definition,
    category: requirement.category,
    importance: requirement.importance,
    successBar: requirement.successBar,
    roleFamilyIds: requirement.roleFamilyIds,
  })), null, 2)}

USER EVIDENCE ITEMS:
${JSON.stringify(evidenceItems.map((item) => ({
    id: item.id,
    sourceType: item.sourceType,
    title: item.title,
    detail: item.detail.slice(0, 450),
    evidenceType: item.evidenceType,
    directness: item.directness,
    polarity: item.polarity,
    relatedTrackId: item.relatedTrackId,
  })), null, 2)}

Return ONLY JSON:
{
  "assessments": [
    {
      "requirementId": "an exact requirement id",
      "status": "proven|partially_proven|unproven|unknown|below_bar",
      "confidence": "high|medium|low",
      "evidenceItemIds": ["exact evidence ids only"],
      "summary": "plain-English conclusion",
      "rationale": "why the cited evidence does or does not meet the success bar",
      "missingEvidence": "what additional evidence would establish coverage"
    }
  ],
  "corpusNotes": ["material caveats about the available user evidence"]
}

Rules:
- Return one assessment for every requirement id.
- Use only supplied requirement and evidence ids. Never invent evidence or infer private facts.
- 'Proven' requires direct evidence that meets the stated success bar, not merely a related job title or completed activity.
- 'Partially proven' means relevant evidence exists but is narrower, weaker, older, indirect, or below the target context.
- 'Unproven' means Anchor inspected a meaningful evidence record but found no adequate proof. It does not mean the user lacks the capability.
- 'Unknown' means the available record is too sparse or ambiguous to assess.
- 'Below bar' requires explicit negative performance feedback; absence of evidence is never below bar.
- A CV can directly evidence experience, credentials, and eligibility, but skills and knowledge usually need examples, outputs, outcomes, or feedback.
- Course completion alone does not prove applied capability.
- A saved contact does not prove network access unless the record shows a warm relationship, response, meeting, introduction, or referral.
- Keep capability, proof, credentials, narrative, relationships, access, and eligibility separate.
- Do not recommend development actions or tasks in this stage.`;

  try {
    return await llmJSON<CoverageSynthesis>(prompt, { model: MODEL_PRIMARY });
  } catch {
    return null;
  }
}

export function coverageModelMatchesRequirementModel(value: any, requirementModel: RequirementModel): value is RequirementCoverageModel {
  return value?.mode === "requirement_coverage_model"
    && value?.version === COVERAGE_MODEL_VERSION
    && value?.sourceRequirementFingerprint === requirementModel.sourceFingerprint
    && value?.sourceRequirementVersion === requirementModel.version
    && Array.isArray(value?.coverage);
}

export async function buildRequirementCoverageModel(
  trackId: number,
  requirementModel: RequirementModel,
  existing?: RequirementCoverageModel | null,
): Promise<RequirementCoverageModel> {
  const evidenceItems = await collectUserEvidence(trackId);
  const currentFingerprint = evidenceFingerprint(evidenceItems);
  if (
    existing
    && coverageModelMatchesRequirementModel(existing, requirementModel)
    && existing.userEvidenceFingerprint === currentFingerprint
  ) return existing;

  const synthesis = await synthesizeCoverage(requirementModel, evidenceItems);
  return buildCoverageModelFromEvidence(requirementModel, evidenceItems, synthesis);
}
