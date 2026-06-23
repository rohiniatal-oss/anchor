import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Search,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type RequirementGroupId = "perform_work" | "demonstrate_credibility" | "access_opportunity";
type RequirementImportance = "essential" | "important" | "differentiator" | "contextual";
type RequirementConfidence = "high" | "medium" | "low";
type CoverageState = "proven" | "partially_proven" | "unproven" | "unknown" | "below_bar";

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
  title: string;
  detail: string;
  sourceUrl?: string;
  targetSpecific?: boolean;
  strength: "direct" | "supporting" | "weak";
};

type CoverageAssessment = {
  requirementId: string;
  state: CoverageState;
  confidence: RequirementConfidence;
  evidenceItemIds?: string[];
  assessedSourceTypes?: string[];
  rationale: string;
  successBarAssessment: string;
  missingEvidence?: string;
  verificationPrompt?: string;
};

type CoverageModel = {
  mode: "requirement_coverage";
  target: {
    label: string;
    assumption: string;
  };
  assessments: CoverageAssessment[];
  evidenceItems: UserEvidenceItem[];
  summary: {
    counts: Record<CoverageState, number>;
    clearlyEvidencedRequirementIds?: string[];
    partlyEvidencedRequirementIds?: string[];
    notYetVerifiedRequirementIds?: string[];
    verificationQueue?: Array<{ requirementId: string; prompt: string; reason: string }>;
    quality: {
      status: "strong" | "usable" | "provisional";
      sourceCount: number;
      sourceTypeCount: number;
      directEvidenceCount: number;
      linkedAssessmentCount: number;
      linkedAssessmentCoverage: number;
      caveats?: string[];
    };
  };
};

