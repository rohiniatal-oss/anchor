import test from "node:test";
import assert from "node:assert/strict";

import { buildAnchorToday } from "./anchorToday";
import { planDay, recommend } from "./brain";
import type { CareerTrack, Contact, Hustle, Job, Learn, Task } from "@shared/schema";

const tasks: Task[] = [] as any;
const learn: Learn[] = [] as any;
const hustles: Hustle[] = [] as any;
const contacts: Contact[] = [] as any;

const tracks: CareerTrack[] = [
  {
    id: 1,
    name: "AI governance strategy",
    slug: "ai-governance-strategy",
    description: "Strategy and implementation roles around AI governance.",
    targetRoleArchetype: "AI governance strategy",
    priority: 90,
    status: "active",
    whyItFits: "Uses strategy, policy, stakeholder, and implementation experience.",
  } as any,
];

const jobs: Job[] = [
  {
    id: 10,
    title: "AI Governance Strategy Lead",
    company: "Example Institute",
    location: "London",
    url: "https://example.com/role",
    note: "Role asks for AI governance, strategy, stakeholder management, and implementation planning.",
    nextStep: "",
    status: "wishlist",
    applicationWindowStatus: "open",
    applicationReadiness: "cv",
    fitScore: 88,
    roleArchetype: "AI governance strategy",
    opportunityKind: "role",
    narrativeAngle: "public-private strategy and implementation",
    relatedTrackId: 1,
    deadline: "",
    eligibilityRisk: "",
  } as any,
];

test("Anchor Today and Brain read the same Tracks × Lanes spine", () => {
  const today = buildAnchorToday({ tasks, jobs, learn, hustles, contacts, tracks });
  const rec = recommend(tasks, jobs, learn, hustles, "medium", contacts, tracks);
  const plan = planDay(tasks, jobs, learn, hustles, "medium", { remainingMinutes: 180 }, contacts, tracks);

  assert.equal(today.bottleneck, "Applications");
  assert.equal(today.activeTrack?.name, "AI governance strategy");

  assert.equal(rec.lane, today.bottleneck);
  assert.equal(rec.activeTrack, today.activeTrack?.name);

  assert.equal(plan.trace.bottleneck, today.bottleneck);
  assert.match(plan.trace.reason, /AI governance strategy/);
  assert.equal(plan.plan[0]?.candidate.category, "job");
  assert.match(plan.plan[0]?.candidate.title || "", /AI Governance Strategy Lead|application/i);
});
