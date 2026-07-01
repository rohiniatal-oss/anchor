import type { CareerTrack, Job, Task } from "@shared/schema";
import { extractSearchDiscoveryTarget } from "@shared/captureResearch";
import { collectTaskBreakdownContext } from "./contextProviders";
import type { ContextBlock, TaskContextProviderInput } from "./contextProviders/types";
import { buildRankedDiscoveryOptions, type RankedDiscoveryOption } from "./discoveryOptions";
import { storage } from "./storage";

export const PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS = "role_discovery_needed";
export const PATHWAY_ROLE_DISCOVERY_PLAN_SOURCE = "pathway_discovery";

export type PathwayRoleDiscoveryStatus =
  | "not_needed"
  | "running"
  | "complete"
  | "stuck_needs_question"
  | "failed_retryable";

export type PathwayRoleDiscoverySnapshot = {
  status: PathwayRoleDiscoveryStatus;
  trackId: number;
  trackName: string;
  targetRoleArchetype: string;
  query: string;
  generatedAt: number;
  roles: Array<{
    title: string;
    organization?: string;
    sourceUrl?: string;
    sourceDomain?: string;
    confidence: "low" | "medium" | "high";
    whyRelevant: string;
  }>;
  repeatedRequirements: string[];
  inferredOpportunity?: {
    kind: "market_evidence" | "domain_judgement" | "professional_capability" | "visible_evidence" | "strength_translation";
    label: string;
    rationale: string;
    nextAction: string;
  };
  stuckQuestion?: {
    question: string;
    options: string[];
  };
  evidenceStatus?: string;
  evidenceProvider?: string;
  evidenceQuery?: string;
  error?: string;
};

export type PathwayRoleDiscoveryEnsureResult = {
  tasks: Task[];
  discoveries: PathwayRoleDiscoverySnapshot[];
};

const FRESH_DISCOVERY_MS = 12 * 60 * 60 * 1000;

