import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  FileQuestion,
  Search,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
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

type UserEvidenceItem = {
  id: string;
  sourceType: string;
  label: string;
  detail: string;
  sourceUrl?: string;
  strength: "verified" | "direct" | "supporting" | "declared" | "planned";
  state: string;
};

type RequirementCoverage = {
  requirementId: string;
  status: CoverageStatus;
  confidence: CoverageConfidence;
  evidenceItemIds: string[];
  reason: string;
  successBarAssessment: string;
  evidenceStillNeeded: string[];
  sourceBasis: "llm" | "deterministic";
};

type CoverageModel = {
  mode: "coverage_model";
  version: number;
  targetLabel: string;
  coverage: RequirementCoverage[];
  evidenceItems: UserEvidenceItem[];
  sourceInventory: Record<string, number>;
  quality: {
    status: "strong" | "usable" | "provisional";
    assessedRequirementCount: number;
    unknownRequirementCount: number;
    citedEvidenceCount: number;
    directEvidenceCount: number;
    assessmentCoverage: number;
    caveats?: string[];
  };
};

type ResearchPlanResponse = {
  track: { id: number; name: string; description?: string };
  requirementModel?: RequirementModel | null;
};

type CoverageResponse = {
  coverageModel?: CoverageModel | null;
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

const COVERAGE_RANK: Record<CoverageStatus, number> = {
  proven: 0,
  partially_proven: 1,
  below_bar: 2,
  unproven: 3,
  unknown: 4,
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

const COVERAGE_META: Record<CoverageStatus, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  proven: { label: "Proven", tone: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  partially_proven: { label: "Partly proven", tone: "bg-sky-50 text-sky-700", icon: CircleDashed },
  unproven: { label: "Not yet evidenced", tone: "bg-amber-50 text-amber-800", icon: FileQuestion },
  unknown: { label: "Not enough information", tone: "bg-muted text-muted-foreground", icon: CircleHelp },
  below_bar: { label: "Needs strengthening", tone: "bg-rose-50 text-rose-700", icon: CircleDashed },
};

const COVERAGE_QUALITY_META = {
  strong: { label: "Strong coverage read", tone: "bg-emerald-50 text-emerald-700" },
  usable: { label: "Useful coverage read", tone: "bg-sky-50 text-sky-700" },
  provisional: { label: "Limited coverage read", tone: "bg-amber-50 text-amber-800" },
} as const;

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
  roleFamilies,
  evidenceClaims,
  coverage,
  userEvidence,
}: {
  requirement: TargetRequirement;
  roleFamilies: Map<string, RoleFamily>;
  evidenceClaims: Map<string, EvidenceClaim>;
  coverage?: RequirementCoverage;
  userEvidence: Map<string, UserEvidenceItem>;
}) {
  const roles = list(requirement.roleFamilyIds).map((id) => roleFamilies.get(id)?.title).filter(Boolean) as string[];
  const claims = list(requirement.evidenceClaimIds).map((id) => evidenceClaims.get(id)).filter(Boolean) as EvidenceClaim[];
  const personalEvidence = list(coverage?.evidenceItemIds).map((id) => userEvidence.get(id)).filter(Boolean) as UserEvidenceItem[];
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
              <CoverageBadge coverage={coverage} />
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {CATEGORY_LABEL[requirement.category] || requirement.category}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {requirement.scope === "shared" ? "Shared across the target" : "Role-family specific"}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug text-foreground">{requirement.label}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Sufficient when {requirement.successBar}</p>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{confidenceLabel(requirement.confidence)}</span>
        </div>
      </summary>

      <div className="mt-3 space-y-3 border-t border-card-border pt-3">
        {coverage && (
          <div className="rounded-lg bg-primary/[0.04] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">What Anchor found in your background</p>
              <span className="text-[10px] text-muted-foreground">{confidenceLabel(coverage.confidence)}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-foreground">{coverage.reason}</p>
            {personalEvidence.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {personalEvidence.slice(0, 4).map((item) => (
                  <div key={item.id} className="rounded-lg border border-card-border bg-background/70 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-medium text-primary">{item.label}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{item.sourceType.replace(/_/g, " ")}</span>
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                          Evidence <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>
            )}
            {coverage.status !== "proven" && list(coverage.evidenceStillNeeded).length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] font-medium text-muted-foreground">Still needed to verify this</p>
                {list(coverage.evidenceStillNeeded).slice(0, 3).map((item) => (
                  <p key={item} className="mt-1 text-[11px] leading-snug text-muted-foreground">• {item}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {requirement.definition && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">What this means</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground">{requirement.definition}</p>
          </div>
        )}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Why it matters</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{requirement.importanceReason}</p>
        </div>

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
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Market evidence underneath the requirement</p>
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

function CoverageOverview({
  requirementModel,
  coverageModel,
  isLoading,
  unavailable,
}: {
  requirementModel: RequirementModel;
  coverageModel?: CoverageModel | null;
  isLoading: boolean;
  unavailable: boolean;
}) {
  if (isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Checking what you already have</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor is matching your CV, recorded outcomes, outputs, learning evidence, and relationships to the requirements.</p>
      </div>
    );
  }
  if (!coverageModel || coverageModel.mode !== "coverage_model") {
    return unavailable ? (
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Coverage could not be assessed yet</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">The requirement model remains usable. Anchor will reassess automatically when enough user evidence is available.</p>
      </div>
    ) : null;
  }

  const requirementById = new Map(requirementModel.requirements.map((requirement) => [requirement.id, requirement]));
  const counts = coverageModel.coverage.reduce((acc, item) => {
    acc[item.status] += 1;
    return acc;
  }, { proven: 0, partially_proven: 0, unproven: 0, unknown: 0, below_bar: 0 } as Record<CoverageStatus, number>);
  const alreadyEvidenced = coverageModel.coverage
    .filter((item) => item.status === "proven" || item.status === "partially_proven")
    .sort((left, right) => {
      const leftRequirement = requirementById.get(left.requirementId);
      const rightRequirement = requirementById.get(right.requirementId);
      return COVERAGE_RANK[left.status] - COVERAGE_RANK[right.status]
        || IMPORTANCE_RANK[leftRequirement?.importance || "contextual"] - IMPORTANCE_RANK[rightRequirement?.importance || "contextual"];
    })
    .slice(0, 3);
  const needsEvidence = coverageModel.coverage
    .filter((item) => item.status === "unproven" || item.status === "unknown" || item.status === "below_bar")
    .sort((left, right) => {
      const leftRequirement = requirementById.get(left.requirementId);
      const rightRequirement = requirementById.get(right.requirementId);
      return IMPORTANCE_RANK[leftRequirement?.importance || "contextual"] - IMPORTANCE_RANK[rightRequirement?.importance || "contextual"]
        || COVERAGE_RANK[left.status] - COVERAGE_RANK[right.status];
    })
    .slice(0, 3);
  const quality = COVERAGE_QUALITY_META[coverageModel.quality.status];

  return (
    <div className="mt-4 rounded-xl border border-card-border bg-card p-3" data-testid="requirement-coverage-overview">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">What Anchor can already evidence</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">This is an evidence check, not a fit score. Missing evidence does not mean you cannot do something.</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${quality.tone}`}>{quality.label}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">{counts.proven} proven</span>
        <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700">{counts.partially_proven} partly proven</span>
        <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800">{counts.unproven + counts.below_bar} need stronger evidence</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{counts.unknown} unknown</span>
      </div>

      {(alreadyEvidenced.length > 0 || needsEvidence.length > 0) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-emerald-50/50 p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-800">Strongest evidence found</p>
            <div className="mt-1.5 space-y-1.5">
              {alreadyEvidenced.length ? alreadyEvidenced.map((item) => {
                const requirement = requirementById.get(item.requirementId);
                return (
                  <div key={item.requirementId}>
                    <p className="text-xs font-medium text-foreground">{requirement?.label}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{item.reason}</p>
                  </div>
                );
              }) : <p className="text-[11px] text-muted-foreground">No requirement is strongly evidenced yet.</p>}
            </div>
          </div>

          <div className="rounded-lg bg-amber-50/50 p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-amber-800">Most important evidence still unclear</p>
            <div className="mt-1.5 space-y-1.5">
              {needsEvidence.length ? needsEvidence.map((item) => {
                const requirement = requirementById.get(item.requirementId);
                return (
                  <div key={item.requirementId}>
                    <p className="text-xs font-medium text-foreground">{requirement?.label}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{item.reason}</p>
                  </div>
                );
              }) : <p className="text-[11px] text-muted-foreground">No major evidence uncertainty is currently visible.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TrackResearchReview({ trackId }: { trackId?: number }) {
  const { data, isLoading } = useQuery<ResearchPlanResponse>({
    queryKey: [`/api/career-tracks/${trackId}/research-plan`],
    enabled: !!trackId,
    staleTime: 0,
  });
  const {
    data: coverageData,
    isLoading: coverageLoading,
    isError: coverageUnavailable,
  } = useQuery<CoverageResponse>({
    queryKey: [`/api/career-tracks/${trackId}/coverage`],
    enabled: !!trackId,
    staleTime: 0,
    retry: false,
  });

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

  const coverageModel = coverageData?.coverageModel;
  const roleFamilies = new Map(model.roleFamilies.map((role) => [role.id, role]));
  const evidenceClaims = new Map(model.evidenceClaims.map((claim) => [claim.id, claim]));
  const coverageByRequirement = new Map((coverageModel?.coverage || []).map((coverage) => [coverage.requirementId, coverage]));
  const userEvidence = new Map((coverageModel?.evidenceItems || []).map((item) => [item.id, item]));
  const quality = QUALITY_META[model.researchQuality.status];
  const featuredRequirements = [...model.requirements]
    .sort((left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance])
    .slice(0, 3);

  return (
    <div className="mt-3 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-research-review">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary"><Target className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">What you need for {model.target.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.target.definition}</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor researched the market to determine the requirements, then checked the evidence already available in your profile and workspace.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${quality.tone}`}>{quality.label}</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.requirements.length} requirements</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.roleFamilies.length} role families</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.researchQuality.sourceCount} market sources</span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{quality.detail}</p>

      <CoverageOverview requirementModel={model} coverageModel={coverageModel} isLoading={coverageLoading} unavailable={coverageUnavailable} />

      {featuredRequirements.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">The clearest requirements so far</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {featuredRequirements.map((requirement) => (
              <div key={requirement.id} className="rounded-xl border border-card-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${importanceTone(requirement.importance)}`}>{IMPORTANCE_LABEL[requirement.importance]}</span>
                  <CoverageBadge coverage={coverageByRequirement.get(requirement.id)} />
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{CATEGORY_LABEL[requirement.category] || requirement.category}</span>
                </div>
                <p className="mt-2 text-xs font-semibold leading-snug text-foreground">{requirement.label}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{requirement.successBar}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Accordion type="multiple" defaultValue={["perform_work"]} className="mt-4 space-y-2">
        {model.groups.map((group) => {
          const Icon = GROUP_ICON[group.id];
          const requirements = group.requirementIds.map((id) => model.requirements.find((requirement) => requirement.id === id)).filter(Boolean) as TargetRequirement[];
          const essentialCount = requirements.filter((requirement) => requirement.importance === "essential").length;
          const provenCount = requirements.filter((requirement) => coverageByRequirement.get(requirement.id)?.status === "proven").length;
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
                  {provenCount > 0 && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{provenCount} proven</span>}
                  {essentialCount > 0 && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">{essentialCount} essential</span>}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pb-1">
                  {requirements.length > 0 ? requirements.map((requirement) => (
                    <RequirementCard
                      key={requirement.id}
                      requirement={requirement}
                      roleFamilies={roleFamilies}
                      evidenceClaims={evidenceClaims}
                      coverage={coverageByRequirement.get(requirement.id)}
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
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">User evidence assessed</p><p className="mt-1 text-sm font-semibold">{coverageModel.quality.assessmentCoverage}%</p></div>
                  <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Cited user evidence</p><p className="mt-1 text-sm font-semibold">{coverageModel.quality.citedEvidenceCount}</p></div>
                  <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Direct or verified evidence</p><p className="mt-1 text-sm font-semibold">{coverageModel.quality.directEvidenceCount}</p></div>
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

              {list(coverageModel?.quality.caveats).length > 0 && (
                <div>
                  <p className="text-xs font-medium">Coverage caveats</p>
                  <div className="mt-1.5 space-y-1">
                    {list(coverageModel?.quality.caveats).map((caveat) => <p key={caveat} className="rounded-lg bg-muted/25 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">{caveat}</p>)}
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
