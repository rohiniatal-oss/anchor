import type {
  ContextBlock,
  ExternalResearchHit,
  ExternalResearchIntent,
  ExternalResearchQueryPlan,
  TaskContextProvider,
  TaskContextProviderInput,
  TaskContextSourceBundle,
} from "./types";

const NEGATIVE_TRIGGER_RE =
  /\b(cv|resume|cover letter|cover|application answer|question draft|writing sample|tailor|rewrite|personal statement|reflection|prioriti[sz]e|trade[ -]?off|network(?:ing)?|outreach|message|email|daily plan|schedule|adhd|proof asset|substack|draft fragment)\b/i;
const COMPANY_RESEARCH_RE =
  /\b(company|organisation|organization|recent news|mission|team|leadership|funding|product launch|strategy)\b/i;
const DEADLINE_RE =
  /\b(deadline|closing date|application window|open until|rolling|program dates?)\b/i;
const ELIGIBILITY_RE =
  /\b(eligibility|eligible|visa|citizenship|location rules?|work authorization|sponsorship)\b/i;
const MARKET_SCAN_RE =
  /\b(market scan|market map|compare role|role requirements|hiring trends?|public role patterns?|current landscape)\b/i;
const RESOURCE_RE =
  /\b(syllabus|curriculum|program|fellowship|resource verification|still exists|public learning resource|cohort|course dates?)\b/i;
const LOW_QUALITY_DOMAIN_RE =
  /\b(pinterest|reddit|quora|medium\.com|blogspot|substackcdn|t\.co|bit\.ly)\b/i;
const LOW_QUALITY_SNIPPET_RE =
  /\b(sign up|subscribe now|sponsored|best \d+|top \d+|click here|buy now)\b/i;
const INTERNAL_LANGUAGE_RE =
  /\b(anchor|notion|context block|task breakdown|workflow state|source context|done when|minimum outcome|playbook)\b/gi;

function clean(value: unknown, max = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function lower(text: string) {
  return text.toLowerCase();
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    return parsed.toString().toLowerCase();
  } catch {
    return clean(url, 500).toLowerCase();
  }
}

function dedupeWords(words: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const key = lower(word);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function tokenCap(words: string[], maxWords = 12) {
  return dedupeWords(words).slice(0, maxWords);
}

function looksFreshnessSensitive(intent: ExternalResearchIntent) {
  return intent === "company_research"
    || intent === "deadline_verification"
    || intent === "eligibility_check"
    || intent === "resource_verification";
}

function sourceTitle(bundle: TaskContextSourceBundle) {
  return clean(bundle.source?.title || "", 120);
}

function sourceCompany(bundle: TaskContextSourceBundle) {
  return clean(bundle.source?.company || "", 80);
}

function sourceUrl(bundle: TaskContextSourceBundle, task: TaskContextProviderInput["task"]) {
  return clean(bundle.source?.url || task.sourceUrl || "", 400);
}

function sourceDomain(bundle: TaskContextSourceBundle, task: TaskContextProviderInput["task"]) {
  return extractDomain(sourceUrl(bundle, task));
}

function sanitizePublicFragment(value: string, maxWords = 6) {
  const stripped = clean(value, 140)
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, " ")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, " ")
    .replace(INTERNAL_LANGUAGE_RE, " ")
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ");
  return tokenCap(stripped.split(/\s+/).filter(Boolean), maxWords).join(" ");
}

export function deriveExternalResearchIntent(
  task: TaskContextProviderInput["task"],
  bundle: TaskContextSourceBundle,
): ExternalResearchIntent {
  const text = lower(`${task.title || ""} ${task.category || ""} ${task.doneWhen || task.minimumOutcome || ""}`);
  if (DEADLINE_RE.test(text)) return "deadline_verification";
  if (ELIGIBILITY_RE.test(text)) return "eligibility_check";
  if (MARKET_SCAN_RE.test(text)) return "market_scan";
  if (bundle.sourceKind === "learn" && RESOURCE_RE.test(text)) return "resource_verification";
  if (bundle.sourceKind === "job" && COMPANY_RESEARCH_RE.test(text)) return "company_research";
  if (bundle.sourceKind === "learn" && /verify|check|confirm|application|program|course|fellowship/i.test(text)) return "resource_verification";
  if (COMPANY_RESEARCH_RE.test(text)) return "company_research";
  if (NEGATIVE_TRIGGER_RE.test(text)) return "none";
  return "none";
}

