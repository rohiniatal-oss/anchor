import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CheckCircle2, FileText, HelpCircle, Loader2 } from "lucide-react";
import type { Task } from "@shared/schema";
import { completionContractForTask, type CompletionContract } from "@shared/completionContracts";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS, routeBase } from "@/lib/homeTypes";
import { todayKey } from "@/lib/utils";

const CONTRACT_LABEL: Record<string, string> = {
  exposure: "Read or explore",
  capture: "Capture a choice",
  comprehension: "Understand",
  application: "Apply",
  decision: "Decide",
  practice: "Practice",
  deliverable: "Produce output",
  conversation: "Conversation",
  maintenance: "Maintenance",
  recovery: "Recovery",
  reflection: "Reflect",
};

const RESIDUE_LABEL: Record<string, string> = {
  none: "No residue",
  marker: "Completion marker",
  one_line: "One line",
  question: "Question",
  decision: "Decision",
  note: "Note",
  artifact: "Artifact",
  external_signal: "External signal",
  rubric_score: "Rubric score",
};

const RATING_OPTIONS = new Set(["weak", "adequate", "strong"]);

function label(value: string, labels: Record<string, string>) {
  return labels[value] || value.replace(/_/g, " ");
}

function shouldShow(contract: CompletionContract) {
  return contract.contract !== "maintenance" || contract.residueLevel !== "marker";
}

function notePlaceholder(contract: CompletionContract) {
  if (contract.residueLevel === "none" || contract.residueLevel === "marker") return "Optional note";
  if (contract.residueLevel === "one_line") return "Optional one-line takeaway";
  if (contract.residueLevel === "decision") return "Optional decision or selection";
  if (contract.residueLevel === "external_signal") return "Optional signal or follow-up";
  if (contract.residueLevel === "artifact") return "Optional artifact note or link";
  return "Optional note";
}

export function CompletionContractNudge() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [busyOption, setBusyOption] = useState<string>("");
  const [note, setNote] = useState("");
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  if (routeBase(location) !== "/") return null;

  const pinned = tasks.find((task) => task.pinned && !task.done);
  if (!pinned) return null;
  const contract = completionContractForTask(pinned);
  if (!shouldShow(contract)) return null;

  const artifactLabel = contract.requiresArtifact ? "Artifact required" : "No artifact required";
  const ArtifactIcon = contract.requiresArtifact ? FileText : CheckCircle2;

  async function completeWith(option: string) {
    if (!pinned) return;
    setBusyOption(option);
    try {
      const rating = RATING_OPTIONS.has(option) ? option : undefined;
      const outcome = rating ? undefined : option;
      const res = await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/complete`, {
        day: todayKey(),
        completionRating: rating,
        completionOutcome: outcome,
        completionNote: note.trim() || undefined,
      }, ["/api/tasks", "/api/plan/current", "/api/wins", "/api/wins/summary", "/api/stats", "/api/jobs", ...GOAL_SPINE_QUERY_KEYS]);
      const result = rating || outcome || "completed";
      toast({
        title: `Done — ${label(result, {})}`,
        description: res?.nextMilestoneHint ? `Next up: ${res.nextMilestoneHint}` : "Recorded with the right completion mode.",
      });
      setNote("");
    } catch {
      toast({ title: "Couldn't complete that", description: "Try again in a moment." });
    } finally {
      setBusyOption("");
    }
  }

  return (
    <aside
      className="fixed bottom-4 left-4 z-40 hidden w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-card-border bg-card/95 p-3.5 shadow-xl backdrop-blur sm:block"
      data-testid="completion-contract-nudge"
      aria-label="Completion contract for current task"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5" /> Completion mode
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {label(contract.contract, CONTRACT_LABEL)}
        </span>
      </div>
      <p className="text-sm font-medium leading-snug text-foreground">{contract.completionPrompt}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <ArtifactIcon className="h-3 w-3" /> {artifactLabel}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Residue: {label(contract.residueLevel, RESIDUE_LABEL)}
        </span>
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={notePlaceholder(contract)}
        className="mt-2 h-14 w-full resize-none rounded-lg border border-card-border bg-background/80 px-2.5 py-2 text-xs outline-none focus:border-primary/40"
        data-testid="completion-contract-note"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {contract.afterActionOptions.slice(0, 4).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => completeWith(option)}
            disabled={Boolean(busyOption)}
            data-testid={`completion-contract-action-${option}`}
            className="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2.5 py-1 text-[10px] font-semibold text-secondary-foreground hover:bg-secondary disabled:opacity-60"
          >
            {busyOption === option ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Complete as {label(option, {})}
          </button>
        ))}
      </div>
    </aside>
  );
}
