import { storage } from "./storage";
import { USER_PROFILE } from "./userPromptProfile";
import type {
  RequirementCategory,
  RequirementConfidence,
  RequirementImportance,
  RequirementModel,
  TargetRequirement,
} from "./trackResearchRequirementModel";

export const COVERAGE_MODEL_VERSION = 2;

export type CoverageState = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
export type UserEvidenceStrength = "direct" | "supporting" | "weak";
export type UserEvidenceSourceType =
  | "cv"
  | "profile_summary"
  | "win"
  | "proof_asset"
  | "learning_output"
  | "learning_activity"
  | "network_relationship"
  | "contact_interaction"
  | "application_signal"
  | "task_completion";

export type UserEvidenceItem = {
  id: string;
  sourceType: UserEvidenceSourceType;
  title: string;
  detail: string;
  sourceEntityType: string;
  sourceEntityId: number | null;
  sourceUrl: string;
  trackId: number | null;
  targetSpecific: boolean;
  strength: UserEvidenceStrength;
  observedAt: number;
};

export type UserEvidenceBundle = {
  items: UserEvidenceItem[];
  fingerprint: string;
  sourceCounts: Record<UserEvidenceSourceType, number>;
  sourceCaveats: string[];
  collectedAt: number;
};

export type RequirementCoverageAssessment = {
  requirementId: string;
  state: CoverageState;
  confidence: RequirementConfidence;
  evidenceItemIds: string[];
  assessedSourceTypes: UserEvidenceSourceType[];
  rationale: string;
  successBarAssessment: string;
  missingEvidence: string;
  verificationPrompt: string;
  source: "deterministic" | "llm_enhanced";
  updatedAt: number;
};

export type CoverageModel = {
  mode: "requirement_coverage";
  version: number;
  requirementFingerprint: string;
  userEvidenceFingerprint: string;
  target: {
    label: string;
    assumption: string;
  };
  assessments: RequirementCoverageAssessment[];
  evidenceItems: UserEvidenceItem[];
  summary: {
    counts: Record<CoverageState, number>;
    clearlyEvidencedRequirementIds: string[];
    partlyEvidencedRequirementIds: string[];
    notYetVerifiedRequirementIds: string[];
    verificationQueue: Array<{ requirementId: string; prompt: string; reason: string }>;
    quality: {
      status: "strong" | "usable" | "provisional";
      sourceCount: number;
      sourceTypeCount: number;
      directEvidenceCount: number;
      linkedAssessmentCount: number;
      linkedAssessmentCoverage: number;
      caveats: string[];
    };
  };
  generatedAt: number;
};

type EvidenceMatch = {
  item: UserEvidenceItem;
  score: number;
  directForRequirement: boolean;
  negative: boolean;
};

const SOURCE_TYPES: UserEvidenceSourceType[] = [
  "cv",
  "profile_summary",
  "win",
  "proof_asset",
  "learning_output",
  "learning_activity",
  "network_relationship",
  "contact_interaction",
  "application_signal",
  "task_completion",
];

const IGNORED_TOKENS = new Set([
  "and", "the", "for", "with", "from", "into", "that", "this", "role", "roles", "work", "ability",
  "can", "has", "have", "relevant", "target", "needed", "need", "required", "requirement", "requirements",
]);

