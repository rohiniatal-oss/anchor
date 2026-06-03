import type { Express } from "express";
import type { ActivityLog, Job, Task } from "@shared/schema";
import { storage } from "./storage";

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE GENERATION AND PRIORITISATION
// Build the list before choosing the task. This is the upstream Anchor layer for
// ADHD decision paralysis: generate plausible directions, roles, people, and
// signal activities, then commit one small action to Today.
//
// Editable career assets are stored as activity-log events to avoid a schema
// migration in this sprint. The current asset inventory is reconstructed from
// career_asset_upsert / career_asset_delete events, with starter fallbacks.
// Role deconstruction learns from attributes inside a role, not binary likes.
// ─────────────────────────────────────────────────────────────────────────────

type AssetKind = "experience" | "network" | "geography" | "proof" | "topic";

type CareerAsset = {
  key: string;
  kind: AssetKind;
  label: string;
  note: string;
  strength: number;
  active: boolean;
};

type CareerDirection = {
  name: string;
  whyPlausible: string;
  roleSearches: string[];
  peopleToFind: string[];
  warmNetworks: string[];
};

type SignalActivity = {
  activity: string;
  why: string;
  firstStep: string;
  signalValue: number;
  friction: number;
  score: number;
  createsTaskTitle: string;
};

type RoleDeconstruction = {
  jobId: number;
  title: string;
  company: string;
  attributes: {
    workContent: string[];
    topicAreas: string[];
    environment: string[];
    mechanics: string[];
  };
  credibilityAssets: string[];
  proofGaps: string[];
  usefulQuestions: string[];
  nextSignalAction: {
    title: string;
    why: string;
    firstStep: string;
  };
};

const STARTER_ASSETS: CareerAsset[] = [
  { key: "exp-bain", kind: "experience", label: "Bain", note: "strategy consulting and alumni network", strength: 9, active: true },
  { key: "net-sipa", kind: "network", label: "SIPA", note: "policy and international affairs network", strength: 8, active: true },
  { key: "exp-tbi", kind: "experience", label: "TBI", note: "government advisory and policy strategy", strength: 9, active: true },
  { key: "exp-worldpay-fis", kind: "experience", label: "Worldpay/FIS", note: "digital assets, fintech, corporate strategy", strength: 7, active: true },
  { key: "exp-abraaj-humania", kind: "experience", label: "Abraaj/Humania", note: "investing, healthcare, emerging markets", strength: 7, active: true },
  { key: "geo-dubai", kind: "geography", label: "Dubai", note: "current base and GCC network", strength: 8, active: true },
  { key: "geo-london", kind: "geography", label: "London", note: "UK network and access", strength: 7, active: true },
  { key: "topic-ksa-africa", kind: "topic", label: "KSA/Africa investment strategy", note: "sector and investment strategy experience", strength: 8, active: true },
];

function score(signalValue: number, friction: number) {
  return signalValue * 2 - friction;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function safeJson(raw: string) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function normaliseAsset(raw: any): CareerAsset {
  const label = String(raw.label || raw.name || "").trim();
  const kind = ["experience", "network", "geography", "proof", "topic"].includes(raw.kind) ? raw.kind : "experience";
  return {
    key: String(raw.key || `${kind}-${slug(label)}`),
    kind,
    label,
    note: String(raw.note || ""),
    strength: Math.max(1, Math.min(10, Number(raw.strength || 5))),
    active: raw.active !== false,
  };
}

export function careerAssetsFromActivity(log: ActivityLog[]): CareerAsset[] {
  const map = new Map<string, CareerAsset>();
  for (const asset of STARTER_ASSETS) map.set(asset.key, asset);
  const relevant = log
    .filter((a) => a.eventType === "career_asset_upsert" || a.eventType === "career_asset_delete")
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const event of relevant) {
    const data = safeJson(event.metadata);
    const key = String(data.key || (data.label ? `${data.kind || "experience"}-${slug(data.label)}` : ""));
    if (!key) continue;
    if (event.eventType === "career_asset_delete") {
      const existing = map.get(key);
      if (existing) map.set(key, { ...existing, active: false });
      continue;
    }
    const asset = normaliseAsset({ ...data, key });
    if (asset.label) map.set(key, asset);
  }
  return Array.from(map.values()).filter((a) => a.active);
}

