// @ts-nocheck
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Trophy, Lightbulb, ArrowUpRight, Briefcase, Users,
  GraduationCap, Target, ChevronRight, Link2, AlertTriangle,
  BookOpen, CheckCircle2, FolderKanban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS, PENDING_CONTACT_DRAFT_KEY, PENDING_LEARN_DRAFT_KEY, queueIntakeDraft, buildPrefillHash } from "@/lib/homeTypes";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { useRecommendations } from "@/hooks/useRecommendations";
import { CareerCompassCard } from "@/components/home/CareerCompassCard";
import { GroupLabel } from "@/components/home/GroupLabel";
import { Loading } from "@/components/home/Loading";
import { learningGapPrepStarter } from "@shared/learningGapSuggestions";
import { buildPrepStarterDraft } from "@/lib/learnStarter";
import type { Tab } from "@/lib/homeTypes";
import type { CareerGoalT, GoalsStateResponseT } from "@/lib/goalSpine";
import { WIN_CATEGORY_LABEL } from "@/lib/homeTypes";

type TrackDiagnostic = {
  id: number; slug: string; name: string; status: string; priority: number; whyItFits: string;
  counts: { jobs: number; learn: number; contacts: number; hustles: number; tasks: number };
  signals: { directionGap: number; readinessGap: number; proofGap: number; warmthGap: number; executionGap: number; learningGap?: number; learnProofGap?: number; evidenceGap?: number };
  evidence?: {
    count: number; topCategory: string | null;
    producingVsPlanning: "producing" | "balanced" | "planning" | "idle";
    executionRatio: number | null; lastEvidenceAt: number | null;
  };
  learningGap?: {
    requiredCount: number; evidencedCount: number; gapCount: number;
    topGapDomain: string | null; topGapLabel: string | null; topGapHasResource: boolean; recommendedMove: string | null;
  } | null;
  bottleneck: string; bottleneckLabel: string; recommendedMove: string;
};
type UnlinkedItem = { entity: "jobs" | "learn" | "contacts" | "hustles"; id: number; title: string; status: string };
type StrategyInsight = { kind: string; text: string };
type LearningGapSignal = {
  trackId: number; trackName: string; gapDomains: string[];
  topGap: { domain: string; label: string };
  recommendedMove: string; hasResource: boolean;
};
type FrontDoor = {
  tracks: TrackDiagnostic[];
  topThree: TrackDiagnostic[];
  insights: StrategyInsight[];
  unlinked: { items: UnlinkedItem[]; counts: Record<string, number> };
  evidence?: unknown;
  learningGap?: LearningGapSignal | null;
};
type RecommendationItem = {
  id: number;
  collection: string;
  kind: string;
  status: string;
  source: string;
  title: string;
  whySuggested: string;
  linkedTrackId?: number | null;
  linkedGapKey?: string | null;
  linkedCombination?: string | null;
  freshnessLabel?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  rankScore?: number | null;
  rankReason?: string | null;
  executionShape: string;
  acceptanceEntityType?: string | null;
};
type RecommendationDetail = RecommendationItem & {
  subdivisions: Array<{
    id: number;
    subdivisionKey: string;
    label: string;
    whyItMatters: string;
    suggestedMaterials: string;
    sequence: number;
  }>;
  milestones: Array<{
    id: number;
    milestoneKey: string;
    label: string;
    doneWhen: string;
    status: string;
    sequence: number;
    suggestedTaskTitle: string;
    subdivisionKey: string;
  }>;
};

