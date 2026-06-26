export type DiscoveryEvidence = {
  title: string;
  snippet: string;
  url?: string;
  domain?: string;
  date?: string;
  citationId?: string;
};

export type DiscoveryOptionKind = "role" | "person" | "learning" | "organization" | "proof" | "resource" | "evidence";
export type DiscoveryOptionConfidence = "high" | "medium" | "low";

export type RankedDiscoveryOption = {
  rank: number;
  kind: DiscoveryOptionKind;
  title: string;
  whyRelevant: string;
  confidence: DiscoveryOptionConfidence;
  evidenceIndex: number;
  score: number;
  sourceTitle: string;
  sourceUrl?: string;
  sourceDomain?: string;
  nextAction: string;
};

export type DiscoveryOptionsResult = {
  options: RankedDiscoveryOption[];
  summary: string;
  recommendedNextAction: string;
};

function compact(value: unknown, max = 220) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function lower(value: unknown) {
  return compact(value, 1000).toLowerCase();
}

function words(value: unknown) {
  return lower(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function discoveryKind(title: string): DiscoveryOptionKind {
  const text = lower(title);
  if (/\b(roles?|jobs?|posting|vacanc(?:y|ies)|hiring|opportunities)\b/.test(text)) return "role";
  if (/\b(people|person|contacts?|alumni|experts?|leaders?|operators?|founders?)\b/.test(text)) return "person";
  if (/\b(courses?|programs?|programmes?|fellowships?|bootcamps?|training|learning)\b/.test(text)) return "learning";
  if (/\b(companies|organisations|organizations|institutions|employers?|firms?|funders?|teams?)\b/.test(text)) return "organization";
  if (/\b(examples?|memos?|portfolio|proof|writing sample|case stud(?:y|ies)|artifacts?|assets?)\b/.test(text)) return "proof";
  if (/\b(resources?|articles?|reports?|papers?|datasets?|guides?)\b/.test(text)) return "resource";
  return "evidence";
}

function kindKeywords(kind: DiscoveryOptionKind) {
  if (kind === "role") return ["role", "job", "hiring", "requirements", "career", "team", "application"];
  if (kind === "person") return ["person", "people", "alumni", "leader", "expert", "profile", "contact"];
  if (kind === "learning") return ["course", "program", "programme", "fellowship", "learning", "training", "curriculum"];
  if (kind === "organization") return ["company", "organisation", "organization", "institution", "team", "employer", "firm"];
  if (kind === "proof") return ["example", "memo", "portfolio", "case", "artifact", "asset", "analysis"];
  if (kind === "resource") return ["resource", "article", "report", "paper", "dataset", "guide"];
  return ["evidence", "source", "current", "public"];
}

function domainTrust(domain: string) {
  const d = lower(domain);
  if (!d) return 0;
  if (/\.(gov|edu|ac\.uk)$/.test(d)) return 16;
  if (/\.(org)$/.test(d)) return 10;
  if (/linkedin|greenhouse|lever|ashbyhq|workable|smartrecruiters|indeed|glassdoor/.test(d)) return 10;
  if (/reuters|apnews|bbc|ft\.com|economist|nytimes|washingtonpost|theguardian/.test(d)) return 12;
  return 4;
}

function freshness(date: string) {
  const parsed = Date.parse(date || "");
  if (!Number.isFinite(parsed)) return 0;
  const days = Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
  if (days <= 45) return 8;
  if (days <= 180) return 4;
  return 0;
}

function sourceQuality(evidence: DiscoveryEvidence) {
  const text = lower(`${evidence.title} ${evidence.snippet} ${evidence.domain}`);
  let score = 0;
  if (/official|careers?|jobs?|profile|programme|program|report|publication|newsroom|update/.test(text)) score += 8;
  if (/sponsored|click here|top 10|hacks|subscribe|best tips/.test(text)) score -= 35;
  return score;
}

function relevanceScore(title: string, evidence: DiscoveryEvidence, kind: DiscoveryOptionKind) {
  const haystack = lower(`${evidence.title} ${evidence.snippet} ${evidence.domain}`);
  const titleTokens = unique(words(title)).filter((word) => !["find", "search", "look", "three", "best", "for", "into"].includes(word));
  const titleScore = titleTokens.reduce((score, word) => score + (haystack.includes(word) ? 7 : 0), 0);
  const kindScore = kindKeywords(kind).reduce((score, word) => score + (haystack.includes(word) ? 5 : 0), 0);
  return titleScore + kindScore;
}

function scoreEvidence(title: string, evidence: DiscoveryEvidence, kind: DiscoveryOptionKind, index: number) {
  return 60
    + Math.max(0, 18 - index * 4)
    + relevanceScore(title, evidence, kind)
    + domainTrust(evidence.domain || "")
    + freshness(evidence.date || "")
    + sourceQuality(evidence);
}

function confidence(score: number): DiscoveryOptionConfidence {
  if (score >= 105) return "high";
  if (score >= 80) return "medium";
  return "low";
}

function kindLabel(kind: DiscoveryOptionKind) {
  if (kind === "role") return "role or opportunity signal";
  if (kind === "person") return "person or network signal";
  if (kind === "learning") return "learning option";
  if (kind === "organization") return "organization to investigate";
  if (kind === "proof") return "proof asset example";
  if (kind === "resource") return "resource to review";
  return "evidence point";
}

function whyRelevant(kind: DiscoveryOptionKind, evidence: DiscoveryEvidence) {
  const snippet = compact(evidence.snippet, 180);
  const prefix = `This looks like a ${kindLabel(kind)} because it is a current public source connected to the search.`;
  return snippet ? `${prefix} Evidence: ${snippet}` : prefix;
}

function nextAction(kind: DiscoveryOptionKind) {
  if (kind === "role") return "Open the source and verify whether this is a real current opportunity before creating a Job or adding it to a project.";
  if (kind === "person") return "Open the source or profile and confirm relevance before creating a Contact or outreach task.";
  if (kind === "learning") return "Check the source and decide whether this should become a Learn item or stay as supporting evidence.";
  if (kind === "organization") return "Check the organization page and decide whether it deserves deeper research, monitoring, or a relationship move.";
  if (kind === "proof") return "Use the example to decide whether to create a proof asset or save it as reference evidence.";
  if (kind === "resource") return "Review the source and decide whether it answers the search question or should become a learning/resource item.";
  return "Use this evidence to answer the search question before creating any downstream object.";
}

function recommendedAction(kind: DiscoveryOptionKind, options: RankedDiscoveryOption[]) {
  if (!options.length) return "Clarify the search goal or retry automatic discovery. Do not create objects until there is evidence to rank.";
  const top = options[0];
  if (kind === "role") return `Start with ${top.title}. Verify it is current, then create a Job only if it is a real opportunity you want to pursue.`;
  if (kind === "person") return `Start with ${top.title}. Confirm the person or network is relevant, then create a Contact only if there is a credible reason to reach out.`;
  if (kind === "learning") return `Start with ${top.title}. Confirm it builds the capability you need, then create a Learn item only if it has a useful output.`;
  if (kind === "organization") return `Start with ${top.title}. Decide whether it should become a monitored organization, a project input, or no action.`;
  if (kind === "proof") return `Start with ${top.title}. Decide whether it should inspire a proof asset or remain reference material.`;
  if (kind === "resource") return `Start with ${top.title}. Use it to answer the question, then create a resource only if it has reusable value.`;
  return `Start with ${top.title}. Use it to answer the search question before creating anything.`;
}

export function buildRankedDiscoveryOptions(input: { title: string; evidence: DiscoveryEvidence[] }): DiscoveryOptionsResult {
  const kind = discoveryKind(input.title);
  const options = (input.evidence || [])
    .map((evidence, index) => {
      const score = scoreEvidence(input.title, evidence, kind, index);
      return {
        rank: 0,
        kind,
        title: compact(evidence.title || evidence.domain || `Result ${index + 1}`, 140),
        whyRelevant: whyRelevant(kind, evidence),
        confidence: confidence(score),
        evidenceIndex: index,
        score,
        sourceTitle: compact(evidence.title, 140),
        sourceUrl: compact(evidence.url, 400) || undefined,
        sourceDomain: compact(evidence.domain, 80) || undefined,
        nextAction: nextAction(kind),
      } satisfies RankedDiscoveryOption;
    })
    .filter((option) => option.title && option.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((option, index) => ({ ...option, rank: index + 1 }));

  const summary = options.length
    ? `Anchor found ${options.length} ranked ${kindLabel(kind)}${options.length === 1 ? "" : "s"}. The strongest signal is ${options[0].title}.`
    : "Anchor did not find enough reliable evidence to rank options yet.";

  return {
    options,
    summary,
    recommendedNextAction: recommendedAction(kind, options),
  };
}
