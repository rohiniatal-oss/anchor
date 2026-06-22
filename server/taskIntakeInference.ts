import { llmJSON, MODEL_LIGHT } from "./llm";
import { storage } from "./storage";
import { contractForTaskIntent, inferTaskIntent } from "./taskIntent";
import { isGenericContactPlaceholder, nextContactTaskTitle } from "@shared/taskPreview";

function containsAny(text: string, terms: string[]) {
  const t = (text || "").toLowerCase();
  return terms.some((term) => t.includes(term));
}

function isNetworkingTask(title: string) {
  return containsAny(title, ["reach out", "follow up", "follow-up", "intro", "introduce", "reconnect", "contact", "network", "referral", "coffee chat", "coffee"]);
}

function isRoleResearchTask(title: string) {
  return containsAny(title, ["role", "roles", "job", "jobs", "posting", "postings"])
    && containsAny(title, ["review", "compare", "inspect", "research", "search", "shortlist", "map", "explore"]);
}

function isBroadApplicationTask(title: string) {
  return containsAny(title, ["apply to jobs", "apply to roles", "apply to several", "apply for jobs", "apply for roles", "job search", "search roles"]);
}

function isComparisonTask(title: string) {
  return containsAny(title, ["compare", "comparison", "pros and cons", "trade-off", "tradeoff", "weigh"]);
}

function isExplicitComparisonTask(title: string) {
  return /\bvs\b|versus/i.test(title) || containsAny(title, ["pros and cons", "trade-off", "tradeoff", "weigh"]);
}

export function intakeWords(text: string) {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
}

export function inferTaskCategory(title: string, current?: string) {
  const intentContract = contractForTaskIntent({ title, category: current });
  if (intentContract.intent !== "admin_action") return intentContract.category;
  if (current && current !== "admin") return current;
  const hasJobSignal = containsAny(title, ["cv", "cover", "application", "apply", "interview", "role", "job", "fellowship", "hiring"]);
  const hasThinkingVerb = containsAny(title, ["think", "reflect", "direction", "options", "decide", "consider"]);
  if (hasThinkingVerb && !hasJobSignal) return "thinking";
  if (hasJobSignal) return "job";
  if (containsAny(title, ["read", "course", "learn", "study", "book", "certificate", "practice", "skill"])) return "learning";
  if (containsAny(title, ["article", "substack", "post", "memo", "essay", "publish", "draft"])) return "substack";
  if (containsAny(title, ["workout", "walk", "sleep", "meal", "gym"])) return "health";
  if (containsAny(title, ["think", "plan", "reflect", "strategy", "direction", "explore", "options", "decide", "consider"])) return "thinking";
  return current || "admin";
}

export function inferTaskEstimate(title: string, current?: string) {
  if (current === "quick") return { size: "quick", minutes: 15, reason: "user_marked_quick" };
  if (current === "medium") return { size: "medium", minutes: 45, reason: "user_marked_medium" };
  if (current === "deep") return { size: "deep", minutes: 90, reason: "user_marked_deep" };
  const intent = inferTaskIntent({ title });
  if (intent === "role_market_scan") return { size: "medium", minutes: 45, reason: "role_market_scan" };
  if (intent === "application_material" || intent === "interview_prep" || intent === "proof_asset") return { size: "deep", minutes: 90, reason: `intent:${intent}` };
  if (intent === "networking_message" || intent === "status_update" || intent === "blocked_unblock") return { size: "quick", minutes: 15, reason: `intent:${intent}` };
  if (intent === "learning_output") return { size: "medium", minutes: 45, reason: "intent:learning_output" };
  if (intent === "decision" || intent === "comparison") return { size: "quick", minutes: 20, reason: `intent:${intent}` };
  if (containsAny(title, ["open", "check", "confirm", "send", "email", "message", "reply", "book", "pay", "list", "note", "skim", "find"])) return { size: "quick", minutes: 15, reason: "quick_action_keyword" };
  if (containsAny(title, ["write", "draft", "apply", "prepare", "research", "tailor", "build", "finish", "review", "outline"])) return { size: "deep", minutes: 90, reason: "deep_work_keyword" };
  if (containsAny(title, ["think", "plan", "reflect", "consider", "explore", "decide"])) return { size: "quick", minutes: 20, reason: "thinking_task" };
  return { size: "medium", minutes: 45, reason: "default_medium" };
}