function norm(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function targetFor(track: CareerTrack) {
  return String(track.targetRoleArchetype || track.name || "this pathway").trim();
}

function belongsToTrack(track: CareerTrack, text: string, relatedTrackId?: number | null) {
  if (relatedTrackId && relatedTrackId === track.id) return true;
  const hay = norm(text);
  return [track.name, track.targetRoleArchetype, track.slug]
    .filter(Boolean)
    .map(norm)
    .some((key) => key.split(" ").filter((word) => word.length > 3).some((word) => hay.includes(word)));
}

export function liveJobsForPathway(track: CareerTrack, jobs: Job[]) {
  return jobs.filter((job) =>
    job.status !== "closed"
    && belongsToTrack(track, `${job.title} ${job.company} ${job.roleArchetype} ${job.narrativeAngle} ${job.note}`, job.relatedTrackId),
  );
}

function existingDiscoveryTask(track: CareerTrack, tasks: Task[]) {
  return tasks.find((task) =>
    !task.done
    && task.sourceType === "career_track"
    && task.relatedTrackId === track.id
    && task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS,
  ) || null;
}

export function isPathwayRoleDiscoveryTask(task: Pick<Task, "sourceType" | "sourceStepType" | "sourceStatus" | "title">) {
  return task.sourceStatus === PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS
    || task.sourceStepType === "role_discovery"
    || (task.sourceType === "career_track" && /have anchor discover real .+ role targets/i.test(task.title || ""));
}

function parseTrackIntelligence(raw: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function roleDiscoveryForTrack(track: CareerTrack): PathwayRoleDiscoverySnapshot | null {
  const intelligence = parseTrackIntelligence(track.trackIntelligence);
  const snapshot = intelligence.roleDiscovery;
  if (!snapshot || typeof snapshot !== "object") return null;
  if (snapshot.trackId !== track.id) return null;
  return snapshot as PathwayRoleDiscoverySnapshot;
}

function freshEnough(snapshot: PathwayRoleDiscoverySnapshot | null, now = Date.now()) {
  if (!snapshot) return false;
  if (snapshot.status !== "complete" && snapshot.status !== "stuck_needs_question") return false;
  if (!snapshot.generatedAt || now - snapshot.generatedAt > FRESH_DISCOVERY_MS) return false;
  return snapshot.status === "stuck_needs_question" || snapshot.roles.length > 0;
}

function evidenceFromBlock(block: ContextBlock) {
  return {
    title: String(block.sourceTitle || block.label || "Public source"),
    snippet: String(block.text || ""),
    url: String(block.sourceUrl || ""),
    domain: String(block.sourceDomain || ""),
    date: String(block.sourceDate || ""),
    citationId: String(block.metadata?.citationId || ""),
  };
}

function organizationFor(option: RankedDiscoveryOption) {
  return option.sourceDomain || (() => {
    try { return new URL(option.sourceUrl || "").hostname.replace(/^www\./, ""); } catch { return ""; }
  })();
}

function unique(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items.map((value) => String(value || "").trim()).filter(Boolean)) {
    const key = norm(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function inferredRequirements(target: string, options: RankedDiscoveryOption[]) {
  const text = norm(options.map((option) => `${option.title} ${option.whyRelevant} ${option.nextAction}`).join(" "));
  const requirements: string[] = [];
  if (/governance|risk|policy|regulat|compliance|responsible/.test(text)) {
    requirements.push(`${target} domain judgement across governance, risk, policy, and regulation`);
  }
  if (/executive|senior|stakeholder|communicat|brief|translate|advis/.test(text)) {
    requirements.push("senior-stakeholder communication and decision translation");
  }
  if (/implement|operat|delivery|program|project|product|change/.test(text)) {
    requirements.push("implementation and operating experience");
  }
  if (/strategy|strategic|roadmap|prioriti|trade|decision/.test(text)) {
    requirements.push("strategic problem solving and prioritisation");
  }
  if (/evidence|portfolio|case|memo|brief|experience|track record/.test(text)) {
    requirements.push("visible evidence that the capability is real in this target context");
  }
  return unique(requirements).slice(0, 5);
}

function inferredOpportunity(target: string, repeatedRequirements: string[]): PathwayRoleDiscoverySnapshot["inferredOpportunity"] {
  const text = norm(repeatedRequirements.join(" "));
  if (/visible evidence|portfolio|case|memo|brief/.test(text)) {
    return {
      kind: "visible_evidence",
      label: `Turn transferable experience into ${target} proof`,
      rationale: `The public role evidence points to a visible-evidence bar, not just more browsing. Anchor should translate existing experience into target-role proof.`,
      nextAction: `Draft one small ${target} proof fragment from an existing strategy, policy, or delivery example.`,
    };
  }
  if (/senior stakeholder|communication|translation/.test(text)) {
    return {
      kind: "professional_capability",
      label: `Executive communication for ${target} trade-offs`,
      rationale: `The role evidence points to translation and senior-facing judgement as a professional operating lever.`,
      nextAction: `Create one executive-style brief explaining a ${target} trade-off and recommendation.`,
    };
  }
  if (/domain judgement|governance|risk|regulation/.test(text)) {
    return {
      kind: "domain_judgement",
      label: `${target} domain judgement`,
      rationale: `The evidence suggests Anchor should strengthen judgement in the target domain before pushing harder.`,
      nextAction: `Apply one governance or risk framework to a current case and write the decision logic.`,
    };
  }
  return {
    kind: "market_evidence",
    label: `Map ${target} role patterns`,
    rationale: `Anchor has enough public signals to start comparing role patterns, but should continue using them as evidence rather than asking for manual job hunting.`,
    nextAction: `Use the discovered market pattern to choose the smallest next improvement move.`,
  };
}

function stuckQuestion(target: string): PathwayRoleDiscoverySnapshot["stuckQuestion"] {
  return {
    question: `I could not get enough reliable public evidence for ${target}. Should I narrow the search?`,
    options: [
      "Strategy and policy only",
      "Include implementation roles",
      "Pause this path for now",
    ],
  };
}

async function persistRoleDiscovery(track: CareerTrack, snapshot: PathwayRoleDiscoverySnapshot) {
  const current = parseTrackIntelligence(track.trackIntelligence);
  await storage.updateCareerTrack(track.id, {
    trackIntelligence: JSON.stringify({ ...current, roleDiscovery: snapshot }),
  } as any);
}

export async function runPathwayRoleDiscovery(track: CareerTrack, opts: {
  mockMode?: TaskContextProviderInput["mockMode"];
  force?: boolean;
  now?: number;
} = {}): Promise<PathwayRoleDiscoverySnapshot> {
  const now = opts.now ?? Date.now();
  const target = targetFor(track);
  const queryTitle = `discover current ${target} roles, teams, hiring signals, and repeated requirements`;
  const running: PathwayRoleDiscoverySnapshot = {
    status: "running",
    trackId: track.id,
    trackName: track.name,
    targetRoleArchetype: target,
    query: extractSearchDiscoveryTarget(queryTitle) || queryTitle,
    generatedAt: now,
    roles: [],
    repeatedRequirements: [],
  };
  await persistRoleDiscovery(track, running);

  try {
    const collected = await collectTaskBreakdownContext({
      task: {
        title: queryTitle,
        category: "job",
        doneWhen: "Current role targets and repeated requirements are discovered from public evidence.",
        minimumOutcome: "Anchor has enough market evidence to choose the next improvement move.",
        sourceUrl: "",
        sourceNote: [track.description, track.whyItFits].filter(Boolean).join(" "),
        sourceType: "career_track",
      },
      sourceBundle: {
        sourceContext: [track.description, track.whyItFits].filter(Boolean).join(" "),
        playbook: "Anchor-owned pathway role discovery. Do not ask the user to manually hunt for roles.",
        sourceKind: "task",
        source: {
          title: track.name,
          targetRoleArchetype: target,
        },
        parentContext: "",
      },
      userAuthoredContext: "",
      mockMode: opts.mockMode,
      now,
    });
    const evidence = (collected.blocks.externalResearch || []).map(evidenceFromBlock);
    const ranked = buildRankedDiscoveryOptions({ title: queryTitle, evidence });
    const roles = ranked.options.map((option) => ({
      title: option.title,
      organization: organizationFor(option),
      sourceUrl: option.sourceUrl,
      sourceDomain: option.sourceDomain,
      confidence: option.confidence,
      whyRelevant: option.whyRelevant,
    }));
    const repeatedRequirements = inferredRequirements(target, ranked.options);
    const complete = roles.length > 0;
    const snapshot: PathwayRoleDiscoverySnapshot = complete
      ? {
          status: "complete",
          trackId: track.id,
          trackName: track.name,
          targetRoleArchetype: target,
          query: collected.externalResearch.debug?.query || running.query,
          generatedAt: now,
          roles,
          repeatedRequirements: repeatedRequirements.length
            ? repeatedRequirements
            : [`current ${target} role pattern evidence`],
          inferredOpportunity: inferredOpportunity(target, repeatedRequirements),
          evidenceStatus: collected.externalResearch.status,
          evidenceProvider: collected.externalResearch.provider,
          evidenceQuery: collected.externalResearch.debug?.query || running.query,
        }
      : {
          status: "stuck_needs_question",
          trackId: track.id,
          trackName: track.name,
          targetRoleArchetype: target,
          query: collected.externalResearch.debug?.query || running.query,
          generatedAt: now,
          roles: [],
          repeatedRequirements: [],
          stuckQuestion: stuckQuestion(target),
          evidenceStatus: collected.externalResearch.status,
          evidenceProvider: collected.externalResearch.provider,
          evidenceQuery: collected.externalResearch.debug?.query || running.query,
        };
    await persistRoleDiscovery(track, snapshot);
    return snapshot;
  } catch (error) {
    const snapshot: PathwayRoleDiscoverySnapshot = {
      status: "failed_retryable",
      trackId: track.id,
      trackName: track.name,
      targetRoleArchetype: target,
      query: running.query,
      generatedAt: now,
      roles: [],
      repeatedRequirements: [],
      stuckQuestion: stuckQuestion(target),
      error: error instanceof Error ? error.message : "unknown_error",
    };
    await persistRoleDiscovery(track, snapshot);
    return snapshot;
  }
}

export function pathwayRoleDiscoveryTaskDraft(track: CareerTrack) {
  const target = targetFor(track);
  return {
    title: `Have Anchor discover real ${target} role targets`,
    list: "today",
    block: null,
    done: false,
    pinned: false,
    steps: JSON.stringify([
      { text: `Let Anchor search for current ${target} roles, teams, and hiring signals`, done: false },
      { text: "Review the ranked options and reject anything stale, generic, or irrelevant", done: false },
      { text: "Activate only the option you actually want to pursue; Anchor can then save it as a Job with source evidence", done: false },
    ]),
    sort: 0,
    category: "job",
    size: "medium",
    status: "not_started",
    skipped: 0,
    doneWhen: "At least three current role targets or target organizations are ranked from public evidence; only user-approved options become Jobs.",
    sourceType: "career_track",
    sourceId: track.id,
    sourceStepType: "role_discovery",
    sourceStepId: 1,
    sourceUrl: "",
    sourceNote: JSON.stringify({
      reason: "Legacy task shell. Pathway role discovery should now run as Anchor-owned internal evidence, not as a user-managed task.",
      trackId: track.id,
      trackName: track.name,
      targetRoleArchetype: track.targetRoleArchetype || "",
    }),
    sourceStatus: PATHWAY_ROLE_DISCOVERY_SOURCE_STATUS,
    relatedTrackId: track.id,
    minimumOutcome: "Anchor has an evidence-backed shortlist of real role targets to review or reject.",
    estimateMinutes: 25,
    estimateConfidence: "medium",
    estimateReason: "pathway_role_discovery",
    readiness: "ready",
  };
}

export async function ensurePathwayRoleDiscoveryRuns(input: {
  tasks: Task[];
  jobs: Job[];
  tracks: CareerTrack[];
  mockMode?: TaskContextProviderInput["mockMode"];
  force?: boolean;
  now?: number;
}): Promise<PathwayRoleDiscoveryEnsureResult> {
  const discoveries: PathwayRoleDiscoverySnapshot[] = [];
  const now = input.now ?? Date.now();
  for (const track of input.tracks.filter((item) => item.status === "active")) {
    const jobs = liveJobsForPathway(track, input.jobs);
    if (jobs.length >= 3) continue;

    const current = roleDiscoveryForTrack(track);
    if (!input.force && freshEnough(current, now)) {
      discoveries.push(current!);
      continue;
    }

    discoveries.push(await runPathwayRoleDiscovery(track, {
      mockMode: input.mockMode,
      force: input.force,
      now,
    }));
  }

  // Legacy cleanup happens in the UI and start/complete surfaces. We deliberately
  // return the original task list here: discovery is internal evidence, not a
  // Today task the user has to manage.
  return { tasks: input.tasks, discoveries };
}

/**
 * Backward-compatible shim for older callers. New planning code should call
 * ensurePathwayRoleDiscoveryRuns so it can consume the internal discovery state.
 */
export async function ensurePathwayRoleDiscoveryTasks(input: {
  tasks: Task[];
  jobs: Job[];
  tracks: CareerTrack[];
}): Promise<Task[]> {
  await ensurePathwayRoleDiscoveryRuns(input);
  return input.tasks;
}

export async function parkLegacyPathwayRoleDiscoveryTask(task: Task) {
  if (!isPathwayRoleDiscoveryTask(task)) return task;
  return await storage.updateTask(task.id, {
    pinned: false,
    list: "inbox",
    status: "not_started",
  } as any) || task;
}
