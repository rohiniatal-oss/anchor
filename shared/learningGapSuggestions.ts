import type { CapabilityDomainKey } from "./capabilityTargets";

export type LearningGapPrepStarter = {
  title: string;
  note: string;
  optionalResult: string;
};

export type LearningGapStarterSubdivision = {
  key: string;
  label: string;
  whyItMatters: string;
  suggestedMaterials: string[];
};

export type LearningGapStarterMilestone = {
  key: string;
  label: string;
  subdivisionKey: string;
  milestoneType: "content" | "synthesis" | "artifact";
  suggestedTaskTitle: string;
  doneWhen: string;
  scaffolding: string[];
};

export type LearningGapStarterPacket = LearningGapPrepStarter & {
  subdivisions: LearningGapStarterSubdivision[];
  milestones: LearningGapStarterMilestone[];
};

const STARTERS: Record<CapabilityDomainKey, LearningGapStarterPacket> = {
  "ai-gov": {
    title: "AI governance landscape brief",
    note: "Get one clear view of the main actors, current debates, and what you think matters.",
    optionalResult: "a one-page note you can reuse in interviews",
    subdivisions: [
      {
        key: "landscape",
        label: "Actors and institutions",
        whyItMatters: "You need to know who actually shapes the field before you can speak credibly about it.",
        suggestedMaterials: [
          "One current overview of the AI governance landscape",
          "One map of the main institutions, labs, and regulators",
        ],
      },
      {
        key: "debates",
        label: "Live policy debates",
        whyItMatters: "Interviewers care more about the live tensions and tradeoffs than abstract definitions.",
        suggestedMaterials: [
          "One recent debate, policy memo, or explainer on a contested AI governance issue",
          "One concrete case showing how a governance choice played out in practice",
        ],
      },
    ],
    milestones: [
      {
        key: "orient",
        label: "Orient to the landscape",
        subdivisionKey: "landscape",
        milestoneType: "content",
        suggestedTaskTitle: "Map the main AI governance actors and institutions",
        doneWhen: "You can explain the main actors, what they do, and where the key power sits.",
        scaffolding: [
          "Which institutions keep coming up most often?",
          "What does each actor actually control or influence?",
          "What would surprise someone coming from consulting or investing?",
        ],
      },
      {
        key: "mechanism",
        label: "Work through one live governance debate",
        subdivisionKey: "debates",
        milestoneType: "content",
        suggestedTaskTitle: "Read one live AI governance debate and note the real tradeoff",
        doneWhen: "You can explain one current governance tradeoff and why smart people disagree about it.",
        scaffolding: [
          "What is the actual decision or rule being argued about?",
          "What is the strongest case on each side?",
          "Where does this show up in real institutions or companies?",
        ],
      },
      {
        key: "synthesise",
        label: "Connect it to your own background",
        subdivisionKey: "debates",
        milestoneType: "synthesis",
        suggestedTaskTitle: "Write three bullets connecting AI governance to work you already know",
        doneWhen: "You have three bullets connecting the field to your own experience or judgment.",
        scaffolding: [
          "What feels genuinely new versus familiar from your prior work?",
          "What analogy from strategy, policy, or investing helps you explain it?",
          "What would you say if asked about this tomorrow in an interview?",
        ],
      },
      {
        key: "artifact",
        label: "Keep one reusable AI governance note",
        subdivisionKey: "debates",
        milestoneType: "artifact",
        suggestedTaskTitle: "Write a short AI governance note or answer you could reuse later",
        doneWhen: "You have one reusable note, interview answer, or positioning paragraph on AI governance.",
        scaffolding: [
          "Start with the one claim or tension that matters most.",
          "Use one concrete example, not just a general view.",
          "End with why this matters for the roles you want.",
        ],
      },
    ],
  },
  geo: {
    title: "Geopolitics situation brief",
    note: "Get clearer on the main actors, likely scenarios, and what matters most.",
    optionalResult: "a short brief you can talk through confidently",
    subdivisions: [
      {
        key: "actors",
        label: "Actors and incentives",
        whyItMatters: "Most geopolitical analysis gets stronger once the main players and their incentives are explicit.",
        suggestedMaterials: [
          "One current regional or issue overview from a serious analyst or think tank",
          "One source that explains what the main actors actually want right now",
        ],
      },
      {
        key: "scenarios",
        label: "Scenarios and implications",
        whyItMatters: "You need to move beyond headlines into what could happen next and why it matters.",
        suggestedMaterials: [
          "One scenario or forecast piece on the issue",
          "One practitioner or analyst take on the strategic implications",
        ],
      },
    ],
    milestones: [
      {
        key: "orient",
        label: "Map the situation",
        subdivisionKey: "actors",
        milestoneType: "content",
        suggestedTaskTitle: "Map the main actors and what each one wants",
        doneWhen: "You can explain the main actors, what they want, and where the real tension sits.",
        scaffolding: [
          "Who are the essential actors here?",
          "What does each actor most want or fear?",
          "What is the simplest wrong story outsiders often tell?",
        ],
      },
      {
        key: "mechanism",
        label: "Work through one likely scenario",
        subdivisionKey: "scenarios",
        milestoneType: "content",
        suggestedTaskTitle: "Work through one plausible scenario and what would change it",
        doneWhen: "You can describe one plausible scenario and the evidence that would make you update it.",
        scaffolding: [
          "What are the 2-3 most plausible next developments?",
          "What would make one scenario more likely than the others?",
          "What is the practical implication for decision-makers?",
        ],
      },
      {
        key: "synthesise",
        label: "Form your own view",
        subdivisionKey: "scenarios",
        milestoneType: "synthesis",
        suggestedTaskTitle: "Write your current view in three bullets",
        doneWhen: "You have a short view on what matters most and why.",
        scaffolding: [
          "What is your current base case?",
          "What would change your mind?",
          "How would you explain this to a non-specialist employer or colleague?",
        ],
      },
      {
        key: "artifact",
        label: "Keep a reusable geopolitical brief",
        subdivisionKey: "scenarios",
        milestoneType: "artifact",
        suggestedTaskTitle: "Write a short situation brief you could talk through later",
        doneWhen: "You have a short brief or answer you could reuse in interviews or conversations.",
        scaffolding: [
          "Lead with the situation in one sentence.",
          "Add the main scenario and what drives it.",
          "End with why it matters for the context you care about.",
        ],
      },
    ],
  },
  comms: {
    title: "Strategic writing and messaging prep",
    note: "Sharpen how you explain an issue, recommendation, or tradeoff in a crisp way.",
    optionalResult: "talking points, a short memo, or a polished example",
    subdivisions: [
      {
        key: "structure",
        label: "Clear structure",
        whyItMatters: "Strong strategic communication depends on getting the shape of the message right before polishing.",
        suggestedMaterials: [
          "One strong memo, briefing note, or recommendation example",
          "One short guide or example on concise executive writing",
        ],
      },
      {
        key: "tradeoffs",
        label: "Recommendation and tradeoffs",
        whyItMatters: "Good messaging makes the recommendation and the tradeoff legible, not just elegant.",
        suggestedMaterials: [
          "One example of a recommendation with clear options and tradeoffs",
          "One piece of writing that translates complexity into a decision",
        ],
      },
    ],
    milestones: [
      {
        key: "orient",
        label: "Study one strong example",
        subdivisionKey: "structure",
        milestoneType: "content",
        suggestedTaskTitle: "Study one strong memo or briefing example",
        doneWhen: "You can explain why the structure works and what it does early.",
        scaffolding: [
          "How quickly does the writer get to the point?",
          "How is the recommendation structured?",
          "What is cut away or left unsaid?",
        ],
      },
      {
        key: "mechanism",
        label: "Rewrite one message around the key tradeoff",
        subdivisionKey: "tradeoffs",
        milestoneType: "content",
        suggestedTaskTitle: "Take one issue and rewrite it around a clearer recommendation and tradeoff",
        doneWhen: "You have one clearer recommendation and tradeoff framing than before.",
        scaffolding: [
          "What is the actual recommendation?",
          "What is the real tradeoff or cost?",
          "What would an impatient senior reader need first?",
        ],
      },
      {
        key: "synthesise",
        label: "Extract your own communication rules",
        subdivisionKey: "tradeoffs",
        milestoneType: "synthesis",
        suggestedTaskTitle: "Write three communication rules you want to use yourself",
        doneWhen: "You have three concrete rules for how you want to write or present recommendations.",
        scaffolding: [
          "What did the good example do that you usually skip?",
          "Where do your own drafts tend to get muddy?",
          "What will you force yourself to do next time?",
        ],
      },
      {
        key: "artifact",
        label: "Keep one reusable writing sample or answer",
        subdivisionKey: "tradeoffs",
        milestoneType: "artifact",
        suggestedTaskTitle: "Write one short memo, answer, or talking-point set you could reuse later",
        doneWhen: "You have one reusable communication example you would be happy to show or use again.",
        scaffolding: [
          "Open with the recommendation.",
          "Make the tradeoff explicit.",
          "Keep only what strengthens the decision.",
        ],
      },
    ],
  },
  policy: {
    title: "Policy and regulation prep",
    note: "Get clearer on the rules, tradeoffs, and one concrete example you can explain.",
    optionalResult: "a short policy note or comparison table",
    subdivisions: [
      {
        key: "rules",
        label: "Rules and frameworks",
        whyItMatters: "You need the core framework clearly enough to explain it without bluffing.",
        suggestedMaterials: [
          "One overview of the main policy or regulatory framework",
          "One primary or quasi-primary policy source worth reading directly",
        ],
      },
      {
        key: "application",
        label: "Real-world application",
        whyItMatters: "Policy understanding only becomes useful once you can show how it plays out in practice.",
        suggestedMaterials: [
          "One real case where the rule or policy mattered",
          "One comparison showing how two approaches differ in practice",
        ],
      },
    ],
    milestones: [
      {
        key: "orient",
        label: "Map the core framework",
        subdivisionKey: "rules",
        milestoneType: "content",
        suggestedTaskTitle: "Map the core framework and its main moving parts",
        doneWhen: "You can explain the core rule set and what problem it is trying to solve.",
        scaffolding: [
          "What are the main elements of the framework?",
          "What is the underlying policy objective?",
          "What part is easiest to misread or oversimplify?",
        ],
      },
      {
        key: "mechanism",
        label: "Work through one practical case",
        subdivisionKey: "application",
        milestoneType: "content",
        suggestedTaskTitle: "Work through one case where the framework mattered in practice",
        doneWhen: "You can explain one practical case and the tradeoff it revealed.",
        scaffolding: [
          "What happened in the case?",
          "What tradeoff or friction did it expose?",
          "What would a decision-maker need to understand here?",
        ],
      },
      {
        key: "synthesise",
        label: "Write your current policy take",
        subdivisionKey: "application",
        milestoneType: "synthesis",
        suggestedTaskTitle: "Write your current take on the main policy tradeoff",
        doneWhen: "You have a short view on the main policy tradeoff and why it matters.",
        scaffolding: [
          "What is the strongest argument on each side?",
          "Where do you currently land?",
          "What evidence would make you update your view?",
        ],
      },
      {
        key: "artifact",
        label: "Keep one reusable policy note",
        subdivisionKey: "application",
        milestoneType: "artifact",
        suggestedTaskTitle: "Write a short policy note or comparison table you could reuse later",
        doneWhen: "You have one reusable note or comparison you could reference in roles or interviews.",
        scaffolding: [
          "Summarise the issue plainly.",
          "Show the tradeoff, not just the rule.",
          "End with your current recommendation or judgment.",
        ],
      },
    ],
  },
  product: {
    title: "Execution and operating cadence prep",
    note: "Get more concrete on planning, coordination, and how work actually moves.",
    optionalResult: "a checklist, operating note, or decision example",
    subdivisions: [
      {
        key: "cadence",
        label: "Operating cadence",
        whyItMatters: "Chief-of-staff and operations roles often turn on how work moves week to week, not just strategy language.",
        suggestedMaterials: [
          "One example of operating cadence, staff rhythm, or planning process",
          "One write-up on how cross-functional execution is actually run",
        ],
      },
      {
        key: "coordination",
        label: "Coordination and decisions",
        whyItMatters: "You need to show how decisions, blockers, and stakeholders are handled in practice.",
        suggestedMaterials: [
          "One example of a decision process, meeting rhythm, or operating review",
          "One concrete case of coordination across teams or leaders",
        ],
      },
    ],
    milestones: [
      {
        key: "orient",
        label: "Map one real operating cadence",
        subdivisionKey: "cadence",
        milestoneType: "content",
        suggestedTaskTitle: "Map what a real operating cadence looks like in one target context",
        doneWhen: "You can explain the rhythm of planning, review, and follow-through in one real setting.",
        scaffolding: [
          "What repeats weekly, monthly, or quarterly?",
          "What gets reviewed where?",
          "Who drives follow-through?",
        ],
      },
      {
        key: "mechanism",
        label: "Work through one coordination example",
        subdivisionKey: "coordination",
        milestoneType: "content",
        suggestedTaskTitle: "Work through one real coordination or execution example",
        doneWhen: "You can explain how decisions, blockers, and accountability moved in one example.",
        scaffolding: [
          "What was the decision or operational problem?",
          "Who had to coordinate?",
          "What made execution hard in practice?",
        ],
      },
      {
        key: "synthesise",
        label: "Connect it to how you operate",
        subdivisionKey: "coordination",
        milestoneType: "synthesis",
        suggestedTaskTitle: "Write how your own background maps to this kind of execution work",
        doneWhen: "You have a short explanation of how your background maps to execution and coordination work.",
        scaffolding: [
          "Where have you already done similar coordination or execution work?",
          "What part feels least familiar?",
          "What would you emphasise in an interview?",
        ],
      },
      {
        key: "artifact",
        label: "Keep one reusable execution example",
        subdivisionKey: "coordination",
        milestoneType: "artifact",
        suggestedTaskTitle: "Write one reusable example of execution, coordination, or operating judgment",
        doneWhen: "You have one reusable execution example or operating note you can use later.",
        scaffolding: [
          "Set up the operating problem clearly.",
          "Show what moved the work forward.",
          "Name the decision, coordination move, or result.",
        ],
      },
    ],
  },
  quant: {
    title: "Data and analysis prep",
    note: "Work through one concrete example so the numbers feel usable rather than abstract.",
    optionalResult: "a worked example, metric walkthrough, or short analysis note",
    subdivisions: [
      {
        key: "metrics",
        label: "Metrics and framing",
        whyItMatters: "Analysis gets easier once you know which metrics and questions matter most.",
        suggestedMaterials: [
          "One example of a metric or analytical framing relevant to your target roles",
          "One short walkthrough of how someone approached a similar analysis",
        ],
      },
      {
        key: "example",
        label: "Worked example",
        whyItMatters: "A concrete worked example turns analysis from abstract to explainable.",
        suggestedMaterials: [
          "One concrete dataset, case, or problem to work through",
          "One example showing how to communicate the result, not just do the math",
        ],
      },
    ],
    milestones: [
      {
        key: "orient",
        label: "Frame the analytical question",
        subdivisionKey: "metrics",
        milestoneType: "content",
        suggestedTaskTitle: "Frame one analytical question and the metrics that matter",
        doneWhen: "You can explain the question, the key metrics, and what a useful answer would look like.",
        scaffolding: [
          "What is the exact question you are trying to answer?",
          "Which metrics matter most and why?",
          "What would count as a useful answer, not just more data?",
        ],
      },
      {
        key: "mechanism",
        label: "Work through one example",
        subdivisionKey: "example",
        milestoneType: "content",
        suggestedTaskTitle: "Work through one concrete data or analysis example",
        doneWhen: "You can explain the worked example and what the result means.",
        scaffolding: [
          "What are the inputs and assumptions?",
          "What does the result actually show?",
          "Where could the interpretation go wrong?",
        ],
      },
      {
        key: "synthesise",
        label: "Write the decision takeaway",
        subdivisionKey: "example",
        milestoneType: "synthesis",
        suggestedTaskTitle: "Write the decision takeaway from the analysis in plain English",
        doneWhen: "You have a short decision takeaway you could explain without hiding behind numbers.",
        scaffolding: [
          "What is the decision implication?",
          "What caveat matters most?",
          "How would you explain this to a non-technical manager?",
        ],
      },
      {
        key: "artifact",
        label: "Keep one reusable analysis note",
        subdivisionKey: "example",
        milestoneType: "artifact",
        suggestedTaskTitle: "Write a short analysis note or metric walkthrough you can reuse later",
        doneWhen: "You have one reusable worked example or analysis note you can point to later.",
        scaffolding: [
          "State the question clearly.",
          "Show the result simply.",
          "End with what someone should do differently because of it.",
        ],
      },
    ],
  },
};

