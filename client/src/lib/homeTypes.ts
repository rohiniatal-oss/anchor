import type { WinCategory } from "@shared/domainState";

export type Step = { text: string; done: boolean };

export type Tab = "today" | "strategy" | "braindump" | "jobs" | "network" | "learn" | "wins";

export const GOAL_SPINE_QUERY_KEYS = ["/api/goals/state", "/api/strategy/front-door", "/api/strategy/diagnostics"] as const;
export const PENDING_CONTACT_DRAFT_KEY = "anchor.pending-contact-draft";
export const PENDING_LEARN_DRAFT_KEY = "anchor.pending-learn-draft";

export function parseSteps(raw: string): Step[] {
  try {
    const s = JSON.parse(raw || "[]");
    return Array.isArray(s) ? s : [];
  } catch {
    return [];
  }
}

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const SIZE_LABEL: Record<string, string> = { quick: "quick", medium: "~45m", deep: "deep" };

export const WIN_CATEGORY_LABEL: Record<WinCategory, string> = {
  job_progress: "Job progress",
  learning: "Learning",
  network: "Network",
  proof_asset: "Proof asset",
  mindset: "Mindset",
  admin: "Admin",
};

export const WIN_CATEGORY_SWATCH: Record<WinCategory, string> = {
  job_progress: "bg-primary/15 text-primary",
  learning: "bg-slate-200 text-slate-700",
  network: "bg-slate-100 text-slate-600",
  proof_asset: "bg-primary/10 text-primary",
  mindset: "bg-slate-100 text-slate-500",
  admin: "bg-muted text-muted-foreground",
};

export function sizeChipLabel(s: string) {
  return s === "medium" ? "~45m" : s;
}

export function daysUntil(d: string): number | null {
  if (!d) return null;
  const due = new Date(d + "T00:00:00");
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}

export function formatDeadline(d: string): string {
  const diff = daysUntil(d);
  if (diff === null) return d || "";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const due = new Date(d + "T00:00:00");
  if (diff < 7) return due.toLocaleDateString(undefined, { weekday: "short" });
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function deadlineTone(d: string): string {
  const diff = daysUntil(d);
  if (diff === null) return "bg-muted text-muted-foreground";
  if (diff <= 2) return "bg-destructive/10 text-destructive";
  if (diff <= 7) return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

export function queueIntakeDraft(key: string, draft: Record<string, unknown>) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Best-effort only. If session storage is unavailable, fall back to plain navigation.
  }
}

export function takeIntakeDraft<T extends object>(key: string): Partial<T> | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : null;
  } catch {
    try {
      window.sessionStorage.removeItem(key);
    } catch {}
    return null;
  }
}

export function routeBase(path: string) {
  return path.split("?")[0] || path;
}

export function buildPrefillHash(path: string, draftParam: string, draft: Record<string, unknown>) {
  const params = new URLSearchParams();
  params.set(draftParam, JSON.stringify(draft));
  return `${path}?${params.toString()}`;
}

export function takeHashDraft<T extends object>(draftParam: string): Partial<T> | null {
  try {
    const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const [path, search = ""] = rawHash.split("?");
    if (!search) return null;
    const params = new URLSearchParams(search);
    const raw = params.get(draftParam);
    if (!raw) return null;
    params.delete(draftParam);
    const nextHash = params.toString() ? `${path}?${params.toString()}` : path;
    window.history.replaceState(null, "", `#${nextHash}`);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : null;
  } catch {
    return null;
  }
}

export function tabFromPath(path: string): Tab {
  switch (routeBase(path)) {
    case "/strategy":
      return "strategy";
    case "/braindump":
      return "braindump";
    case "/jobs":
      return "jobs";
    case "/network":
      return "network";
    case "/learn":
      return "learn";
    case "/wins":
      return "wins";
    default:
      return "today";
  }
}

export function pathForTab(tab: Tab): string {
  return tab === "today" ? "/" : `/${tab}`;
}
