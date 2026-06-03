import type { Express } from "express";
import type { Job, Task } from "@shared/schema";
import { storage } from "./storage";

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE GENERATION AND PRIORITISATION
// Build the list before choosing the task. This is the upstream Anchor layer for
// ADHD decision paralysis: generate plausible directions, roles, people, and
// signal activities, then commit one small action to Today.
//
// MVP grounding: use Rohini's actual experience assets and warm networks rather
// than generic career advice.
// ─────────────────────────────────────────────────────────────────────────────

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

function score(signalValue: number, friction: number) {
  return signalValue * 2 - friction;
}

function openJobs(jobs: Job[]) {
  return jobs.filter((j) => !["closed", "rejected"].includes(j.status || "") && j.applicationWindowStatus !== "closed");
}

function careerTasks(tasks: Task[]) {
  return tasks.filter((t) => !t.done && (t.category === "job" || /job|career|role|cv|interview|application/i.test(t.title)));
}

export function starterDirections(): CareerDirection[] {
  return [
    {
      name: "Government strategy and advisory",
      whyPlausible: "Matches Bain, TBI, public-sector advisory, and strategy work.",
      roleSearches: ["government strategy manager", "public sector strategy advisor", "government transformation strategy"],
      peopleToFind: ["Bain alumnus in public-sector strategy", "TBI colleague in government advisory", "SIPA contact in policy strategy"],
      warmNetworks: ["Bain", "TBI", "SIPA"],
    },
    {
      name: "Economic development and investment attraction",
      whyPlausible: "Matches KSA/Africa investment strategy, capital, sectors, and advisory experience.",
      roleSearches: ["investment attraction strategy", "economic development strategy", "FDI strategy manager"],
      peopleToFind: ["TBI contact doing Africa or GCC investment work", "Bain person in economic development", "SIPA person in development finance"],
      warmNetworks: ["TBI", "Bain", "SIPA", "Abraaj/Humania"],
    },
    {
      name: "AI and technology policy strategy",
      whyPlausible: "Matches digital assets, Worldpay/FIS, emerging technology, and government strategy interests.",
      roleSearches: ["AI policy strategy", "responsible AI strategy", "public sector technology strategy"],
      peopleToFind: ["SIPA contact in technology policy", "TBI contact working on AI or govtech", "Worldpay/FIS contact in digital assets or fintech"],
      warmNetworks: ["SIPA", "TBI", "Worldpay/FIS"],
    },
    {
      name: "Chief of staff or founder office",
      whyPlausible: "Matches generalist strategy, ambiguity, executive problem solving, and cross-functional work.",
      roleSearches: ["chief of staff strategy", "founder office strategy", "business operations lead"],
      peopleToFind: ["Bain alumnus in chief of staff role", "Dubai operator or founder office contact", "former consultant in business operations"],
      warmNetworks: ["Bain", "Dubai", "London"],
    },
    {
      name: "Impact, philanthropy, or international development strategy",
      whyPlausible: "Matches social impact orientation, SIPA, advisory work, and global development context.",
      roleSearches: ["impact strategy manager", "philanthropy strategy", "international development strategy"],
      peopleToFind: ["SIPA contact in impact or development", "foundation strategy contact", "TBI colleague in development advisory"],
      warmNetworks: ["SIPA", "TBI", "London"],
    },
  ];
}

function buildSignalActivities(tasks: Task[], jobs: Job[]) {
  const directions = starterDirections();
  const savedJobs = openJobs(jobs);
  const hasCareerWork = careerTasks(tasks).length > 0;
  const firstDirection = directions[0];
  const firstSearch = firstDirection.roleSearches[0];
  const firstPerson = firstDirection.peopleToFind[0];

  const activities: SignalActivity[] = [
    {
      activity: "Inspect one experience-backed role family",
      why: "You are not choosing a career. You are testing whether a direction backed by your experience creates signal.",
      firstStep: `Search '${firstSearch}' and open one result.`,
      signalValue: 9,
      friction: 3,
      score: score(9, 3),
      createsTaskTitle: "Inspect one experience-backed role and mark it exciting, neutral, or no",
    },
    {
      activity: "Find one warm-network person in a plausible path",
      why: "A warm person from Bain, SIPA, TBI, or your existing network gives better signal than generic browsing.",
      firstStep: `Look for one ${firstPerson}.`,
      signalValue: 9,
      friction: 4,
      score: score(9, 4),
      createsTaskTitle: "Find one warm-network person for a career reality check",
    },
    {
      activity: "Write one rough direction sentence using real assets",
      why: "A rough sentence helps test whether your experience can form a credible story.",
      firstStep: "Write: I might want work that combines strategy, government, and capital/technology.",
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
      activity: "Review one saved role for attraction or repulsion",
      why: "You already have material, so use it to create signal instead of searching from scratch.",
      firstStep: "Open the most promising saved role.",
      signalValue: 8,
      friction: 2,
      score: score(8, 2),
      createsTaskTitle: "Review one saved role and mark it exciting, neutral, or no",
    });
  }

  if (!hasCareerWork) {
    activities.push({
      activity: "Create the first career signal from an asset-backed direction",
      why: "There is not enough career-search activity yet, so start with one direction linked to your actual experience.",
      firstStep: `Search '${firstSearch}' or look for one ${firstPerson}.`,
      signalValue: 10,
      friction: 3,
      score: score(10, 3),
      createsTaskTitle: "Collect one career signal from an asset-backed direction",
    });
  }

  return activities.sort((a, b) => b.score - a.score);
}

export function generateCandidateUniverse(tasks: Task[], jobs: Job[]) {
  const directions = starterDirections();
  const activities = buildSignalActivities(tasks, jobs).slice(0, 5);
  return {
    purpose: "Build the list of possible jobs, people, tasks, and activities before choosing what to do.",
    grounding: ["Bain", "SIPA", "TBI", "Worldpay/FIS", "Abraaj/Humania", "Dubai", "London", "KSA/Africa investment strategy"],
    directions,
    activities,
    recommended: activities[0],
  };
}

export function registerCandidateRoutes(app: Express) {
  app.get("/api/candidates", async (_req, res) => {
    const [tasks, jobs] = await Promise.all([storage.getTasks(), storage.getJobs()]);
    res.json(generateCandidateUniverse(tasks, jobs));
  });

  app.post("/api/candidates/commit", async (_req, res) => {
    const [tasks, jobs] = await Promise.all([storage.getTasks(), storage.getJobs()]);
    const { recommended } = generateCandidateUniverse(tasks, jobs);
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
