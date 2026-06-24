import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  ListChecks,
  LockKeyhole,
  Milestone,
  Route,
  Sparkles,
  UserRound,
  UsersRound,
  Workflow,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type BlueprintExecutor = "system" | "user_learning" | "user_action";
type BlueprintOwner = "anchor" | "user" | "shared";
type BlueprintReadiness = "ready" | "depends_on_blueprint" | "conditional";
type BlueprintEffort = "quick" | "medium" | "deep" | "project";
type TaskBlueprintKind =
  | "research"
  | "learning"
  | "practice"
  | "experience"
  | "artifact"
  | "relationship"
  | "access"
  | "credential"
  | "verification"
  | "validation";

type SubtaskBlueprint = {
  id: string;
  title: string;
  executor: BlueprintExecutor;
  condition: "always" | "if_needed";
  outputSpec: string;
  doneWhen: string;
  dependsOnSubtaskIds: string[];
};

type TaskBlueprint = {
  id: string;
  workstreamId: string;
  moduleId: string;
  moduleTitle: string;
  milestoneIds: string[];
  requirementIds: string[];
  sequence: number;
  title: string;
  kind: TaskBlueprintKind;
  owner: BlueprintOwner;
  why: string;
  doneWhen: string;
  minimumOutcome: string;
  expectedEvidence: string;
  effort: BlueprintEffort;
  readiness: BlueprintReadiness;
  readinessReason: string;
  dependsOnTaskIds: string[];
  subtasks: SubtaskBlueprint[];
  materialization: { state: "blueprint_only" };
};

type WorkstreamExecutionBlueprint = {
  workstreamId: string;
  title: string;
  objective: string;
  taskIds: string[];
  moduleIds: string[];
  milestoneIds: string[];
  completionTaskId: string | null;
};

type ExecutionBlueprintModel = {
  mode: "execution_blueprint_model";
  targetLabel: string;
  objective: string;
  principles: string[];
  workstreams: WorkstreamExecutionBlueprint[];
  tasks: TaskBlueprint[];
  summary: {
    workstreamCount: number;
    moduleCount: number;
    milestoneCount: number;
    taskCount: number;
    subtaskCount: number;
    anchorOwnedTaskCount: number;
    userOwnedTaskCount: number;
    sharedTaskCount: number;
    conditionalTaskCount: number;
  };
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    moduleCoverageRate: number;
    milestoneCoverageRate: number;
    requirementCoverageRate: number;
    caveats: string[];
  };
  materializationStatus: "blueprint_only";
};

type ExecutionBlueprintResponse = {
  executionBlueprintModel?: ExecutionBlueprintModel | null;
};

const OWNER_META: Record<BlueprintOwner, { label: string; detail: string; icon: typeof Bot; tone: string }> = {
  anchor: {
    label: "Anchor handles",
    detail: "The value is in the artifact or analysis, so Anchor can prepare it automatically.",
    icon: Bot,
    tone: "bg-primary/10 text-primary",
  },
  user: {
    label: "You do",
    detail: "The value depends on your learning, judgement or real-world action.",
    icon: UserRound,
    tone: "bg-violet-50 text-violet-700",
  },
  shared: {
    label: "Shared",
    detail: "Anchor prepares the work and you provide the judgement or external action.",
    icon: UsersRound,
    tone: "bg-sky-50 text-sky-700",
  },
};

const EXECUTOR_LABEL: Record<BlueprintExecutor, string> = {
  system: "Anchor",
  user_learning: "You learn or practise",
  user_action: "You take the real-world action",
};

const KIND_LABEL: Record<TaskBlueprintKind, string> = {
  research: "Research",
  learning: "Learning",
  practice: "Practice",
  experience: "Applied experience",
  artifact: "Artifact",
  relationship: "Relationship",
  access: "Access",
  credential: "Formal requirement",
  verification: "Verification",
  validation: "Quality check",
};

const EFFORT_LABEL: Record<BlueprintEffort, string> = {
  quick: "Quick",
  medium: "Focused",
  deep: "Deep work",
  project: "Project",
};

const READINESS_LABEL: Record<BlueprintReadiness, string> = {
  ready: "Structurally ready",
  depends_on_blueprint: "Has a prerequisite",
  conditional: "Role-specific",
};

const QUALITY_META = {
  complete: { label: "Complete blueprint", tone: "bg-emerald-50 text-emerald-700" },
  usable_with_caveats: { label: "Usable blueprint", tone: "bg-sky-50 text-sky-700" },
  provisional: { label: "Provisional blueprint", tone: "bg-amber-50 text-amber-800" },
} as const;

function list(values?: string[]) {
  return (values || []).map((value) => String(value || "").trim()).filter(Boolean);
}

