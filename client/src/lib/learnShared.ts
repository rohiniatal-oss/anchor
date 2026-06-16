import { BadgeCheck, BookOpen, Hammer } from "lucide-react";
import type { LearnOutputState, LearnStatus } from "@shared/domainState";

export const LEARN_OUTPUT_META: Record<LearnOutputState, { label: string; cls: string; icon: typeof BookOpen }> = {
  reference: { label: "just learning", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400", icon: BookOpen },
  producing: { label: "notes or brief taking shape", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200", icon: Hammer },
  evidenced: { label: "notes or brief linked", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: BadgeCheck },
};

export const LEARN_STATUS_LABEL: Record<LearnStatus, string> = {
  open: "open", watch: "later", active: "active", applied: "applied", enrolled: "enrolled", done: "done", closed: "closed",
};

export function learnTaskActionLabel(outputState: LearnOutputState): string {
  return outputState === "reference" ? "Plan next prep step" : "Plan finishing step";
}

export function learnTaskCreatedLabel(outputState: LearnOutputState): string {
  return outputState === "reference" ? "Prep step added." : "Finishing step added.";
}

export function parseIdList(raw: string): number[] {
  try { const a = JSON.parse(raw || "[]"); return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : []; } catch { return []; }
}

export type LearnFormT = {
  title: string;
  category: string;
  capabilityBuilt: string;
  requiredOutput: string;
  url: string;
  note: string;
  relatedTrackId: number | null;
  proofIntent: boolean;
  learnStatus: LearnStatus;
};

export const EMPTY_LEARN_FORM: LearnFormT = {
  title: "",
  category: "",
  capabilityBuilt: "",
  requiredOutput: "",
  url: "",
  note: "",
  relatedTrackId: null,
  proofIntent: false,
  learnStatus: "open",
};
