// @ts-nocheck
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, CalendarDays, ChevronDown, ChevronRight, Loader2,
  Clock, Send, MessageSquare, ListChecks, RefreshCw, Lightbulb, Users,
  Wand2, Target, Zap, Search, BookOpen, Network, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { mutateAndInvalidate } from "@/lib/api";
import { GOAL_SPINE_QUERY_KEYS, PENDING_CONTACT_DRAFT_KEY, queueIntakeDraft, buildPrefillHash, formatDeadline, deadlineTone, takeHashDraft, takeIntakeDraft } from "@/lib/homeTypes";
import { useCareerTracks } from "@/hooks/useCareerTracks";
import { SectionHeading } from "@/components/home/SectionHeading";
import { Loading } from "@/components/home/Loading";
import { Empty } from "@/components/home/Empty";
import { TrackChip } from "@/components/home/TrackChip";
import { ConstraintBadge } from "@/components/home/ConstraintBadge";
import { LinkTrackControl } from "@/components/home/LinkTrackControl";
import { ViewSpineCallout, BroadPursuitParallelSupportKickoff } from "@/lib/parallelPursuit";
import { laneGuideForCombination, contactPresetForLane } from "@/lib/parallelPursuit";
import { displayCombinationLabel } from "@/lib/goalSpine";
import { findOpenLinkedTask, useLinkedTaskCount } from "@/lib/homeHelpers";
import { noLinkedTasksHelp, taskActionLabelForEntity, taskCreatedLabelForEntity, taskPreviewHint, taskToastDescription } from "@/lib/taskActionCopy";
import { nextContactTaskTitle } from "@shared/taskPreview";
import type { Contact, Task, CareerTrack } from "@shared/schema";
import type { GoalPortfolioItemT, GoalsStateResponseT } from "@/lib/goalSpine";
import { getTrackId, getRelationshipStrength } from "@shared/domainState";
import { NETWORK_LANES, ALL_LANE_KEYS, laneForSourceNetwork, laneLabel } from "@shared/networkLanes";

// ─── Types ───────────────────────────────────────────────────────────────────

type ArchetypeKey = "recent_switcher" | "near_peer" | "recruiter" | "senior_decision_maker" | "connector" | "domain_expert";
type MoveType = "advice" | "intro" | "referral" | "follow_up" | "market_intelligence" | "reconnect";

type ContactClassification = {
  id: number;
  contactId: number;
  trackId: number;
  archetype: ArchetypeKey;
  relevanceScore: number;
  accessTypes: string;
  reasoning: string;
};

type NetworkGap = {
  id: number;
  trackId: number;
  archetype: ArchetypeKey;
  priority: "high" | "medium" | "low";
  reason: string;
  whyItMatters: string;
  whatToAsk: string;
  suggestedSearches: string;
};

type RecommendedMove = {
  moveType: MoveType;
  suggestedAsk: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  riskLevel: "low" | "medium" | "high";
};

// ─── Constants ───────────────────────────────────────────────────────────────

const ARCHETYPE_META: Record<ArchetypeKey, { label: string; icon: string }> = {
  recent_switcher: { label: "Recent switcher", icon: "↗" },
  near_peer: { label: "Near-peer", icon: "◎" },
  recruiter: { label: "Recruiter", icon: "◈" },
  senior_decision_maker: { label: "Decision maker", icon: "▲" },
  connector: { label: "Connector", icon: "⬡" },
  domain_expert: { label: "Domain expert", icon: "◆" },
};

const ARCHETYPE_TONE: Record<ArchetypeKey, string> = {
  recent_switcher: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  near_peer: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  recruiter: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  senior_decision_maker: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  connector: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  domain_expert: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
};

const PRIORITY_TONE = {
  high: "text-destructive font-semibold",
  medium: "text-primary font-medium",
  low: "text-muted-foreground",
};

const MOVE_LABEL: Record<MoveType, string> = {
  advice: "Ask for a 20-min advice call",
  intro: "Ask for a specific introduction",
  referral: "Ask for a referral or warm intro",
  follow_up: "Follow up on last message",
  market_intelligence: "Ask for market perspective",
  reconnect: "Reconnect before asking anything",
};

const OUTREACH_COLS = [
  { id: "to_contact", label: "To reach" },
  { id: "messaged", label: "Messaged" },
  { id: "replied", label: "Replied" },
] as const;

const ASK_TYPE_OPTIONS = [
  { value: "soft", label: "Soft intro" },
  { value: "advice", label: "Advice" },
  { value: "referral", label: "Referral" },
  { value: "reconnect", label: "Reconnect" },
  { value: "follow_up", label: "Follow-up" },
];

const RELATIONSHIP_OPTIONS = [
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
  { value: "strong", label: "Strong" },
];

