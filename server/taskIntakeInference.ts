function containsAny(text: string, terms: string[]) {
  const t = (text || "").toLowerCase();
  return terms.some((term) => t.includes(term));
}

type IntakeStep = {
  text: string;
  done: boolean;
  estimateMinutes?: number;
};

function isNetworkingTask(title: string) {
  return containsAny(title, ["reach out", "follow up", "follow-up", "intro", "introduce", "reconnect", "contact", "network", "referral", "coffee chat", "coffee"]);
}

function isRoleResearchTask(title: string) {
  return containsAny(title, ["role", "roles", "job", "jobs", "posting", "postings"])
    && containsAny(title, ["review", "compare", "inspect", "research", "search", "shortlist", "map"]);
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

function isDeadlineTask(title: string) {
  return containsAny(title, ["deadline", "due", "closes", "closing", "submit by"]);
}

function isBlockedTask(title: string, blockerReason?: string) {
  return !!String(blockerReason || "").trim()
    || containsAny(title, ["blocked", "stuck", "waiting on", "waiting for", "need from", "missing info", "depends on"]);
}

function isWaitingTask(title: string) {
  return containsAny(title, ["waiting on", "waiting for"]);
}

function isDecisionTask(title: string) {
  return containsAny(title, ["figure out", "decide", "clarify", "choose"]);
}

function isLearningTask(title: string) {
  return containsAny(title, ["read", "course", "learn", "study", "book"]);
}

function isWritingTask(title: string) {
  return containsAny(title, ["article", "substack", "post", "memo", "essay", "draft", "outline", "write"]);
}

function isReviewTask(title: string) {
  return containsAny(title, ["review", "edit", "revise", "finish"]);
}

function toSteps(steps: Array<[text: string, estimateMinutes?: number]>): string {
  return JSON.stringify(steps.map(([text, estimateMinutes]) => ({
    text,
    done: false,
    ...(estimateMinutes ? { estimateMinutes } : {}),
  } satisfies IntakeStep)));
}

export function intakeWords(text: string) {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
}

export function inferTaskCategory(title: string, current?: string) {
  if (current && current !== "admin") return current;
  if (containsAny(title, ["cv", "cover", "application", "apply", "interview", "role", "job", "fellowship"])) return "job";
  if (containsAny(title, ["read", "course", "learn", "study", "book", "certificate"])) return "learning";
  if (containsAny(title, ["article", "substack", "post", "memo", "essay", "publish", "draft"])) return "substack";
  if (containsAny(title, ["workout", "walk", "sleep", "meal", "gym"])) return "health";
  return current || "admin";
}

export function inferTaskEstimate(title: string, current?: string) {
  if (current === "quick") return { size: "quick", minutes: 15, reason: "user_marked_quick" };
  if (current === "medium") return { size: "medium", minutes: 45, reason: "user_marked_medium" };
  if (current === "deep") return { size: "deep", minutes: 90, reason: "user_marked_deep" };
  if (containsAny(title, ["open", "check", "confirm", "send", "email", "message", "reply", "book", "pay", "list", "note", "skim", "find"])) return { size: "quick", minutes: 15, reason: "quick_action_keyword" };
  if (containsAny(title, ["write", "draft", "apply", "prepare", "research", "tailor", "build", "finish", "review", "outline"])) return { size: "deep", minutes: 90, reason: "deep_work_keyword" };
  return { size: "medium", minutes: 45, reason: "default_medium" };
}

export function inferDoneWhen(title: string, category: string) {
  if (isBlockedTask(title)) return "The blocker and next unblock action are written down";
  if (isDeadlineTask(title)) return "The correct deadline and next timing risk are written down";
  if (containsAny(title, ["email", "message", "reply", "send"])) return "Message is sent";
  if (isNetworkingTask(title)) return "One person and a clear ask are drafted or sent";
  if (isExplicitComparisonTask(title)) return "A short comparison note and the next choice are written down";
  if (isRoleResearchTask(title)) return "At least two real role examples are saved with the main patterns or requirements they share";
  if (isBroadApplicationTask(title)) return "One application move is completed for the strongest live role";
  if (isComparisonTask(title)) return "A short comparison note and the next choice are written down";
  if (isDecisionTask(title)) return "A clear decision or next action is written down";
  if (containsAny(title, ["open", "check", "confirm", "find"])) return "You have the answer or next constraint";
  if (containsAny(title, ["cv", "cover", "application", "apply"])) return "Application material is updated or submitted";
  if (isLearningTask(title)) return "One useful note or output exists";
  if (isWritingTask(title)) return "A rough draft or outline exists";
  if (isReviewTask(title)) return "One concrete change, takeaway, or next move is captured";
  if (category === "health") return "The healthy action is done";
  return "The next visible action is complete";
}

function inferStarterSteps(title: string, category: string, currentSteps?: string, blockerReason?: string) {
  const raw = String(currentSteps || "").trim();
  if (raw && raw !== "[]") return raw;

  if (isBlockedTask(title, blockerReason)) {
    return toSteps([
      ["Write what is blocked and what you are waiting for", 5],
      ["Name the missing input, person, or decision", 5],
      ["Choose one unblock move or follow-up", 5],
    ]);
  }
  if (isDeadlineTask(title)) {
    return toSteps([
      ["Open the relevant source and record the exact date", 5],
      ["Write the timing risk or what could make you miss it", 5],
      ["Choose the next move before the deadline", 5],
    ]);
  }
  if (containsAny(title, ["email", "message", "reply", "send"])) {
    return toSteps([
      ["Open the thread and draft the message", 5],
      ["Tighten it to one clear ask or update", 5],
      ["Send it or leave it ready to send", 5],
    ]);
  }
  if (isNetworkingTask(title)) {
    return toSteps([
      ["Pick one person and write the exact ask before you send anything", 5],
      ["Draft a short message with one clear reason and ask", 10],
      ["Send it or save it ready to send", 5],
    ]);
  }
  if (isExplicitComparisonTask(title) || isComparisonTask(title)) {
    return toSteps([
      ["Write the exact options you are comparing", 5],
      ["Choose the 2-3 criteria that matter most", 5],
      ["Write the current lean and what would change your mind", 10],
    ]);
  }
  if (isRoleResearchTask(title)) {
    return toSteps([
      ["Open one search or saved board", 5],
      ["Save the first two relevant roles", 10],
      ["Note the requirement or pattern that keeps coming up", 10],
    ]);
  }
  if (isBroadApplicationTask(title)) {
    return toSteps([
      ["Open the strongest live role and check its current stage", 5],
      ["Choose the next application move that would actually advance it", 10],
      ["Do that move now or leave it clearly queued", 15],
    ]);
  }
  if (isDecisionTask(title)) {
    return toSteps([
      ["Write the exact question you need to answer", 5],
      ["List the one missing fact or signal that matters most", 5],
      ["Write the next test, decision, or move", 10],
    ]);
  }
  if (containsAny(title, ["cv", "cover", "application", "apply"])) {
    return toSteps([
      ["Open the role and the current application material", 5],
      ["Mark the one section that most needs changing", 5],
      ["Make the first concrete edit or submission move", 15],
    ]);
  }
  if (isLearningTask(title)) {
    return toSteps([
      ["Open the item and read only the first section", 10],
      ["Capture 3 bullets or one useful note", 10],
      ["Write one reusable takeaway or question", 5],
    ]);
  }
  if (isReviewTask(title)) {
    return toSteps([
      ["Open the draft, notes, or source", 5],
      ["Mark the first concrete change or takeaway", 5],
      ["Make that change or write the takeaway", 15],
    ]);
  }
  if (isWritingTask(title)) {
    return toSteps([
      ["Open a blank doc and sketch the rough outline", 10],
      ["Write three bullets or section headings", 10],
      ["Draft the rough first pass without polishing", 20],
    ]);
  }
  if (containsAny(title, ["check", "confirm", "find"])) {
    return toSteps([
      ["Open the relevant source and look for the missing fact", 5],
      ["Write down the answer or constraint", 5],
    ]);
  }
  if (category === "health") {
    return toSteps([
      ["Start the smallest version that still counts", 5],
    ]);
  }
  return toSteps([
    ["Open the task and name the smallest useful outcome", 5],
    ["Do the first visible action", 10],
  ]);
}

function inferReadiness(title: string, raw?: { readiness?: string; blockerReason?: string }) {
  if (raw?.readiness) return raw.readiness;
  if (raw?.blockerReason) return "blocked";
  if (isWaitingTask(title)) return "waiting";
  if (isBlockedTask(title, raw?.blockerReason)) return "blocked";
  return "ready";
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
  const estimate = inferTaskEstimate(title, raw?.size);
  const doneWhen = raw?.doneWhen || inferDoneWhen(title, category);
  return {
    title,
    category,
    size: raw?.size || estimate.size,
    estimateMinutes: raw?.estimateMinutes ?? estimate.minutes,
    estimateConfidence: raw?.estimateConfidence || "low",
    estimateReason: raw?.estimateReason || `intake_guess:${estimate.reason}`,
    doneWhen,
    steps: inferStarterSteps(title, category, raw?.steps, raw?.blockerReason),
    minimumOutcome: raw?.minimumOutcome || doneWhen,
    readiness: inferReadiness(title, raw),
    status: raw?.status || "not_started",
  };
}
