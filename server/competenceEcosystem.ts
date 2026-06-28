import type { CareerTrack, Contact, Hustle, Job, Learn, Task, Win } from "@shared/schema";
import { storage } from "./storage";

export type CompetenceKind = "domain" | "professional" | "experience" | "evidence";
export type ContributorKey = "knowledge" | "practice" | "experience" | "feedback" | "reflection" | "network" | "evidence";
export type ContributorState = "empty" | "emerging" | "active" | "strong";
export type DevelopmentStage = "orientation" | "understanding" | "application" | "judgement" | "synthesis" | "signal";
export type MaturityLevel = "none" | "emerging" | "working" | "strong" | "differentiated";
export type EstimateConfidence = "low" | "medium" | "high";
export type CompetencyImportance = "critical" | "important" | "useful";
export type EvidenceType = "consumed" | "mapped" | "applied" | "performed" | "reviewed" | "reflected" | "published" | "networked";
export type SourceType = "track_intelligence" | "job" | "learn" | "contact" | "proof" | "task" | "win";

export type CompetenceEvidenceSignal = {
  contributor: ContributorKey;
  sourceType: SourceType;
  sourceId?: number;
  title: string;
  evidenceType: EvidenceType;
  strength: 1 | 2 | 3 | 4 | 5;
  confidence: EstimateConfidence;
  reason: string;
};

export type CompetenceContributor = {
  key: ContributorKey;
  label: string;
  state: ContributorState;
  maturity: MaturityLevel;
  confidence: EstimateConfidence;
  evidenceScore: number;
  signalCount: number;
  signals: string[];
  evidenceSignals: CompetenceEvidenceSignal[];
  interpretation: string;
};

export type DevelopmentExperience = {
  title: string;
  contributor: ContributorKey;
  stage: DevelopmentStage;
  experienceType: "map" | "case_application" | "practice" | "feedback" | "reflection" | "proof" | "network";
  objective: string;
  doneWhen: string;
  outputs: string[];
  whyThis: string;
};

export type DevelopmentProgramSlice = {
  horizon: "next_two_weeks";
  stage: DevelopmentStage;
  focusContributor: ContributorKey;
  targetCompetencyKey?: string;
  thesis: string;
  experiences: DevelopmentExperience[];
  assessment: string;
  exitCriteria: string[];
};

export type CompetenceArea = {
  key: string;
  name: string;
  kind: CompetenceKind;
  targetMaturity: "explore" | "role_sufficient" | "differentiated";
  currentStage: DevelopmentStage;
  rationale: string;
  requiredContributors: ContributorKey[];
};

export type RequiredCompetency = {
  key: string;
  name: string;
  kind: CompetenceKind;
  importance: CompetencyImportance;
  targetLevel: MaturityLevel;
  currentLevel: MaturityLevel;
  confidence: EstimateConfidence;
  contributorKeys: ContributorKey[];
  evidenceRequired: string[];
  evidenceGap: string;
  subdomains: string[];
  whyItMatters: string;
  transferNotes: string;
};

export type RoleCompetencyProfile = {
  targetRoleArchetype: string;
  profileType: string;
  targetStandard: string;
  transferSummary: string;
  requiredCompetencies: RequiredCompetency[];
};

export type CompetenceEcosystem = {
  trackId: number;
  trackName: string;
  trackStatus: string;
  targetRoleArchetype: string;
  roleProfile: RoleCompetencyProfile;
  competenceAreas: CompetenceArea[];
  contributors: CompetenceContributor[];
  weakestContributor: CompetenceContributor | null;
  programSlice: DevelopmentProgramSlice | null;
  operatingPrinciple: string;
};

export type CompetenceEcosystemPayload = {
  readOnlySnapshot: true;
  generatedAt: number;
  ecosystems: CompetenceEcosystem[];
  summary: string;
};

export type CompetenceEcosystemInput = {
  tracks: CareerTrack[];
  jobs: Job[];
  learn: Learn[];
  contacts: Contact[];
  hustles: Hustle[];
  tasks: Task[];
  wins?: Win[];
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "about", "role", "roles", "job", "jobs", "lead", "head", "senior", "manager",
  "career", "track", "strategy", "strategic", "work", "working", "project", "projects", "learning", "learn", "open", "active",
]);

const CONTRIBUTOR_LABELS: Record<ContributorKey, string> = {
  knowledge: "Knowledge base",
  practice: "Deliberate practice",
  experience: "Role-context experience",
  feedback: "Feedback loop",
  reflection: "Reflection and model-building",
  network: "Practitioner exposure",
  evidence: "Visible evidence",
};

const CONTRIBUTOR_PRIORITY: ContributorKey[] = ["knowledge", "practice", "experience", "feedback", "reflection", "evidence", "network"];
const MATURITY_RANK: Record<MaturityLevel, number> = { none: 0, emerging: 1, working: 2, strong: 3, differentiated: 4 };
const IMPORTANCE_RANK: Record<CompetencyImportance, number> = { critical: 3, important: 2, useful: 1 };

