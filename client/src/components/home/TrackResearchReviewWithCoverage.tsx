import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  CircleDot,
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

type MarketEvidenceClaim = {
  id: string;
  claim: string;
  sourceTitle: string;
  sourceUrl?: string;
  confidence: RequirementConfidence;
  directness: "direct" | "supporting" | "inferred";
};

type UserEvidenceClaim = {
  id: string;
  claim: string;
  relevance?: string;
  strength: "direct" | "supporting" | "contextual";
  confidence: RequirementConfidence;
  sourceTitle: string;
  sourceUrl?: string;
};

type RequirementCoverage = {
  requirementId: string;
  state: CoverageState;
  confidence: RequirementConfidence;
  reason: string;
  evidenceClaimIds?: string[];
  missingEvidence?: string;
};

type RoleFamily = {
  id: string;
  title: string;
  description?: string;
  typicalOrganizations?: string[];
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
  target: { label: string; definition: string; assumption: string };
  marketSegments: Array<{ id: string; title: string }>;
  roleFamilies: RoleFamily[];
  groups: Array<{ id: RequirementGroupId; label: string; description: string; requirementIds: string[] }>;
  requirements: TargetRequirement[];
  evidenceClaims: MarketEvidenceClaim[];
  researchQuality: {
    status: "strong" | "usable" | "provisional";
    sourceCount: number;
    directSourceCount: number;
    requirementEvidenceCoverage: number;
    directRequirementCoverage: number;
    caveats?: string[];
  };
  boundaries?: { openQuestions?: string[] };
};

