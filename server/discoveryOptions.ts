export type DiscoveryEvidence = {
  title: string;
  snippet: string;
  url?: string;
  domain?: string;
  date?: string;
  citationId?: string;
};

export type DiscoveryOptionKind = "role" | "person" | "course" | "organization" | "proof" | "resource" | "general";

export type DiscoveryOption = {
  rank: number;
  kind: DiscoveryOptionKind;
  title: string;
  why: string;
  fitSignal: string;
  nextAction: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  confidence: "high" | "medium" | "low";
};

export type DiscoveryRecommendation = {
  summary: string;
  recommendedNextMove: string;
  options: DiscoveryOption[];
};

function compact(value: unknown, max = 220) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function lower(value: unknown) {
  return compact(value, 1000).toLowerCase();
}

function stripCommand(title: string) {
  return compact(title, 240)
    .replace(/^(?:please\s+)?(?:search\s+for|find|look\s+up|look\s+for|identify|map|scan|source|shortlist|discover)\s+/i, "")
    .replace(/[.?!]+$/g, "")
    .trim();
}

function requestedKind(title: string): DiscoveryOptionKind {
  const text = lower(title);
  if (/\b(roles?|jobs?|postings?|vacanc(?:y|ies)|hiring)\b/.test(text)) return "role";
  if (/\b(people|person|contacts?|alumni|experts?|leaders?|operators?|founders?)\b/.test(text)) return "person";
  if (/\b(courses?|programs?|programmes?|fellowships?|training|bootcamps?|cohorts?)\b/.test(text)) return "course";
  if (/\b(companies|organisations|organizations|institutions?|teams?|firms?|funds?|foundations?)\b/.test(text)) return "organization";
  if (/\b(examples?|memos?|writing samples?|portfolio|proof assets?|case studies?)\b/.test(text)) return "proof";
  if (/\b(resources?|articles?|reports?|datasets?|guides?)\b/.test(text)) return "resource";
  return "general";
}

function evidenceKind(evidence: DiscoveryEvidence, fallback: DiscoveryOptionKind): DiscoveryOptionKind {
  const text = lower(`${evidence.title} ${evidence.snippet} ${evidence.domain}`);
  if (/\b(role|job|posting|vacancy|hiring|requirements)\b/.test(text)) return "role";
  if (/\b(alumni|people|person|contact|expert|leader|operator|founder|linkedin)\b/.test(text)) return "person";
  if (/\b(course|program|programme|fellowship|training|cohort|syllabus)\b/.test(text)) return "course";
  if (/\b(company|organisation|organization|institution|team|firm|foundation|institute)\b/.test(text)) return "organization";
  if (/\b(example|memo|case study|portfolio|proof|writing sample)\b/.test(text)) return "proof";
  if (/\b(resource|article|report|dataset|guide)\b/.test(text)) return "resource";
  return fallback;
}

function sourceScore(evidence: DiscoveryEvidence) {
  const domain = lower(evidence.domain || evidence.url);
  let score = 0;
  if (/\.(gov|edu|ac\.uk|org)$/.test(domain)) score += 16;
  if (/linkedin|greenhouse|lever|ashbyhq|workable|indeed|glassdoor/.test(domain)) score += 12;
  if (/reuters|apnews|bbc|ft\.com|economist|guardian|nytimes|washingtonpost/.test(domain)) score += 10;
  if (/official|careers?|jobs?|opportunit|requirements?|alumni|course|program|fellowship/i.test(`${evidence.title} ${evidence.snippet}`)) score += 10;
  if (evidence.url) score += 4;
  if (evidence.date) score += 2;
  return score;
}

function confidence(score: number, evidence: DiscoveryEvidence): DiscoveryOption["confidence"] {
  if (score >= 22 && evidence.url) return "high";
  if (score >= 10 || evidence.url) return "medium";
  return "low";
}

function optionTitle(kind: DiscoveryOptionKind, evidence: DiscoveryEvidence, queryTarget: string) {
  const sourceTitle = compact(evidence.title, 140);
  if (sourceTitle && !/^public research target/i.test(sourceTitle)) return sourceTitle;
  const target = queryTarget || "the search result";
  if (kind === "role") return `Validate ${target} as a role pattern`;
  if (kind === "person") return `Identify a credible ${target} relationship path`;
  if (kind === "course") return `Check whether ${target} is a useful learning route`;
  if (kind === "organization") return `Assess ${target} as an organization set`;
  if (kind === "proof") return `Use ${target} as proof-asset inspiration`;
  if (kind === "resource") return `Assess ${target} as a useful resource set`;
  return `Assess ${target}`;
}