function labels(assets: CareerAsset[], kind?: AssetKind) {
  return assets.filter((a) => !kind || a.kind === kind).sort((a, b) => b.strength - a.strength).map((a) => a.label);
}

function haystack(job: Job) {
  return `${job.title} ${job.company} ${job.location} ${job.note} ${job.nextStep} ${job.roleArchetype} ${job.narrativeAngle}`.toLowerCase();
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function attributeList(text: string, groups: Array<[string, string[]]>) {
  return groups.filter(([, terms]) => hasAny(text, terms)).map(([label]) => label);
}

export function deconstructRole(job: Job, assets: CareerAsset[] = STARTER_ASSETS): RoleDeconstruction {
  const text = haystack(job);
  const workContent = attributeList(text, [
    ["strategy", ["strategy", "strategic", "transformation", "roadmap"]],
    ["policy", ["policy", "government", "public sector", "regulation", "regulatory"]],
    ["analysis", ["analysis", "analytics", "research", "insight", "market"]],
    ["stakeholder management", ["stakeholder", "client", "minister", "executive", "senior"]],
    ["investment or capital", ["investment", "capital", "fund", "investor", "economic development", "fdi"]],
    ["operations or delivery", ["operations", "delivery", "implementation", "program", "programme", "execution"]],
    ["writing or thought leadership", ["writing", "brief", "memo", "publication", "thought leadership"]],
  ]);
  const topicAreas = attributeList(text, [
    ["AI or technology", ["ai", "artificial intelligence", "technology", "digital", "data", "fintech"]],
    ["economic development", ["economic development", "investment attraction", "fdi", "trade"]],
    ["government transformation", ["government transformation", "public sector", "ministry", "civil service"]],
    ["impact or development", ["impact", "development", "foundation", "philanthropy", "ngo"]],
    ["health or education", ["health", "healthcare", "education"]],
  ]);
  const environment = attributeList(text, [
    ["consulting or advisory", ["consulting", "advisory", "advisor", "client"]],
    ["government or public sector", ["government", "public sector", "ministry", "policy"]],
    ["corporate", ["corporate", "company", "business unit"]],
    ["startup or founder office", ["startup", "founder", "chief of staff", "operator"]],
    ["foundation or impact", ["foundation", "impact", "philanthropy", "development"]],
  ]);
  const mechanics = attributeList(text, [
    ["ambiguous problem solving", ["ambiguous", "0 to 1", "build", "shape", "design"]],
    ["senior stakeholder facing", ["stakeholder", "minister", "executive", "senior", "client"]],
    ["delivery heavy", ["delivery", "implementation", "execution", "programme", "program"]],
    ["writing heavy", ["brief", "memo", "writing", "draft", "publication"]],
    ["commercial or BD", ["business development", "sales", "partnership", "pipeline"]],
  ]);

  const credibilityAssets = assets
    .filter((asset) => hasAny(text, [asset.label, asset.note]))
    .sort((a, b) => b.strength - a.strength)
    .map((a) => a.label)
    .slice(0, 5);

  const proofGaps: string[] = [];
  if (topicAreas.includes("AI or technology") && !credibilityAssets.some((a) => /Worldpay|FIS|technology|digital/i.test(a))) proofGaps.push("AI or technology proof");
  if (workContent.includes("investment or capital") && !credibilityAssets.some((a) => /Abraaj|Humania|investment|capital/i.test(a))) proofGaps.push("investment or capital proof");
  if (mechanics.includes("delivery heavy") && !credibilityAssets.some((a) => /TBI|Bain/i.test(a))) proofGaps.push("delivery or implementation proof");
  if (workContent.includes("writing or thought leadership") && assets.filter((a) => a.kind === "proof").length === 0) proofGaps.push("writing sample or proof asset");
  if (proofGaps.length === 0) proofGaps.push("specific evidence that proves the most important requirement");

  const usefulQuestions = [
    "Which responsibility sounds energising versus merely impressive?",
    "Which requirement is already proven by existing experience?",
    "Which requirement would need a proof asset or conversation?",
  ];

  const firstGap = proofGaps[0];
  const nextSignalAction = {
    title: `Check one proof gap for ${job.title}`,
    why: "The role is a bundle. The useful next move is to test the weakest important attribute, not judge the whole role.",
    firstStep: `Highlight the line in the role that creates this gap: ${firstGap}.`,
  };

  return {
    jobId: job.id,
    title: job.title,
    company: job.company,
    attributes: {
      workContent: workContent.length ? workContent : ["unclear work content"],
      topicAreas: topicAreas.length ? topicAreas : ["unclear topic area"],
      environment: environment.length ? environment : ["unclear environment"],
      mechanics: mechanics.length ? mechanics : ["unclear role mechanics"],
    },
    credibilityAssets,
    proofGaps,
    usefulQuestions,
    nextSignalAction,
  };
}

function openJobs(jobs: Job[]) {
  return jobs.filter((j) => !["closed", "rejected"].includes(j.status || "") && j.applicationWindowStatus !== "closed");
}

function careerTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && (t.category === "job" || /job|career|role|cv|interview|application/i.test(t.title)));
}

