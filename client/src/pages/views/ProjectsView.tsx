import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  FolderKanban,
  Loader2,
  PauseCircle,
  RotateCcw,
} from "lucide-react";
import type { Task } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/home/Empty";
import { Loading } from "@/components/home/Loading";
import { SectionHeading } from "@/components/home/SectionHeading";
import { mutateAndInvalidate } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type ProjectSummary = {
  id: number;
  title: string;
  objective: string;
  whyNow: string;
  desiredOutcome: string;
  status: string;
  currentMilestoneId: number | null;
  milestoneCount: number;
  taskCount: number;
};

type ProjectMilestone = {
  id: number;
  projectId: number;
  milestoneKey: string;
  title: string;
  outcome: string;
  doneWhen: string;
  status: string;
  sequence: number;
  tasks: Array<{ link: { id: number; role: string }; task: Task | null }>;
};

type ProjectDetail = {
  project: ProjectSummary;
  milestones: ProjectMilestone[];
  currentMilestone: ProjectMilestone | null;
  activeTask: Task | null;
  needsTaskActivation: boolean;
  needsMilestoneReview: boolean;
  canCompleteMilestone: boolean;
  readOnlySnapshot?: boolean;
};

type TaskPlan = {
  version: 1;
  task: {
    title: string;
    objective: string;
    doneWhen: string;
    output: string;
    whyNow: string;
    estimateMinutes: number;
    category: string;
  };
  steps: Array<{ text: string; outputSpec: string; executor: string; done: boolean }>;
  rollingPlan: false;
};

type NextWorkPreview = {
  project: ProjectSummary;
  milestone: ProjectMilestone;
  decomposition?: TaskPlan;
  existingActiveTask?: Task;
  requiresActivation?: boolean;
  requiresMilestoneReview?: boolean;
  complete?: boolean;
  message?: string;
};

const PROJECT_QUERY_KEYS = ["/api/projects", "/api/tasks", "/api/plan/current", "/api/anchor/today"];

function statusLabel(status: string) {
  if (status === "done" || status === "completed") return "Complete";
  if (status === "active") return "Current";
  if (status === "paused") return "Paused";
  return "Later";
}

function statusIcon(status: string) {
  if (status === "done" || status === "completed") return CheckCircle2;
  if (status === "active") return ArrowRight;
  if (status === "paused") return PauseCircle;
  return Circle;
}