const STRENGTH_TONE: Record<string, string> = {
  strong: "bg-primary/15 text-primary",
  warm: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  cold: "bg-muted text-muted-foreground",
};

type ContactFormT = {
  name: string; who: string; sector: string; why: string; sourceNetwork: string;
  targetOrg: string; targetRole: string; askType: string; relationshipStrength: string;
  nextFollowUpDate: string; relatedTrackId: number | null; status: string; messageDraft: string;
};
const EMPTY_CONTACT_FORM: ContactFormT = {
  name: "", who: "", sector: "", why: "", sourceNetwork: "", targetOrg: "", targetRole: "",
  askType: "soft", relationshipStrength: "cold", nextFollowUpDate: "", relatedTrackId: null,
  status: "to_contact", messageDraft: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isFollowUpOverdue(c: Contact): boolean {
  if (!c.nextFollowUpDate) return false;
  const d = new Date(c.nextFollowUpDate + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  return Math.round((d.getTime() - Date.now()) / 86400000) < 0;
}

function safeParseArray(raw: string): string[] {
  try { const p = JSON.parse(raw || "[]"); return Array.isArray(p) ? p : []; } catch { return []; }
}

function gapStatus(gap: NetworkGap, classifications: ContactClassification[]): "missing" | "partial" | "covered" {
  const count = classifications.filter(
    (c) => c.trackId === gap.trackId && c.archetype === gap.archetype
  ).length;
  if (count === 0) return "missing";
  if (count <= 2) return "partial";
  return "covered";
}

const STATUS_CHIP: Record<string, string> = {
  missing: "bg-destructive/10 text-destructive",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  covered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};
const STATUS_LABEL = { missing: "Missing", partial: "Partial", covered: "Covered" };

// ─── Sub-components ──────────────────────────────────────────────────────────

function CreateNextContactTask({ c, hint }: { c: Contact; hint?: string | null }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/contacts/${c.id}/create-next-task`, {}, ["/api/tasks", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: r?.reused ? "Already on your list." : taskCreatedLabelForEntity("contacts"), description: taskToastDescription(r, "There's already an open task for this contact.") });
    } catch { toast({ title: "Couldn't create the task", description: "Try again in a moment." }); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <button onClick={go} disabled={busy} className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-60">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {taskActionLabelForEntity("contacts")}
      </button>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NetworkGapCard({ gap, classifications, onAddContact }: {
  gap: NetworkGap;
  classifications: ContactClassification[];
  onAddContact?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = gapStatus(gap, classifications);
  const searches = safeParseArray(gap.suggestedSearches);

  return (
    <div className={`rounded-lg border p-3 ${status === "covered" ? "border-emerald-300/40 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/20" : status === "partial" ? "border-amber-300/40 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/20" : "border-card-border bg-card"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ARCHETYPE_TONE[gap.archetype]}`}>
              {ARCHETYPE_META[gap.archetype]?.label || gap.archetype}
            </span>
            <span className={`text-[10px] font-medium ${PRIORITY_TONE[gap.priority]}`}>{gap.priority} priority</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-snug">{gap.reason}</p>
        </div>
        <button onClick={() => setExpanded((o) => !o)} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2.5 space-y-2">
          {gap.whyItMatters && (
            <div>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-0.5">Why this matters</p>
              <p className="text-xs text-foreground">{gap.whyItMatters}</p>
            </div>
          )}
          {gap.whatToAsk && (
            <div>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-0.5">What to ask</p>
              <p className="text-xs text-foreground italic">"{gap.whatToAsk}"</p>
            </div>
          )}
          {searches.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Search for them</p>
              <div className="flex flex-wrap gap-1.5">
                {searches.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    <Search className="w-2.5 h-2.5" /> {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {status !== "covered" && onAddContact && (
            <button onClick={onAddContact} className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1 mt-1">
              <Plus className="w-3.5 h-3.5" /> Add this type of contact
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NetworkStrategyPanel({ track, classifications, onAddContact }: {
  track: CareerTrack;
  classifications: ContactClassification[];
  onAddContact: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { data: gapsData } = useQuery<{ gaps: NetworkGap[] }>({
    queryKey: [`/api/networking/gaps`, track.id],
    queryFn: async () => {
      const r = await fetch(`/api/networking/gaps?trackId=${track.id}`);
      return r.json();
    },
  });
  const gaps = gapsData?.gaps || [];

  async function generateGaps() {
    setGenerating(true);
    try {
      await mutateAndInvalidate("POST", `/api/networking/generate-gaps/${track.id}`, {}, []);
      queryClient.invalidateQueries({ queryKey: [`/api/networking/gaps`, track.id] });
      toast({ title: "Network map ready.", description: "Showing who you need to build access to." });
    } catch {
      toast({ title: "Couldn't generate right now.", description: "Try again in a moment." });
    } finally { setGenerating(false); }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">{track.name}</span>
          {gaps.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {gaps.filter((g) => gapStatus(g, classifications) === "missing").length} gaps
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4">
          {gaps.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground mb-3">
                Generate a network map for this track — who you need to build access to and why.
              </p>
              <Button size="sm" variant="outline" onClick={generateGaps} disabled={generating}>
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Wand2 className="w-3.5 h-3.5 mr-1.5" />}
                {generating ? "Mapping your network…" : "Map who I need"}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground mb-2.5">
                Build access to these types of people to break into {track.name} roles.
              </p>
              <div className="space-y-2">
                {gaps
                  .slice()
                  .sort((a, b) => {
                    const order = { high: 0, medium: 1, low: 2 };
                    return order[a.priority] - order[b.priority];
                  })
                  .map((gap) => (
                    <NetworkGapCard
                      key={gap.id}
                      gap={gap}
                      classifications={classifications}
                      onAddContact={onAddContact}
                    />
                  ))}
              </div>
              <button onClick={generateGaps} disabled={generating} className="mt-2.5 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {generating ? "Refreshing…" : "Refresh map"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ContactCard({ c, tracks, tasks, classifications, onPatch, onRemove, onLogInteraction }: {
  c: Contact;
  tracks: CareerTrack[];
  tasks: Task[];
  classifications: ContactClassification[];
  onPatch: (c: Contact, body: Record<string, unknown>) => Promise<void>;
  onRemove: () => void;
  onLogInteraction: (id: number, type: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setNameLocal] = useState(c.name || "");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState(c.messageDraft || "");
  const [savingDraft, setSavingDraft] = useState(false);
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [draftContext, setDraftContext] = useState("");
  const [draftingAI, setDraftingAI] = useState(false);
  const [recommendedMove, setRecommendedMove] = useState<RecommendedMove | null>(null);
  const [moveTrack, setMoveTrack] = useState<{ id: number; name: string } | null>(null);
  const [loadingMove, setLoadingMove] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loggingType, setLoggingType] = useState<string | null>(null);

  const { data: interactions = [] } = useQuery({
    queryKey: [`/api/contacts/${c.id}/interactions`],
    enabled: showHistory,
  });

  const nextActionDue = (c as any).nextActionDue;
  const nextActionType = (c as any).nextActionType;
  const nextActionDesc = (c as any).nextActionDesc;

  async function handleLogInteraction(type: string) {
    setLoggingType(type);
    try { await onLogInteraction(c.id, type); }
    finally { setLoggingType(null); }
  }

  const idx = OUTREACH_COLS.findIndex((s) => s.id === c.status);
  const trackId = getTrackId("contacts", c);
  const linked = useLinkedTaskCount(tasks, "contact", c.id);
  const openContactTask = findOpenLinkedTask(tasks, "contact", c.id);
  const overdue = isFollowUpOverdue(c);
  const replied = c.status === "replied";
  const strength = getRelationshipStrength(c);

  // Best classification for this contact
  const myClassifications = classifications.filter((cl) => cl.contactId === c.id);
  const bestCls = myClassifications.sort((a, b) => b.relevanceScore - a.relevanceScore)[0] ?? null;

  const tone = replied
    ? "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/30"
    : overdue
      ? "border-amber-400/70 bg-amber-50/50 dark:border-amber-700/60 dark:bg-amber-950/20"
      : "border-card-border bg-card";

  async function saveDraft() {
    setSavingDraft(true);
    try { await onPatch(c, { messageDraft: draft }); toast({ title: "Draft saved." }); setDraftOpen(false); }
    finally { setSavingDraft(false); }
  }

  async function draftWithAI() {
    setDraftingAI(true);
    try {
      const r = await mutateAndInvalidate(
        "POST", `/api/contacts/${c.id}/draft-message`,
        draftContext.trim() ? { context: draftContext.trim() } : {},
        [],
      );
      if (r?.draft) {
        setDraft(r.draft);
        setDraftOpen(true);
        setShowDraftPanel(false);
        if (r.move) setRecommendedMove(r.move);
        if (r.track) setMoveTrack(r.track);
        toast({ title: "Draft ready.", description: "Edit it to make it yours before sending." });
      } else {
        toast({ title: "Couldn't draft right now.", description: r?.error || "Try again." });
      }
    } catch {
      toast({ title: "Couldn't draft right now.", description: "Try again in a moment." });
    } finally { setDraftingAI(false); }
  }

  async function getRecommendedMove() {
    setLoadingMove(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/contacts/${c.id}/recommend-move`, {}, []);
      if (r?.move) { setRecommendedMove(r.move); setMoveTrack(r.track ?? null); }
    } catch { toast({ title: "Couldn't compute move.", description: "Try again." }); }
    finally { setLoadingMove(false); }
  }

  async function reclassify() {
    setClassifying(true);
    try {
      await mutateAndInvalidate("POST", `/api/networking/classify-contact/${c.id}`, {}, []);
      queryClient.invalidateQueries({ queryKey: ["/api/networking/classifications"] });
      toast({ title: "Reclassified." });
    } catch { toast({ title: "Couldn't classify.", description: "Try again." }); }
    finally { setClassifying(false); }
  }

  return (
    <div className={`group rounded-lg border p-3 ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {bestCls && (
              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ARCHETYPE_TONE[bestCls.archetype]}`}>
                {ARCHETYPE_META[bestCls.archetype]?.label}
                {bestCls.relevanceScore >= 4 && <span className="ml-0.5 opacity-70">{bestCls.relevanceScore}/5</span>}
              </span>
            )}
            {!bestCls && (
              <button onClick={reclassify} disabled={classifying} className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-60">
                {classifying ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />}
                {classifying ? "Classifying…" : "Classify"}
              </button>
            )}
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STRENGTH_TONE[strength]}`}>{strength}</span>
            {overdue && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-semibold"><Clock className="w-2.5 h-2.5" /> overdue</span>}
          </div>
          <p className="text-sm font-medium leading-snug mt-1.5">{c.who || "Someone worth reaching"}</p>
          {bestCls?.reasoning && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{bestCls.reasoning}</p>
          )}
        </div>
        <button onClick={onRemove} aria-label="Delete" className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <TrackChip trackId={trackId} tracks={tracks} />
        {(c.targetOrg || c.targetRole) && <span className="inline-flex items-center text-[10px] rounded-full bg-accent text-accent-foreground px-1.5 py-0.5">{[c.targetRole, c.targetOrg].filter(Boolean).join(" · ")}</span>}
        {c.nextFollowUpDate && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${overdue ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}><CalendarDays className="w-2.5 h-2.5" />{formatDeadline(c.nextFollowUpDate)}</span>}
        {moveTrack && <span className="inline-flex items-center text-[10px] rounded-full bg-primary/10 text-primary px-1.5 py-0.5">{moveTrack.name}</span>}
      </div>

      {c.why && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{c.why}</p>}

      <input
        value={name}
        onChange={(e) => setNameLocal(e.target.value)}
        onBlur={() => name !== c.name && onPatch(c, { name })}
        placeholder="Name (optional)"
        className="mt-1 w-full text-[11px] text-muted-foreground bg-transparent border-b border-input/60 pb-1 focus:outline-none focus:border-primary"
      />

      {/* Recommended move */}
      {recommendedMove ? (
        <div className="mt-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-primary mb-0.5">Recommended move</p>
          <p className="text-xs font-medium">{MOVE_LABEL[recommendedMove.moveType]}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{recommendedMove.reason}</p>
          <button
            onClick={() => setShowDraftPanel(true)}
            className="mt-2 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
          >
            <Wand2 className="w-3 h-3" /> Draft this message
          </button>
        </div>
      ) : (
        <button
          onClick={getRecommendedMove}
          disabled={loadingMove}
          className="mt-2.5 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-60"
        >
          {loadingMove ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
          {loadingMove ? "Computing…" : "What should I ask?"}
        </button>
      )}

      {/* Draft panel */}
      {showDraftPanel && !draftOpen && (
        <div className="mt-2 rounded-lg border border-card-border bg-muted/40 p-3">
          <p className="text-xs font-medium mb-1">What do you know about them right now?</p>
          <p className="text-[11px] text-muted-foreground mb-2">
            Paste anything — a LinkedIn headline, recent paper, something someone told you. Leave blank and the AI will search for them.
          </p>
          <textarea
            value={draftContext}
            onChange={(e) => setDraftContext(e.target.value)}
            rows={2}
            placeholder={c.name ? `e.g. "${c.name} recently published on..."` : `e.g. "Just gave a talk at the OECD AI Forum..."`}
            className="w-full text-xs bg-background border border-input rounded-md p-2 focus:outline-none focus:border-primary resize-none"
          />
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" className="h-7 px-3 text-xs" onClick={draftWithAI} disabled={draftingAI}>
              {draftingAI ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Drafting…</> : <><Wand2 className="w-3 h-3 mr-1" />Draft it</>}
            </Button>
            <button onClick={() => { setShowDraftPanel(false); setDraftContext(""); }} className="text-xs text-muted-foreground hover:text-foreground">cancel</button>
          </div>
        </div>
      )}

      {draftOpen && (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Draft your outreach message…"
            className="w-full text-xs bg-background border border-input rounded-md p-2 focus:outline-none focus:border-primary resize-none"
          />
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Button size="sm" className="h-7 px-2 text-xs" onClick={saveDraft} disabled={savingDraft}>
              {savingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save draft"}
            </Button>
            <button onClick={() => { setShowDraftPanel(true); setDraftOpen(false); }} disabled={draftingAI} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-60">
              <Wand2 className="w-3 h-3" /> Redraft
            </button>
            <button onClick={() => { setDraft(c.messageDraft || ""); setDraftOpen(false); }} className="text-xs text-muted-foreground hover:text-foreground">cancel</button>
          </div>
        </div>
      )}

      {nextActionDue && nextActionType && (
        <div className={`text-xs flex items-center gap-1 mt-1 ${
          nextActionDue < Date.now()
            ? "text-red-500"
            : "text-amber-500"
        }`}>
          <Clock className="w-3 h-3" />
          <span>{nextActionDesc || nextActionType}</span>
          <span className="text-muted-foreground">
            · {nextActionDue < Date.now()
                ? `${Math.floor((Date.now() - nextActionDue) / 86400000)}d overdue`
                : `due ${new Date(nextActionDue).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`
              }
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 mt-2.5">
        {idx > 0 && <button onClick={() => onPatch(c, { status: OUTREACH_COLS[idx - 1].id })} className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover-elevate">←</button>}
        {idx < OUTREACH_COLS.length - 1 && <button onClick={() => onPatch(c, { status: OUTREACH_COLS[idx + 1].id })} className="text-xs px-2 py-0.5 rounded text-primary font-medium hover-elevate">{OUTREACH_COLS[idx + 1].label} →</button>}
      </div>

      <div className="flex gap-1.5 flex-wrap mt-2">
        {[
          { type: "response", label: "They replied", show: c.status === "messaged" },
          { type: "meeting", label: "Meeting had", show: c.status === "replied" },
          { type: "intro", label: "Got intro", show: true },
          { type: "referral", label: "Got referral", show: true },
        ].filter(b => b.show).map(btn => (
          <button key={btn.type}
            onClick={() => handleLogInteraction(btn.type)}
            disabled={loggingType === btn.type}
            data-testid={`button-log-${btn.type}-${c.id}`}
            className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted/50 transition-colors disabled:opacity-60 inline-flex items-center gap-1">
            {loggingType === btn.type && <Loader2 className="w-3 h-3 animate-spin" />}
            {btn.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 pt-2 border-t border-card-border">
        <CreateNextContactTask c={c} hint={taskPreviewHint(nextContactTaskTitle(c), openContactTask?.title)} />
        <button
          onClick={() => {
            if (showDraftPanel || draftOpen) { setShowDraftPanel(false); setDraftOpen(false); }
            else { setShowDraftPanel(true); }
          }}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <Wand2 className="w-3.5 h-3.5" /> Message
        </button>
        <button onClick={() => toast({ title: linked > 0 ? `${linked} linked open task${linked > 1 ? "s" : ""}` : "No linked tasks yet", description: linked > 0 ? "Look in Brain dump, or in Today if one has been planned." : noLinkedTasksHelp(taskActionLabelForEntity("contacts")) })} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ListChecks className="w-3.5 h-3.5" /> Tasks
        </button>
        <LinkTrackControl entity="contacts" id={c.id} trackId={trackId} tracks={tracks} />
        {bestCls && (
          <button onClick={reclassify} disabled={classifying} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-60">
            {classifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Reclassify
          </button>
        )}
        <button onClick={() => setShowHistory(o => !o)} data-testid={`button-history-${c.id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showHistory ? "rotate-90" : ""}`} /> History
        </button>
      </div>

      {showHistory && (
        <div className="mt-2 space-y-1">
          {interactions.length === 0
            ? <p className="text-xs text-muted-foreground">No interactions logged yet.</p>
            : interactions.slice(0, 3).map((ix: any) => (
              <div key={ix.id} className="text-xs flex items-center gap-2 text-muted-foreground">
                <span className="capitalize font-medium text-foreground">{ix.type}</span>
                {ix.note && <span>— {ix.note}</span>}
                <span className="ml-auto tabular-nums">{new Date(ix.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ─── Best Move Banner ─────────────────────────────────────────────────────────

function BestMoveBanner() {
  const { data } = useQuery<{ bestMove: any }>({
    queryKey: ["/api/networking/best-move"],
    queryFn: async () => {
      const r = await fetch("/api/networking/best-move");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [draftContext, setDraftContext] = useState("");
  const [draftingAI, setDraftingAI] = useState(false);
  const [draft, setDraft] = useState("");
  const { toast } = useToast();
  const bm = data?.bestMove;
  if (!bm) return null;

  const contact = bm.contact;
  const move: RecommendedMove = bm.move;
  const track = bm.track;

  async function draftBestMove() {
    setDraftingAI(true);
    try {
      const r = await mutateAndInvalidate("POST", `/api/contacts/${contact.id}/draft-message`, draftContext.trim() ? { context: draftContext.trim() } : {}, []);
      if (r?.draft) { setDraft(r.draft); setShowDraftPanel(false); toast({ title: "Draft ready." }); }
    } catch { toast({ title: "Couldn't draft right now." }); }
    finally { setDraftingAI(false); }
  }

  return (
    <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary mb-2">
        <Zap className="w-3.5 h-3.5" /> Best move today
      </div>
      <p className="text-sm font-semibold">{contact.name || contact.who}</p>
      {track && <p className="text-[11px] text-muted-foreground">{track.name}</p>}
      <p className="text-xs text-muted-foreground mt-1 leading-snug">{bm.reason}</p>
      {move && (
        <div className="mt-2 rounded-md border border-primary/15 bg-primary/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-primary mb-0.5">Recommended move</p>
          <p className="text-xs font-medium">{MOVE_LABEL[move.moveType as MoveType]}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{move.suggestedAsk}</p>
        </div>
      )}
      {!showDraftPanel && !draft && (
        <button onClick={() => setShowDraftPanel(true)} className="mt-2.5 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1">
          <Wand2 className="w-3 h-3" /> Draft this message
        </button>
      )}
      {showDraftPanel && (
        <div className="mt-2.5 space-y-2">
          <textarea
            value={draftContext}
            onChange={(e) => setDraftContext(e.target.value)}
            rows={2}
            placeholder="What do you know about them right now? (optional)"
            className="w-full text-xs bg-background border border-input rounded-md p-2 focus:outline-none focus:border-primary resize-none"
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={draftBestMove} disabled={draftingAI}>
              {draftingAI ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Drafting…</> : <><Wand2 className="w-3 h-3 mr-1" />Draft it</>}
            </Button>
            <button onClick={() => setShowDraftPanel(false)} className="text-xs text-muted-foreground hover:text-foreground">cancel</button>
          </div>
        </div>
      )}
      {draft && (
        <div className="mt-2.5 rounded-md border border-card-border bg-background p-2.5">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">Draft</p>
          <p className="text-xs whitespace-pre-wrap">{draft}</p>
          <button onClick={() => { setDraft(""); setShowDraftPanel(true); }} className="mt-2 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Redraft
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function NetworkView() {
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: goalState } = useQuery<GoalsStateResponseT>({ queryKey: ["/api/goals/state"] });
  const { data: tracks = [] } = useCareerTracks();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const { data: classificationsData } = useQuery<{ classifications: ContactClassification[] }>({
    queryKey: ["/api/networking/classifications"],
    queryFn: async () => {
      const r = await fetch("/api/networking/classifications");
      return r.json();
    },
  });
  const classifications = classificationsData?.classifications || [];
  const { toast } = useToast();
  const activeGoal = goalState?.goals?.[0] || null;
  const activeTracks = tracks.filter((t) => t.status === "active");

  const [sug, setSug] = useState<{ who: string; sector: string; why: string } | null>(null);
  const [sugLoading, setSugLoading] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContactFormT>(EMPTY_CONTACT_FORM);
  const [selectedLane, setSelectedLane] = useState("");
  const selectedLaneGuide = selectedLane ? laneGuideForCombination(selectedLane) : null;
  const [showMoreContactFields, setShowMoreContactFields] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(true);

  useEffect(() => {
    const pending = takeHashDraft<ContactFormT>("contactDraft") || takeIntakeDraft<ContactFormT>(PENDING_CONTACT_DRAFT_KEY);
    if (pending) { setForm({ ...EMPTY_CONTACT_FORM, ...pending }); setShowForm(true); }
  }, []);

  async function fetchSug(exclude: string[]) {
    setSugLoading(true);
    try { const r = await mutateAndInvalidate("POST", "/api/networking/suggest", { exclude }, []); setSug(r?.suggestion || null); }
    catch { setSug(null); }
    finally { setSugLoading(false); }
  }
  useEffect(() => { fetchSug([]); /* eslint-disable-next-line */ }, []);

  function resetForm() { setForm(EMPTY_CONTACT_FORM); setSelectedLane(""); setShowForm(false); setShowMoreContactFields(false); }
  function startBlankContact() { setForm(EMPTY_CONTACT_FORM); setSelectedLane(""); setShowForm(true); }
  function startLaneContact(item: GoalPortfolioItemT) {
    const preset = contactPresetForLane(item, tracks);
    setForm({ ...EMPTY_CONTACT_FORM, ...preset });
    setSelectedLane(item.combination);
    setShowForm(true);
  }
  function startSuggestedContact() {
    if (!sug) return;
    setForm({ ...EMPTY_CONTACT_FORM, who: sug.who, sector: sug.sector, why: sug.why, askType: "advice", relationshipStrength: "cold", status: "to_contact" });
    setShowForm(true);
  }
  function another() { if (!sug) return; const next = [...seen, sug.who]; setSeen(next); fetchSug(next); }

  const queryClient = useQueryClient();

  async function addContact() {
    if (!form.who.trim()) return;
    const created = await mutateAndInvalidate("POST", "/api/contacts", form, ["/api/contacts", ...GOAL_SPINE_QUERY_KEYS]);
    toast({ title: "Added to your network." });
    if (sug && form.who === sug.who) { const next = [...seen, sug.who]; setSeen(next); fetchSug(next); }
    resetForm();
    // Auto-classify (non-blocking)
    if (created?.id) {
      mutateAndInvalidate("POST", `/api/networking/classify-contact/${created.id}`, {}, []).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/networking/classifications"] });
      }).catch(() => {});
    }
  }
  async function patch(c: Contact, body: Record<string, unknown>) {
    await mutateAndInvalidate("PATCH", `/api/contacts/${c.id}`, body, ["/api/contacts", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
  }
  async function remove(id: number) {
    await mutateAndInvalidate("DELETE", `/api/contacts/${id}`, undefined, ["/api/contacts", "/api/strategy/diagnostics", ...GOAL_SPINE_QUERY_KEYS]);
  }

  const { data: analytics } = useQuery<any>({ queryKey: ["/api/networking/analytics"] });

  async function logInteraction(contactId: number, type: string) {
    try {
      await mutateAndInvalidate("POST", `/api/contacts/${contactId}/log-interaction`, { type },
        ["/api/contacts", `/api/contacts/${contactId}/interactions`, "/api/networking/analytics", ...GOAL_SPINE_QUERY_KEYS]);
      toast({ title: "Logged.", description: `${type.charAt(0).toUpperCase() + type.slice(1)} recorded — next action updated.` });
    } catch {
      toast({ title: "Couldn't log interaction", description: "Try again in a moment." });
    }
  }

  const byLane = new Map<string, Contact[]>(ALL_LANE_KEYS.map((k) => [k, []]));
  for (const c of contacts) byLane.get(laneForSourceNetwork(c.sourceNetwork))!.push(c);
  const populatedLaneKeys = ALL_LANE_KEYS.filter((k) => byLane.get(k)!.length > 0);
  const quietLaneKeys = NETWORK_LANES.map((lane) => lane.key).filter((key) => byLane.get(key)!.length === 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="Network" sub="Build access to the right people, strategically." />
        <Button onClick={() => showForm ? setShowForm(false) : startBlankContact()} className="shrink-0"><Plus className="w-4 h-4 mr-1" /> Add contact</Button>
      </div>

      {activeGoal && !(contacts.length === 0 && activeGoal.decisionMode === "broad-parallel-pursuit") && <ViewSpineCallout view="network" goal={activeGoal} />}
      {activeGoal && <BroadPursuitParallelSupportKickoff goal={activeGoal} mode="network" onStartLane={startLaneContact} />}

      {/* Today's best networking move */}
      {contacts.length > 0 && <BestMoveBanner />}

      {/* Network strategy by track */}
      {activeTracks.length > 0 && (
        <div className="mb-5">
          <button
            onClick={() => setStrategyOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 mb-2.5 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5" /> Network strategy
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${strategyOpen ? "rotate-180" : ""}`} />
          </button>
          {strategyOpen && (
            <div className="space-y-3">
              {activeTracks.map((track) => (
                <NetworkStrategyPanel
                  key={track.id}
                  track={track}
                  classifications={classifications}
                  onAddContact={() => { setForm(EMPTY_CONTACT_FORM); setShowForm(true); }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add contact form */}
      {showForm && (
        <div className="mb-5 rounded-xl border border-card-border bg-card p-4 space-y-3">
          {selectedLane && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Role type</p>
                <p className="text-sm font-medium">{displayCombinationLabel(selectedLane)}</p>
                {selectedLaneGuide && <p className="text-xs text-muted-foreground mt-0.5">{selectedLaneGuide.fitHint}</p>}
              </div>
              <button type="button" onClick={() => { setSelectedLane(""); setForm((c) => ({ ...c, sector: "", why: "", targetRole: "", relatedTrackId: null })); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Clear</button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Who they are (role / title) *" value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} autoFocus className="sm:col-span-2" />
            <Input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Org / company" value={form.targetOrg} onChange={(e) => setForm({ ...form, targetOrg: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Connection</p>
              <div className="flex flex-wrap gap-1.5">
                {RELATIONSHIP_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setForm({ ...form, relationshipStrength: option.value })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.relationshipStrength === option.value ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground"}`}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setShowMoreContactFields((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreContactFields ? "rotate-180" : ""}`} />
            {showMoreContactFields ? "Fewer options" : "More options"}
          </button>
          {showMoreContactFields && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Target role" value={form.targetRole} onChange={(e) => setForm({ ...form, targetRole: e.target.value })} />
              <Input type="date" value={form.nextFollowUpDate} onChange={(e) => setForm({ ...form, nextFollowUpDate: e.target.value })} />
              <Input placeholder="Why this person matters" value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} className="sm:col-span-2" />
              <Input placeholder="Network source / sector" value={form.sourceNetwork} onChange={(e) => setForm({ ...form, sourceNetwork: e.target.value })} className="sm:col-span-2" />
              {tracks.length > 0 && (
                <div className="sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Link to role type</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tracks.map((track) => (
                      <button key={track.id} type="button" onClick={() => setForm({ ...form, relatedTrackId: form.relatedTrackId === track.id ? null : track.id })}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${form.relatedTrackId === track.id ? "border-primary/30 bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:text-foreground"}`}>
                        {track.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={resetForm}>Cancel</Button>
            <Button onClick={addContact}>Save contact</Button>
          </div>
        </div>
      )}

      {/* AI suggestion */}
      {(sugLoading || sug) && (
        <div className="mb-5 rounded-xl border border-slate-300/60 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-2">
            <Lightbulb className="w-4 h-4" /> Who to reach next
          </div>
          {sugLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Finding who could help…</div>
          ) : sug ? (
            <div>
              <p className="text-sm font-medium leading-snug">{sug.who}{sug.sector && <span className="ml-2 inline-flex items-center rounded-full bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{sug.sector}</span>}</p>
              {sug.why && <p className="text-xs text-muted-foreground mt-0.5">{sug.why}</p>}
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" onClick={startSuggestedContact}><Plus className="w-4 h-4 mr-1" /> Add this contact</Button>
                <button onClick={another} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> someone else</button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Contacts */}
      {isLoading ? <Loading /> : contacts.length === 0 ? (
        <Empty icon={Users} text="No contacts yet. Add your first contact — someone you want to reach out to, or who could help." action={{ label: "Add a contact", onClick: () => setShowForm(true) }} />
      ) : (
        <div className="space-y-6">
          {(() => {
            const overdueContacts = contacts.filter(isFollowUpOverdue);
            if (overdueContacts.length === 0) return null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Overdue follow-ups</span>
                  <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-medium px-1.5 py-0.5">{overdueContacts.length}</span>
                </div>
                <div className="space-y-2">
                  {overdueContacts.map((c) => <ContactCard key={c.id} c={c} tracks={tracks} tasks={tasks} classifications={classifications} onPatch={patch} onRemove={() => remove(c.id)} onLogInteraction={logInteraction} />)}
                </div>
              </div>
            );
          })()}
          {populatedLaneKeys.map((key) => {
            const items = byLane.get(key)!;
            const nonOverdue = items.filter((c) => !isFollowUpOverdue(c));
            if (nonOverdue.length === 0) return null;
            return (
              <div key={key}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{laneLabel(key)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">({nonOverdue.length})</span>
                </div>
                <div className="space-y-2">
                  {nonOverdue.map((c) => <ContactCard key={c.id} c={c} tracks={tracks} tasks={tasks} classifications={classifications} onPatch={patch} onRemove={() => remove(c.id)} onLogInteraction={logInteraction} />)}
                </div>
              </div>
            );
          })}
          {quietLaneKeys.length > 0 && (
            <div className="rounded-xl border border-dashed border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Role types with no contacts yet</p>
              <div className="flex flex-wrap gap-2">
                {quietLaneKeys.map((key) => (
                  <span key={key} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">{laneLabel(key)}</span>
                ))}
              </div>
            </div>
          )}

          {analytics && (analytics.byArchetype?.length > 0 || analytics.overdue?.length > 0) && (
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">What's working</p>
              {analytics.insight && (
                <p className="text-sm text-foreground mb-3 leading-snug">{analytics.insight}</p>
              )}
              {analytics.byArchetype?.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {analytics.byArchetype.map((row: any) => (
                    <div key={row.archetype} className="flex items-center gap-2 text-xs">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ARCHETYPE_TONE[row.archetype as ArchetypeKey] || "bg-muted text-muted-foreground"}`}>
                        {ARCHETYPE_META[row.archetype as ArchetypeKey]?.label || row.archetype}
                      </span>
                      <span className="text-muted-foreground">{row.outreached} outreached</span>
                      {row.outreached > 0 && <span className="text-foreground font-medium">{row.replyRate}% replied</span>}
                    </div>
                  ))}
                </div>
              )}
              {analytics.overdue?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-1.5">Overdue actions</p>
                  <div className="space-y-1">
                    {analytics.overdue.slice(0, 3).map((o: any) => (
                      <div key={o.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3 text-amber-500 shrink-0" />
                        <span className="font-medium text-foreground">{o.name}</span>
                        <span>{o.nextActionDesc || o.nextActionType}</span>
                        <span className="ml-auto tabular-nums text-amber-600 dark:text-amber-400">{o.daysOverdue}d overdue</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