const PVP_META: Record<"producing" | "balanced" | "planning" | "idle", { label: string; cls: string }> = {
  producing: { label: "Producing", cls: "bg-primary/10 text-primary" },
  balanced: { label: "Balanced", cls: "bg-slate-100 text-slate-600" },
  planning: { label: "Planning, not producing", cls: "bg-slate-200 text-slate-700" },
  idle: { label: "Idle", cls: "bg-muted text-muted-foreground" },
};
function EvidenceChips({ ev }: { ev: NonNullable<TrackDiagnostic["evidence"]> }) {
  const pvp = PVP_META[ev.producingVsPlanning];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="evidence-chips">
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-medium px-1.5 py-0.5" data-testid="evidence-count">
        <Trophy className="w-3 h-3" /> {ev.count} {ev.count === 1 ? "win" : "wins"} | 28d
      </span>
      {ev.topCategory && (
        <span className="inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid="evidence-top-category">
          {WIN_CATEGORY_LABEL[ev.topCategory as keyof typeof WIN_CATEGORY_LABEL] || ev.topCategory}
        </span>
      )}
      <span className={`inline-flex shrink-0 text-[10px] rounded-full px-1.5 py-0.5 ${pvp.cls}`} data-testid="evidence-pvp">{pvp.label}</span>
    </div>
  );
}
function CapabilityChips({ lg }: { lg: NonNullable<TrackDiagnostic["learningGap"]> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="capability-chips">
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium px-1.5 py-0.5" data-testid="capability-evidenced">
        {lg.evidencedCount}/{lg.requiredCount} learning areas covered
      </span>
      {lg.gapCount > 0 && (
        <span className="inline-flex shrink-0 text-[10px] rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5" data-testid="capability-gap">
          {lg.gapCount} area{lg.gapCount === 1 ? "" : "s"} still needs support{lg.topGapLabel ? ` | ${lg.topGapLabel}` : ""}
        </span>
      )}
      {lg.gapCount > 0 && lg.topGapLabel && (
        <span className={`inline-flex shrink-0 text-[10px] rounded-full px-1.5 py-0.5 ${lg.topGapHasResource ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-700"}`} data-testid="capability-resource">
          {lg.topGapHasResource ? "learning item saved" : "needs first learning item"}
        </span>
      )}
    </div>
  );
}

const RECOMMENDATION_STATUS_LABEL: Record<string, string> = {
  ranked: "Ready to review",
  saved: "Saved for later",
};
const RECOMMENDATION_ENTITY_TAB: Record<string, Tab> = {
  learn: "learn",
  contact: "network",
  hustle: "strategy",
  task: "today",
  job: "jobs",
};

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function inferRecommendationEntityType(rec: Pick<RecommendationItem, "collection" | "kind" | "acceptanceEntityType">) {
  if (rec.acceptanceEntityType === "task" || rec.acceptanceEntityType === "learn" || rec.acceptanceEntityType === "contact" || rec.acceptanceEntityType === "job" || rec.acceptanceEntityType === "hustle") {
    return rec.acceptanceEntityType;
  }
  if (rec.collection === "learning-corpus" || rec.kind === "learning-resource" || rec.kind === "learning-theme") return "learn";
  if (rec.collection === "network-targets" || rec.kind === "contact-person-type" || rec.kind === "contact-actual-person") return "contact";
  if (rec.collection === "project-ideas" || rec.kind === "project-idea") return "hustle";
  if (rec.kind === "organization-target" || rec.kind === "role-example" || rec.kind === "next-step-idea") return "task";
  return "task";
}

function recommendationKindLabel(rec: RecommendationItem) {
  if (rec.kind === "learning-theme") return "Theme to study";
  if (rec.kind === "learning-resource") return "Learning resource";
  if (rec.kind === "contact-person-type") return "Person to reach out to";
  if (rec.kind === "contact-actual-person") return "Specific contact";
  if (rec.kind === "project-idea") return "Project idea";
  if (rec.kind === "organization-target") return "Company or org to look at";
  if (rec.kind === "role-example") return "Example role to look at";
  if (rec.kind === "next-step-idea") return "Suggested next move";
  return "Suggested next step";
}

function recommendationShapeLabel(rec: RecommendationItem) {
  if (rec.executionShape === "ongoing-program") return "Multi-session";
  if (rec.executionShape === "sequenced-item") return "Multi-step";
  if (rec.executionShape === "milestone-arc") return "Step-by-step arc";
  return "Single move";
}

function recommendationPrimaryActionLabel(entityType: string) {
  if (entityType === "learn") return "Add to my learning list";
  if (entityType === "contact") return "Add to my network";
  if (entityType === "hustle") return "Add to my projects";
  if (entityType === "job") return "Add to my jobs";
  return "Add as a task";
}