export function shouldTriggerExternalResearch(
  task: TaskContextProviderInput["task"],
  bundle: TaskContextSourceBundle,
  userAuthoredBlocks: ContextBlock[] = [],
) {
  const intent = deriveExternalResearchIntent(task, bundle);
  if (intent === "none") return false;
  if (userAuthoredBlocks.length > 0 && !looksFreshnessSensitive(intent)) return false;
  if (bundle.sourceKind === "hustle") return false;
  return true;
}

function intentTokens(intent: ExternalResearchIntent) {
  if (intent === "company_research") return ["recent", "news", "mission"];
  if (intent === "deadline_verification") return ["application", "deadline"];
  if (intent === "eligibility_check") return ["eligibility", "requirements"];
  if (intent === "market_scan") return ["roles", "requirements"];
  if (intent === "resource_verification") return ["program", "dates"];
  return [];
}

function publicEntityTokens(task: TaskContextProviderInput["task"], bundle: TaskContextSourceBundle) {
  const tokens: string[] = [];
  const company = sanitizePublicFragment(sourceCompany(bundle), 4);
  const title = sanitizePublicFragment(sourceTitle(bundle), 6);
  if (company) tokens.push(...company.split(/\s+/));
  if (bundle.sourceKind === "job" && title) tokens.push(...title.split(/\s+/).slice(0, 4));
  if (bundle.sourceKind === "learn" && title) tokens.push(...title.split(/\s+/).slice(0, 5));
  if (!tokens.length && bundle.sourceKind === "goal") {
    const text = lower(`${task.title} ${task.doneWhen || task.minimumOutcome || ""}`);
    if (text.includes("policy")) tokens.push("policy");
    if (text.includes("research")) tokens.push("research");
    if (text.includes("strategy")) tokens.push("strategy");
    if (text.includes("operations")) tokens.push("operations");
    if (text.includes("governance")) tokens.push("governance");
  }
  return dedupeWords(tokens);
}

export function buildExternalResearchQueryPlan(
  task: TaskContextProviderInput["task"],
  bundle: TaskContextSourceBundle,
): ExternalResearchQueryPlan | null {
  const intent = deriveExternalResearchIntent(task, bundle);
  if (intent === "none") return null;
  const publicTokens = publicEntityTokens(task, bundle);
  const domain = sourceDomain(bundle, task);
  const primaryWords = tokenCap([...publicTokens, ...intentTokens(intent)]);
  if (!primaryWords.length) return null;
  const primary = `${primaryWords.join(" ")}${domain ? ` site:${domain}` : ""}`.trim();
  const fallbackWords = tokenCap([...publicTokens, ...intentTokens(intent).slice(0, 1)]);
  const fallback = domain && fallbackWords.length ? fallbackWords.join(" ") : undefined;
  return {
    intent,
    freshnessSensitive: looksFreshnessSensitive(intent),
    primary,
    fallback,
  };
}

function domainTrustScore(domain: string) {
  if (!domain) return 0;
  if (/\.(gov|edu)$/.test(domain)) return 30;
  if (/careers|jobs|apply|official|program/.test(domain)) return 18;
  return 8;
}

function relevanceScore(hit: ExternalResearchHit, tokens: string[]) {
  const haystack = lower(`${hit.title} ${hit.snippet} ${hit.source}`);
  return tokens.reduce((score, token) => score + (haystack.includes(lower(token)) ? 6 : 0), 0);
}

function freshnessScore(date: string, now: number) {
  const parsed = Date.parse(date || "");
  if (!Number.isFinite(parsed)) return 0;
  const ageDays = Math.max(0, Math.floor((now - parsed) / 86400000));
  if (ageDays <= 30) return 18;
  if (ageDays <= 90) return 12;
  if (ageDays <= 180) return 6;
  return 0;
}

function isLowQualityHit(hit: ExternalResearchHit) {
  const domain = extractDomain(hit.url || hit.source);
  return LOW_QUALITY_DOMAIN_RE.test(domain) || LOW_QUALITY_SNIPPET_RE.test(lower(hit.snippet));
}

export function rankAndFilterExternalResearchHits(
  task: TaskContextProviderInput["task"],
  bundle: TaskContextSourceBundle,
  plan: ExternalResearchQueryPlan,
  rawHits: ExternalResearchHit[],
  now = Date.now(),
) {
  const expectedDomain = sourceDomain(bundle, task);
  const expectedTokens = tokenCap([...publicEntityTokens(task, bundle), ...intentTokens(plan.intent)], 10);
  const byUrl = new Map<string, { hit: ExternalResearchHit; score: number }>();
  const byDomain = new Set<string>();
  for (const hit of rawHits) {
    if (!hit?.url || !hit?.title || !hit?.snippet) continue;
    if (isLowQualityHit(hit)) continue;
    const normalizedUrl = normalizeUrl(hit.url);
    const domain = extractDomain(hit.url || hit.source);
    if (!normalizedUrl || byUrl.has(normalizedUrl)) continue;
    if (domain && byDomain.has(domain)) continue;
    let score = relevanceScore(hit, expectedTokens) + domainTrustScore(domain);
    if (expectedDomain && domain === expectedDomain) score += 40;
    if (plan.freshnessSensitive) score += freshnessScore(hit.date, now);
    byUrl.set(normalizedUrl, { hit, score });
    if (domain) byDomain.add(domain);
  }
  return [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.hit)
    .slice(0, 3);
}

