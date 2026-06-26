const RESEARCH_LIKE_RE = /^(?:please\s+)?(?:explore|get\s+into|break\s+into|look\s+into|research|understand|investigate|learn\s+about|map\s+out)\b/i;
const SEARCH_DISCOVERY_RE = /^(?:please\s+)?(?:search|find|look\s+up|look\s+for|identify|map|scan|source|shortlist|discover)\b/i;
const NON_DISCOVERY_FIND_RE = /^(?:please\s+)?find\s+(?:time|a\s+time|some\s+time|a\s+slot|space|room|my|the)\b/i;
const STRONG_DIRECTION_VERB_RE = /^(?:please\s+)?(?:get\s+into|break\s+into)\b/i;
const EXPLORATION_VERB_RE = /^(?:please\s+)?(?:explore|map\s+out)\b/i;
const CAREER_DIRECTION_NOUN_RE = /\b(?:career|careers|field|industry|industries|job|jobs|profession|professions|role|roles|sector|sectors|space)\b/i;
const ORGANIZATION_NOUN_RE = /\b(?:agency|bank|company|council|department|firm|foundation|group|institute|institution|lab|laboratory|office|organisation|organization|university)\b/i;
const RESEARCH_PREFIX_RE = /^(?:please\s+)?(?:explore|get\s+into|break\s+into|look\s+into|research|understand|investigate|learn\s+about|map\s+out)\s+/i;
const SEARCH_PREFIX_RE = /^(?:please\s+)?(?:search\s+for|find|look\s+up|look\s+for|identify|map|scan|source|shortlist|discover)\s+/i;
const GENERIC_SUFFIX_RE = /\s+(?:career|careers|field|industry|industries|job|jobs|profession|professions|role|roles|sector|sectors|space)\s*$/i;

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function researchTarget(title: string): string {
  return compact(title).replace(RESEARCH_PREFIX_RE, "").replace(/[.?!]+$/g, "");
}

function searchTarget(title: string): string {
  return compact(title).replace(SEARCH_PREFIX_RE, "").replace(/[.?!]+$/g, "");
}

function looksLikeBoundedEntity(target: string): boolean {
  const cleaned = compact(target);
  if (!cleaned) return true;
  if (/^[A-Z0-9&.-]{2,12}$/.test(cleaned)) return true;
  return ORGANIZATION_NOUN_RE.test(cleaned);
}

/**
 * Career-direction research is exploration of a role family, career path,
 * field, industry, or sector. General entity/topic research remains a project
 * or task candidate and must go through work interpretation.
 */
export function isCareerDirectionResearchTitle(title: string): boolean {
  const cleaned = compact(title);
  if (!cleaned || !RESEARCH_LIKE_RE.test(cleaned)) return false;
  if (CAREER_DIRECTION_NOUN_RE.test(cleaned)) return true;
  if (STRONG_DIRECTION_VERB_RE.test(cleaned)) return true;
  if (EXPLORATION_VERB_RE.test(cleaned)) return !looksLikeBoundedEntity(researchTarget(cleaned));
  return false;
}

export function extractCareerDirectionDomain(title: string): string {
  const cleaned = compact(title);
  if (!isCareerDirectionResearchTitle(cleaned)) return "";
  return compact(researchTarget(cleaned).replace(GENERIC_SUFFIX_RE, ""));
}

/**
 * Search/discovery captures look for roles, people, courses, resources, orgs, or
 * evidence. They are not objects yet; they need work interpretation before any
 * Job, Learn item, Contact, Proof asset, Project, or Task is created.
 */
export function isSearchDiscoveryTitle(title: string): boolean {
  const cleaned = compact(title);
  if (!cleaned || !SEARCH_DISCOVERY_RE.test(cleaned)) return false;
  if (NON_DISCOVERY_FIND_RE.test(cleaned)) return false;
  return true;
}

export function extractSearchDiscoveryTarget(title: string): string {
  const cleaned = compact(title);
  if (!isSearchDiscoveryTitle(cleaned)) return "";
  return searchTarget(cleaned);
}
