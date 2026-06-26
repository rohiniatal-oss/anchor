import { useState } from "react";
import { ArrowRight, CheckCircle2, Layers, Loader2, Pencil, X } from "lucide-react";
import type { Task } from "@shared/schema";
import type { WorkDefinition, WorkDecomposition } from "@shared/work";
import { Button } from "@/components/ui/button";
import { mutateAndInvalidate } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type WorkPreviewResponse = {
  definition: WorkDefinition;
  decomposition: WorkDecomposition | null;
  nextAction: "clarify" | "confirm_project" | "confirm_task" | "attach_to_project";
  readOnlyPreview: true;
};

type ConfirmedProject = {
  kind: "project";
  project: { id: number; title: string; objective: string; desiredOutcome: string; currentMilestoneId?: number | null };
  currentMilestone?: { id: number; title: string; outcome: string; doneWhen: string } | null;
  milestones?: Array<{ id: number; title: string; outcome: string; doneWhen: string; status: string }>;
  taskActivated: false;
  reused?: boolean;
};

type NextTaskPreview = {
  project: { id: number; title: string };
  milestone: { id: number; title: string; outcome: string; doneWhen: string };
  decomposition?: {
    version: 1;
    task: { title: string; objective: string; doneWhen: string; output: string; whyNow: string; estimateMinutes: number; category: string };
    steps: Array<{ text: string; outputSpec: string; executor: string; done: boolean }>;
    rollingPlan: false;
  };
  requiresActivation?: boolean;
  requiresMilestoneReview?: boolean;
  existingActiveTask?: Task;
  message?: string;
};

type Props = {
  task: Task;
  preview: WorkPreviewResponse;
  onPreviewChange: (preview: WorkPreviewResponse) => void;
  onClose: () => void;
  onResolved: () => void;
};

const INVALIDATE_AFTER_WORK = [
  "/api/tasks",
  "/api/projects",
  "/api/plan/current",
  "/api/anchor/today",
  "/api/stats",
];

function typeLabel(definition: WorkDefinition) {
  if (definition.workType === "project") return "I think this is a project";
  if (definition.workType === "milestone") return "I think this belongs inside an existing project";
  if (definition.workType === "decision") return "I think this is a decision";
  return "I think this is a one-session task";
}

function outcomeLabel(definition: WorkDefinition) {
  if (definition.workType === "project") return "Project done when";
  if (definition.workType === "milestone") return "Milestone done when";
  return "Task done when";
}

function actionLabel(definition: WorkDefinition) {
  if (definition.workType === "project") return "Confirm project";
  if (definition.candidateParent) return `Add to ${definition.candidateParent.projectTitle}`;
  return definition.workType === "decision" ? "Confirm decision task" : "Confirm task";
}

