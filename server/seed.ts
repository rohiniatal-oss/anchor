import { storage } from "./storage";

const INITIAL_TRACKS = [
  {
    slug: "ai-gov-ops",
    name: "AI governance strategy and implementation",
    description: "Combines public-sector strategy, geopolitical judgement, implementation, and frontier-tech interest.",
    targetRoleArchetype: "policy / advisory",
    priority: 80,
    status: "active" as const,
    whyItFits: "Combines public-sector strategy, geopolitical judgement, implementation, and frontier-tech interest.",
  },
  {
    slug: "geo-advisory",
    name: "Geopolitical and strategic advisory",
    description: "Strong fit with TBI, Bain-style strategy, government advisory, and cross-border investment work.",
    targetRoleArchetype: "research / advisory",
    priority: 70,
    status: "active" as const,
    whyItFits: "Strong fit with TBI, Bain-style strategy, government advisory, and cross-border investment work.",
  },
  {
    slug: "strategy-cos",
    name: "Chief of staff or founder office in mission-driven tech",
    description: "Uses structured problem-solving, executive leverage, stakeholder management, and operating cadence.",
    targetRoleArchetype: "ops / chief of staff",
    priority: 60,
    status: "active" as const,
    whyItFits: "Uses structured problem-solving, executive leverage, stakeholder management, and operating cadence.",
  },
  {
    slug: "global-dev",
    name: "Global development and philanthropy strategy",
    description: "Connects government advisory, development themes, capital allocation, and strategy background.",
    targetRoleArchetype: "advisory / strategy",
    priority: 40,
    status: "watch" as const,
    whyItFits: "Connects government advisory, development themes, capital allocation, and strategy background.",
  },
];

export async function seedInitialData() {
  const existing = await storage.getCareerTracks();
  if (existing.length > 0) return;
  for (const track of INITIAL_TRACKS) {
    await storage.createCareerTrack(track as any);
  }
}
