import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Briefcase, CheckCircle2, CircleAlert, CircleDashed, CircleHelp, Search, ShieldCheck, Sparkles, Target, Users } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type RequirementGroupId = "perform_work" | "demonstrate_credibility" | "access_opportunity";
type RequirementImportance = "essential" | "important" | "differentiator" | "contextual";
type RequirementConfidence = "high" | "medium" | "low";
type CoverageStatus = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";
type CoverageConfidence = "high" | "medium" | "low";

type EvidenceClaim = {
  id: string;
  claim: string;
  sourceTitle: string;
  sourceUrl?: string;
  confidence: RequirementConfidence;
  directness: "direct" | "supporting" | "inferred";
};

type UserEvidenceItem = {
  id: string;
  sourceType: string;
  title: string;
  detail: string;
  url?: string;
  evidenceType: string;
  directness: "direct" | "supporting" | "self_reported";
};

type RequirementCoverage = {
  requirementId: string;
  status: CoverageStatus;
  confidence: CoverageConfidence;
  evidenceItemIds?: string[];
  summary: string;
  rationale?: string;
  missingEvidence?: string;
};

type RequirementCoverageModel = {
  mode: "requirement_coverage_model";
  version: number;
  targetLabel: string;
  evidenceItems: UserEvidenceItem[];
  coverage: RequirementCoverage[];
  summary: {
    proven: number;
    partiallyProven: number;
    unproven: number;
    unknown: number;
    belowBar: number;
    materialRequirementIdsNeedingCoverage?: string[];
  };
  evidenceQuality: {
    status: "strong" | "usable" | "sparse";
    evidenceItemCount: number;
    directEvidenceCount: number;
    sourceTypeCount: number;
    coveredRequirementCount: number;
    caveats?: string[];
  };
};

type RoleFamily = {
  id: string;
  title: string;
  description?: string;
  typicalOrganizations?: string[];
  seniority?: string;
};

type MarketSegment = {
  id: string;
  title: string;
  description?: string;
  exampleOrganizations?: string[];
};

type TargetRequirement = {
  id: string;
  label: string;
  definition?: string;
  group: RequirementGroupId;
  category: string;
  importance: RequirementImportance;
  importanceReason?: string;
  scope: "shared" | "role_specific";
  roleFamilyIds?: string[];
  successBar: string;
  evidenceClaimIds?: string[];
  confidence: RequirementConfidence;
  context?: {
    seniority?: string[];
    geographies?: string[];
    employerTypes?: string[];
    notes?: string[];
  };
};

type RequirementModel = {
  mode: "requirement_model";
  version: number;
  target: {
    label: string;
    definition: string;
    assumption: string;
  };
  marketSegments: MarketSegment[];
  roleFamilies: RoleFamily[];
  groups: Array<{
    id: RequirementGroupId;
    label: string;
    description: string;
    requirementIds: string[];
  }>;
  requirements: TargetRequirement[];
  evidenceClaims: EvidenceClaim[];
  researchQuality: {
    status: "strong" | "usable" | "provisional";
    sourceCount: number;
    directSourceCount: number;
    sourceTypeCount: number;
    requirementEvidenceCoverage: number;
    directRequirementCoverage: number;
    caveats?: string[];
  };
  boundaries?: {
    includes?: string[];
    excludes?: string[];
    openQuestions?: string[];
  };
};

type ResearchPlanResponse = {
  track: { id: number; name: string; description?: string };
  requirementModel?: RequirementModel | null;
  requirementCoverageModel?: RequirementCoverageModel | null;
  coverageNeedsRefresh?: boolean;
};

const GROUP_ICON: Record<RequirementGroupId, typeof Briefcase> = {
  perform_work: Briefcase,
  demonstrate_credibility: ShieldCheck,
  access_opportunity: Users,
};

const CATEGORY_LABEL: Record<string, string> = {
  knowledge: "Knowledge",
  skill: "Skill and judgement",
  experience: "Relevant experience",
  evidence: "Proof and outputs",
  credential: "Credential",
  narrative: "Narrative",
  network: "Relationships",
  access: "Hiring access",
  eligibility: "Eligibility",
};

