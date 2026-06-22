import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("coerceTaskBreakdownSteps turns workflow/meta steps into tiny actionable task steps", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { coerceTaskBreakdownSteps } = await import("./taskBreakdownRoutes");

  const task = {
    title: "Tailor CV for policy role",
    category: "job",
    doneWhen: "The CV is tailored to the role",
    minimumOutcome: "",
    sourceUrl: "https://example.com/role",
  } as any;
  const bundle = {
    sourceKind: "job",
    sourceContext: "This is a JOB / OPPORTUNITY item. Role: Policy role at Org.",
    playbook: "",
    source: null,
    parentContext: "",
  } as any;
  const workflowState = {
    workObject: "Artifact",
    workflow: ["Understand role", "Match examples", "Build materials"],
    workflowKind: "finite",
    currentStage: "Build materials",
    stageOutput: "The next application material is drafted or improved",
    completionCriteria: ["A first tailored version exists"],
    advanceCondition: "Advance when the first tailored version exists.",
  } as any;

  const steps = coerceTaskBreakdownSteps(task, bundle, workflowState, [
    { text: "Locate the current stage", done: false },
    { text: "Define this stage output", done: false },
    { text: "Break this stage into actions", done: false, substeps: ["Rewrite the first matching bullet", "Save the next bullet to update later"] },
  ] as any);

  assert.equal(steps[0].text, "Open your CV and the role posting side by side");
  assert.equal(steps.length <= 4, true);
  assert.ok(steps.every((step) => !/use the|locate the|define this stage output|check completion criteria|break this stage into actions/i.test(step.text)));
});

test("goal-source breakdown turns broad pursuit into concrete role-type coverage steps", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");

  const task = {
    title: "Add or apply to one credible role in each plausible role type that still looks real",
    category: "job",
    sourceType: "goal",
    sourceId: 1,
    sourceNote: "Broad pursuit is active across all plausible role types.",
    doneWhen: "One concrete role or application move exists in each active role type",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { workflowState, steps } = await buildDeterministicTaskBreakdown(task);

  assert.equal(workflowState.workObject, "Pipeline");
  assert.match(workflowState.currentStage, /Define your target|Build a list|Work through the next batch/);
  assert.ok(steps.length >= 1);
  assert.match(String(steps[0]?.text || ""), /open jobs|save the first real role|saved role|pipeline action|find one real role|still missing one|first path/i);
});

test("goal-source breakdown sharpens the first role-search move for a specific missing combination", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");

  const task = {
    title: "Add or apply to one credible role in each still-empty combination: Geopolitics / geopolitical advisory x Strategy / advisory",
    category: "job",
    sourceType: "goal",
    sourceId: 1,
    sourceNote: "Broad pursuit is active. Missing combinations: Geopolitics / geopolitical advisory x Strategy / advisory.",
    doneWhen: "One concrete role or application move exists in each still-empty combination",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { steps } = await buildDeterministicTaskBreakdown(task);

  assert.ok(steps.length >= 1);
  assert.match(steps.map((step) => String(step.text || "")).join(" | "), /find one real role for the first role type still missing|Record the company and role title/i);
});

test("normalizeExistingTaskBreakdown repairs saved legacy meta-steps into direct actions", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { normalizeExistingTaskBreakdown } = await import("./taskBreakdownRoutes");

  const task = {
    title: "Review three AI governance strategy roles and note the requirements that keep coming up.",
    category: "learning",
    sourceType: "goal",
    sourceId: 1,
    sourceNote: "From Strategy Builder",
    doneWhen: "One clear role-family signal is captured",
    minimumOutcome: "",
    steps: JSON.stringify([
      { text: "Use the finite knowledge workflow", done: false, substeps: ["Get the lay of the land", "Focus on what matters"] },
      { text: "Locate the current stage", done: false },
      { text: "Define this stage output", done: false },
      { text: "Check completion criteria", done: false },
      { text: "Break this stage into actions", done: false, substeps: ["Open the resource or source", "Scan headings or summary"] },
    ]),
  } as any;

  const repaired = await normalizeExistingTaskBreakdown(task);

  assert.equal(repaired.changed, true);
  const steps = JSON.parse(String(repaired.steps));
  assert.ok(Array.isArray(steps) && steps.length >= 1);
  assert.doesNotMatch(
    steps.map((step: any) => String(step.text || "")).join(" | "),
    /use the|locate the|define this stage output|check completion criteria|break this stage into actions/i,
  );
  assert.match(String(steps[0]?.text || ""), /open jobs|save the first real role|open the saved role|pipeline action|find one real role|still missing one|first path|most promising saved role/i);
});

