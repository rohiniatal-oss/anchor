import type { CareerTrack, Contact, Hustle, Job, Learn, Task, UserProfile, Win } from "@shared/schema";
import { buildCompetenceEcosystems, type CompetenceEcosystem, type CompetenceKind, type ContributorKey, type RequiredCompetency } from "./competenceEcosystem";
import { PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS } from "./pathwayRoleDiscovery";

export type ImprovementOpportunityKind =
  | "market_evidence"
  | "domain_judgement"
  | "professional_capability"
  | "role_context_experience"
  | "visible_evidence"
  | "execution_capacity"
  | "strength_translation";

export type ImprovementOpportunityDimension = "domain" | "professional" | "experience" | "evidence" | "stability";

export type ImprovementOpportunity = {
  id: string;
  kind: ImprovementOpportunityKind;
  dimension: ImprovementOpportunityDimension;
  label: string;
  trackId?: number;
  trackName?: string;
  whyNow: string;
  evidenceFor: string[];
  evidenceAgainst: string[];
  confidence: "low" | "medium" | "high";
  anchorCanDo: string[];
  userDecisionNeeded: string | null;
  assumptions: string[];
  couldBeWrongIf: string[];
  blocks: string[];
  subblocks: string[];
  nextAction: {
    label: string;
    owner: "anchor" | "user" | "mixed";
    actionType:
      | "run_discovery"
      | "approve_shortlist"
      | "create_improvement_block"
      | "draft_proof_fragment"
      | "run_role_simulation"
      | "answer_one_question"
      | "start_existing_task";
  };
  completionContract: null;
  evidenceProduced: string[];
  score: number;
};

export type ImprovementOpportunityPayload = {
  readOnly: true;
  generatedAt: number;
  primaryOpportunity: ImprovementOpportunity;
  opportunities: ImprovementOpportunity[];
  assumptions: string[];
  summary: string;
  trace: string[];
};

export type ImprovementOpportunityInput = {
  tasks: Task[];
  jobs: Job[];
  learn: Learn[];
  hustles: Hustle[];
  contacts: Contact[];
  tracks: CareerTrack[];
  wins: Win[];
  profile: UserProfile | null;
};

function compact(value: unknown, max = 220) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function lower(value: unknown) {
  return compact(value, 4000).toLowerCase();
}

