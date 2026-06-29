import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CheckCircle2, FileText, HelpCircle } from "lucide-react";
import type { Task } from "@shared/schema";
import { completionContractForTask, type CompletionContract } from "@shared/completionContracts";
import { routeBase } from "@/lib/homeTypes";

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

function label(value: string, labels: Record<string, string>) {
  return labels[value] || value.replace(/_/g, " ");
}

function shouldShow(contract: CompletionContract) {
  return contract.contract !== "maintenance" || contract.residueLevel !== "marker";
}

export function CompletionContractNudge() {
  const [location] = useLocation();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  if (routeBase(location) !== "/") return null;

  const pinned = tasks.find((task) => task.pinned && !task.done);
  if (!pinned) return null;
  const contract = completionContractForTask(pinned);
  if (!shouldShow(contract)) return null;

  const artifactLabel = contract.requiresArtifact ? "Artifact required" : "No artifact required";
  const ArtifactIcon = contract.requiresArtifact ? FileText : CheckCircle2;

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
        {contract.afterActionOptions.slice(0, 4).map((option) => (
          <span key={option} className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
            {label(option, {})}
          </span>
        ))}
      </div>
    </aside>
  );
}