test("contact-source breakdown uses the real contact context in deterministic fallback", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "Sarah Malik",
    who: "Palantir recruiter",
    why: "Can advise on the AI strategy role",
    status: "messaged",
    relationshipStrength: "warm",
    targetOrg: "Palantir",
    targetRole: "AI Strategy",
    askType: "follow_up",
    lastMessage: "Sent an intro note last week",
    nextFollowUpDate: "2026-06-20",
  } as any);

  const task = {
    title: "Follow up with Sarah about the Palantir AI strategy role",
    category: "admin",
    sourceType: "contact",
    sourceId: contact.id,
    sourceNote: "",
    doneWhen: "A follow-up draft is ready",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { bundle, workflowState, steps } = await buildDeterministicTaskBreakdown(task);

  assert.equal(bundle.sourceKind, "contact");
  assert.equal(workflowState.currentStage, "Follow up");
  assert.match(steps.map((step) => String(step.text || "")).join(" | "), /Sarah|Palantir/i);
});

test("contact-source outreach breakdown supplies the angle and ask instead of generic message mechanics", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "",
    who: "Bain alum",
    why: "They can reality-check which AI strategy roles are actually worth pursuing",
    status: "to_contact",
    relationshipStrength: "warm",
    targetRole: "AI strategy roles",
    askType: "advice",
  } as any);

  const task = {
    title: "Reach out to a Bain alum about AI strategy roles and ask for a 15 minute chat",
    category: "admin",
    sourceType: "contact",
    sourceId: contact.id,
    sourceNote: "",
    doneWhen: "A short outreach draft is ready to send",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { bundle, workflowState, steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.equal(bundle.sourceKind, "contact");
  assert.equal(workflowState.currentStage, "Draft a message");
  assert.match(bundle.sourceContext || "", /Person: Bain alum/i);
  assert.match(joined, /Open a draft message to the contact/i);
  assert.match(joined, /Lead with the specific ask about AI strategy roles/i);
  assert.match(joined, /Keep it under 4 sentences/i);
  assert.doesNotMatch(joined, /review notes|research this person/i);
});

test("replied contact follow-up draft stays in message mode instead of abstract relationship strategy", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "Priya Raman",
    who: "Senior Policy Advisor at Ofcom",
    why: "Referred me to James and can help me keep the relationship warm while I pursue AI governance roles",
    status: "replied",
    relationshipStrength: "warm",
    sourceNetwork: "Ofcom",
    targetOrg: "Ofcom",
    targetRole: "AI governance / online safety policy",
    askType: "follow_up",
    lastMessage: "She introduced me to James in the Online Safety team and said to keep her posted",
    referralPotential: "medium",
  } as any);

  const task = {
    title: "Draft follow-up message to Priya",
    category: "admin",
    sourceType: "contact",
    sourceId: contact.id,
    sourceNote: "",
    doneWhen: "A short, ready-to-send follow-up draft exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { workflowState, steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.equal(workflowState.currentStage, "Prepare for the conversation");
  assert.match(joined, /Review Priya Raman's background/i);
  assert.match(joined, /specific questions to ask Priya Raman/i);
  assert.match(joined, /Save conversation prep notes/i);
  assert.doesNotMatch(joined, /Decide what would strengthen the relationship/i);
});

test("contact conversation prep stays in prep mode instead of collapsing into outreach drafting", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "James",
    who: "Senior Policy Advisor in Ofcom's Online Safety team",
    why: "Can clarify what the AI governance expansion means for hiring timelines and backgrounds",
    status: "to_contact",
    relationshipStrength: "warm",
    sourceNetwork: "Priya",
    targetOrg: "Ofcom",
    targetRole: "AI governance / policy roles",
    askType: "advice",
  } as any);

  const task = {
    title: "Prepare for coffee with James at Ofcom",
    category: "admin",
    sourceType: "contact",
    sourceId: contact.id,
    sourceNote: "Priya referred me. I want to ask about AI governance expansion, hiring timelines, and what backgrounds they are hiring.",
    doneWhen: "A short prep note and specific questions are ready",
    minimumOutcome: "Three good questions and a clear angle are ready",
    sourceUrl: "",
  } as any;

  const { workflowState, steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.equal(workflowState.currentStage, "Prepare for the conversation");
  assert.match(joined, /Review James's background and the AI governance \/ policy roles at Ofcom context/i);
  assert.match(joined, /specific questions to ask James/i);
  assert.match(joined, /Note one thing you can offer or share in return/i);
  assert.match(joined, /Save conversation prep notes/i);
  assert.doesNotMatch(joined, /I want to ask about AI governance expansion/i);
  assert.doesNotMatch(joined, /Open a draft to James|Use this opener angle|Keep it to 4-5 lines/i);
});