export function starterDirections(assets: CareerAsset[] = STARTER_ASSETS): CareerDirection[] {
  const network = labels(assets, "network");
  const experience = labels(assets, "experience");
  const geography = labels(assets, "geography");
  const topics = labels(assets, "topic");
  const has = (name: string) => assets.some((a) => a.label.toLowerCase().includes(name.toLowerCase()));
  const defaultNetworks = network.length ? network : ["Bain", "TBI", "SIPA"];
  const defaultGeo = geography.length ? geography.join(" / ") : "Dubai / London / GCC";

  const directions: CareerDirection[] = [
    {
      name: "Government strategy and advisory",
      whyPlausible: `Matches ${[has("Bain") && "Bain", has("TBI") && "TBI", "public-sector advisory", "strategy"].filter(Boolean).join(", ")}.`,
      roleSearches: [`government strategy manager ${defaultGeo}`, "public sector strategy advisor", "government transformation strategy"],
      peopleToFind: [`${defaultNetworks[0]} person in public-sector strategy`, "TBI colleague in government advisory", "SIPA contact in policy strategy"],
      warmNetworks: defaultNetworks,
    },
    {
      name: "Economic development and investment attraction",
      whyPlausible: `Matches ${topics[0] || "KSA/Africa investment strategy"}, capital, sectors, and advisory experience.`,
      roleSearches: [`investment attraction strategy ${defaultGeo}`, "economic development strategy", "FDI strategy manager"],
      peopleToFind: ["TBI contact doing Africa or GCC investment work", "Bain person in economic development", "SIPA person in development finance"],
      warmNetworks: Array.from(new Set([...defaultNetworks, ...experience.filter((x) => /Abraaj|Humania/i.test(x))])),
    },
    {
      name: "AI and technology policy strategy",
      whyPlausible: `Matches ${[has("Worldpay") && "Worldpay/FIS", "digital assets", "emerging technology", "government strategy"].filter(Boolean).join(", ")}.`,
      roleSearches: [`AI policy strategy ${defaultGeo}`, "responsible AI strategy", "public sector technology strategy"],
      peopleToFind: ["SIPA contact in technology policy", "TBI contact working on AI or govtech", "Worldpay/FIS contact in digital assets or fintech"],
      warmNetworks: Array.from(new Set([...defaultNetworks, ...experience.filter((x) => /Worldpay|FIS/i.test(x))])),
    },
    {
      name: "Chief of staff or founder office",
      whyPlausible: "Matches generalist strategy, ambiguity, executive problem solving, and cross-functional work.",
      roleSearches: [`chief of staff strategy ${defaultGeo}`, "founder office strategy", "business operations lead"],
      peopleToFind: [`${defaultNetworks[0]} alumnus in chief of staff role`, "Dubai operator or founder office contact", "former consultant in business operations"],
      warmNetworks: Array.from(new Set([...defaultNetworks, ...geography])),
    },
    {
      name: "Impact, philanthropy, or international development strategy",
      whyPlausible: `Matches ${network.includes("SIPA") ? "SIPA, " : ""}social impact orientation, advisory work, and global development context.`,
      roleSearches: [`impact strategy manager ${defaultGeo}`, "philanthropy strategy", "international development strategy"],
      peopleToFind: ["SIPA contact in impact or development", "foundation strategy contact", "TBI colleague in development advisory"],
      warmNetworks: Array.from(new Set([...defaultNetworks, ...geography])),
    },
  ];

  return directions;
}

