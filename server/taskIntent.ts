import { LANE_NAME, normalizeLaneName, type CanonicalLaneName } from "./lanes";

export type TaskIntentKind =
  | "role_market_scan"
  | "application_material"
  | "networking_message"
  | "interview_prep"
  | "learning_output"
  | "proof_asset"
  | "comparison"
  | "decision"
  | "status_update"
  | "blocked_unblock"
  | "admin_action";

export type TaskIntentInput = {
  title?: string | null;
  category?: string | null;
  sourceType?: string | null;
  sourceKind?: string | null;
  sourceNote?: string | null;
  doneWhen?: string | null;
  minimumOutcome?: string | null;
  blockerReason?: string | null;
  lane?: string | null;
};

export type TaskIntentContract = {
  intent: TaskIntentKind;
  category: string;
  doneWhen: string;
  firstStep: string;
  steps: string[];
  stopCondition: string;
  maxSteps: number;
};

function textFor(input: TaskIntentInput) {
  return [
    input.title,
    input.category,
    input.sourceType,
    input.sourceKind,
    input.sourceNote,
    input.doneWhen,
    input.minimumOutcome,
    input.blockerReason,
    input.lane,
  ].filter(Boolean).join(" ").toLowerCase();
}

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function isRoleMarketScanInput(input: TaskIntentInput) {
  const text = textFor(input);
  const strategySource = /strategy_builder|career_track|marketability_engine/i.test(String(input.sourceType || ""));
  const taskishSource = !input.sourceKind || input.sourceKind === "task";
  const directionLane = normalizeLaneName(String(input.lane || "")) === LANE_NAME.DIRECTION;
  const roleSignal = /\b(role|roles|job|jobs|posting|postings|hiring|team|teams|application|applications|company|companies)\b/.test(text);
  const scanSignal = /\b(find|search|scan|map|identify|inspect|review|explor|lay of the land|what they ask for|requirements|assess candidates|credible|pattern)\b/.test(text);
  return roleSignal && scanSignal && (strategySource || taskishSource || directionLane);
}

export function inferTaskIntent(input: TaskIntentInput): TaskIntentKind {
  const text = textFor(input);
  if (containsAny(text, ["blocked", "stuck", "waiting on", "waiting for", "need from", "missing info", "depends on"])) return "blocked_unblock";
  if (/\b(mark|set|move|close|closed|archive|rejected|withdrawn|status)\b/.test(text)) return "status_update";
  if (/\b(interview|case study|presentation|panel|mock interview|prep call|written test)\b/.test(text)) return "interview_prep";
  if (/\b(reach out|follow up|follow-up|reply|message|email|intro|introduce|reconnect|contact|network|referral|coffee chat|coffee)\b/.test(text)) return "networking_message";
  if (isRoleMarketScanInput(input)) return "role_market_scan";
  if (/\b(cv|resume|cover|application|apply|answer|question|tailor|submit|materials?)\b/.test(text)) return "application_material";
  if (/\b(read|learn|study|course|book|certificate|practice|drill|skill|resource|synthesis|synthesise|synthesize)\b/.test(text)) return "learning_output";
  if (/\b(article|substack|post|memo|essay|publish|draft|proof|portfolio|case study|project|writing)\b/.test(text)) return "proof_asset";
  if (/\b(compare|comparison|versus| vs |pros and cons|trade-off|tradeoff|weigh)\b/.test(text)) return "comparison";
  if (/\b(figure out|decide|choose|compare|comparison|pros and cons|trade-off|tradeoff|weigh|whether|direction|options|reflect|think)\b/.test(text)) return "decision";
  return "admin_action";
}

export function roleMarketScanLabel(title: string) {
  const cleaned = String(title || "")
    .replace(/^(save|find|review|explore|research|identify|inspect|map)\s+(one|two|three|four|five|1|2|3|4|5|a|an|the)?\s*(real\s+)?/i, "")
    .replace(/\s+and\s+note\s+what.*$/i, "")
    .replace(/\s+and\s+extract\s+what.*$/i, "")
    .replace(/\s+and\s+note\s+the\s+requirements.*$/i, "")
    .replace(/\s+roles?\b.*$/i, " roles")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80) || "the role path";
}