test("contact prompt tells the llm to personalize outreach from stored facts instead of asking the user to rediscover them", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildSourceContext, buildTaskBreakdownPrompt } = await import("./taskBreakdownRoutes");
  const { buildUserContext } = await import("./userContext");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "",
    who: "Bain alum",
    sourceNetwork: "Bain",
    why: "Can reality-check which AI strategy roles are worth pursuing",
    status: "to_contact",
    relationshipStrength: "warm",
    targetOrg: "AI companies",
    targetRole: "AI strategy roles",
    askType: "advice",
    messageDraft: "Hi — I'm exploring AI strategy roles and would really value your steer.",
    referralPotential: "medium",
  } as any);

  const task = {
    title: "Draft follow-up message to Bain alum about AI strategy roles",
    category: "admin",
    sourceType: "contact",
    sourceId: contact.id,
    sourceNote: "",
    doneWhen: "A short outreach draft is ready to send",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const userContext = await buildUserContext();
  const bundle = await buildSourceContext(task, userContext);
  const prompt = buildTaskBreakdownPrompt({ task, bundle, fallbackObject: "Pipeline" });

  assert.match(bundle.sourceContext || "", /Shared network: Bain/i);
  assert.match(bundle.sourceContext || "", /Existing draft: Hi/i);
  assert.match(prompt, /Anchor remains the planner; your job is to personalize the move using only the facts provided/i);
  assert.match(prompt, /Do not tell the user to review notes, research the person, or figure out why they are reaching out/i);
  assert.match(prompt, /Convert available context into a suggested outreach angle, a smallest credible ask, and a clear stop condition/i);
  assert.match(prompt, /If current public information about the person, team, or organization is already provided, use at most 1-2 relevant signals to sharpen why now, the angle, or the ask/i);
  assert.match(prompt, /Do not turn the task into open-ended research\. Use public evidence only when it materially improves relevance for this specific message/i);
  assert.match(prompt, /For simple follow-ups, thank-yous, or status updates, keep public research silent unless a current fact clearly changes what should be sent/i);
  assert.match(prompt, /If context is weak, stay honest, keep the ask soft, and do not invent shared history or certainty/i);
});

test("conversation-prep prompt tells the llm to prepare questions rather than draft outreach", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildSourceContext, buildTaskBreakdownPrompt } = await import("./taskBreakdownRoutes");
  const { buildUserContext } = await import("./userContext");
  const { storage } = await import("./storage");

  const contact = await storage.createContact({
    name: "James",
    who: "Senior Policy Advisor in Ofcom's Online Safety team",
    sourceNetwork: "Priya",
    why: "Can clarify what the AI governance expansion means for hiring timelines and backgrounds",
    status: "to_contact",
    relationshipStrength: "warm",
    targetOrg: "Ofcom",
    targetRole: "AI governance / policy roles",
    askType: "advice",
  } as any);

  const task = {
    title: "Prepare for coffee with James at Ofcom",
    category: "admin",
    sourceType: "contact",
    sourceId: contact.id,
    sourceNote: "Priya referred me. I want to ask about AI governance expansion, hiring timelines, and what backgrounds they are hiring.",
    doneWhen: "A short prep note and specific questions are ready",
    minimumOutcome: "Three good questions and a clear angle are ready",
    sourceUrl: "",
  } as any;

  const userContext = await buildUserContext();
  const bundle = await buildSourceContext(task, userContext);
  const prompt = buildTaskBreakdownPrompt({ task, bundle, fallbackObject: "Pipeline" });

  assert.match(prompt, /For contact conversation prep:/i);
  assert.match(prompt, /prepare a short prep note, not an outreach draft/i);
  assert.match(prompt, /Turn the facts already provided into 3-5 specific questions/i);
  assert.match(prompt, /If a referral path, target role, hiring question, or team context already exists, use it directly/i);
});

