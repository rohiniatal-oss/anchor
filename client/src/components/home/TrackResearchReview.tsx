import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Briefcase, CheckCircle2, Database, FlaskConical, ListOrdered, Network, Search, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS } from "@/lib/homeTypes";

type EvidenceItem = {
  sourceTitle: string;
  sourceUrl?: string;
  sourceType?: string;
  claimSupported: string;
  usedFor?: string;
  confidence?: string;
  whyReliable?: string;
};

type Hypothesis = {
  hypothesis: string;
  whyItMightBeTrue: string;
  howToTest: string;
  disconfirmingSignal: string;
  priority?: number;
};

type PathHypothesis = {
  title: string;
  description?: string;
  confidence?: number;
  capabilityFit?: number;
  preferenceFit?: number;
  accessFit?: number;
  valuesFit?: number;
  lifestyleFit?: number;
  whyPromising?: string;
  risks?: string[];
  testSignals?: string[];
};

type CareerHypothesis = {
  input?: string;
  normalizedTitle?: string;
  confidence?: number;
  whyAttractive?: string;
  coreUncertainties?: string[];
};

type RequirementNode = {
  path?: string;
  capitalType?: string;
  requirement: string;
  evidence?: string;
  priority?: number;
};

type CareerCapitalItem = {
  capitalType?: string;
  asset: string;
  currentLevel?: string;
  evidence?: string;
  linkedPaths?: string[];
};

type GapItem = {
  gap: string;
  capitalType?: string;
  severity?: string;
  evidence?: string;
  linkedPaths?: string[];
  whyItMatters?: string;
};

type InterventionRecommendation = {
  gap?: string;
  gapType?: string;
  interventionType?: string;
  recommendation: string;
  whyThis?: string;
  output?: string;
  assessmentCriteria?: string;
  priority?: number;
};

type DevelopmentPlan = {
  title: string;
  capitalType?: string;
  objective?: string;
  supportsPaths?: string[];
  resources?: Array<{ title: string; type?: string; why?: string; url?: string }>;
  practice?: string[];
  proofOutputs?: string[];
  networkInputs?: string[];
  milestones?: Array<{ label: string; doneWhen?: string }>;
  assessmentCriteria?: string[];
  updateTriggers?: string[];
};

type EvidenceLoop = {
  evidenceToCollect: string;
  wouldIncreaseConfidence?: string;
  wouldDecreaseConfidence?: string;
};

type FitGapDimension = {
  strengths?: string[];
  gaps?: string[];
  evidenceNeeded?: string[];
};

type TrackPlanLane = {
  lane: string;
  objective: string;
  whyNow: string;
  workstreams?: Array<{ title: string; action: string; doneWhen: string; evidence: string; priority?: number }>;
};

type WorkspaceItem = {
  id: string;
  rank?: number;
  lane: string;
  title: string;
  action: string;
  doneWhen: string;
  why: string;
  evidence: string;
  priority: number;
  sourceType: string;
  savedIn: string;
  activationTarget: string;
};

type OrganizedWorkspace = {
  savedTo?: Array<{ label: string; storage: string; status: string; contains?: string[] }>;
  sortingLogic?: Array<{ rule: string; reason: string }>;
  lanes?: Array<{ lane: string; purpose: string; savedIn: string; activationTarget: string; items?: WorkspaceItem[] }>;
  assessmentQueue?: WorkspaceItem[];
  priorityQueue?: WorkspaceItem[];
};

type ResearchPlanResponse = {
  track: { id: number; name: string; description?: string; whyItFits?: string };
  plan?: { horizon?: string; logic?: string; lanes?: TrackPlanLane[] } | null;
  searchPlan?: Record<string, string[]> | null;
  evidencePack?: EvidenceItem[];
  careerHypothesis?: CareerHypothesis | null;
  pathHypotheses?: PathHypothesis[];
  trackHypotheses?: Hypothesis[];
  requirementGraph?: RequirementNode[];
  careerCapitalPortfolio?: CareerCapitalItem[];
  gapPortfolio?: GapItem[];
  interventionRecommendations?: InterventionRecommendation[];
  developmentPlans?: DevelopmentPlan[];
  evidenceLoops?: EvidenceLoop[];
  fitGapMatrix?: Record<string, FitGapDimension> | null;
  sectorMap?: Array<{ sector: string; description: string; exampleOrgs?: string[] }>;
  roleShapes?: Array<{ title: string; what: string; typicalOrgs?: string[]; seniority?: string }>;
  gapAnalysis?: { strengths?: string[]; gaps?: string[]; biggestGap?: string } | null;
  organizedWorkspace?: OrganizedWorkspace | null;
  activationInventory?: { jobIds?: number[]; learnIds?: number[]; contactIds?: number[]; hustleIds?: number[] } | null;
};