export function ProjectsView() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ projects: ProjectSummary[] }>({ queryKey: ["/api/projects"] });
  const projects = data?.projects || [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<NextWorkPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "activate" | "milestone" | null>(null);

  useEffect(() => {
    if (!projects.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !projects.some((project) => project.id === selectedId)) {
      setSelectedId(projects[0].id);
    }
  }, [projects, selectedId]);

  const { data: detail, isLoading: detailLoading } = useQuery<ProjectDetail>({
    queryKey: ["/api/projects", selectedId],
    enabled: selectedId != null,
  });

  const sortedMilestones = useMemo(
    () => [...(detail?.milestones || [])].sort((left, right) => left.sequence - right.sequence),
    [detail?.milestones],
  );

  async function previewNextTask() {
    if (!selectedId || busy) return;
    setBusy("preview");
    try {
      const result = await mutateAndInvalidate(
        "POST",
        `/api/projects/${selectedId}/decompose`,
        { refine: true },
        ["/api/projects"],
      );
      setPreview(result as NextWorkPreview);
      if (result?.existingActiveTask) {
        toast({ title: "A task is already active", description: result.existingActiveTask.title });
      }
    } catch (error: any) {
      toast({ title: "Couldn't prepare the next task", description: error?.message || "The project was not changed." });
    } finally {
      setBusy(null);
    }
  }

  async function activateTask() {
    if (!selectedId || !preview?.milestone?.id || !preview.decomposition || busy) return;
    setBusy("activate");
    try {
      const result = await mutateAndInvalidate(
        "POST",
        `/api/projects/${selectedId}/activate-next`,
        { milestoneId: preview.milestone.id, decomposition: preview.decomposition },
        PROJECT_QUERY_KEYS,
      );
      toast({
        title: result?.reused ? "Task already active" : "Next task activated",
        description: result?.task?.title || "It is now available to Today.",
      });
      setPreview(null);
    } catch (error: any) {
      toast({ title: "Couldn't activate the task", description: error?.message || "The project remains unchanged." });
    } finally {
      setBusy(null);
    }
  }

  async function completeMilestone() {
    const milestoneId = detail?.currentMilestone?.id;
    if (!selectedId || !milestoneId || busy) return;
    setBusy("milestone");
    try {
      const result = await mutateAndInvalidate(
        "POST",
        `/api/projects/${selectedId}/milestones/${milestoneId}/complete`,
        {},
        PROJECT_QUERY_KEYS,
      );
      toast({
        title: result?.nextMilestone ? "Milestone complete" : "Project complete",
        description: result?.nextMilestone?.title || "The final project outcome is recorded.",
      });
      setPreview(null);
    } catch (error: any) {
      toast({ title: "Milestone still needs review", description: error?.message || "Complete its active task first." });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;

  return (
    <div>
      <SectionHeading title="Projects" sub="Multi-step outcomes, with only the current frontier detailed." />

      {!projects.length ? (
        <Empty icon={FolderKanban} text="No confirmed projects yet. Project-shaped captures will appear here after you review and confirm them." />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => { setSelectedId(project.id); setPreview(null); }}
                className={`min-w-56 rounded-xl border p-3 text-left transition-colors ${selectedId === project.id ? "border-primary/40 bg-primary/5" : "border-card-border bg-card hover:bg-muted/30"}`}
                data-testid={`project-card-${project.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold leading-snug">{project.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{statusLabel(project.status)}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{project.objective}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">{project.milestoneCount} milestones · {project.taskCount} activated tasks</p>
              </button>
            ))}
          </div>

          {detailLoading || !detail ? <Loading /> : (
            <div className="rounded-xl border border-card-border bg-card p-4" data-testid={`project-detail-${detail.project.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Confirmed project</p>
                  <h3 className="mt-1 text-lg font-semibold">{detail.project.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail.project.objective}</p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{statusLabel(detail.project.status)}</span>
              </div>

              <div className="mt-4 rounded-lg border border-card-border bg-muted/20 p-3">
                <p className="text-xs font-medium">Project outcome</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail.project.desiredOutcome}</p>
              </div>

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Milestone map</p>
                <div className="mt-3 space-y-2">
                  {sortedMilestones.map((milestone) => {
                    const Icon = statusIcon(milestone.status);
                    const isCurrent = detail.currentMilestone?.id === milestone.id;
                    return (
                      <div key={milestone.id} className={`rounded-lg border px-3 py-2.5 ${isCurrent ? "border-primary/30 bg-primary/5" : "border-card-border"}`}>
                        <div className="flex items-start gap-2.5">
                          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{milestone.title}</p>
                              <span className="text-[10px] text-muted-foreground">{statusLabel(milestone.status)}</span>
                            </div>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{milestone.outcome}</p>
                            {milestone.tasks.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {milestone.tasks.map(({ task }) => task && (
                                  <p key={task.id} className="flex items-center gap-1.5 text-xs text-foreground/80">
                                    {task.done || task.status === "done" ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <Circle className="h-3 w-3 text-muted-foreground" />}
                                    {task.title}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {detail.currentMilestone && (
                <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Current frontier</p>
                  <p className="mt-1 text-sm font-semibold">{detail.currentMilestone.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail.currentMilestone.doneWhen}</p>

                  {detail.activeTask ? (
                    <div className="mt-3 rounded-lg border border-card-border bg-card p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Active task</p>
                      <p className="mt-1 text-sm font-medium">{detail.activeTask.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Done when: {detail.activeTask.doneWhen}</p>
                    </div>
                  ) : detail.needsMilestoneReview ? (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground">The current task is complete. Confirm that its milestone outcome is satisfied before opening the next frontier.</p>
                      <Button size="sm" className="mt-2" onClick={completeMilestone} disabled={busy === "milestone"} data-testid={`button-complete-milestone-${detail.currentMilestone.id}`}>
                        {busy === "milestone" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                        {busy === "milestone" ? "Completing" : "Confirm milestone outcome"}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Button size="sm" onClick={previewNextTask} disabled={busy === "preview"} data-testid={`button-preview-project-task-${detail.project.id}`}>
                        {busy === "preview" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                        {busy === "preview" ? "Preparing" : "Preview next task"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {preview?.decomposition && preview.milestone.id === detail.currentMilestone?.id && (
                <div className="mt-4 rounded-xl border border-card-border bg-background p-3.5" data-testid={`project-task-preview-${detail.project.id}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Next task preview</p>
                  <p className="mt-1 text-sm font-semibold">{preview.decomposition.task.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{preview.decomposition.task.doneWhen}</p>
                  <ol className="mt-3 space-y-1.5 pl-4 text-xs text-foreground/80">
                    {preview.decomposition.steps.map((step, index) => <li key={`${step.text}-${index}`} className="list-decimal">{step.text}</li>)}
                  </ol>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={activateTask} disabled={busy === "activate"} data-testid={`button-activate-project-task-${detail.project.id}`}>
                      {busy === "activate" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1 h-3.5 w-3.5" />}
                      {busy === "activate" ? "Activating" : "Activate this task"}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">Only this task becomes live.</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