test("weak generic task notes are ignored so prompt context falls back to structured Anchor data", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildSourceContext, buildTaskBreakdownPrompt } = await import("./taskBreakdownRoutes");
  const { buildUserContext } = await import("./userContext");
  const { storage } = await import("./storage");

  const track = await storage.createCareerTrack({
    name: "AI Governance",
    slug: "ai-governance",
    targetRoleArchetype: "policy",
    priority: 5,
    status: "active",
  } as any);
  const job = await storage.createJob({
    title: "Policy Advisor",
    company: "Ofcom",
    status: "wishlist",
    applicationReadiness: "cv",
    relatedTrackId: track.id,
    deadline: "2026-06-30",
  } as any);

  const task = {
    title: "Write cover letter for Policy Advisor at Ofcom",
    category: "job",
    sourceType: "job",
    sourceId: job.id,
    sourceNote: "Working note from June",
    doneWhen: "A tailored cover letter draft exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const userContext = await buildUserContext();
  const bundle = await buildSourceContext(task, userContext);
  const prompt = buildTaskBreakdownPrompt({ task, bundle, fallbackObject: "Artifact" });

  assert.doesNotMatch(bundle.sourceContext || "", /Working note from June/i);
  assert.match(bundle.sourceContext || "", /Policy Advisor at Ofcom/i);
  assert.match(prompt, /Use available context to create specific actions, not generic advice/i);
  assert.match(prompt, /Steps must use real content from context above/i);
  assert.match(prompt, /APPLICATION WORKFLOW GUIDANCE/i);
});

test("job cover-letter fallback uses the stored narrative angle and strongest role signals", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const job = await storage.createJob({
    title: "Policy Advisor",
    company: "Ofcom",
    status: "wishlist",
    applicationReadiness: "cv",
    narrativeAngle: "Translate technical AI risk into proportionate regulation language",
    note: "Prioritise stakeholder judgement and policy translation.",
    jdText: "Candidates should translate technical risk into policy language and work across stakeholder groups.",
  } as any);

  const task = {
    title: "Write cover letter for Policy Advisor at Ofcom",
    category: "job",
    sourceType: "job",
    sourceId: job.id,
    sourceNote: "",
    doneWhen: "A tailored cover letter draft exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { workflowState, steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.equal(workflowState.currentStage, "Build materials");
  assert.match(joined, /Open your CV and the role posting side by side/i);
  assert.match(joined, /Highlight repeated role keywords/i);
  assert.match(joined, /Rewrite the first matching bullet/i);
  assert.match(joined, /Save the next bullet to update later/i);
  assert.doesNotMatch(joined, /review notes|research Ofcom/i);
});

test("global breakdown prompt sets a quality bar against generic filler and for immediately startable actions", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildSourceContext, buildTaskBreakdownPrompt } = await import("./taskBreakdownRoutes");
  const { buildUserContext } = await import("./userContext");
  const { storage } = await import("./storage");

  const job = await storage.createJob({
    title: "Policy Advisor",
    company: "Ofcom",
    status: "wishlist",
    applicationReadiness: "cv",
  } as any);

  const task = {
    title: "Write cover letter for Policy Advisor at Ofcom",
    category: "job",
    sourceType: "job",
    sourceId: job.id,
    sourceNote: "",
    doneWhen: "A tailored cover letter draft exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const userContext = await buildUserContext();
  const bundle = await buildSourceContext(task, userContext);
  const prompt = buildTaskBreakdownPrompt({ task, bundle, fallbackObject: "Artifact" });

  assert.match(prompt, /The first step must be immediately startable and produce a visible result/i);
  assert.match(prompt, /Use available context to create specific actions, not generic advice or a restatement of the context/i);
  assert.match(prompt, /Avoid filler like review notes, do research, take notes, or summarize unless the task is genuinely research-heavy/i);
  assert.match(prompt, /Maximum 5 steps\. If fewer suffice, use fewer/i);
});

test("job breakdown sees linked contacts even when the job has no track", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const job = await storage.createJob({
    title: "Strategy Manager",
    company: "OpenAI",
    status: "applied",
    applicationReadiness: "follow_up",
    relatedTrackId: null,
  } as any);
  const contact = await storage.createContact({
    name: "Alex Chen",
    who: "OpenAI hiring team",
    why: "Can flag the application internally",
    status: "replied",
    relationshipStrength: "strong",
    targetOrg: "OpenAI",
  } as any);
  await storage.linkContactToJob(contact.id, job.id);

  const task = {
    title: "Follow up on the OpenAI application",
    category: "job",
    sourceType: "job",
    sourceId: job.id,
    sourceNote: "",
    doneWhen: "The next follow-up move is clear",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { bundle, steps } = await buildDeterministicTaskBreakdown(task);

  assert.match(bundle.crossEngineContext || "", /Alex Chen|OpenAI/);
  assert.match(steps.map((step) => String(step.text || "")).join(" | "), /Open the application thread and find the next follow-up action/i);
});