const LANE_LABEL: Record<string, string> = {
  market_map: "Market map",
  role_map: "Role map",
  fit_map: "Fit map",
  capability_build: "Capability build",
  proof_build: "Proof build",
  network_map: "Network map",
  experiments: "Experiments",
  positioning: "Positioning",
};

const DIMENSION_LABEL: Record<string, string> = {
  technicalOrDomainKnowledge: "Domain knowledge",
  roleSpecificSkills: "Role skills",
  sectorCredibility: "Sector credibility",
  networkAccess: "Network access",
  narrativeFit: "Narrative fit",
};

const STATUS_LABEL: Record<string, string> = {
  stored_now: "Saved now",
  created_on_activation: "Created on activation",
  derived_view: "Derived view",
};

function list(items?: string[]) {
  return (items || []).map((item) => String(item || "").trim()).filter(Boolean);
}

function chipTone(value?: string) {
  if (value === "high" || value === "strong") return "bg-emerald-50 text-emerald-700";
  if (value === "low" || value === "weak") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function scoreTone(value?: number) {
  if (typeof value !== "number") return "text-muted-foreground";
  if (value >= 70) return "text-emerald-700";
  if (value <= 40) return "text-amber-700";
  return "text-primary";
}

function CountChip({ label, count }: { label: string; count: number }) {
  return <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{count} {label}</span>;
}

function ScoreChip({ label, value }: { label: string; value?: number }) {
  if (typeof value !== "number") return null;
  return <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{label} {value}</span>;
}

function PriorityCard({ label, title, detail, meta }: { label: string; title?: string; detail?: string; meta?: string }) {
  if (!title && !detail) return null;
  return (
    <div className="rounded-lg border border-card-border bg-card p-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {title && <p className="mt-1 text-xs font-semibold leading-snug text-foreground">{title}</p>}
      {detail && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{detail}</p>}
      {meta && <p className="mt-1 text-[11px] leading-snug text-primary">{meta}</p>}
    </div>
  );
}

export function TrackResearchReview({ trackId }: { trackId?: number }) {
  const [activating, setActivating] = useState(false);
  const [activationSummary, setActivationSummary] = useState<string>("");
  const { data, isLoading } = useQuery<ResearchPlanResponse>({
    queryKey: [`/api/career-tracks/${trackId}/research-plan`],
    enabled: !!trackId,
    staleTime: 0,
  });

  if (!trackId) return null;
  if (isLoading) {
    return <div className="mt-3 rounded-lg border border-card-border bg-muted/25 p-3 text-xs text-muted-foreground">Loading the research review...</div>;
  }
  if (!data) return null;

  const searchPlan = data.searchPlan || {};
  const evidence = data.evidencePack || [];
  const hypotheses = data.trackHypotheses || [];
  const paths = data.pathHypotheses || [];
  const requirements = data.requirementGraph || [];
  const capital = data.careerCapitalPortfolio || [];
  const gaps = data.gapPortfolio || [];
  const interventions = data.interventionRecommendations || [];
  const developmentPlans = data.developmentPlans || [];
  const evidenceLoops = data.evidenceLoops || [];
  const sectors = data.sectorMap || [];
  const roles = data.roleShapes || [];
  const lanes = data.plan?.lanes || [];
  const fitGap = data.fitGapMatrix || {};
  const workspace = data.organizedWorkspace || null;
  const assessmentQueue = workspace?.assessmentQueue || workspace?.priorityQueue || [];
  const topPath = [...paths].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
  const highestGap = [...gaps].sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 } as Record<string, number>;
    return (rank[b.severity || "medium"] || 2) - (rank[a.severity || "medium"] || 2);
  })[0];
  const topIntervention = [...interventions].sort((a, b) => (a.priority || 99) - (b.priority || 99))[0];
  const reviewChecks = [
    ...list(data.careerHypothesis?.coreUncertainties).map((item) => ({ title: item, detail: "Anchor cannot infer this confidently yet." })),
    ...paths.filter((path) => (path.preferenceFit || 0) <= 50 || (path.lifestyleFit || 0) <= 50).map((path) => ({ title: path.title, detail: "Preference or lifestyle fit is uncertain, so treat this as a hypothesis rather than a decision." })),
    ...evidenceLoops.map((loop) => ({ title: loop.evidenceToCollect, detail: "This is evidence Anchor should collect before confidence changes." })),
  ].slice(0, 3);

  async function activatePlan() {
    if (!trackId || activating) return;
    setActivating(true);
    setActivationSummary("");
    try {
      const result = await mutateAndInvalidate("POST", `/api/career-tracks/${trackId}/research-plan/materialize`, {}, [
        "/api/jobs",
        "/api/learn",
        "/api/contacts",
        "/api/hustles",
        "/api/strategy/front-door",
        ...GOAL_SPINE_QUERY_KEYS,
      ]);
      const m = result?.materialized || {};
      setActivationSummary(`Drafted ${m.jobIds?.length || 0} role examples, ${m.learnIds?.length || 0} knowledge resources, ${m.contactIds?.length || 0} network targets, and ${m.hustleIds?.length || 0} proof assets. Selection comes next, so these are not today's tasks.`);
    } catch (e: any) {
      setActivationSummary(e?.message || "Could not draft objects yet.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-card-border bg-background/60 p-3" data-testid="track-research-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Review Anchor's inferred career model</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">Anchor has done the first pass. Only check the few assumptions that would materially change the direction.</p>
        </div>
        <Button size="sm" variant="outline" onClick={activatePlan} disabled={activating} data-testid="button-activate-track-plan">
          {activating ? <Sparkles className="mr-1 h-4 w-4 animate-pulse" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
          {activating ? "Drafting" : "Draft for selection"}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <PriorityCard
          label="Anchor's best current path"
          title={topPath?.title || data.careerHypothesis?.normalizedTitle || data.track.name}
          detail={topPath?.whyPromising || data.careerHypothesis?.whyAttractive}
          meta={typeof topPath?.confidence === "number" ? `Confidence ${topPath.confidence}` : undefined}
        />
        <PriorityCard
          label="Highest leverage gap"
          title={highestGap?.gap || data.gapAnalysis?.biggestGap}
          detail={highestGap?.whyItMatters}
          meta={highestGap?.capitalType ? `${highestGap.capitalType} gap` : undefined}
        />
        <PriorityCard
          label="Likely best intervention"
          title={topIntervention?.recommendation}
          detail={topIntervention?.whyThis}
          meta={topIntervention?.interventionType}
        />
      </div>

      <div className="mt-3 rounded-lg border border-primary/15 bg-primary/5 p-2">
        <p className="text-xs font-medium text-primary">Minimal review needed</p>
        {reviewChecks.length > 0 ? (
          <div className="mt-1.5 space-y-1.5">
            {reviewChecks.map((check, index) => (
              <div key={`${check.title}-${index}`} className="rounded-md bg-background/70 px-2 py-1.5">
                <p className="text-[11px] font-medium leading-snug text-foreground">{check.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{check.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">No user input is needed right now unless something looks obviously wrong.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <CountChip label="sources" count={evidence.length} />
        <CountChip label="paths" count={paths.length} />
        <CountChip label="requirements" count={requirements.length} />
        <CountChip label="capital items" count={capital.length} />
        <CountChip label="gaps" count={gaps.length} />
        <CountChip label="interventions" count={interventions.length} />
        <CountChip label="development plans" count={developmentPlans.length} />
      </div>

      {activationSummary && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary" data-testid="track-plan-activation-summary">
          {activationSummary}
        </div>
      )}

      <Accordion type="multiple" className="mt-3 space-y-2">
        {workspace && (
          <AccordionItem value="organized" className="rounded-lg border border-card-border bg-card px-3">
            <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
              <span className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /> Where this is saved and assessed</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(workspace.savedTo || []).map((bucket) => (
                    <div key={`${bucket.label}-${bucket.storage}`} className="rounded-lg border border-card-border bg-muted/25 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-xs font-medium">{bucket.label}</p>
                        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{STATUS_LABEL[bucket.status] || bucket.status}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-primary">{bucket.storage}</p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{list(bucket.contains).join(", ")}</p>
                    </div>
                  ))}
                </div>

                {assessmentQueue.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"><ListOrdered className="h-4 w-4 text-primary" /> Assessment queue</p>
                    <div className="space-y-1.5">
                      {assessmentQueue.slice(0, 6).map((item, index) => (
                        <div key={item.id || `${item.title}-${index}`} className="rounded-lg bg-muted/25 p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">#{item.rank || index + 1}</span>
                            <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.lane}</span>
                            <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.activationTarget}</span>
                          </div>
                          <p className="mt-1 text-xs font-medium">{item.title}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.action}</p>
                          <p className="mt-0.5 text-[11px] text-primary">Saved in: {item.savedIn}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(workspace.sortingLogic || []).length > 0 && (
                  <div className="space-y-1.5">
                    {(workspace.sortingLogic || []).map((rule) => (
                      <div key={rule.rule} className="rounded-lg bg-background/70 px-2 py-1.5">
                        <p className="text-[11px] font-medium">{rule.rule}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{rule.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        <AccordionItem value="capital-model" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Career capital model</span>
          </AccordionTrigger>
          <AccordionContent>
            {data.careerHypothesis && (
              <div className="mb-2 rounded-lg border border-card-border bg-muted/25 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs font-medium">{data.careerHypothesis.normalizedTitle || data.track.name}</p>
                  <ScoreChip label="confidence" value={data.careerHypothesis.confidence} />
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{data.careerHypothesis.whyAttractive}</p>
                {list(data.careerHypothesis.coreUncertainties).length > 0 && <p className="mt-1 text-[11px] text-amber-700">Unknowns: {list(data.careerHypothesis.coreUncertainties).join("; ")}</p>}
              </div>
            )}

            <div className="space-y-2">
              {paths.slice(0, 5).map((path) => (
                <div key={path.title} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-medium">{path.title}</p>
                    <span className={`rounded-full bg-background px-1.5 py-0.5 text-[10px] ${scoreTone(path.confidence)}`}>confidence {path.confidence ?? "unknown"}</span>
                    <ScoreChip label="capability" value={path.capabilityFit} />
                    <ScoreChip label="access" value={path.accessFit} />
                    <ScoreChip label="preference" value={path.preferenceFit} />
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{path.whyPromising || path.description}</p>
                  {list(path.testSignals).length > 0 && <p className="mt-1 text-[11px] text-primary">Test: {list(path.testSignals).join("; ")}</p>}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="gaps" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" /> Gaps and interventions</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              {gaps.slice(0, 6).map((gap) => (
                <div key={gap.gap} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-medium">{gap.gap}</p>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${chipTone(gap.severity)}`}>{gap.severity || "medium"}</span>
                    <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{gap.capitalType}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{gap.whyItMatters}</p>
                  {gap.evidence && <p className="mt-1 text-[11px] text-muted-foreground">Evidence: {gap.evidence}</p>}
                </div>
              ))}

              {interventions.slice(0, 6).map((item) => (
                <div key={`${item.recommendation}-${item.gap}`} className="rounded-lg border border-primary/15 bg-primary/5 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-medium">{item.recommendation}</p>
                    <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-primary">{item.interventionType}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{item.whyThis}</p>
                  {item.output && <p className="mt-1 text-[11px] text-primary">Output: {item.output}</p>}
                  {item.assessmentCriteria && <p className="mt-1 text-[11px] text-muted-foreground">Assess by: {item.assessmentCriteria}</p>}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="development" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" /> Living development plans</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              {developmentPlans.slice(0, 5).map((plan) => (
                <div key={plan.title} className="rounded-lg bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-medium">{plan.title}</p>
                    <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{plan.capitalType}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{plan.objective}</p>
                  {list(plan.supportsPaths).length > 0 && <p className="mt-1 text-[11px] text-primary">Supports: {list(plan.supportsPaths).join(", ")}</p>}
                  {list(plan.proofOutputs).length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Proof: {list(plan.proofOutputs).join("; ")}</p>}
                  {(plan.resources || []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {(plan.resources || []).slice(0, 3).map((resource) => (
                        <div key={resource.title} className="rounded-md bg-background/70 px-2 py-1.5">
                          <p className="text-[11px] font-medium">{resource.title}</p>
                          {resource.why && <p className="mt-0.5 text-[11px] text-muted-foreground">{resource.why}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {evidenceLoops.length > 0 && (
                <div className="rounded-lg border border-card-border bg-background/70 p-2">
                  <p className="text-xs font-medium">Evidence loops</p>
                  <div className="mt-1 space-y-1">
                    {evidenceLoops.slice(0, 4).map((loop) => (
                      <p key={loop.evidenceToCollect} className="text-[11px] leading-snug text-muted-foreground">{loop.evidenceToCollect}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="search" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><Search className="h-4 w-4 text-primary" /> What Anchor searched</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              {Object.entries(searchPlan).map(([bucket, queries]) => {
                const values = list(queries as string[]);
                if (!values.length) return null;
                return (
                  <div key={bucket}>
                    <p className="text-[11px] font-medium text-foreground">{bucket.replace(/([A-Z])/g, " $1")}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {values.map((query) => <span key={query} className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{query}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="evidence" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" /> Evidence used</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              {evidence.slice(0, 8).map((item, index) => (
                <div key={`${item.sourceTitle}-${index}`} className="rounded-lg border border-card-border bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${chipTone(item.confidence)}`}>{item.confidence || "medium"}</span>
                    {item.sourceType && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.sourceType}</span>}
                    {item.usedFor && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{item.usedFor}</span>}
                  </div>
                  <p className="mt-1 text-xs font-medium leading-snug">{item.sourceTitle}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{item.claimSupported}</p>
                  {item.sourceUrl && (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary">
                      Open source <ArrowUpRight className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
              {evidence.length === 0 && <p className="text-xs text-muted-foreground">No evidence pack was stored for this track.</p>}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="map" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-primary" /> Sectors and role shapes</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {sectors.map((sector) => (
                <div key={sector.sector} className="rounded-lg bg-muted/25 p-2">
                  <p className="text-xs font-medium">{sector.sector}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sector.description}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{list(sector.exampleOrgs).join(", ")}</p>
                </div>
              ))}
              {roles.map((role) => (
                <div key={role.title} className="rounded-lg bg-muted/25 p-2">
                  <p className="text-xs font-medium">{role.title}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{role.what}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{list(role.typicalOrgs).join(", ")}</p>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="fit" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Fit and gaps</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              {Object.entries(fitGap).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-muted/25 p-2">
                  <p className="text-xs font-medium">{DIMENSION_LABEL[key] || key}</p>
                  <p className="mt-1 text-[11px] text-emerald-700">Strengths: {list(value.strengths).join("; ") || "None identified"}</p>
                  <p className="mt-1 text-[11px] text-amber-700">Gaps: {list(value.gaps).join("; ") || "None identified"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Evidence needed: {list(value.evidenceNeeded).join("; ") || "Not specified"}</p>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="hypotheses" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" /> Hypotheses to test</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              {hypotheses.map((h, index) => (
                <div key={`${h.hypothesis}-${index}`} className="rounded-lg bg-muted/25 p-2">
                  <p className="text-xs font-medium">{h.hypothesis}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Why: {h.whyItMightBeTrue}</p>
                  <p className="mt-1 text-[11px] leading-snug text-primary">Test: {h.howToTest}</p>
                  <p className="mt-1 text-[11px] leading-snug text-amber-700">Deprioritize if: {h.disconfirmingSignal}</p>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="plan" className="rounded-lg border border-card-border bg-card px-3">
          <AccordionTrigger className="py-2 text-left text-xs hover:no-underline">
            <span className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" /> Multi-lane assessment plan</span>
          </AccordionTrigger>
          <AccordionContent>
            {data.plan?.logic && <p className="mb-2 text-xs leading-snug text-muted-foreground">{data.plan.logic}</p>}
            <div className="space-y-2">
              {lanes.map((lane) => (
                <div key={lane.lane} className="rounded-lg bg-muted/25 p-2">
                  <p className="text-xs font-medium">{LANE_LABEL[lane.lane] || lane.lane}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{lane.objective}</p>
                  <div className="mt-2 space-y-1.5">
                    {(lane.workstreams || []).map((w) => (
                      <div key={w.title} className="rounded-md bg-background/70 px-2 py-1.5">
                        <p className="text-[11px] font-medium">{w.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{w.action}</p>
                        {w.doneWhen && <p className="mt-0.5 text-[11px] text-primary">Done when: {w.doneWhen}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
