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
}