test("learn breakdown includes active capability gaps for the related career focus", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const track = await storage.createCareerTrack({
    name: "AI Governance",
    slug: "ai-governance",
    targetRoleArchetype: "policy",
    priority: 5,
    status: "active",
  } as any);
  const learn = await storage.createLearn({
    title: "EU AI Act reading notes",
    type: "resource",
    relatedTrackId: track.id,
    active: true,
    learnStatus: "active",
    requiredOutput: "A short note on the main obligations",
  } as any);

  const task = {
    title: "Pull together notes on the EU AI Act",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    relatedTrackId: track.id,
    sourceNote: "",
    doneWhen: "A short note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { bundle } = await buildDeterministicTaskBreakdown(task);

  assert.match(bundle.crossEngineContext || "", /Capability areas still worth strengthening/i);
  assert.match(bundle.crossEngineContext || "", /AI Governance|Relevant career focus/i);
});

test("learn fallback uses targeted extraction instructions instead of vague reading prompts", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const track = await storage.createCareerTrack({
    name: "AI Policy",
    slug: "ai-policy",
    targetRoleArchetype: "policy",
    priority: 5,
    status: "active",
  } as any);
  await storage.createJob({
    title: "AI Policy Associate",
    company: "Centre for AI Safety",
    status: "wishlist",
    applicationReadiness: "cv",
    relatedTrackId: track.id,
    deadline: "2026-06-21",
  } as any);
  const learn = await storage.createLearn({
    title: "EU AI Act synthesis note",
    type: "resource",
    relatedTrackId: track.id,
    active: true,
    learnStatus: "active",
    requiredOutput: "A one-page note on obligations relevant to frontier AI labs",
    capabilityBuilt: "AI governance synthesis",
  } as any);

  const task = {
    title: "Pull together the EU AI Act note",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    relatedTrackId: track.id,
    sourceNote: "",
    doneWhen: "A usable note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { bundle, steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.match(bundle.crossEngineContext || "", /AI Policy Associate at Centre for AI Safety/i);
  assert.match(bundle.crossEngineContext || "", /due 21 Jun/i);
  assert.match(joined, /Search for or open the most relevant resource on/i);
  assert.match(joined, /Write one useful takeaway in your own words/i);
  assert.match(joined, /Write the one output or decision this should support/i);
  assert.match(joined, /Stop once you have that one useful note/i);
});

test("learn fallback with weak notes does not lean on noisy working-note title fragments", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const track = await storage.createCareerTrack({
    name: "AI Governance",
    slug: "ai-governance-weak-note",
    targetRoleArchetype: "policy",
    priority: 5,
    status: "active",
  } as any);
  await storage.createJob({
    title: "Policy Advisor",
    company: "Ofcom",
    status: "wishlist",
    applicationReadiness: "cv",
    relatedTrackId: track.id,
  } as any);
  const learn = await storage.createLearn({
    title: "EU AI Act working note",
    type: "resource",
    relatedTrackId: track.id,
    active: true,
    learnStatus: "active",
    note: "Working note from June",
    requiredOutput: "A short note on obligations relevant to frontier AI labs",
    capabilityBuilt: "AI governance synthesis",
  } as any);

  const task = {
    title: "Pull together the EU AI Act note",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    relatedTrackId: track.id,
    sourceNote: "",
    doneWhen: "A usable note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.match(joined, /Search for or open the most relevant resource on/i);
  assert.match(joined, /Write one useful takeaway in your own words/i);
  assert.doesNotMatch(joined, /Working note from June|EU AI Act working|EU AI Act w/i);
});

test("learn fallback reuses stored note phrases when they exist", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const track = await storage.createCareerTrack({
    name: "AI Governance",
    slug: "ai-governance-notes",
    targetRoleArchetype: "policy",
    priority: 4,
    status: "active",
  } as any);
  const learn = await storage.createLearn({
    title: "EU AI Act working note",
    type: "resource",
    relatedTrackId: track.id,
    active: true,
    learnStatus: "active",
    note: "Focus on high-risk systems; transparency duties; GPAI obligations.",
    requiredOutput: "A short note for application prep",
  } as any);

  const task = {
    title: "Use the EU AI Act note for application prep",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    relatedTrackId: track.id,
    sourceNote: "",
    doneWhen: "A short prep note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.match(joined, /Search for or open the most relevant resource on/i);
  assert.match(joined, /Write one useful takeaway in your own words/i);
  assert.match(joined, /Stop once you have that one useful note/i);
  assert.doesNotMatch(joined, /EU AI Act working;/i);
});