const TOKEN_ALIASES: Record<string, string> = {
  strategic: "strategy",
  strategies: "strategy",
  analytical: "analysis",
  analyse: "analysis",
  analysed: "analysis",
  analysing: "analysis",
  analyze: "analysis",
  analyzed: "analysis",
  analyzing: "analysis",
  writing: "write",
  written: "write",
  writes: "write",
  produced: "produce",
  producing: "produce",
  production: "produce",
  publications: "publication",
  published: "publication",
  relationships: "relationship",
  networks: "network",
  credentials: "credential",
  briefings: "briefing",
  stakeholders: "stakeholder",
  governments: "government",
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

function canonicalToken(token: string): string {
  const mapped = TOKEN_ALIASES[token];
  if (mapped) return mapped;
  if (token.length >= 6 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length >= 6 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
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
  const normalized = parts.map(normalize).filter(Boolean).join("|");
  return `${prefix}-${stableHash(normalized || prefix)}`;
}

function entityId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function splitCv(cv: string): string[] {
  const lines = cv.split(/\r?\n+/).map(compact).filter((line) => line.length >= 8);
  if (lines.length >= 4) return uniqueStrings(lines).slice(0, 60);
  return uniqueStrings(cv.split(/(?<=[.!?;])\s+/).map(compact).filter((line) => line.length >= 16)).slice(0, 60);
}

function strengthRank(value: UserEvidenceStrength): number {
  return value === "direct" ? 3 : value === "supporting" ? 2 : 1;
}

function newSourceCounts(): Record<UserEvidenceSourceType, number> {
  return {
    cv: 0,
    profile_summary: 0,
    win: 0,
    proof_asset: 0,
    learning_output: 0,
    learning_activity: 0,
    network_relationship: 0,
    contact_interaction: 0,
    application_signal: 0,
    task_completion: 0,
  };
}

function sourceFingerprint(items: UserEvidenceItem[]): string {
  return stableHash(items
    .map((item) => [
      item.id,
      item.title,
      item.detail,
      item.sourceUrl,
      item.strength,
      item.observedAt,
      item.trackId,
      item.targetSpecific,
    ].join("|"))
    .sort()
    .join("||"));
}

export async function collectUserEvidence(trackId: number): Promise<UserEvidenceBundle> {
  const [profile, wins, learns, hustles, contacts, tasks, jobs] = await Promise.all([
    storage.getProfile(),
    storage.getWins(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
    storage.getTasks(),
    storage.getJobs(),
  ]);

  const items: UserEvidenceItem[] = [];
  const push = (item: Omit<UserEvidenceItem, "id" | "targetSpecific">) => {
    const title = compact(item.title);
    const detail = compact(item.detail);
    if (!title && !detail) return;
    const targetSpecific = item.trackId === trackId;
    items.push({
      ...item,
      title: title || detail.slice(0, 90),
      detail,
      targetSpecific,
      id: stableId("user-evidence", item.sourceType, item.sourceEntityType, item.sourceEntityId, item.trackId, title, detail),
    });
  };

  const cv = String(profile?.cvText || "").trim();
  splitCv(cv).forEach((fragment, index) => push({
    sourceType: "cv",
    title: `CV evidence ${index + 1}`,
    detail: fragment,
    sourceEntityType: "user_profile",
    sourceEntityId: entityId(profile?.id),
    sourceUrl: "",
    trackId: null,
    strength: "supporting",
    observedAt: Number(profile?.updatedAt || 0),
  }));

  if (USER_PROFILE) push({
    sourceType: "profile_summary",
    title: "Anchor profile summary",
    detail: USER_PROFILE,
    sourceEntityType: "profile_summary",
    sourceEntityId: null,
    sourceUrl: "",
    trackId: null,
    strength: "weak",
    observedAt: Number(profile?.updatedAt || 0),
  });

  wins.slice(0, 30).forEach((win: any) => push({
    sourceType: "win",
    title: compact(win.text),
    detail: uniqueStrings([win.text, win.takeaway]).join(" — "),
    sourceEntityType: compact(win.sourceEntityType) || "win",
    sourceEntityId: entityId(win.sourceEntityId || win.id),
    sourceUrl: "",
    trackId: entityId(win.trackId),
    strength: win.sourceEntityType && win.sourceEntityId ? "direct" : "supporting",
    observedAt: Number(win.createdAt || 0),
  }));

  learns.slice(0, 40).forEach((item: any) => {
    const hasInspectableOutput = Boolean(compact(item.outputEvidenceUrl) || normalize(item.outputStatus) === "published");
    const hasOutputClaim = Boolean(compact(item.outputTitle) || compact(item.requiredOutput));
    const done = Boolean(item.done || normalize(item.learnStatus) === "done");
    if (!hasInspectableOutput && !hasOutputClaim && !done && !item.active) return;
    push({
      sourceType: hasInspectableOutput || hasOutputClaim ? "learning_output" : "learning_activity",
      title: compact(item.outputTitle) || compact(item.title),
      detail: uniqueStrings([
        item.title,
        item.capabilityBuilt ? `Capability: ${item.capabilityBuilt}` : "",
        item.requiredOutput ? `Intended output: ${item.requiredOutput}` : "",
        item.outputStatus ? `Output status: ${item.outputStatus}` : "",
        done ? "Completed" : item.active ? "Active" : "",
      ]).join(" — "),
      sourceEntityType: "learn",
      sourceEntityId: entityId(item.id),
      sourceUrl: compact(item.outputEvidenceUrl || item.url),
      trackId: entityId(item.relatedTrackId),
      strength: hasInspectableOutput ? "direct" : hasOutputClaim || done ? "supporting" : "weak",
      observedAt: Number(item.createdAt || 0),
    });
  });

  hustles.slice(0, 30).forEach((item: any) => {
    const stage = normalize(item.stage);
    if (stage === "idea" && !compact(item.coreClaim)) return;
    push({
      sourceType: "proof_asset",
      title: compact(item.title),
      detail: uniqueStrings([
        item.coreClaim ? `Claim: ${item.coreClaim}` : "",
        item.contentPillar ? `Focus: ${item.contentPillar}` : "",
        item.audience ? `Audience: ${item.audience}` : "",
        item.stage ? `Stage: ${item.stage}` : "",
      ]).join(" — "),
      sourceEntityType: "hustle",
      sourceEntityId: entityId(item.id),
      sourceUrl: "",
      trackId: entityId(item.proofAssetForTrack),
      strength: stage === "earning" ? "direct" : stage === "testing" ? "supporting" : "weak",
      observedAt: Number(item.createdAt || 0),
    });
  });

  const namedContacts = contacts.filter((contact: any) => compact(contact.name));
  namedContacts.slice(0, 50).forEach((contact: any) => {
    const relationship = normalize(contact.relationshipStrength);
    const status = normalize(contact.status);
    push({
      sourceType: "network_relationship",
      title: compact(contact.name),
      detail: uniqueStrings([
        contact.who,
        contact.sector,
        contact.targetOrg ? `Organisation: ${contact.targetOrg}` : "",
        contact.targetRole ? `Role: ${contact.targetRole}` : "",
        contact.sourceNetwork ? `Network: ${contact.sourceNetwork}` : "",
        contact.relationshipStrength ? `Relationship: ${contact.relationshipStrength}` : "",
        contact.why,
      ]).join(" — "),
      sourceEntityType: "contact",
      sourceEntityId: entityId(contact.id),
      sourceUrl: compact(contact.linkedinUrl),
      trackId: entityId(contact.relatedTrackId),
      strength: relationship === "strong" || status === "replied" ? "direct" : relationship === "warm" ? "supporting" : "weak",
      observedAt: Number(contact.createdAt || 0),
    });
  });

  const interactionGroups = await Promise.all(namedContacts.slice(0, 40).map(async (contact: any) => {
    try {
      const interactions = await storage.getContactInteractions(contact.id);
      return interactions.map((interaction: any) => ({ contact, interaction }));
    } catch {
      return [];
    }
  }));

  interactionGroups.flat().slice(0, 80).forEach(({ contact, interaction }: any) => {
    const type = normalize(interaction.type);
    push({
      sourceType: "contact_interaction",
      title: `${compact(interaction.type) || "Interaction"} with ${compact(contact.name)}`,
      detail: uniqueStrings([
        contact.who,
        contact.sector,
        contact.targetOrg,
        contact.targetRole,
        interaction.note,
      ]).join(" — "),
      sourceEntityType: "contact_interaction",
      sourceEntityId: entityId(interaction.id),
      sourceUrl: compact(contact.linkedinUrl),
      trackId: entityId(contact.relatedTrackId),
      strength: ["meeting", "intro", "referral", "response"].includes(type) ? "direct" : "weak",
      observedAt: Number(interaction.createdAt || 0),
    });
  });

  tasks.filter((task: any) => task.done || normalize(task.status) === "done").slice(0, 40).forEach((task: any) => push({
    sourceType: "task_completion",
    title: compact(task.title),
    detail: uniqueStrings([task.doneWhen, task.minimumOutcome, task.sourceNote]).join(" — "),
    sourceEntityType: "task",
    sourceEntityId: entityId(task.id),
    sourceUrl: compact(task.sourceUrl),
    trackId: entityId(task.relatedTrackId),
    strength: "weak",
    observedAt: Number(task.createdAt || 0),
  }));

  jobs.filter((job: any) => ["applied", "interviewing"].includes(normalize(job.status))).slice(0, 30).forEach((job: any) => push({
    sourceType: "application_signal",
    title: `${compact(job.title)}${compact(job.company) ? ` at ${compact(job.company)}` : ""}`,
    detail: uniqueStrings([
      job.status ? `Status: ${job.status}` : "",
      job.applicationReadiness ? `Readiness: ${job.applicationReadiness}` : "",
      job.narrativeAngle,
    ]).join(" — "),
    sourceEntityType: "job",
    sourceEntityId: entityId(job.id),
    sourceUrl: compact(job.url || job.sourceUrl),
    trackId: entityId(job.relatedTrackId),
    strength: normalize(job.status) === "interviewing" ? "direct" : "weak",
    observedAt: Number(job.createdAt || 0),
  }));

  const byId = new Map<string, UserEvidenceItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || strengthRank(item.strength) > strengthRank(existing.strength) || item.observedAt > existing.observedAt) byId.set(item.id, item);
  }

  const deduped = [...byId.values()]
    .sort((left, right) => Number(right.targetSpecific) - Number(left.targetSpecific)
      || strengthRank(right.strength) - strengthRank(left.strength)
      || right.observedAt - left.observedAt)
    .slice(0, 140);
  const sourceCounts = newSourceCounts();
  deduped.forEach((item) => { sourceCounts[item.sourceType] += 1; });
  const sourceCaveats: string[] = [];
  if (!sourceCounts.cv) sourceCaveats.push("No CV evidence is available, so knowledge, skill, experience, credential, and eligibility coverage will remain cautious.");
  if (!sourceCounts.proof_asset && !sourceCounts.learning_output) sourceCaveats.push("No inspectable proof or learning output is stored, so Anchor cannot strongly verify output-based requirements.");
  if (!sourceCounts.network_relationship && !sourceCounts.contact_interaction) sourceCaveats.push("No named relationship evidence is stored, so network and access requirements may remain unknown.");
  if (!sourceCounts.win) sourceCaveats.push("No recorded outcomes or wins are available to corroborate claims from the CV.");

  return {
    items: deduped,
    fingerprint: sourceFingerprint(deduped),
    sourceCounts,
    sourceCaveats,
    collectedAt: Date.now(),
  };
}

function tokenSet(value: unknown): Set<string> {
  return new Set(normalize(value)
    .split(" ")
    .map(canonicalToken)
    .filter((token) => token.length >= 2 && !IGNORED_TOKENS.has(token)));
}

function overlapScore(left: unknown, right: unknown): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function compatibleSourceTypes(category: RequirementCategory): UserEvidenceSourceType[] {
  if (category === "network") return ["network_relationship", "contact_interaction"];
  if (category === "access") return ["network_relationship", "contact_interaction", "application_signal"];
  if (category === "eligibility" || category === "credential") return ["cv", "profile_summary", "application_signal"];
  if (category === "experience") return ["cv", "win"];
  if (category === "evidence") return ["proof_asset", "learning_output", "win"];
  if (category === "narrative") return ["cv", "profile_summary", "win", "proof_asset", "application_signal"];
  if (category === "knowledge") return ["cv", "win", "proof_asset", "learning_output", "learning_activity", "task_completion"];
  return ["cv", "win", "proof_asset", "learning_output", "learning_activity", "task_completion"];
}

function categoryCompatibility(category: RequirementCategory, sourceType: UserEvidenceSourceType): number {
  return compatibleSourceTypes(category).includes(sourceType) ? 2 : -8;
}

function negativeSignal(value: unknown): boolean {
  const text = normalize(value);
  return [
    "failed", "rejected because", "not enough", "insufficient", "weakness", "weak at", "struggled", "needs improvement",
    "could not", "unable to", "below bar", "negative feedback", "gap in",
  ].some((signal) => text.includes(signal));
}

function directForRequirement(requirement: TargetRequirement, item: UserEvidenceItem): boolean {
  if (item.strength === "weak") return false;
  if (requirement.category === "experience") return item.sourceType === "cv" || item.sourceType === "win";
  if (requirement.category === "credential" || requirement.category === "eligibility") return item.sourceType === "cv";
  if (requirement.category === "evidence") return item.sourceType === "proof_asset" || item.sourceType === "learning_output";
  if (requirement.category === "network") return item.sourceType === "network_relationship" || item.sourceType === "contact_interaction";
  if (requirement.category === "access") return item.sourceType === "contact_interaction" || item.sourceType === "application_signal";
  if (requirement.category === "knowledge" || requirement.category === "skill") {
    return item.sourceType === "proof_asset" || item.sourceType === "learning_output" || item.sourceType === "win";
  }
  if (requirement.category === "narrative") return item.sourceType === "application_signal" || item.sourceType === "proof_asset";
  return false;
}

function matchEvidence(requirement: TargetRequirement, roleTitles: string[], item: UserEvidenceItem): EvidenceMatch | null {
  const compatibility = categoryCompatibility(requirement.category, item.sourceType);
  if (compatibility < 0) return null;
  const requirementText = `${requirement.label} ${requirement.aliases.join(" ")} ${requirement.definition} ${requirement.successBar}`;
  const evidenceText = `${item.title} ${item.detail}`;
  const overlap = overlapScore(requirementText, evidenceText);
  const roleOverlap = roleTitles.length ? overlapScore(roleTitles.join(" "), evidenceText) : 0;
  const normalizedLabel = normalize(requirement.label);
  const exactBonus = normalizedLabel.length >= 5 && normalize(evidenceText).includes(normalizedLabel) ? 2.5 : 0;

  // Category compatibility alone must never create a match. There must be a
  // semantic link to the actual requirement or an exact requirement phrase.
  if (overlap < 0.12 && exactBonus === 0) return null;

  const strengthBonus = item.strength === "direct" ? 1.5 : item.strength === "supporting" ? 0.6 : -0.8;
  const targetBonus = item.targetSpecific ? 0.8 : 0;
  const roleBonus = Math.min(0.6, roleOverlap * 1.5);
  const score = overlap * 8 + exactBonus + compatibility + strengthBonus + targetBonus + roleBonus;
  if (score < 3.2) return null;
  return {
    item,
    score,
    directForRequirement: directForRequirement(requirement, item),
    negative: negativeSignal(evidenceText),
  };
}

function sourceInspected(requirement: TargetRequirement, bundle: UserEvidenceBundle): boolean {
  return compatibleSourceTypes(requirement.category).some((sourceType) => bundle.sourceCounts[sourceType] > 0);
}

function missingEvidenceFor(requirement: TargetRequirement): string {
  if (requirement.category === "knowledge") return `A concrete example of applying ${requirement.label} to a target-relevant problem, ideally with an output or informed outcome.`;
  if (requirement.category === "skill") return `A work sample, outcome, or assessed example showing ${requirement.label} at the stated success bar.`;
  if (requirement.category === "experience") return `A specific role, project, responsibility, and result demonstrating ${requirement.label} in a relevant context.`;
  if (requirement.category === "evidence") return `An inspectable output, publication, portfolio item, or external signal demonstrating ${requirement.label}.`;
  if (requirement.category === "credential") return `A credential record or direct confirmation that an accepted alternative satisfies ${requirement.label}.`;
  if (requirement.category === "narrative") return `A written positioning statement that explains ${requirement.label} consistently across CV, outreach, and interviews.`;
  if (requirement.category === "network") return `Named, relevant relationships and meaningful interactions that support ${requirement.label}.`;
  if (requirement.category === "access") return `Evidence of a credible hiring route, warm introduction, referral, recruiter engagement, or interview access for ${requirement.label}.`;
  return `Direct confirmation that the formal eligibility condition for ${requirement.label} is satisfied.`;
}

function verificationPromptFor(requirement: TargetRequirement): string {
  if (requirement.category === "network" || requirement.category === "access") return `Anchor could not verify ${requirement.label} from the relationships currently stored. Add evidence only when it becomes available.`;
  if (requirement.category === "credential" || requirement.category === "eligibility") return `Anchor could not verify ${requirement.label} from the current profile or CV.`;
  return `Anchor could not yet verify ${requirement.label} against the success bar.`;
}

function assessRequirement(requirement: TargetRequirement, model: RequirementModel, bundle: UserEvidenceBundle): RequirementCoverageAssessment {
  const roleTitles = requirement.roleFamilyIds
    .map((id) => model.roleFamilies.find((role) => role.id === id)?.title)
    .filter(Boolean) as string[];
  const matches = bundle.items
    .map((item) => matchEvidence(requirement, roleTitles, item))
    .filter(Boolean) as EvidenceMatch[];
  matches.sort((left, right) => right.score - left.score);

  const credibleMatches = matches.filter((match) => match.item.strength !== "weak");
  const directMatches = credibleMatches.filter((match) => match.directForRequirement && match.score >= 5.5);
  const negativeMatches = credibleMatches.filter((match) => match.negative && match.score >= 5);
  const inspected = sourceInspected(requirement, bundle);
  let state: CoverageState = "unknown";

  if (negativeMatches.length > 0) {
    state = "below_bar";
  } else if (requirement.category === "network") {
    if (directMatches.length >= 2 || directMatches.some((match) => match.item.sourceType === "contact_interaction")) state = "proven";
    else if (credibleMatches.length > 0) state = "partially_proven";
    else state = inspected ? "unproven" : "unknown";
  } else if (requirement.category === "access") {
    if (directMatches.some((match) => match.item.sourceType === "contact_interaction" || match.item.sourceType === "application_signal")) state = "proven";
    else if (credibleMatches.length > 0) state = "partially_proven";
    else state = inspected ? "unproven" : "unknown";
  } else if (["credential", "eligibility", "experience", "evidence"].includes(requirement.category)) {
    if (directMatches.some((match) => match.score >= 6)) state = "proven";
    else if (credibleMatches.length > 0) state = "partially_proven";
    else state = inspected ? "unproven" : "unknown";
  } else if (requirement.category === "narrative") {
    if (directMatches.some((match) => match.score >= 7.5)) state = "proven";
    else if (credibleMatches.length > 0) state = "partially_proven";
    else state = "unknown";
  } else {
    const exceptionalDirect = directMatches.some((match) => match.score >= 8.5);
    const corroboratedDirect = directMatches.some((match) => match.score >= 7.5) && credibleMatches.length >= 2;
    if (exceptionalDirect || corroboratedDirect) state = "proven";
    else if (credibleMatches.length > 0) state = "partially_proven";
    else state = inspected ? "unproven" : "unknown";
  }

  const linked = (state === "unproven" || state === "unknown" ? [] : credibleMatches).slice(0, 5);
  const confidence: RequirementConfidence = state === "unknown"
    ? "low"
    : state === "unproven"
      ? inspected ? "medium" : "low"
      : directMatches.length >= 2 || negativeMatches.length >= 1
        ? "high"
        : "medium";
  const evidenceItemIds = linked.map((match) => match.item.id);
  const assessedSourceTypes = uniqueStrings(compatibleSourceTypes(requirement.category).filter((sourceType) => bundle.sourceCounts[sourceType] > 0)) as UserEvidenceSourceType[];
  const evidenceSummary = linked.map((match) => match.item.title).join(", ");
  const rationale = state === "proven"
    ? `Stored evidence directly supports this requirement at or near the success bar${evidenceSummary ? `: ${evidenceSummary}` : ""}.`
    : state === "partially_proven"
      ? `Anchor found relevant evidence${evidenceSummary ? `: ${evidenceSummary}` : ""}, but it does not yet fully demonstrate the stated success bar.`
      : state === "below_bar"
        ? "Stored feedback or outcomes indicate this requirement may currently fall below the target bar. This is an evidence-based signal, not a permanent judgement."
        : state === "unproven"
          ? "Anchor checked the relevant evidence sources but did not find adequate proof. This means unproven in Anchor, not absent in the user."
          : "Anchor does not have enough relevant user evidence to assess this requirement responsibly.";
  const successBarAssessment = state === "proven"
    ? "The available evidence appears to meet the success bar."
    : state === "partially_proven"
      ? "The evidence is adjacent or incomplete relative to the success bar."
      : state === "below_bar"
        ? "Available evidence suggests the success bar is not yet met."
        : "The success bar cannot yet be verified from stored evidence.";

  return {
    requirementId: requirement.id,
    state,
    confidence,
    evidenceItemIds,
    assessedSourceTypes,
    rationale,
    successBarAssessment,
    missingEvidence: state === "proven" ? "" : missingEvidenceFor(requirement),
    verificationPrompt: state === "unknown" || state === "unproven" ? verificationPromptFor(requirement) : "",
    source: "deterministic",
    updatedAt: Date.now(),
  };
}

function importanceRank(value: RequirementImportance): number {
  return value === "essential" ? 0 : value === "important" ? 1 : value === "differentiator" ? 2 : 3;
}

export function recomputeCoverageSummary(model: RequirementModel, bundle: UserEvidenceBundle, assessments: RequirementCoverageAssessment[]): CoverageModel["summary"] {
  const counts: Record<CoverageState, number> = {
    proven: 0,
    partially_proven: 0,
    unproven: 0,
    unknown: 0,
    below_bar: 0,
  };
  assessments.forEach((assessment) => { counts[assessment.state] += 1; });
  const assessmentByRequirement = new Map(assessments.map((assessment) => [assessment.requirementId, assessment]));
  const orderedRequirements = [...model.requirements].sort((left, right) => importanceRank(left.importance) - importanceRank(right.importance));
  const clearlyEvidencedRequirementIds = orderedRequirements
    .filter((requirement) => assessmentByRequirement.get(requirement.id)?.state === "proven")
    .map((requirement) => requirement.id);
  const partlyEvidencedRequirementIds = orderedRequirements
    .filter((requirement) => assessmentByRequirement.get(requirement.id)?.state === "partially_proven")
    .map((requirement) => requirement.id);
  const notYetVerifiedRequirementIds = orderedRequirements
    .filter((requirement) => {
      const state = assessmentByRequirement.get(requirement.id)?.state;
      return state === "unproven" || state === "unknown" || state === "below_bar";
    })
    .map((requirement) => requirement.id);
  const verificationQueue = orderedRequirements
    .filter((requirement) => requirement.importance === "essential" || requirement.importance === "important")
    .map((requirement) => ({ requirement, assessment: assessmentByRequirement.get(requirement.id) }))
    .filter(({ assessment }) => assessment?.state === "unknown" || assessment?.state === "unproven")
    .slice(0, 3)
    .map(({ requirement, assessment }) => ({
      requirementId: requirement.id,
      prompt: assessment?.verificationPrompt || `Anchor could not verify ${requirement.label}.`,
      reason: `${requirement.importance === "essential" ? "Essential" : "Important"} requirement with ${assessment?.confidence || "low"} coverage confidence.`,
    }));

  const linkedAssessmentCount = assessments.filter((assessment) => assessment.evidenceItemIds.length > 0).length;
  const linkedAssessmentCoverage = assessments.length ? Math.round((linkedAssessmentCount / assessments.length) * 100) : 0;
  const sourceTypeCount = SOURCE_TYPES.filter((sourceType) => bundle.sourceCounts[sourceType] > 0).length;
  const directEvidenceCount = bundle.items.filter((item) => item.strength === "direct").length;
  const caveats = [...bundle.sourceCaveats];
  if (counts.unknown > Math.max(2, Math.round(assessments.length * 0.3))) caveats.push("A meaningful share of requirements remain unknown because Anchor does not yet hold enough user evidence.");
  if (counts.unproven > 0) caveats.push("Unproven means Anchor found no adequate evidence in the data it checked; it does not mean the user lacks the underlying capability.");
  const status: CoverageModel["summary"]["quality"]["status"] = linkedAssessmentCoverage >= 65 && directEvidenceCount >= 4 && sourceTypeCount >= 3
    ? "strong"
    : linkedAssessmentCoverage >= 30 && sourceTypeCount >= 2
      ? "usable"
      : "provisional";

  return {
    counts,
    clearlyEvidencedRequirementIds,
    partlyEvidencedRequirementIds,
    notYetVerifiedRequirementIds,
    verificationQueue,
    quality: {
      status,
      sourceCount: bundle.items.length,
      sourceTypeCount,
      directEvidenceCount,
      linkedAssessmentCount,
      linkedAssessmentCoverage,
      caveats: uniqueStrings(caveats),
    },
  };
}

export function buildCoverageModel(requirementModel: RequirementModel, bundle: UserEvidenceBundle): CoverageModel {
  const assessments = requirementModel.requirements.map((requirement) => assessRequirement(requirement, requirementModel, bundle));
  return {
    mode: "requirement_coverage",
    version: COVERAGE_MODEL_VERSION,
    requirementFingerprint: requirementModel.sourceFingerprint,
    userEvidenceFingerprint: bundle.fingerprint,
    target: {
      label: requirementModel.target.label,
      assumption: "Coverage describes what Anchor can verify from stored evidence. It does not equate missing evidence with missing ability.",
    },
    assessments,
    evidenceItems: bundle.items,
    summary: recomputeCoverageSummary(requirementModel, bundle, assessments),
    generatedAt: Date.now(),
  };
}

export function coverageModelIsCurrent(value: any, requirementModel: RequirementModel, bundle: UserEvidenceBundle): value is CoverageModel {
  return value?.mode === "requirement_coverage"
    && value?.version === COVERAGE_MODEL_VERSION
    && value?.requirementFingerprint === requirementModel.sourceFingerprint
    && value?.userEvidenceFingerprint === bundle.fingerprint
    && Array.isArray(value?.assessments);
}