type CoverageModel = {
  mode: "coverage_model";
  evidenceClaims: UserEvidenceClaim[];
  coverage: RequirementCoverage[];
  summary: {
    counts: Record<CoverageState, number>;
    coreRequirementCount: number;
    coreCoverageRate: number;
  };
  evidenceQuality: {
    status: "strong" | "usable" | "thin";
    sourceCount: number;
    directClaimCount: number;
    caveats?: string[];
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

const COVERAGE_META: Record<CoverageState, { label: string; tone: string }> = {
  proven: { label: "Evidenced", tone: "bg-emerald-50 text-emerald-700" },
  partially_proven: { label: "Partly evidenced", tone: "bg-sky-50 text-sky-700" },
  unproven: { label: "Not yet evidenced", tone: "bg-amber-50 text-amber-800" },
  unknown: { label: "Cannot assess yet", tone: "bg-muted text-muted-foreground" },
  below_bar: { label: "Below the target bar", tone: "bg-rose-50 text-rose-700" },
};

const MARKET_QUALITY = {
  strong: { label: "Strong market evidence", tone: "bg-emerald-50 text-emerald-700" },
  usable: { label: "Useful market evidence", tone: "bg-sky-50 text-sky-700" },
  provisional: { label: "Provisional market evidence", tone: "bg-amber-50 text-amber-700" },
} as const;

const USER_QUALITY = {
  strong: { label: "Strong personal evidence", tone: "bg-emerald-50 text-emerald-700" },
  usable: { label: "Useful personal evidence", tone: "bg-sky-50 text-sky-700" },
  thin: { label: "Limited personal evidence", tone: "bg-amber-50 text-amber-700" },
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

function RequirementCard({
  requirement,
  coverage,
  roleFamilies,
  marketEvidence,
  userEvidence,
}: {
  requirement: TargetRequirement;
  coverage?: RequirementCoverage;
  roleFamilies: Map<string, RoleFamily>;
  marketEvidence: Map<string, MarketEvidenceClaim>;
  userEvidence: Map<string, UserEvidenceClaim>;
}) {
  const roles = list(requirement.roleFamilyIds).map((id) => roleFamilies.get(id)?.title).filter(Boolean) as string[];
  const marketClaims = list(requirement.evidenceClaimIds).map((id) => marketEvidence.get(id)).filter(Boolean) as MarketEvidenceClaim[];
  const userClaims = list(coverage?.evidenceClaimIds).map((id) => userEvidence.get(id)).filter(Boolean) as UserEvidenceClaim[];
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
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${importanceTone(requirement.importance)}`}>{IMPORTANCE_LABEL[requirement.importance]}</span>
              {coverage && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${COVERAGE_META[coverage.state].tone}`}>{COVERAGE_META[coverage.state].label}</span>}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{CATEGORY_LABEL[requirement.category] || requirement.category}</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug text-foreground">{requirement.label}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Sufficient when {requirement.successBar}</p>
          </div>
        </div>
      </summary>

      <div className="mt-3 space-y-3 border-t border-card-border pt-3">
        {coverage && (
          <div className={`rounded-lg px-2.5 py-2 ${COVERAGE_META[coverage.state].tone}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide">What Anchor found in your evidence</p>
            <p className="mt-1 text-xs leading-relaxed">{coverage.reason}</p>
            {coverage.missingEvidence && coverage.state !== "proven" && <p className="mt-1 text-[11px] leading-snug opacity-90">Evidence still needed: {coverage.missingEvidence}</p>}
          </div>
        )}

        {userClaims.length > 0 && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Your evidence</p>
            <div className="mt-1.5 space-y-1.5">
              {userClaims.slice(0, 4).map((claim) => (
                <div key={claim.id} className="rounded-lg bg-primary/5 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-medium text-primary">{claim.strength === "direct" ? "Direct evidence" : claim.strength === "supporting" ? "Supporting evidence" : "Context"}</span>
                    <span className="text-[10px] text-muted-foreground">{claim.sourceTitle}</span>
                    {claim.sourceUrl && <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">Open <ArrowUpRight className="h-3 w-3" /></a>}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-foreground">{claim.claim}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {requirement.definition && <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">What this means</p><p className="mt-1 text-xs leading-relaxed text-foreground">{requirement.definition}</p></div>}
        <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Why it matters</p><p className="mt-1 text-xs leading-relaxed text-foreground">{requirement.importanceReason}</p></div>
        {roles.length > 0 && <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Applies to</p><p className="mt-1 text-xs text-foreground">{roles.join(", ")}</p></div>}
        {context.length > 0 && <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Context</p><p className="mt-1 text-xs text-foreground">{context.join(" · ")}</p></div>}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Why Anchor believes this is required</p>
          {marketClaims.length > 0 ? <div className="mt-1.5 space-y-1.5">
            {marketClaims.slice(0, 4).map((claim) => (
              <div key={claim.id} className="rounded-lg bg-muted/35 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium text-primary">{claim.directness === "direct" ? "Direct market evidence" : claim.directness === "supporting" ? "Supporting evidence" : "Inferred evidence"}</span>
                  <span className="text-[10px] text-muted-foreground">{claim.sourceTitle}</span>
                  {claim.sourceUrl && <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">Source <ArrowUpRight className="h-3 w-3" /></a>}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{claim.claim}</p>
              </div>
            ))}
          </div> : <p className="mt-1 text-[11px] text-amber-700">No specific market source is linked yet. Treat this requirement as provisional.</p>}
        </div>
      </div>
    </details>
  );
}

function CoverageColumn({ title, description, icon: Icon, requirements, coverageByRequirement }: {
  title: string;
  description: string;
  icon: typeof CheckCircle2;
  requirements: TargetRequirement[];
  coverageByRequirement: Map<string, RequirementCoverage>;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /><p className="text-xs font-semibold text-foreground">{title}</p></div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{description}</p>
      <div className="mt-2 space-y-1.5">
        {requirements.length ? requirements.slice(0, 3).map((requirement) => (
          <div key={requirement.id} className="rounded-lg bg-muted/25 px-2 py-1.5">
            <p className="text-[11px] font-medium leading-snug text-foreground">{requirement.label}</p>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{coverageByRequirement.get(requirement.id)?.reason}</p>
          </div>
        )) : <p className="text-[11px] text-muted-foreground">None identified.</p>}
      </div>
    </div>
  );
}

export function TrackResearchReview({ trackId }: { trackId?: number }) {
  const { data, isLoading } = useQuery<ResearchPlanResponse>({ queryKey: [`/api/career-tracks/${trackId}/research-plan`], enabled: !!trackId, staleTime: 0 });

  if (!trackId) return null;
  if (isLoading) return <div className="mt-3 rounded-xl border border-card-border bg-muted/25 p-3 text-xs text-muted-foreground">Researching what the target requires and comparing it with your existing evidence...</div>;
  if (!data) return null;

  const model = data.requirementModel;
  if (!model || model.mode !== "requirement_model") return <div className="mt-3 rounded-xl border border-card-border bg-background/60 p-3"><p className="text-xs font-semibold text-foreground">Requirement model not available yet</p><p className="mt-1 text-[11px] leading-snug text-muted-foreground">Run target research again so Anchor can convert the market evidence into structured requirements.</p></div>;

  const coverageModel = data.coverageModel?.mode === "coverage_model" ? data.coverageModel : null;
  const roleFamilies = new Map(model.roleFamilies.map((role) => [role.id, role]));
  const marketEvidence = new Map(model.evidenceClaims.map((claim) => [claim.id, claim]));
  const userEvidence = new Map((coverageModel?.evidenceClaims || []).map((claim) => [claim.id, claim]));
  const coverageByRequirement = new Map((coverageModel?.coverage || []).map((coverage) => [coverage.requirementId, coverage]));
  const requirementById = new Map(model.requirements.map((requirement) => [requirement.id, requirement]));
  const sorted = [...model.requirements].sort((left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]);
  const proven = sorted.filter((requirement) => coverageByRequirement.get(requirement.id)?.state === "proven");
  const partial = sorted.filter((requirement) => ["partially_proven", "unproven", "below_bar"].includes(coverageByRequirement.get(requirement.id)?.state || ""));
  const unknown = sorted.filter((requirement) => coverageByRequirement.get(requirement.id)?.state === "unknown");
  const marketQuality = MARKET_QUALITY[model.researchQuality.status];

  return (
    <div className="mt-3 rounded-2xl border border-card-border bg-background/70 p-3 sm:p-4" data-testid="track-research-review">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary"><Target className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">What you need for {model.target.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.target.definition}</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Market evidence determines the requirements. Your CV, outputs, wins and relationships determine current coverage. Anchor keeps those evidence systems separate.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${marketQuality.tone}`}>{marketQuality.label}</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.requirements.length} requirements</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.roleFamilies.length} role families</span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{model.researchQuality.sourceCount} market sources</span>
      </div>

      {coverageModel && (
        <div className="mt-4 rounded-2xl border border-card-border bg-muted/15 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-xs font-semibold text-foreground">What Anchor can already evidence</p><p className="mt-1 max-w-2xl text-[11px] leading-snug text-muted-foreground">Missing proof is not treated as missing ability. Requirements stay unknown when the available evidence cannot support a fair assessment.</p></div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${USER_QUALITY[coverageModel.evidenceQuality.status].tone}`}>{USER_QUALITY[coverageModel.evidenceQuality.status].label}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">{coverageModel.summary.counts.proven} evidenced</span>
            <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700">{coverageModel.summary.counts.partially_proven} partly evidenced</span>
            <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800">{coverageModel.summary.counts.unproven} not yet evidenced</span>
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{coverageModel.summary.counts.unknown} cannot assess</span>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            <CoverageColumn title="Already evidenced" description="Current evidence meets the target bar." icon={CheckCircle2} requirements={proven} coverageByRequirement={coverageByRequirement} />
            <CoverageColumn title="Evidence to strengthen" description="Some evidence exists, or the bar is not yet met." icon={CircleDot} requirements={partial} coverageByRequirement={coverageByRequirement} />
            <CoverageColumn title="Cannot assess yet" description="Anchor needs better evidence before judging." icon={CircleHelp} requirements={unknown} coverageByRequirement={coverageByRequirement} />
          </div>
          {list(coverageModel.evidenceQuality.caveats).length > 0 && <details className="mt-3 rounded-lg bg-background/70 p-2"><summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Evidence limitations</summary><div className="mt-1.5 space-y-1">{list(coverageModel.evidenceQuality.caveats).slice(0, 5).map((caveat) => <p key={caveat} className="text-[10px] leading-snug text-muted-foreground">{caveat}</p>)}</div></details>}
        </div>
      )}

      <Accordion type="multiple" defaultValue={["perform_work"]} className="mt-4 space-y-2">
        {model.groups.map((group) => {
          const Icon = GROUP_ICON[group.id];
          const requirements = group.requirementIds.map((id) => requirementById.get(id)).filter(Boolean) as TargetRequirement[];
          const essentialCount = requirements.filter((requirement) => requirement.importance === "essential").length;
          return (
            <AccordionItem key={group.id} value={group.id} className="rounded-xl border border-card-border bg-card px-3">
              <AccordionTrigger className="py-3 text-left hover:no-underline">
                <div className="flex min-w-0 items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><p className="text-xs font-semibold text-foreground">{group.label}</p><p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{group.description}</p></div><span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{requirements.length}</span>{essentialCount > 0 && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">{essentialCount} essential</span>}</div>
              </AccordionTrigger>
              <AccordionContent><div className="space-y-2 pb-1">{requirements.length ? requirements.map((requirement) => <RequirementCard key={requirement.id} requirement={requirement} coverage={coverageByRequirement.get(requirement.id)} roleFamilies={roleFamilies} marketEvidence={marketEvidence} userEvidence={userEvidence} />) : <p className="rounded-lg bg-muted/25 p-2 text-[11px] text-muted-foreground">No requirements were identified in this group.</p>}</div></AccordionContent>
            </AccordionItem>
          );
        })}

        <AccordionItem value="market-research" className="rounded-xl border border-card-border bg-card px-3">
          <AccordionTrigger className="py-3 text-left hover:no-underline"><span className="flex items-center gap-2 text-xs font-semibold"><Search className="h-4 w-4 text-primary" /> Research underneath</span></AccordionTrigger>
          <AccordionContent><div className="space-y-3 pb-1"><div><p className="flex items-center gap-1.5 text-xs font-medium"><Briefcase className="h-3.5 w-3.5 text-primary" /> Role families researched</p><div className="mt-1.5 grid gap-2 sm:grid-cols-2">{model.roleFamilies.map((role) => <div key={role.id} className="rounded-lg bg-muted/25 p-2"><p className="text-xs font-medium text-foreground">{role.title}</p>{role.description && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{role.description}</p>}{list(role.typicalOrganizations).length > 0 && <p className="mt-1 text-[11px] text-primary">Examples: {list(role.typicalOrganizations).slice(0, 4).join(", ")}</p>}</div>)}</div></div>{model.marketSegments.length > 0 && <div><p className="text-xs font-medium">Market segments used</p><div className="mt-1.5 flex flex-wrap gap-1.5">{model.marketSegments.map((segment) => <span key={segment.id} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{segment.title}</span>)}</div></div>}</div></AccordionContent>
        </AccordionItem>

        <AccordionItem value="research-quality" className="rounded-xl border border-card-border bg-card px-3">
          <AccordionTrigger className="py-3 text-left hover:no-underline"><span className="flex items-center gap-2 text-xs font-semibold"><AlertCircle className="h-4 w-4 text-primary" /> Evidence quality and open questions</span></AccordionTrigger>
          <AccordionContent><div className="space-y-3 pb-1"><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Requirement evidence coverage</p><p className="mt-1 text-sm font-semibold">{model.researchQuality.requirementEvidenceCoverage}%</p></div><div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Direct requirement coverage</p><p className="mt-1 text-sm font-semibold">{model.researchQuality.directRequirementCoverage}%</p></div><div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Direct market sources</p><p className="mt-1 text-sm font-semibold">{model.researchQuality.directSourceCount}</p></div></div>{list(model.researchQuality.caveats).length > 0 && <div><p className="text-xs font-medium">Market research caveats</p><div className="mt-1.5 space-y-1">{list(model.researchQuality.caveats).map((caveat) => <p key={caveat} className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">{caveat}</p>)}</div></div>}{list(model.boundaries?.openQuestions).length > 0 && <div><p className="text-xs font-medium">Open market questions</p><div className="mt-1.5 space-y-1">{list(model.boundaries?.openQuestions).slice(0, 6).map((question) => <p key={question} className="rounded-lg bg-muted/25 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">{question}</p>)}</div></div>}</div></AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