test("learn source context includes stored output state and attached curriculum when available", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const track = await storage.createCareerTrack({
    name: "AI Governance",
    slug: "ai-governance-curriculum",
    targetRoleArchetype: "policy",
    priority: 4,
    status: "active",
  } as any);
  const recommendation = await storage.createRecommendation({
    collection: "learning-corpus",
    kind: "learning-theme",
    status: "accepted",
    source: "system",
    title: "EU AI Act deep dive",
    whySuggested: "Needed for current roles",
    linkedTrackId: track.id,
    linkedGapKey: "ai-governance",
    linkedCombination: "",
    freshnessLabel: "",
    sourceLabel: "Anchor",
    sourceUrl: "https://example.com/eu-ai-act",
    rankScore: 10,
    rankReason: "test",
    executionShape: "milestone-arc",
    acceptanceEntityType: "learn",
    acceptanceDraft: "{}",
    confidenceScore: null,
    duplicateOfId: null,
  } as any);
  await storage.createRecommendationSubdivision({
    recommendationId: recommendation.id,
    subdivisionKey: "risk-tiers",
    label: "Risk tiers and scope",
    whyItMatters: "Core concept",
    suggestedMaterials: "[]",
    sequence: 1,
  } as any);
  await storage.createRecommendationMilestone({
    recommendationId: recommendation.id,
    milestoneKey: "extract-obligations",
    label: "Extract the core obligations",
    doneWhen: "A short obligations note exists",
    status: "active",
    sequence: 1,
    suggestedTaskTitle: "Pull the core obligations into a short note",
    subdivisionKey: "risk-tiers",
    milestoneType: "content",
    scaffolding: "",
    completionNote: "",
  } as any);
  const learn = await storage.createLearn({
    title: "EU AI Act working note",
    type: "resource",
    relatedTrackId: track.id,
    active: true,
    learnStatus: "active",
    sourceType: "recommendation",
    sourceId: recommendation.id,
    url: "https://example.com/eu-ai-act",
    note: "Working note for current applications.",
    requiredOutput: "A short note for application prep",
    outputTitle: "EU AI Act obligations note",
    outputStatus: "drafting",
    outputEvidenceUrl: "https://example.com/eu-ai-act-note",
  } as any);

  const task = {
    title: "Finish the EU AI Act obligations note",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    relatedTrackId: track.id,
    sourceNote: "",
    doneWhen: "A usable note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { bundle } = await buildDeterministicTaskBreakdown(task);

  assert.match(bundle.sourceContext || "", /Current saved output title: EU AI Act obligations note/i);
  assert.match(bundle.sourceContext || "", /Current output state: drafting/i);
  assert.match(bundle.sourceContext || "", /Existing saved output link: https:\/\/example.com\/eu-ai-act-note/i);
  assert.match(bundle.sourceContext || "", /Stored topic breakdown: Risk tiers and scope/i);
  assert.match(bundle.sourceContext || "", /Stored checkpoints: Extract the core obligations/i);
});

test("learn fallback with generic notes still tells you what sections to look for", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const learn = await storage.createLearn({
    title: "EU AI Act research note",
    type: "resource",
    active: true,
    learnStatus: "active",
    note: "Working note from June.",
    requiredOutput: "A short note on GPAI obligations for frontier AI labs",
  } as any);

  const task = {
    title: "Use the EU AI Act research note for the next application",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    sourceNote: "",
    doneWhen: "A usable note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { steps } = await buildDeterministicTaskBreakdown(task);
  const joined = steps.map((step) => String(step.text || "")).join(" | ");

  assert.match(joined, /Search for or open the most relevant resource on/i);
  assert.match(joined, /Write one useful takeaway in your own words/i);
  assert.doesNotMatch(joined, /find the most relevant part|write the key insight/i);
});