function roleMarketScanSteps(title: string) {
  const rolePath = roleMarketScanLabel(title);
  return [
    `Open LinkedIn or the target job board and search "${rolePath}"`,
    "Save the first real posting that matches the path closely enough to learn from",
    "Extract the 3 repeated requirements or background signals from that posting",
    "Mark which signals you can already evidence and which one is the biggest gap",
    "Stop once one real role and one requirements pattern are captured",
  ];
}

function titleText(title: string) {
  return String(title || "").replace(/\s+/g, " ").trim();
}

function cleanPhrase(value: string) {
  return value
    .replace(/\b(and ask|ask for|asking for|to ask|about|regarding|re:)\b.*$/i, "")
    .replace(/\b(message|email|note|outreach|follow-up|follow up)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function networkingRecipient(title: string) {
  const text = titleText(title);
  const explicit = text.match(/\b(?:to|with)\s+(.+?)(?:\s+\babout\b|\s+\bregarding\b|\s+\bre:\b|\s+\band ask\b|\s+\bfor\b|$)/i);
  if (explicit?.[1]) return cleanPhrase(explicit[1]) || "the contact";
  const reachOut = text.match(/\breach out\s+(.+?)(?:\s+\babout\b|\s+\bregarding\b|\s+\band ask\b|\s+\bfor\b|$)/i);
  if (reachOut?.[1]) return cleanPhrase(reachOut[1]) || "the contact";
  return "the contact";
}

function networkingTopic(title: string) {
  const text = titleText(title);
  const match = text.match(/\babout\s+(.+?)(?:\s+\band ask\b|\s+\bask for\b|\s+\bto ask\b|$)/i)
    || text.match(/\bregarding\s+(.+?)(?:\s+\band ask\b|\s+\bask for\b|\s+\bto ask\b|$)/i);
  const topic = match?.[1]?.replace(/[.?!]+$/g, "").trim();
  return topic || "";
}

function networkingAsk(title: string, topic: string) {
  const text = titleText(title).toLowerCase();
  const about = topic ? ` about ${topic}` : "";
  if (/\b15\b|\bfifteen\b|\bchat\b|\bcoffee\b/.test(text)) return `Ask for a 15-minute chat${about}`;
  if (/\breferral\b|\brefer\b|\bintro\b|\bintroduc/.test(text)) return `Ask for the right referral or introduction path${about}`;
  if (/\badvice\b|\bsteer\b|\bguidance\b/.test(text)) return `Ask for one practical steer${about}`;
  if (/\bfollow[- ]?up\b|\breply\b|\bcheck[- ]?in\b/.test(text)) return `Ask for the clearest next steer${about}`;
  return `Ask for quick advice${about}`;
}

function networkingMessageSteps(title: string) {
  const recipient = networkingRecipient(title);
  const topic = networkingTopic(title);
  const ask = networkingAsk(title, topic);
  const angle = topic
    ? `Use this angle: you are exploring ${topic} and want one practical steer`
    : "Use this angle: you have a specific, low-pressure reason to reconnect now";
  return [
    `Open a blank message to ${recipient}`,
    angle,
    ask,
    "Trim it to 3-4 sentences and save or send it",
  ];
}

export function contractForTaskIntent(input: TaskIntentInput): TaskIntentContract {
  const title = String(input.title || "").trim();
  const intent = inferTaskIntent(input);

  if (intent === "role_market_scan") {
    const steps = roleMarketScanSteps(title);
    return {
      intent,
      category: "job",
      doneWhen: "One real role and one repeated requirements pattern are captured",
      firstStep: steps[0],
      steps,
      stopCondition: steps[4],
      maxSteps: 5,
    };
  }

  if (intent === "networking_message") {
    const steps = networkingMessageSteps(title);
    return { intent, category: "admin", doneWhen: "A message is drafted, sent, or clearly scheduled", firstStep: steps[0], steps, stopCondition: "Stop once the message is drafted, sent, or scheduled", maxSteps: 4 };
  }

  if (intent === "interview_prep") {
    const steps = [
      "Open the interview brief, job description, or notes",
      "Write the format and likely questions in one place",
      "Prepare one strong answer or story for the highest-risk question",
      "Stop once one usable prep note exists",
    ];
    return { intent, category: "job", doneWhen: "One usable interview prep note exists", firstStep: steps[0], steps, stopCondition: steps[3], maxSteps: 4 };
  }

  if (intent === "application_material") {
    const steps = [
      "Open the role and the current application material",
      "Find the first requirement the material does not yet answer",
      "Rewrite one paragraph, answer, or bullet to address it",
      "Save the updated material and note the next missing piece",
    ];
    return { intent, category: "job", doneWhen: "One application move is completed: a paragraph, answer, bullet, or submission step is updated", firstStep: steps[0], steps, stopCondition: "Stop once one concrete application or materials step is complete", maxSteps: 4 };
  }

  if (intent === "learning_output") {
    const steps = [
      "Open the learning item or source",
      "Extract one idea that changes how you would act, answer, or decide",
      "Save it as a note, example, or practice result",
      "Stop once one reusable learning output exists",
    ];
    return { intent, category: "learning", doneWhen: "One useful note or output exists: a note, example, or practice result", firstStep: steps[0], steps, stopCondition: steps[3], maxSteps: 4 };
  }

  if (intent === "proof_asset") {
    const steps = [
      "Open the draft, project, or blank note",
      "Write the claim this should prove",
      "Add one concrete example or piece of evidence",
      "Save the smallest reusable version",
    ];
    return { intent, category: "substack", doneWhen: "A rough draft, outline, proof note, or reusable fragment exists", firstStep: steps[0], steps, stopCondition: "Stop once one reusable or publishable fragment exists", maxSteps: 4 };
  }

  if (intent === "comparison") {
    const steps = [
      "Write the exact options you are comparing",
      "Choose the 3 criteria that matter for this choice",
      "Mark which option currently wins each criterion",
      "Write the next choice or test",
    ];
    return { intent, category: "thinking", doneWhen: "A short comparison note and next choice are written down", firstStep: steps[0], steps, stopCondition: "Stop once the comparison has a current winner or next test", maxSteps: 4 };
  }

  if (intent === "decision") {
    const steps = [
      "Write the exact question you need to decide",
      "List the real options",
      "Choose the top 3 criteria",
      "Mark the current default and next action",
    ];
    return { intent, category: "thinking", doneWhen: "A decision or next action is written down with the real options visible", firstStep: steps[0], steps, stopCondition: "Stop once the current default and next action are visible", maxSteps: 4 };
  }

  if (intent === "blocked_unblock") {
    const steps = [
      "Write what is blocked",
      "Write the missing input or decision",
      "Choose the smallest unblock request or workaround",
      "Send, schedule, or park that unblock move",
    ];
    return { intent, category: input.category || "admin", doneWhen: "The blocker and next unblock action are written down", firstStep: steps[0], steps, stopCondition: "Stop once the task is unblocked or explicitly parked", maxSteps: 4 };
  }

  if (intent === "status_update") {
    const steps = ["Update the status and add the short reason if useful"];
    return { intent, category: input.category || "admin", doneWhen: "Status is updated", firstStep: steps[0], steps, stopCondition: "Stop once the status is updated", maxSteps: 1 };
  }

  const lane = normalizeLaneName(String(input.lane || "")) as CanonicalLaneName;
  if (lane === LANE_NAME.APPLICATIONS) return contractForTaskIntent({ ...input, title: `${title} application`, lane: null });
  if (lane === LANE_NAME.NETWORK) return contractForTaskIntent({ ...input, title: `${title} message`, lane: null });
  if (lane === LANE_NAME.LEARNING_DEVELOPMENT) return contractForTaskIntent({ ...input, title: `${title} learning`, lane: null });
  if (lane === LANE_NAME.PROOF_ASSETS) return contractForTaskIntent({ ...input, title: `${title} proof`, lane: null });

  const steps = ["Open the task and identify the first visible thing to change"];
  return { intent, category: input.category || "admin", doneWhen: "Something concrete is done", firstStep: steps[0], steps, stopCondition: "Stop when something is visibly different", maxSteps: 1 };
}

export function hasRoleMarketScanContract(texts: string[]) {
  const joined = texts.join(" | ").toLowerCase();
  return /\bsave\b.*\b(real|posting|role|job)\b/.test(joined)
    && /\b(extract|note|list|capture)\b.*\b(requirements?|signals?|asks?|pattern)\b/.test(joined)
    && /\b(stop|done|mark|gap|evidence|captured)\b/.test(joined);
}