function buildSignalActivities(tasks: Task[], jobs: Job[], assets: CareerAsset[]) {
  const directions = starterDirections(assets);
  const savedJobs = openJobs(jobs);
  const hasCareerWork = careerTasks(tasks).length > 0;
  const firstDirection = directions[0];
  const firstSearch = firstDirection.roleSearches[0];
  const firstPerson = firstDirection.peopleToFind[0];
  const assetList = labels(assets).slice(0, 4).join(", ") || "your real experience";

  const activities: SignalActivity[] = [
    {
      activity: "Inspect one experience-backed role family",
      why: `You are testing whether a direction backed by ${assetList} creates signal.`,
      firstStep: `Search '${firstSearch}' and open one result.`,
      signalValue: 9,
      friction: 3,
      score: score(9, 3),
      createsTaskTitle: "Inspect one experience-backed role and mark what feels credible or interesting",
    },
    {
      activity: "Find one warm-network person in a plausible path",
      why: "A warm person from your real network gives better signal than generic browsing.",
      firstStep: `Look for one ${firstPerson}.`,
      signalValue: 9,
      friction: 4,
      score: score(9, 4),
      createsTaskTitle: "Find one warm-network person for a career reality check",
    },
    {
      activity: "Write one rough direction sentence using real assets",
      why: "A rough sentence helps test whether your experience can form a credible story.",
      firstStep: `Write: I might want work that combines ${labels(assets).slice(0, 3).join(", ") || "strategy, government, and capital/technology"}.`,
      signalValue: 6,
      friction: 2,
      score: score(6, 2),
      createsTaskTitle: "Write one rough career direction sentence from real experience",
    },
    {
      activity: "Identify one proof gap from one plausible role",
      why: "If a direction looks interesting, the next question is what proof from your real experience makes you credible.",
      firstStep: "Open one role and highlight the requirement you least clearly prove.",
      signalValue: 7,
      friction: 4,
      score: score(7, 4),
      createsTaskTitle: "Identify one proof gap from one plausible role",
    },
  ];

  if (savedJobs.length > 0) {
    activities.push({
      activity: "Review one saved role for useful attributes",
      why: "You already have material, so use it to learn which attributes matter rather than judging the whole role.",
      firstStep: "Open the most promising saved role and note one responsibility that attracts or concerns you.",
      signalValue: 8,
      friction: 2,
      score: score(8, 2),
      createsTaskTitle: "Review one saved role and note one useful attribute",
    });
  }

  if (!hasCareerWork) {
    activities.push({
      activity: "Create the first career signal from an asset-backed direction",
      why: "There is not enough career-search activity yet, so start with one direction linked to your actual assets.",
      firstStep: `Search '${firstSearch}' or look for one ${firstPerson}.`,
      signalValue: 10,
      friction: 3,
      score: score(10, 3),
      createsTaskTitle: "Collect one career signal from an asset-backed direction",
    });
  }

  return activities.sort((a, b) => b.score - a.score);
}

export function generateCandidateUniverse(tasks: Task[], jobs: Job[], assets: CareerAsset[] = STARTER_ASSETS) {
  const activeAssets = assets.length ? assets : STARTER_ASSETS;
  const directions = starterDirections(activeAssets);
  const activities = buildSignalActivities(tasks, jobs, activeAssets).slice(0, 5);
  return {
    purpose: "Build the list of possible jobs, people, tasks, and activities before choosing what to do.",
    grounding: labels(activeAssets),
    assets: activeAssets,
    directions,
    activities,
    recommended: activities[0],
  };
}

