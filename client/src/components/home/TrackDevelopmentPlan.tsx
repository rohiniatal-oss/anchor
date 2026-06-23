import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  KeyRound,
  Layers3,
  Network,
  Route,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type DevelopmentAction = "build" | "strengthen" | "demonstrate" | "verify" | "maintain";
type DevelopmentScope = "core" | "enhancement" | "conditional" | "maintenance";
type DevelopmentMethod =
  | "learn"
  | "practice"
  | "gain_experience"
  | "create_proof"
  | "position"
  | "build_relationships"
  | "build_access"
  | "resolve_credential"
  | "resolve_eligibility"
  | "verify"
  | "maintain";
type DevelopmentModuleType =
  | "syllabus"
  | "practice"
  | "experience"
  | "proof"
  | "narrative"
  | "relationships"
  | "access"
  | "credential"
  | "eligibility"
  | "verification";

type TargetRequirement = {
  id: string;
  label: string;
  importance: "essential" | "important" | "differentiator" | "contextual";
  category: string;
  successBar: string;
};

type RequirementDevelopmentDecision = {
  requirementId: string;
  action: DevelopmentAction;
  scope: DevelopmentScope;
  reason: string;
  desiredEvidence: string;
};

type DevelopmentModule = {
  id: string;
  title: string;
  type: DevelopmentModuleType;
  scope: Exclude<DevelopmentScope, "maintenance">;
  objective: string;
  requirementIds: string[];
  resources: Array<{ title: string; type: string; url?: string; why?: string }>;
  activities: string[];
  output: string;
  assessmentCriteria: string[];
};

type DevelopmentMilestone = {
  id: string;
  label: string;
  sequence: number;
  requirementIds: string[];
  doneWhen: string;
  evidenceCreated: string;
};

type DevelopmentWorkstream = {
  id: string;
  title: string;
  objective: string;
  rationale: string;
  scopeMix: Array<Exclude<DevelopmentScope, "maintenance">>;
  requirementIds: string[];
  methods: DevelopmentMethod[];
  modules: DevelopmentModule[];
  milestones: DevelopmentMilestone[];
  dependencyNotes: string[];
  completionStandard: string;
};

type DevelopmentPlanModel = {
  mode: "development_plan_model";
  targetLabel: string;
  planSummary: string;
  decisions: RequirementDevelopmentDecision[];
  workstreams: DevelopmentWorkstream[];
  maintenanceRequirementIds: string[];
  quality: {
    status: "strong" | "usable" | "provisional";
    plannedRequirementCount: number;
    maintenanceRequirementCount: number;
    conditionalRequirementCount: number;
    enhancementRequirementCount: number;
    caveats: string[];
  };
};

type DevelopmentPlanResponse = {
  requirementModel?: { requirements: TargetRequirement[] };
  developmentPlanModel?: DevelopmentPlanModel | null;
};

const ACTION_LABEL: Record<DevelopmentAction, string> = {
  build: "Build",
  strengthen: "Strengthen",
  demonstrate: "Demonstrate",
  verify: "Verify first",
  maintain: "Maintain",
};

const ACTION_TONE: Record<DevelopmentAction, string> = {
  build: "bg-primary/10 text-primary",
  strengthen: "bg-sky-50 text-sky-700",
  demonstrate: "bg-violet-50 text-violet-700",
  verify: "bg-amber-50 text-amber-800",
  maintain: "bg-emerald-50 text-emerald-700",
};

const SCOPE_LABEL: Record<Exclude<DevelopmentScope, "maintenance">, string> = {
  core: "Core",
  enhancement: "Upside",
  conditional: "Role-specific",
};

const SCOPE_TONE: Record<Exclude<DevelopmentScope, "maintenance">, string> = {
  core: "bg-primary/10 text-primary",
  enhancement: "bg-violet-50 text-violet-700",
  conditional: "bg-muted text-muted-foreground",
};

const METHOD_LABEL: Record<DevelopmentMethod, string> = {
  learn: "Learn",
  practice: "Practise",
  gain_experience: "Gain experience",
  create_proof: "Create proof",
  position: "Position",
  build_relationships: "Build relationships",
  build_access: "Build access",
  resolve_credential: "Resolve credential",
  resolve_eligibility: "Resolve eligibility",
  verify: "Verify evidence",
  maintain: "Maintain",
};