const IMPORTANCE_LABEL: Record<RequirementImportance, string> = {
  essential: "Essential",
  important: "Important",
  differentiator: "Differentiator",
  contextual: "Context-specific",
};

const IMPORTANCE_RANK: Record<RequirementImportance, number> = {
  essential: 0,
  important: 1,
  differentiator: 2,
  contextual: 3,
};

const QUALITY_META = {
  strong: {
    label: "Strong evidence base",
    detail: "Multiple direct and supporting sources underpin most requirements.",
    tone: "bg-emerald-50 text-emerald-700",
  },
  usable: {
    label: "Useful first pass",
    detail: "The model is credible enough to assess, with some requirements still needing stronger provenance.",
    tone: "bg-sky-50 text-sky-700",
  },
  provisional: {
    label: "Provisional model",
    detail: "Anchor found a plausible structure, but the evidence base is not yet strong enough for expensive decisions.",
    tone: "bg-amber-50 text-amber-700",
  },
} as const;

const COVERAGE_META: Record<CoverageStatus, { label: string; detail: string; tone: string; icon: typeof CheckCircle2 }> = {
  proven: {
    label: "Evidenced",
    detail: "Anchor found direct evidence that appears to meet the current bar.",
    tone: "bg-emerald-50 text-emerald-700",
    icon: CheckCircle2,
  },
  partially_proven: {
    label: "Partly evidenced",
    detail: "Relevant evidence exists, but it does not fully demonstrate the target bar yet.",
    tone: "bg-sky-50 text-sky-700",
    icon: CircleDashed,
  },
  unproven: {
    label: "Not evidenced in Anchor",
    detail: "Anchor could not substantiate this from the current record. This does not mean you lack it.",
    tone: "bg-amber-50 text-amber-800",
    icon: CircleAlert,
  },
  unknown: {
    label: "Not enough information",
    detail: "The available record is too sparse or ambiguous to assess reliably.",
    tone: "bg-muted text-muted-foreground",
    icon: CircleHelp,
  },
  below_bar: {
    label: "Needs strengthening",
    detail: "Explicit feedback suggests the current evidence is below the target bar.",
    tone: "bg-rose-50 text-rose-700",
    icon: CircleAlert,
  },
};

function list(values?: string[]) {
  return (values || []).map((value) => String(value || "").trim()).filter(Boolean);
}

function importanceTone(importance: RequirementImportance) {
  if (importance === "essential") return "bg-rose-50 text-rose-700";
  if (importance === "important") return "bg-primary/10 text-primary";
  if (importance === "differentiator") return "bg-violet-50 text-violet-700";
  return "bg-muted text-muted-foreground";
}

function confidenceLabel(confidence: RequirementConfidence | CoverageConfidence) {
  if (confidence === "high") return "High confidence";
  if (confidence === "low") return "Low confidence";
  return "Medium confidence";
}

