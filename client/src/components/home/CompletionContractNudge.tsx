import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CheckCircle2, FileText, HelpCircle, Loader2 } from "lucide-react";
import type { Task } from "@shared/schema";
import { completionContractForTask, type CompletionContract } from "@shared/completionContracts";
import { mutateAndInvalidate } from "@/lib/api";
import { routeBase } from "@/lib/homeTypes";
import { todayKey } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

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

const SATISFIED_OPTIONS = new Set(["continue", "captured", "understood", "completed", "adequate", "strong", "useful_signal", "clearer", "helped", "neutral", "save_for_later", "turn_into_application", "turn_into_output", "share", "save_as_proof"]);
const RUBRIC_OPTIONS = new Set(["weak", "adequate", "strong"]);

function label(value: string, labels: Record<string, string>) {
  return labels[value] || value.replace(/_/g, " ");
}

function shouldShow(contract: CompletionContract) {
  return contract.contract !== "maintenance" || contract.residueLevel !== "marker";
}

function optionTone(option: string) {
  if (["weak", "stop", "not_useful", "did_not_help", "needs_more_input"].includes(option)) return "border-muted text-muted-foreground hover:border-destructive/40 hover:text-destructive";
  if (SATISFIED_OPTIONS.has(option)) return "border-primary/30 text-primary hover:bg-primary/10";
  return "border-card-border text-muted-foreground hover:text-foreground hover:bg-muted/70";
}

export function CompletionContractNudge() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [busyOption, setBusyOption] = useState("");
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  if (routeBase(location) !== "/") return null;

  const pinned = tasks.find((task) => task.pinned && !task.done);
  if (!pinned) return null;
  const contract = completionContractForTask(pinned);
  if (!shouldShow(contract)) return null;

  const artifactLabel = contract.requiresArtifact ? "Artifact required" : "No artifact required";
  const ArtifactIcon = contract.requiresArtifact ? FileText : CheckCircle2;

  async function completeWith(option: string) {
    setBusyOption(option);
    try {
      const payload: Record<string, string> = {
        day: todayKey(),
        completionNote: note,
      };
      if (RUBRIC_OPTIONS.has(option) || contract.assessmentMode === "rubric") {
        payload.completionRating = option;
      } else {
        payload.completionOutcome = option;
      }
      const res = await mutateAndInvalidate("POST", `/api/tasks/${pinned.id}/complete`, payload, [
        "/api/tasks",
        "/api/plan/current",
        "/api/wins",
        "/api/wins/summary",
        "/api/stats",
      ]);
      setNote("");
      toast({
        title: res?.winCategory ? "Done — logged with context" : "Done",
        description: contract.requiresArtifact ? "Output expectation recorded." : "Completion mode recorded without forcing an artifact.",
      });
    } catch {
      toast({ title: "Couldn't complete that task", description: "Try again in a moment." });
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
        placeholder={contract.residueLevel === "none" || contract.residueLevel === "marker" ? "Optional note…" : `Add ${label(contract.residueLevel, RESIDUE_LABEL).toLowerCase()}…`}
        className="mt-2 min-h-[54px] w-full resize-none rounded-lg border border-card-border bg-background/80 px-2.5 py-2 text-xs outline-none focus:border-primary/50"
        data-testid="completion-contract-note"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {contract.afterActionOptions.slice(0, 4).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => completeWith(option)}
            disabled={!!busyOption}
            data-testid={`completion-contract-option-${option}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${optionTone(option)}`}
          >
            {busyOption === option ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {label(option, {})}
          </button>
        ))}
      </div>
    </aside>
  );
}