export function WorkPreviewPanel({ task, preview, onPreviewChange, onClose, onResolved }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"confirm" | "task" | "project" | "reinterpret" | "activate" | null>(null);
  const [editingGoal, setEditingGoal] = useState(preview.definition.needsClarification);
  const [goal, setGoal] = useState("");
  const [confirmed, setConfirmed] = useState<ConfirmedProject | null>(null);
  const [nextTask, setNextTask] = useState<NextTaskPreview | null>(null);

  async function interpret(context: string, forceWorkType?: WorkDefinition["workType"]) {
    setBusy(forceWorkType === "project" ? "project" : "reinterpret");
    try {
      const response = await apiRequest("POST", "/api/work/interpret", {
        title: task.title,
        sourceType: "task",
        sourceId: task.id,
        sourceNote: task.sourceNote,
        doneWhen: task.doneWhen,
        minimumOutcome: task.minimumOutcome,
        steps: task.steps,
        relatedTrackId: task.relatedTrackId,
        context,
        forceWorkType,
      });
      const next = await response.json();
      onPreviewChange(next);
      setEditingGoal(next.definition?.needsClarification === true);
      if (!next.definition?.needsClarification) setGoal("");
    } catch (error: any) {
      toast({ title: "Couldn't reinterpret that", description: error?.message || "Your capture was not changed." });
    } finally {
      setBusy(null);
    }
  }

  async function confirm(mode: "as_interpreted" | "as_task" | "attach_to_parent") {
    if (!preview.decomposition) return;
    setBusy(mode === "as_task" ? "task" : "confirm");
    try {
      const result = await mutateAndInvalidate("POST", "/api/work/confirm", {
        definition: preview.definition,
        decomposition: preview.decomposition,
        sourceTaskId: task.id,
        mode,
      }, INVALIDATE_AFTER_WORK);

      if (result?.kind === "project") {
        setConfirmed(result as ConfirmedProject);
        const projectId = Number(result?.project?.id);
        if (Number.isFinite(projectId)) {
          const next = await mutateAndInvalidate("POST", `/api/projects/${projectId}/decompose`, { refine: true }, ["/api/projects"]);
          setNextTask(next as NextTaskPreview);
        }
        toast({ title: result?.reused ? "Project already exists" : "Project confirmed", description: "No task was activated. Review the first task below." });
        return;
      }

      toast({
        title: mode === "attach_to_parent" ? "Added to the existing project" : "One-off task confirmed",
        description: "The task now has an outcome and an actionable breakdown.",
      });
      onResolved();
    } catch (error: any) {
      toast({ title: "Couldn't confirm that work", description: error?.message || "Nothing was activated." });
    } finally {
      setBusy(null);
    }
  }

  async function activateFirstTask() {
    const projectId = Number(confirmed?.project?.id);
    const milestoneId = Number(nextTask?.milestone?.id || confirmed?.currentMilestone?.id);
    if (!Number.isFinite(projectId) || !Number.isFinite(milestoneId) || !nextTask?.decomposition) return;
    setBusy("activate");
    try {
      const result = await mutateAndInvalidate("POST", `/api/projects/${projectId}/activate-next`, {
        milestoneId,
        decomposition: nextTask.decomposition,
      }, INVALIDATE_AFTER_WORK);
      toast({
        title: result?.reused ? "The first task was already active" : "First task activated",
        description: result?.task?.title || "It is now available to Today and your task system.",
      });
      onResolved();
    } catch (error: any) {
      toast({ title: "Couldn't activate the task", description: error?.message || "The project remains confirmed and unchanged." });
    } finally {
      setBusy(null);
    }
  }

  if (confirmed) {
    const milestone = nextTask?.milestone || confirmed.currentMilestone;
    const proposal = nextTask?.decomposition?.task;
    return (
      <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5" data-testid={`work-confirmed-${task.id}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" /> Project confirmed
            </p>
            <h4 className="mt-1 text-sm font-semibold">{confirmed.project.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">No live task has been created yet.</p>
          </div>
          <button onClick={onClose} aria-label="Close project preview" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {milestone && (
          <div className="mt-3 rounded-lg border border-card-border bg-card/80 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current milestone</p>
            <p className="mt-1 text-sm font-medium">{milestone.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{milestone.outcome}</p>
          </div>
        )}

        {nextTask?.requiresMilestoneReview ? (
          <p className="mt-3 text-xs text-muted-foreground">{nextTask.message}</p>
        ) : proposal ? (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">First independently useful task</p>
            <p className="mt-1 text-sm font-medium">{proposal.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{proposal.doneWhen}</p>
            <ol className="mt-2 space-y-1.5 pl-4 text-xs text-foreground/80">
              {nextTask?.decomposition?.steps.map((step, index) => <li key={`${step.text}-${index}`} className="list-decimal">{step.text}</li>)}
            </ol>
          </div>
        ) : (
          <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing the first task preview…</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={activateFirstTask} disabled={busy === "activate" || !proposal} data-testid={`button-activate-first-task-${task.id}`}>
            {busy === "activate" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1 h-3.5 w-3.5" />}
            {busy === "activate" ? "Activating" : "Activate first task"}
          </Button>
          <span className="text-[11px] text-muted-foreground">Only this task enters your live task system.</span>
        </div>
      </div>
    );
  }

  const definition = preview.definition;
  const projectPlan = preview.decomposition?.kind === "project" ? preview.decomposition.project : null;
  const taskPlan = preview.decomposition?.kind === "task" ? preview.decomposition.task : null;

  return (
    <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5" data-testid={`work-preview-${task.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Layers className="h-3.5 w-3.5" /> {typeLabel(definition)}
          </p>
          <h4 className="mt-1 text-sm font-semibold">{definition.title}</h4>
        </div>
        <button onClick={onClose} aria-label="Close work preview" className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>

      <div className="mt-3 grid gap-2 text-xs">
        <div>
          <p className="font-medium text-foreground">What this is trying to achieve</p>
          <p className="mt-0.5 leading-relaxed text-muted-foreground">{definition.objective}</p>
        </div>
        {definition.whyNow && (
          <div>
            <p className="font-medium text-foreground">Why it matters now</p>
            <p className="mt-0.5 leading-relaxed text-muted-foreground">{definition.whyNow}</p>
          </div>
        )}
        <div>
          <p className="font-medium text-foreground">{outcomeLabel(definition)}</p>
          <p className="mt-0.5 leading-relaxed text-muted-foreground">{definition.desiredOutcome}</p>
        </div>
      </div>

      {definition.candidateParent && (
        <div className="mt-3 rounded-lg border border-card-border bg-card/80 px-3 py-2 text-xs">
          <p className="font-medium">Suggested parent: {definition.candidateParent.projectTitle}</p>
          <p className="mt-0.5 text-muted-foreground">{definition.candidateParent.reason}</p>
        </div>
      )}

      {projectPlan && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proposed outcome milestones</p>
          <ol className="mt-2 space-y-2">
            {projectPlan.milestones.map((milestone, index) => (
              <li key={milestone.key} className="flex gap-2 text-xs">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{index + 1}</span>
                <span>
                  <span className="block font-medium text-foreground">{milestone.title}</span>
                  <span className="block leading-relaxed text-muted-foreground">{milestone.outcome}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-lg border border-card-border bg-card/80 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">First task preview</p>
            <p className="mt-1 text-sm font-medium">{projectPlan.currentTasks[projectPlan.activeTaskIndex]?.title || projectPlan.currentTasks[0]?.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">This remains a preview until the project is confirmed and you activate it separately.</p>
          </div>
        </div>
      )}

      {taskPlan && (
        <div className="mt-3 rounded-lg border border-card-border bg-card/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Task output</p>
          <p className="mt-1 text-sm font-medium">{taskPlan.task.output}</p>
          <ol className="mt-2 space-y-1.5 pl-4 text-xs text-foreground/80">
            {taskPlan.steps.map((step, index) => <li key={`${step.text}-${index}`} className="list-decimal">{step.text}</li>)}
          </ol>
        </div>
      )}

      {definition.needsClarification && (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
          <p className="text-xs font-medium">{definition.clarifyingQuestion}</p>
        </div>
      )}

      {editingGoal && (
        <div className="mt-3">
          <label className="text-xs font-medium" htmlFor={`work-goal-${task.id}`}>What should this ultimately produce or help you decide?</label>
          <textarea
            id={`work-goal-${task.id}`}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="For example: decide whether to pursue it, prepare for a conversation, or produce a one-page brief."
            className="mt-1.5 min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            data-testid={`input-work-goal-${task.id}`}
          />
          <Button size="sm" className="mt-2" onClick={() => interpret(goal)} disabled={!goal.trim() || busy === "reinterpret"} data-testid={`button-reinterpret-work-${task.id}`}>
            {busy === "reinterpret" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1 h-3.5 w-3.5" />}
            Reinterpret
          </Button>
        </div>
      )}

      {!editingGoal && !definition.needsClarification && preview.decomposition && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => confirm(definition.candidateParent ? "attach_to_parent" : "as_interpreted")} disabled={busy !== null} data-testid={`button-confirm-work-${task.id}`}>
            {busy === "confirm" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
            {actionLabel(definition)}
          </Button>
          {definition.workType !== "task" && definition.workType !== "decision" && (
            <Button size="sm" variant="outline" onClick={() => confirm("as_task")} disabled={busy !== null} data-testid={`button-work-as-task-${task.id}`}>
              {busy === "task" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Treat as one-off task
            </Button>
          )}
          {definition.workType !== "project" && (
            <Button size="sm" variant="outline" onClick={() => interpret(goal, "project")} disabled={busy !== null} data-testid={`button-work-as-project-${task.id}`}>
              {busy === "project" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Make this a project
            </Button>
          )}
          <button onClick={() => setEditingGoal(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid={`button-change-work-goal-${task.id}`}>
            <Pencil className="h-3 w-3" /> Change the goal
          </button>
        </div>
      )}
    </div>
  );
}