function CoverageBadge({ coverage }: { coverage?: RequirementCoverage }) {
  if (!coverage) return null;
  const meta = COVERAGE_META[coverage.status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}

function RequirementCard({
  requirement,
  coverage,
  roleFamilies,
  evidenceClaims,
  userEvidence,
}: {
  requirement: TargetRequirement;
  coverage?: RequirementCoverage;
  roleFamilies: Map<string, RoleFamily>;
  evidenceClaims: Map<string, EvidenceClaim>;
  userEvidence: Map<string, UserEvidenceItem>;
}) {
  const roles = list(requirement.roleFamilyIds).map((id) => roleFamilies.get(id)?.title).filter(Boolean) as string[];
  const claims = list(requirement.evidenceClaimIds).map((id) => evidenceClaims.get(id)).filter(Boolean) as EvidenceClaim[];
  const evidence = list(coverage?.evidenceItemIds).map((id) => userEvidence.get(id)).filter(Boolean) as UserEvidenceItem[];
  const context = [
    ...list(requirement.context?.seniority),
    ...list(requirement.context?.geographies),
    ...list(requirement.context?.employerTypes),
    ...list(requirement.context?.notes),
  ];

  return (
    <details className="rounded-xl border border-card-border bg-card p-3" data-testid={`requirement-${requirement.id}`}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${importanceTone(requirement.importance)}`}>
                {IMPORTANCE_LABEL[requirement.importance]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {CATEGORY_LABEL[requirement.category] || requirement.category}
              </span>
              <CoverageBadge coverage={coverage} />
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug text-foreground">{requirement.label}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Sufficient when {requirement.successBar}</p>
            {coverage?.summary && <p className="mt-1 text-[11px] leading-snug text-primary">{coverage.summary}</p>}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{confidenceLabel(coverage?.confidence || requirement.confidence)}</span>
        </div>
      </summary>

      <div className="mt-3 space-y-3 border-t border-card-border pt-3">
        {requirement.definition && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">What this means</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground">{requirement.definition}</p>
          </div>
        )}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Why the market requires it</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{requirement.importanceReason}</p>
        </div>

        {coverage && (
          <div className="rounded-lg border border-card-border bg-background/70 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">What Anchor can evidence today</p>
              <CoverageBadge coverage={coverage} />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-foreground">{coverage.rationale || coverage.summary}</p>
            {evidence.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {evidence.slice(0, 4).map((item) => (
                  <div key={item.id} className="rounded-lg bg-muted/30 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-medium text-primary">{item.title}</span>
                      <span className="text-[10px] text-muted-foreground">{item.directness === "direct" ? "Direct evidence" : item.directness === "supporting" ? "Supporting evidence" : "Self-reported evidence"}</span>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                          Open <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">No sufficiently relevant evidence item is stored in Anchor yet.</p>
            )}
            {coverage.status !== "proven" && coverage.missingEvidence && (
              <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5">
                <p className="text-[10px] font-medium text-amber-800">What would establish stronger coverage</p>
                <p className="mt-0.5 text-[11px] leading-snug text-amber-800">{coverage.missingEvidence}</p>
              </div>
            )}
          </div>
        )}

        {roles.length > 0 && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Applies to</p>
            <p className="mt-1 text-xs text-foreground">{roles.join(", ")}</p>
          </div>
        )}

        {context.length > 0 && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Context</p>
            <p className="mt-1 text-xs text-foreground">{context.join(" · ")}</p>
          </div>
        )}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Market evidence underneath</p>
          {claims.length > 0 ? (
            <div className="mt-1.5 space-y-1.5">
              {claims.slice(0, 4).map((claim) => (
                <div key={claim.id} className="rounded-lg bg-muted/35 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-medium text-primary">
                      {claim.directness === "direct" ? "Direct market evidence" : claim.directness === "supporting" ? "Supporting evidence" : "Inferred evidence"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{claim.sourceTitle}</span>
                    {claim.sourceUrl && (
                      <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                        Source <ArrowUpRight className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{claim.claim}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-amber-700">No specific source claim is linked yet. Treat this requirement as provisional.</p>
          )}
        </div>
      </div>
    </details>
  );
}

export function TrackResearchReview({ trackId }: { trackId?: number }) {
  const queryClient = useQueryClient();
  const refreshAttempted = useRef<number | null>(null);
  const [isRefreshingCoverage, setIsRefreshingCoverage] = useState(false);
  const [coverageRefreshError, setCoverageRefreshError] = useState("");
  const queryKey = [`/api/career-tracks/${trackId}/research-plan`];
  const { data, isLoading } = useQuery<ResearchPlanResponse>({
    queryKey,
    enabled: !!trackId,
    staleTime: 0,
  });

  useEffect(() => {
    if (!trackId || !data?.requirementModel || data.requirementCoverageModel || !data.coverageNeedsRefresh) return;
    if (refreshAttempted.current === trackId) return;
    refreshAttempted.current = trackId;
    setIsRefreshingCoverage(true);
    setCoverageRefreshError("");
    fetch(`/api/career-tracks/${trackId}/requirement-coverage/refresh`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Could not assess coverage");
        await queryClient.invalidateQueries({ queryKey });
      })
      .catch((error: any) => setCoverageRefreshError(error?.message || "Could not assess coverage"))
      .finally(() => setIsRefreshingCoverage(false));
  }, [trackId, data?.requirementModel, data?.requirementCoverageModel, data?.coverageNeedsRefresh, queryClient]);

  if (!trackId) return null;
  if (isLoading) {
    return <div className="mt-3 rounded-xl border border-card-border bg-muted/25 p-3 text-xs text-muted-foreground">Building the requirement model...</div>;
  }
  if (!data) return null;

  const model = data.requirementModel;
  if (!model || model.mode !== "requirement_model") {
    return (
      <div className="mt-3 rounded-xl border border-card-border bg-background/60 p-3">
        <p className="text-xs font-semibold text-foreground">Requirement model not available yet</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Run target research again so Anchor can convert the market evidence into a structured set of requirements.</p>
      </div>
    );
  }

  const coverageModel = data.requirementCoverageModel;
  const roleFamilies = new Map(model.roleFamilies.map((role) => [role.id, role]));
  const evidenceClaims = new Map(model.evidenceClaims.map((claim) => [claim.id, claim]));
  const coverageByRequirement = new Map((coverageModel?.coverage || []).map((coverage) => [coverage.requirementId, coverage]));
  const userEvidence = new Map((coverageModel?.evidenceItems || []).map((item) => [item.id, item]));
  const quality = QUALITY_META[model.researchQuality.status];
  const featuredRequirements = [...model.requirements]
    .sort((left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance])
    .slice(0, 3);
  const notYetEvidenced = coverageModel
    ? coverageModel.summary.unproven + coverageModel.summary.unknown + coverageModel.summary.belowBar
    : 0;

  return (
    <div className="mt-3 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-research-review">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary"><Target className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {coverageModel ? `What you need and what Anchor can already evidence` : `What you need for ${model.target.label}`}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.target.definition}</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {coverageModel
              ? "Anchor compared the target requirements with your CV, recorded outcomes, completed learning outputs, proof assets and relationship signals. It has not built a development plan yet."
              : "Anchor researched the market and role families to determine the requirements. Coverage assessment follows automatically."}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${quality.tone}`}>{quality.label}</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.requirements.length} requirements</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.roleFamilies.length} role families</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.researchQuality.sourceCount} market sources</span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{quality.detail}</p>

      {isRefreshingCoverage && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-[11px] text-primary">
          <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Assessing what Anchor can already substantiate from your existing record...
        </div>
      )}
      {coverageRefreshError && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">Coverage assessment could not refresh automatically. The requirement model remains available.</p>
      )}

      {coverageModel && (
        <div className="mt-4 rounded-xl border border-card-border bg-card p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Where you stand from the evidence Anchor has</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-emerald-50 p-2">
              <p className="text-[10px] text-emerald-700">Evidenced</p>
              <p className="mt-1 text-lg font-semibold text-emerald-800">{coverageModel.summary.proven}</p>
            </div>
            <div className="rounded-lg bg-sky-50 p-2">
              <p className="text-[10px] text-sky-700">Partly evidenced</p>
              <p className="mt-1 text-lg font-semibold text-sky-800">{coverageModel.summary.partiallyProven}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2">
              <p className="text-[10px] text-amber-800">Not yet substantiated</p>
              <p className="mt-1 text-lg font-semibold text-amber-900">{notYetEvidenced}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">Not substantiated means Anchor cannot verify it from the current record. It is not a judgement that you lack the capability.</p>
        </div>
      )}

      {featuredRequirements.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">The clearest requirements so far</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {featuredRequirements.map((requirement) => {
              const coverage = coverageByRequirement.get(requirement.id);
              return (
                <div key={requirement.id} className="rounded-xl border border-card-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${importanceTone(requirement.importance)}`}>{IMPORTANCE_LABEL[requirement.importance]}</span>
                    <CoverageBadge coverage={coverage} />
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-snug text-foreground">{requirement.label}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{coverage?.summary || requirement.successBar}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Accordion type="multiple" defaultValue={["perform_work"]} className="mt-4 space-y-2">
        {model.groups.map((group) => {
          const Icon = GROUP_ICON[group.id];
          const requirements = group.requirementIds.map((id) => model.requirements.find((requirement) => requirement.id === id)).filter(Boolean) as TargetRequirement[];
          const essentialCount = requirements.filter((requirement) => requirement.importance === "essential").length;
          const evidencedCount = requirements.filter((requirement) => coverageByRequirement.get(requirement.id)?.status === "proven").length;
          return (
            <AccordionItem key={group.id} value={group.id} className="rounded-xl border border-card-border bg-card px-3">
              <AccordionTrigger className="py-3 text-left hover:no-underline">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{group.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{group.description}</p>
                  </div>
                  <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{requirements.length}</span>
                  {coverageModel && evidencedCount > 0 && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{evidencedCount} evidenced</span>}
                  {essentialCount > 0 && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">{essentialCount} essential</span>}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pb-1">
                  {requirements.length > 0 ? requirements.map((requirement) => (
                    <RequirementCard
                      key={requirement.id}
                      requirement={requirement}
                      coverage={coverageByRequirement.get(requirement.id)}
                      roleFamilies={roleFamilies}
                      evidenceClaims={evidenceClaims}
                      userEvidence={userEvidence}
                    />
                  )) : (
                    <p className="rounded-lg bg-muted/25 p-2 text-[11px] text-muted-foreground">No requirements were identified in this group.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}

        <AccordionItem value="market-research" className="rounded-xl border border-card-border bg-card px-3">
          <AccordionTrigger className="py-3 text-left hover:no-underline">
            <span className="flex items-center gap-2 text-xs font-semibold"><Search className="h-4 w-4 text-primary" /> Research underneath</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pb-1">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium"><Briefcase className="h-3.5 w-3.5 text-primary" /> Role families researched</p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {model.roleFamilies.map((role) => (
                    <div key={role.id} className="rounded-lg bg-muted/25 p-2">
                      <p className="text-xs font-medium text-foreground">{role.title}</p>
                      {role.description && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{role.description}</p>}
                      {list(role.typicalOrganizations).length > 0 && <p className="mt-1 text-[11px] text-primary">Examples: {list(role.typicalOrganizations).slice(0, 4).join(", ")}</p>}
                    </div>
                  ))}
                </div>
              </div>

              {model.marketSegments.length > 0 && (
                <div>
                  <p className="text-xs font-medium">Market segments used</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {model.marketSegments.map((segment) => <span key={segment.id} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{segment.title}</span>)}
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="research-quality" className="rounded-xl border border-card-border bg-card px-3">
          <AccordionTrigger className="py-3 text-left hover:no-underline">
            <span className="flex items-center gap-2 text-xs font-semibold"><CircleHelp className="h-4 w-4 text-primary" /> Evidence quality and open questions</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pb-1">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Requirement evidence coverage</p><p className="mt-1 text-sm font-semibold">{model.researchQuality.requirementEvidenceCoverage}%</p></div>
                <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Direct requirement coverage</p><p className="mt-1 text-sm font-semibold">{model.researchQuality.directRequirementCoverage}%</p></div>
                <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Direct market sources</p><p className="mt-1 text-sm font-semibold">{model.researchQuality.directSourceCount}</p></div>
              </div>

              {coverageModel && (
                <div className="rounded-lg border border-card-border bg-background/70 p-2.5">
                  <p className="text-xs font-medium">User evidence quality</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor used {coverageModel.evidenceQuality.evidenceItemCount} evidence items across {coverageModel.evidenceQuality.sourceTypeCount} source types, including {coverageModel.evidenceQuality.directEvidenceCount} direct items.</p>
                  {list(coverageModel.evidenceQuality.caveats).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {list(coverageModel.evidenceQuality.caveats).map((caveat) => <p key={caveat} className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">{caveat}</p>)}
                    </div>
                  )}
                </div>
              )}

              {list(model.researchQuality.caveats).length > 0 && (
                <div>
                  <p className="text-xs font-medium">Market-research caveats</p>
                  <div className="mt-1.5 space-y-1">
                    {list(model.researchQuality.caveats).map((caveat) => <p key={caveat} className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">{caveat}</p>)}
                  </div>
                </div>
              )}

              {list(model.boundaries?.openQuestions).length > 0 && (
                <div>
                  <p className="text-xs font-medium">Open market questions</p>
                  <div className="mt-1.5 space-y-1">
                    {list(model.boundaries?.openQuestions).slice(0, 6).map((question) => <p key={question} className="rounded-lg bg-muted/25 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">{question}</p>)}
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
