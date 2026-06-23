import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, CheckCircle2, CircleHelp, GitBranch, Layers3, Milestone, Network, ShieldCheck, Sparkles, Target } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { api } from "@/lib/api";

type Requirement = {
  id: string;
  label: string;
  importance: "essential" | "important" | "differentiator" | "contextual";
  successBar: string;
};

type Resource = {
  id: string;
  title: string;
  type: string;
  url: string;
  publisher?: string;
  whySelected?: string;
  authority?: string;
  freshness?: string;
};

type Module = {
  id: string;
  title: string;
  objective: string;
  requirementIds: string[];
  concepts?: string[];
  resourceIds?: string[];
  practice?: string[];
  output?: string;
  doneWhen?: string;
};

type PlanMilestone = {
  id: string;
  title: string;
  outcome: string;
  doneWhen: string;
  requirementIds: string[];
  evidenceGenerated?: Array<{ type: string; description: string }>;
  dependencyIds?: string[];
  sequence: number;
};

type Workstream = {
  id: string;
  key: string;
  title: string;
  kind: "core" | "route_specific" | "verification" | "maintenance";
  purpose: string;
  outcome: string;
  requirementIds: string[];
  methods?: string[];
  modules?: Module[];
  milestones?: PlanMilestone[];
  dependencyIds?: string[];
  roleFamilyIds?: string[];
  rationale?: string;
};

type DevelopmentPlan = {
  mode: "development_plan_model";
  targetLabel: string;
  objective: string;
  principles?: string[];
  workstreams: Workstream[];
  resources?: Resource[];
  maintenanceRequirementIds?: string[];
  unresolvedRequirementIds?: string[];
  quality: {
    status: "complete" | "usable_with_caveats" | "provisional";
    materialRequirementCount: number;
    materialRequirementsMapped: number;
    materialCoverageRate: number;
    workstreamCount: number;
    caveats?: string[];
  };
};

type Response = {
  requirementModel?: { requirements?: Requirement[] } | null;
  developmentPlanModel?: DevelopmentPlan | null;
};

function methodLabel(method: string) {
  const labels: Record<string, string> = {
    learn: "Learn",
    practice: "Practise",
    produce: "Create proof",
    connect: "Build access",
    position: "Position",
    credential: "Qualify",
    research: "Verify",
  };
  return labels[method] || method;
}

function kindLabel(kind: Workstream["kind"]) {
  if (kind === "route_specific") return "Role-specific module";
  if (kind === "verification") return "Verify first";
  if (kind === "maintenance") return "Maintain";
  return "Core workstream";
}

function kindIcon(kind: Workstream["kind"]) {
  if (kind === "route_specific") return GitBranch;
  if (kind === "verification") return CircleHelp;
  if (kind === "maintenance") return ShieldCheck;
  return Layers3;
}

function list(values?: string[]) {
  return (values || []).map((value) => String(value || "").trim()).filter(Boolean);
}

