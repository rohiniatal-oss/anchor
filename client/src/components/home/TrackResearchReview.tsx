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
  priorityQueue?: WorkspaceItem[];
};

type ResearchPlanResponse = {
  track: { id: number; name: string; description?: string; whyItFits?: string };
  plan?: { horizon?: string; logic?: string; lanes?: TrackPlanLane[] } | null;
  searchPlan?: Record<string, string[]> | null;
  evidencePack?: EvidenceItem[];
  trackHypotheses?: Hypothesis[];
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
  if (value === "high") return "bg-emerald-50 text-emerald-700";
  if (value === "low") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function CountChip({ label, count }: { label: string; count: number }) {
  return <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{count} {label}</span>;
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
  const sectors = data.sectorMap || [];
  const roles = data.roleShapes || [];
  const lanes = data.plan?.lanes || [];
  const fitGap = data.fitGapMatrix || {};
  const workspace = data.organizedWorkspace || null;
  const workspaceItems = workspace?.priorityQueue || [];

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
      setActivationSummary(`Created ${m.jobIds?.length || 0} roles, ${m.learnIds?.length || 0} learning items, ${m.contactIds?.length || 0} contact targets, and ${m.hustleIds?.length || 0} proof assets. Anchor saved the activation inventory back to this track.`);
    } catch (e: any) {
      setActivationSummary(e?.message || "Could not activate the plan yet.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-card-border bg-background/60 p-3" data-testid="track-research-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Review the research before activating it</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">Anchor has built the dossier, organized it by lane, and kept execution objects opt-in.</p>
        </div>
        <Button size="sm" onClick={activatePlan} disabled={activating} data-testid="button-activate-track-plan">
          {activating ? <Sparkles className="mr-1 h-4 w-4 animate-pulse" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
          {activating ? "Activating" : "Activate plan"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <CountChip label="sources" count={evidence.length} />
        <CountChip label="hypotheses" count={hypotheses.length} />
        <CountChip label="sectors" count={sectors.length} />
        <CountChip label="role shapes" count={roles.length} />
        <CountChip label="plan lanes" count={lanes.length} />
        <CountChip label="organized moves" count={workspaceItems.length} />
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
              <span className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /> Where this is saved and sorted</span>
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

                {(workspace.priorityQueue || []).length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"><ListOrdered className="h-4 w-4 text-primary" /> Priority queue</p>
                    <div className="space-y-1.5">
                      {(workspace.priorityQueue || []).slice(0, 6).map((item, index) => (
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
            <span className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" /> Multi-lane plan</span>
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
