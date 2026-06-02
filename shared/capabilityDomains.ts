// ─────────────────────────────────────────────────────────────────────────
// CAPABILITY DOMAINS (P4.4) — a PRESENTATION layer over the open-ended free-text
// learn.category / learn.capabilityBuilt fields. There is NO schema constraint:
// both columns stay free text and any value is valid. These domains only decide
// how a learn item is OPTIONALLY grouped in the Learn proof-building view.
// Mirrors the 4.2 networkLanes tolerant-normalizer pattern, with one difference:
// items that DON'T match a system domain are NOT forced into a catch-all bucket
// (there is no "Other" lane). Unmatched items live in a flat list instead — so
// there is no pressure to categorize. Order here is the section display order.
// ─────────────────────────────────────────────────────────────────────────

// System domains in preferred display order. `key` is the stable domain id;
// `label` is what the UI shows; `match` is a list of lowercase tokens the
// normalizer looks for inside an item's lowercased (category + capabilityBuilt).
export const CAPABILITY_DOMAINS: { key: string; label: string; match: string[] }[] = [
  { key: "ai-gov", label: "AI Governance & Safety", match: ["ai gov", "ai-gov", "ai safety", "ai policy", "alignment", "frontier", "responsible ai", "ml safety", "governance of ai"] },
  { key: "geo", label: "Geopolitical Analysis & Forecasting", match: ["geopol", "geo-pol", "forecast", "intelligence", "international relations", "ir ", "foreign policy", "security studies", "geostrateg"] },
  { key: "comms", label: "Strategic Communications & Writing", match: ["comm", "writ", "narrative", "substack", "editorial", "messaging", "rhetoric", "storytell", "op-ed", "essay"] },
  { key: "policy", label: "Policy & Regulatory Frameworks", match: ["policy", "regulat", "compliance", "law", "legal", "framework", "governance", "standards"] },
  { key: "product", label: "Product & Delivery", match: ["product", "delivery", "ops", "operations", "project", "program", "pm", "agile", "roadmap", "execution"] },
  { key: "quant", label: "Quantitative & Data Literacy", match: ["quant", "data", "statistic", "analytics", "sql", "python", "modeling", "modelling", "econometric", "machine learning", "ml "] },
];

export const CAPABILITY_DOMAIN_KEYS: string[] = CAPABILITY_DOMAINS.map((d) => d.key);

// Map a learn item's free-text category/capabilityBuilt to a domain key, or null
// when nothing matches. Case-insensitive and tolerant. Earlier domains win on
// overlap. Returning null (NOT a catch-all) is deliberate: unmatched items go to
// a flat list, not a forced "Other" section.
export function domainForLearn(category: string | null | undefined, capabilityBuilt: string | null | undefined): string | null {
  const raw = `${category || ""} ${capabilityBuilt || ""}`.toLowerCase();
  if (!raw.trim()) return null;
  for (const domain of CAPABILITY_DOMAINS) {
    if (domain.match.some((tok) => raw.includes(tok))) return domain.key;
  }
  return null;
}

export function domainLabel(key: string): string {
  return CAPABILITY_DOMAINS.find((d) => d.key === key)?.label ?? key;
}
