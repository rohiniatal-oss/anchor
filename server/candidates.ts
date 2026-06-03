import type { Express } from "express";
import type { Job, Task } from "@shared/schema";
import { storage } from "./storage";

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE GENERATION AND PRIORITISATION
// Build the list before choosing the task. This is the upstream Anchor layer for
// ADHD decision paralysis: generate plausible directions, roles, people, and
// signal activities, then commit one small action to Today.
// ─────────────────────────────────────────────────────────────────────────────

type CareerDirection = {
  name: string;
  whyPlausible: string;
  roleSearches: string[];
  peopleToFind: string[];
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
      whyPlausible: "Matches consulting, policy-adjacent work, and public-sector problem solving.",
      roleSearches: ["government strategy manager", "public sector strategy advisor", "policy strategy manager"],
      peopleToFind: ["someone in a government strategy role", "someone who hires public-sector strategy talent", "a former consultant in government advisory"],
    },
    {
      name: "Economic development and investment attraction",
      whyPlausible: "Matches KSA/Africa work, capital, sectors, and investment strategy.",
      roleSearches: ["investment attraction strategy", "economic development strategy", "FDI strategy manager"],
      peopleToFind: ["someone at an investment promotion agency", "someone in economic development advisory", "someone doing Africa or GCC investment work"],
    },
    {
      name: "AI and technology policy strategy",
      whyPlausible: "Matches digital assets, emerging technology, policy, and government strategy interests.",
      roleSearches: ["AI policy strategy", "responsible AI strategy", "technology policy manager"],
      peopleToFind: ["someone in AI policy", "someone in public-sector technology strategy", "someone hiring for responsible AI roles"],
    },
    {
      name: "Chief of staff or founder office",
      whyPlausible: "Matches generalist strategy, ambiguity, executive problem solving, and cross-functional work.",
      roleSearches: ["chief of staff strategy", "founder office strategy", "business operations lead"],
      peopleToFind: ["a chief of staff", "a founder office operator", "someone who moved from consulting to operator roles"],
    },
    {
      name: "Impact, philanthropy, or international development strategy",
      whyPlausible: "Matches social impact orientation, advisory work, and global development context.",
      roleSearches: ["impact strategy manager", "philanthropy strategy", "international development strategy"],
      peopleToFind: ["someone in impact strategy", "someone at a foundation", "someone in international development advisory"],
    },
  ];
}

function buildSignalActivities(tasks: Task[], jobs: Job[]) {
  const directions = starterDirections();
  const savedJobs = openJobs(jobs);
  const hasCareerWork = careerTasks(tasks).length > 0;
  const firstDirection = directions[0];
  const firstSearch = firstDirection.roleSearches[0];

  const activities: SignalActivity[] = [
    {
      activity: "Inspect one possible role family",
      why: "You are not choosing a career. You are collecting one piece of signal.",
      firstStep: `Search '${firstSearch}' and open one result.`,
      signalValue: 9,
      friction: 3,
      score: score(9, 3),
      createsTaskTitle: "Inspect one possible role and mark it exciting, neutral, or no",
    },
    {
      activity: "Find one person doing a plausible role",
      why: "A real person gives better signal than abstract thinking.",
      firstStep: `Search for ${firstDirection.peopleToFind[0]}.`,
      signalValue: 8,
      friction: 4,
      score: score(8, 4),
      createsTaskTitle: "Find one person doing a plausible career path",
    },
    {
      activity: "Write one rough direction sentence",
      why: "A rough sentence gives something to test without pretending certainty.",
      firstStep: "Write: I might want work that combines ___, ___, and ___.",
      signalValue: 6,
      friction: 2,
      score: score(6, 2),
      createsTaskTitle: "Write one rough career direction sentence",
    },
    {
      activity: "Identify one proof gap from one role",
      why: "If a direction looks interesting, the next question is what would make you credible.",
      firstStep: "Open one role and highlight the requirement you least clearly prove.",
      signalValue: 7,
      friction: 4,
      score: score(7, 4),
      createsTaskTitle: "Identify one proof gap from one role",
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
      activity: "Create the first career signal",
      why: "There is not enough career-search activity yet, so the first move is to generate one signal.",
      firstStep: "Open a jobs site and search one broad role family.",
      signalValue: 10,
      friction: 3,
      score: score(10, 3),
      createsTaskTitle: "Collect one career signal from one role search",
    });
  }

  return activities.sort((a, b) => b.score - a.score);
}

export function generateCandidateUniverse(tasks: Task[], jobs: Job[]) {
  const directions = starterDirections();
  const activities = buildSignalActivities(tasks, jobs).slice(0, 5);
  return {
    purpose: "Build the list of possible jobs, people, tasks, and activities before choosing what to do.",
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