export function inferDoneWhen(title: string, category: string) {
  if (containsAny(title, ["email", "message", "reply", "send"])) return "Message is sent";
  if (containsAny(title, ["deadline", "due", "closes", "closing", "submit by"])) return "The correct deadline and next timing risk are written down";
  if (containsAny(title, ["blocked", "stuck", "waiting on", "waiting for", "need from", "missing info", "depends on"])) return "The blocker and next unblock action are written down";
  const intentContract = contractForTaskIntent({ title, category });
  if (intentContract.intent !== "admin_action") return intentContract.doneWhen;
  if (isNetworkingTask(title)) return "One person and a clear ask are drafted or sent";
  if (isExplicitComparisonTask(title)) return "A short comparison note and the next choice are written down";
  if (isRoleResearchTask(title)) return "At least two real role examples are saved with the main patterns or requirements they share";
  if (isBroadApplicationTask(title)) return "One application move is completed for the strongest live role";
  if (isComparisonTask(title)) return "A short comparison note and the next choice are written down";
  if (containsAny(title, ["figure out", "decide", "clarify", "choose"])) return "A clear decision or next action is written down";
  if (containsAny(title, ["open", "check", "confirm", "find"])) return "You have the answer or next constraint";
  if (containsAny(title, ["cv", "cover", "application", "apply"])) return "Application material is updated or submitted";
  if (containsAny(title, ["read", "course", "learn", "study", "book"])) return "One useful note or output exists";
  if (containsAny(title, ["article", "substack", "post", "memo", "essay", "draft"])) return "A rough draft or outline exists";
  if (category === "health") return "The healthy action is done";
  if (containsAny(title, ["think", "plan", "reflect", "consider", "explore", "direction", "strategy", "options"])) return "You have a clearer next step written down";
  return "You've done something concrete, even if small";
}

function inferFirstStep(title: string, category: string) {
  if (containsAny(title, ["email", "message", "reply", "send"])) return "Open the thread and draft the message";
  if (containsAny(title, ["deadline", "due", "closes", "closing", "submit by"])) return "Open the relevant source and record the exact date";
  if (containsAny(title, ["blocked", "stuck", "waiting on", "waiting for", "need from", "missing info", "depends on"])) return "Write what is blocked and what would unblock it";
  const intentContract = contractForTaskIntent({ title, category });
  if (intentContract.intent !== "admin_action") return intentContract.firstStep;
  if (isNetworkingTask(title)) return "Pick one person and write the exact ask before you send anything";
  if (isExplicitComparisonTask(title)) return "Write the exact options you are comparing";
  if (isRoleResearchTask(title)) return "Open one search or saved board and save the first two relevant roles";
  if (isBroadApplicationTask(title)) return "Open the strongest live role and choose the next application move";
  if (isComparisonTask(title)) return "Write the exact options you are comparing";
  if (containsAny(title, ["figure out", "decide", "clarify", "choose"])) return "Write the exact question you need to answer";
  if (containsAny(title, ["cv", "cover", "application", "apply"])) return "Open the role and the current application material";
  if (containsAny(title, ["read", "course", "learn", "study", "book"])) return "Open the item and read only the first section";
  if (containsAny(title, ["review", "edit", "revise", "finish"])) return "Open the draft or source and make the first concrete change";
  if (containsAny(title, ["memo", "essay", "article", "substack", "post", "draft", "outline", "write"])) return "Open a blank doc and sketch the rough outline";
  if (containsAny(title, ["check", "confirm", "find"])) return "Open the relevant source and look for the missing fact";
  if (category === "health") return "Start the smallest version that still counts";
  if (containsAny(title, ["think", "plan", "reflect", "consider", "explore", "direction", "strategy", "options"])) return "Open a note and write the one question you are actually trying to answer";
  return null;
}

