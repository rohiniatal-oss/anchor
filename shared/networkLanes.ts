// ─────────────────────────────────────────────────────────────────────────
// WARM LANES (P4.2) — a PRESENTATION layer over the open-ended free-text
// contacts.sourceNetwork column. There is NO schema constraint: sourceNetwork
// stays free text and any value is valid. These lanes only decide how a contact
// is grouped in the Network warmth board (and which contacts a job's weak warm
// path can pull from). The "Open" catch-all collects anything (incl. empty)
// that doesn't match a system lane. Order here is the column/section order.
// ─────────────────────────────────────────────────────────────────────────

export const OPEN_LANE = "Open" as const;

// System lanes in preferred display order. `key` is the stable lane id; `label`
// is what the UI shows; `match` is a list of lowercase tokens the normalizer
// looks for inside a contact's (lowercased) sourceNetwork.
export const NETWORK_LANES: { key: string; label: string; match: string[] }[] = [
  { key: "sipa", label: "SIPA", match: ["sipa"] },
  { key: "columbia", label: "Columbia (other)", match: ["columbia", "cu"] },
  { key: "lsr", label: "LSR", match: ["lsr", "lady shri ram", "lady shriram"] },
  { key: "ex-tbi", label: "ex-TBI", match: ["tbi", "tony blair", "blair institute"] },
  { key: "ex-bain", label: "ex-Bain", match: ["bain"] },
  { key: "ex-abraaj", label: "ex-Abraaj", match: ["abraaj"] },
];

export const ALL_LANE_KEYS: string[] = [...NETWORK_LANES.map((l) => l.key), OPEN_LANE];

// Map a free-text sourceNetwork to a lane key. Case-insensitive and tolerant of
// "TBI" / "ex-TBI" / "Tony Blair Institute" etc. Falls back to the Open lane.
// Earlier lanes win on overlap; SIPA is checked before the broader Columbia
// token so "SIPA, Columbia" lands in SIPA.
export function laneForSourceNetwork(sourceNetwork: string | null | undefined): string {
  const raw = (sourceNetwork || "").toLowerCase();
  if (!raw.trim()) return OPEN_LANE;
  for (const lane of NETWORK_LANES) {
    if (lane.match.some((tok) => raw.includes(tok))) return lane.key;
  }
  return OPEN_LANE;
}

export function laneLabel(key: string): string {
  if (key === OPEN_LANE) return OPEN_LANE;
  return NETWORK_LANES.find((l) => l.key === key)?.label ?? key;
}