function compact(value: unknown, max = 240): string {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function lower(value: unknown): string {
  return compact(value, 4000).toLowerCase();
}

function tokens(value: unknown): string[] {
  return lower(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function unique(values: string[], max = 5): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => compact(item, 180)).filter(Boolean)) {
    const key = lower(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function parseJsonText(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return flatten(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function flatten(value: unknown, depth = 0): string {
  if (value == null || depth > 5) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map((item) => flatten(item, depth + 1)).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map((item) => flatten(item, depth + 1)).filter(Boolean).join(" ");
  return "";
}

function trackText(track: CareerTrack): string {
  return compact([
    track.name,
    track.slug,
    track.description,
    track.targetRoleArchetype,
    track.whyItFits,
    parseJsonText(track.trackIntelligence),
  ].join(" "), 4000);
}

function entityText(entity: Job | Learn | Contact | Hustle | Task | Win): string {
  return compact(Object.entries(entity as Record<string, unknown>)
    .filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key))
    .map(([, value]) => typeof value === "string" ? `${value} ${parseJsonText(value)}` : String(value || ""))
    .join(" "), 4000);
}

function textMatchesTrack(value: string, track: CareerTrack): boolean {
  const haystack = lower(value);
  if (!haystack) return false;
  const trackTokens = tokens(`${track.name} ${track.slug} ${track.targetRoleArchetype} ${track.description}`).filter((token) => token.length >= 4);
  return trackTokens.some((token) => haystack.includes(token));
}

function belongsToTrack(entity: { relatedTrackId?: number | null }, text: string, track: CareerTrack): boolean {
  return entity.relatedTrackId === track.id || textMatchesTrack(text, track);
}

function hustleBelongsToTrack(hustle: Hustle, track: CareerTrack): boolean {
  return hustle.proofAssetForTrack === track.id || textMatchesTrack(entityText(hustle), track);
}

function winBelongsToTrack(win: Win, track: CareerTrack): boolean {
  return win.trackId === track.id || textMatchesTrack(entityText(win), track);
}

function stateForScore(score: number): ContributorState {
  if (score <= 0) return "empty";
  if (score <= 2) return "emerging";
  if (score <= 8) return "active";
  return "strong";
}

function maturityForScore(score: number): MaturityLevel {
  if (score <= 0) return "none";
  if (score <= 2) return "emerging";
  if (score <= 7) return "working";
  if (score <= 13) return "strong";
  return "differentiated";
}

function contributorRank(state: ContributorState): number {
  return state === "empty" ? 0 : state === "emerging" ? 1 : state === "active" ? 2 : 3;
}

function confidenceForSignals(signals: CompetenceEvidenceSignal[], score: number): EstimateConfidence {
  if (!signals.length) return "low";
  const highQuality = signals.some((signal) => ["applied", "performed", "reviewed", "reflected", "published", "networked"].includes(signal.evidenceType) && signal.strength >= 3);
  if (score >= 9 && highQuality) return "high";
  if (score >= 4 || highQuality || signals.length >= 2) return "medium";
  return "low";
}

function signal(input: {
  contributor: ContributorKey;
  sourceType: SourceType;
  sourceId?: number;
  title: string;
  evidenceType: EvidenceType;
  strength: 1 | 2 | 3 | 4 | 5;
  reason: string;
  confidence?: EstimateConfidence;
}): CompetenceEvidenceSignal {
  return {
    contributor: input.contributor,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: compact(input.title, 180),
    evidenceType: input.evidenceType,
    strength: input.strength,
    reason: input.reason,
    confidence: input.confidence || (input.strength >= 4 ? "high" : input.strength >= 2 ? "medium" : "low"),
  };
}

function contributor(key: ContributorKey, signals: CompetenceEvidenceSignal[], interpretation: string): CompetenceContributor {
  const cleanSignals = signals.filter((item) => item.title);
  const evidenceScore = cleanSignals.reduce((sum, item) => sum + item.strength, 0);
  return {
    key,
    label: CONTRIBUTOR_LABELS[key],
    state: stateForScore(evidenceScore),
    maturity: maturityForScore(evidenceScore),
    confidence: confidenceForSignals(cleanSignals, evidenceScore),
    evidenceScore,
    signalCount: unique(cleanSignals.map((item) => item.title), 50).length,
    signals: unique(cleanSignals.map((item) => item.title), 4),
    evidenceSignals: cleanSignals.slice(0, 8),
    interpretation,
  };
}

function activeLearn(learn: Learn[]): Learn[] {
  return learn.filter((item) => !item.done && !["closed", "done"].includes(item.learnStatus || ""));
}

function taskStrength(task: Task): 1 | 2 | 3 | 4 {
  if (task.done) return 4;
  if (task.status === "in_progress") return 3;
  if (task.readiness === "ready") return 2;
  return 1;
}

function learnKnowledgeStrength(item: Learn): 1 | 2 | 3 | 4 | 5 {
  if (item.outputEvidenceUrl) return 5;
  if (item.outputTitle || item.outputStatus === "published" || item.done) return 4;
  if (item.requiredOutput || item.proofIntent) return 3;
  if (["active", "enrolled"].includes(item.learnStatus || "")) return 3;
  return 2;
}

function jobExperienceStrength(job: Job): 1 | 2 | 3 | 4 {
  if (job.status === "interviewing") return 4;
  if (job.status === "applied") return 3;
  if (job.applicationReadiness && job.applicationReadiness !== "none") return 2;
  return 1;
}

function contactStrength(contact: Contact): 1 | 2 | 3 | 4 {
  if (contact.status === "replied") return 4;
  if (contact.status === "messaged") return 3;
  if (contact.relationshipStrength === "warm" || contact.relationshipStrength === "strong") return 3;
  return 2;
}

function proofStrength(hustle: Hustle): 2 | 3 | 4 {
  if (hustle.stage === "earning") return 4;
  if (hustle.stage === "testing") return 3;
  return 2;
}

function buildContributorSet(track: CareerTrack, input: CompetenceEcosystemInput): CompetenceContributor[] {
  const trackJobs = input.jobs.filter((job) => belongsToTrack(job, entityText(job), track) && !["closed", "rejected", "archived"].includes(job.status || ""));
  const trackLearn = input.learn.filter((item) => belongsToTrack(item, entityText(item), track));
  const trackContacts = input.contacts.filter((contact) => belongsToTrack(contact, entityText(contact), track));
  const trackProof = input.hustles.filter((hustle) => hustleBelongsToTrack(hustle, track));
  const trackTasks = input.tasks.filter((task) => task.relatedTrackId === track.id || textMatchesTrack(entityText(task), track));
  const trackWins = (input.wins || []).filter((win) => winBelongsToTrack(win, track));
  const intelligence = parseJsonText(track.trackIntelligence);

  const knowledgeSignals = [
    ...activeLearn(trackLearn).map((item) => signal({
      contributor: "knowledge",
      sourceType: "learn",
      sourceId: item.id,
      title: item.title,
      evidenceType: item.outputEvidenceUrl || item.outputTitle || item.done ? "applied" : "consumed",
      strength: learnKnowledgeStrength(item),
      reason: item.requiredOutput ? "Learning item has an expected output, so it is stronger than passive reading." : "Learning item adds domain knowledge evidence.",
    })),
    ...(intelligence ? [signal({
      contributor: "knowledge",
      sourceType: "track_intelligence",
      sourceId: track.id,
      title: `${track.name} track intelligence exists`,
      evidenceType: "mapped",
      strength: 2,
      reason: "Stored track intelligence gives Anchor a domain map, but it does not prove user judgement by itself.",
    })] : []),
    ...trackTasks.filter((task) => /read|learn|course|study|primer|research|understand/i.test(entityText(task))).map((task) => signal({
      contributor: "knowledge",
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      evidenceType: task.done ? "mapped" : "consumed",
      strength: task.done ? 2 : 1,
      reason: task.done ? "Completed knowledge task indicates some synthesis or mapping." : "Open knowledge task is a weak signal until output exists.",
    })),
  ];

  const practiceSignals = [
    ...trackTasks.filter((task) => /practice|drill|case|simulate|presentation|interview|memo|brief|write|model|compare|apply/i.test(entityText(task))).map((task) => signal({
      contributor: "practice",
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      evidenceType: task.done ? "applied" : "performed",
      strength: taskStrength(task),
      reason: "This is deliberate use of knowledge, not only content acquisition.",
    })),
    ...trackLearn.filter((item) => /practice|case|exercise|output|brief|memo|artifact/i.test(entityText(item))).map((item) => signal({
      contributor: "practice",
      sourceType: "learn",
      sourceId: item.id,
      title: item.outputTitle || item.title,
      evidenceType: item.outputEvidenceUrl || item.outputTitle ? "applied" : "performed",
      strength: item.outputEvidenceUrl ? 5 : item.outputTitle ? 4 : 2,
      reason: "The learning item is connected to an output or exercise, so it contributes to practice maturity.",
    })),
  ];

  const experienceSignals = [
    ...trackJobs.map((job) => signal({
      contributor: "experience",
      sourceType: "job",
      sourceId: job.id,
      title: job.title,
      evidenceType: job.status === "interviewing" || job.status === "applied" ? "performed" : "mapped",
      strength: jobExperienceStrength(job),
      reason: job.status === "wishlist" ? "Wishlist role shows role-context exposure but not performed experience." : "Live opportunity work approximates the target role context.",
    })),
    ...trackProof.map((hustle) => signal({
      contributor: "experience",
      sourceType: "proof",
      sourceId: hustle.id,
      title: hustle.title,
      evidenceType: "performed",
      strength: proofStrength(hustle),
      reason: "Proof assets simulate or demonstrate role-shaped work.",
    })),
    ...trackTasks.filter((task) => /project|deliver|client|stakeholder|lead|manage|build|run|workshop/i.test(entityText(task))).map((task) => signal({
      contributor: "experience",
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      evidenceType: task.done ? "performed" : "applied",
      strength: taskStrength(task),
      reason: "Task resembles role-context execution or simulation.",
    })),
  ];

  const feedbackSignals = [
    ...trackContacts.filter((contact) => /mentor|coach|feedback|review|advice|expert|operator|leader/i.test(entityText(contact))).map((contact) => signal({
      contributor: "feedback",
      sourceType: "contact",
      sourceId: contact.id,
      title: contact.who || contact.name,
      evidenceType: contact.status === "replied" ? "reviewed" : "networked",
      strength: contactStrength(contact),
      reason: "Practitioner or mentor contact can correct the user's model.",
    })),
    ...trackTasks.filter((task) => /feedback|review|critique|coach|mentor|rehearse/i.test(entityText(task))).map((task) => signal({
      contributor: "feedback",
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      evidenceType: task.done ? "reviewed" : "performed",
      strength: taskStrength(task),
      reason: "This task explicitly creates critique, review, or coaching exposure.",
    })),
  ];

  const reflectionSignals = [
    ...trackWins.filter((win) => win.takeaway || /reflection|lesson|learned/i.test(entityText(win))).map((win) => signal({
      contributor: "reflection",
      sourceType: "win",
      sourceId: win.id,
      title: win.text,
      evidenceType: "reflected",
      strength: 3,
      reason: win.takeaway ? "Win includes a takeaway, so it indicates model-building rather than activity logging." : "Win suggests reflection on development progress.",
    })),
    ...trackTasks.filter((task) => /reflect|retro|after action|lesson|takeaway|decision log/i.test(entityText(task))).map((task) => signal({
      contributor: "reflection",
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      evidenceType: task.done ? "reflected" : "performed",
      strength: task.done ? 4 : 2,
      reason: "Reflection task converts activity into judgement and self-model updates.",
    })),
  ];

  const networkSignals = [
    ...trackContacts.map((contact) => signal({
      contributor: "network",
      sourceType: "contact",
      sourceId: contact.id,
      title: contact.who || contact.name,
      evidenceType: "networked",
      strength: contactStrength(contact),
      reason: "Contact creates practitioner exposure or access path.",
    })),
    ...trackTasks.filter((task) => /contact|reach out|outreach|conversation|coffee|mentor|insider/i.test(entityText(task))).map((task) => signal({
      contributor: "network",
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      evidenceType: task.done ? "networked" : "performed",
      strength: taskStrength(task),
      reason: "Networking task can reduce uncertainty about fit, access, or role reality.",
    })),
  ];

  const evidenceSignals = [
    ...trackProof.map((hustle) => signal({
      contributor: "evidence",
      sourceType: "proof",
      sourceId: hustle.id,
      title: hustle.title,
      evidenceType: hustle.stage === "idea" ? "mapped" : "published",
      strength: proofStrength(hustle),
      reason: "Proof asset is visible evidence or a credible proof direction.",
    })),
    ...trackLearn.filter((item) => item.outputEvidenceUrl || item.outputTitle || item.outputStatus === "published").map((item) => signal({
      contributor: "evidence",
      sourceType: "learn",
      sourceId: item.id,
      title: item.outputTitle || item.title,
      evidenceType: item.outputEvidenceUrl || item.outputStatus === "published" ? "published" : "applied",
      strength: item.outputEvidenceUrl || item.outputStatus === "published" ? 5 : 4,
      reason: "Learning produced visible output, so it improves evidence maturity.",
    })),
    ...trackWins.filter((win) => ["proof_asset", "learning", "job_progress", "network"].includes(win.winCategory)).map((win) => signal({
      contributor: "evidence",
      sourceType: "win",
      sourceId: win.id,
      title: win.text,
      evidenceType: win.winCategory === "proof_asset" ? "published" : "applied",
      strength: win.winCategory === "proof_asset" ? 4 : 3,
      reason: "Win records externally useful progress or evidence.",
    })),
    ...trackTasks.filter((task) => task.done && /memo|brief|artifact|published|evidence|output|case/i.test(entityText(task))).map((task) => signal({
      contributor: "evidence",
      sourceType: "task",
      sourceId: task.id,
      title: task.title,
      evidenceType: "published",
      strength: 4,
      reason: "Completed output-shaped task can serve as visible or reusable evidence.",
    })),
  ];

  return [
    contributor("knowledge", knowledgeSignals, "What the user has consumed, mapped, or saved as a knowledge base for this direction."),
    contributor("practice", practiceSignals, "Deliberate attempts to use the knowledge, not just read about it."),
    contributor("experience", experienceSignals, "Real or simulated role-context work that makes the competence credible."),
    contributor("feedback", feedbackSignals, "Signals that the user is getting critique, coaching, or practitioner correction."),
    contributor("reflection", reflectionSignals, "Evidence that the user is converting activity into judgement and a personal model."),
    contributor("network", networkSignals, "Practitioner exposure and access paths connected to the direction."),
    contributor("evidence", evidenceSignals, "Visible artifacts or wins that can reduce hiring risk."),
  ];
}

function inferProfessionalFocus(track: CareerTrack): string {
  const text = lower(trackText(track));
  if (/chief of staff|founder|executive|ceo|office of/i.test(text)) return "executive communication and decision support";
  if (/leadership|manage|manager|team|people/i.test(text)) return "leadership and managing people";
  if (/consult|advisor|advisory|strategy|bain/i.test(text)) return "structured problem solving and senior-client communication";
  if (/policy|government|minister|public sector|tbi/i.test(text)) return "political judgement and stakeholder communication";
  if (/product|operator|operations|delivery/i.test(text)) return "prioritisation and execution leadership";
  return "professional operating capability";
}

function profileType(track: CareerTrack): string {
  const text = lower(trackText(track));
  if (/chief of staff|founder|executive|office of/i.test(text)) return "chief_of_staff";
  if (/policy|government|minister|public sector|tbi/i.test(text)) return "policy_or_government";
  if (/governance|responsible ai|ai safety|assurance|risk/i.test(text)) return "ai_governance";
  if (/consult|advisor|advisory|bain/i.test(text)) return "advisory";
  if (/product|operator|operations|delivery/i.test(text)) return "operator";
  return "general_direction";
}

function subdomainsFor(track: CareerTrack, kind: CompetenceKind): string[] {
  const text = lower(trackText(track));
  if (kind === "domain" && /ai|governance|responsible|safety|assurance|risk/.test(text)) {
    return ["regulation and institutions", "risk frameworks", "technical foundations", "assurance and evaluation", "operating models", "strategic trade-offs"];
  }
  if (kind === "professional" && /chief of staff|founder|executive|office of/.test(text)) {
    return ["executive communication", "decision support", "prioritisation", "operating cadence", "managing upwards", "stakeholder influence"];
  }
  if (kind === "professional" && /policy|government|minister|public sector|tbi/.test(text)) {
    return ["political judgement", "stakeholder communication", "briefing", "institutional awareness", "trade-off framing"];
  }
  if (kind === "professional") return ["structured thinking", "communication", "prioritisation", "stakeholder management", "decision quality"];
  if (kind === "experience") return ["role-shaped simulations", "real opportunities", "practitioner conversations", "case application", "delivery context"];
  if (kind === "evidence") return ["proof fragments", "case notes", "memos", "published artifacts", "interview stories"];
  return ["role requirements", "market language", "core concepts", "competing views", "application contexts"];
}

function evidenceRequired(kind: CompetenceKind): string[] {
  if (kind === "domain") return ["terrain map", "applied case note", "judgement log", "source-backed questions"];
  if (kind === "professional") return ["role-shaped practice output", "feedback from practitioner or senior peer", "reflection on operating style"];
  if (kind === "experience") return ["real or simulated role-context work", "practitioner reality-check", "decision or delivery brief"];
  return ["proof fragment", "reusable memo or artifact", "published or shareable evidence", "win with takeaway"];
}

function targetLevelFor(kind: CompetenceKind, track: CareerTrack): MaturityLevel {
  const text = lower(trackText(track));
  if (kind === "evidence") return /senior|lead|chief|executive|strategy/.test(text) ? "strong" : "working";
  if (kind === "professional") return /chief|executive|lead|senior|advisor|strategy/.test(text) ? "strong" : "working";
  if (kind === "experience") return "working";
  return /expert|lead|senior|strategy|governance/.test(text) ? "strong" : "working";
}

function importanceFor(kind: CompetenceKind, track: CareerTrack): CompetencyImportance {
  const text = lower(trackText(track));
  if (kind === "domain" && /governance|policy|ai|climate|health|cyber|finance/.test(text)) return "critical";
  if (kind === "professional" && /chief|executive|lead|manager|advisor|strategy|consult/.test(text)) return "critical";
  if (kind === "evidence" && /senior|strategy|advisor|lead/.test(text)) return "important";
  return kind === "experience" ? "important" : "important";
}

function confidenceForRequired(required: ContributorKey[], contributors: CompetenceContributor[]): EstimateConfidence {
  const items = required.map((key) => contributors.find((item) => item.key === key)).filter((item): item is CompetenceContributor => !!item);
  if (!items.length) return "low";
  if (items.some((item) => item.confidence === "low" || item.state === "empty")) return "low";
  if (items.every((item) => item.confidence === "high" || item.evidenceScore >= 8)) return "high";
  return "medium";
}

function levelForRequired(required: ContributorKey[], contributors: CompetenceContributor[]): MaturityLevel {
  const items = required.map((key) => contributors.find((item) => item.key === key)).filter((item): item is CompetenceContributor => !!item);
  if (!items.length) return "none";
  const average = items.reduce((sum, item) => sum + item.evidenceScore, 0) / items.length;
  const minimum = Math.min(...items.map((item) => item.evidenceScore));
  if (minimum === 0 && average < 2) return "none";
  if (average <= 2) return "emerging";
  if (average <= 7) return "working";
  if (average <= 13) return "strong";
  return "differentiated";
}

function weakestRequiredContributor(required: ContributorKey[], contributors: CompetenceContributor[]): CompetenceContributor | null {
  const items = required.map((key) => contributors.find((item) => item.key === key)).filter((item): item is CompetenceContributor => !!item);
  return items.sort((a, b) => a.evidenceScore - b.evidenceScore || CONTRIBUTOR_PRIORITY.indexOf(a.key) - CONTRIBUTOR_PRIORITY.indexOf(b.key))[0] || null;
}

function evidenceGapFor(required: ContributorKey[], contributors: CompetenceContributor[], targetLevel: MaturityLevel): string {
  const level = levelForRequired(required, contributors);
  const weakest = weakestRequiredContributor(required, contributors);
  if (MATURITY_RANK[level] >= MATURITY_RANK[targetLevel]) {
    return "Evidence is currently sufficient for this target standard; maintain it through real outputs and feedback.";
  }
  if (!weakest || weakest.state === "empty") {
    const missing = weakest?.label || "required contributor";
    return `Missing ${missing} evidence for the target standard.`;
  }
  return `${weakest.label} is the limiting evidence base: ${weakest.interpretation}`;
}

function transferNotesFor(kind: CompetenceKind, track: CareerTrack): string {
  const why = compact(track.whyItFits, 220);
  if (kind === "professional") return why ? `Likely transfer from prior operating experience: ${why}` : "Professional capability may transfer from prior roles, but Anchor needs evidence in this target context.";
  if (kind === "domain") return "Transferable strategy and stakeholder judgement can help, but domain-specific assumptions still need explicit testing.";
  if (kind === "experience") return "Prior experience transfers only when it resembles the role context or is deliberately adapted into simulations.";
  return "Evidence must be visible in this direction; prior reputation helps only if it is translated into relevant artifacts or stories.";
}

function areaToRequiredCompetency(area: CompetenceArea, track: CareerTrack, contributors: CompetenceContributor[]): RequiredCompetency {
  const targetLevel = targetLevelFor(area.kind, track);
  return {
    key: area.key,
    name: area.name,
    kind: area.kind,
    importance: importanceFor(area.kind, track),
    targetLevel,
    currentLevel: levelForRequired(area.requiredContributors, contributors),
    confidence: confidenceForRequired(area.requiredContributors, contributors),
    contributorKeys: area.requiredContributors,
    evidenceRequired: evidenceRequired(area.kind),
    evidenceGap: evidenceGapFor(area.requiredContributors, contributors, targetLevel),
    subdomains: subdomainsFor(track, area.kind),
    whyItMatters: area.rationale,
    transferNotes: transferNotesFor(area.kind, track),
  };
}

function roleCompetencyProfile(track: CareerTrack, areas: CompetenceArea[], contributors: CompetenceContributor[]): RoleCompetencyProfile {
  const type = profileType(track);
  const requiredCompetencies = areas.map((area) => areaToRequiredCompetency(area, track, contributors));
  const transferSummary = compact(track.whyItFits, 240)
    || "Anchor should identify what transfers from prior work before recommending new learning.";
  return {
    targetRoleArchetype: track.targetRoleArchetype || track.name,
    profileType: type,
    targetStandard: `Credible enough to pursue ${track.targetRoleArchetype || track.name} without relying on generic learning activity.`,
    transferSummary,
    requiredCompetencies,
  };
}

function stageFor(required: ContributorKey[], contributors: CompetenceContributor[]): DevelopmentStage {
  const byKey = new Map(contributors.map((item) => [item.key, item]));
  const states = required.map((key) => contributorRank(byKey.get(key)?.state || "empty"));
  const min = Math.min(...states);
  const avg = states.reduce((sum, value) => sum + value, 0) / Math.max(1, states.length);
  if (min === 0 && avg < 1) return "orientation";
  if (avg < 1.5) return "understanding";
  if (avg < 2.1) return "application";
  if (byKey.get("reflection")?.state === "active" || byKey.get("feedback")?.state === "active") return "judgement";
  if (byKey.get("evidence")?.state === "active" || byKey.get("evidence")?.state === "strong") return "signal";
  return "synthesis";
}

function competenceAreas(track: CareerTrack, contributors: CompetenceContributor[]): CompetenceArea[] {
  const professionalFocus = inferProfessionalFocus(track);
  const domainName = track.name || track.targetRoleArchetype || "Target direction";
  const areas: Omit<CompetenceArea, "currentStage">[] = [
    {
      key: "domain_judgement",
      name: `${domainName} domain judgement`,
      kind: "domain",
      targetMaturity: "role_sufficient",
      rationale: "The user needs enough domain understanding and judgement to be credible, not just familiar with vocabulary.",
      requiredContributors: ["knowledge", "practice", "reflection"],
    },
    {
      key: "professional_operating_capability",
      name: professionalFocus,
      kind: "professional",
      targetMaturity: "role_sufficient",
      rationale: "Career progression depends on how the user operates in professional contexts, not only what they know.",
      requiredContributors: ["practice", "feedback", "experience", "reflection"],
    },
    {
      key: "role_context_experience",
      name: `${domainName} role-context experience`,
      kind: "experience",
      targetMaturity: "explore",
      rationale: "The user needs exposure to the work itself or credible simulations before creating high-stakes evidence.",
      requiredContributors: ["experience", "network", "feedback"],
    },
    {
      key: "market_signal",
      name: `${domainName} proof and signal`,
      kind: "evidence",
      targetMaturity: "differentiated",
      rationale: "Employers and collaborators need visible proof that reduces risk and shows trajectory.",
      requiredContributors: ["evidence", "practice", "experience"],
    },
  ];
  return areas.map((area) => ({ ...area, currentStage: stageFor(area.requiredContributors, contributors) }));
}

function contributorForProfileBottleneck(contributors: CompetenceContributor[], roleProfile: RoleCompetencyProfile): CompetenceContributor | null {
  const byKey = new Map(contributors.map((item) => [item.key, item]));
  const undersupplied = roleProfile.requiredCompetencies
    .filter((competency) => MATURITY_RANK[competency.currentLevel] < MATURITY_RANK[competency.targetLevel])
    .sort((a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] || MATURITY_RANK[a.currentLevel] - MATURITY_RANK[b.currentLevel]);
  for (const competency of undersupplied) {
    const weakest = competency.contributorKeys
      .map((key) => byKey.get(key))
      .filter((item): item is CompetenceContributor => !!item)
      .sort((a, b) => a.evidenceScore - b.evidenceScore || CONTRIBUTOR_PRIORITY.indexOf(a.key) - CONTRIBUTOR_PRIORITY.indexOf(b.key))[0];
    if (weakest) return weakest;
  }
  const weak = CONTRIBUTOR_PRIORITY
    .map((key) => byKey.get(key))
    .filter((item): item is CompetenceContributor => !!item && ["empty", "emerging"].includes(item.state));
  if (weak.length) return weak[0];
  return contributors.slice().sort((a, b) => a.evidenceScore - b.evidenceScore)[0] || null;
}

function experienceFor(track: CareerTrack, contributorKey: ContributorKey): DevelopmentExperience {
  const name = track.name || "this direction";
  if (contributorKey === "knowledge") {
    return {
      title: `Build a terrain map for ${name}`,
      contributor: "knowledge",
      stage: "orientation",
      experienceType: "map",
      objective: "Establish the core concepts, institutions, debates, and role requirements before doing visible output work.",
      doneWhen: "A one-page map exists with the main subdomains, three source-backed questions, and the biggest uncertainty.",
      outputs: ["one-page terrain map", "three source-backed questions", "uncertainty list"],
      whyThis: "Publishing or proof work would be premature if the domain map is still weak.",
    };
  }
  if (contributorKey === "practice") {
    return {
      title: `Apply one ${name} framework to a real case`,
      contributor: "practice",
      stage: "application",
      experienceType: "case_application",
      objective: "Move from passive knowledge to usable judgement by applying a framework to a real decision or case.",
      doneWhen: "A short case note explains the framework, assumptions, trade-offs, and your current conclusion.",
      outputs: ["short case note", "assumption list", "current conclusion"],
      whyThis: "The next leverage point is using knowledge, not collecting more of it.",
    };
  }
  if (contributorKey === "experience") {
    return {
      title: `Create one role-context simulation for ${name}`,
      contributor: "experience",
      stage: "application",
      experienceType: "practice",
      objective: "Approximate the work itself so the user can learn what the role demands before committing to a large project.",
      doneWhen: "One simulation brief exists: situation, decision required, constraints, recommended action, and reflection.",
      outputs: ["simulation brief", "decision recommendation", "reflection"],
      whyThis: "Credibility grows through doing role-shaped work, not only learning about the field.",
    };
  }
  if (contributorKey === "feedback") {
    return {
      title: `Get practitioner critique on a ${name} output`,
      contributor: "feedback",
      stage: "judgement",
      experienceType: "feedback",
      objective: "Expose the user's model to correction so judgement improves faster than through solo study.",
      doneWhen: "One practitioner, mentor, or informed peer has reviewed a note and given at least two corrections or questions.",
      outputs: ["reviewed note", "two corrections", "updated judgement"],
      whyThis: "Feedback is the difference between confident synthesis and untested opinion.",
    };
  }
  if (contributorKey === "reflection") {
    return {
      title: `Write the judgement log for ${name}`,
      contributor: "reflection",
      stage: "judgement",
      experienceType: "reflection",
      objective: "Convert activity into a personal model by naming what changed, what remains uncertain, and what decision follows.",
      doneWhen: "A judgement log records the claim, evidence, counterargument, uncertainty, and next test.",
      outputs: ["judgement log", "counterargument", "next test"],
      whyThis: "Expertise develops when the user updates their model, not when they merely complete activities.",
    };
  }
  if (contributorKey === "network") {
    return {
      title: `Run one reality-check conversation for ${name}`,
      contributor: "network",
      stage: "understanding",
      experienceType: "network",
      objective: "Use practitioner exposure to validate what the work really requires and what transfers from the user's background.",
      doneWhen: "One conversation or target archetype produces three role realities and one implication for the development plan.",
      outputs: ["role realities", "transferability note", "development implication"],
      whyThis: "The fastest way to reduce career uncertainty is often a targeted conversation, not more desk research.",
    };
  }
  return {
    title: `Create a small proof fragment for ${name}`,
    contributor: "evidence",
    stage: "signal",
    experienceType: "proof",
    objective: "Turn developing competence into visible evidence without jumping straight to a major publication.",
    doneWhen: "A small original artifact exists and can be reused in a conversation, application, or future larger piece.",
    outputs: ["small original artifact", "reuse note", "next proof step"],
    whyThis: "Marketability improves when competence becomes visible, but the proof should match current readiness.",
  };
}

function supportingExperiences(track: CareerTrack, focus: ContributorKey): DevelopmentExperience[] {
  const primary = experienceFor(track, focus);
  const supportKey: ContributorKey = focus === "knowledge" ? "practice" : focus === "practice" ? "reflection" : focus === "feedback" ? "reflection" : "feedback";
  const assessmentKey: ContributorKey = focus === "evidence" ? "reflection" : "evidence";
  return uniqueByTitle([primary, experienceFor(track, supportKey), experienceFor(track, assessmentKey)]).slice(0, 3);
}

function uniqueByTitle(items: DevelopmentExperience[]): DevelopmentExperience[] {
  const seen = new Set<string>();
  const result: DevelopmentExperience[] = [];
  for (const item of items) {
    const key = lower(item.title);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function targetCompetencyForContributor(roleProfile: RoleCompetencyProfile, key: ContributorKey): RequiredCompetency | null {
  return roleProfile.requiredCompetencies
    .filter((competency) => competency.contributorKeys.includes(key))
    .sort((a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] || MATURITY_RANK[a.currentLevel] - MATURITY_RANK[b.currentLevel])[0] || null;
}

function programSlice(track: CareerTrack, weakest: CompetenceContributor | null, roleProfile: RoleCompetencyProfile): DevelopmentProgramSlice | null {
  if (!weakest) return null;
  const firstExperience = experienceFor(track, weakest.key);
  const targetCompetency = targetCompetencyForContributor(roleProfile, weakest.key);
  return {
    horizon: "next_two_weeks",
    stage: firstExperience.stage,
    focusContributor: weakest.key,
    targetCompetencyKey: targetCompetency?.key,
    thesis: targetCompetency
      ? `Move ${targetCompetency.name} toward ${targetCompetency.targetLevel} by strengthening ${weakest.label.toLowerCase()}.`
      : `Strengthen ${weakest.label.toLowerCase()} for ${track.name}.`,
    experiences: supportingExperiences(track, weakest.key),
    assessment: "At the end of the slice, Anchor should look for a produced artifact, practitioner correction, or judgement update before recommending the next slice.",
    exitCriteria: [
      "A concrete output exists from the primary experience",
      "The user records what changed in their judgement or readiness",
      "Anchor can attach at least one evidence signal to the target contributor",
    ],
  };
}

function ecosystemForTrack(track: CareerTrack, input: CompetenceEcosystemInput): CompetenceEcosystem {
  const contributors = buildContributorSet(track, input);
  const areas = competenceAreas(track, contributors);
  const roleProfile = roleCompetencyProfile(track, areas, contributors);
  const weakest = contributorForProfileBottleneck(contributors, roleProfile);
  return {
    trackId: track.id,
    trackName: track.name,
    trackStatus: track.status,
    targetRoleArchetype: track.targetRoleArchetype,
    roleProfile,
    competenceAreas: areas,
    contributors,
    weakestContributor: weakest,
    programSlice: programSlice(track, weakest, roleProfile),
    operatingPrinciple: "Develop competence through coherent experiences. Tasks are only the logistics underneath the experience.",
  };
}

export function buildCompetenceEcosystems(input: CompetenceEcosystemInput): CompetenceEcosystemPayload {
  const tracks = input.tracks
    .filter((track) => track.status === "active")
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const ecosystems = tracks.map((track) => ecosystemForTrack(track, input));
  const summary = ecosystems.length
    ? `Anchor built ${ecosystems.length} active competence ecosystem${ecosystems.length === 1 ? "" : "s"}. Each one separates domain expertise, professional capability, experience, and evidence, then compares them to a role-specific target standard.`
    : "No active career directions are available for competence ecosystem planning.";
  return {
    readOnlySnapshot: true,
    generatedAt: Date.now(),
    ecosystems,
    summary,
  };
}

export async function buildCompetenceEcosystemsFromStorage(): Promise<CompetenceEcosystemPayload> {
  const [tracks, jobs, learn, contacts, hustles, tasks, wins] = await Promise.all([
    storage.getCareerTracks(),
    storage.getJobs(),
    storage.getLearn(),
    storage.getContacts(),
    storage.getHustles(),
    storage.getTasks(),
    storage.getWins(),
  ]);
  return buildCompetenceEcosystems({ tracks, jobs, learn, contacts, hustles, tasks, wins });
}