test("learn breakdown carries recent completed work into prompt context when it exists", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  const { buildDeterministicTaskBreakdown } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const track = await storage.createCareerTrack({
    name: "AI Governance",
    slug: "ai-governance-recent-work",
    targetRoleArchetype: "policy",
    priority: 4,
    status: "active",
  } as any);
  const completedTask = await storage.createTask({
    title: "Summarise AI risk-tier definitions",
    category: "learning",
    status: "done",
    done: true,
    relatedTrackId: track.id,
    doneWhen: "A short summary exists",
    sourceType: "learn",
    sourceId: 9999,
  } as any);
  await storage.logActivity({
    eventType: "completed",
    sourceType: "task",
    sourceId: completedTask.id,
    taskId: completedTask.id,
    planItemId: null,
    metadata: "{}",
  } as any);
  const learn = await storage.createLearn({
    title: "EU AI Act research brief",
    type: "resource",
    relatedTrackId: track.id,
    active: true,
    learnStatus: "active",
    requiredOutput: "A short note on GPAI obligations",
  } as any);

  const task = {
    title: "Draft the AI Act research brief",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    relatedTrackId: track.id,
    sourceNote: "",
    doneWhen: "A short note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const { bundle } = await buildDeterministicTaskBreakdown(task);

  assert.match(bundle.crossEngineContext || "", /Recently completed work: Summarise AI risk-tier definitions/i);
});