function norm(value: unknown) {
  return lower(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function textFor(value: Record<string, unknown>) {
  return Object.values(value).map((item) => String(item || "")).join(" ");
}

function trackTarget(track: CareerTrack) {
  return compact(track.targetRoleArchetype || track.name || "this pathway", 120);
}

function activeTracks(tracks: CareerTrack[]) {
  return tracks.filter((track) => track.status === "active").sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

function belongsToTrack(track: CareerTrack, text: string, relatedTrackId?: number | null) {
  if (relatedTrackId && relatedTrackId === track.id) return true;
  const hay = norm(text);
  const keys = [track.name, track.targetRoleArchetype, track.slug]
    .map(norm)
    .filter(Boolean)
    .flatMap((key) => key.split(" ").filter((word) => word.length > 3));
  return keys.some((key) => hay.includes(key));
}

function liveJobsForTrack(track: CareerTrack, jobs: Job[]) {
  return jobs.filter((job) =>
    !["closed", "rejected", "archived", "withdrawn"].includes(job.status || "")
    && belongsToTrack(track, `${job.title} ${job.company} ${job.roleArchetype} ${job.narrativeAngle} ${job.note} ${job.jdText}`, job.relatedTrackId),
  );
}

function proofAssetsForTrack(track: CareerTrack, hustles: Hustle[], learn: Learn[], tasks: Task[], wins: Win[]) {
  const hustlesForTrack = hustles.filter((hustle) => hustle.proofAssetForTrack === track.id || belongsToTrack(track, textFor(hustle as any)));
  const learnOutputs = learn.filter((item) => item.relatedTrackId === track.id && (item.outputEvidenceUrl || item.outputTitle || item.outputStatus === "published" || item.proofIntent));
  const taskOutputs = tasks.filter((task) => task.relatedTrackId === track.id && /memo|brief|artifact|proof|case|published|output/i.test(`${task.title} ${task.doneWhen} ${task.minimumOutcome}`));
  const winOutputs = wins.filter((win) => win.trackId === track.id && ["proof_asset", "job_progress", "learning"].includes(win.winCategory));
  return { hustlesForTrack, learnOutputs, taskOutputs, winOutputs, count: hustlesForTrack.length + learnOutputs.length + taskOutputs.length + winOutputs.length };
}

function existingDiscoveryTask(track: CareerTrack, tasks: Task[]) {
  return tasks.find((task) =>
    !task.done
    && task.sourceType === "career_track"
    && task.relatedTrackId === track.id
    && task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS,
  ) || null;
}

function transferableProfileSignal(profile: UserProfile | null, track: CareerTrack) {
  const text = lower(`${profile?.cvText || ""} ${profile?.targetRoles || ""} ${track.whyItFits || ""} ${track.description || ""}`);
  return /\b(strategy|consulting|consultant|policy|government|delivery|stakeholder|bain|tbi|tony blair|worldpay|humania|abraaj|advisory|leadership|manager)\b/.test(text);
}

function marketEvidenceOpportunity(track: CareerTrack, input: ImprovementOpportunityInput): ImprovementOpportunity | null {
  const jobs = liveJobsForTrack(track, input.jobs);
  if (jobs.length >= 3) return null;
  const existing = existingDiscoveryTask(track, input.tasks);
  const target = trackTarget(track);
  return {
    id: `market_evidence:${track.id}`,
    kind: "market_evidence",
    dimension: "evidence",
    label: `Map real ${target} role targets`,
    trackId: track.id,
    trackName: track.name,
    whyNow: `Anchor has only ${jobs.length} live role target${jobs.length === 1 ? "" : "s"} for ${track.name}, so it cannot yet infer the role standard with enough market evidence.`,
    evidenceFor: [
      `${track.name} is active.`,
      `${jobs.length} live matching role target${jobs.length === 1 ? " is" : "s are"} visible.`,
      existing ? "A role-discovery task already exists and should be reused." : "No live discovery task exists yet for this pathway.",
    ],
    evidenceAgainst: jobs.length ? ["Some role evidence exists, but it is still thin."] : [],
    confidence: jobs.length === 0 ? "high" : "medium",
    anchorCanDo: [
      `Search for current ${target} roles, teams, and hiring signals.`,
      "Cluster role archetypes and repeated requirements.",
      "Return a shortlist for approval without creating Jobs automatically.",
    ],
    userDecisionNeeded: existing ? "Review the existing discovery task or redirect the pathway." : "Approve Anchor-led discovery or redirect the pathway.",
    assumptions: [`${track.name} remains an active direction.`, "Public market evidence is the right next input before deeper capability diagnosis."],
    couldBeWrongIf: ["The user already has private role targets not saved in Anchor.", "The pathway is active in the database but no longer strategically live."],
    blocks: ["Market evidence", "Role archetype clustering", "Requirement extraction"],
    subblocks: ["current postings", "target organizations", "hiring signals", "repeated requirements", "approval shortlist"],
    nextAction: existing
      ? { label: "Review role discovery", owner: "mixed", actionType: "start_existing_task" }
      : { label: "Run role discovery", owner: "anchor", actionType: "run_discovery" },
    completionContract: null,
    evidenceProduced: ["ranked role targets", "repeated requirements", "source-backed market pattern"],
    score: 100 - jobs.length * 10,
  };
}

function strengthTranslationOpportunity(track: CareerTrack, input: ImprovementOpportunityInput): ImprovementOpportunity | null {
  if (!transferableProfileSignal(input.profile, track)) return null;
  const proof = proofAssetsForTrack(track, input.hustles, input.learn, input.tasks, input.wins);
  if (proof.count > 0) return null;
  const target = trackTarget(track);
  return {
    id: `strength_translation:${track.id}`,
    kind: "strength_translation",
    dimension: "evidence",
    label: `Translate existing experience into ${target} evidence`,
    trackId: track.id,
    trackName: track.name,
    whyNow: "The profile suggests transferable strategy, policy, consulting, delivery, or stakeholder experience, but Anchor cannot see a target-role proof artifact yet.",
    evidenceFor: ["Transferable experience is visible in profile or track-fit text.", "No proof asset or output-shaped evidence is linked to this active track."],
    evidenceAgainst: [],
    confidence: input.profile?.cvText || track.whyItFits ? "medium" : "low",
    anchorCanDo: ["Identify likely transferable examples from profile and track-fit text.", "Draft a proof-fragment prompt for the target role context.", "Suggest a small artifact before a large portfolio project."],
    userDecisionNeeded: "Approve the proof direction or choose a lighter example.",
    assumptions: ["Existing experience is real but not yet translated into this target context."],
    couldBeWrongIf: ["A relevant proof artifact exists outside Anchor.", "The user wants more domain exploration before evidence building."],
    blocks: ["Strength inventory", "Target-role translation", "Proof fragment"],
    subblocks: ["source experience", "target requirement", "transfer claim", "example", "artifact"],
    nextAction: { label: "Draft proof fragment", owner: "anchor", actionType: "draft_proof_fragment" },
    completionContract: null,
    evidenceProduced: ["target-role proof fragment", "interview story seed", "evidence gap closure"],
    score: 82,
  };
}

function kindForCompetence(kind: CompetenceKind, weakest?: ContributorKey): ImprovementOpportunityKind {
  if (kind === "domain") return "domain_judgement";
  if (kind === "professional") return "professional_capability";
  if (kind === "experience") return "role_context_experience";
  if (kind === "evidence") return "visible_evidence";
  if (weakest === "network" || weakest === "feedback") return "role_context_experience";
  return "professional_capability";
}

function dimensionForKind(kind: ImprovementOpportunityKind): ImprovementOpportunityDimension {
  if (kind === "domain_judgement") return "domain";
  if (kind === "professional_capability") return "professional";
  if (kind === "role_context_experience") return "experience";
  if (kind === "execution_capacity") return "stability";
  return "evidence";
}

function actionForKind(kind: ImprovementOpportunityKind): ImprovementOpportunity["nextAction"] {
  if (kind === "domain_judgement") return { label: "Create judgement exercise", owner: "anchor", actionType: "create_improvement_block" };
  if (kind === "professional_capability") return { label: "Create improvement block", owner: "anchor", actionType: "create_improvement_block" };
  if (kind === "role_context_experience") return { label: "Prepare role simulation", owner: "anchor", actionType: "run_role_simulation" };
  if (kind === "visible_evidence") return { label: "Draft proof fragment", owner: "anchor", actionType: "draft_proof_fragment" };
  return { label: "Answer one question", owner: "user", actionType: "answer_one_question" };
}

function competenceOpportunity(ecosystem: CompetenceEcosystem): ImprovementOpportunity | null {
  const weakest = ecosystem.weakestContributor;
  const target = weakest
    ? ecosystem.roleProfile.requiredCompetencies.find((item) => item.contributorKeys.includes(weakest.key))
    : ecosystem.roleProfile.requiredCompetencies[0];
  if (!target) return null;
  const kind = kindForCompetence(target.kind, weakest?.key);
  const experienceTitles = ecosystem.programSlice?.experiences.map((item) => item.title) || [];
  return {
    id: `${kind}:${ecosystem.trackId}:${target.key}`,
    kind,
    dimension: dimensionForKind(kind),
    label: target.name,
    trackId: ecosystem.trackId,
    trackName: ecosystem.trackName,
    whyNow: target.evidenceGap,
    evidenceFor: [
      `${ecosystem.trackName} is active.`,
      `${target.name} is ${target.importance} for the target standard.`,
      weakest ? `${weakest.label} is currently ${weakest.state}.` : "The competence ecosystem has an undersupplied requirement.",
    ],
    evidenceAgainst: target.currentLevel === "working" || target.currentLevel === "strong" ? [`Current maturity is already ${target.currentLevel}.`] : [],
    confidence: target.confidence,
    anchorCanDo: [
      "Turn the competence gap into one improvement block.",
      "Break the block into sub-capabilities and one smallest useful action.",
      "Attach completion evidence back to the competence model later.",
    ],
    userDecisionNeeded: target.confidence === "low" ? "Confirm this is the right improvement area or redirect." : "Approve this improvement block or choose a lighter version.",
    assumptions: [ecosystem.roleProfile.targetStandard, ecosystem.roleProfile.transferSummary],
    couldBeWrongIf: ["The role standard is based on stale or incomplete market evidence.", "The user has private evidence not yet stored in Anchor."],
    blocks: experienceTitles.length ? experienceTitles : [target.name],
    subblocks: target.subdomains,
    nextAction: actionForKind(kind),
    completionContract: null,
    evidenceProduced: target.evidenceRequired,
    score: kind === "visible_evidence" ? 76 : kind === "professional_capability" ? 74 : 72,
  };
}

function executionCapacityOpportunity(input: ImprovementOpportunityInput): ImprovementOpportunity | null {
  const slipping = input.tasks.filter((task) => !task.done && ((task.skipped || 0) >= 2 || task.readiness === "blocked" || task.blockerReason));
  if (!slipping.length) return null;
  return {
    id: "execution_capacity:today",
    kind: "execution_capacity",
    dimension: "stability",
    label: "Reduce execution load before adding more career work",
    whyNow: `${slipping.length} active task${slipping.length === 1 ? " is" : "s are"} repeatedly skipped or blocked, so the next lever may be load reduction rather than more planning.`,
    evidenceFor: slipping.slice(0, 3).map((task) => `${task.title} is ${task.readiness === "blocked" ? "blocked" : `skipped ${task.skipped} times`}.`),
    evidenceAgainst: [],
    confidence: slipping.length >= 2 ? "high" : "medium",
    anchorCanDo: ["Shrink or reshape blocked work.", "Surface one small user decision.", "Avoid adding new live tasks until the current load is clearer."],
    userDecisionNeeded: "Choose whether to shrink, park, or unblock the top slipping item.",
    assumptions: ["Repeated skips are a system signal, not a motivation judgement."],
    couldBeWrongIf: ["The skipped tasks are obsolete and should simply be stopped."],
    blocks: ["Load reduction", "Blocked-task triage"],
    subblocks: ["shrink", "park", "unblock", "stop"],
    nextAction: { label: "Answer one unblock question", owner: "user", actionType: "answer_one_question" },
    completionContract: null,
    evidenceProduced: ["execution capacity signal", "cleaner Today queue"],
    score: 62,
  };
}

function fallbackOpportunity(input: ImprovementOpportunityInput): ImprovementOpportunity {
  const hasTracks = activeTracks(input.tracks).length > 0;
  return {
    id: "fallback:direction_question",
    kind: hasTracks ? "domain_judgement" : "execution_capacity",
    dimension: hasTracks ? "domain" : "stability",
    label: hasTracks ? "Confirm the active improvement direction" : "Choose one active direction",
    whyNow: hasTracks ? "Anchor has active directions, but the evidence is not strong enough to choose a precise next lever." : "Anchor cannot infer a professional-success lever until at least one direction is active.",
    evidenceFor: hasTracks ? ["Active direction exists.", "No stronger opportunity outranked this fallback."] : ["No active direction exists."],
    evidenceAgainst: [],
    confidence: "low",
    anchorCanDo: ["Ask one focused question instead of a broad questionnaire."],
    userDecisionNeeded: hasTracks ? "Confirm the active path or redirect." : "Choose the direction Anchor should reason about first.",
    assumptions: ["The next ask should be as small as possible."],
    couldBeWrongIf: ["The user has a clear current priority outside Anchor."],
    blocks: ["Direction confirmation"],
    subblocks: ["continue", "redirect", "pause"],
    nextAction: { label: "Answer one direction question", owner: "user", actionType: "answer_one_question" },
    completionContract: null,
    evidenceProduced: ["direction confidence"],
    score: 10,
  };
}

function dedupe(items: ImprovementOpportunity[]) {
  const seen = new Set<string>();
  const result: ImprovementOpportunity[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.trackId || "global"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function buildImprovementOpportunityPayload(input: ImprovementOpportunityInput): ImprovementOpportunityPayload {
  const tracks = activeTracks(input.tracks);
  const ecosystems = buildCompetenceEcosystems(input).ecosystems;
  const byTrack = new Map<number, CompetenceEcosystem>(ecosystems.map((item) => [item.trackId, item]));
  const opportunities = dedupe([
    ...tracks.map((track) => marketEvidenceOpportunity(track, input)).filter((item): item is ImprovementOpportunity => !!item),
    ...tracks.map((track) => strengthTranslationOpportunity(track, input)).filter((item): item is ImprovementOpportunity => !!item),
    ...tracks.map((track) => byTrack.get(track.id)).filter((item): item is CompetenceEcosystem => !!item).map(competenceOpportunity).filter((item): item is ImprovementOpportunity => !!item),
    executionCapacityOpportunity(input),
  ].filter((item): item is ImprovementOpportunity => !!item))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const ranked = opportunities.length ? opportunities : [fallbackOpportunity(input)];
  const primary = ranked[0];

  return {
    readOnly: true,
    generatedAt: Date.now(),
    primaryOpportunity: primary,
    opportunities: ranked.slice(0, 6),
    assumptions: [
      "Anchor should infer from existing state before asking the user for input.",
      "This endpoint is read-only and must not create tasks or strategic objects.",
      "Low-confidence cases should ask one focused question rather than a broad intake form.",
    ],
    summary: `Primary opportunity: ${primary.label}.`,
    trace: [
      `Read ${tracks.length} active career direction${tracks.length === 1 ? "" : "s"}.`,
      `Built ${ecosystems.length} competence ecosystem snapshot${ecosystems.length === 1 ? "" : "s"}.`,
      `Ranked ${ranked.length} improvement opportunit${ranked.length === 1 ? "y" : "ies"}.`,
    ],
  };
}
