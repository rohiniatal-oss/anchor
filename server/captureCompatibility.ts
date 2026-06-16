export function legacyCategoryToRoute(category: string) {
  const raw = String(category || "").trim().toLowerCase();
  if (raw === "hustle") return "proof";
  if (["today", "task", "job", "learn", "network", "proof", "decision", "keep"].includes(raw)) return raw;
  return "";
}
