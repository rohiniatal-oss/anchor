import type { Express } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { careerAssetsFromActivity, generateCandidateUniverse, attributeFeedbackFromActivity } from "./candidates";
import { enrichTaskInput } from "./sprint2";

type DiscoveryDomain = "career" | "health" | "writing" | "admin" | "relationships" | "life";
type DiscoveryStatus = "draft" | "committed" | "abandoned";

type DiscoveryRouteKey =
  | "broad-role-pursuit"
  | "fit-clarification"
  | "warm-path-build"
  | "capability-ramp"
  | "clarify-outcome"
  | "reduce-friction"
  | "start-small-routine";

type WorkingGoalDraft = {
  title: string;
  whyNow: string;
  desiredOutcome: string;
  timeHorizon: string;
  successCondition: string;
  uncertainty: string[];
  firstDecisionNeeded: string;
};

type DiscoveryRoute = {
  key: DiscoveryRouteKey;
  label: string;
  why: string;
};

type DiscoveryAction = {
  title: string;
  doneWhen: string;
  firstStep: string;
  category: string;
  size?: "quick" | "medium" | "deep";
};

type DiscoveryRoutePreview = {
  tinyNextAction: DiscoveryAction;
  supportAction: DiscoveryAction | null;
};

type DiscoveryTrackDraft = {
  name: string;
  slug: string;
  description: string;
  targetRoleArchetype: string;
  whyItFits: string;
  priority: number;
};

type DiscoveryPayload = {
  domain: DiscoveryDomain;
  concern: string;
  workingGoalDraft: WorkingGoalDraft;
  knowns: string[];
  unknowns: string[];
  assumptions: string[];
  routes: DiscoveryRoute[];
  recommendedRoute: {
    key: DiscoveryRouteKey;
    reason: string;
  };
  routePreviews: Partial<Record<DiscoveryRouteKey, DiscoveryRoutePreview>>;
  tinyNextAction: DiscoveryAction;
  supportAction: DiscoveryAction | null;
  trackDrafts: DiscoveryTrackDraft[];
  needsUserAnswer: Array<{ key: string; question: string }>;
};

const DISCOVERY_DOMAINS = ["career", "health", "writing", "admin", "relationships", "life"] as const;

const startDiscoverySchema = z.object({
  concern: z.string().trim().min(3).max(600),
  domain: z.enum(DISCOVERY_DOMAINS).optional(),
  context: z.object({
    energy: z.enum(["low", "medium", "high"]).optional(),
    timeHorizon: z.string().trim().min(1).max(80).optional(),
  }).partial().optional(),
});

const commitDiscoverySchema = z.object({
  routeKey: z.string().trim().min(1).max(80).optional(),
  edits: z.object({
    title: z.string().trim().min(1).max(200).optional(),
  }).partial().optional(),
  answers: z.record(z.string(), z.string()).optional(),
});

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw || "");
    return parsed as T;
  } catch {
    return fallback;
  }
}