export function toExternalResearchBlocks(
  hits: ExternalResearchHit[],
  plan: ExternalResearchQueryPlan,
): ContextBlock[] {
  return hits.slice(0, 3).map((hit, index) => ({
    kind: "external_research",
    priority: "supporting",
    label: `External public evidence R${index + 1}`,
    text: clean(hit.snippet, 280),
    sourceTitle: clean(hit.title, 140),
    sourceUrl: clean(hit.url, 400),
    sourceDomain: extractDomain(hit.url || hit.source),
    sourceDate: clean(hit.date, 40),
    retrievedAt: clean(hit.retrievedAt, 40),
    metadata: {
      provider: "mock_external_research",
      citationId: `R${index + 1}`,
      freshnessSensitive: plan.freshnessSensitive,
      query: plan.primary,
    },
  }));
}

function mockExternalResearchHits(
  task: TaskContextProviderInput["task"],
  bundle: TaskContextSourceBundle,
  plan: ExternalResearchQueryPlan,
  now = Date.now(),
) {
  const domain = sourceDomain(bundle, task) || "example.org";
  const title = sourceTitle(bundle) || sourceCompany(bundle) || "Public research target";
  const stamp = new Date(now).toISOString();
  const shared = {
    retrievedAt: stamp,
  };
  return [
    {
      title: `${title} official update`,
      url: `https://${domain}/official-update`,
      snippet: `Official page covering ${intentTokens(plan.intent).join(" ")} for ${title}.`,
      date: stamp.slice(0, 10),
      source: domain,
      ...shared,
    },
    {
      title: `${title} newsroom note`,
      url: `https://${domain}/newsroom/current-note`,
      snippet: `Recent public context about ${title} that can sharpen current facts and constraints.`,
      date: stamp.slice(0, 10),
      source: domain,
      ...shared,
    },
    {
      title: `Top 10 ${title} hacks`,
      url: "https://pinterest.com/noisy-aggregator",
      snippet: "Sponsored content. Click here for the best tips.",
      date: "2023-01-01",
      source: "pinterest.com",
      ...shared,
    },
  ];
}

export const externalResearchContextProvider: TaskContextProvider = {
  async collect(input) {
    try {
      const userBlocks = input.userAuthoredBlocks || [];
      if (!shouldTriggerExternalResearch(input.task, input.sourceBundle, userBlocks)) {
        return { provider: "external_research", status: "skipped", blocks: [], debug: { reason: "trigger_rules" } };
      }
      const plan = buildExternalResearchQueryPlan(input.task, input.sourceBundle);
      if (!plan) {
        return { provider: "external_research", status: "skipped", blocks: [], debug: { reason: "no_query_plan" } };
      }
      const envMode = process.env.ANCHOR_EXTERNAL_RESEARCH_MOCK_MODE as TaskContextProviderInput["mockMode"] | undefined;
      const mode = input.mockMode || envMode || "unavailable";
      if (mode === "unavailable") return { provider: "external_research", status: "unavailable", blocks: [], debug: { query: plan.primary } };
      if (mode === "rate_limited") return { provider: "external_research", status: "rate_limited", blocks: [], debug: { query: plan.primary } };
      if (mode === "error") throw new Error("mock external research provider error");
      if (mode === "empty") return { provider: "external_research", status: "empty", blocks: [], debug: { query: plan.primary } };
      const rawHits = input.mockHits?.length ? input.mockHits : mockExternalResearchHits(input.task, input.sourceBundle, plan, input.now);
      const ranked = rankAndFilterExternalResearchHits(input.task, input.sourceBundle, plan, rawHits, input.now);
      const blocks = toExternalResearchBlocks(ranked, plan);
      return {
        provider: "external_research",
        status: blocks.length ? "ok" : "empty",
        blocks,
        debug: { query: plan.primary, resultCount: blocks.length },
      };
    } catch (error) {
      return {
        provider: "external_research",
        status: "error",
        blocks: [],
        debug: { reason: error instanceof Error ? error.message : "unknown_error" },
      };
    }
  },
};
