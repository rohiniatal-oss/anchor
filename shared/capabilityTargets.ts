// ─────────────────────────────────────────────────────────────────────────
// CAPABILITY TARGETS (P5.1) — the SINGLE editable place that maps a career track
// to the small set of capability domains it REQUIRES. This is the target-profile
// the gap engine measures evidenced capability against. It is DATA-DRIVEN from a
// track's targetRoleArchetype (preferred) and/or a tolerant match over its
// slug/name (fallback) — NOT a hardcoded list of program names. Edit the maps
// here in one place; the engine (server/learningStrategy.ts) reads them.
//
// Vocabulary: the domain keys MUST be keys in shared/capabilityDomains
// (CAPABILITY_DOMAIN_KEYS). We reuse that constant as the single source of truth
// for what a "capability domain" is, so Learn-item normalization and target
// profiles speak the same language.
//
// AFTERLINE RULE (critical): targets describe CAPABILITY coverage for a track,
// satisfiable by Learn items / wins / proof assets. They never require putting a
// topic INTO a specific proof asset. A geopolitics track does NOT list AI
// Governance as a required domain, and the AI track's coverage is satisfied by AI
// Learn items/wins — never by demanding AI content on the geopolitics Substack.
// ─────────────────────────────────────────────────────────────────────────
import { CAPABILITY_DOMAIN_KEYS } from "./capabilityDomains";

export type CapabilityDomainKey = (typeof CAPABILITY_DOMAIN_KEYS)[number];

// PRIMARY map: targetRoleArchetype -> required capability domains. Archetypes
// mirror the jobs.roleArchetype / careerTracks.targetRoleArchetype vocabulary
// (ops|research|advisory|chief_of_staff|policy|fellowship) plus a couple of
// track-shaped archetypes the real tracks use.
const TARGETS_BY_ARCHETYPE: Record<string, CapabilityDomainKey[]> = {
  // AI governance foundations / ops — needs the governance core + the policy
  // frameworks that surround it + enough quant literacy to read the field.
  policy: ["ai-gov", "policy", "quant"],
  ops: ["ai-gov", "policy", "product"],
  // Geopolitics / advisory — forecasting + the communications that carry it.
  // NOTE: NO ai-gov here. The geopolitics lane is deliberately separate.
  advisory: ["geo", "comms"],
  research: ["geo", "quant", "comms"],
  // Executive presence / chief-of-staff — gravitas is carried by communications
  // and delivery, not a single named program.
  chief_of_staff: ["comms", "product", "policy"],
  // Fellowships are opportunities, not a track shape; if a track is archetyped
  // this way, treat it as credibility-building (comms + a proof domain).
  fellowship: ["comms", "ai-gov"],
};

// FALLBACK map: tolerant token match over a track's slug + name + archetype, used
// when the archetype is empty/unknown. Each entry is { tokens, domains }; the
// FIRST matching entry wins (so order encodes priority). Keeps the engine working
// for real tracks (ai-gov-ops, geo-advisory, consulting-craft, exec-presence)
// without hardcoding program names.
const FALLBACK_RULES: { tokens: string[]; domains: CapabilityDomainKey[] }[] = [
  { tokens: ["ai-gov", "ai gov", "ai governance", "ai-safety", "ai safety", "governance"], domains: ["ai-gov", "policy", "quant"] },
  { tokens: ["geo", "geopol", "geopolit", "forecast", "international", "advisory"], domains: ["geo", "comms"] },
  { tokens: ["exec", "presence", "gravitas", "leadership", "chief"], domains: ["comms", "product"] },
  { tokens: ["consult", "craft", "delivery", "strategy"], domains: ["product", "comms", "quant"] },
  { tokens: ["writ", "comm", "substack", "editorial", "narrative"], domains: ["comms"] },
];

// Resolve the required capability domains for a track. Returns [] when nothing
// matches (a track with no profile yet simply has no gaps — never a false alarm).
export function requiredDomainsForTrack(
  track: { slug?: string | null; name?: string | null; targetRoleArchetype?: string | null },
): CapabilityDomainKey[] {
  const arch = (track.targetRoleArchetype || "").trim().toLowerCase();
  if (arch && TARGETS_BY_ARCHETYPE[arch]) return dedupeKeys(TARGETS_BY_ARCHETYPE[arch]);

  const hay = `${track.slug || ""} ${track.name || ""} ${arch}`.toLowerCase();
  for (const rule of FALLBACK_RULES) {
    if (rule.tokens.some((t) => hay.includes(t))) return dedupeKeys(rule.domains);
  }
  return [];
}

// Guard against typos: keep only keys that are real capability domains, deduped,
// in their declared order. A bad edit here can never invent a phantom domain.
function dedupeKeys(keys: CapabilityDomainKey[]): CapabilityDomainKey[] {
  const valid = new Set<string>(CAPABILITY_DOMAIN_KEYS);
  const seen = new Set<string>();
  const out: CapabilityDomainKey[] = [];
  for (const k of keys) {
    if (!valid.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