test("linked Notion-style source URLs do not create user-authored context unless explicit context is provided", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  process.env.NOTION_API_KEY = "test-token";
  process.env.ANCHOR_NOTION_ALLOWED_PAGE_IDS = "11111111-1111-1111-1111-111111111111";
  delete process.env.ANCHOR_NOTION_ALLOWED_PARENT_IDS;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/pages/11111111-1111-1111-1111-111111111111")) {
      return new Response(JSON.stringify({
        id: "11111111-1111-1111-1111-111111111111",
        url: "https://www.notion.so/EU-AI-Act-working-note-11111111111111111111111111111111",
        last_edited_time: "2026-06-18T12:00:00.000Z",
        parent: { page_id: "99999999-9999-9999-9999-999999999999" },
        properties: {
          Name: { type: "title", title: [{ plain_text: "EU AI Act working note" }] },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/blocks/11111111-1111-1111-1111-111111111111/children")) {
      return new Response(JSON.stringify({
        results: [
          { type: "heading_2", heading_2: { rich_text: [{ plain_text: "Overview" }] } },
          { type: "paragraph", paragraph: { rich_text: [{ plain_text: "General background note." }] } },
          { type: "heading_2", heading_2: { rich_text: [{ plain_text: "GPAI obligations" }] } },
          { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Use the GPAI section for current applications." }] } },
          { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "GPAI obligations" }] } },
          { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Draft: Turn this into 5 bullets for the application." }] } },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as any;

  try {
    const { buildSourceContext, buildTaskBreakdownPrompt } = await import("./taskBreakdownRoutes");
    const { collectTaskBreakdownContext } = await import("./contextProviders");
    const { buildUserContext } = await import("./userContext");
    const { storage } = await import("./storage");

    const learn = await storage.createLearn({
      title: "EU AI Act research brief",
      type: "resource",
      active: true,
      learnStatus: "active",
      outputEvidenceUrl: "https://www.notion.so/EU-AI-Act-working-note-11111111111111111111111111111111",
      note: "Focus on GPAI obligations for current applications.",
      requiredOutput: "A short note on GPAI obligations for application prep",
    } as any);

    const task = {
      title: "Use the AI Act note for the next application",
      category: "learning",
      sourceType: "learn",
      sourceId: learn.id,
      sourceNote: "",
      doneWhen: "A short note exists",
      minimumOutcome: "",
      sourceUrl: "",
    } as any;

    const userContext = await buildUserContext();
    const bundle = await buildSourceContext(task, userContext);
    const collected = await collectTaskBreakdownContext({
      task,
      sourceBundle: bundle,
      userAuthoredContext: "",
    });
    const prompt = buildTaskBreakdownPrompt({
      task,
      bundle,
      fallbackObject: "Knowledge",
      contextBlocks: collected.blocks,
    });

    assert.equal(collected.blocks.userAuthored?.length || 0, 0);
    assert.doesNotMatch(prompt, /User-authored context \(higher priority than external research\):/i);
    assert.match(prompt, /Do not assume page content beyond what is shown/i);
    assert.match(prompt, /Optional useful result: A short note on GPAI obligations for application prep/i);
    assert.match(prompt, /Existing saved output link: https:\/\/www\.notion\.so\//i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.NOTION_API_KEY;
    delete process.env.ANCHOR_NOTION_ALLOWED_PAGE_IDS;
    delete process.env.ANCHOR_NOTION_ALLOWED_PARENT_IDS;
  }
});

test("collectTaskBreakdownContext stays empty when there is no linked provider context", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-${process.pid}.db`);
  delete process.env.NOTION_API_KEY;
  delete process.env.ANCHOR_NOTION_ALLOWED_PAGE_IDS;
  delete process.env.ANCHOR_NOTION_ALLOWED_PARENT_IDS;

  const { buildSourceContext } = await import("./taskBreakdownRoutes");
  const { collectTaskBreakdownContext } = await import("./contextProviders");
  const { buildUserContext } = await import("./userContext");
  const { storage } = await import("./storage");

  const learn = await storage.createLearn({
    title: "Plain local learning item",
    type: "resource",
    active: true,
    learnStatus: "active",
    note: "Stored locally only.",
    requiredOutput: "A short note",
  } as any);

  const task = {
    title: "Use the local note",
    category: "learning",
    sourceType: "learn",
    sourceId: learn.id,
    sourceNote: "",
    doneWhen: "A short note exists",
    minimumOutcome: "",
    sourceUrl: "",
  } as any;

  const userContext = await buildUserContext();
  const bundle = await buildSourceContext(task, userContext);
  const collected = await collectTaskBreakdownContext({
    task,
    sourceBundle: bundle,
    userAuthoredContext: "",
  });

  assert.equal(collected.blocks.userAuthored?.length || 0, 0);
  assert.equal(collected.blocks.externalResearch?.length || 0, 0);
});

test("isAtomicTask identifies simple single-action tasks", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-atomic-${process.pid}.db`);
  const { isAtomicTask: isAtomic } = await import("./taskBreakdownRoutes");

  const base = { title: "", sourceType: "", size: "medium" } as any;
  assert.equal(isAtomic({ ...base, title: "Send Sarah the doc" }), true);
  assert.equal(isAtomic({ ...base, title: "Email the team about Friday" }), true);
  assert.equal(isAtomic({ ...base, title: "Reply to the recruiter" }), true);
  assert.equal(isAtomic({ ...base, title: "Check the deadline" }), true);
  assert.equal(isAtomic({ ...base, title: "Pay the invoice" }), true);

  assert.equal(isAtomic({ ...base, title: "Apply to McKinsey" }), false, "apply is not atomic — needs real breakdown");
  assert.equal(isAtomic({ ...base, title: "Prepare for the interview" }), false, "prepare is multi-step");
  assert.equal(isAtomic({ ...base, title: "Research the company" }), false, "research is multi-step");
  assert.equal(isAtomic({ ...base, title: "Send Sarah the doc", sourceType: "job" }), false, "job-linked tasks always get full breakdown");
  assert.equal(isAtomic({ ...base, title: "Send the draft", size: "deep" }), false, "deep tasks always get full breakdown");
});

test("buildSourceContext includes company brief for job tasks", async () => {
  process.env.ANCHOR_DB_PATH = process.env.ANCHOR_DB_PATH || path.join(os.tmpdir(), `anchor-breakdown-brief-${process.pid}.db`);
  const { buildSourceContext } = await import("./taskBreakdownRoutes");
  const { storage } = await import("./storage");

  const brief = JSON.stringify({
    whatTheyDo: "McKinsey advises Fortune 500 companies on strategy and operations",
    relevantTeam: "Digital & Analytics practice",
    whyYouFit: "Your consulting background maps directly to their transformation work",
    landscape: {
      competitors: ["BCG", "Bain"],
      alsoConsider: ["Deloitte Strategy"],
      marketContext: "Strategy consulting hiring is up 15% this year",
    },
    outreachSuggestions: [{ archetype: "SIPA alum at McKinsey", why: "Alumni network", searchTip: "LinkedIn" }],
    prepAngle: "Read their latest Digital report on AI adoption",
  });

  const job = await storage.createJob({
    title: "Strategy Consultant",
    company: "McKinsey",
    url: "",
    status: "interested",
    companyBrief: brief,
  } as any);

  const task = {
    id: 9999,
    title: "Apply to McKinsey Strategy role",
    sourceType: "job",
    sourceId: job.id,
    category: "job",
    doneWhen: "Application submitted",
    minimumOutcome: "",
    sourceUrl: "",
    sourceNote: "",
    steps: "[]",
  } as any;

  const bundle = await buildSourceContext(task);
  assert.ok(bundle.sourceContext.includes("COMPANY INTELLIGENCE"), "source context should include company intel section");
  assert.ok(bundle.sourceContext.includes("McKinsey advises"), "should include whatTheyDo");
  assert.ok(bundle.sourceContext.includes("Digital & Analytics"), "should include relevantTeam");
  assert.ok(bundle.sourceContext.includes("consulting background"), "should include whyYouFit");
  assert.ok(bundle.sourceContext.includes("BCG"), "should include competitors");
  assert.ok(bundle.sourceContext.includes("Read their latest"), "should include prepAngle");
});
