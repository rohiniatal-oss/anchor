import type { CapabilityDomainKey } from "./capabilityTargets";

export type LearningGapPrepStarter = {
  title: string;
  note: string;
  optionalResult: string;
};

const STARTERS: Record<CapabilityDomainKey, LearningGapPrepStarter> = {
  "ai-gov": {
    title: "AI governance landscape brief",
    note: "Get one clear view of the main actors, current debates, and what you think matters.",
    optionalResult: "a one-page note you can reuse in interviews",
  },
  geo: {
    title: "Geopolitics situation brief",
    note: "Get clearer on the main actors, likely scenarios, and what matters most.",
    optionalResult: "a short brief you can talk through confidently",
  },
  comms: {
    title: "Strategic writing and messaging",
    note: "Sharpen how you explain an issue, recommendation, or tradeoff in a crisp way.",
    optionalResult: "talking points, a short memo, or a polished example",
  },
  policy: {
    title: "Policy and regulation essentials",
    note: "Get clearer on the rules, tradeoffs, and one concrete example you can explain.",
    optionalResult: "a short policy note or comparison table",
  },
  product: {
    title: "Execution and operating cadence",
    note: "Get more concrete on planning, coordination, and how work actually moves.",
    optionalResult: "a checklist, operating note, or decision example",
  },
  quant: {
    title: "Data and analysis fundamentals",
    note: "Work through one concrete example so the numbers feel usable rather than abstract.",
    optionalResult: "a worked example, metric walkthrough, or short analysis note",
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