const MODULE_META: Record<DevelopmentModuleType, { label: string; icon: typeof BookOpen }> = {
  syllabus: { label: "Syllabus", icon: BookOpen },
  practice: { label: "Practice", icon: Wrench },
  experience: { label: "Applied experience", icon: Route },
  proof: { label: "Proof", icon: FileCheck2 },
  narrative: { label: "Positioning", icon: Sparkles },
  relationships: { label: "Relationships", icon: Network },
  access: { label: "Hiring access", icon: KeyRound },
  credential: { label: "Credential", icon: BadgeCheck },
  eligibility: { label: "Eligibility", icon: CheckCircle2 },
  verification: { label: "Verification", icon: ClipboardCheck },
};

const QUALITY_META = {
  strong: { label: "Complete plan structure", tone: "bg-emerald-50 text-emerald-700" },
  usable: { label: "Useful plan structure", tone: "bg-sky-50 text-sky-700" },
  provisional: { label: "Provisional plan structure", tone: "bg-amber-50 text-amber-800" },
} as const;

function list(values?: string[]) {
  return (values || []).map((value) => String(value || "").trim()).filter(Boolean);
}

function ModuleCard({ module, requirementById }: { module: DevelopmentModule; requirementById: Map<string, TargetRequirement> }) {
  const meta = MODULE_META[module.type];
  const Icon = meta.icon;
  const requirements = module.requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  return (
    <div className="rounded-xl border border-card-border bg-background/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5 text-primary"><Icon className="h-3.5 w-3.5" /></div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{module.title}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{module.objective}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{meta.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SCOPE_TONE[module.scope]}`}>{SCOPE_LABEL[module.scope]}</span>
        </div>
      </div>

      {requirements.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {requirements.map((requirement) => <span key={requirement.id} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{requirement.label}</span>)}
        </div>
      )}

      {list(module.activities).length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">What this module contains</p>
          <div className="mt-1.5 space-y-1">
            {list(module.activities).slice(0, 5).map((activity, index) => <p key={`${activity}-${index}`} className="text-[11px] leading-snug text-foreground">• {activity}</p>)}
          </div>
        </div>
      )}

      {module.resources.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Resources and inputs</p>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {module.resources.slice(0, 6).map((resource, index) => (
              <div key={`${resource.title}-${index}`} className="rounded-lg bg-muted/30 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-foreground">{resource.title}</span>
                  <span className="rounded-full bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">{resource.type.replace(/_/g, " ")}</span>
                  {resource.url && <a href={resource.url} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline">Open</a>}
                </div>
                {resource.why && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{resource.why}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Output</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{module.output}</p>
        </div>
        <div className="rounded-lg bg-primary/[0.04] p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">How it will be assessed</p>
          {list(module.assessmentCriteria).slice(0, 4).map((criterion, index) => <p key={`${criterion}-${index}`} className="mt-1 text-[11px] leading-snug text-foreground">• {criterion}</p>)}
        </div>
      </div>
    </div>
  );
}

function WorkstreamPanel({ workstream, requirementById, decisionByRequirement }: {
  workstream: DevelopmentWorkstream;
  requirementById: Map<string, TargetRequirement>;
  decisionByRequirement: Map<string, RequirementDevelopmentDecision>;
}) {
  const requirements = workstream.requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  return (
    <AccordionItem value={workstream.id} className="rounded-xl border border-card-border bg-card px-3">
      <AccordionTrigger className="py-3 text-left hover:no-underline">
        <div className="flex min-w-0 flex-1 items-start gap-2 pr-2">
          <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-xs font-semibold text-foreground">{workstream.title}</p>
              {workstream.scopeMix.map((scope) => <span key={scope} className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${SCOPE_TONE[scope]}`}>{SCOPE_LABEL[scope]}</span>)}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{workstream.objective}</p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{requirements.length} requirements</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pb-1">
          <p className="text-xs leading-relaxed text-muted-foreground">{workstream.rationale}</p>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Requirements this workstream serves</p>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {requirements.map((requirement) => {
                const decision = decisionByRequirement.get(requirement.id);
                return (
                  <div key={requirement.id} className="rounded-lg bg-muted/30 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-foreground">{requirement.label}</span>
                      {decision && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${ACTION_TONE[decision.action]}`}>{ACTION_LABEL[decision.action]}</span>}
                    </div>
                    {decision?.reason && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{decision.reason}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {workstream.methods.map((method) => <span key={method} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{METHOD_LABEL[method]}</span>)}
          </div>

          <div className="space-y-2">
            {workstream.modules.map((module) => <ModuleCard key={module.id} module={module} requirementById={requirementById} />)}
          </div>

          {workstream.milestones.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Milestones</p>
              <div className="mt-1.5 space-y-1.5">
                {workstream.milestones.map((milestone) => (
                  <div key={milestone.id} className="flex gap-2 rounded-lg bg-muted/25 p-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-[10px] font-semibold text-primary">{milestone.sequence}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground">{milestone.label}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">Done when {milestone.doneWhen}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-primary">Creates {milestone.evidenceCreated}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {list(workstream.dependencyNotes).length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Logical dependencies</p>
              {list(workstream.dependencyNotes).map((note, index) => <p key={`${note}-${index}`} className="mt-1 text-[11px] leading-snug text-muted-foreground">• {note}</p>)}
            </div>
          )}

          <div className="rounded-lg border border-card-border bg-background/60 p-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Workstream complete when</p>
            <p className="mt-1 text-[11px] leading-snug text-foreground">{workstream.completionStandard}</p>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function TrackDevelopmentPlan({ trackId }: { trackId?: number }) {
  const { data, isLoading, isError } = useQuery<DevelopmentPlanResponse>({
    queryKey: [`/api/career-tracks/${trackId}/development-plan`],
    enabled: !!trackId,
    staleTime: 0,
    retry: false,
  });

  if (!trackId) return null;
  if (isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Building how you get the rest</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is consolidating the uncovered requirements into coherent workstreams, modules, outputs, and milestones.</p>
      </div>
    );
  }
  if (isError || !data?.developmentPlanModel || !data.requirementModel) {
    return (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Development plan not available yet</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">The requirement and coverage views remain usable. Anchor will build this plan after the evidence assessment is available.</p>
      </div>
    );
  }

  const model = data.developmentPlanModel;
  const requirementById = new Map(data.requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const decisionByRequirement = new Map(model.decisions.map((decision) => [decision.requirementId, decision]));
  const actionCounts = model.decisions.reduce((acc, decision) => {
    acc[decision.action] += 1;
    return acc;
  }, { build: 0, strengthen: 0, demonstrate: 0, verify: 0, maintain: 0 } as Record<DevelopmentAction, number>);
  const quality = QUALITY_META[model.quality.status];

  return (
    <div className="mt-4 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-development-plan">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><Layers3 className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">How Anchor will build the rest</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.planSummary}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">This is the full development architecture. Tasks, subtasks, and execution order come in later installments.</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${quality.tone}`}>{quality.label}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.workstreams.length} workstreams</span>
        {actionCounts.build > 0 && <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${ACTION_TONE.build}`}>{actionCounts.build} to build</span>}
        {actionCounts.strengthen > 0 && <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${ACTION_TONE.strengthen}`}>{actionCounts.strengthen} to strengthen</span>}
        {actionCounts.demonstrate > 0 && <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${ACTION_TONE.demonstrate}`}>{actionCounts.demonstrate} to demonstrate</span>}
        {actionCounts.verify > 0 && <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${ACTION_TONE.verify}`}>{actionCounts.verify} to verify</span>}
        {actionCounts.maintain > 0 && <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${ACTION_TONE.maintain}`}>{actionCounts.maintain} already covered</span>}
      </div>

      {model.workstreams.length === 0 ? (
        <div className="mt-3 rounded-xl bg-emerald-50/50 p-3">
          <p className="text-xs font-semibold text-emerald-800">The current evidence covers the target requirements</p>
          <p className="mt-1 text-[11px] leading-snug text-emerald-800">The plan is to maintain, reuse, and keep the evidence current rather than manufacture unnecessary development work.</p>
        </div>
      ) : (
        <Accordion type="single" collapsible defaultValue={model.workstreams[0]?.id} className="mt-4 space-y-2">
          {model.workstreams.map((workstream) => (
            <WorkstreamPanel key={workstream.id} workstream={workstream} requirementById={requirementById} decisionByRequirement={decisionByRequirement} />
          ))}
        </Accordion>
      )}

      {list(model.quality.caveats).length > 0 && (
        <details className="mt-3 rounded-xl border border-card-border bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">Plan caveats</summary>
          <div className="mt-2 space-y-1">
            {list(model.quality.caveats).map((caveat, index) => <p key={`${caveat}-${index}`} className="text-[11px] leading-snug text-muted-foreground">• {caveat}</p>)}
          </div>
        </details>
      )}
    </div>
  );
}
