const RESEARCH_LIKE_RE = /^(?:please\s+)?(?:explore|get\s+into|break\s+into|look\s+into|research|understand|investigate|learn\s+about|map\s+out)\b/i;
const CAREER_DIRECTION_VERB_RE = /^(?:please\s+)?(?:explore|get\s+into|break\s+into|map\s+out)\b/i;
const CAREER_DIRECTION_NOUN_RE = /\b(?:career|careers|field|industry|industries|job|jobs|profession|professions|role|roles|sector|sectors|space)\b/i;
const RESEARCH_PREFIX_RE = /^(?:please\s+)?(?:explore|get\s+into|break\s+into|look\s+into|research|understand|investigate|learn\s+about|map\s+out)\s+/i;
const GENERIC_SUFFIX_RE = /\s+(?:career|careers|field|industry|industries|job|jobs|profession|professions|role|roles|sector|sectors|space)\s*$/i;

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

/**
 * Career-direction research is exploration of a role family, career path,
 * field, industry, or sector. General entity/topic research remains a project
 * or task candidate and must go through work interpretation.
 */
export function isCareerDirectionResearchTitle(title: string): boolean {
  const cleaned = compact(title);
  if (!cleaned || !RESEARCH_LIKE_RE.test(cleaned)) return false;
  return CAREER_DIRECTION_VERB_RE.test(cleaned) || CAREER_DIRECTION_NOUN_RE.test(cleaned);
}

export function extractCareerDirectionDomain(title: string): string {
  const cleaned = compact(title);
  if (!isCareerDirectionResearchTitle(cleaned)) return "";
  return compact(cleaned.replace(RESEARCH_PREFIX_RE, "").replace(GENERIC_SUFFIX_RE, ""));
}