export function DevelopmentPlanReview({ trackId }: { trackId?: number }) {
  const { data, isLoading, isError } = useQuery<Response>({
    queryKey: ["track-research-plan", trackId],
    queryFn: () => api.get(`/api/career-tracks/${trackId}/research-plan`),
    enabled: Boolean(trackId),
    staleTime: 60_000,
  });

  if (!trackId || isLoading || isError || !data?.developmentPlanModel) return null;

  const plan = data.developmentPlanModel;
  const requirementById = new Map((data.requirementModel?.requirements || []).map((requirement) => [requirement.id, requirement]));
  const resourceById = new Map((plan.resources || []).map((resource) => [resource.id, resource]));
  const activeWorkstreams = plan.workstreams.filter((workstream) => workstream.kind !== "maintenance");
  const coreWorkstreams = activeWorkstreams.filter((workstream) => workstream.kind !== "route_specific");
  const routeWorkstreams = activeWorkstreams.filter((workstream) => workstream.kind === "route_specific");
  const verifiedResourceCount = (plan.resources || []).filter((resource) => Boolean(resource.url)).length;
  const isComplete = plan.quality.status === "complete";

  if (!activeWorkstreams.length) {
    return (
      <section className="mt-3 rounded-xl border border-card-border bg-background/60 p-3" data-testid="development-plan-review">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" />
          <div>
            <p className="text-xs font-semibold text-foreground">Current evidence covers the material requirements</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor will preserve and reuse that evidence. It has not created unnecessary development work.</p>
          </div>
        </div>
      </section>
    );
  }

  const renderWorkstream = (workstream: Workstream) => {
    const Icon = kindIcon(workstream.kind);
    const requirements = workstream.requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as Requirement[];
    const modules = workstream.modules || [];
    const milestones = [...(workstream.milestones || [])].sort((a, b) => a.sequence - b.sequence);

    return (
      <AccordionItem key={workstream.id} value={workstream.id} className="rounded-lg border border-card-border px-3">
        <AccordionTrigger className="py-3 hover:no-underline">
          <div className="min-w-0 pr-2 text-left">
            <div className="flex flex-wrap items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">{workstream.title}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{kindLabel(workstream.kind)}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{requirements.length} requirement{requirements.length === 1 ? "" : "s"}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{workstream.outcome}</p>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pb-3">
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/50 p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Why this workstream exists</p>
              <p className="mt-1 text-xs leading-snug text-foreground">{workstream.purpose}</p>
              {workstream.rationale && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{workstream.rationale}</p>}
              {!!workstream.methods?.length && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {workstream.methods.map((method) => <span key={method} className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{methodLabel(method)}</span>)}
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">What this builds</p>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {requirements.map((requirement) => (
                  <div key={requirement.id} className="rounded-md border border-card-border bg-card p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-foreground">{requirement.label}</p>
                      <span className="text-[10px] text-muted-foreground">{requirement.importance}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-muted-foreground">Done when {requirement.successBar}</p>
                  </div>
                ))}
              </div>
            </div>

            {!!milestones.length && (
              <div>
                <div className="flex items-center gap-1.5">
                  <Milestone className="h-3.5 w-3.5 text-primary" />
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Milestones</p>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {milestones.map((milestone, index) => (
                    <div key={milestone.id} className="rounded-md border border-card-border bg-card p-2">
                      <div className="flex items-start gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">{index + 1}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-foreground">{milestone.title}</p>
                          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{milestone.outcome}</p>
                          <p className="mt-1 text-[10px] leading-snug text-primary">Done when {milestone.doneWhen}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!!modules.length && (
              <div>
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Syllabus and applied practice</p>
                </div>
                <div className="mt-1.5 space-y-2">
                  {modules.map((module) => {
                    const resources = list(module.resourceIds).map((id) => resourceById.get(id)).filter(Boolean) as Resource[];
                    return (
                      <div key={module.id} className="rounded-md border border-card-border bg-card p-2.5">
                        <p className="text-[11px] font-semibold text-foreground">{module.title}</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{module.objective}</p>
                        {!!module.concepts?.length && <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground"><span className="font-medium text-foreground">Understand</span> {module.concepts.join(" · ")}</p>}
                        {!!module.practice?.length && <p className="mt-1 text-[10px] leading-snug text-muted-foreground"><span className="font-medium text-foreground">Apply</span> {module.practice.join(" · ")}</p>}
                        {module.output && <p className="mt-1 text-[10px] leading-snug text-muted-foreground"><span className="font-medium text-foreground">Produce</span> {module.output}</p>}
                        {!!resources.length && (
                          <div className="mt-2 space-y-1">
                            {resources.map((resource) => (
                              <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-2 rounded-md bg-muted/50 p-2 hover:bg-muted">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-medium text-foreground">{resource.title}</p>
                                  <p className="text-[10px] text-muted-foreground">{[resource.publisher, resource.type, resource.authority].filter(Boolean).join(" · ")}</p>
                                  {resource.whySelected && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{resource.whySelected}</p>}
                                </div>
                                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              </a>
                            ))}
                          </div>
                        )}
                        {module.doneWhen && <p className="mt-2 text-[10px] leading-snug text-primary">Complete when {module.doneWhen}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  };

  return (
    <section className="mt-3 rounded-xl border border-card-border bg-background/60 p-3" data-testid="development-plan-review">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">How Anchor will build the rest</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">A complete development architecture linked to the requirements and evidence above. This is not a task list or a daily sequence.</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <div className="flex items-center gap-1.5"><Layers3 className="h-3.5 w-3.5 text-primary" /><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Coherent workstreams</p></div>
          <p className="mt-1 text-lg font-semibold text-foreground">{coreWorkstreams.length}</p>
          <p className="text-[10px] text-muted-foreground">plus {routeWorkstreams.length} role-specific module{routeWorkstreams.length === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <div className="flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-primary" /><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Material requirements mapped</p></div>
          <p className="mt-1 text-lg font-semibold text-foreground">{plan.quality.materialRequirementsMapped}/{plan.quality.materialRequirementCount}</p>
          <p className="text-[10px] text-muted-foreground">{plan.quality.materialCoverageRate}% accounted for</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <div className="flex items-center gap-1.5"><Network className="h-3.5 w-3.5 text-primary" /><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Verified resources</p></div>
          <p className="mt-1 text-lg font-semibold text-foreground">{verifiedResourceCount}</p>
          <p className="text-[10px] text-muted-foreground">linked to syllabus modules</p>
        </div>
      </div>

      <div className={`mt-3 rounded-lg p-2.5 ${isComplete ? "bg-emerald-50" : "bg-amber-50"}`}>
        <div className="flex items-start gap-2">
          {isComplete ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-700" /> : <CircleHelp className="mt-0.5 h-3.5 w-3.5 text-amber-700" />}
          <div>
            <p className={`text-[11px] font-medium ${isComplete ? "text-emerald-800" : "text-amber-800"}`}>{plan.objective}</p>
            {!isComplete && <p className="mt-0.5 text-[10px] leading-snug text-amber-700">{list(plan.quality.caveats)[0] || "Anchor will keep this plan provisional until the missing evidence is resolved."}</p>}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Shared development plan</p>
        <Accordion type="multiple" className="mt-1.5 space-y-2">
          {coreWorkstreams.map(renderWorkstream)}
        </Accordion>
      </div>

      {!!routeWorkstreams.length && (
        <Accordion type="single" collapsible className="mt-3">
          <AccordionItem value="role-specific" className="rounded-lg border border-card-border px-3">
            <AccordionTrigger className="py-3 text-xs hover:no-underline">
              <div className="text-left">
                <p className="font-medium text-foreground">Role-specific modules</p>
                <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">Kept separate so specialised requirements do not inflate the shared core plan.</p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <Accordion type="multiple" className="space-y-2">
                {routeWorkstreams.map(renderWorkstream)}
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {!!plan.unresolvedRequirementIds?.length && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-card-border bg-card p-2.5">
          <CircleHelp className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <div>
            <p className="text-[11px] font-medium text-foreground">Anchor will verify {plan.unresolvedRequirementIds.length} unknown requirement{plan.unresolvedRequirementIds.length === 1 ? "" : "s"} before prescribing development</p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">Unknown means the evidence is incomplete. It does not mean you lack the capability.</p>
          </div>
        </div>
      )}
    </section>
  );
}