function normalizeStepTexts(rawSteps?: string) {
  try {
    const parsed = JSON.parse(String(rawSteps || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((step) => String(step?.text || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isWeakLegacyDoneWhen(doneWhen: string, intent: ReturnType<typeof contractForTaskIntent>["intent"]) {
  const text = String(doneWhen || "").trim().toLowerCase();
  if (!text) return true;
  if (intent === "role_market_scan") {
    return /one clear role-family signal is captured|at least two real role examples are saved|main patterns or requirements they share/.test(text);
  }
  if (intent === "networking_message") {
    return /a message is drafted and ready to send|the next visible action is complete|one person and a clear ask are drafted or sent/.test(text);
  }
  return /you've done something concrete|something concrete is done|the next visible action is complete/.test(text);
}

function shouldReplaceWithIntentSteps(rawSteps: string | undefined, contract: ReturnType<typeof contractForTaskIntent>) {
  if (contract.intent === "admin_action") return false;
  const texts = normalizeStepTexts(rawSteps);
  if (!texts.length) return true;
  if (contract.intent === "role_market_scan") {
    return texts.some((text) => /use the finite knowledge workflow|locate the current stage|define this stage output|check completion criteria|break this stage into actions|first thing you need to understand|orient|scope useful slice|find out what's involved|focus on what matters|read \/ watch|pull out the key bits|make sense of it|save what's useful/i.test(text));
  }
  return false;
}

function contractStepsJson(contract: ReturnType<typeof contractForTaskIntent>) {
  return JSON.stringify(contract.steps.map((text) => ({ text, done: false })));
}

export function inferStarterSteps(title: string, category: string, currentSteps?: string) {
  const raw = String(currentSteps || "").trim();
  if (raw && raw !== "[]") return raw;
  const step = inferFirstStep(title, category);
  if (!step) return "[]";
  return JSON.stringify([{ text: step, done: false }]);
}

export function buildTaskIntakeDefaults(raw: {
  title?: string;
  category?: string;
  size?: string;
  estimateMinutes?: number | null;
  estimateConfidence?: string;
  estimateReason?: string;
  doneWhen?: string;
  steps?: string;
  minimumOutcome?: string;
  readiness?: string;
  blockerReason?: string;
  status?: string;
}) {
  const title = String(raw?.title || "").trim();
  const category = inferTaskCategory(title, raw?.category);
  const intentContract = contractForTaskIntent({
    title,
    category,
    sourceType: "task",
    doneWhen: raw?.doneWhen,
    minimumOutcome: raw?.minimumOutcome,
    blockerReason: raw?.blockerReason,
  });
  const estimate = inferTaskEstimate(title, raw?.size);
  const doneWhen = raw?.doneWhen && !isWeakLegacyDoneWhen(raw.doneWhen, intentContract.intent)
    ? raw.doneWhen
    : inferDoneWhen(title, category);
  const steps = shouldReplaceWithIntentSteps(raw?.steps, intentContract)
    ? contractStepsJson(intentContract)
    : inferStarterSteps(title, category, raw?.steps);
  return {
    title,
    category,
    size: raw?.size || estimate.size,
    estimateMinutes: raw?.estimateMinutes ?? estimate.minutes,
    estimateConfidence: raw?.estimateConfidence || "low",
    estimateReason: raw?.estimateReason || `intake_guess:${estimate.reason}`,
    doneWhen,
    steps,
    minimumOutcome: raw?.minimumOutcome && !isWeakLegacyDoneWhen(raw.minimumOutcome, intentContract.intent) ? raw.minimumOutcome : doneWhen,
    readiness: raw?.readiness || (raw?.blockerReason ? "blocked" : "ready"),
    status: raw?.status || "not_started",
  };
}

export async function contextualizeTask(taskId: number): Promise<void> {
  const task = (await storage.getTasks()).find((t) => t.id === taskId);
  if (!task) return;

  const patch: Record<string, any> = {};
  const normalized = buildTaskIntakeDefaults({
    title: task.title,
    category: task.category,
    size: task.size,
    estimateMinutes: task.estimateMinutes,
    estimateConfidence: task.estimateConfidence,
    estimateReason: task.estimateReason,
    doneWhen: task.doneWhen,
    steps: task.steps,
    minimumOutcome: task.minimumOutcome,
    readiness: task.readiness,
    blockerReason: task.blockerReason,
    status: task.status,
  });

  if (normalized.category !== task.category) patch.category = normalized.category;
  if (normalized.doneWhen !== task.doneWhen) patch.doneWhen = normalized.doneWhen;
  if (normalized.minimumOutcome !== task.minimumOutcome) patch.minimumOutcome = normalized.minimumOutcome;
  if (normalized.steps !== task.steps) patch.steps = normalized.steps;

  if (task.sourceType === "job" && task.sourceId) {
    const job = (await storage.getJobs()).find((j) => j.id === task.sourceId);
    if (job) {
      if (!task.category || task.category === "admin") patch.category = "job";
      if (!task.doneWhen) {
        const status = job.status || "wishlist";
        patch.doneWhen = status === "interviewing"
          ? "Interview preparation is stronger than before"
          : status === "applied"
            ? "Follow-up is sent or next step is clear"
            : `Application material for ${job.title} at ${job.company} is improved or submitted`;
      }
    }
  } else if (task.sourceType === "contact" && task.sourceId) {
    const contact = (await storage.getContacts()).find((c) => c.id === task.sourceId);
    if (contact) {
      if (isGenericContactPlaceholder(contact)) {
        const title = nextContactTaskTitle(contact);
        const contract = contractForTaskIntent({
          title,
          category: task.category,
          sourceType: "contact",
          sourceNote: `${task.sourceNote || ""} ${contact.why || contact.note || ""} ${contact.targetOrg || ""} ${contact.targetRole || ""}`,
          doneWhen: task.doneWhen,
          minimumOutcome: task.minimumOutcome,
        });
        if (title !== task.title) patch.title = title;
        patch.doneWhen = contract.doneWhen;
        patch.minimumOutcome = contract.doneWhen;
        if (shouldReplaceWithIntentSteps(task.steps, contract)) patch.steps = contractStepsJson(contract);
      }
      if (!task.doneWhen) {
        patch.doneWhen = contact.status === "messaged" || contact.status === "in_conversation"
          ? `Next step with ${contact.name || "the contact"} is done`
          : `Message to ${contact.name || "the contact"} is drafted or sent`;
      }
    }
  } else if (task.sourceType === "learn" && task.sourceId) {
    const learn = (await storage.getLearn()).find((l) => l.id === task.sourceId);
    if (learn) {
      if (!task.category || task.category === "admin") patch.category = "learning";
      if (!task.doneWhen) {
        patch.doneWhen = learn.requiredOutput
          ? `One useful output exists: ${learn.requiredOutput}`
          : `One useful note or takeaway from ${learn.title}`;
      }
    }
  }

  if (Object.keys(patch).length > 0) {
    await storage.updateTask(taskId, patch);
  }
}

export async function llmEnrichTask(taskId: number): Promise<void> {
  const task = (await storage.getTasks()).find((t) => t.id === taskId);
  if (!task || task.estimateConfidence !== "low") return;
  const result = await llmJSON<{
    category?: string;
    size?: string;
    estimateMinutes?: number;
    doneWhen?: string;
    firstStep?: string;
  }>(
    `Classify this task for a job-searching professional.\n\n` +
    `Task: "${task.title}"\n\n` +
    `Return a JSON object:\n` +
    `- category: one of "job", "learning", "substack", "health", "thinking", "admin" (pick the best fit)\n` +
    `- size: "quick" (under 15 min), "medium" (15-60 min), or "deep" (60+ min)\n` +
    `- estimateMinutes: your best guess in minutes\n` +
    `- doneWhen: a specific, testable completion criterion (not "feels done" but "has written X" or "has sent Y")\n` +
    `- firstStep: the first physical action — something doable in under 2 minutes that produces a visible result`,
    { model: MODEL_LIGHT },
  );
  if (!result) return;
  const patch: any = {};
  if (result.category && ["job", "learning", "substack", "health", "thinking", "admin"].includes(result.category)) {
    patch.category = result.category;
  }
  if (result.size && ["quick", "medium", "deep"].includes(result.size)) patch.size = result.size;
  if (typeof result.estimateMinutes === "number" && result.estimateMinutes > 0) {
    patch.estimateMinutes = result.estimateMinutes;
    patch.estimateConfidence = "medium";
    patch.estimateReason = "llm_enrichment";
  }
  if (result.doneWhen && result.doneWhen.length > 10) patch.doneWhen = result.doneWhen.slice(0, 300);
  if (result.firstStep) {
    patch.steps = JSON.stringify([{ text: result.firstStep.slice(0, 200), done: false }]);
  }
  if (Object.keys(patch).length > 0) {
    await storage.updateTask(taskId, patch);
  }
}