export function learningGapPrepStarter(
  domain: CapabilityDomainKey,
  domainLabel: string,
): LearningGapPrepStarter {
  return STARTERS[domain] || {
    title: `${domainLabel} prep`,
    note: `Get more concrete in ${domainLabel} so you can explain it more clearly.`,
    optionalResult: "a short note or example you can reuse later",
  };
}

export function learningGapStarterPacket(
  domain: CapabilityDomainKey,
  domainLabel: string,
): LearningGapStarterPacket {
  const starter = STARTERS[domain];
  if (starter) return starter;
  return {
    title: `${domainLabel} prep`,
    note: `Get more concrete in ${domainLabel} so you can explain it more clearly.`,
    optionalResult: "a short note or example you can reuse later",
    subdivisions: [
      {
        key: "basics",
        label: `${domainLabel} basics`,
        whyItMatters: `You need a clear starting point in ${domainLabel} before trying to sound fluent.`,
        suggestedMaterials: [
          `One good overview of ${domainLabel}`,
          `One concrete example showing how ${domainLabel} works in practice`,
        ],
      },
    ],
    milestones: [
      {
        key: "orient",
        label: `Orient to ${domainLabel}`,
        subdivisionKey: "basics",
        milestoneType: "content",
        suggestedTaskTitle: `Read one overview of ${domainLabel}`,
        doneWhen: `You can explain the basic shape of ${domainLabel} in plain English.`,
        scaffolding: [
          "What is this field actually about?",
          "What matters most here?",
          "What still feels fuzzy?",
        ],
      },
      {
        key: "synthesise",
        label: `Keep one reusable ${domainLabel} note`,
        subdivisionKey: "basics",
        milestoneType: "artifact",
        suggestedTaskTitle: `Write one short note on ${domainLabel}`,
        doneWhen: `You have one short note or explanation of ${domainLabel} you can reuse later.`,
        scaffolding: [
          "What is the main idea?",
          "What example makes it real?",
          "Why does it matter for your target work?",
        ],
      },
    ],
  };
}

export function learningGapMissingReason(
  domain: CapabilityDomainKey,
  domainLabel: string,
): string {
  const starter = learningGapPrepStarter(domain, domainLabel);
  return `No learning item is saved yet for ${domainLabel}. Start with the suggested starter "${starter.title}" so Anchor has one clear way to help you begin.`;
}

export function learningGapRecommendedMove(
  domain: CapabilityDomainKey,
  domainLabel: string,
): string {
  const starter = learningGapPrepStarter(domain, domainLabel);
  return `Use the suggested starter "${starter.title}" to start strengthening ${domainLabel}.`;
}