function norm(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(value: string) {
  return norm(value).replace(/\s+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferDomain(concern: string, explicit?: DiscoveryDomain): DiscoveryDomain {
  if (explicit) return explicit;
  const text = concern.toLowerCase();
  if (containsAny(text, [/\b(job|career|role|interview|cv|resume|network|linkedin|application)\b/])) return "career";
  if (containsAny(text, [/\b(health|sleep|exercise|gym|diet|meal|walk|wellbeing)\b/])) return "health";
  if (containsAny(text, [/\b(write|writing|article|essay|memo|substack|publish)\b/])) return "writing";
  if (containsAny(text, [/\b(admin|paperwork|forms|tax|inbox|organise|organize)\b/])) return "admin";
  if (containsAny(text, [/\b(friend|relationship|dating|family|partner)\b/])) return "relationships";
  return "life";
}

function careerRouteSet(concern: string, candidateLanes: string[]): DiscoveryRoute[] {
  const broadLabel = candidateLanes.length
    ? "Turn plausible lanes into live roles"
    : "Turn one plausible lane into a live role";
  return [
    {
      key: "broad-role-pursuit",
      label: broadLabel,
      why: "Best when the market can provide signal quickly and landing a role soon matters.",
    },
    {
      key: "fit-clarification",
      label: "Clarify role families before going wider",
      why: "Best when the role target is still too vague for useful applications.",
    },
    {
      key: "warm-path-build",
      label: "Build a warm-path pipeline",
      why: "Best when access, referrals, or insider context are the main bottleneck.",
    },
    {
      key: "capability-ramp",
      label: "Strengthen one repeated capability signal",
      why: "Best when the likely roles are real but one recurring capability gap is holding you back.",
    },
  ];
}

function genericRouteSet(domain: DiscoveryDomain): DiscoveryRoute[] {
  return [
    {
      key: "clarify-outcome",
      label: `Clarify the next useful ${domain} outcome`,
      why: "Best when the real problem is still fuzzy and you need a working direction before planning.",
    },
    {
      key: "reduce-friction",
      label: "Remove one visible source of friction",
      why: "Best when the next move is blocked by clutter, uncertainty, or setup overhead.",
    },
    {
      key: "start-small-routine",
      label: "Create one repeatable tiny action",
      why: "Best when consistency matters more than one heroic push.",
    },
  ];
}

function chooseCareerRoute(concern: string): { key: DiscoveryRouteKey; reason: string } {
  const text = concern.toLowerCase();
  const urgentJob = containsAny(text, [/\b(job|need work|need a role|income|employment)\b/]);
  const networking = containsAny(text, [/\b(network|referral|reach out|contact|linkedin|intro)\b/]);
  const capability = containsAny(text, [/\b(interview|cv|resume|skill|skills|upskill|prepare)\b/]);
  const uncertainty = containsAny(text, [/\b(don'?t know|do not know|figure out|sort out|stuck|unclear|what kind)\b/]);
  if (networking) {
    return { key: "warm-path-build", reason: "You are already thinking about people and access, so the fastest next signal is to build a warm path instead of staying abstract." };
  }
  if (capability && !urgentJob) {
    return { key: "capability-ramp", reason: "Your concern is mainly about readiness, so the cleanest first move is to strengthen one signal you need to show clearly." };
  }
  if (urgentJob) {
    return { key: "broad-role-pursuit", reason: "You need a credible role soon, so the best next signal is to put real roles into the plausible lanes before narrowing too early." };
  }
  if (uncertainty) {
    return { key: "fit-clarification", reason: "The target is still fuzzy enough that clarifying the role families will create better signal than going wide immediately." };
  }
  return { key: "broad-role-pursuit", reason: "A few live roles will teach you more than another round of abstract comparison." };
}

function chooseGenericRoute(domain: DiscoveryDomain, concern: string): { key: DiscoveryRouteKey; reason: string } {
  const text = concern.toLowerCase();
  if (containsAny(text, [/\b(stuck|overwhelmed|mess|chaos|behind)\b/])) {
    return { key: "reduce-friction", reason: "The concern sounds blocked by friction, so the best first move is to remove one obvious blocker." };
  }
  if (containsAny(text, [/\b(habit|routine|consistent|every day|daily)\b/])) {
    return { key: "start-small-routine", reason: "The concern sounds consistency-shaped, so one tiny repeatable action is the cleanest route." };
  }
  return { key: "clarify-outcome", reason: `The ${domain} concern is still broad, so the first useful move is to turn it into a concrete working outcome.` };
}

function genericActions(domain: DiscoveryDomain, routeKey: DiscoveryRouteKey): { tiny: DiscoveryAction; support: DiscoveryAction | null } {
  if (routeKey === "reduce-friction") {
    return {
      tiny: {
        title: `Remove one source of ${domain} friction`,
        doneWhen: "One specific blocker is removed or reduced",
        firstStep: "Write down the single thing making this harder than it needs to be, then remove the smallest part of it.",
        category: domain === "health" ? "health" : "admin",
        size: "quick",
      },
      support: null,
    };
  }
  if (routeKey === "start-small-routine") {
    return {
      tiny: {
        title: `Define one tiny repeatable ${domain} action`,
        doneWhen: "A 5-15 minute recurring action is chosen",
        firstStep: "Pick the smallest version of this that still counts and write when you will do it next.",
        category: domain === "writing" ? "substack" : domain === "health" ? "health" : "admin",
        size: "quick",
      },
      support: null,
    };
  }
  return {
    tiny: {
      title: `Clarify the next useful ${domain} outcome`,
      doneWhen: "One working outcome is named clearly enough to act on",
      firstStep: "Write one sentence: what would 'better in the next 2 weeks' look like here?",
      category: "admin",
      size: "quick",
    },
    support: null,
  };
}

function genericRoutePreviews(domain: DiscoveryDomain): Partial<Record<DiscoveryRouteKey, DiscoveryRoutePreview>> {
  return {
    "clarify-outcome": {
      tinyNextAction: genericActions(domain, "clarify-outcome").tiny,
      supportAction: genericActions(domain, "clarify-outcome").support,
    },
    "reduce-friction": {
      tinyNextAction: genericActions(domain, "reduce-friction").tiny,
      supportAction: genericActions(domain, "reduce-friction").support,
    },
    "start-small-routine": {
      tinyNextAction: genericActions(domain, "start-small-routine").tiny,
      supportAction: genericActions(domain, "start-small-routine").support,
    },
  };
}

type ConcernTrackSeed = {
  key: string;
  name: string;
  targetRoleArchetype: string;
  whyItFits: string;
  patterns: RegExp[];
  priority: number;
  broad?: boolean;
};

const CONCERN_TRACK_SEEDS: ConcernTrackSeed[] = [
  {
    key: "ai-strategy",
    name: "AI strategy, governance, and policy",
    targetRoleArchetype: "AI strategy / governance",
    whyItFits: "You explicitly mentioned AI strategy, so Anchor should keep this lane visible while you test real roles.",
    patterns: [/\bai strategy\b/, /\bai governance\b/, /\bartificial intelligence\b/, /\bfrontier ai\b/, /\bai policy\b/],
    priority: 80,
  },
  {
    key: "geopolitics",
    name: "Geopolitics and strategic advisory",
    targetRoleArchetype: "geopolitical advisory / strategy",
    whyItFits: "You explicitly mentioned geopolitics, so this should stay live as a real lane rather than getting folded into a generic strategy bucket.",
    patterns: [/\bgeopolitic/, /\bgeopolitical\b/, /\bforeign policy\b/, /\bpolicy advisory\b/, /\bstrategic advisory\b/],
    priority: 76,
  },
  {
    key: "chief-of-staff",
    name: "Chief of staff and strategic operations",
    targetRoleArchetype: "chief of staff / strategic operations",
    whyItFits: "You explicitly mentioned chief of staff, so Anchor should keep an operating lane in play rather than treating everything as pure advisory work.",
    patterns: [/\bchief of staff\b/, /\bcos\b/, /\bstrategy and operations\b/, /\bstrategic operations\b/, /\boperations\b/],
    priority: 72,
  },
  {
    key: "strategy",
    name: "General strategy and advisory",
    targetRoleArchetype: "strategy / advisory",
    whyItFits: "You mentioned strategy work broadly, so a general strategy lane is still worth keeping live if no more specific lane is already doing that job.",
    patterns: [/\bstrategy\b/, /\badvisory\b/, /\bstrategist\b/],
    priority: 68,
    broad: true,
  },
  {
    key: "philanthropy-development",
    name: "Global development and philanthropy strategy",
    targetRoleArchetype: "development / philanthropy strategy",
    whyItFits: "You mentioned development or philanthropy-adjacent work, so Anchor should preserve that as an explicit option if it matters here.",
    patterns: [/\bphilanthropy\b/, /\bdevelopment\b/, /\bglobal development\b/, /\bfoundation\b/],
    priority: 60,
  },
];

function inferConcernTrackDrafts(concern: string): DiscoveryTrackDraft[] {
  const text = concern.toLowerCase();
  const matchedSeeds = CONCERN_TRACK_SEEDS
    .filter((seed) => seed.patterns.some((pattern) => pattern.test(text)));
  const hasSpecificMatch = matchedSeeds.some((seed) => !seed.broad);
  const matched = matchedSeeds
    .filter((seed) => !(hasSpecificMatch && seed.broad))
    .map((seed) => ({
      name: seed.name,
      slug: slug(seed.name),
      description: seed.whyItFits,
      targetRoleArchetype: seed.targetRoleArchetype,
      whyItFits: seed.whyItFits,
      priority: seed.priority,
    }));
  const byKey = new Map<string, DiscoveryTrackDraft>();
  for (const draft of matched) {
    const key = norm(draft.name);
    if (!byKey.has(key)) byKey.set(key, draft);
  }
  return [...byKey.values()];
}

function mergeTrackDrafts(args: {
  concern: string;
  candidateDirections: Array<{ name: string; whyPlausible: string; roleSearches: string[] }>;
  limit?: number;
}) {
  const limit = args.limit ?? 3;
  const concernDrafts = inferConcernTrackDrafts(args.concern);
  const candidateDrafts = args.candidateDirections.map((direction, index) => ({
    name: direction.name,
    slug: slug(direction.name),
    description: direction.whyPlausible,
    targetRoleArchetype: direction.roleSearches[0] || direction.name,
    whyItFits: direction.whyPlausible,
    priority: index === 0 ? 70 : 55,
  }));
  const merged = [];
  const seen = new Set<string>();
  for (const draft of [...concernDrafts, ...candidateDrafts]) {
    const key = norm(draft.name);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(draft);
    if (merged.length >= limit) break;
  }
  return merged;
}

function roleSearchPreview(trackDrafts: DiscoveryTrackDraft[]) {
  const names = trackDrafts.map((track) => track.targetRoleArchetype || track.name).filter(Boolean);
  if (names.length === 0) return "one plausible role family";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]}, and ${names[2]}`;
}

function careerRoutePreviews(trackDrafts: DiscoveryTrackDraft[], laneNames: string[]): Partial<Record<DiscoveryRouteKey, DiscoveryRoutePreview>> {
  const searchPreview = roleSearchPreview(trackDrafts.slice(0, 3));
  return {
    "fit-clarification": {
      tinyNextAction: {
        title: "Inspect one plausible role family and capture one useful signal",
        doneWhen: "One role family feels more credible, energising, or clearly wrong",
        firstStep: `Open one role search for ${trackDrafts[0]?.targetRoleArchetype || "a plausible role family"} and note one thing that feels credible or draining.`,
        category: "job",
        size: "quick",
      },
      supportAction: {
        title: "Write one working direction sentence from real experience",
        doneWhen: "One rough direction sentence exists",
        firstStep: "Write one sentence that connects your strongest experience to the kind of work you may want next.",
        category: "job",
        size: "quick",
      },
    },
    "warm-path-build": {
      tinyNextAction: {
        title: "Find one warm contact path into a plausible role lane",
        doneWhen: "One real person or network path is identified",
        firstStep: `Look for one person linked to ${trackDrafts[0]?.name || "your most plausible lane"} who could reality-check or unblock access.`,
        category: "job",
        size: "quick",
      },
      supportAction: {
        title: "Draft one short outreach ask",
        doneWhen: "One message outline exists",
        firstStep: "Write a 3-sentence ask focused on advice or role reality-check, not a broad life story.",
        category: "admin",
        size: "quick",
      },
    },
    "capability-ramp": {
      tinyNextAction: {
        title: "Identify one repeated capability signal to strengthen",
        doneWhen: "One capability gap is named clearly enough to work on",
        firstStep: "Open one plausible role and highlight the requirement you least clearly prove today.",
        category: "learning",
        size: "quick",
      },
      supportAction: {
        title: "Choose one support item that could strengthen that signal",
        doneWhen: "One concrete learning or work-sample move is chosen",
        firstStep: "Pick the smallest support move that could improve the signal within a week.",
        category: "learning",
        size: "quick",
      },
    },
    "broad-role-pursuit": {
      tinyNextAction: {
        title: laneNames.length > 1 ? "Save one credible role in each plausible lane" : "Save one credible role that looks real right now",
        doneWhen: laneNames.length > 1 ? "At least one real role exists in each plausible lane" : "One real role is saved with a note on why it is plausible",
        firstStep: laneNames.length > 1
          ? `Open your job sources and save one credible role for ${searchPreview}.`
          : `Search for ${trackDrafts[0]?.targetRoleArchetype || "one plausible role"} and save the first role that feels credible enough to inspect.`,
        category: "job",
        size: laneNames.length > 1 ? "deep" : "quick",
      },
      supportAction: {
        title: "Note what each saved role suggests about fit and urgency",
        doneWhen: "Each saved role has one sentence on why it is credible or unclear",
        firstStep: "For each role you save, write one line: credible, energising, unclear, or needs support.",
        category: "job",
        size: "quick",
      },
    },
  };
}

async function buildDiscoveryPayload(input: z.infer<typeof startDiscoverySchema>): Promise<DiscoveryPayload> {
  const concern = input.concern.trim();
  const domain = inferDomain(concern, input.domain);
  const timeHorizon = input.context?.timeHorizon?.trim() || (domain === "career" ? "6-8 weeks" : "2 weeks");

  if (domain !== "career") {
    const recommendedRoute = chooseGenericRoute(domain, concern);
    const routes = genericRouteSet(domain);
    const routePreviews = genericRoutePreviews(domain);
    const selectedPreview = routePreviews[recommendedRoute.key]!;
    return {
      domain,
      concern,
      workingGoalDraft: {
        title: `Make ${domain} feel clearer and more manageable`,
        whyNow: "The concern is active enough that waiting is keeping ambiguity alive.",
        desiredOutcome: `A clear next ${domain} direction with one action already moving`,
        timeHorizon,
        successCondition: `One practical ${domain} move is underway and the situation feels less vague`,
        uncertainty: [
          "What the most useful outcome really is",
          "Which action would reduce ambiguity fastest",
        ],
        firstDecisionNeeded: "Whether to clarify the outcome first or reduce friction first",
      },
      knowns: [`The user is carrying an open ${domain} concern.`],
      unknowns: [
        `What specific ${domain} outcome matters most right now`,
        "What would make the biggest practical difference first",
      ],
      assumptions: ["The user does not need a full plan before taking the first useful step."],
      routes,
      recommendedRoute,
      routePreviews,
      tinyNextAction: selectedPreview.tinyNextAction,
      supportAction: selectedPreview.supportAction,
      trackDrafts: [],
      needsUserAnswer: [],
    };
  }

  const [tasks, jobs, log, tracks] = await Promise.all([
    storage.getTasks(),
    storage.getJobs(),
    storage.getActivityLog(),
    storage.getCareerTracks(),
  ]);
  const candidateUniverse = generateCandidateUniverse(tasks, jobs, careerAssetsFromActivity(log), attributeFeedbackFromActivity(log), tracks);
  const concernTrackDrafts = inferConcernTrackDrafts(concern);
  const trackDrafts = mergeTrackDrafts({
    concern,
    candidateDirections: candidateUniverse.directions.slice(0, 4).map((direction) => ({
      name: direction.name,
      whyPlausible: direction.whyPlausible,
      roleSearches: direction.roleSearches,
    })),
    limit: 3,
  });
  const laneNames = trackDrafts.map((d) => d.name);
  const recommendedRoute = chooseCareerRoute(concern);
  const routes = careerRouteSet(concern, laneNames);
  const existingSignals = [
    tracks.length > 0 ? `${tracks.length} active track${tracks.length === 1 ? "" : "s"}` : "",
    jobs.length > 0 ? `${jobs.length} saved role${jobs.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const routePreviews = careerRoutePreviews(trackDrafts, laneNames);
  const selectedPreview = routePreviews[recommendedRoute.key]!;

  return {
    domain,
    concern,
    workingGoalDraft: {
      title: "Land a credible next role while narrowing the right lane",
      whyNow: "You need movement on work and direction without waiting for perfect certainty.",
      desiredOutcome: "A live role pipeline with clearer signal about which lane is most plausible",
      timeHorizon,
      successCondition: "At least one credible role process is moving and the best lane is clearer from real evidence",
      uncertainty: [
        "Which role family is the strongest fit",
        "Which lane is most gettable soon",
      ],
      firstDecisionNeeded: "Whether to create market signal through live roles first or clarify fit first",
    },
    knowns: [
      "The user wants career movement, not just reflection.",
      ...(concernTrackDrafts.length > 0
        ? [`You explicitly named these lanes: ${concernTrackDrafts.map((draft) => draft.name).join("; ")}.`]
        : []),
      ...(existingSignals.length ? existingSignals : ["Existing pipeline signal is still thin."]),
    ],
    unknowns: [
      "Which role family is strongest in fit and realism",
      "Which path can land soonest without feeling wrong",
    ],
    assumptions: [
      "A working direction is enough; perfect certainty is not required before acting.",
      "Real market signal is more useful than abstract overthinking at this stage.",
    ],
    routes,
    recommendedRoute,
    routePreviews,
    tinyNextAction: selectedPreview.tinyNextAction,
    supportAction: selectedPreview.supportAction,
    trackDrafts,
    needsUserAnswer: concern.toLowerCase().includes("job")
      ? [{ key: "location-flexibility", question: "Where can you realistically work right now?" }]
      : [],
  };
}

function taskSeedForRoute(routeKey: DiscoveryRouteKey, payload: DiscoveryPayload, answers: Record<string, string> = {}) {
  const preview = payload.routePreviews?.[routeKey] || {
    tinyNextAction: payload.tinyNextAction,
    supportAction: payload.supportAction,
  };
  const today = preview.tinyNextAction;
  const support = preview.supportAction;
  const locationAnswer = answers["location-flexibility"]?.trim();
  const routeReason = routeKey === payload.recommendedRoute.key
    ? payload.recommendedRoute.reason
    : payload.routes.find((route) => route.key === routeKey)?.why || payload.recommendedRoute.reason;
  const noteBits = [
    payload.workingGoalDraft.whyNow,
    routeReason,
    locationAnswer ? `Location flexibility: ${locationAnswer}.` : "",
  ].filter(Boolean);

  const tasks: Array<Omit<DiscoveryAction, "category"> & { category: string; list: "today" | "inbox"; sourceNote: string }> = [
    {
      ...today,
      list: "today",
      sourceNote: noteBits.join(" "),
    },
  ];
  if (support) {
    tasks.push({
      ...support,
      list: routeKey === "fit-clarification" ? "today" : "inbox",
      sourceNote: `Supports discovery route ${routeKey}.`,
    });
  }
  return tasks;
}

async function ensureDiscoveryTracks(trackDrafts: DiscoveryTrackDraft[]) {
  if (!trackDrafts.length) return [];
  const existing = await storage.getCareerTracks();
  const byKey = new Map(existing.map((track) => [norm(track.name), track]));
  const created = [];
  for (const draft of trackDrafts) {
    const found = byKey.get(norm(draft.name));
    if (found) {
      created.push(found);
      continue;
    }
    const track = await storage.createCareerTrack({
      name: draft.name,
      slug: draft.slug,
      description: draft.description,
      targetRoleArchetype: draft.targetRoleArchetype,
      priority: draft.priority,
      status: "active",
      whyItFits: draft.whyItFits,
    } as any);
    byKey.set(norm(track.name), track);
    created.push(track);
  }
  return created;
}

export function registerDiscoveryRoutes(app: Express) {
  app.post("/api/discovery/start", async (req, res) => {
    const parsed = startDiscoverySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const payload = await buildDiscoveryPayload(parsed.data);
    const session = await storage.createDiscoverySession({
      domain: payload.domain,
      concern: payload.concern,
      status: "draft" satisfies DiscoveryStatus,
      recommendedRoute: payload.recommendedRoute.key,
      payload: JSON.stringify(payload),
    } as any);

    await storage.logActivity({
      eventType: "discovery_started",
      sourceType: "discovery_session",
      sourceId: session.id,
      metadata: JSON.stringify({ domain: payload.domain, route: payload.recommendedRoute.key }),
    } as any);

    res.json({
      discoveryId: session.id,
      input: { concern: payload.concern, domain: payload.domain },
      ...payload,
    });
  });

  app.post("/api/discovery/:id/commit", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const parsed = commitDiscoverySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const session = await storage.getDiscoverySession(id);
    if (!session) return res.status(404).json({ error: "Discovery session not found" });

    const payload = safeJson<DiscoveryPayload>(session.payload, null as any);
    if (!payload) return res.status(400).json({ error: "Discovery session payload is invalid" });

    const routeKey = (parsed.data.routeKey?.trim() || session.recommendedRoute || payload.recommendedRoute.key) as DiscoveryRouteKey;
    const edits = parsed.data.edits || {};
    const answers = parsed.data.answers || {};
    const workingGoalDraft = edits.title
      ? { ...payload.workingGoalDraft, title: edits.title }
      : payload.workingGoalDraft;

    const tracks = payload.domain === "career" ? await ensureDiscoveryTracks(payload.trackDrafts) : [];
    const primaryTrackId = tracks[0]?.id ?? null;
    const taskSeeds = taskSeedForRoute(routeKey, payload, answers);
    const createdTasks = [];
    for (const seed of taskSeeds) {
      const enriched = await enrichTaskInput({
        title: seed.title,
        list: seed.list,
        category: seed.category,
        size: seed.size,
        doneWhen: seed.doneWhen,
        relatedTrackId: primaryTrackId,
      });
      const task = await storage.createTask({
        ...enriched,
        list: seed.list,
        steps: JSON.stringify([{ text: seed.firstStep, done: false, estimateMinutes: 5 }]),
        sourceType: "discovery_session",
        sourceId: session.id,
        sourceNote: seed.sourceNote,
        sourceStatus: `discovery:${routeKey}`,
        minimumOutcome: seed.doneWhen,
        relatedTrackId: primaryTrackId,
      } as any);
      createdTasks.push(task);
    }

    const updatedPayload: DiscoveryPayload = {
      ...payload,
      workingGoalDraft,
      recommendedRoute: {
        key: routeKey,
        reason: payload.routes.find((route) => route.key === routeKey)?.why || payload.recommendedRoute.reason,
      },
    };

    await storage.updateDiscoverySession(session.id, {
      status: "committed" satisfies DiscoveryStatus,
      recommendedRoute: routeKey,
      payload: JSON.stringify(updatedPayload),
    } as any);

    await storage.logActivity({
      eventType: "discovery_committed",
      sourceType: "discovery_session",
      sourceId: session.id,
      taskId: createdTasks[0]?.id,
      metadata: JSON.stringify({
        routeKey,
        trackIds: tracks.map((track) => track.id),
        taskIds: createdTasks.map((task) => task.id),
      }),
    } as any);

    res.json({
      discoveryId: session.id,
      routeCommitted: routeKey,
      workingGoalDraft,
      createdTracks: tracks,
      createdTasks,
      todayAction: createdTasks[0] || null,
    });
  });
}