function whyFor(kind: DiscoveryOptionKind, evidence: DiscoveryEvidence, queryTarget: string) {
  const snippet = compact(evidence.snippet, 180);
  if (kind === "role") return `This looks relevant because it may reveal role requirements, hiring language, or a concrete role pattern for ${queryTarget || "the search"}. ${snippet}`;
  if (kind === "person") return `This can help identify who is close enough to the topic to validate access, language, or fit. ${snippet}`;
  if (kind === "course") return `This may build capability if it has a clear output, proof artifact, or current programme structure. ${snippet}`;
  if (kind === "organization") return `This may identify where the work lives institutionally and which organizations are worth watching. ${snippet}`;
  if (kind === "proof") return `This can be used as a reference point for a proof asset without copying the artifact. ${snippet}`;
  if (kind === "resource") return `This may provide the evidence base needed to understand the topic before acting. ${snippet}`;
  return snippet || "This is one of the stronger pieces of public evidence Anchor found.";
}

function fitSignalFor(kind: DiscoveryOptionKind) {
  if (kind === "role") return "Look for overlap with prior strategy, delivery, policy, operating-model, or advisory evidence.";
  if (kind === "person") return "Prioritize people with a credible bridge to the user's background or current direction.";
  if (kind === "course") return "Prefer routes that produce a visible output rather than passive consumption.";
  if (kind === "organization") return "Prefer organizations with a live team, role family, or public workstream connected to the direction.";
  if (kind === "proof") return "Prefer examples that can become a differentiated artifact using the user's own judgment.";
  if (kind === "resource") return "Prefer sources that change the decision rather than adding background reading.";
  return "Use this only if it changes the decision or next action.";
}

function nextActionFor(kind: DiscoveryOptionKind) {
  if (kind === "role") return "Open the source, capture the requirements, and decide whether this is a verified opportunity, a role model example, or not relevant.";
  if (kind === "person") return "Choose one person or archetype, then draft a small ask for a practical steer.";
  if (kind === "course") return "Check the output, time cost, and proof value before saving it as a learning item.";
  if (kind === "organization") return "Open the strongest organization page and decide whether to watch, contact, or ignore it.";
  if (kind === "proof") return "Extract the structure, then outline a smaller original version tailored to the user's direction.";
  if (kind === "resource") return "Save only the facts that change the decision and stop reading once the next action is clear.";
  return "Use the strongest source to choose pursue, park, clarify, or stop.";
}

function summaryFor(kind: DiscoveryOptionKind, count: number, target: string) {
  const subject = target || "this search";
  if (count === 0) return `Anchor searched for ${subject}, but did not find enough usable public evidence to recommend options yet.`;
  if (kind === "role") return `Anchor found ${count} role-shaped signal${count === 1 ? "" : "s"} for ${subject}. Treat them as examples until one is verified as a real opportunity.`;
  if (kind === "person") return `Anchor found ${count} relationship-shaped signal${count === 1 ? "" : "s"} for ${subject}. Use them to choose who to validate the path with.`;
  if (kind === "course") return `Anchor found ${count} learning-shaped signal${count === 1 ? "" : "s"} for ${subject}. Choose only options that create reusable proof.`;
  if (kind === "organization") return `Anchor found ${count} organization-shaped signal${count === 1 ? "" : "s"} for ${subject}. Use them to decide where the work actually lives.`;
  if (kind === "proof") return `Anchor found ${count} proof-asset reference${count === 1 ? "" : "s"} for ${subject}. Use them as structure, not as content to copy.`;
  return `Anchor found ${count} usable discovery signal${count === 1 ? "" : "s"} for ${subject}.`;
}

function recommendedMove(kind: DiscoveryOptionKind, count: number) {
  if (count === 0) return "Clarify the search target or try a narrower search before creating any objects.";
  if (kind === "role") return "Start with the highest-ranked result and classify it as verified opportunity, role model example, or irrelevant.";
  if (kind === "person") return "Pick the highest-bridge person or archetype and prepare one low-friction outreach ask.";
  if (kind === "course") return "Open the strongest course or programme and check whether it produces a proof artifact worth saving.";
  if (kind === "organization") return "Open the top organization result and decide whether it should become a watch target, contact route, or no-action item.";
  if (kind === "proof") return "Use the strongest example to outline an original proof asset, then decide whether to activate it.";
  return "Use the top result to choose one next action, then stop searching.";
}

export function buildDiscoveryRecommendation(title: string, evidence: DiscoveryEvidence[]): DiscoveryRecommendation {
  const queryTarget = stripCommand(title);
  const fallbackKind = requestedKind(title);
  const ranked = evidence
    .map((item) => {
      const kind = evidenceKind(item, fallbackKind);
      const score = sourceScore(item) + (kind === fallbackKind ? 8 : 0);
      return { item, kind, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const options: DiscoveryOption[] = ranked.map(({ item, kind, score }, index) => ({
    rank: index + 1,
    kind,
    title: optionTitle(kind, item, queryTarget),
    why: whyFor(kind, item, queryTarget),
    fitSignal: fitSignalFor(kind),
    nextAction: nextActionFor(kind),
    sourceTitle: compact(item.title, 160),
    sourceUrl: compact(item.url, 400),
    sourceDomain: compact(item.domain, 80),
    confidence: confidence(score, item),
  }));

  const dominantKind = options[0]?.kind || fallbackKind;
  return {
    summary: summaryFor(dominantKind, options.length, queryTarget),
    recommendedNextMove: recommendedMove(dominantKind, options.length),
    options,
  };
}