export function registerCandidateRoutes(app: Express) {
  app.get("/api/career-assets", async (_req, res) => {
    res.json(careerAssetsFromActivity(await storage.getActivityLog()));
  });

  app.post("/api/career-assets", async (req, res) => {
    const asset = normaliseAsset(req.body || {});
    if (!asset.label) return res.status(400).json({ error: "Asset label is required" });
    await storage.logActivity({
      eventType: "career_asset_upsert",
      sourceType: "career_asset",
      metadata: JSON.stringify(asset),
    } as any);
    res.json({ asset, assets: careerAssetsFromActivity(await storage.getActivityLog()) });
  });

  app.delete("/api/career-assets/:key", async (req, res) => {
    const key = String(req.params.key || "");
    await storage.logActivity({
      eventType: "career_asset_delete",
      sourceType: "career_asset",
      metadata: JSON.stringify({ key }),
    } as any);
    res.json({ ok: true, assets: careerAssetsFromActivity(await storage.getActivityLog()) });
  });

  app.get("/api/candidates", async (_req, res) => {
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    res.json(generateCandidateUniverse(tasks, jobs, careerAssetsFromActivity(log)));
  });

  app.post("/api/candidates/commit", async (_req, res) => {
    const [tasks, jobs, log] = await Promise.all([storage.getTasks(), storage.getJobs(), storage.getActivityLog()]);
    const { recommended } = generateCandidateUniverse(tasks, jobs, careerAssetsFromActivity(log));
    const task = await storage.createTask({
      title: recommended.createsTaskTitle,
      list: "today",
      done: false,
      category: "job",
      size: "quick",
      estimateMinutes: 15,
      estimateConfidence: "low",
      estimateReason: "candidate_generation",
      doneWhen: "One signal has been collected",
      steps: JSON.stringify([{ text: recommended.firstStep, done: false, estimateMinutes: 5 }]),
      status: "not_started",
      sourceType: "candidate_activity",
      sourceNote: recommended.activity,
    } as any);
    await storage.logActivity({
      eventType: "candidate_committed",
      sourceType: "candidate_activity",
      taskId: task.id,
      metadata: JSON.stringify(recommended),
    } as any);
    res.json({ recommended, task });
  });

  app.get("/api/jobs/:id/deconstruct", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const [jobs, log] = await Promise.all([storage.getJobs(), storage.getActivityLog()]);
    const job = jobs.find((j) => j.id === id);
    if (!job) return res.status(404).json({ error: "Not found" });
    const result = deconstructRole(job, careerAssetsFromActivity(log));
    res.json(result);
  });

  app.post("/api/jobs/:id/deconstruct/commit", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const [jobs, log] = await Promise.all([storage.getJobs(), storage.getActivityLog()]);
    const job = jobs.find((j) => j.id === id);
    if (!job) return res.status(404).json({ error: "Not found" });
    const deconstruction = deconstructRole(job, careerAssetsFromActivity(log));
    const task = await storage.createTask({
      title: deconstruction.nextSignalAction.title,
      list: "today",
      done: false,
      category: "job",
      size: "quick",
      estimateMinutes: 15,
      estimateConfidence: "low",
      estimateReason: "role_deconstruction",
      doneWhen: "One role attribute or proof gap has been clarified",
      steps: JSON.stringify([{ text: deconstruction.nextSignalAction.firstStep, done: false, estimateMinutes: 5 }]),
      status: "not_started",
      sourceType: "role_deconstruction",
      sourceId: job.id,
      sourceNote: deconstruction.nextSignalAction.why,
    } as any);
    await storage.logActivity({
      eventType: "role_deconstruction_committed",
      sourceType: "job",
      sourceId: job.id,
      taskId: task.id,
      metadata: JSON.stringify(deconstruction),
    } as any);
    res.json({ deconstruction, task });
  });
}