type ResearchPlanResponse = {
  track: { id: number; name: string; description?: string };
  requirementModel?: RequirementModel | null;
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

const COVERAGE_META: Record<CoverageState, { label: string; detail: string; tone: string; icon: typeof CheckCircle2 }> = {
  proven: {
    label: "Clearly evidenced",
    detail: "Stored evidence substantially meets the requirement's success bar.",
    tone: "bg-emerald-50 text-emerald-700",
    icon: CheckCircle2,
  },
  partially_proven: {
    label: "Partly evidenced",
    detail: "Relevant evidence exists, but it does not yet fully meet the target bar.",
    tone: "bg-sky-50 text-sky-700",
    icon: CircleDashed,
  },
  unproven: {
    label: "Not evidenced yet",
    detail: "Anchor checked relevant stored sources but did not find adequate proof.",
    tone: "bg-amber-50 text-amber-700",
    icon: CircleHelp,
  },
  unknown: {
    label: "Cannot assess yet",
    detail: "Anchor does not hold enough relevant user evidence to assess this responsibly.",
    tone: "bg-muted text-muted-foreground",
    icon: CircleHelp,
  },
  below_bar: {
    label: "Evidence suggests below bar",
    detail: "Explicit feedback or outcomes suggest further development may be needed.",
    tone: "bg-rose-50 text-rose-700",
    icon: AlertTriangle,
  },
};

const EVIDENCE_SOURCE_LABEL: Record<string, string> = {
  cv: "CV",
  profile_summary: "Profile summary",
  win: "Outcome or win",
  proof_asset: "Proof asset",
  learning_output: "Learning output",
  learning_activity: "Learning activity",
  network_relationship: "Relationship",
  contact_interaction: "Interaction",
  application_signal: "Application signal",
  task_completion: "Completed task",
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

function confidenceLabel(confidence: RequirementConfidence) {
  if (confidence === "high") return "High confidence";
  if (confidence === "low") return "Low confidence";
  return "Medium confidence";
}

function CoverageBadge({ state }: { state: CoverageState }) {
  const meta = COVERAGE_META[state];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}

function EvidenceCard({ item }: { item: UserEvidenceItem }) {
  return (
    <div className="rounded-lg bg-muted/35 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium text-primary">{EVIDENCE_SOURCE_LABEL[item.sourceType] || item.sourceType}</span>
        {item.targetSpecific && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">This target</span>}
        <span className="text-[10px] text-muted-foreground">{item.title}</span>
        {item.sourceUrl && (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
            Open <ArrowUpRight className="h-3 w-3" />
          </a>
        )}
      </div>
      {item.detail && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{item.detail}</p>}
    </div>
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
  coverage?: CoverageAssessment;
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
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {CATEGORY_LABEL[requirement.category] || requirement.category}
              </span>
              {coverage && <CoverageBadge state={coverage.state} />}
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug text-foreground">{requirement.label}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Sufficient when {requirement.successBar}</p>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{coverage ? `${confidenceLabel(coverage.confidence)} coverage` : confidenceLabel(requirement.confidence)}</span>
        </div>
      </summary>

      <div className="mt-3 space-y-3 border-t border-card-border pt-3">
        {coverage && (
          <div className="rounded-xl border border-card-border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <CoverageBadge state={coverage.state} />
              <span className="text-[10px] text-muted-foreground">{confidenceLabel(coverage.confidence)}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-foreground">{coverage.rationale}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{coverage.successBarAssessment}</p>
            {personalEvidence.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {personalEvidence.map((item) => <EvidenceCard key={item.id} item={item} />)}
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                Anchor checked {list(coverage.assessedSourceTypes).map((source) => EVIDENCE_SOURCE_LABEL[source] || source).join(", ") || "the available evidence"} but has not linked a sufficient example yet.
              </p>
            )}
            {coverage.missingEvidence && (
              <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-amber-800">What would verify this</p>
                <p className="mt-1 text-[11px] leading-snug text-amber-900">{coverage.missingEvidence}</p>
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
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Why the target requires it</p>
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
            <p className="mt-1 text-[11px] text-amber-700">No specific market source claim is linked yet. Treat this requirement as provisional.</p>
          )}
        </div>
      </div>
    </details>
  );
}

function CoverageSummary({ model, coverage }: { model: RequirementModel; coverage: CoverageModel }) {
  const requirementById = new Map(model.requirements.map((requirement) => [requirement.id, requirement]));
  const clear = list(coverage.summary.clearlyEvidencedRequirementIds).map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  const partial = list(coverage.summary.partlyEvidencedRequirementIds).map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
  const unverified = list(coverage.summary.notYetVerifiedRequirementIds)
    .map((id) => requirementById.get(id))
    .filter((requirement): requirement is TargetRequirement => Boolean(requirement))
    .sort((left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]);
  const notVerifiedCount = coverage.summary.counts.unproven + coverage.summary.counts.unknown + coverage.summary.counts.below_bar;

  return (
    <div className="mt-4 rounded-2xl border border-card-border bg-card p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <div className="rounded-lg bg-primary/10 p-1.5 text-primary"><ShieldCheck className="h-4 w-4" /></div>
        <div>
          <p className="text-xs font-semibold text-foreground">What Anchor can verify from what you already have</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor used existing CV, outcome, proof, learning, relationship, and application evidence. No questionnaire is required.</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">Clearly evidenced</p>
          <p className="mt-1 text-xl font-semibold text-emerald-800">{coverage.summary.counts.proven}</p>
          <p className="mt-1 text-[10px] leading-snug text-emerald-700">Evidence substantially meets the target bar.</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-sky-700">Partly evidenced</p>
          <p className="mt-1 text-xl font-semibold text-sky-800">{coverage.summary.counts.partially_proven}</p>
          <p className="mt-1 text-[10px] leading-snug text-sky-700">Relevant evidence exists but needs strengthening or packaging.</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700">Not yet verified</p>
          <p className="mt-1 text-xl font-semibold text-amber-800">{notVerifiedCount}</p>
          <p className="mt-1 text-[10px] leading-snug text-amber-700">This is an evidence finding, not a judgement of ability.</p>
        </div>
      </div>

      {(clear.length > 0 || partial.length > 0 || unverified.length > 0) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-card-border bg-background p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Strongest existing evidence</p>
            <div className="mt-2 space-y-1.5">
              {[...clear, ...partial].slice(0, 3).map((requirement) => (
                <div key={requirement.id} className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="leading-snug text-foreground">{requirement.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-background p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Important areas not yet verified</p>
            <div className="mt-2 space-y-1.5">
              {unverified.slice(0, 3).map((requirement) => (
                <div key={requirement.id} className="flex items-start gap-2 text-xs">
                  <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span className="leading-snug text-foreground">{requirement.label}</span>
                </div>
              ))}
              {unverified.length === 0 && <p className="text-[11px] text-muted-foreground">No important unverified requirements surfaced.</p>}
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        Coverage quality is {coverage.summary.quality.status}. Anchor linked evidence to {coverage.summary.quality.linkedAssessmentCoverage}% of requirement assessments across {coverage.summary.quality.sourceCount} stored evidence items.
      </p>
    </div>
  );
}

export function TrackResearchReview({ trackId }: { trackId?: number }) {
  const { data, isLoading } = useQuery<ResearchPlanResponse>({
    queryKey: [`/api/career-tracks/${trackId}/research-plan`],
    enabled: !!trackId,
    staleTime: 0,
  });

  if (!trackId) return null;
  if (isLoading) {
    return <div className="mt-3 rounded-xl border border-card-border bg-muted/25 p-3 text-xs text-muted-foreground">Building the requirement and coverage models...</div>;
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

  const coverage = data.coverageModel?.mode === "requirement_coverage" ? data.coverageModel : null;
  const roleFamilies = new Map(model.roleFamilies.map((role) => [role.id, role]));
  const evidenceClaims = new Map(model.evidenceClaims.map((claim) => [claim.id, claim]));
  const coverageByRequirement = new Map((coverage?.assessments || []).map((assessment) => [assessment.requirementId, assessment]));
  const userEvidence = new Map((coverage?.evidenceItems || []).map((item) => [item.id, item]));
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
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Market and role-family evidence determines the requirements. Your own evidence determines coverage. Anchor keeps those two judgements separate.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${quality.tone}`}>{quality.label}</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.requirements.length} requirements</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.roleFamilies.length} role families</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.researchQuality.sourceCount} market sources</span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{quality.detail}</p>

      {coverage ? (
        <CoverageSummary model={model} coverage={coverage} />
      ) : (
        <div className="mt-4 rounded-xl border border-card-border bg-muted/25 p-3">
          <p className="text-xs font-semibold text-foreground">Coverage assessment is not available yet</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Anchor has defined the requirements, but has not yet compared them with your stored evidence.</p>
        </div>
      )}

      {featuredRequirements.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">The clearest requirements so far</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {featuredRequirements.map((requirement) => {
              const assessment = coverageByRequirement.get(requirement.id);
              return (
                <div key={requirement.id} className="rounded-xl border border-card-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${importanceTone(requirement.importance)}`}>{IMPORTANCE_LABEL[requirement.importance]}</span>
                    {assessment && <CoverageBadge state={assessment.state} />}
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-snug text-foreground">{requirement.label}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{requirement.successBar}</p>
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

              {coverage && list(coverage.summary.quality.caveats).length > 0 && (
                <div>
                  <p className="text-xs font-medium">Coverage caveats</p>
                  <div className="mt-1.5 space-y-1">
                    {list(coverage.summary.quality.caveats).map((caveat) => <p key={caveat} className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">{caveat}</p>)}
                  </div>
                </div>
              )}

              {list(model.researchQuality.caveats).length > 0 && (
                <div>
                  <p className="text-xs font-medium">Requirement-model caveats</p>
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