function TaskCard({ task, taskById }: { task: TaskBlueprint; taskById: Map<string, TaskBlueprint> }) {
  const owner = OWNER_META[task.owner];
  const OwnerIcon = owner.icon;
  const dependencies = task.dependsOnTaskIds.map((id) => taskById.get(id)?.title).filter(Boolean) as string[];
  return (
    <div className="rounded-xl border border-card-border bg-background/60 p-3" data-testid={`execution-task-${task.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{task.sequence}</span>
            <p className="text-xs font-semibold leading-snug text-foreground">{task.title}</p>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{task.why}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${owner.tone}`}><OwnerIcon className="h-3 w-3" /> {owner.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">{KIND_LABEL[task.kind]}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">{EFFORT_LABEL[task.effort]}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Minimum useful result</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{task.minimumOutcome}</p>
        </div>
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Complete when</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{task.doneWhen}</p>
        </div>
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Evidence created</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{task.expectedEvidence}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">{READINESS_LABEL[task.readiness]}</span>
        {task.milestoneIds.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">Supports {task.milestoneIds.length} milestone{task.milestoneIds.length === 1 ? "" : "s"}</span>}
        {dependencies.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] text-amber-800">After {dependencies.length} prerequisite{dependencies.length === 1 ? "" : "s"}</span>}
      </div>

      {dependencies.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50/60 p-2">
          <p className="text-[10px] font-medium text-amber-800">Logical prerequisite</p>
          {dependencies.map((dependency) => <p key={dependency} className="mt-0.5 text-[10px] leading-snug text-amber-800">• {dependency}</p>)}
        </div>
      )}

      <details className="mt-3 rounded-lg border border-card-border bg-card p-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-medium text-foreground">
          <span className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5 text-primary" /> {task.subtasks.length} execution step{task.subtasks.length === 1 ? "" : "s"}</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </summary>
        <div className="mt-2 space-y-1.5">
          {task.subtasks.map((subtask, index) => (
            <div key={subtask.id} className="rounded-lg bg-muted/25 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-background text-[9px] font-medium text-muted-foreground">{index + 1}</span>
                <p className="text-[11px] font-medium text-foreground">{subtask.title}</p>
                <span className="rounded-full bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">{EXECUTOR_LABEL[subtask.executor]}</span>
                {subtask.condition === "if_needed" && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-800">Only if needed</span>}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">Produces {subtask.outputSpec}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-primary">Done when {subtask.doneWhen}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export function TrackExecutionBlueprint({ trackId }: { trackId?: number }) {
  const { data, isLoading, isError } = useQuery<ExecutionBlueprintResponse>({
    queryKey: [`/api/career-tracks/${trackId}/execution-blueprint`],
    enabled: Boolean(trackId),
    staleTime: 60_000,
    retry: false,
  });

  const model = data?.executionBlueprintModel;
  const taskById = useMemo(() => new Map((model?.tasks || []).map((task) => [task.id, task])), [model?.tasks]);

  if (!trackId) return null;
  if (isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Building the complete work hierarchy</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is translating the development plan into task and subtask blueprints without adding anything to Today.</p>
      </div>
    );
  }
  if (isError || !model) {
    return (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Execution blueprint not available yet</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">The development plan remains available. Anchor will build the work hierarchy once that plan is current.</p>
      </div>
    );
  }

  const quality = QUALITY_META[model.quality.status];
  if (!model.tasks.length) {
    return (
      <section className="mt-4 rounded-xl border border-card-border bg-emerald-50/40 p-3" data-testid="track-execution-blueprint">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" />
          <div>
            <p className="text-xs font-semibold text-emerald-800">No new execution work is required</p>
            <p className="mt-1 text-[11px] leading-snug text-emerald-800">The development plan contains maintenance only, so Anchor has not manufactured tasks.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-execution-blueprint">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><Workflow className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">What work sits underneath the plan</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.objective}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">The hierarchy is complete, but it has not been prioritized, scheduled or added to your live task list.</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${quality.tone}`}>{quality.label}</span>
      </div>

      <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-2.5">
        <div className="flex items-start gap-2">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <div>
            <p className="text-[11px] font-medium text-primary">Blueprint only</p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">Nothing below has been added to Today or turned into a live task. Installment 5 will select and materialize only a small active slice.</p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Workstreams</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.workstreamCount}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Task blueprints</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.taskCount}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Execution steps</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.subtaskCount}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Anchor can handle</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{model.summary.anchorOwnedTaskCount}</p>
          <p className="text-[10px] text-muted-foreground">plus {model.summary.sharedTaskCount} shared</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary"><Bot className="h-3 w-3" /> {model.summary.anchorOwnedTaskCount} Anchor-led</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[10px] text-sky-700"><UsersRound className="h-3 w-3" /> {model.summary.sharedTaskCount} shared</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-[10px] text-violet-700"><UserRound className="h-3 w-3" /> {model.summary.userOwnedTaskCount} user-led</span>
        {model.summary.conditionalTaskCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground"><Route className="h-3 w-3" /> {model.summary.conditionalTaskCount} role-specific</span>}
      </div>

      <Accordion type="single" collapsible className="mt-4 space-y-2">
        {model.workstreams.map((workstream) => {
          const tasks = workstream.taskIds.map((id) => taskById.get(id)).filter(Boolean) as TaskBlueprint[];
          const moduleGroups = new Map<string, TaskBlueprint[]>();
          for (const task of tasks) moduleGroups.set(task.moduleTitle, [...(moduleGroups.get(task.moduleTitle) || []), task]);
          return (
            <AccordionItem key={workstream.workstreamId} value={workstream.workstreamId} className="rounded-xl border border-card-border bg-card px-3">
              <AccordionTrigger className="py-3 text-left hover:no-underline">
                <div className="flex min-w-0 flex-1 items-start gap-2 pr-2">
                  <Milestone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">{workstream.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{workstream.objective}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{tasks.length} tasks</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pb-1">
                  {[...moduleGroups.entries()].map(([moduleTitle, moduleTasks]) => (
                    <div key={moduleTitle}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <FileCheck2 className="h-3.5 w-3.5 text-primary" />
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{moduleTitle}</p>
                      </div>
                      <div className="space-y-2">
                        {moduleTasks.map((task) => <TaskCard key={task.id} task={task} taskById={taskById} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {list(model.quality.caveats).length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-muted/20 p-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground"><CircleHelp className="h-3.5 w-3.5 text-primary" /> Blueprint caveats</summary>
          <div className="mt-2 space-y-1">
            {list(model.quality.caveats).map((caveat) => <p key={caveat} className="text-[11px] leading-snug text-muted-foreground">• {caveat}</p>)}
          </div>
        </details>
      )}
    </section>
  );
}