export function StrategyView({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const { data, isLoading } = useQuery<FrontDoor>({ queryKey: ["/api/strategy/front-door"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: recommendations = [] } = useRecommendations<RecommendationItem[]>();
  const { data: careerTracks = [] } = useCareerTracks();
  const [openRecommendationId, setOpenRecommendationId] = useState<string>("");
  if (isLoading) return <Loading />;
  const activeGoal = goalState?.goals?.[0] || null;
  const tracks = data?.tracks || [];
  const insights = (data?.insights || []).map((i) => i.text);
  const unlinkedItems = data?.unlinked?.items || [];
  const active = tracks.filter((t) => t.status === "active");
  const watching = tracks.filter((t) => t.status !== "active");
  const visibleRecommendations = recommendations.filter((rec) => !["accepted", "rejected", "archived", "duplicate", "stale"].includes(rec.status));
  const trackNameById = new Map(careerTracks.map((track) => [track.id, track.name]));

  function openLearnDraftFromGap(t: TrackDiagnostic) {
    const topGapDomain = t.learningGap?.topGapDomain?.trim();
    const topGapLabel = t.learningGap?.topGapLabel?.trim();
    if (!topGapDomain || !topGapLabel) return;
    const draft = buildPrepStarterDraft({
      subjectText: t.name,
      relatedTrackId: t.id,
      explicitDomainKey: topGapDomain as any,
      explicitDomainLabel: topGapLabel,
      noteIntro: `Prep starter for ${t.name}.`,
    });
    queueIntakeDraft(PENDING_LEARN_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/learn", "learnDraft", draft);
    onOpenTab("learn");
  }

  function openContactDraftForTrack(t: TrackDiagnostic) {
    const draft = {
      sector: t.name,
      targetOrg: "",
      targetRole: t.name,
      why: `Could help you reality-check or open doors for ${t.name}.`,
      relatedTrackId: t.id,
      askType: "advice",
      relationshipStrength: "cold",
      status: "to_contact",
    };
    queueIntakeDraft(PENDING_CONTACT_DRAFT_KEY, draft);
    window.location.hash = buildPrefillHash("/network", "contactDraft", draft);
    onOpenTab("network");
  }

  function openTrackTab(tab: Tab) {
    onOpenTab(tab);
  }

  const TrackCard = ({ t }: { t: TrackDiagnostic }) => {
    const stalled = t.bottleneck !== "none";
    const needsPrepItem = !!(t.learningGap?.gapCount && t.learningGap.topGapLabel && !t.learningGap.topGapHasResource);
    const prepStarter = needsPrepItem && t.learningGap?.topGapDomain && t.learningGap?.topGapLabel
      ? learningGapPrepStarter(t.learningGap.topGapDomain as any, t.learningGap.topGapLabel)
      : null;
    const needsFirstRole = t.bottleneck === "direction" && t.counts.jobs === 0;
    const needsContactPath = t.bottleneck === "warmth" && t.counts.contacts === 0;
    const needsContactFollowThrough = t.bottleneck === "warmth" && t.counts.contacts > 0;

    // Use a saved recommendation when one exists for this gap — avoids a blank form.
    const savedLearningRec = needsPrepItem
      ? (visibleRecommendations.find((r) =>
          r.linkedTrackId === t.id &&
          r.linkedGapKey === (t.learningGap?.topGapDomain ?? "") &&
          r.collection === "learning-corpus"
        ) ?? null)
      : null;
    const savedContactRec = needsContactPath
      ? (visibleRecommendations.find((r) =>
          r.linkedTrackId === t.id &&
          r.collection === "network-targets"
        ) ?? null)
      : null;

    return (
      <div className="rounded-xl border border-card-border bg-card p-4" data-testid={`track-${t.slug}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug">{t.name}</h3>
            {t.whyItFits && <p className="text-xs text-muted-foreground mt-0.5">{t.whyItFits}</p>}
          </div>
          <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{t.counts.jobs} role{t.counts.jobs !== 1 ? "s" : ""}</span>
        </div>
        {stalled ? (
          <div className="rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 px-3 py-2 mt-2.5" data-testid={`track-health-${t.slug}`}>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-snug">{t.bottleneckLabel}</p>
            <p className="text-xs text-primary mt-1.5 flex items-start gap-1"><ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-px" />{t.recommendedMove}</p>
          </div>
        ) : (
          <p className="text-xs text-primary mt-2.5 flex items-start gap-1" data-testid={`track-health-${t.slug}`}><ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-px" />{t.recommendedMove}</p>
        )}
        {(needsFirstRole || needsPrepItem || needsContactPath || needsContactFollowThrough) && (
          <div className="mt-2.5 space-y-2">
            {needsFirstRole && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-muted/35 px-3 py-2">
                <p className="text-xs text-muted-foreground leading-snug">No live role saved yet for <span className="font-medium text-foreground">{t.name}</span>.</p>
                <Button size="sm" variant="outline" onClick={() => openTrackTab("jobs")} data-testid={`button-add-gap-job-${t.slug}`}>
                  <Briefcase className="w-4 h-4 mr-1" /> Add role
                </Button>
              </div>
            )}
            {needsContactPath && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-muted/35 px-3 py-2">
                <p className="text-xs text-muted-foreground leading-snug">No one to reach out to yet for <span className="font-medium text-foreground">{t.name}</span>.</p>
                {savedContactRec ? (
                  <Button size="sm" variant="outline" onClick={() => acceptRecommendation(savedContactRec)} data-testid={`button-use-saved-contact-${t.slug}`}>
                    <Users className="w-4 h-4 mr-1" /> Use saved suggestion
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => openContactDraftForTrack(t)} data-testid={`button-add-gap-contact-${t.slug}`}>
                    <Users className="w-4 h-4 mr-1" /> Add contact
                  </Button>
                )}
              </div>
            )}
            {needsContactFollowThrough && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-muted/35 px-3 py-2">
                <p className="text-xs text-muted-foreground leading-snug">You have contacts for <span className="font-medium text-foreground">{t.name}</span> — check if any need a follow-up or a clearer ask.</p>
                <Button size="sm" variant="outline" onClick={() => openTrackTab("network")} data-testid={`button-open-gap-contact-${t.slug}`}>
                  <Users className="w-4 h-4 mr-1" /> Open network
                </Button>
              </div>
            )}
            {needsPrepItem && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-muted/35 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-snug"><span className="font-medium text-foreground">{t.learningGap?.topGapLabel}</span> still needs a first prep starter.</p>
                  {prepStarter && !savedLearningRec && (
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">Start with: <span className="font-medium text-foreground">{prepStarter.title}</span>.</p>
                  )}
                </div>
                {savedLearningRec ? (
                  <Button size="sm" variant="outline" onClick={() => acceptRecommendation(savedLearningRec)} data-testid={`button-use-saved-learn-${t.slug}`}>
                    <GraduationCap className="w-4 h-4 mr-1" /> Use saved prep starter
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => openLearnDraftFromGap(t)} data-testid={`button-add-gap-learn-${t.slug}`}>
                    <GraduationCap className="w-4 h-4 mr-1" /> Set up prep starter
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const ENTITY_TAB: Record<UnlinkedItem["entity"], Tab> = { jobs: "jobs", learn: "learn", contacts: "network", hustles: "strategy" };
  const ENTITY_LABEL: Record<UnlinkedItem["entity"], string> = { jobs: "Job", learn: "Learn", contacts: "Contact", hustles: "Projects and public work" };
  async function linkUnlinked(it: UnlinkedItem, trackId: number) {
    await mutateAndInvalidate("PATCH", `/api/${it.entity}/${it.id}/link-track`, { trackId }, [`/api/${it.entity}`, "/api/strategy", "/api/strategy/diagnostics", "/api/strategy/unlinked", "/api/strategy/front-door", ...GOAL_SPINE_QUERY_KEYS]);
  }
  async function updateRecommendationStatus(id: number, status: string) {
    await mutateAndInvalidate("PATCH", `/api/recommendations/${id}`, { status }, ["/api/recommendations"]);
  }
  async function acceptRecommendation(rec: RecommendationItem) {
    const entityType = inferRecommendationEntityType(rec);
    await mutateAndInvalidate("POST", `/api/recommendations/${rec.id}/accept`, { entityType }, [
      "/api/recommendations",
      "/api/learn",
      "/api/contacts",
      "/api/jobs",
      "/api/hustles",
      "/api/tasks",
      "/api/strategy",
      "/api/strategy/diagnostics",
      "/api/strategy/unlinked",
      "/api/strategy/front-door",
      ...GOAL_SPINE_QUERY_KEYS,
    ]);
    onOpenTab(RECOMMENDATION_ENTITY_TAB[entityType] || "strategy");
  }

  const RecommendationCard = ({ rec }: { rec: RecommendationItem }) => {
    const entityType = inferRecommendationEntityType(rec);
    const isOpen = openRecommendationId === String(rec.id);
    const { data: detail, isLoading: isLoadingDetail } = useQuery<RecommendationDetail>({
      queryKey: [`/api/recommendations/${rec.id}`],
      enabled: isOpen,
      staleTime: 0,
    });
    const subdivisions = detail?.subdivisions || [];
    const milestones = detail?.milestones || [];
    const linkedTrackName = rec.linkedTrackId ? trackNameById.get(rec.linkedTrackId) : "";

    return (
      <AccordionItem value={String(rec.id)} className="rounded-xl border border-card-border bg-card px-4">
        <AccordionTrigger className="py-3 hover:no-underline">
          <div className="min-w-0 pr-3 text-left">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                {recommendationKindLabel(rec)}
              </span>
              <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {recommendationShapeLabel(rec)}
              </span>
              {RECOMMENDATION_STATUS_LABEL[rec.status] && (
                <span className="inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                  {RECOMMENDATION_STATUS_LABEL[rec.status]}
                </span>
              )}
              {linkedTrackName && (
                <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  {linkedTrackName}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-medium leading-snug text-foreground">{rec.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{rec.whySuggested}</p>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-0">
          <div className="space-y-4 border-t border-card-border pt-3">
            {(rec.rankReason || rec.sourceLabel || rec.freshnessLabel) && (
              <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                {rec.rankReason && <span className="rounded-full bg-muted px-2 py-1">{rec.rankReason}</span>}
                {rec.sourceLabel && <span className="rounded-full bg-muted px-2 py-1">{rec.sourceLabel}</span>}
                {rec.freshnessLabel && <span className="rounded-full bg-muted px-2 py-1">{rec.freshnessLabel}</span>}
              </div>
            )}

            {isLoadingDetail ? (
              <p className="text-xs text-muted-foreground">Loading the subtopics and checkpoints for this suggestion...</p>
            ) : (
              <>
                {subdivisions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-foreground">What's inside</p>
                    <div className="mt-2 space-y-2">
                      {subdivisions.map((subdivision) => {
                        const materials = parseStringList(subdivision.suggestedMaterials);
                        return (
                          <div key={subdivision.id} className="rounded-lg border border-card-border bg-muted/25 p-3">
                            <p className="text-sm font-medium leading-snug">{subdivision.label}</p>
                            {subdivision.whyItMatters && (
                              <p className="mt-1 text-xs leading-snug text-muted-foreground">{subdivision.whyItMatters}</p>
                            )}
                            {materials.length > 0 && (
                              <div className="mt-2">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Starter materials</p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {materials.map((material) => (
                                    <span key={material} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                                      <BookOpen className="h-3 w-3" /> {material}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {milestones.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-foreground">Checkpoints</p>
                    <div className="mt-2 space-y-2">
                      {milestones.map((milestone) => (
                        <div key={milestone.id} className="rounded-lg border border-card-border bg-muted/25 p-3">
                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-snug">{milestone.label}</p>
                              {milestone.doneWhen && (
                                <p className="mt-1 text-xs leading-snug text-muted-foreground">Done when: {milestone.doneWhen}</p>
                              )}
                              {milestone.suggestedTaskTitle && (
                                <p className="mt-1 text-xs leading-snug text-primary">Next step: {milestone.suggestedTaskTitle}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => acceptRecommendation(rec)} data-testid={`button-accept-recommendation-${rec.id}`}>
                {entityType === "hustle" ? <FolderKanban className="mr-1 h-4 w-4" /> : entityType === "learn" ? <GraduationCap className="mr-1 h-4 w-4" /> : entityType === "contact" ? <Users className="mr-1 h-4 w-4" /> : entityType === "job" ? <Briefcase className="mr-1 h-4 w-4" /> : <Target className="mr-1 h-4 w-4" />}
                {recommendationPrimaryActionLabel(entityType)}
              </Button>
              {rec.status !== "saved" && (
                <Button size="sm" variant="outline" onClick={() => updateRecommendationStatus(rec.id, "saved")} data-testid={`button-save-recommendation-${rec.id}`}>
                  Save for later
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => updateRecommendationStatus(rec.id, "archived")} data-testid={`button-archive-recommendation-${rec.id}`}>
                Not now
              </Button>
              {rec.sourceUrl && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={rec.sourceUrl} target="_blank" rel="noreferrer">
                    <ArrowUpRight className="mr-1 h-4 w-4" /> Source
                  </a>
                </Button>
              )}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  };

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Strategy</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-5">Active role types and what each needs.</p>
      {activeGoal && (
        <CareerCompassCard goal={activeGoal} onOpenTab={onOpenTab} variant="compact" showOpenStrategy={false} />
      )}

      {insights.length > 0 && (
        <div className="mb-6 space-y-2">
          {insights.map((ins, i) => (
            <div key={i} className="rounded-xl border border-accent-foreground/15 bg-accent/40 p-4 flex items-start gap-2.5" data-testid={`insight-${i}`}>
              <Lightbulb className="w-4 h-4 text-accent-foreground shrink-0 mt-0.5" />
              <p className="text-sm leading-snug">{ins}</p>
            </div>
          ))}
        </div>
      )}

      {unlinkedItems.length > 0 && (
        <div className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
            <span className="text-sm font-medium">{unlinkedItems.length} item{unlinkedItems.length > 1 ? "s" : ""} not linked to a role type</span>
          </div>
          <div className="space-y-1.5">
            {unlinkedItems.map((it) => (
              <div key={`${it.entity}-${it.id}`} className="flex items-center gap-2 rounded-lg bg-card border border-card-border px-3 py-2" data-testid={`unlinked-${it.entity}-${it.id}`}>
                <span className="text-[10px] rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 shrink-0">{ENTITY_LABEL[it.entity]}</span>
                <span className="flex-1 text-sm truncate">{it.title}</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 shrink-0" data-testid={`button-link-unlinked-${it.entity}-${it.id}`}><Link2 className="w-3.5 h-3.5" /> Link</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-1.5" align="end">
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Link to a role type</p>
                    <div className="space-y-0.5">
                      {careerTracks.map((t) => (
                        <button key={t.id} onClick={() => linkUnlinked(it, t.id)} className="w-full text-left text-sm px-2 py-1.5 rounded-md hover-elevate">{t.name}</button>
                      ))}
                      {careerTracks.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No role types yet.</p>}
                    </div>
                  </PopoverContent>
                </Popover>
                <button onClick={() => onOpenTab(ENTITY_TAB[it.entity])} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open"><ChevronRight className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 ? (
        <>
          <GroupLabel>Active role types</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {active.map((t) => <TrackCard key={t.id} t={t} />)}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground mb-6">No active role types yet - add roles in the Jobs tab to get started.</p>
      )}

      {watching.length > 0 && (
        <>
          <GroupLabel>Not active right now</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 mt-2 mb-6">
            {watching.map((t) => <TrackCard key={t.id} t={t} />)}
          </div>
        </>
      )}

      {visibleRecommendations.length > 0 && (
        <div className="mb-6">
          <GroupLabel count={visibleRecommendations.length}>Ideas to look at next</GroupLabel>
          <p className="mb-2 text-xs text-muted-foreground">
            Things worth looking at — a theme to study, someone to reach out to, or a project idea. Tap any to review it and decide if you want to act on it.
          </p>
          <Accordion type="single" collapsible value={openRecommendationId} onValueChange={setOpenRecommendationId} className="space-y-2">
            {visibleRecommendations.map((rec) => <RecommendationCard key={rec.id} rec={rec} />)}
          </Accordion>
        </div>
      )}


      <div className="flex flex-wrap gap-2 mt-8">
        <Button size="sm" variant="outline" onClick={() => onOpenTab("jobs")}><Briefcase className="w-4 h-4 mr-1" /> Jobs</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("network")}><Users className="w-4 h-4 mr-1" /> Network</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("learn")}><GraduationCap className="w-4 h-4 mr-1" /> Learn</Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("today")}><Target className="w-4 h-4 mr-1" /> Back to Today</Button>
      </div>
    </div>
  );
}
