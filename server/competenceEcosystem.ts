import type { CareerTrack, Contact, Hustle, Job, Learn, Task, Win } from "@shared/schema";
import { storage } from "./storage";

export type CompetenceKind = "domain" | "professional" | "experience" | "evidence";
export type ContributorKey = "knowledge" | "practice" | "experience" | "feedback" | "reflection" | "network" | "evidence";
export type ContributorState = "empty" | "emerging" | "active" | "strong";
export type DevelopmentStage = "orientation" | "understanding" | "application" | "judgement" | "synthesis" | "signal";

export type CompetenceContributor = {
  key: ContributorKey;
  label: string;
  state: ContributorState;
  signalCount: number;
  signals: string[];
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
  experiences: DevelopmentExperience[];
  assessment: string;
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

export type CompetenceEcosystem = {
  trackId: number;
  trackName: string;
  trackStatus: string;
  targetRoleArchetype: string;
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
  const trackTokens = tokens(`${track.name} ${track.slug} ${track.targetRoleArchetype}`).filter((token) => token.length >= 4);
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

function stateFor(count: number): ContributorState {
  if (count <= 0) return "empty";
  if (count === 1) return "emerging";
  if (count <= 3) return "active";
  return "strong";
}

function contributor(key: ContributorKey, signals: string[], interpretation: string): CompetenceContributor {
  const cleanSignals = unique(signals, 4);
  return {
    key,
    label: CONTRIBUTOR_LABELS[key],
    state: stateFor(cleanSignals.length),
    signalCount: cleanSignals.length,
    signals: cleanSignals,
    interpretation,
  };
}

function contributorRank(state: ContributorState): number {
  return state === "empty" ? 0 : state === "emerging" ? 1 : state === "active" ? 2 : 3;
}

function activeLearn(learn: Learn[]): Learn[] {
  return learn.filter((item) => !item.done && !["closed", "done"].includes(item.learnStatus || ""));
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
    ...activeLearn(trackLearn).map((item) => item.title),
    intelligence ? `${track.name} track intelligence exists` : "",
    ...trackTasks.filter((task) => /read|learn|course|study|primer|research|understand/i.test(entityText(task))).map((task) => task.title),
  ];
  const practiceSignals = [
    ...trackTasks.filter((task) => /practice|drill|case|simulate|presentation|interview|memo|brief|write|model|compare|apply/i.test(entityText(task))).map((task) => task.title),
    ...trackLearn.filter((item) => /practice|case|exercise|output|brief|memo|artifact/i.test(entityText(item))).map((item) => item.title),
  ];
  const experienceSignals = [
    ...trackJobs.map((job) => job.title),
    ...trackProof.map((hustle) => hustle.title),
    ...trackTasks.filter((task) => /project|deliver|client|stakeholder|lead|manage|build|run|workshop/i.test(entityText(task))).map((task) => task.title),
  ];
  const feedbackSignals = [
    ...trackContacts.filter((contact) => /mentor|coach|feedback|review|advice|expert|operator|leader/i.test(entityText(contact))).map((contact) => contact.who || contact.name),
    ...trackTasks.filter((task) => /feedback|review|critique|coach|mentor|rehearse/i.test(entityText(task))).map((task) => task.title),
  ];
  const reflectionSignals = [
    ...trackWins.filter((win) => win.takeaway || /reflection|lesson|learned/i.test(entityText(win))).map((win) => win.text),
    ...trackTasks.filter((task) => /reflect|retro|after action|lesson|takeaway|decision log/i.test(entityText(task))).map((task) => task.title),
  ];
  const networkSignals = [
    ...trackContacts.map((contact) => contact.who || contact.name),
    ...trackTasks.filter((task) => /contact|reach out|outreach|conversation|coffee|mentor|insider/i.test(entityText(task))).map((task) => task.title),
  ];
  const evidenceSignals = [
    ...trackProof.map((hustle) => hustle.title),
    ...trackLearn.filter((item) => item.outputEvidenceUrl || item.outputTitle || item.outputStatus === "published").map((item) => item.outputTitle || item.title),
    ...trackWins.filter((win) => ["proof_asset", "learning", "job_progress", "network"].includes(win.winCategory)).map((win) => win.text),
    ...trackTasks.filter((task) => task.done && /memo|brief|artifact|published|evidence|output|case/i.test(entityText(task))).map((task) => task.title),
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

function weakestContributor(contributors: CompetenceContributor[]): CompetenceContributor | null {
  const priority: ContributorKey[] = ["knowledge", "practice", "experience", "feedback", "reflection", "evidence", "network"];
  const byKey = new Map(contributors.map((item) => [item.key, item]));
  const weak = priority
    .map((key) => byKey.get(key))
    .filter((item): item is CompetenceContributor => !!item && ["empty", "emerging"].includes(item.state));
  if (weak.length) return weak[0];
  return contributors.slice().sort((a, b) => contributorRank(a.state) - contributorRank(b.state))[0] || null;
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

function programSlice(track: CareerTrack, weakest: CompetenceContributor | null): DevelopmentProgramSlice | null {
  if (!weakest) return null;
  const firstExperience = experienceFor(track, weakest.key);
  return {
    horizon: "next_two_weeks",
    stage: firstExperience.stage,
    focusContributor: weakest.key,
    experiences: supportingExperiences(track, weakest.key),
    assessment: "At the end of the slice, Anchor should look for a produced artifact, practitioner correction, or judgement update before recommending the next slice.",
  };
}

function ecosystemForTrack(track: CareerTrack, input: CompetenceEcosystemInput): CompetenceEcosystem {
  const contributors = buildContributorSet(track, input);
  const weakest = weakestContributor(contributors);
  return {
    trackId: track.id,
    trackName: track.name,
    trackStatus: track.status,
    targetRoleArchetype: track.targetRoleArchetype,
    competenceAreas: competenceAreas(track, contributors),
    contributors,
    weakestContributor: weakest,
    programSlice: programSlice(track, weakest),
    operatingPrinciple: "Develop competence through coherent experiences. Tasks are only the logistics underneath the experience.",
  };
}

export function buildCompetenceEcosystems(input: CompetenceEcosystemInput): CompetenceEcosystemPayload {
  const tracks = input.tracks
    .filter((track) => track.status === "active")
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const ecosystems = tracks.map((track) => ecosystemForTrack(track, input));
  const summary = ecosystems.length
    ? `Anchor built ${ecosystems.length} active competence ecosystem${ecosystems.length === 1 ? "" : "s"}. Each one separates domain expertise, professional capability, experience, and evidence.`
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
